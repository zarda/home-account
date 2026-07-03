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
} from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { provideHttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { TranslationService } from './core/services/translation.service';
import { ThemeService } from './core/services/theme.service';
import { OfflineQueueProcessorService } from './core/services/offline-queue-processor.service';

/**
 * Firestore settings with an on-disk (IndexedDB) local cache so previously
 * loaded documents (transactions, budgets, categories) are still served to
 * onSnapshot listeners while offline. persistentMultipleTabManager shares
 * the cache across tabs instead of throwing failed-precondition errors when
 * the app is open in more than one tab. If IndexedDB is unavailable the SDK
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
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  };
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
    provideFirestore(() => initializeFirestore(getApp(), firestorePersistentCacheSettings())),
    provideStorage(() => getStorage()),
    provideCharts(withDefaultRegisterables()),
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
