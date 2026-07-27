import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Analytics,
  isSupported,
  logEvent,
  setAnalyticsCollectionEnabled,
} from '@angular/fire/analytics';
import { analyticsIsConfigured, pageFields } from '../config/analytics.config';
import { ScreenView } from './analytics-screen-view';

/** Event parameters after AnalyticsService has validated them. */
export type AnalyticsParams = Record<string, string | number | boolean>;

/**
 * The platform-specific half of analytics: how an event reaches GA4.
 *
 * Everything else — the opt-in check, the taxonomy, the parameter allowlist,
 * screen naming — lives once in AnalyticsService, so feature code cannot tell
 * the two transports apart.
 */
export interface AnalyticsTransport {
  setEnabled(enabled: boolean): Promise<void>;
  logEvent(name: string, params: AnalyticsParams): Promise<void>;
  logScreenView(screen: ScreenView): Promise<void>;
}

/**
 * Web transport, backed by the Firebase JS SDK through @angular/fire.
 *
 * The Analytics token is resolved lazily and only while enabled. That is the
 * consent gate itself, not an optimisation: creating the instance injects the
 * gtag script, issues the config command, opens a dynamic-config request and
 * writes an installation id, none of which can be taken back afterwards.
 * setAnalyticsCollectionEnabled only sets window['ga-disable-<id>'], so
 * initialising first and disabling second would already have leaked a request.
 */
export class WebAnalyticsTransport implements AnalyticsTransport {
  private analytics: Analytics | null = null;
  private resolved = false;
  private supported: Promise<boolean> | null = null;

  /**
   * Mirrors the last value pushed through setEnabled. resolve() consults it on
   * every call so an enable that is still awaiting isSupported() when the user
   * switches back off cannot arm analytics as it completes. AnalyticsService
   * guards the same race with a generation counter; this is the structural
   * half of that pair, and it is what makes the transport safe to call
   * directly.
   */
  private enabled = false;

  constructor(private readonly injector: EnvironmentInjector) {}

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;

    if (!enabled) {
      // Nothing to switch off if the token was never resolved. Resolving it
      // here purely to disable it would create the very gtag load the toggle
      // exists to prevent.
      if (this.analytics) {
        const analytics = this.analytics;
        this.run(() => setAnalyticsCollectionEnabled(analytics, false));
      }
      return;
    }

    const analytics = await this.resolve();
    if (analytics && this.enabled) {
      this.run(() => setAnalyticsCollectionEnabled(analytics, true));
    }
  }

  async logEvent(name: string, params: AnalyticsParams): Promise<void> {
    const analytics = await this.resolve();
    if (!analytics || !this.enabled) {
      return;
    }
    this.run(() => logEvent(analytics, name, { ...params, ...pageFields() }));
  }

  async logScreenView(screen: ScreenView): Promise<void> {
    // firebase_screen / firebase_screen_class are what GA4 keys the web
    // Screens report off; screen_name / screen_class are what the reporting UI
    // shows. @angular/fire sends both, so this does too.
    await this.logEvent('screen_view', {
      screen_name: screen.screenName,
      screen_class: screen.screenClass,
      firebase_screen: screen.screenName,
      firebase_screen_class: screen.screenClass,
    });
  }

  /**
   * First read of the Analytics token, and the moment gtag actually loads.
   *
   * isSupported() is awaited first: in a browser without cookies or IndexedDB
   * the SDK cannot measure anything, and creating the instance anyway only
   * produces console noise.
   */
  private async resolve(): Promise<Analytics | null> {
    if (!this.enabled) {
      return null;
    }
    if (this.resolved) {
      return this.analytics;
    }
    if (!analyticsIsConfigured()) {
      this.resolved = true;
      return null;
    }

    this.supported ??= this.run(() => isSupported());
    if (!(await this.supported)) {
      this.resolved = true;
      return null;
    }
    // Re-check: the await above is exactly where a toggle-off can land.
    if (!this.enabled) {
      return null;
    }

    this.analytics = this.run(() => this.injector.get(Analytics, null));
    this.resolved = true;
    return this.analytics;
  }

  /**
   * @angular/fire's exports are zone-wrapped and warn when called outside an
   * injection context. These calls originate from a signal effect and a router
   * subscription, so the context is re-established explicitly.
   */
  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }
}

/** The subset of @capacitor-firebase/analytics this app uses. */
interface NativeAnalyticsPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
  logEvent(options: { name: string; params?: Record<string, unknown> }): Promise<void>;
  setCurrentScreen(options: {
    screenName: string | null;
    screenClassOverride?: string | null;
  }): Promise<void>;
}

/**
 * Native transport, backed by @capacitor-firebase/analytics.
 *
 * The plugin is imported dynamically so its proxy never enters the web bundle,
 * where it could not run anyway.
 *
 * There is no isSupported() equivalent and no lazy-init trick available here:
 * the measurement SDK is configured by FirebaseApp.configure() at launch, well
 * before consent can be read. Collection is therefore switched off in
 * Info.plist (FIREBASE_ANALYTICS_COLLECTION_ENABLED) and turned on at runtime
 * once the stored preference resolves.
 */
export class NativeAnalyticsTransport implements AnalyticsTransport {
  private plugin: Promise<NativeAnalyticsPlugin> | null = null;
  private enabled = false;

  /**
   * The plugin's iOS isEnabled() is unimplemented, and the native flag
   * persists in NSUserDefaults across launches and across accounts on the same
   * device, so the value in force at startup is unknowable. The service pushes
   * the resolved preference once, after auth settles, rather than pushing a
   * speculative false at boot and restarting the measurement session for every
   * consenting user.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled && this.plugin) {
      return;
    }
    this.enabled = enabled;
    const plugin = await this.load();
    await plugin.setEnabled({ enabled });
  }

  async logEvent(name: string, params: AnalyticsParams): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const plugin = await this.load();
    await plugin.logEvent({ name, params: { ...params } });
  }

  async logScreenView(screen: ScreenView): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const plugin = await this.load();
    // setCurrentScreen is the plugin's screen_view: it logs the reserved event
    // with screen_name and screen_class. The web transport adds the
    // firebase_-prefixed aliases on top, which gtag maps; the native SDK
    // reserves that prefix and drops parameters using it, so the two
    // transports diverge exactly here and nowhere else.
    await plugin.setCurrentScreen({
      screenName: screen.screenName,
      screenClassOverride: screen.screenClass,
    });
  }

  private load(): Promise<NativeAnalyticsPlugin> {
    this.plugin ??= import('@capacitor-firebase/analytics').then(
      m => m.FirebaseAnalytics as unknown as NativeAnalyticsPlugin
    );
    return this.plugin;
  }
}
