import { Injectable, computed, inject, signal } from '@angular/core';
import { QueryDocumentSnapshot, DocumentData, Timestamp } from '@angular/fire/firestore';
import { FirestoreService, PageQueryOptions, PageResult } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Transaction, TransactionFilters, baseCurrencyOf } from '../../models';
import {
  applyClientTransactionFilters,
  buildTransactionWhere
} from '../utils/transaction-query.utils';
import { sumByType, TypeTotals } from '../utils/transaction-aggregation.utils';

/** Server count above which a sweep waits for an explicit ask. */
export const AUTO_SWEEP_LIMIT = 1000;
// 1000-row auto cap = at most 5 round trips.
const SWEEP_PAGE = 200;
const MAX_FETCH_ATTEMPTS = 3;

type PageCursor = QueryDocumentSnapshot<DocumentData>;

export type PeriodTotalsStatus =
  | { kind: 'idle' } // before the first reset — render nothing
  | { kind: 'computing' } // count or sweep in flight — placeholder, never a zero
  | { kind: 'ready' } // sweep complete; totals() is exact
  | { kind: 'unavailable' } // count or sweep failed after retries
  | { kind: 'over-cap'; serverCount: number }; // exact figure exists but must be asked for

/**
 * Exact money totals for the transactions page's active filter set.
 *
 * The visible list cannot answer "how much is that?": it is a trimmed
 * sliding window, so a sum over it *decreases* while scrolling toward more
 * spending. And a server-side aggregate cannot answer either, because
 * `amountInBase` repairs missing, mis-stamped and corrupt snapshots at read
 * time — arithmetic no Firestore `sum()` can express. So this service
 * sweeps the whole filtered set page-by-page with its own cursors and folds
 * every row through the same chokepoint the dashboard uses.
 *
 * The figures are exact or absent, never approximate: `totals()` is
 * non-null only after a completed sweep. Client-only filters (amounts,
 * tags, search) are applied once over the entire swept set, so the fuzzy
 * search fallback sees the same single array the window's own filtering
 * contract describes. Rates, base-currency and locale changes refold the
 * cached rows reactively at zero reads; only filter changes and mutations
 * re-read.
 *
 * Not provided in root — the transactions page provides its own instance so
 * totals state resets per visit.
 */
@Injectable()
export class PeriodTotalsService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  // Backoff base for fetch retries; tests shrink this to keep specs fast.
  retryBaseDelayMs = 1000;
  // Page size for the sweep; tests shrink it to exercise real paging.
  sweepPageSize = SWEEP_PAGE;

  // Supersedes in-flight work: every async op captures the generation at
  // start and discards its result if a reset/refresh/calculate bumped it.
  private generation = 0;

  private filters = signal<TransactionFilters>({});
  // Raw server rows of the completed sweep, in query order. null = no
  // completed sweep for the current server-side constraints.
  private sweptRows = signal<Transaction[] | null>(null);
  // Identity of the server-side constraints sweptRows was fetched under. A
  // reset that changes only client-side filters keeps the rows and refolds.
  private sweptWhereKey: string | null = null;
  private inFlightWhereKey: string | null = null;
  // calculate() consent: survives refresh() so an over-cap set stays exact
  // through mutations once the user asked; dies on reset() — new filters,
  // new consent.
  private manualSweepArmed = false;

  readonly status = signal<PeriodTotalsStatus>({ kind: 'idle' });

  private baseCurrency = computed(() => baseCurrencyOf(this.authService.currentUser()));

  // categoryId -> display name as rendered, so search matches what the user
  // sees. Tracks late category loads and locale switches, same as the window.
  private categoryNames = computed(() => {
    const names = new Map<string, string>();
    for (const category of this.categoryService.categories()) {
      names.set(category.id, this.translationService.t(category.name));
    }
    return names;
  });

  // The single fold: client-only filters once over the entire swept set,
  // then sumByType through amountInBase — the dashboard's own chokepoint,
  // so the two surfaces cannot disagree.
  readonly totals = computed<TypeTotals | null>(() => {
    const rows = this.sweptRows();
    if (rows === null) return null;
    const filtered = applyClientTransactionFilters(rows, this.filters(), {
      categoryNames: this.categoryNames()
    });
    return sumByType(filtered, t => this.currencyService.amountInBase(t, this.baseCurrency()));
  });

  private get userTransactionsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/transactions`;
  }

  /** New filter context. Re-reads only when the server-side constraints moved. */
  async reset(filters: TransactionFilters = {}): Promise<void> {
    if (!this.authService.userId()) return;
    this.filters.set(filters);
    this.manualSweepArmed = false;
    const whereKey = this.whereKeyOf();
    // Only client-side filters moved: the swept rows (or the sweep already
    // in flight) stay valid; the fold recomputes on its own. Zero reads.
    if (whereKey === this.sweptWhereKey && this.sweptRows() !== null) return;
    if (whereKey === this.inFlightWhereKey && this.status().kind === 'computing') return;
    await this.recompute(++this.generation, whereKey, true);
  }

  /** Mutation path: the cached sweep is stale by definition. */
  async refresh(): Promise<void> {
    if (!this.authService.userId()) return;
    await this.recompute(++this.generation, this.whereKeyOf(), !this.manualSweepArmed);
  }

  /**
   * The explicit over-cap ask. Resolves true iff this sweep landed (not
   * superseded) — the caller announces totals only on true.
   */
  async calculate(): Promise<boolean> {
    if (this.status().kind !== 'over-cap') return false;
    const gen = ++this.generation;
    this.manualSweepArmed = true;
    await this.recompute(gen, this.whereKeyOf(), false);
    return gen === this.generation && this.status().kind === 'ready';
  }

  private async recompute(gen: number, whereKey: string, honourCap: boolean): Promise<void> {
    this.sweptRows.set(null);
    this.sweptWhereKey = null;
    this.inFlightWhereKey = whereKey;
    this.status.set({ kind: 'computing' });

    let count: number;
    try {
      // Our own count, not the window's totalCount(): that signal is stale
      // between a reset and its aggregation resolving, and its null means
      // the count FAILED, not zero.
      count = await this.firestoreService.countDocuments(this.userTransactionsPath, {
        where: buildTransactionWhere(this.filters())
      });
    } catch {
      if (gen === this.generation) {
        this.inFlightWhereKey = null;
        this.status.set({ kind: 'unavailable' });
      }
      return;
    }
    if (gen !== this.generation) return;

    if (count === 0) {
      // Genuinely empty set: zero is the exact answer, no reads needed.
      this.sweptRows.set([]);
      this.sweptWhereKey = whereKey;
      this.inFlightWhereKey = null;
      this.status.set({ kind: 'ready' });
      return;
    }

    if (honourCap && count > AUTO_SWEEP_LIMIT) {
      this.inFlightWhereKey = null;
      this.status.set({ kind: 'over-cap', serverCount: count });
      return;
    }

    await this.sweep(gen, whereKey);
  }

  private async sweep(gen: number, whereKey: string): Promise<void> {
    try {
      // getExchangeRate answers 1 for any pair before the table loads; no
      // row is folded until rates have settled.
      await this.currencyService.ensureRatesLoaded();
      if (gen !== this.generation) return;

      const rows: Transaction[] = [];
      let cursor: PageCursor | undefined;
      for (;;) {
        const page = await this.fetchPage(cursor, gen);
        if (gen !== this.generation) return;
        rows.push(...page.items);
        if (page.items.length < this.sweepPageSize) break;
        cursor = page.snapshots[page.snapshots.length - 1];
      }
      this.sweptRows.set(rows);
      this.sweptWhereKey = whereKey;
      this.status.set({ kind: 'ready' });
    } catch {
      if (gen === this.generation) this.status.set({ kind: 'unavailable' });
    } finally {
      if (gen === this.generation) this.inFlightWhereKey = null;
    }
  }

  private async fetchPage(cursor: PageCursor | undefined, gen: number): Promise<PageResult<Transaction>> {
    // Sort direction is fixed: sums are order-independent, and a constant
    // descending order keeps the sweep on the same composite indexes the
    // list already requires, whichever way the list is sorted.
    const options: PageQueryOptions = {
      where: buildTransactionWhere(this.filters()),
      orderBy: [{ field: 'date', direction: 'desc' }],
      limit: this.sweepPageSize,
      ...(cursor ? { startAfterDoc: cursor } : {})
    };
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      if (gen !== this.generation) break;
      try {
        return await this.firestoreService.getPage<Transaction>(this.userTransactionsPath, options);
      } catch (error) {
        lastError = error;
        // A missing composite index is a deploy defect, not a transient
        // fault: every retry returns the same failed-precondition.
        if ((error as { code?: string }).code === 'failed-precondition') break;
        if (attempt < MAX_FETCH_ATTEMPTS - 1) {
          await this.delay(this.retryBaseDelayMs * 2 ** attempt);
        }
      }
    }
    throw lastError ?? new Error('superseded');
  }

  /**
   * Identity of the server-side constraints. buildTransactionWhere pushes
   * conditions in a fixed order, so equal filters stringify equally;
   * Timestamps are normalized to millis because each build constructs new
   * instances.
   */
  private whereKeyOf(): string {
    return JSON.stringify(
      (buildTransactionWhere(this.filters()) ?? []).map(w => [
        w.field,
        w.op,
        w.value instanceof Timestamp ? w.value.toMillis() : w.value
      ])
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
