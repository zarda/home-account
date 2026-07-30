import {
  computed,
  DestroyRef,
  EnvironmentInjector,
  effect,
  inject,
  Injectable,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { filter } from 'rxjs/operators';
import { usageAnalyticsEnabled } from '../../models';
import {
  AnalyticsEventName,
  AnalyticsEventParams,
  validateAnalyticsParams,
} from '../config/analytics-events';
import { AuthService } from './auth.service';
import { currentScreenView } from './analytics-screen-view';
import {
  AnalyticsTransport,
  NativeAnalyticsTransport,
  WebAnalyticsTransport,
} from './analytics-transport';

/**
 * The one place analytics events are sent from.
 *
 * Feature code depends on this service and never on the SDK, so every reason
 * not to send — no measurement id, consent off, an unsupported browser, a
 * platform without the plugin — lives in this file. Nothing here ever throws:
 * usage statistics are never a precondition for anything the user asked for.
 *
 * Consent is the account's stored preference, and collection follows it
 * without a reload because the preference is a signal.
 *
 * See docs/analytics.md for the taxonomy and the privacy boundary.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  /**
   * Optional so the service can be constructed in any TestBed without wiring
   * Firebase. AuthService hard-injects Auth and Firestore; a required
   * dependency here would drag those into the many component specs that
   * indirectly reach this service. Absent reads as "no account", which is off.
   */
  private auth = inject(AuthService, { optional: true });
  private router = inject(Router, { optional: true });
  private injector = inject(EnvironmentInjector);
  private destroyRef = inject(DestroyRef);

  private transport: AnalyticsTransport | null = null;
  private screenTrackingStarted = false;
  private lastScreenName: string | null = null;

  /**
   * Guards the async consent lifecycle.
   *
   * Applying consent suspends on real work — isSupported(), the dynamic plugin
   * import — and the toggle can flip while it is suspended. Two mechanisms
   * cover that. The chain serialises the operations so they cannot interleave,
   * and the generation is captured when the preference changes rather than
   * when the work starts, so an enable that was already superseded while it
   * sat in the queue is dropped instead of arming analytics after the fact.
   */
  private consentGeneration = 0;
  private consentChain: Promise<void> = Promise.resolve();

  /**
   * Whether collection is on for the signed-in account.
   *
   * Free tier: always on. Premium: the stored preference. No account: off, so
   * the window between boot and the user document arriving is silent by
   * construction rather than by timing.
   */
  readonly collectionEnabled = computed(() =>
    usageAnalyticsEnabled(this.auth?.currentUser?.())
  );

  constructor() {
    // Reacts to the toggle, to a sign-out, and to a change made on another
    // device, all through one signal. Mirrors the preference-sync effect in
    // AuthService.
    effect(() => {
      const granted = this.collectionEnabled();
      // Native collection persists across launches, so pushing before the auth
      // state settles would either restart the session for a consenting user
      // or briefly contradict the stored preference.
      //
      // Both signals are read through optional calls. This service is
      // constructed by any component that tags anything, and the component
      // specs across the app stub AuthService with only the members they
      // themselves need — a hard call here turns every one of them red for a
      // service they never asked about. An absent signal reads as "settled,
      // signed out", which is off.
      if (this.auth?.isLoading?.()) {
        return;
      }
      const generation = ++this.consentGeneration;
      this.consentChain = this.consentChain.then(() => this.applyConsent(granted, generation));
    });
  }

  /**
   * A transaction was created by a user action.
   *
   * The usage flags are booleans and the count a number here, enumerated
   * strings in the taxonomy — same trade-off as trackTransactionSearch: the
   * validator coerces, and in exchange a new taxonomy param no longer breaks
   * this signature at compile time (the validator drops the event loudly
   * instead).
   */
  trackTransactionAdd(params: {
    method: AnalyticsEventParams<'transaction_add'>['method'];
    type: AnalyticsEventParams<'transaction_add'>['type'];
    has_tags: boolean;
    has_location: boolean;
    receipt_image_count: number;
  }): void {
    this.send('transaction_add', params);
  }

  /**
   * A search was committed on the transaction list.
   *
   * has_filters is a boolean here and an enumerated 'true'/'false' in the
   * taxonomy: GA4 has no boolean parameter type, and making every call site
   * stringify by hand is how one of them ends up sending 'yes'. The validator
   * does the coercion.
   */
  trackTransactionSearch(params: { has_filters: boolean }): void {
    this.send('transaction_search', params);
  }

  /** A receipt or file import reached a terminal outcome. */
  trackReceiptImport(params: AnalyticsEventParams<'receipt_import'>): void {
    this.send('receipt_import', params);
  }

  /** A budget was created. */
  trackBudgetCreate(): void {
    this.send('budget_create', {});
  }

  /** The dashboard budget-alert banner became visible. */
  trackBudgetExceededViewed(params: AnalyticsEventParams<'budget_exceeded_viewed'>): void {
    this.send('budget_exceeded_viewed', params);
  }

  /** A report tab was shown. */
  trackReportView(params: AnalyticsEventParams<'report_view'>): void {
    this.send('report_view', params);
  }

  /** An AI-assisted feature actually called a provider. */
  trackAiAssistUsed(params: AnalyticsEventParams<'ai_assist_used'>): void {
    this.send('ai_assist_used', params);
  }

  /** A preference was changed from settings. */
  trackSettingsChange(params: AnalyticsEventParams<'settings_change'>): void {
    this.send('settings_change', params);
  }

  /**
   * The one path to the transport.
   *
   * Typed wrappers rather than a public generic log() so the compiler rejects
   * an unknown event or an off-taxonomy value at the call site, and so the
   * registry check can read an event name it can trust. The runtime validation
   * below is not redundant with those types: call sites compute these values
   * from signals and conditionals, and types are gone by the time they do.
   */
  protected send(name: AnalyticsEventName, params: Record<string, unknown>): void {
    if (!this.collectionEnabled()) {
      return;
    }

    const validated = validateAnalyticsParams(name, params);
    if (!validated) {
      // Dropped whole rather than trimmed: a value nobody enumerated suggests
      // the call site is passing something derived from user data, and sending
      // the event without it would bury that. The value itself is not logged,
      // for the same reason it is not sent.
      console.warn(`[Analytics] Dropped ${name}: parameters outside the taxonomy`);
      return;
    }

    void this.resolveTransport()
      .logEvent(name, validated)
      .catch(error => this.swallow(error));
  }

  private async applyConsent(granted: boolean, generation: number): Promise<void> {
    // Superseded while queued. Turning collection on for a preference the
    // account has already moved off is worse than being a beat late, so the
    // stale enable is dropped rather than applied and corrected.
    if (generation !== this.consentGeneration) {
      return;
    }

    try {
      if (granted) {
        await this.resolveTransport().setEnabled(true);
        if (generation !== this.consentGeneration) {
          return;
        }
        this.startScreenTracking();
      } else {
        this.stopScreenTracking();
        await this.resolveTransport().setEnabled(false);
      }
    } catch (error) {
      this.swallow(error);
    }
  }

  /**
   * Screen views are reported from the router rather than by the SDK.
   *
   * The subscription is primed with the screen already on display: a session
   * where the user opts in and then closes the app would otherwise report
   * nothing at all, and with the app lock on the first rendered screen is
   * /lock, which no later navigation revisits. currentScreenView() returns
   * null while nothing is activated, which is what keeps the prime from
   * emitting a phantom '/' screen.
   */
  private startScreenTracking(): void {
    if (this.screenTrackingStarted || !this.router) {
      return;
    }
    this.screenTrackingStarted = true;

    this.reportScreen();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.reportScreen());
  }

  private stopScreenTracking(): void {
    this.screenTrackingStarted = false;
    this.lastScreenName = null;
  }

  private reportScreen(): void {
    if (!this.router || !this.collectionEnabled()) {
      return;
    }
    const screen = currentScreenView(this.router);
    // A navigation that lands on the same route — a query-parameter change,
    // say — is not a new screen.
    if (!screen || screen.screenName === this.lastScreenName) {
      return;
    }
    this.lastScreenName = screen.screenName;
    void this.resolveTransport()
      .logScreenView(screen)
      .catch(error => this.swallow(error));
  }

  private resolveTransport(): AnalyticsTransport {
    this.transport ??= this.createTransport();
    return this.transport;
  }

  /**
   * SDK seam, so a spec can substitute a fake without a Firebase app. The same
   * pattern RemoteConfigService uses for its SDK calls.
   *
   * The installed app must not reach the web data stream: a gtag hit from
   * inside the WKWebView is attributed to the web stream, while the iOS stream
   * is identified by the plist's GOOGLE_APP_ID and fed by the native SDK. The
   * branch here is backed up structurally by provideAppAnalytics(), which
   * withholds the Analytics token entirely on Capacitor.
   */
  protected createTransport(): AnalyticsTransport {
    return Capacitor.isNativePlatform()
      ? new NativeAnalyticsTransport()
      : new WebAnalyticsTransport(this.injector);
  }

  private swallow(error: unknown): void {
    // A blocked script, a rejected plugin call or an offline start must not
    // surface anywhere. Same rule as the security audit log.
    console.warn('[Analytics] Could not apply usage statistics:', error);
  }
}
