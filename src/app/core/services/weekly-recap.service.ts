import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { fnv1a32 } from '../utils/transaction-aggregation.utils';
import {
  RecapFigures,
  buildRecapContext,
  composeRecapFigures,
  hasSomethingToSay,
  readDismissedRecapWeek,
  recapKey,
  recapWindow,
  weekBeforeWindow,
  weeklyRecapStorageKeys,
  writeDismissedRecapWeek,
} from '../utils/weekly-recap.utils';
import {
  Transaction,
  User,
  baseCurrencyOf,
  effectiveRagLevel,
  weeklyRecapEnabled,
} from '../../models';

/** Where a composition, or a narrative, has got to. */
export type RecapStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The weekly recap: what last week cost, composed once per account per week.
 *
 * The arithmetic lives in weekly-recap.utils; this owns the reads, the
 * per-device state and the optional narrative, so the card, the nudge and the
 * settings toggle all read one composition rather than three.
 *
 * Three things shape it:
 *
 * 1. Nothing is read until the preference asks for it. The recap costs two
 *    queries per dashboard open, and the flag is off by default — an
 *    unconditional load would bill every account for a card they never turned
 *    on, and would snapshot baseCurrencyOf(null) in the window before the user
 *    document lands.
 *
 * 2. The composition is memoised per `uid:weekKey` behind a single-flight
 *    promise. A week's figures do not change once the week has ended, so a
 *    second dashboard visit, or two surfaces asking at once, costs nothing.
 *
 * 3. The dismissal and the narrative are device-local, like the reminder sent
 *    log: two devices signed into one account each get their own look at the
 *    same week, and neither writes to the account document to say so. Every
 *    access is wrapped — private-mode Safari throws on the accessor itself,
 *    and an unreadable store must cost a repeat of the card, never the card.
 */
@Injectable({ providedIn: 'root' })
export class WeeklyRecapService {
  private auth = inject(AuthService);
  private transactionService = inject(TransactionService);
  private currencyService = inject(CurrencyService);
  private categoryService = inject(CategoryService);
  private translation = inject(TranslationService);
  private cloudLLM = inject(CloudLLMProviderService);
  private analytics = inject(AnalyticsService);

  /**
   * Bumped by `load()`, and by nothing else. `now()` is not a signal, so
   * without it the week below would be frozen at the one the service was first
   * asked about, and a session left open across Sunday midnight would go on
   * hiding a card it dismissed for the week before.
   *
   * Tying the move to the one entry point that recomposes is what keeps the
   * card honest: a bump from anywhere else would advance the window and the
   * key while `figures` still held the previous week's totals, and the card
   * would head last week's numbers with this week's dates.
   */
  private readonly clockTick = signal(0);

  /** `uid:weekKey` the figures were composed for; null before the first one. */
  private composedFor: string | null = null;
  private inFlight: { key: string; promise: Promise<void> } | null = null;
  private narrativeInFlight: string | null = null;

  /**
   * Seeded from the current account rather than from null, so the reset effect
   * reads its first pass as "same account" instead of throwing away a
   * composition the dashboard has already asked for.
   */
  private loadedFor = this.auth.userId();

  /** Whether this account asked for the recap at all. */
  readonly enabled = computed(() => weeklyRecapEnabled(this.auth.currentUser()?.preferences));

  /** The week being recapped: the last one that finished, never the live one. */
  readonly window = computed(() => {
    this.clockTick();
    return recapWindow(this.now());
  });

  /** That week's identity, compared against the one dismissed on this device. */
  readonly weekKey = computed(() => recapKey(this.window()));

  readonly figures = signal<RecapFigures | null>(null);
  readonly status = signal<RecapStatus>('idle');

  /** The last week dismissed on this device, re-read from storage at load. */
  readonly dismissedWeek = signal<string | null>(null);

  readonly narrative = signal('');
  readonly narrativeStatus = signal<RecapStatus>('idle');

  /**
   * Whether a narrative could be generated at all: a provider that could
   * answer, and an account that has not asked for grounding to stay off. The
   * recap is a card with or without one.
   */
  private readonly narrativeAvailable = computed(
    () => this.cloudLLM.hasAnyCloudProvider()
      && effectiveRagLevel(this.auth.currentUser()?.preferences) !== 'off');

  /**
   * Whether the card belongs on screen. `hasSomethingToSay` is the last gate
   * rather than the first: a week with nothing in it is still composed, so the
   * memo records that this week was answered and the next visit reads nothing.
   */
  readonly visible = computed(() => {
    const figures = this.figures();
    return this.enabled()
      && this.status() === 'ready'
      && figures !== null
      && this.dismissedWeek() !== this.weekKey()
      && hasSomethingToSay(figures);
  });

  constructor() {
    // A shared device must never show one account's week under another's
    // session, so this drops everything on any change of account rather than
    // on sign-out alone.
    effect(() => {
      const userId = this.auth.userId();
      if (userId === this.loadedFor) return;
      this.loadedFor = userId;
      untracked(() => this.reset());
    });

    // Category names have to resolve before the context is hashed: a context
    // built while the list is still empty spells every category as its id, and
    // that answer would be cached under a key the resolved names never produce
    // again — a wrong narrative, kept for the week. A silent week never asks:
    // load() composes it anyway so the memo covers the week, but a provider
    // call for a card that hasSomethingToSay will hide is a spent request for
    // nothing shown. The clear is gated on `available` alone — categories()
    // emptying or figures being briefly absent must never wipe a cache hit,
    // only the provider or the RAG level actually going away should.
    effect(() => {
      const figures = this.figures();
      const ready = this.status() === 'ready';
      const named = this.categoryService.categories().length > 0;
      const available = this.narrativeAvailable();
      untracked(() => {
        if (figures && ready && named && available && hasSomethingToSay(figures)) {
          void this.loadNarrative(figures);
        } else if (!available) {
          this.narrative.set('');
          this.narrativeStatus.set('idle');
        }
      });
    });
  }

  /**
   * Compose the week, unless there is nothing to compose it for.
   *
   * Safe to call on every dashboard open: past the gates, the work happens
   * once per account per week.
   */
  async load(): Promise<void> {
    this.clockTick.update(tick => tick + 1);

    const user = this.auth.currentUser();
    if (!this.enabled() || !user) return;

    const weekKey = this.weekKey();
    const dismissed = readDismissedRecapWeek(user.id);
    this.dismissedWeek.set(dismissed);
    if (dismissed === weekKey) return;

    const key = `${user.id}:${weekKey}`;
    if (this.composedFor === key) return;
    if (this.inFlight?.key === key) return this.inFlight.promise;

    const promise = this.compose(user, key);
    this.inFlight = { key, promise };
    return promise;
  }

  /** Put this week's card away on this device. Next week's still shows. */
  dismiss(): void {
    const userId = this.auth.userId();
    if (!userId) return;

    const weekKey = this.weekKey();
    writeDismissedRecapWeek(userId, weekKey);
    this.dismissedWeek.set(weekKey);
  }

  private async compose(user: User, key: string): Promise<void> {
    this.status.set('loading');

    // One clock reading for both windows: two would let a load straddling
    // Sunday midnight compare weeks that are not adjacent.
    const now = this.now();
    const window = recapWindow(now);
    const previous = weekBeforeWindow(now);

    let composed: RecapFigures | null = null;
    try {
      // The one-shot read, never getByDateRange: that one publishes the
      // dashboard's shared transactions signal, so recapping last week would
      // rewrite the page the card sits on (ADR 0034).
      const [lastWeek, weekBefore] = await Promise.all([
        this.transactionService.getTransactionsInRangeOnce(window.start, window.end),
        this.transactionService.getTransactionsInRangeOnce(previous.start, previous.end),
      ]);

      const toBase = (transaction: Transaction) =>
        this.currencyService.amountInBase(transaction, baseCurrencyOf(user));

      composed = composeRecapFigures(lastWeek, weekBefore, toBase);
    } catch {
      composed = null;
    } finally {
      if (this.inFlight?.key === key) this.inFlight = null;
    }

    // The session can end mid-read, and the reset that follows it runs long
    // before these rows land: publishing them now would put one account's
    // week on screen under the next account's session.
    if (this.auth.userId() !== user.id) return;

    this.figures.set(composed);
    // Only a completed composition is memoised, so a failed read is retried on
    // the next visit rather than remembered for the week.
    if (composed) this.composedFor = key;
    this.status.set(composed ? 'ready' : 'failed');
  }

  /**
   * The week in a sentence, from a provider.
   *
   * Everything that changes the answer is in the cache key, so the entry is
   * written once and read for the rest of the week; a transaction added late
   * moves the figures, and that is a different key rather than a stale hit.
   */
  private async loadNarrative(figures: RecapFigures): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    const context = buildRecapContext(
      figures,
      this.window(),
      baseCurrencyOf(user),
      categoryId => this.categoryName(categoryId)
    );
    const key = this.narrativeCacheKey(context);
    if (this.narrativeInFlight === key) return;

    const cached = this.readNarrativeCache(user.id, key);
    if (cached !== null) {
      this.narrative.set(cached);
      this.narrativeStatus.set('ready');
      return;
    }

    // Past the cache hit, so this counts requests actually issued rather than
    // weeks the card was rendered for.
    this.analytics.trackAiAssistUsed({ feature: 'recap' });

    this.narrativeInFlight = key;
    this.narrativeStatus.set('loading');
    let text: string | null = null;
    try {
      text = await this.cloudLLM.generatePatternNarrative(
        context, this.translation.currentLocale());
      // Cached against the account that paid for it, before the session guard
      // below: the request is spent either way.
      this.writeNarrativeCache(user.id, key, text);
    } catch {
      // Failures are never cached — a rate limit or a dropped connection says
      // nothing about the week, and a cached silence would last until Monday.
      text = null;
    } finally {
      if (this.narrativeInFlight === key) this.narrativeInFlight = null;
    }

    if (this.auth.userId() !== user.id) return;

    this.narrative.set(text ?? '');
    this.narrativeStatus.set(text === null ? 'failed' : 'ready');
  }

  /**
   * Week, figures, language and answering provider — the four things any of
   * which changes the answer. The provider is the one that would actually
   * serve the request rather than the preference, since the façade falls back
   * when the preferred provider has no key.
   */
  private narrativeCacheKey(context: string): string {
    return [
      this.weekKey(),
      fnv1a32(context),
      this.translation.currentLocale(),
      this.cloudLLM.resolveProvider('insights') ?? 'none',
    ].join(':');
  }

  /** Resolved as the insight narrative resolves them, so the two agree. */
  private categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(item => item.id === categoryId);
    return category?.name ? this.translation.t(category.name) : categoryId;
  }

  private readNarrativeCache(userId: string, key: string): string | null {
    try {
      const raw = localStorage.getItem(weeklyRecapStorageKeys(userId).narrative);
      if (!raw) return null;
      const entry = JSON.parse(raw) as { key?: unknown; text?: unknown };
      return entry.key === key && typeof entry.text === 'string' ? entry.text : null;
    } catch {
      // Unreadable, or not the shape this build writes: generate again.
      return null;
    }
  }

  /** One entry per account, overwritten — last week's is of no use to anyone. */
  private writeNarrativeCache(userId: string, key: string, text: string): void {
    try {
      localStorage.setItem(
        weeklyRecapStorageKeys(userId).narrative, JSON.stringify({ key, text }));
    } catch {
      // A refused write costs one request next visit, never the narrative.
    }
  }

  private reset(): void {
    this.composedFor = null;
    this.inFlight = null;
    this.narrativeInFlight = null;
    this.figures.set(null);
    this.status.set('idle');
    this.dismissedWeek.set(null);
    this.narrative.set('');
    this.narrativeStatus.set('idle');
  }

  protected now(): Date {
    return new Date();
  }
}
