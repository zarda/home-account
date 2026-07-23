import { Injectable, computed, inject, signal } from '@angular/core';
import { QueryDocumentSnapshot, DocumentData, Timestamp } from '@angular/fire/firestore';
import { FirestoreService, PageQueryOptions, PageResult } from './firestore.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { TranslationService } from './translation.service';
import { Transaction, TransactionFilters } from '../../models';
import {
  applyClientTransactionFilters,
  buildTransactionWhere
} from '../utils/transaction-query.utils';

export type WindowSortDirection = 'asc' | 'desc';
export type WindowLoadError = 'initial' | 'prev' | 'next';

// The window is capped at MAX_WINDOW rows. A fetch may briefly grow it to
// MAX_WINDOW + BATCH_SIZE; crossing that threshold is what "confirms" the
// scroll direction, and only then is a batch discarded from the opposite end.
// A single direction flip therefore never refetches rows that were just
// dropped, and drops always happen well outside the viewport.
export const MAX_WINDOW = 100;
export const BATCH_SIZE = 25;
export const INITIAL_BATCH = 50;
const TRIM_THRESHOLD = MAX_WINDOW + BATCH_SIZE;
const MAX_FETCH_ATTEMPTS = 3;

type PageCursor = QueryDocumentSnapshot<DocumentData>;

/**
 * Fixed-size sliding window over the user's transactions, ordered by date.
 *
 * Bounded alternative to the unbounded live query in
 * TransactionService.getTransactions(): only a window of rows is ever held in
 * memory, and scrolling pages it bidirectionally with document-snapshot
 * cursors. Not provided in root — the transactions page provides its own
 * instance so window state resets per visit.
 */
@Injectable()
export class TransactionWindowService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);

  // Parallel arrays: items[i] corresponds to snaps[i], so after any trim the
  // boundary cursors are always the snapshots of the boundary items.
  private items: Transaction[] = [];
  private snaps: PageCursor[] = [];

  // Supersedes in-flight work: every async op captures the generation at start
  // and discards its result if a reset/refresh/jump bumped it meanwhile.
  private generation = 0;
  // Symbol lock: a preempting op (reset/refresh/jump) takes over the lock and
  // a superseded fetch's cleanup cannot release it out from under the new op.
  private currentOp: symbol | null = null;

  // Backoff base for fetch retries; tests shrink this to keep specs fast.
  retryBaseDelayMs = 1000;

  private filters = signal<TransactionFilters>({});
  private sortDirection = signal<WindowSortDirection>('desc');

  // Raw fetched rows in server query order.
  readonly window = signal<Transaction[]>([]);
  // categoryId -> display name as rendered, so search can match what the user
  // sees. Tracks late category loads and locale switches.
  private categoryNames = computed(() => {
    const names = new Map<string, string>();
    for (const category of this.categoryService.categories()) {
      names.set(category.id, this.translationService.t(category.name));
    }
    return names;
  });
  // What the list renders: the window minus client-only filters. Cursors always
  // operate on the raw rows, so paging never skips server documents.
  readonly visibleWindow = computed(() =>
    applyClientTransactionFilters(this.window(), this.filters(), {
      categoryNames: this.categoryNames()
    })
  );

  // Starts true: the page renders before the filter bar emits its initial
  // filter set (which triggers the first reset), and the spinner covers that gap.
  readonly isInitialLoading = signal<boolean>(true);
  // Which edge a scroll prefetch is currently loading (drives the edge spinners).
  readonly fetchingEdge = signal<'next' | 'prev' | null>(null);
  readonly isFetching = computed(() => this.fetchingEdge() !== null);
  readonly reachedStart = signal<boolean>(true);
  readonly reachedEnd = signal<boolean>(false);
  // Completed reset() count; consumers use it to react once per filter/sort
  // change instead of once per scrolled page.
  readonly resetSeq = signal<number>(0);
  // Server-side count of the filtered set (client-only filters excluded).
  readonly totalCount = signal<number | null>(null);
  readonly loadError = signal<WindowLoadError | null>(null);
  // Row the list should scroll to and highlight once it is rendered (set
  // after a mutation lands in the window). The list clears it when consumed.
  readonly scrollTarget = signal<{ id: string; seq: number } | null>(null);
  private scrollSeq = 0;

  requestScrollTo(id: string): void {
    this.scrollTarget.set({ id, seq: ++this.scrollSeq });
  }

  clearScrollTarget(): void {
    this.scrollTarget.set(null);
  }

  readonly sort = this.sortDirection.asReadonly();

  private get userTransactionsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/transactions`;
  }

  // Load the first page for a new filter/sort context. Existing rows stay
  // visible until the replacement page arrives (matching the previous live
  // query's behavior on filter changes); scroll fetches are blocked meanwhile
  // by the operation lock, so stale cursors are never used with new filters.
  async reset(
    filters: TransactionFilters = {},
    sort: WindowSortDirection = 'desc'
  ): Promise<void> {
    if (!this.authService.userId()) return;

    const op = this.takeLock();
    const gen = ++this.generation;
    this.filters.set(filters);
    this.sortDirection.set(sort);
    this.loadError.set(null);
    this.refreshTotalCount(gen);

    try {
      const page = await this.fetchPage({ limit: INITIAL_BATCH }, gen);
      if (gen !== this.generation) return;
      this.items = page.items;
      this.snaps = page.snapshots as PageCursor[];
      this.reachedStart.set(true);
      this.reachedEnd.set(page.items.length < INITIAL_BATCH);
      this.publish();
      this.resetSeq.update(seq => seq + 1);
    } catch {
      if (gen === this.generation) this.loadError.set('initial');
    } finally {
      if (gen === this.generation) this.isInitialLoading.set(false);
      this.releaseLock(op);
    }
  }

  // Append a batch below the window. Returns rows added (0 when guarded,
  // already at the end, or the fetch failed).
  async fetchNext(): Promise<number> {
    if (this.currentOp || this.reachedEnd() || this.snaps.length === 0) return 0;
    return this.fetchEdge('next');
  }

  // Prepend a batch above the window (scrolling back up).
  async fetchPrev(): Promise<number> {
    if (this.currentOp || this.reachedStart() || this.snaps.length === 0) return 0;
    return this.fetchEdge('prev');
  }

  private async fetchEdge(direction: 'next' | 'prev'): Promise<number> {
    const op = this.takeLock();
    const gen = this.generation;
    this.fetchingEdge.set(direction);
    this.loadError.set(null);

    try {
      const cursor: Partial<PageQueryOptions> =
        direction === 'next'
          ? { startAfterDoc: this.snaps[this.snaps.length - 1] }
          : { endBeforeDoc: this.snaps[0] };
      const page = await this.fetchPage({ ...cursor, limit: BATCH_SIZE }, gen);
      if (gen !== this.generation) return 0;

      if (direction === 'next') {
        this.items = [...this.items, ...page.items];
        this.snaps = [...this.snaps, ...(page.snapshots as PageCursor[])];
        if (page.items.length < BATCH_SIZE) this.reachedEnd.set(true);
        if (this.items.length >= TRIM_THRESHOLD) {
          const excess = this.items.length - MAX_WINDOW;
          this.items = this.items.slice(excess);
          this.snaps = this.snaps.slice(excess);
          this.reachedStart.set(false);
        }
      } else {
        this.items = [...page.items, ...this.items];
        this.snaps = [...(page.snapshots as PageCursor[]), ...this.snaps];
        if (page.items.length < BATCH_SIZE) this.reachedStart.set(true);
        if (this.items.length >= TRIM_THRESHOLD) {
          this.items = this.items.slice(0, MAX_WINDOW);
          this.snaps = this.snaps.slice(0, MAX_WINDOW);
          this.reachedEnd.set(false);
        }
      }

      this.publish();
      return page.items.length;
    } catch {
      if (gen === this.generation) this.loadError.set(direction);
      return 0;
    } finally {
      this.fetchingEdge.set(null);
      this.releaseLock(op);
    }
  }

  // Fallback entry point for the "couldn't load" UI: re-run whatever failed.
  async retry(): Promise<void> {
    const failed = this.loadError();
    if (!failed) return;
    this.loadError.set(null);

    if (failed === 'next') {
      await this.fetchNext();
    } else if (failed === 'prev') {
      await this.fetchPrev();
    } else {
      await this.reset(this.filters(), this.sortDirection());
    }
  }

  // Re-fetch the current view after a mutation, without blanking the list.
  async refresh(): Promise<void> {
    if (!this.authService.userId()) return;

    const op = this.takeLock();
    const gen = ++this.generation;
    this.loadError.set(null);
    this.refreshTotalCount(gen);

    try {
      if (this.reachedStart() || this.items.length === 0) {
        const requested = Math.max(this.items.length, INITIAL_BATCH);
        const page = await this.fetchPage({ limit: requested }, gen);
        if (gen !== this.generation) return;
        this.items = page.items;
        this.snaps = page.snapshots as PageCursor[];
        this.reachedStart.set(true);
        this.reachedEnd.set(page.items.length < requested);
      } else {
        // Re-anchor on the first row's date with a value cursor: the boundary
        // document itself may be the one that was just deleted.
        const requested = this.items.length + BATCH_SIZE;
        const page = await this.fetchPage(
          { startAtValues: [this.items[0].date], limit: requested },
          gen
        );
        if (gen !== this.generation) return;
        this.items = page.items;
        this.snaps = page.snapshots as PageCursor[];
        this.reachedEnd.set(page.items.length < requested);
        if (this.items.length > MAX_WINDOW) {
          this.items = this.items.slice(0, MAX_WINDOW);
          this.snaps = this.snaps.slice(0, MAX_WINDOW);
          this.reachedEnd.set(false);
        }
      }
      this.publish();
    } catch {
      if (gen === this.generation) this.loadError.set('initial');
    } finally {
      this.releaseLock(op);
    }
  }

  // Re-seed the window around a date that lies outside the current range
  // (e.g. an item added with a far-away date), so the list can show it.
  async jumpTo(date: Timestamp): Promise<void> {
    if (!this.authService.userId()) return;

    const op = this.takeLock();
    const gen = ++this.generation;
    this.loadError.set(null);
    this.refreshTotalCount(gen);

    try {
      // Page containing the target date and rows after it in query order.
      const below = await this.fetchPage(
        { startAtValues: [date], limit: INITIAL_BATCH },
        gen
      );
      if (gen !== this.generation) return;

      if (below.items.length === 0) {
        // Target not reachable under the active server filters; fall back to
        // a plain top-of-list load.
        const page = await this.fetchPage({ limit: INITIAL_BATCH }, gen);
        if (gen !== this.generation) return;
        this.items = page.items;
        this.snaps = page.snapshots as PageCursor[];
        this.reachedStart.set(true);
        this.reachedEnd.set(page.items.length < INITIAL_BATCH);
        this.publish();
        return;
      }

      // Context rows before the target, using the real doc cursor from the
      // page above so date ties resolve correctly.
      const above = await this.fetchPage(
        { endBeforeDoc: below.snapshots[0] as PageCursor, limit: BATCH_SIZE },
        gen
      );
      if (gen !== this.generation) return;

      this.items = [...above.items, ...below.items];
      this.snaps = [
        ...(above.snapshots as PageCursor[]),
        ...(below.snapshots as PageCursor[])
      ];
      this.reachedStart.set(above.items.length < BATCH_SIZE);
      this.reachedEnd.set(below.items.length < INITIAL_BATCH);
      this.publish();
    } catch {
      if (gen === this.generation) this.loadError.set('initial');
    } finally {
      this.releaseLock(op);
    }
  }

  // Whether a date falls inside the currently loaded range — the caller uses
  // this to choose refresh() (in range) vs jumpTo() (outside). A boundary the
  // window has actually reached counts as in range, since a refresh from that
  // edge will include the row.
  isInLoadedRange(date: Timestamp): boolean {
    if (this.items.length === 0) return this.reachedStart() && this.reachedEnd();

    const t = date.toMillis();
    const first = this.items[0].date.toMillis();
    const last = this.items[this.items.length - 1].date.toMillis();
    const hi = Math.max(first, last);
    const lo = Math.min(first, last);
    const desc = this.sortDirection() === 'desc';

    if (t > hi) return desc ? this.reachedStart() : this.reachedEnd();
    if (t < lo) return desc ? this.reachedEnd() : this.reachedStart();
    return true;
  }

  private publish(): void {
    // Arrays are only ever replaced (slice/spread), never mutated in place, so
    // handing the reference to the signal is safe.
    this.window.set(this.items);
  }

  private baseOptions(): Pick<PageQueryOptions, 'where' | 'orderBy'> {
    return {
      where: buildTransactionWhere(this.filters()),
      orderBy: [{ field: 'date', direction: this.sortDirection() }]
    };
  }

  private async fetchPage(
    options: Omit<PageQueryOptions, 'where' | 'orderBy'>,
    gen: number
  ): Promise<PageResult<Transaction>> {
    const fullOptions: PageQueryOptions = { ...this.baseOptions(), ...options };
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      if (gen !== this.generation) break;
      try {
        return await this.firestoreService.getPage<Transaction>(
          this.userTransactionsPath,
          fullOptions
        );
      } catch (error) {
        lastError = error;
        if (attempt < MAX_FETCH_ATTEMPTS - 1) {
          await this.delay(this.retryBaseDelayMs * 2 ** attempt);
        }
      }
    }
    throw lastError ?? new Error('superseded');
  }

  private refreshTotalCount(gen: number): void {
    void this.firestoreService
      .countDocuments(this.userTransactionsPath, {
        where: buildTransactionWhere(this.filters())
      })
      .then(count => {
        if (gen === this.generation) this.totalCount.set(count);
      })
      .catch(() => {
        if (gen === this.generation) this.totalCount.set(null);
      });
  }

  private takeLock(): symbol {
    const op = Symbol('window-op');
    this.currentOp = op;
    return op;
  }

  private releaseLock(op: symbol): void {
    if (this.currentOp === op) this.currentOp = null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
