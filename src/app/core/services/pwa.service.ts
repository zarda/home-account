import { Injectable, signal, computed } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** A connection that cannot answer within this counts as unusable. */
const REACHABILITY_TIMEOUT_MS = 4000;

/**
 * Backoff for re-probing while the probe — not the OS — is the only thing
 * claiming we are offline. Bounded and self-cancelling so a connection that
 * comes back without an `online` event still recovers, without a timer
 * running while everything is healthy.
 */
const REACHABILITY_RETRY_MIN_MS = 5000;
const REACHABILITY_RETRY_MAX_MS = 60000;

/** Chromium's install prompt event, which lib.dom does not declare. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

/**
 * Reachability, platform detection and the install prompt.
 *
 * Confirms the connection actually carries traffic (not just that the OS
 * reports an interface), detects standalone/iOS so callers can adapt their
 * UI, and holds the browser's install prompt so the app can offer it. The
 * service worker's messages are not read here: the share-target worker posts
 * notification routes, and NotificationTapService listens for them itself.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  // Signals for PWA state
  private _isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private _isStandalone = signal<boolean>(false);
  private _isIOS = signal<boolean>(false);
  private _installPrompt = signal<BeforeInstallPromptEvent | null>(null);

  // Reachability probe state
  private probeInFlight: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 0;

  // Public computed signals
  isOnline = computed(() => this._isOnline());
  isStandalone = computed(() => this._isStandalone());
  isIOS = computed(() => this._isIOS());
  canPromptInstall = computed(() => this._installPrompt() !== null);

  constructor() {
    // Initialize browser-only features
    if (typeof window !== 'undefined') {
      this._isStandalone.set(this.checkStandaloneMode());
      this._isIOS.set(this.checkIsIOS());
      this.initializeListeners();
    }
  }

  private initializeListeners(): void {
    // Online/offline status. Going online is believed immediately and only
    // then confirmed: taking the optimistic answer first means a probe that
    // cannot work in this environment at all can never hold the app offline
    // past the next reconnect.
    window.addEventListener('online', () => {
      this.setOnline(true);
      void this.refreshOnlineStatus();
    });
    window.addEventListener('offline', () => {
      this._isOnline.set(false);
      this.cancelReachabilityRetry();
    });

    // A portal starts or stops swallowing traffic while the app is in the
    // background and no online/offline event fires for it, so re-check on the
    // way back in. Cheap, and tied to something the user did rather than a
    // timer that keeps the radio awake.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.refreshOnlineStatus();
      }
    });

    // App installed: the one moment standalone flips without a reload, and
    // the camera capture reads it. A held install prompt has nothing left to
    // offer once the app is installed.
    window.addEventListener('appinstalled', () => {
      this._isStandalone.set(true);
      this._installPrompt.set(null);
    });

    // Held so the app can offer it, but never preventDefault()ed: that would
    // hide the browser's own install UI on every visit, while the app offers
    // the prompt in one place only (ADR 0112). The native shell is installed
    // by definition, so it never holds one.
    if (!Capacitor.isNativePlatform()) {
      window.addEventListener('beforeinstallprompt', (event) => {
        this._installPrompt.set(event as BeforeInstallPromptEvent);
      });
    }
  }

  private checkStandaloneMode(): boolean {
    // The native app is installed by definition, and its WKWebView fails
    // every check below: the standalone display-mode query does not match
    // there and navigator.standalone is false. Read from those alone, the
    // camera told people already in the app to add it to their Home Screen.
    if (Capacitor.isNativePlatform()) return true;

    // Check various ways an app might be in standalone mode
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  private checkIsIOS(): boolean {
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent) && !(window as Window & { MSStream?: unknown }).MSStream) {
      return true;
    }
    // iPadOS Safari asks for the desktop site, so its user agent reads as a
    // Mac's. Touch tells them apart: no Mac reports touch points.
    return userAgent.includes('macintosh') && window.navigator.maxTouchPoints > 1;
  }

  /**
   * Confirm the connection actually carries traffic and update `isOnline`.
   *
   * `navigator.onLine` only reports that the device has a network interface.
   * On hotel wifi, an airport portal or a connection that has been throttled
   * to nothing it stays true, so every caller gated on `isOnline()` took the
   * online branch and requests hung instead of queueing. Callers that are
   * about to do something expensive can await this first; everyone else keeps
   * reading the signal, which the probe updates behind them.
   */
  async refreshOnlineStatus(): Promise<boolean> {
    // The probe can only ever demote. When the OS says there is no interface
    // there is nothing to verify, and on the native builds a probe would be
    // answered by the bundled web server whatever the radio is doing.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this._isOnline.set(false);
      this.cancelReachabilityRetry();
      return false;
    }

    // One reconnect wakes several callers at once (the queue starts syncing
    // while the camera checks whether to scan); they share a single request.
    if (!this.probeInFlight) {
      this.probeInFlight = this.probeReachability();
      void this.probeInFlight.finally(() => {
        this.probeInFlight = null;
      });
    }
    return this.probeInFlight;
  }

  private async probeReachability(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);

    try {
      // HEAD on purpose: this app's service worker answers only the share
      // POST and passes every other request to the network, so the probe is
      // never answered out of a cache — and nothing it fetches ends up in
      // one. The timestamp is for the transparent proxies that hotel
      // networks run and that ignore `no-store`.
      const response = await fetch(this.reachabilityUrl(), {
        method: 'HEAD',
        cache: 'no-store',
        // A portal answers with a redirect to its own sign-in page; following
        // it would look like a healthy 200 from somewhere else.
        redirect: 'manual',
        signal: controller.signal,
      });
      // Any real answer proves the request crossed the network, so the status
      // is deliberately not checked — a deploy without the probe target would
      // otherwise pin the app offline on its 404s.
      const reachable = response.type !== 'opaqueredirect';
      this.setOnline(reachable);
      if (!reachable) {
        this.scheduleReachabilityRetry();
      }
      return reachable;
    } catch {
      // Refused, aborted on the timeout, or swallowed: the case this exists for.
      this.setOnline(false);
      this.scheduleReachabilityRetry();
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private reachabilityUrl(): string {
    return new URL(`favicon.ico?_probe=${Date.now()}`, document.baseURI).toString();
  }

  private setOnline(online: boolean): void {
    this._isOnline.set(online);
    if (online) {
      this.cancelReachabilityRetry();
    }
  }

  private scheduleReachabilityRetry(): void {
    if (this.retryTimer) return;

    this.retryDelayMs = this.retryDelayMs
      ? Math.min(this.retryDelayMs * 2, REACHABILITY_RETRY_MAX_MS)
      : REACHABILITY_RETRY_MIN_MS;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.refreshOnlineStatus();
    }, this.retryDelayMs);
  }

  private cancelReachabilityRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryDelayMs = 0;
  }

  /**
   * Show the install prompt the browser handed over, if it handed one over.
   *
   * Never rejects. An event prompts once (a second `prompt()` on it is
   * refused), so it is let go before prompting; the browser sends a new
   * `beforeinstallprompt` when it is willing to ask again.
   */
  async promptInstall(): Promise<void> {
    const event = this._installPrompt();
    if (!event) return;
    this._installPrompt.set(null);
    try {
      // Called before any await: prompt() needs the click's user activation.
      await event.prompt();
    } catch (error) {
      console.warn('[PWA] The install prompt was refused:', error);
    }
  }
}
