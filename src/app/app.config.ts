import { ApplicationConfig, EnvironmentProviders, ErrorHandler, LOCALE_ID, makeEnvironmentProviders, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, provideAppInitializer, inject } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeJa from '@angular/common/locales/ja';
import localeZhHant from '@angular/common/locales/zh-Hant';
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
import { provideRemoteConfig, getRemoteConfig } from '@angular/fire/remote-config';
import { provideAnalytics, initializeAnalytics, setConsent } from '@angular/fire/analytics';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { Directionality } from '@angular/cdk/bidi';
import { provideAppCharts } from './core/config/chart.config';
import { provideHttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { TranslationService } from './core/services/translation.service';
import { ThemeService } from './core/services/theme.service';
import { AccessibilityService } from './core/services/accessibility.service';
import { AppDirectionality } from './core/services/app-directionality';
import { OfflineQueueProcessorService } from './core/services/offline-queue-processor.service';
import { AppLockService } from './core/services/app-lock.service';
import { ShareIntakeService } from './core/services/share-intake.service';
import { AnalyticsService } from './core/services/analytics.service';
import { GlobalErrorHandler } from './core/services/global-error-handler';
import {
  ANALYTICS_CONSENT_DEFAULTS,
  ANALYTICS_GTAG_CONFIG,
  analyticsIsConfigured,
} from './core/config/analytics.config';

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

/**
 * Factory behind provideAnalytics.
 *
 * initializeAnalytics rather than getAnalytics: the gtag `config` command that
 * instance creation issues is the only opportunity to pass send_page_view and
 * the advertising flags, and getAnalytics() accepts no options. By the time a
 * later call could switch anything off, the first page_view has already gone
 * out.
 *
 * setConsent runs first on purpose. Called before an Analytics instance
 * exists, the SDK replays it as gtag('consent','default',…) ahead of the
 * config command; called afterwards it is only a consent *update*, arriving
 * behind the first hit. The config object is spread because the SDK writes its
 * own keys into whatever it is handed.
 *
 * Nothing calls this at bootstrap. provideAnalytics runs its factory the first
 * time the Analytics token is injected, and the only injector of that token is
 * the analytics transport, which waits for the stored opt-in. The
 * collaborators are default parameters so app.config.spec.ts can assert the
 * ordering and the config without a live Firebase app — creating a real
 * instance loads gtag and starts network traffic, which is exactly what the
 * consent gate exists to prevent.
 */
export function appAnalyticsFactory(
  initialize: typeof initializeAnalytics = initializeAnalytics,
  consent: typeof setConsent = setConsent,
  app: typeof getApp = getApp,
): ReturnType<typeof initializeAnalytics> {
  consent(ANALYTICS_CONSENT_DEFAULTS);
  return initialize(app(), { config: { ...ANALYTICS_GTAG_CONFIG } });
}

/**
 * Analytics providers, or none at all.
 *
 * On Capacitor the WKWebView runs this same bundle, but the installed app must
 * not reach the web data stream: a gtag hit from inside the app is attributed
 * to the web stream, while the iOS stream is identified by the plist's
 * GOOGLE_APP_ID and fed by the native measurement SDK. Withholding the token
 * makes that structural instead of conventional — the transport's
 * injector.get(Analytics, null) comes back null and the native path is the
 * only one left.
 *
 * A build with no real measurement id (the committed templates, the CI stubs)
 * gets the same treatment, so a placeholder build boots normally and stays
 * silent.
 */
export function provideAppAnalytics(
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
  isConfigured: () => boolean = analyticsIsConfigured,
): EnvironmentProviders {
  if (isNative() || !isConfigured()) {
    return makeEnvironmentProviders([]);
  }
  return provideAnalytics(() => appAnalyticsFactory());
}

/**
 * Locale data for the two non-English languages. Angular ships only `en` in
 * the bundle; without these, anything reading LOCALE_ID for `ja` or
 * `zh-Hant` throws "Missing locale data" at runtime rather than degrading.
 *
 * Registered at module scope so it has happened before the first injector is
 * built and before LOCALE_ID's factory can be asked for a value.
 */
registerLocaleData(localeJa);
registerLocaleData(localeZhHant);

/**
 * The locale Angular's own machinery uses — the Material datepicker through
 * provideNativeDateAdapter, and any built-in pipe added later. Resolved once
 * at bootstrap, which is exactly why it cannot be the whole answer: user-
 * facing dates and numbers go through LocaleDatePipe/LocaleNumberPipe, which
 * follow the locale signal and so survive a language switch without a
 * reload. This provider is what keeps everything else correct on first
 * paint instead of silently en-US. See docs/locale-formatting.md.
 */
export function appLocaleIdFactory(
  translation: TranslationService = inject(TranslationService),
): string {
  return translation.getIntlLocale();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Reports errors nothing else caught (unhandled rejections, template
    // throws) instead of losing them; see GlobalErrorHandler.
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
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
    // Remote-tunable app parameters (e.g. receipt image limits). Fetch
    // policy, in-app defaults, and typed accessors live in
    // RemoteConfigService — see docs/remote-config.md.
    provideRemoteConfig(() => getRemoteConfig()),
    // Usage statistics, opt-in and lazy: the Analytics token is not resolved —
    // no gtag, no cookie, no request — until AnalyticsService reads the
    // account's stored preference and finds it switched on. See
    // docs/analytics.md.
    provideAppAnalytics(),
    provideAppCharts(),
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
    { provide: LOCALE_ID, useFactory: appLocaleIdFactory },
    // Everything in Material and the CDK asks for Directionality; handing them
    // the app's own instance is what lets a locale switch reach components
    // that were already built (see AppDirectionality).
    { provide: Directionality, useExisting: AppDirectionality },
    provideAppInitializer(() => inject(TranslationService).init()),
    provideAppInitializer(() => {
      // Initialize theme service (will apply saved theme once user preferences load)
      inject(ThemeService);
    }),
    provideAppInitializer(() => {
      // Construct the accessibility service so the font-scale variable and
      // high-contrast/reduced-motion classes are on the document root before
      // first paint (will apply saved preferences once user data loads).
      inject(AccessibilityService);
    }),
    provideAppInitializer(() => {
      // Attach the offline-queue processing listeners at startup so queued
      // images/transactions are handled as soon as connectivity returns.
      inject(OfflineQueueProcessorService);
    }),
    provideAppInitializer(() => {
      // Register the share-target worker (web) or the App Group watcher
      // (iOS) so files shared from other apps reach the import wizard.
      void inject(ShareIntakeService).init();
    }),
    provideAppInitializer(() => {
      // Construct the lock service before the first guarded navigation so a
      // cold start cannot slip past the lock while it is still initializing.
      inject(AppLockService).init();
    }),
    provideAppInitializer(() => {
      // Construct the service at startup so screen views follow the stored
      // preference even on a session where no feature code tags anything.
      // Nothing else injects it, and a cold start deep-linked to a page that
      // happens not to reach it would otherwise report nothing at all.
      // Construction alone contacts nothing.
      inject(AnalyticsService);
    })
  ]
};
