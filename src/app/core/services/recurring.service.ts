import { Injectable, inject, signal, computed } from '@angular/core';
import { Timestamp, FieldValue, deleteField } from '@angular/fire/firestore';
import { Observable, map, of, firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
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

  // Shared promise so concurrent catch-up triggers run the engine only once
  private catchUpInFlight: Promise<Transaction[]> | null = null;

  // Computed signals
  activeRecurring = computed(() =>
    this.recurringTransactions().filter(r => r.isActive)
  );

  upcomingRecurring = computed(() => {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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

  // Create a new recurring transaction
  async createRecurring(data: CreateRecurringDTO): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

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
        isActive: true,
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp()
      };

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
        // Rates and budgets must be in memory so posted amounts convert
        // correctly and recalculateBudgetsForCategory can find the budgets
        // to recalculate after the claims commit.
        await this.currencyService.ensureRatesLoaded();
        await firstValueFrom(this.budgetService.getBudgets());
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
        let claim: ClaimResult | null;
        try {
          claim = await this.claimDueOccurrences(recurring.id, userId, now);
        } catch {
          // Firestore transactions require the network: while offline the
          // claim rejects, so skip silently — the rule is picked up again
          // by the next online catch-up.
          continue;
        }

        if (!claim || claim.postedIds.length === 0) continue;

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

      // Re-check on fresh server data: another device may have paused,
      // edited, or already processed this rule.
      if (!rule.isActive || occurrenceDate > now) return null;

      // Occurrences that came due BEFORE the end date must still be posted
      // even when the end date itself has passed.
      const endDate = rule.endDate?.toDate();
      const endDatePassed = endDate !== undefined && endDate < now;
      const postUntil = endDatePassed ? endDate : now;

      const postedIds: string[] = [];

      // Catch up every occurrence that came due since the last run
      while (occurrenceDate <= postUntil) {
        // Deterministic id keeps posting idempotent across repeated runs
        const transactionId = `rec-${rule.id}-${occurrenceDate.getTime()}`;
        const transactionRef = this.firestoreService.getDocRef(
          `users/${userId}/transactions/${transactionId}`
        );
        tx.set(transactionRef, this.buildOccurrenceDocument(rule, occurrenceDate, userId));
        postedIds.push(transactionId);

        const next = this.calculateNextOccurrenceFromDate(occurrenceDate, rule.frequency);
        // Safety: a non-advancing frequency must not spin forever
        if (next.getTime() <= occurrenceDate.getTime()) break;
        occurrenceDate = next;
      }

      // Advance the pointer (and pause an ended rule) in the SAME
      // transaction so posting and claim commit atomically.
      const update: Partial<RecurringTransaction> = {
        updatedAt: this.firestoreService.getTimestamp()
      };
      if (postedIds.length > 0) {
        update.nextOccurrence = this.firestoreService.dateToTimestamp(occurrenceDate);
        update.lastProcessed = this.firestoreService.getTimestamp();
      }
      if (endDatePassed) {
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
        const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
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

            nextDate = this.calculateNextOccurrenceFromDate(nextDate, r.frequency);
          }
        }

        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
      })
    );
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

    // Calculate next occurrence from start date that is after now
    while (nextDate <= now) {
      nextDate = this.calculateNextOccurrenceFromDate(nextDate, frequency);
    }

    return nextDate;
  }

  // Calculate next occurrence from a given date
  private calculateNextOccurrenceFromDate(
    fromDate: Date,
    frequency: RecurringFrequency
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

      case 'monthly':
        next.setMonth(next.getMonth() + frequency.interval);
        if (frequency.dayOfMonth !== undefined) {
          // Set to specific day of month (handle month overflow)
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.min(frequency.dayOfMonth, lastDay));
        }
        break;

      case 'yearly':
        next.setFullYear(next.getFullYear() + frequency.interval);
        if (frequency.monthOfYear !== undefined) {
          next.setMonth(frequency.monthOfYear - 1);
        }
        if (frequency.dayOfMonth !== undefined) {
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.min(frequency.dayOfMonth, lastDay));
        }
        break;
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
