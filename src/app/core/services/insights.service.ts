import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { TransactionService } from './transaction.service';
import {
  INSIGHT_DETECTOR_VERSION,
  InsightCard,
  InsightFacts,
  RAG_TIER_CONFIGS,
  Transaction,
  baseCurrencyOf
} from '../../models';
import { DetectorWindow } from '../utils/spending-pattern.types';
import { buildInsightCards } from '../utils/insight-card.utils';
import {
  computeInsightFacts,
  insightFactsFingerprint,
  transactionFingerprint,
} from '../utils/insight-facts.utils';
import {
  addMonths,
  clampToEndOfToday,
  dayKey,
  monthKey,
  monthKeysBetween,
  startOfMonth,
} from '../utils/transaction-date.utils';
import { fnv1a32 } from '../utils/transaction-aggregation.utils';
import { PeriodSelection } from '../../shared/components/period-selector/period-selector.component';

/**
 * Drives the spending-pattern Insights tab.
 *
 * Page-scoped rather than root-provided, following InsightChipsService: it holds
 * a live Firestore listener over six months of transactions, and root scope would
 * keep that open for the whole session. The computation cache lives in
 * sessionStorage, so nothing worth keeping is lost when the tab tears down.
 *
 * The detectors themselves are pure functions in core/utils; this service only
 * decides the window, fetches once, and caches. That split is what lets the
 * snapshot generator produce byte-identical output from the same inputs.
 */

/** Trailing months the detectors look back over. */
export const INSIGHT_WINDOW_MONTHS = RAG_TIER_CONFIGS.standard.baselineWindowMonths;

export interface InsightWindow extends DetectorWindow {
  /** Complete calendar months for the trend series, ascending. */
  months: string[];
  /** True when the window's final month is still in progress. */
  endsMidMonth: boolean;
}

interface CachedComputation {
  facts: InsightFacts;
  drillDownIds: Record<string, string[]>;
  dripTruncated: boolean;
  savedAt: number;
}

const CACHE_PREFIX = 'insights-facts';

/**
 * Trailing window for a period selection.
 *
 * Clamped so it never claims to cover the future, widened to at least
 * `INSIGHT_WINDOW_MONTHS`, and never narrower than the selected period — so a
 * "this year" selection keeps its whole span rather than being cut to six
 * months. `now` is a parameter, not a clock read, so this stays testable.
 */
export function insightWindow(selection: PeriodSelection, now: Date): InsightWindow {
  const end = clampToEndOfToday(selection.end, now);
  const trailingStart = startOfMonth(addMonths(end, -INSIGHT_WINDOW_MONTHS));
  const start = trailingStart < selection.start ? trailingStart : startOfMonth(selection.start);

  // A month still in progress drags every trend downward, which would produce
  // "your groceries are falling 40%" on the third of the month. The trend series
  // therefore stops at the last complete month.
  const endsMidMonth = monthKey(end) === monthKey(now)
    && end.getDate() < new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  const allMonths = monthKeysBetween(start, end);
  const months = endsMidMonth ? allMonths.slice(0, -1) : allMonths;

  return { start, end, months, endsMidMonth };
}

@Injectable()
export class InsightsService {
  private transactionService = inject(TransactionService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private pwa = inject(PwaService);
  private destroyRef = inject(DestroyRef);

  private state = signal<CachedComputation | null>(null);
  private loading = signal<boolean>(false);
  private failed = signal<boolean>(false);
  private windowState = signal<InsightWindow | null>(null);
  private windowTransactions = signal<Transaction[]>([]);
  // The window stream never completes, so each load() must supersede the
  // previous listener; takeUntilDestroyed alone only covers leaving the tab.
  private loadSub?: Subscription;

  readonly isLoading = this.loading.asReadonly();
  readonly hasFailed = this.failed.asReadonly();
  readonly window = this.windowState.asReadonly();
  readonly facts = computed<InsightFacts | null>(() => this.state()?.facts ?? null);
  readonly drillDownIds = computed<Record<string, string[]>>(
    () => this.state()?.drillDownIds ?? {});

  readonly cards = computed<InsightCard[]>(() => {
    const computation = this.state();
    return computation
      ? buildInsightCards(
        computation.facts, computation.drillDownIds, computation.dripTruncated)
      : [];
  });

  readonly fingerprint = computed<string | null>(() => {
    const facts = this.facts();
    return facts ? insightFactsFingerprint(facts) : null;
  });

  /** Transactions the window actually contained, for the "based on" banner. */
  readonly windowTransactionCount = computed(() => this.windowTransactions().length);

  /**
   * Rows behind an inline drill-down, by id. The cards carry ids only, and the
   * window is already in memory, so resolving here avoids a second query.
   */
  readonly transactionLookup = computed(() => {
    const lookup = new Map<string, Transaction>();
    for (const transaction of this.windowTransactions()) {
      lookup.set(transaction.id, transaction);
    }
    return lookup;
  });

  /** True when there is nothing to show and connectivity is the likely reason. */
  readonly isOfflineWithoutData = computed(
    () => !this.pwa.isOnline() && this.windowTransactions().length === 0 && !this.loading());

  private baseCurrency(): string {
    return baseCurrencyOf(this.authService.currentUser());
  }

  private timeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /**
   * Fetch the trailing window and compute, or serve a cached computation.
   *
   * Deliberately one query and deliberately `getTransactionsInRange`: it does not
   * touch the shared `transactions` signal that the other three report tabs
   * render from, unlike getByDateRange and the getMonthlyTotals built on it.
   * Both transaction types are needed, because the payday detector reads income.
   */
  load(selection: PeriodSelection, now: Date = new Date()): void {
    const window = insightWindow(selection, now);
    this.windowState.set(window);
    this.loading.set(true);
    this.failed.set(false);

    this.loadSub?.unsubscribe();
    this.loadSub = this.transactionService.getTransactionsInRange(window.start, window.end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: transactions => {
          this.windowTransactions.set(transactions);
          this.state.set(this.computeOrRestore(transactions, window));
          this.loading.set(false);
        },
        error: () => {
          // An onSnapshot listener serves the local cache while offline and
          // emits empty on a cold cache rather than rejecting, so reaching here
          // means a genuine failure, not merely being offline.
          this.windowTransactions.set([]);
          this.state.set(null);
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }

  /** Drop the cached computation for the current window and recompute. */
  refresh(selection: PeriodSelection, now: Date = new Date()): void {
    const window = insightWindow(selection, now);
    this.forget(window);
    this.load(selection, now);
  }

  private computeOrRestore(
    transactions: Transaction[],
    window: InsightWindow,
  ): CachedComputation {
    const key = this.cacheKey(transactions, window);
    const cached = this.readCache(key);
    if (cached) {
      return cached;
    }

    const baseCurrency = this.baseCurrency();
    const computation = computeInsightFacts({
      transactions,
      toBase: (transaction: Transaction) =>
        this.currencyService.amountInBase(transaction, baseCurrency),
      window: { start: window.start, end: window.end },
      months: window.months,
      baseCurrency,
      timeZone: this.timeZone(),
    });

    const entry: CachedComputation = { ...computation, savedAt: Date.now() };
    this.writeCache(key, entry);
    return entry;
  }

  /**
   * Content-keyed, so there is no TTL to get wrong — a key can only match when
   * the inputs match. Base currency and time zone are part of the key because
   * either one changes every number without changing a single transaction.
   */
  private cacheKey(transactions: Transaction[], window: InsightWindow): string {
    const inputs = [
      transactionFingerprint(transactions),
      this.timeZone(),
      this.baseCurrency(),
    ].join('|');
    const windowKey = `${dayKey(window.start)}_${dayKey(window.end)}_${window.months.length}`;
    return `${CACHE_PREFIX}:${windowKey}:${INSIGHT_DETECTOR_VERSION}:${fnv1a32(inputs)}`;
  }

  private readCache(key: string): CachedComputation | null {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as CachedComputation;
      return parsed.facts?.detectorVersion === INSIGHT_DETECTOR_VERSION ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, entry: CachedComputation): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // Quota or a disabled store: recomputing is cheap, so this is not fatal.
    }
  }

  private forget(window: InsightWindow): void {
    try {
      const windowKey = `${dayKey(window.start)}_${dayKey(window.end)}`;
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`${CACHE_PREFIX}:${windowKey}`)) {
          sessionStorage.removeItem(key);
        }
      }
    } catch {
      // Nothing to clear if the store is unavailable.
    }
  }
}
