import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { Timestamp, FieldValue, deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { addDays, dateAtClampedDay, endOfDay, startOfDay, toDate } from '../utils/transaction-date.utils';
import {
  RecurringTransaction,
  RecurringFrequency,
  CreateRecurringDTO,
  RecurringOccurrence,
  Transaction,
  TransactionType,
  UpcomingSchedule,
  baseCurrencyOf
} from '../../models';

// Result of atomically claiming a due rule on the server
interface ClaimResult {
  postedIds: string[];
  categoryId: string;
  type: TransactionType;
}

// A rule's two dates, coerced: the anchor every walk measures from and the
// pointer the rule currently stands on. A null pointer means the stored value
// was not a date the engine could read.
interface RuleSchedule {
  start: Date;
  pointer: Date | null;
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

/**
 * Thrown when a rule's stored start date is not one `readSchedule` can read.
 * Every caller that reaches this — resume included — has no start to anchor
 * a recomputed pointer on and no substitute ADR 0014 allows it to invent, so
 * it refuses rather than re-dating the rule. The edit form is where such a
 * rule is repaired (a new start date) or deleted.
 */
export const UNREADABLE_SCHEDULE_ERROR = 'RECURRING_SCHEDULE_UNREADABLE';

/**
 * Thrown when a resumed rule's recomputed pointer lands past its own end
 * date: the rule can never post again, so resuming it would leave the list
 * showing an active rule with an unreachable next date. The edit form is
 * where the end date moves.
 */
export const RULE_ENDED_ERROR = 'RECURRING_RULE_ENDED';

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

  private get userRecurringPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/recurring`;
  }

  // Shared by the live listener, the export enumeration and the catch-up
  // work list, so the three queries cannot drift.
  private recurringQueryOptions(): QueryOptions {
    return { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] };
  }

  // Get all recurring transactions
  getRecurring(): Observable<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<RecurringTransaction>(
      this.userRecurringPath,
      this.recurringQueryOptions()
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

  /**
   * Every rule, enumerated from the collection.
   *
   * A correctness-bearing read, so it does not come off `recurringTransactions`
   * (ADR 0034, docs/one-shot-reads.md). Two callers depend on completeness: the
   * snapshot generator, whose recurring figures depend on which rules exist and
   * which runs at dashboard open with no ordering against the listener that
   * fills the signal, and the import, which offers each row the active rule it
   * looks like and needs the same completeness to find one on a cold page.
   */
  async listAll(): Promise<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollection<RecurringTransaction>(
      this.userRecurringPath, this.recurringQueryOptions());
  }

  /** One-shot read for the backup export. Server-only. */
  async exportAll(): Promise<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollectionFromServer<RecurringTransaction>(
      this.userRecurringPath, this.recurringQueryOptions());
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
        // Tested against null and not for truthiness, unlike the end date
        // above: zero is the lead that means "on the day", and the truthy
        // form stores it as no reminder at all.
        ...(data.remindDaysBefore != null
          ? { remindDaysBefore: data.remindDaysBefore }
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

      const updateData: Partial<Omit<RecurringTransaction, 'endDate' | 'remindDaysBefore'>> & {
        endDate?: Timestamp | FieldValue;
        remindDaysBefore?: number | FieldValue;
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

      if (data.remindDaysBefore !== undefined) {
        // null expresses "no reminder"; zero is a lead time the user picked,
        // so the two cannot share a branch.
        updateData.remindDaysBefore = data.remindDaysBefore === null
          ? deleteField()
          : data.remindDaysBefore;
      }

      // Recalculate next occurrence only when frequency or start date
      // actually changed. Edits to other fields (name, amount, ...) must not
      // advance the pointer past due-but-unposted occurrences.
      if (data.frequency !== undefined || data.startDate !== undefined) {
        const current = await this.firestoreService.getDocument<RecurringTransaction>(
          `${this.userRecurringPath}/${id}`
        );

        if (current) {
          // Read through the same seam every other caller does: a stored
          // start date need not honour its declared type. An unreadable
          // stored start only blocks the write when nothing here replaces
          // it — a submitted startDate is exactly the repair this call
          // exists to make, so it must not be refused for the value it is
          // overwriting.
          const schedule = this.readSchedule(current);
          if (!schedule && data.startDate === undefined) {
            throw new Error(UNREADABLE_SCHEDULE_ERROR);
          }

          const frequencyChanged = data.frequency !== undefined &&
            !this.isSameFrequency(data.frequency, current.frequency);
          // A missing stored start counts as changed: there is no prior
          // value a submitted startDate could match, so schedule?.start
          // reads as undefined and the comparison always differs.
          const startDateChanged = data.startDate !== undefined &&
            data.startDate.getTime() !== schedule?.start.getTime();

          if (frequencyChanged || startDateChanged) {
            const frequency = data.frequency ?? current.frequency;
            // schedule is only null here when data.startDate is defined
            // (the guard above throws for the other case), so the fallback
            // is never actually read.
            const startDate = data.startDate ?? schedule!.start;
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

    // Unlike the old behaviour, this refusal now reaches the user: the
    // toggle in RecurringTransactionsComponent catches it and tells them why
    // instead of the resume silently doing nothing useful (ADR 0141).
    this.validateFrequency(recurring.frequency);

    const schedule = this.readSchedule(recurring);
    if (!schedule) throw new Error(UNREADABLE_SCHEDULE_ERROR);

    // Anchored on the rule's own start, not on today: the same walk
    // calculateNextOccurrence already does for a fresh create, so a resumed
    // rule lands on the day its schedule actually names instead of restarting
    // the count from the moment it happened to be resumed.
    const nextOccurrence = this.calculateNextOccurrence(schedule.start, recurring.frequency);

    // validateFrequency only catches an interval that can never advance; a
    // stored frequency.type outside the four known kinds falls through
    // calculateNextOccurrenceFromDate's switch unchanged and answers the
    // start back too. A start already due that comes back unmoved is that
    // failure, not a legitimate answer — calculateNextOccurrence's own
    // future-start branch is the only other case that returns the start
    // unchanged, and it is excluded here because that date has not arrived,
    // so nothing was skipped.
    if (
      schedule.start.getTime() <= Date.now() &&
      !(nextOccurrence.getTime() > schedule.start.getTime())
    ) {
      throw new Error(INVALID_FREQUENCY_ERROR);
    }

    // A resume that recomputes a pointer past the rule's own end date would
    // write isActive: true and a date the walker can never reach — the list
    // would show it Active forever with nothing left to post. An unreadable
    // end is treated as no end, the same as everywhere else this field is
    // read.
    const end = toDate(recurring.endDate);
    if (end && nextOccurrence > end) {
      throw new Error(RULE_ENDED_ERROR);
    }

    await this.firestoreService.updateDocument(
      `${this.userRecurringPath}/${id}`,
      {
        isActive: true,
        nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence)
      }
    );
  }

  // In-app catch-up: enumerate the rules, then post every occurrence due
  // since the app was last open. Safe to call repeatedly; concurrent
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
        // The work list is answered by the server or not at all (ADR 0044,
        // docs/one-shot-reads.md). Posting is acted on once, not rendered
        // and corrected, and the per-rule claims need the network anyway —
        // so a plain getCollection would buy nothing except the failure
        // this read replaces: a warm cache serving a subset, or nothing,
        // and the run reporting success over it. Offline the read rejects
        // instead; the dashboard's catch treats that as non-fatal and the
        // next online open posts everything still due.
        const rules = await this.firestoreService.getCollectionFromServer<RecurringTransaction>(
          this.userRecurringPath,
          this.recurringQueryOptions()
        );
        return await this.processRecurringTransactions(rules);
      } finally {
        this.catchUpInFlight = null;
      }
    })();

    return this.catchUpInFlight;
  }

  // Process due recurring transactions and create actual transactions.
  // The rule set arrives as an argument so every caller names its source —
  // the engine reads neither the recurringTransactions signal nor a
  // listener, and it never writes the signal; the pages' own subscriptions
  // maintain it. Each due rule is claimed on the SERVER inside a Firestore
  // transaction: the rule doc is re-read fresh, every due occurrence is
  // written and the rule's nextOccurrence is advanced in the same atomic
  // commit. A racing device's transaction sees the advanced pointer and
  // no-ops, so a stale entry in the work list can never double-post or
  // overwrite user-edited occurrences — only a missing entry costs
  // anything, which is why the catch-up enumerates rather than trusting
  // shared state (ADR 0044).
  async processRecurringTransactions(rules: RecurringTransaction[]): Promise<Transaction[]> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) return [];

      const now = new Date();
      const createdTransactions: Transaction[] = [];
      const affectedExpenseCategories = new Set<string>();

      // Active rules that are due, from the caller's enumerated set. A rule
      // whose stored dates cannot be read is made harmless here — skipped or
      // repaired — rather than taking down the whole run, and with it every
      // other rule the user owns.
      const dueRecurring: RecurringTransaction[] = [];
      for (const rule of rules) {
        if (!rule.isActive) continue;

        const schedule = this.readSchedule(rule);
        if (!schedule) continue;

        if (!schedule.pointer) {
          await this.repairPointer(rule, schedule.start);
          // The rewritten pointer is in the future by construction, so the
          // rule is never due in the run that repaired it.
          continue;
        }

        if (schedule.pointer <= now) dueRecurring.push(rule);
      }

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
      const schedule = this.readSchedule(rule);

      // Re-check on fresh server data: another device may have paused,
      // edited, or already processed this rule — or left it in a state this
      // claim cannot read, which answers null like any other nothing-to-do.
      // Throwing here instead would reach the caller as a rejection, which is
      // how being offline arrives, and a document nobody can read is not a
      // condition the next run will find any different.
      if (!schedule?.pointer || !rule.isActive || schedule.pointer > now) return null;

      let occurrenceDate = schedule.pointer;
      // Every step of the catch-up below measures from the rule's start date,
      // never from the occurrence it has just posted, so draining a backlog
      // lands on the same days the rule would have posted had the app been
      // open all along.
      const anchor = schedule.start;

      // Occurrences that came due BEFORE the end date must still be posted
      // even when the end date itself has passed. An end date the engine
      // cannot read is treated as no end at all, so the rule keeps posting
      // rather than being deactivated on a value nobody can interpret.
      const endDate = toDate(rule.endDate);
      const endDatePassed = endDate !== null && endDate < now;
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

  /**
   * Occurrences inside the next N days, for a reader that wants the rows and
   * nothing else. The floor below applies here too: the reminder sweep
   * already drops anything dated before today, and the forecast's first
   * bucket is today, so neither loses a row it would have drawn.
   */
  getNextOccurrences(days: number): Observable<RecurringOccurrence[]> {
    return this.getRecurring().pipe(
      map(recurring => this.walkSchedule(recurring, days, new Date()).occurrences)
    );
  }

  /**
   * The same walk with its count, for the dashboard card — which is the one
   * reader that can say how much of the schedule it is not showing.
   */
  getUpcomingSchedule(days: number): Observable<UpcomingSchedule> {
    return this.getRecurring().pipe(
      map(recurring => this.walkSchedule(recurring, days, new Date()))
    );
  }

  /**
   * Walk every active rule across the window and split what it finds.
   *
   * The window has a floor as well as a horizon, and the floor mirrors it:
   * as many whole local days behind today as the window reaches ahead. A few
   * days overdue is the failed-catch-up case the card exists to surface, so
   * those rows still come back; a rule that stopped paying years ago used to
   * come back as one row per day from then to the horizon, burying everything
   * genuinely upcoming underneath it. ADR 0091 recorded "no lower bound" as a
   * decision on the strength of the overdue case alone; ADR 0141 revisits it.
   *
   * The count of what the floor left out is exact and uncapped. Stopping the
   * first loop early would leave the pointer short of the floor, and the
   * collecting loop after it would then either start below the floor or not
   * run at all — the rule's in-window occurrences would be the price of the
   * cap. The walk costs one `calculateNextOccurrenceFromDate` per step, the
   * same arithmetic a rule's creation already pays.
   */
  private walkSchedule(
    rules: RecurringTransaction[],
    days: number,
    now: Date
  ): UpcomingSchedule {
    const today = startOfDay(now);
    // Close on the last millisecond of the final day the chart draws, not
    // `days × 24h` from this instant. The series builder walks whole local
    // calendar days, so a window measured in raw milliseconds disagreed
    // with it from the current time of day to the end of that final day —
    // and across a DST fall-back it fell short of the day entirely.
    const horizon = endOfDay(addDays(today, days));
    const floor = startOfDay(addDays(today, -days));
    const occurrences: RecurringOccurrence[] = [];
    let olderCount = 0;

    for (const r of rules) {
      if (!r.isActive) continue;

      // A rule the engine cannot read is left out of the forecast rather
      // than erroring the stream, which would blank the chart for every
      // rule the user owns. Repairing belongs to the catch-up, which can
      // write; this is a projection.
      const schedule = this.readSchedule(r);
      if (!schedule?.pointer) continue;

      // A rule whose end date is not a date the engine can read is walked as
      // one with no end: an unreadable bound is not a bound.
      const ruleEnd = toDate(r.endDate);

      let nextDate = schedule.pointer;

      // Everything behind the floor is counted, not carried.
      while (nextDate < floor) {
        if (ruleEnd && nextDate > ruleEnd) break;
        olderCount++;

        const next = this.calculateNextOccurrenceFromDate(
          nextDate, r.frequency, schedule.start
        );
        // Safety: a non-advancing frequency must not spin forever
        if (!(next.getTime() > nextDate.getTime())) break;
        nextDate = next;
      }

      // A pointer still short of the floor means the loop above broke rather
      // than reached it, so there is nothing inside the window to collect.
      if (nextDate < floor) continue;

      // Collect all occurrences within the date range
      while (nextDate <= horizon) {
        if (ruleEnd && nextDate > ruleEnd) break;

        occurrences.push({
          recurringId: r.id,
          name: r.name,
          type: r.type,
          amount: r.amount,
          currency: r.currency,
          categoryId: r.categoryId,
          date: new Date(nextDate),
          // `!= null` because zero is a lead time, not an absent one
          ...(r.remindDaysBefore != null ? { remindDaysBefore: r.remindDaysBefore } : {})
        });

        const next = this.calculateNextOccurrenceFromDate(
          nextDate, r.frequency, schedule.start
        );
        // Safety: a non-advancing frequency must not spin forever
        if (!(next.getTime() > nextDate.getTime())) break;
        nextDate = next;
      }
    }

    occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
    return { occurrences, olderCount };
  }

  /**
   * The one seam every reader takes a rule's dates through.
   *
   * A stored document need not honour the type it is read as: a restore, an
   * older build or a hand edit can leave either field holding something that
   * is not a Timestamp, and `.toDate()` on it throws out of whichever pass met
   * it first.
   *
   * A rule with no readable start is answered null and skipped, by name. The
   * start is the anchor every walk measures from, and a substitute would
   * silently re-date the rule and every occurrence it has yet to post — the
   * decision ADR 0014 made and this keeps. The pointer is derived from the
   * start rather than given, so an unreadable one is answered as a null
   * pointer and the caller that can write recomputes it.
   */
  private readSchedule(rule: RecurringTransaction): RuleSchedule | null {
    const start = toDate(rule.startDate);
    if (!start) {
      console.warn('[Recurring] Skipping a rule with no readable start date:', rule.id);
      return null;
    }

    return { start, pointer: toDate(rule.nextOccurrence) };
  }

  /**
   * Rewrite an unreadable pointer from the rule's start date.
   *
   * The frequency is checked first because `calculateNextOccurrence` answers
   * the start date itself for an interval that could never advance: storing
   * that would leave the rule permanently due, which is worse than leaving it
   * inert. That guard only names one refusal (interval); it does not cover
   * every way a frequency can fail to advance — a `type` outside the four
   * known kinds falls through `calculateNextOccurrenceFromDate`'s switch
   * unchanged and also answers the start back. So a single step off the
   * start is taken and checked as well: whichever guard catches it, storing
   * the start as "next" would make the rule permanently due and re-post the
   * same idempotent id on every run, and that is as true of a rule whose
   * start is still months off as of one already due. `resumeRecurring` asks
   * the same question of the date it has computed instead, which costs it
   * the future-start case and is why it carries a `start <= now` prefix this
   * does not. The write carries `nextOccurrence` alone — `updatedAt` is
   * FirestoreService's to stamp, and nothing here says the rule has run.
   */
  private async repairPointer(rule: RecurringTransaction, start: Date): Promise<void> {
    try {
      this.validateFrequency(rule.frequency);
    } catch {
      console.warn('[Recurring] Leaving a pointer unrepaired, the interval cannot advance:', rule.id);
      return;
    }

    // Asked of the frequency itself rather than of the clock: one step from
    // the start is what every known kind advances by, and what an unknown
    // one answers back unchanged. Reading it off `calculateNextOccurrence`
    // instead would answer the start back for a start still in the future —
    // legitimately, since nothing has been skipped yet — and a rule that can
    // never advance would be repaired on the strength of that.
    const step = this.calculateNextOccurrenceFromDate(start, rule.frequency, start);
    if (!(step.getTime() > start.getTime())) {
      console.warn('[Recurring] Leaving a pointer unrepaired, the computed next date does not move past the start:', rule.id);
      return;
    }

    const next = this.calculateNextOccurrence(start, rule.frequency);

    // An ended rule would never reach a pointer past its end date, so the
    // repair deactivates it the way the claim's own endDatePassed branch
    // would have, instead of writing a pointer the rule can't get to. This
    // is a normal outcome of a healthy schedule meeting its end, not a
    // defect, so nothing is warned.
    const endDate = toDate(rule.endDate);
    if (endDate && next > endDate) {
      try {
        await this.firestoreService.updateDocument<RecurringTransaction>(
          `${this.userRecurringPath}/${rule.id}`,
          { isActive: false }
        );
      } catch (error) {
        console.warn('[Recurring] A rule\'s deactivation past its end date did not land:', rule.id, error);
      }
      return;
    }

    try {
      await this.firestoreService.updateDocument<RecurringTransaction>(
        `${this.userRecurringPath}/${rule.id}`,
        { nextOccurrence: this.firestoreService.dateToTimestamp(next) }
      );
    } catch (error) {
      // Offline, or denied: the rule keeps its bad pointer, posts nothing,
      // and the next run tries the repair again.
      console.warn('[Recurring] A pointer repair did not land:', rule.id, error);
    }
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
