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
    // Online/offline status
    window.addEventListener('online', () => this._isOnline.set(true));
    window.addEventListener('offline', () => this._isOnline.set(false));

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
