import { ApplicationConfig, EnvironmentProviders, ErrorHandler, Injector, LOCALE_ID, effect, makeEnvironmentProviders, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, provideAppInitializer, inject, untracked } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeJa from '@angular/common/locales/ja';
import localeZhHant from '@angular/common/locales/zh-Hant';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import {
  Auth,
  provideAuth,
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
  connectAuthEmulator,
} from '@angular/fire/auth';
import {
  provideFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  FirestoreSettings,
  PersistentTabManager,
} from '@angular/fire/firestore';
import { FirebaseStorage, provideStorage, getStorage, connectStorageEmulator } from '@angular/fire/storage';
import { provideRemoteConfig, getRemoteConfig } from '@angular/fire/remote-config';
import { provideAnalytics, initializeAnalytics, setConsent } from '@angular/fire/analytics';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { Directionality } from '@angular/cdk/bidi';
import { provideAppCharts } from './core/config/chart.config';
import { provideHttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { EMULATOR_HOSTS, type EmulatorHosts } from '../environments/emulators';
import { TranslationService } from './core/services/translation.service';
import { ThemeService } from './core/services/theme.service';
import { AccessibilityService } from './core/services/accessibility.service';
import { AppDirectionality } from './core/services/app-directionality';
import { OfflineQueueProcessorService } from './core/services/offline-queue-processor.service';
import { AppLockService } from './core/services/app-lock.service';
import { ReminderService } from './core/services/reminder.service';
import { WidgetSnapshotService } from './core/services/widget-snapshot.service';
import { ShareIntakeService } from './core/services/share-intake.service';
import { AnalyticsService } from './core/services/analytics.service';
import { AuthService } from './core/services/auth.service';
import { PwaService } from './core/services/pwa.service';
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
 *
 * With emulator hosts (the `emulators` build only) the instance is connected
 * before anything can use it: the SDK refuses a connect after the first read
 * or write.
 */
export function appFirestoreFactory(
  initialize: typeof initializeFirestore = initializeFirestore,
  app: typeof getApp = getApp,
  hosts: EmulatorHosts | null = EMULATOR_HOSTS,
  connect: typeof connectFirestoreEmulator = connectFirestoreEmulator,
): ReturnType<typeof initializeFirestore> {
  const firestore = initialize(app(), firestorePersistentCacheSettings());
  if (hosts) {
    connect(firestore, hosts.firestore.host, hosts.firestore.port);
  }
  return firestore;
}

/**
 * Factory behind provideAuth. Both platforms keep the session in local
 * storage, as the device always has.
 *
 * Capacitor gets local storage alone: IndexedDB under the capacitor:// scheme
 * leaves onAuthStateChanged hanging.
 *
 * The web prefers it to getAuth()'s first choice, IndexedDB, for timing.
 * Another tab's sign-in or sign-out reaches this one by a storage event, the
 * same channel Firestore's multi-tab cache uses to report the refusals that
 * change causes, so the page hears it is leaving the account ahead of them.
 * IndexedDB raises no event and is polled every 800 ms, so the refusals used
 * to land first, on a page still showing the departing account (ADR 0163).
 * A phone's browser is the exception: there the SDK polls local storage
 * instead, once a second, because a backgrounded tab can miss the events, so
 * a phone's tab can still hear another tab's change after the refusals it
 * causes.
 * IndexedDB stays second in the list because the SDK looks there for a
 * session to carry across: one it finds is written to local storage and its
 * IndexedDB key removed, so the first load after the switch keeps whoever was
 * signed in. A tab still running the previous bundle watches IndexedDB, hears
 * that key go at its next poll, and shows nobody signed in until it reloads.
 * The popup resolver getAuth() would add is passed by hand, since
 * initializeAuth adds none.
 *
 * With emulator hosts the connect runs straight after the instance exists,
 * before a restored session's token refresh can go to the live Auth service;
 * the SDK refuses a connect once the instance has been used. The
 * collaborators are default parameters for app.config.spec.ts, as
 * appFirestoreFactory's are; app.config.smoke.spec.ts shows the session
 * carried across and another tab's sign-out heard.
 */
export function appAuthFactory(
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
  initialize: typeof initializeAuth = initializeAuth,
  app: typeof getApp = getApp,
  hosts: EmulatorHosts | null = EMULATOR_HOSTS,
  connect: typeof connectAuthEmulator = connectAuthEmulator,
): Auth {
  const auth = isNative()
    ? initialize(app(), { persistence: browserLocalPersistence })
    : initialize(app(), {
        persistence: [browserLocalPersistence, indexedDBLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
  if (hosts) {
    connect(auth, hosts.auth.url, { disableWarnings: true });
  }
  return auth;
}

/**
 * Factory behind provideStorage. With emulator hosts the instance is connected
 * before any upload or download can use it. The collaborators are default
 * parameters for app.config.spec.ts, as appFirestoreFactory's are.
 */
export function appStorageFactory(
  get: typeof getStorage = getStorage,
  app: typeof getApp = getApp,
  hosts: EmulatorHosts | null = EMULATOR_HOSTS,
  connect: typeof connectStorageEmulator = connectStorageEmulator,
): FirebaseStorage {
  const storage = get(app());
  if (hosts) {
    connect(storage, hosts.storage.host, hosts.storage.port);
  }
  return storage;
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
 * Remote Config providers, or none at all.
 *
 * Remote Config has no emulator. With emulator hosts (the `emulators` build
 * only) a fetch would send that build's demo API key to the live Installations
 * and Remote Config endpoints, which refuse it on every start. Withholding the
 * token keeps that off every path, not only RemoteConfigService's: its
 * optional inject comes back null and the in-app defaults stay in effect.
 */
export function provideAppRemoteConfig(
  hosts: EmulatorHosts | null = EMULATOR_HOSTS,
): EnvironmentProviders {
  if (hosts) {
    return makeEnvironmentProviders([]);
  }
  return provideRemoteConfig(() => getRemoteConfig());
}

/**
 * The household ledger's sweep, as the arming below sees it: LedgerShareService
 * (core/services/ledger-share.service.ts) by shape, so nothing in this file
 * names the service's module outside a dynamic import.
 */
export interface LedgerSweeper {
  reconcileAll(reason: 'start' | 'reconnect'): Promise<void>;
}

/** What the arming reads and calls; ledgerSweepHooks gives the app's. */
export interface LedgerSweepHooks {
  /** The signed-in account, or null: read as a signal, so the arming follows it. */
  userId: () => string | null;
  /** Read as a signal, so the arming hears the device come back online. */
  isOnline: () => boolean;
  /** Runs a task once the browser has nothing more pressing to do. */
  whenIdle: (task: () => void) => void;
  /** The sweep, reached through the only reference to its module: a dynamic import. */
  load: () => Promise<LedgerSweeper>;
}

/** The longest an idle callback may wait before it runs anyway. */
export const LEDGER_SWEEP_IDLE_TIMEOUT_MS = 10_000;

/** Where there is no idle callback (Safari, the iOS web view): a delay past the first paint instead. */
export const LEDGER_SWEEP_IDLE_FALLBACK_MS = 3_000;

const LEDGER_SWEEP_LOG = '[LedgerShareService]';

/** The scheduling a whenBrowserIdle host offers: an idle callback where the browser has one. */
export interface IdleHost {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => unknown;
  setTimeout: (callback: () => void, ms: number) => unknown;
}

/** Runs `task` once the browser is idle, or after a fixed delay where it cannot say. */
export function whenBrowserIdle(task: () => void, host: IdleHost = globalThis as unknown as IdleHost): void {
  if (typeof host.requestIdleCallback === 'function') {
    host.requestIdleCallback(() => task(), { timeout: LEDGER_SWEEP_IDLE_TIMEOUT_MS });
  } else {
    host.setTimeout(() => task(), LEDGER_SWEEP_IDLE_FALLBACK_MS);
  }
}

/**
 * The app's collaborators for armLedgerSweep. `load` is the one place the
 * sweep's module is named, and only as a dynamic import: the service, and the
 * journal and projection code only it uses, stay in a lazy chunk (the initial
 * bundle sits at its budget, docs/performance.md).
 */
export function ledgerSweepHooks(injector: Injector = inject(Injector)): LedgerSweepHooks {
  const auth = injector.get(AuthService);
  const pwa = injector.get(PwaService);
  return {
    userId: () => auth.userId(),
    isOnline: () => pwa.isOnline(),
    whenIdle: task => whenBrowserIdle(task),
    load: () => import('./core/services/ledger-share.service')
      .then(({ LedgerShareService }) => injector.get(LedgerShareService)),
  };
}

/**
 * Arms the household ledger's sweep (LedgerShareService.reconcileAll), which
 * repairs any shared row's copy a follow-up left behind: once per account in
 * a session when it is signed in and online ('start'), and again each time
 * the device comes back online ('reconnect'). Each run waits for the browser
 * to be idle, and only then loads the service. A signed-out account arms
 * nothing. Nothing here throws, and a sweep that fails to load or run is
 * logged, never handed to the ErrorHandler: the sweep is maintenance, and
 * the next one starts over.
 */
export function armLedgerSweep(
  hooks: LedgerSweepHooks = ledgerSweepHooks(),
  injector: Injector = inject(Injector),
): void {
  const started = new Set<string>();
  let wasOnline: boolean | null = null;
  effect(() => {
    try {
      const uid = hooks.userId();
      const online = hooks.isOnline();
      const reconnected = wasOnline === false && online;
      wasOnline = online;
      if (!uid || !online) return;
      if (!started.has(uid)) {
        started.add(uid);
        untracked(() => scheduleLedgerSweep(hooks, uid, 'start'));
      } else if (reconnected) {
        untracked(() => scheduleLedgerSweep(hooks, uid, 'reconnect'));
      }
    } catch (error) {
      console.warn(`${LEDGER_SWEEP_LOG} The sweep was not armed`, error);
    }
  }, { injector });
}

function scheduleLedgerSweep(hooks: LedgerSweepHooks, uid: string, reason: 'start' | 'reconnect'): void {
  hooks.whenIdle(() => {
    try {
      // The account or the connection may have changed while the task waited.
      if (hooks.userId() !== uid || !hooks.isOnline()) return;
      hooks.load()
        .then(sweeper => sweeper.reconcileAll(reason))
        .catch(error => console.warn(`${LEDGER_SWEEP_LOG} The sweep did not run`, error));
    } catch (error) {
      console.warn(`${LEDGER_SWEEP_LOG} The sweep did not run`, error);
    }
  });
}

/**
 * NotificationTapService (core/services/notification-tap.service.ts) as the
 * arming below sees it: by shape, as the ledger sweep is, so nothing in this
 * file names the service's module outside a dynamic import.
 */
export interface NotificationTapArmer {
  arm(): Promise<void>;
}

const NOTIFICATION_TAP_LOG = '[NotificationTapService]';

/**
 * The app's loader for armNotificationTaps: the one place the service's
 * module is named, and only as a dynamic import, so it stays in a lazy chunk
 * (the initial bundle sits at its budget, docs/performance.md).
 */
export function notificationTapLoader(injector: Injector = inject(Injector)): () => Promise<NotificationTapArmer> {
  return () => import('./core/services/notification-tap.service')
    .then(({ NotificationTapService }) => injector.get(NotificationTapService));
}

/**
 * Arms NotificationTapService, which opens what a tapped reminder names in a
 * page that is already running. On the web it loads the service from an idle
 * task, and a tab that receives the worker's message before then is only
 * focused. In the iOS app it loads it at once: the plugin holds a tap that
 * started the app until the listener attaches, and attaching it seconds
 * later would open that tap over wherever the user had gone meanwhile. The
 * chunk comes from the app's own files there, so nothing is downloaded early.
 * Nothing here throws, and a service that fails to load or arm is logged,
 * never handed to the ErrorHandler: the tap still focused the app.
 */
export function armNotificationTaps(
  load: () => Promise<NotificationTapArmer> = notificationTapLoader(),
  whenIdle: (task: () => void) => void = task => whenBrowserIdle(task),
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): void {
  const notArmed = (error: unknown) => console.warn(`${NOTIFICATION_TAP_LOG} Notification taps were not armed`, error);
  const arm = () => {
    try {
      load().then(taps => taps.arm()).catch(notArmed);
    } catch (error) {
      notArmed(error);
    }
  };
  try {
    if (isNative()) arm();
    else whenIdle(arm);
  } catch (error) {
    notArmed(error);
  }
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
    // Each factory is wrapped rather than passed: a provider factory is
    // handed the injector, which would land in the first defaulted parameter.
    provideAuth(() => appAuthFactory()),
    provideFirestore(() => appFirestoreFactory()),
    provideStorage(() => appStorageFactory()),
    // Remote-tunable app parameters (e.g. receipt image limits). Fetch
    // policy, in-app defaults, and typed accessors live in
    // RemoteConfigService — see docs/remote-config.md. The emulators build
    // gets no token and keeps the defaults (provideAppRemoteConfig).
    provideAppRemoteConfig(),
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
      // Construct the reminder service at startup so the app-open sweep and
      // the visibilitychange handler exist without a page having to reach
      // them. It stays inert — no listener, no notification — until an
      // account whose preference is switched on has loaded.
      inject(ReminderService);
    }),
    provideAppInitializer(() => {
      // Construct the widget snapshot service at startup so the lock and
      // sign-out writes exist without a page having to reach them. It stays
      // inert on the web, where the plugin token is null and nothing is
      // composed or written.
      inject(WidgetSnapshotService);
    }),
    provideAppInitializer(() => {
      // Construct the service at startup so screen views follow the stored
      // preference even on a session where no feature code tags anything.
      // Nothing else injects it, and a cold start deep-linked to a page that
      // happens not to reach it would otherwise report nothing at all.
      // Construction alone contacts nothing.
      inject(AnalyticsService);
    }),
    provideAppInitializer(() => {
      // Repairs household copies a follow-up left behind, from an idle task
      // that loads the service only then (armLedgerSweep).
      armLedgerSweep();
    }),
    provideAppInitializer(() => {
      // Opens what a tapped reminder names in a page already running, from a
      // service loaded only then: after an idle task on the web, at once in
      // the iOS app (armNotificationTaps).
      armNotificationTaps();
    })
  ]
};
