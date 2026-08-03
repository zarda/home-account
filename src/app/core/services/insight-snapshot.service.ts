import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { FirestoreService } from './firestore.service';
import { PwaService } from './pwa.service';
import { TransactionService } from './transaction.service';
import {
  INSIGHT_DETECTOR_VERSION,
  INSIGHT_SNAPSHOT_SCHEMA_VERSION,
  InsightSnapshot,
  Transaction,
  baseCurrencyOf
} from '../../models';
import { toStorableCards, buildInsightCards } from '../utils/insight-card.utils';
import { computeInsightFacts, transactionFingerprint } from '../utils/insight-facts.utils';
import {
  CurrentSnapshotInputs,
  compareSnapshotFingerprint,
  readSnapshot,
  sortSnapshotsDescending,
} from '../utils/insight-snapshot.utils';
import {
  addMonths,
  endOfMonth,
  monthKey,
  monthKeysBetween,
  parseMonthKey,
  startOfMonth,
} from '../utils/transaction-date.utils';
import {
  groupExpensesByCategoryWithCounts,
  sumByType,
} from '../utils/transaction-aggregation.utils';
import { INSIGHT_WINDOW_MONTHS } from './insights.service';

/**
 * Monthly spending-insight snapshots at users/{uid}/insightSnapshots/{yyyy-MM}.
 *
 * Root-provided despite the page-scoped precedent of InsightsService: generation
 * is triggered from the dashboard, the export path reads it from settings, and
 * account deletion will call it. Its only listener covers a handful of tiny
 * documents — a hundred-odd for a decade of use — and is the timeline source
 * anyway.
 *
 * The numbers come from the same pure functions the live tab uses, which is what
 * makes a regeneration over unchanged data produce an identical document rather
 * than a similar one.
 */

/** How far back a fresh install will backfill. */
export const SNAPSHOT_BACKFILL_MONTHS = 12;

@Injectable({ providedIn: 'root' })
export class InsightSnapshotService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private transactionService = inject(TransactionService);
  private currencyService = inject(CurrencyService);
  private pwa = inject(PwaService);

  private snapshotState = signal<InsightSnapshot[]>([]);
  private loading = signal<boolean>(false);
  private generating = signal<boolean>(false);
  private loadedOnce = signal<boolean>(false);

  private generateInFlight: Promise<InsightSnapshot[]> | null = null;

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.snapshotState.set([]);
        this.loadedOnce.set(false);
      }
    });
  }

  readonly snapshots = this.snapshotState.asReadonly();
  readonly isLoading = this.loading.asReadonly();
  readonly isGenerating = this.generating.asReadonly();
  readonly hasLoadedOnce = this.loadedOnce.asReadonly();
  readonly latest = computed<InsightSnapshot | null>(() => this.snapshotState()[0] ?? null);

  private path(userId: string): string {
    return `users/${userId}/insightSnapshots`;
  }

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
   * Live snapshot list, newest first.
   *
   * Deliberately a subscription rather than getCollection: getDocs rejects on a
   * cold cache offline, while an onSnapshot listener is served from the local
   * cache. Opening past months offline is half of what #117 is for.
   *
   * A null user clears the signal, so a previous account's history can never
   * flash on a shared device.
   */
  watch(): Observable<InsightSnapshot[]> {
    const userId = this.authService.userId();
    if (!userId) {
      this.snapshotState.set([]);
      this.loadedOnce.set(false);
      return of([]);
    }

    this.loading.set(true);
    return this.firestoreService
      .subscribeToCollection<InsightSnapshot>(this.path(userId), {
        orderBy: [{ field: 'monthKey', direction: 'desc' }],
      })
      .pipe(
        // A document written by a newer build is dropped rather than
        // half-rendered; readSnapshot owns that decision.
        map(rows => sortSnapshotsDescending(
          rows.map(row => readSnapshot(row)).filter(
            (row): row is InsightSnapshot => row !== null))),
        tap(rows => {
          this.snapshotState.set(rows);
          this.loading.set(false);
          this.loadedOnce.set(true);
        }),
      );
  }

  /** From the live signal, so opening a past month needs no network. */
  get(month: string): InsightSnapshot | null {
    return this.snapshotState().find(snapshot => snapshot.monthKey === month) ?? null;
  }

  /**
   * Write a snapshot for every closed month that does not have one.
   *
   * Shares one in-flight promise so the dashboard and the insights tab can both
   * call it on open without doing the work twice, mirroring
   * RecurringService.catchUpRecurringTransactions.
   *
   * Requires connectivity, which is a deliberate departure from #117's
   * suggestion that generation can read the local cache. A partially warm cache
   * yields an under-counted month, and there is nothing to detect that against —
   * countDocuments is server-only. Freezing a wrong month that then looks
   * authoritative is worse than deferring it to the next online open.
   */
  generateClosedMonths(now: Date = new Date()): Promise<InsightSnapshot[]> {
    if (this.generateInFlight) {
      return this.generateInFlight;
    }
    if (!this.authService.userId() || !this.pwa.isOnline()) {
      return Promise.resolve([]);
    }

    this.generateInFlight = (async () => {
      this.generating.set(true);
      try {
        await firstValueFrom(this.watch());
        return await this.writeMissingMonths(now);
      } catch (error) {
        // History accumulating is never a precondition for using the app.
        console.error('[InsightSnapshot] Generation failed:', error);
        return [];
      } finally {
        this.generating.set(false);
        this.generateInFlight = null;
      }
    })();

    return this.generateInFlight;
  }

  private async writeMissingMonths(now: Date): Promise<InsightSnapshot[]> {
    const lastClosed = startOfMonth(addMonths(now, -1));
    const earliest = startOfMonth(addMonths(lastClosed, -(SNAPSHOT_BACKFILL_MONTHS - 1)));
    const existing = new Set(this.snapshotState().map(snapshot => snapshot.monthKey));

    const written: InsightSnapshot[] = [];
    for (const month of monthKeysBetween(earliest, lastClosed)) {
      if (existing.has(month)) {
        continue;
      }
      const snapshot = await this.buildAndWrite(month, 1, null);
      if (snapshot) {
        written.push(snapshot);
      }
    }
    return written;
  }

  /**
   * Recompute a month with the current detectors, advancing the revision.
   *
   * An explicit user action, offered when a snapshot has gone stale. The rules
   * require the revision to increase, so history records that it was rewritten.
   */
  async regenerate(month: string): Promise<InsightSnapshot | null> {
    const previous = this.get(month);
    return this.buildAndWrite(
      month,
      (previous?.revision ?? 0) + 1,
      previous?.createdAt ?? null,
    );
  }

  private async buildAndWrite(
    month: string,
    revision: number,
    createdAt: InsightSnapshot['createdAt'] | null,
  ): Promise<InsightSnapshot | null> {
    const userId = this.authService.userId();
    const parsed = parseMonthKey(month);
    if (!userId || !parsed) {
      return null;
    }

    const monthStart = new Date(parsed.year, parsed.month, 1);
    const monthEnd = endOfMonth(monthStart);
    const monthTransactions = await firstValueFrom(
      this.transactionService.getTransactionsInRange(monthStart, monthEnd));

    // An empty month is not worth a document; it would only clutter the
    // timeline with months the user was not using the app.
    if (monthTransactions.length === 0) {
      return null;
    }

    // A point-in-time record looks back from its own month, not from today.
    const windowStart = startOfMonth(addMonths(monthEnd, -INSIGHT_WINDOW_MONTHS));
    const windowTransactions = await firstValueFrom(
      this.transactionService.getTransactionsInRange(windowStart, monthEnd));

    const baseCurrency = this.baseCurrency();
    const timeZone = this.timeZone();
    const toBase = (transaction: Transaction): number =>
      this.currencyService.amountInBase(transaction, baseCurrency);

    const { facts, drillDownIds, dripTruncated } = computeInsightFacts({
      transactions: windowTransactions,
      toBase,
      window: { start: windowStart, end: monthEnd },
      months: monthKeysBetween(windowStart, monthEnd),
      baseCurrency,
      timeZone,
    });

    const expenses = monthTransactions.filter(t => t.type === 'expense');
    const stamp = this.firestoreService.getTimestamp();
    const payload = {
      userId,
      monthKey: month,
      detectorVersion: INSIGHT_DETECTOR_VERSION,
      schemaVersion: INSIGHT_SNAPSHOT_SCHEMA_VERSION,
      status: 'complete' as const,
      fingerprint: {
        tx: transactionFingerprint(monthTransactions),
        count: monthTransactions.length,
        timeZone,
        baseCurrency,
      },
      totals: sumByType(monthTransactions, toBase),
      byCategory: groupExpensesByCategoryWithCounts(expenses, toBase),
      facts,
      // Frozen as computed, so a past month renders without re-running a
      // detector. Inline drill-down ids are dropped: snapshots hold aggregates
      // and detector output, never references to individual transactions.
      cards: toStorableCards(buildInsightCards(facts, drillDownIds, dripTruncated)),
      // setDocument stamps updatedAt only, so createdAt is written explicitly —
      // and preserved across a regeneration.
      createdAt: createdAt ?? stamp,
      generatedAt: stamp,
      revision,
    };

    await this.firestoreService.setDocument(
      `${this.path(userId)}/${month}`, payload);

    return { id: month, ...payload } as InsightSnapshot;
  }

  /**
   * Whether a stored month still matches its own data.
   *
   * Computed lazily, for the month the user opened plus the newest one. Doing it
   * for every month on open would mean a listener per month for nothing.
   */
  async staleness(month: string): Promise<ReturnType<typeof compareSnapshotFingerprint> | null> {
    const snapshot = this.get(month);
    if (!snapshot) {
      return null;
    }
    return compareSnapshotFingerprint(snapshot, await this.currentInputs(month));
  }

  private async currentInputs(month: string): Promise<CurrentSnapshotInputs | null> {
    const parsed = parseMonthKey(month);
    if (!parsed) {
      return null;
    }
    try {
      const monthStart = new Date(parsed.year, parsed.month, 1);
      const transactions = await firstValueFrom(
        this.transactionService.getTransactionsInRange(monthStart, endOfMonth(monthStart)));
      return {
        tx: transactionFingerprint(transactions),
        count: transactions.length,
        timeZone: this.timeZone(),
        baseCurrency: this.baseCurrency(),
      };
    } catch {
      // Unreadable data claims nothing rather than guessing at a change.
      return null;
    }
  }

  /**
   * Write a snapshot back from a backup, at its own month-key id.
   *
   * Re-stamps `userId` from auth rather than trusting the file, both because
   * the rules require it and because a backup may legitimately be restored
   * into a different account.
   */
  async restore(snapshot: InsightSnapshot): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) {
      throw new Error('User not authenticated');
    }

    const { id, ...rest } = snapshot;
    await this.firestoreService.setDocument(
      `${this.path(userId)}/${id}`,
      { ...rest, userId },
    );
  }

  /** One-shot read for the backup export. */
  async exportAll(): Promise<InsightSnapshot[]> {
    const userId = this.authService.userId();
    if (!userId) {
      return [];
    }
    const rows = await this.firestoreService.getCollection<InsightSnapshot>(
      this.path(userId), { orderBy: [{ field: 'monthKey', direction: 'desc' }] });
    return sortSnapshotsDescending(rows);
  }

  /**
   * Remove every snapshot, for account deletion.
   *
   * Enumerates the collection rather than the in-memory signal — the signal only
   * holds what a subscription happened to deliver.
   */
  async deleteAll(): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) {
      return;
    }
    const rows = await this.firestoreService.getCollection<InsightSnapshot>(this.path(userId));
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.path(userId)}/${row.id}`);
    }
    this.snapshotState.set([]);
  }

  /** The month a snapshot would next be written for, or null when none is due. */
  nextDueMonth(now: Date = new Date()): string | null {
    const lastClosed = monthKey(startOfMonth(addMonths(now, -1)));
    return this.snapshotState().some(snapshot => snapshot.monthKey === lastClosed)
      ? null
      : lastClosed;
  }
}
