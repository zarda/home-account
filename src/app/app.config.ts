import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, provideAppInitializer, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { initializeAuth, browserLocalPersistence, getAuth } from 'firebase/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { provideHttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { TranslationService } from './core/services/translation.service';
import { ThemeService } from './core/services/theme.service';

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
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
    provideCharts(withDefaultRegisterables()),
    provideAppInitializer(() => inject(TranslationService).init()),
    provideAppInitializer(() => {
      // Initialize theme service (will apply saved theme once user preferences load)
      inject(ThemeService);
    })
  ]
};
