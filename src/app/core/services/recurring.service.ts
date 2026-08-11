import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { Timestamp, FieldValue, deleteField } from '@angular/fire/firestore';
import { Observable, map, of, firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { addDays, dateAtClampedDay, endOfDay, startOfDay } from '../utils/transaction-date.utils';
import {
  RecurringTransaction,
  RecurringFrequency,
  CreateRecurringDTO,
  RecurringOccurrence,
  Transaction,
  TransactionType,
  baseCurrencyOf
} from '../../models';

// Result of atomically claiming a due rule on the server
interface ClaimResult {
  postedIds: string[];
  categoryId: string;
  type: TransactionType;
}

/**
 * Most occurrences one claim may post. A Firestore transaction is capped at
 * 500 writes; one occurrence is one write plus the rule update, so 400 leaves
 * comfortable headroom. A backlog larger than this drains across successive
 * claims — without the cap, a daily rule dormant for more than ~500 days
 * built a transaction that could never commit, and because posting and the
 * pointer advance commit together, it failed identically forever.
 */
export const MAX_OCCURRENCES_PER_CLAIM = 400;

/**
 * Thrown when a frequency could never advance: a zero, negative or non-finite
 * interval. Every walk over a rule's occurrences asks the frequency for the
 * next date; one that answers with the same date — or with an Invalid Date —
 * turns that walk into a loop with no exit.
 */
export const INVALID_FREQUENCY_ERROR = 'INVALID_RECURRING_FREQUENCY';

@Injectable({ providedIn: 'root' })
export class RecurringService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private budgetService = inject(BudgetService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  // Signals
  recurringTransactions = signal<RecurringTransaction[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.recurringTransactions.set([]);
      }
    });
  }

  // Shared promise so concurrent catch-up triggers run the engine only once
  private catchUpInFlight: Promise<Transaction[]> | null = null;

  // Computed signals
  activeRecurring = computed(() =>
    this.recurringTransactions().filter(r => r.isActive)
  );

  upcomingRecurring = computed(() => {
    const now = new Date();
    const thirtyDaysLater = endOfDay(addDays(startOfDay(now), 30));

    return this.activeRecurring()
      .filter(r => {
        const nextDate = r.nextOccurrence.toDate();
        return nextDate >= now && nextDate <= thirtyDaysLater;
      })
      .sort((a, b) =>
        a.nextOccurrence.toDate().getTime() - b.nextOccurrence.toDate().getTime()
      );
  });

  private get userRecurringPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/recurring`;
  }

  // Get all recurring transactions
  getRecurring(): Observable<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<RecurringTransaction>(
      this.userRecurringPath,
      { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
    ).pipe(
      map(recurring => {
        this.recurringTransactions.set(recurring);
        return recurring;
      })
    );
  }

  // Get a single recurring transaction by ID
  getRecurringById(id: string): Observable<RecurringTransaction | null> {
    return this.firestoreService.subscribeToDocument<RecurringTransaction>(
      `${this.userRecurringPath}/${id}`
    );
  }

  /** One-shot read for the backup export. */
  async exportAll(): Promise<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollection<RecurringTransaction>(
      this.userRecurringPath, { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] });
  }

  /**
   * Remove every recurring rule, for account deletion. Enumerates the
   * collection rather than the signal — the signal only holds what a
   * subscription happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<RecurringTransaction>(this.userRecurringPath);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.userRecurringPath}/${row.id}`);
    }
    this.recurringTransactions.set([]);
    return rows.length;
  }

  /**
   * Create a new recurring transaction.
   *
   * `options.id` writes at a caller-chosen id instead of an auto-generated
   * one, so restoring a backup twice overwrites rather than duplicating.
   * `options.isActive` is the restore's channel for a rule that was paused
   * when the backup was taken: nothing in the ledger can recompute a pause,
   * so it has to travel verbatim or the restore silently resumes it. Note
   * `nextOccurrence` is still recomputed from today either way, so resuming a
   * restored pause behaves like a fresh resume rather than restoring the
   * stored pointer — the same thing `resumeRecurring` does.
   */
  async createRecurring(
    data: CreateRecurringDTO,
    options?: { id?: string; isActive?: boolean }
  ): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      // Refuse here, before the first date walk: calculateNextOccurrence
      // advances a past start date towards today, and an interval that never
      // advances hangs the tab on this very line.
      this.validateFrequency(data.frequency);

      const nextOccurrence = this.calculateNextOccurrence(
        data.startDate,
        data.frequency
      );

      const recurring: Omit<RecurringTransaction, 'id'> = {
        userId,
        name: data.name,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        categoryId: data.categoryId,
        description: data.description,
        frequency: data.frequency,
        startDate: this.firestoreService.dateToTimestamp(data.startDate),
        // Omitted rather than set to undefined, which Firestore rejects
        // outright — a rule with no end date is the default, so writing the
        // key unconditionally failed every such create.
        ...(data.endDate
          ? { endDate: this.firestoreService.dateToTimestamp(data.endDate) }
          : {}),
        nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence),
        isActive: options?.isActive ?? true,
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp()
      };

      if (options?.id) {
        await this.firestoreService.setDocument(
          `${this.userRecurringPath}/${options.id}`,
          recurring
        );
        return options.id;
      }

      return await this.firestoreService.addDocument(
        this.userRecurringPath,
        recurring
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing recurring transaction
  async updateRecurring(
    id: string,
    data: Partial<CreateRecurringDTO>
  ): Promise<void> {
    this.isLoading.set(true);

    try {
      // Before the read and the write both: an edit that saved an
      // unusable frequency would leave the rule stored broken even if this
      // call happened not to recompute the pointer.
      if (data.frequency !== undefined) {
        this.validateFrequency(data.frequency);
      }

      const updateData: Partial<Omit<RecurringTransaction, 'endDate'>> & {
        endDate?: Timestamp | FieldValue;
      } = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.type !== undefined) updateData.type = data.type;
      if (data.amount !== undefined) updateData.amount = data.amount;
      if (data.currency !== undefined) updateData.currency = data.currency;
      if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.frequency !== undefined) updateData.frequency = data.frequency;

      if (data.startDate !== undefined) {
        updateData.startDate = this.firestoreService.dateToTimestamp(data.startDate);
      }

      if (data.endDate !== undefined) {
        // null expresses "remove the end date": delete the stored field so
        // the catch-up engine stops bounding (and pausing) the rule by it.
        updateData.endDate = data.endDate === null
          ? deleteField()
          : this.firestoreService.dateToTimestamp(data.endDate);
      }

      // Recalculate next occurrence only when frequency or start date
      // actually changed. Edits to other fields (name, amount, ...) must not
      // advance the pointer past due-but-unposted occurrences.
      if (data.frequency !== undefined || data.startDate !== undefined) {
        const current = await this.firestoreService.getDocument<RecurringTransaction>(
          `${this.userRecurringPath}/${id}`
        );

        if (current) {
          const frequencyChanged = data.frequency !== undefined &&
            !this.isSameFrequency(data.frequency, current.frequency);
          const startDateChanged = data.startDate !== undefined &&
            data.startDate.getTime() !== current.startDate.toDate().getTime();

          if (frequencyChanged || startDateChanged) {
            const frequency = data.frequency ?? current.frequency;
            const startDate = data.startDate ?? current.startDate.toDate();
            const nextOccurrence = this.calculateNextOccurrence(startDate, frequency);
            updateData.nextOccurrence = this.firestoreService.dateToTimestamp(nextOccurrence);
          }
        }
      }

      await this.firestoreService.updateDocument(
        `${this.userRecurringPath}/${id}`,
        updateData
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a recurring transaction
  async deleteRecurring(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userRecurringPath}/${id}`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Pause a recurring transaction
  async pauseRecurring(id: string): Promise<void> {
    await this.firestoreService.updateDocument(
      `${this.userRecurringPath}/${id}`,
      { isActive: false }
    );
  }

  // Resume a recurring transaction
  async resumeRecurring(id: string): Promise<void> {
    const recurring = await this.firestoreService.getDocument<RecurringTransaction>(
      `${this.userRecurringPath}/${id}`
    );

    if (!recurring) return;

    // No frequency check here, unlike create and update: a rule already stored
    // with an interval that cannot advance has to stay resumable, and this
    // path has no way to show the user why it refused. The guard inside
    // calculateNextOccurrence is what keeps that safe.

    // Recalculate next occurrence from today
    const nextOccurrence = this.calculateNextOccurrence(new Date(), recurring.frequency);

    await this.firestoreService.updateDocument(
      `${this.userRecurringPath}/${id}`,
      {
        isActive: true,
        nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence)
      }
    );
  }

  // In-app catch-up: load fresh recurring rules, then post every occurrence
  // due since the app was last open. Safe to call repeatedly; concurrent
  // callers share one run, and repeated runs find nothing due because
  // nextOccurrence has already advanced past now.
  catchUpRecurringTransactions(): Promise<Transaction[]> {
    if (!this.authService.userId()) return Promise.resolve([]);
    if (this.catchUpInFlight) return this.catchUpInFlight;

    this.catchUpInFlight = (async () => {
      try {
        // Rates must be in memory so posted amounts convert correctly.
        // Budgets need no pre-warming: recalculateBudgetsForCategory
        // enumerates the collection after the claims commit.
        await this.currencyService.ensureRatesLoaded();
        await firstValueFrom(this.getRecurring());
        return await this.processRecurringTransactions();
      } finally {
        this.catchUpInFlight = null;
      }
    })();

    return this.catchUpInFlight;
  }

  // Process due recurring transactions and create actual transactions.
  // Each due rule is claimed on the SERVER inside a Firestore transaction:
  // the rule doc is re-read fresh, every due occurrence is written and the
  // rule's nextOccurrence is advanced in the same atomic commit. A racing
  // device's transaction sees the advanced pointer and no-ops, so a stale
  // local cache can never double-post or overwrite user-edited occurrences.
  async processRecurringTransactions(): Promise<Transaction[]> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) return [];

      const now = new Date();
      const createdTransactions: Transaction[] = [];
      const affectedExpenseCategories = new Set<string>();

      // Get all active recurring transactions that are due
      const dueRecurring = this.activeRecurring().filter(r => {
        const nextDate = r.nextOccurrence.toDate();
        return nextDate <= now;
      });

      for (const recurring of dueRecurring) {
        // A backlog past the per-claim cap drains here, one full batch per
        // committed transaction, so even a rule dormant for years catches up
        // in a single run without any claim exceeding the write limit.
        let keepClaiming = true;
        while (keepClaiming) {
          let claim: ClaimResult | null;
          try {
            claim = await this.claimDueOccurrences(recurring.id, userId, now);
          } catch {
            // Firestore transactions require the network: while offline the
            // claim rejects, so skip silently — the rule is picked up again
            // by the next online catch-up.
            break;
          }

          if (!claim || claim.postedIds.length === 0) break;
          keepClaiming = claim.postedIds.length === MAX_OCCURRENCES_PER_CLAIM;

          if (claim.type === 'expense') {
            affectedExpenseCategories.add(claim.categoryId);
          }

          // Fetch the created transactions
          for (const transactionId of claim.postedIds) {
            const transaction = await this.firestoreService.getDocument<Transaction>(
              `users/${userId}/transactions/${transactionId}`
            );

            if (transaction) {
              createdTransactions.push(transaction);
            }
          }
        }
      }

      // The claim writes occurrence docs directly (bypassing
      // TransactionService.addTransaction), so recalculate the affected
      // budgets explicitly once the claims are committed.
      for (const categoryId of affectedExpenseCategories) {
        await this.budgetService.recalculateBudgetsForCategory(categoryId);
      }

      return createdTransactions;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Atomically claim a due rule and post its occurrences on the server.
  // Returns null when there is nothing to claim (rule missing, paused, or a
  // racing device already advanced nextOccurrence past now).
  private async claimDueOccurrences(
    recurringId: string,
    userId: string,
    now: Date
  ): Promise<ClaimResult | null> {
    const ruleRef = this.firestoreService.getDocRef(
      `${this.userRecurringPath}/${recurringId}`
    );

    return this.firestoreService.runTransaction(async (tx) => {
      const snapshot = await tx.get(ruleRef);
      if (!snapshot.exists()) return null;

      const rule = { ...snapshot.data(), id: snapshot.id } as RecurringTransaction;
      let occurrenceDate = rule.nextOccurrence.toDate();
      // Every step of the catch-up below measures from the rule's start date,
      // never from the occurrence it has just posted, so draining a backlog
      // lands on the same days the rule would have posted had the app been
      // open all along.
      const anchor = rule.startDate.toDate();

      // Re-check on fresh server data: another device may have paused,
      // edited, or already processed this rule.
      if (!rule.isActive || occurrenceDate > now) return null;

      // Occurrences that came due BEFORE the end date must still be posted
      // even when the end date itself has passed.
      const endDate = rule.endDate?.toDate();
      const endDatePassed = endDate !== undefined && endDate < now;
      const postUntil = endDatePassed ? endDate : now;

      const postedIds: string[] = [];

      // Catch up every occurrence that came due since the last run, bounded
      // by the per-claim cap so the transaction stays under Firestore's
      // 500-write limit however long the rule was dormant.
      while (occurrenceDate <= postUntil && postedIds.length < MAX_OCCURRENCES_PER_CLAIM) {
        // Deterministic id keeps posting idempotent across repeated runs
        const transactionId = `rec-${rule.id}-${occurrenceDate.getTime()}`;
        const transactionRef = this.firestoreService.getDocRef(
          `users/${userId}/transactions/${transactionId}`
        );
        tx.set(transactionRef, this.buildOccurrenceDocument(rule, occurrenceDate, userId));
        postedIds.push(transactionId);

        const next = this.calculateNextOccurrenceFromDate(occurrenceDate, rule.frequency, anchor);
        // Safety: a non-advancing frequency must not spin forever. The test is
        // negated rather than `<=` so an Invalid Date stops the walk too —
        // every comparison against NaN is false, so the plain form let it
        // through and it became the stored pointer.
        if (!(next.getTime() > occurrenceDate.getTime())) break;
        occurrenceDate = next;
      }

      // Advance the pointer (and pause an ended rule) in the SAME
      // transaction so posting and claim commit atomically. After a capped
      // batch the pointer lands on the first unposted occurrence, so the
      // next claim resumes exactly where this one stopped.
      const capped = postedIds.length >= MAX_OCCURRENCES_PER_CLAIM;
      const update: Partial<RecurringTransaction> = {
        updatedAt: this.firestoreService.getTimestamp()
      };
      if (postedIds.length > 0) {
        update.nextOccurrence = this.firestoreService.dateToTimestamp(occurrenceDate);
        update.lastProcessed = this.firestoreService.getTimestamp();
      }
      if (endDatePassed && !capped) {
        // Only once the backlog is drained: deactivating on a capped batch
        // would strand the occurrences that were still due before the end
        // date, because catch-up only claims active rules.
        update.isActive = false;
      }
      tx.update(ruleRef, update);

      return { postedIds, categoryId: rule.categoryId, type: rule.type };
    });
  }

  // Build an occurrence transaction document with the exact shape
  // TransactionService.addTransaction persists for a recurring posting.
  private buildOccurrenceDocument(
    rule: RecurringTransaction,
    occurrenceDate: Date,
    userId: string
  ): Omit<Transaction, 'id'> {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    const exchangeRate = this.currencyService.getExchangeRate(rule.currency, baseCurrency);

    return {
      userId,
      type: rule.type,
      amount: rule.amount,
      currency: rule.currency,
      amountInBaseCurrency: rule.amount * exchangeRate,
      exchangeRate,
      baseCurrency,
      categoryId: rule.categoryId,
      description: rule.description,
      date: this.firestoreService.dateToTimestamp(occurrenceDate),
      createdAt: this.firestoreService.getTimestamp(),
      updatedAt: this.firestoreService.getTimestamp(),
      isRecurring: true,
      recurringId: rule.id
    };
  }

  // Get upcoming occurrences for the next N days
  getNextOccurrences(days: number): Observable<RecurringOccurrence[]> {
    return this.getRecurring().pipe(
      map(recurring => {
        const now = new Date();
        // Close on the last millisecond of the final day the chart draws, not
        // `days × 24h` from this instant. The series builder walks whole local
        // calendar days, so a window measured in raw milliseconds disagreed
        // with it from the current time of day to the end of that final day —
        // and across a DST fall-back it fell short of the day entirely.
        const endDate = endOfDay(addDays(startOfDay(now), days));
        const occurrences: RecurringOccurrence[] = [];

        for (const r of recurring) {
          if (!r.isActive) continue;

          let nextDate = r.nextOccurrence.toDate();

          // Collect all occurrences within the date range
          while (nextDate <= endDate) {
            if (r.endDate && nextDate > r.endDate.toDate()) break;

            occurrences.push({
              recurringId: r.id,
              name: r.name,
              type: r.type,
              amount: r.amount,
              currency: r.currency,
              categoryId: r.categoryId,
              date: new Date(nextDate)
            });

            const next = this.calculateNextOccurrenceFromDate(
              nextDate, r.frequency, r.startDate.toDate()
            );
            // Safety: a non-advancing frequency must not spin forever
            if (!(next.getTime() > nextDate.getTime())) break;
            nextDate = next;
          }
        }

        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
      })
    );
  }

  /**
   * Reject a frequency no walk over its occurrences could ever finish.
   *
   * `Number.isFinite` covers NaN and ±Infinity, which a restored or
   * hand-edited document can carry and which make every date comparison
   * downstream false. The floor is `>= 1` rather than an integer test so it
   * matches the rule in firestore.rules, which has to keep accepting older
   * documents even though nothing guarantees their interval was stored as
   * an integer.
   */
  private validateFrequency(frequency: RecurringFrequency): void {
    if (!(Number.isFinite(frequency.interval) && frequency.interval >= 1)) {
      throw new Error(INVALID_FREQUENCY_ERROR);
    }
  }

  // Whether two frequencies describe the same schedule
  private isSameFrequency(a: RecurringFrequency, b: RecurringFrequency): boolean {
    return a.type === b.type &&
      a.interval === b.interval &&
      a.dayOfWeek === b.dayOfWeek &&
      a.dayOfMonth === b.dayOfMonth &&
      a.monthOfYear === b.monthOfYear;
  }

  // Calculate next occurrence from today
  private calculateNextOccurrence(startDate: Date, frequency: RecurringFrequency): Date {
    const now = new Date();
    let nextDate = new Date(startDate);

    // If start date is in the future, return it
    if (nextDate > now) {
      return nextDate;
    }

    // Calculate next occurrence from start date that is after now. The anchor
    // stays the start date for every step: catching a long-dormant rule up to
    // today must land on the day it was created for, not on the day some short
    // month along the way clamped it to.
    while (nextDate <= now) {
      const next = this.calculateNextOccurrenceFromDate(nextDate, frequency, startDate);
      // Safety: a non-advancing frequency must not spin forever
      if (!(next.getTime() > nextDate.getTime())) break;
      nextDate = next;
    }

    return nextDate;
  }

  /**
   * Calculate the occurrence that follows `fromDate`.
   *
   * `anchor` is the rule's start date and is what the monthly and yearly
   * branches take their target day (and month) from when the frequency does
   * not name one. It is required rather than defaulted: a default would let
   * the next caller silently re-open the drift below, and the compiler
   * pointing at every call site is worth more than the convenience.
   */
  private calculateNextOccurrenceFromDate(
    fromDate: Date,
    frequency: RecurringFrequency,
    anchor: Date
  ): Date {
    const next = new Date(fromDate);

    switch (frequency.type) {
      case 'daily':
        next.setDate(next.getDate() + frequency.interval);
        break;

      case 'weekly':
        next.setDate(next.getDate() + (7 * frequency.interval));
        if (frequency.dayOfWeek !== undefined) {
          // Adjust to specific day of week
          const currentDay = next.getDay();
          const targetDay = frequency.dayOfWeek;
          const diff = (targetDay - currentDay + 7) % 7;
          if (diff > 0) {
            next.setDate(next.getDate() + diff);
          }
        }
        break;

      // Both of these build the target from components rather than shifting
      // the month on a Date and clamping after. Shifting first overflows —
      // 31 Jan + 1 month is "31 Feb", which is already 3 March — and the clamp
      // then reads the length of the month the overflow spilled into. A rule on
      // the 31st visited only the 31-day months, five short months a year, and
      // the catch-up loop advanced with the same function so it never
      // recovered them.
      //
      // The day comes from the anchor and not from `fromDate` because the
      // clamp is a property of the month landed in, not a new schedule. Read
      // off the previous occurrence, February's 28th became the target for
      // March and every month after it, so one short month moved the rule
      // permanently and each further short month moved it again.
      case 'monthly':
        return dateAtClampedDay(
          fromDate.getFullYear(),
          fromDate.getMonth() + frequency.interval,
          frequency.dayOfMonth ?? anchor.getDate(),
          fromDate
        );

      case 'yearly':
        return dateAtClampedDay(
          fromDate.getFullYear() + frequency.interval,
          (frequency.monthOfYear ?? anchor.getMonth() + 1) - 1,
          frequency.dayOfMonth ?? anchor.getDate(),
          fromDate
        );
    }

    return next;
  }

  // Helper: Get frequency display text (localized). Previously hardcoded
  // English ("Every 2 months"), which leaked into ja/tc; now every branch
  // routes through the translation catalog.
  getFrequencyText(frequency: RecurringFrequency): string {
    const interval = frequency.interval;
    const t = (key: string, params?: Record<string, string | number>) =>
      this.translationService.t(key, params);

    switch (frequency.type) {
      case 'daily':
        return interval === 1 ? t('frequency.daily') : t('settings.everyNDays', { n: interval });
      case 'weekly':
        return interval === 1 ? t('frequency.weekly') : t('settings.everyNWeeks', { n: interval });
      case 'monthly':
        return interval === 1 ? t('frequency.monthly') : t('settings.everyNMonths', { n: interval });
      case 'yearly':
        return interval === 1 ? t('frequency.yearly') : t('settings.everyNYears', { n: interval });
      default:
        return t('frequency.custom');
    }
  }
}
