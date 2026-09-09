import { Injectable, signal, computed } from '@angular/core';

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

/**
 * Reachability, platform detection and the service worker's messages.
 *
 * Confirms the connection actually carries traffic (not just that the OS
 * reports an interface), detects standalone/iOS so callers can adapt their
 * UI, registers background sync for the offline queue, and relays the
 * message types the service worker posts back to the running app.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  // Signals for PWA state
  private _isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private _isStandalone = signal<boolean>(false);
  private _isIOS = signal<boolean>(false);

  // Reachability probe state
  private probeInFlight: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 0;

  // Public computed signals
  isOnline = computed(() => this._isOnline());
  isStandalone = computed(() => this._isStandalone());
  isIOS = computed(() => this._isIOS());

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
    // the camera capture reads it. Nothing reads an install state, and no
    // listener claims beforeinstallprompt — the browser's own install
    // prompt is left to the browser.
    window.addEventListener('appinstalled', () => {
      this._isStandalone.set(true);
    });

    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleServiceWorkerMessage(event.data);
      });
    }
  }

  private handleServiceWorkerMessage(data: { type: string; payload?: unknown }): void {
    switch (data.type) {
      case 'SYNC_OFFLINE_QUEUE':
        // Trigger offline queue sync (will be handled by offline-queue service)
        window.dispatchEvent(new CustomEvent('sync-offline-queue'));
        break;
    }
  }

  private checkStandaloneMode(): boolean {
    // Check various ways an app might be in standalone mode
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  private checkIsIOS(): boolean {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;
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
      // HEAD on purpose: both this app's service worker and ngsw only handle
      // GET, so the probe is never answered out of a cache — and nothing it
      // fetches ends up in one. The timestamp is for the transparent proxies
      // that hotel networks run and that ignore `no-store`.
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
   * Register for background sync (for offline queue)
   */
  async registerBackgroundSync(tag: string): Promise<boolean> {
    if (!('serviceWorker' in navigator) || !('sync' in ServiceWorkerRegistration.prototype)) {
      console.warn('[PWA] Background sync not supported');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(tag);
      console.log('[PWA] Background sync registered:', tag);
      return true;
    } catch (error) {
      console.error('[PWA] Background sync registration failed:', error);
      return false;
    }
  }
}
