import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, provideAppInitializer, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth, initializeAuth, browserLocalPersistence, getAuth } from '@angular/fire/auth';
import {
  provideFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  FirestoreSettings,
  PersistentTabManager,
} from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { provideHttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { TranslationService } from './core/services/translation.service';
import { ThemeService } from './core/services/theme.service';
import { OfflineQueueProcessorService } from './core/services/offline-queue-processor.service';

/**
 * Tab manager for the Firestore local cache. Multi-tab so the IndexedDB
 * cache is shared when the app is open in more than one tab, instead of the
 * second tab failing with failed-precondition errors.
 *
 * Exported as its own seam because this choice is otherwise unobservable:
 * the cache object built by persistentLocalCache() reports kind
 * 'persistent' for BOTH tab managers and keeps the difference in private
 * fields, so a test can only assert the multi-tab criterion here, on the
 * manager's public `kind` discriminant (app.config.spec.ts).
 */
export function firestoreCacheTabManager(): PersistentTabManager {
  return persistentMultipleTabManager();
}

/**
 * Firestore settings with an on-disk (IndexedDB) local cache so previously
 * loaded documents (transactions, budgets, categories) are still served to
 * onSnapshot listeners while offline. If IndexedDB is unavailable the SDK
 * logs a warning and falls back to the in-memory cache (the previous
 * behaviour).
 *
 * Note: this SDK-level cache also queues offline Firestore *writes* and
 * replays them itself; it does not overlap with OfflineQueueService, which
 * only replays items explicitly queued before they reach Firestore.
 *
 * Exported so the cache wiring can be unit-tested (app.config.spec.ts).
 */
export function firestorePersistentCacheSettings(): FirestoreSettings {
  return {
    localCache: persistentLocalCache({ tabManager: firestoreCacheTabManager() }),
  };
}

/**
 * Factory behind provideFirestore. Offline reads depend on going through
 * initializeFirestore with the persistent-cache settings — a plain
 * getFirestore() would silently drop the cache. The collaborators are
 * default parameters so the spec can assert that wiring with fakes: booting
 * a real Firestore instance inside the Karma suite leaves background work
 * that stalls the browser teardown.
 */
export function appFirestoreFactory(
  initialize: typeof initializeFirestore = initializeFirestore,
  app: typeof getApp = getApp,
): ReturnType<typeof initializeFirestore> {
  return initialize(app(), firestorePersistentCacheSettings());
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimations(),
    provideNativeDateAdapter(),
    provideHttpClient(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      if (Capacitor.isNativePlatform()) {
        // Use browserLocalPersistence for Capacitor to avoid IndexedDB issues
        // with the capacitor:// scheme that cause onAuthStateChanged to hang
        return initializeAuth(getApp(), {
          persistence: browserLocalPersistence,
        });
      }
      // Use default (IndexedDB) persistence for web
      return getAuth();
    }),
    provideFirestore(() => appFirestoreFactory()),
    provideStorage(() => getStorage()),
    provideCharts(withDefaultRegisterables()),
    {
      // One dialog sizing default: a comfortable width that always leaves
      // a 16px gutter, so a fixed width like 400/500px can never overflow a
      // 360px phone. Per-open width overrides this but keeps the maxWidth.
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: {
        width: 'min(480px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        autoFocus: 'first-tabbable',
        restoreFocus: true,
      },
    },
    provideAppInitializer(() => inject(TranslationService).init()),
    provideAppInitializer(() => {
      // Initialize theme service (will apply saved theme once user preferences load)
      inject(ThemeService);
    }),
    provideAppInitializer(() => {
      // Attach the offline-queue processing listeners at startup so queued
      // images/transactions are handled as soon as connectivity returns.
      inject(OfflineQueueProcessorService);
    })
  ]
};
