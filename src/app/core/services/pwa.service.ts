import { Injectable, inject, signal, computed, ApplicationRef } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first, interval, concat } from 'rxjs';

export interface PwaInstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface CacheSize {
  total: number;
  models: number;
  static: number;
  dynamic: number;
}

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

@Injectable({ providedIn: 'root' })
export class PwaService {
  private swUpdate: SwUpdate | null = null;
  private appRef = inject(ApplicationRef);

  // Signals for PWA state
  private _isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private _isStandalone = signal<boolean>(false);
  private _isInstallable = signal<boolean>(false);
  private _updateAvailable = signal<boolean>(false);
  private _isIOS = signal<boolean>(false);
  private _cacheSize = signal<CacheSize>({ total: 0, models: 0, static: 0, dynamic: 0 });
  private _serviceWorkerReady = signal<boolean>(false);

  // Store install prompt for later use
  private deferredInstallPrompt: PwaInstallPrompt | null = null;

  // Reachability probe state
  private probeInFlight: Promise<boolean> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 0;

  // Public computed signals
  isOnline = computed(() => this._isOnline());
  isStandalone = computed(() => this._isStandalone());
  isInstallable = computed(() => this._isInstallable());
  updateAvailable = computed(() => this._updateAvailable());
  isIOS = computed(() => this._isIOS());
  cacheSize = computed(() => this._cacheSize());
  serviceWorkerReady = computed(() => this._serviceWorkerReady());

  // Computed: Show iOS install instructions
  showIOSInstallInstructions = computed(() => 
    this._isIOS() && !this._isStandalone() && !this._isInstallable()
  );

  constructor() {
    // Try to inject SwUpdate, but handle when service worker isn't available
    try {
      this.swUpdate = inject(SwUpdate);
    } catch {
      console.log('[PWA] Service worker not available');
      this.swUpdate = null;
    }

    // Initialize browser-only features
    if (typeof window !== 'undefined') {
      this._isStandalone.set(this.checkStandaloneMode());
      this._isIOS.set(this.checkIsIOS());
      this.initializeListeners();
      this.checkForUpdates();
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

    // PWA install prompt (Chrome, Edge, etc.)
    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.deferredInstallPrompt = event as unknown as PwaInstallPrompt;
      this._isInstallable.set(true);
      console.log('[PWA] Install prompt available');
    });

    // App installed
    window.addEventListener('appinstalled', () => {
      this._isInstallable.set(false);
      this._isStandalone.set(true);
      this.deferredInstallPrompt = null;
      console.log('[PWA] App was installed');
    });

    // Service worker updates
    if (this.swUpdate?.isEnabled) {
      this._serviceWorkerReady.set(true);

      // Check for version updates
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          this._updateAvailable.set(true);
          console.log('[PWA] New version available');
        });

      // Handle unrecoverable state
      this.swUpdate.unrecoverable.subscribe((event) => {
        console.error('[PWA] Unrecoverable state:', event.reason);
        // Optionally reload the page
        // window.location.reload();
      });
    }

    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleServiceWorkerMessage(event.data);
      });
    }
  }

  private checkForUpdates(): void {
    if (!this.swUpdate?.isEnabled) return;

    // Check for updates when the app is stable
    const appIsStable$ = this.appRef.isStable.pipe(first((isStable) => isStable));
    
    // Then check periodically (every 6 hours)
    const everySixHours$ = interval(6 * 60 * 60 * 1000);
    const checkInterval$ = concat(appIsStable$, everySixHours$);

    const swUpdate = this.swUpdate; // Capture for closure
    checkInterval$.subscribe(async () => {
      try {
        const updateFound = await swUpdate.checkForUpdate();
        console.log('[PWA] Update check:', updateFound ? 'Update available' : 'No update');
      } catch (err) {
        console.error('[PWA] Update check failed:', err);
      }
    });
  }

  private handleServiceWorkerMessage(data: { type: string; payload?: unknown }): void {
    switch (data.type) {
      case 'CACHE_SIZE':
        this._cacheSize.set(data.payload as CacheSize);
        break;

      case 'SYNC_OFFLINE_QUEUE':
        // Trigger offline queue sync (will be handled by offline-queue service)
        window.dispatchEvent(new CustomEvent('sync-offline-queue'));
        break;

      case 'CHECK_MODEL_UPDATES':
        // Trigger model update check (will be handled by model-loader service)
        window.dispatchEvent(new CustomEvent('check-model-updates'));
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
   * Trigger PWA installation prompt (non-iOS browsers)
   */
  async promptInstall(): Promise<boolean> {
    if (!this.deferredInstallPrompt) {
      console.warn('[PWA] Install prompt not available');
      return false;
    }

    try {
      await this.deferredInstallPrompt.prompt();
      const choice = await this.deferredInstallPrompt.userChoice;
      
      if (choice.outcome === 'accepted') {
        console.log('[PWA] User accepted installation');
        return true;
      } else {
        console.log('[PWA] User dismissed installation');
        return false;
      }
    } catch (error) {
      console.error('[PWA] Installation error:', error);
      return false;
    }
  }

  /**
   * Apply available update and reload
   */
  async applyUpdate(): Promise<void> {
    if (!this.swUpdate?.isEnabled) return;

    try {
      const updated = await this.swUpdate.activateUpdate();
      if (updated) {
        console.log('[PWA] Update activated, reloading...');
        window.location.reload();
      }
    } catch (error) {
      console.error('[PWA] Update activation failed:', error);
    }
  }

  /**
   * Request cache size from service worker
   */
  async getCacheSize(): Promise<CacheSize> {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      return { total: 0, models: 0, static: 0, dynamic: 0 };
    }

    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'CACHE_SIZE') {
          navigator.serviceWorker.removeEventListener('message', handler);
          resolve(event.data.payload as CacheSize);
        }
      };

      navigator.serviceWorker.addEventListener('message', handler);
      navigator.serviceWorker.controller!.postMessage({ type: 'GET_CACHE_SIZE' });

      // Timeout after 5 seconds
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(this._cacheSize());
      }, 5000);
    });
  }

  /**
   * Clear model cache
   */
  async clearModelCache(): Promise<void> {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      return;
    }

    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_MODEL_CACHE' });
    console.log('[PWA] Model cache cleared');
    
    // Refresh cache size
    await this.getCacheSize();
  }

  /**
   * Pre-cache ML models for offline use
   */
  async cacheModels(modelUrls: string[]): Promise<void> {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      console.warn('[PWA] Service worker not available for caching models');
      return;
    }

    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_MODELS',
      payload: { modelUrls }
    });
    console.log('[PWA] Model caching requested:', modelUrls);
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

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
