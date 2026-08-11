import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, map, of, firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { CurrencyService } from './currency.service';
import { getBudgetAlertSeverity } from '../utils/budget-alert.utils';
import { roundMoney } from '../utils/transaction-aggregation.utils';
import {
  DateWindow,
  budgetPeriodKey,
  budgetPeriodWindow,
  dayKey,
  defaultBudgetStart,
} from '../utils/transaction-date.utils';
import {
  Budget,
  BudgetSummary,
  BudgetAlert,
  BudgetPeriod,
  CreateBudgetDTO,
  baseCurrencyOf
} from '../../models';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private transactionService = inject(TransactionService);
  private currencyService = inject(CurrencyService);

  // Signals
  budgets = signal<Budget[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.budgets.set([]);
      }
    });
  }

  // Computed signals
  activeBudgets = computed(() =>
    this.budgets().filter(b => b.isActive)
  );

  totalBudgetAmount = computed(() =>
    this.activeBudgets().reduce((sum, b) => sum + b.amount, 0)
  );

  totalSpent = computed(() =>
    this.activeBudgets().reduce((sum, b) => sum + b.spent, 0)
  );

  // Alerts for active budgets over their thresholds, most severe first
  budgetAlerts = computed(() => {
    const alerts: BudgetAlert[] = [];

    for (const budget of this.activeBudgets()) {
      const percentUsed = (budget.spent / budget.amount) * 100;
      const severity = getBudgetAlertSeverity(percentUsed, budget.alertThreshold);
      if (!severity) continue;

      alerts.push({
        budgetId: budget.id,
        budgetName: budget.name,
        percentUsed,
        remaining: Math.max(0, budget.amount - budget.spent),
        severity
      });
    }

    return alerts.sort((a, b) => b.percentUsed - a.percentUsed);
  });

  private get userBudgetsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/budgets`;
  }

  // Get all budgets
  getBudgets(): Observable<Budget[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Budget>(
      this.userBudgetsPath,
      { orderBy: [{ field: 'name', direction: 'asc' }] }
    ).pipe(
      map(budgets => {
        const fresh = budgets.map(b => this.freshenSpent(b));
        this.budgets.set(fresh);
        return fresh;
      })
    );
  }

  // Get a single budget by ID
  getBudgetById(id: string): Observable<Budget | null> {
    return this.firestoreService.subscribeToDocument<Budget>(
      `${this.userBudgetsPath}/${id}`
    ).pipe(
      map(budget => budget ? this.freshenSpent(budget) : budget)
    );
  }

  /** dayKey of the start of the period `spent` would cover right now. */
  private currentPeriodStamp(budget: Budget): string {
    return dayKey(this.getBudgetPeriodDates(budget).start);
  }

  /**
   * A stored `spent` belongs to the period stamped on it. Read in any later
   * period — or unstamped, on docs from before the stamp existed — it is a
   * previous period's number: render 0 instead and queue one self-healing
   * recalculation, so the first day of a period never shows last period's
   * spend or raises its exceeded alert.
   */
  private freshenSpent(budget: Budget): Budget {
    if (budget.spentPeriod === this.currentPeriodStamp(budget)) {
      return budget;
    }
    this.queueStaleRecalc(budget.id);
    return { ...budget, spent: 0 };
  }

  private spentRecalcsInFlight = new Set<string>();

  private queueStaleRecalc(budgetId: string): void {
    if (this.spentRecalcsInFlight.has(budgetId)) return;
    this.spentRecalcsInFlight.add(budgetId);
    // Fire and forget: the write re-emits through the subscription with a
    // matching stamp, which makes the next freshen a no-op. On failure
    // (offline) the display stays at 0 and the next emission retries.
    this.recalculateBudgetSpent(budgetId)
      .catch(() => undefined)
      .finally(() => this.spentRecalcsInFlight.delete(budgetId));
  }

  /** One-shot read for the backup export. */
  async exportAll(): Promise<Budget[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollection<Budget>(
      this.userBudgetsPath, { orderBy: [{ field: 'name', direction: 'asc' }] });
  }

  /**
   * Remove every budget, for account deletion. Enumerates the collection
   * rather than the signal — the signal only holds what a subscription
   * happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<Budget>(this.userBudgetsPath);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.userBudgetsPath}/${row.id}`);
    }
    this.budgets.set([]);
    return rows.length;
  }

  /**
   * Create a new budget.
   *
   * `options.id` writes at a caller-chosen id instead of an auto-generated
   * one, so restoring a backup twice overwrites rather than duplicating.
   * `options.isActive` carries a stored flag verbatim for the same reason.
   * Nothing in the shipped app can deactivate a budget yet, so this cannot
   * fire today — it is here so wiring up archiving later does not have to
   * discover that restore silently reactivates everything.
   */
  async createBudget(
    data: CreateBudgetDTO,
    options?: { id?: string; isActive?: boolean }
  ): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const budget: Omit<Budget, 'id' | 'endDate'> & { endDate?: Budget['endDate'] } = {
        userId,
        categoryId: data.categoryId,
        name: data.name,
        amount: data.amount,
        currency: data.currency,
        period: data.period,
        startDate: data.startDate
          ? this.firestoreService.dateToTimestamp(data.startDate)
          : this.getDefaultStartDate(data.period),
        spent: 0,
        isActive: options?.isActive ?? true,
        alertThreshold: data.alertThreshold ?? 80,
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp()
      };

      // Only add endDate if it's defined (Firestore rejects undefined values)
      if (data.endDate) {
        budget.endDate = this.firestoreService.dateToTimestamp(data.endDate);
      }

      let id: string;
      if (options?.id) {
        id = options.id;
        await this.firestoreService.setDocument(`${this.userBudgetsPath}/${id}`, budget);
      } else {
        id = await this.firestoreService.addDocument(
          this.userBudgetsPath,
          budget
        );
      }

      // Recalculate spent based on existing transactions
      await this.recalculateBudgetSpent(id);

      return id;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing budget
  async updateBudget(id: string, data: Partial<CreateBudgetDTO>): Promise<void> {
    this.isLoading.set(true);

    try {
      const updateData: Partial<Budget> = {};

      if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.amount !== undefined) updateData.amount = data.amount;
      if (data.currency !== undefined) updateData.currency = data.currency;
      if (data.period !== undefined) updateData.period = data.period;
      if (data.alertThreshold !== undefined) updateData.alertThreshold = data.alertThreshold;

      if (data.startDate !== undefined) {
        updateData.startDate = this.firestoreService.dateToTimestamp(data.startDate);
      }

      if (data.endDate !== undefined) {
        updateData.endDate = this.firestoreService.dateToTimestamp(data.endDate);
      }

      await this.firestoreService.updateDocument(
        `${this.userBudgetsPath}/${id}`,
        updateData
      );

      // Recalculate spent if anything it is derived from changed: which rows
      // it counts (category, period, dates) or the currency it is expressed
      // in. Unlike a goal's counters, `spent` is fully derived, so a currency
      // change re-derives it rather than having to freeze the unit.
      if (data.categoryId !== undefined || data.period !== undefined ||
          data.startDate !== undefined || data.endDate !== undefined ||
          data.currency !== undefined) {
        await this.recalculateBudgetSpent(id);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a budget
  async deleteBudget(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userBudgetsPath}/${id}`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Deactivate a budget
  async deactivateBudget(id: string): Promise<void> {
    await this.firestoreService.updateDocument(
      `${this.userBudgetsPath}/${id}`,
      { isActive: false }
    );
  }

  // Activate a budget
  async activateBudget(id: string): Promise<void> {
    await this.firestoreService.updateDocument(
      `${this.userBudgetsPath}/${id}`,
      { isActive: true }
    );
  }

  // Get budget progress/summary
  getBudgetProgress(budgetId: string): Observable<BudgetSummary | null> {
    return this.getBudgetById(budgetId).pipe(
      map(budget => {
        if (!budget) return null;

        const { start } = this.getBudgetPeriodDates(budget);
        const periodString = budgetPeriodKey(start, budget.period);

        return {
          budgetId: budget.id,
          period: periodString,
          totalBudget: budget.amount,
          totalSpent: budget.spent,
          remaining: Math.max(0, budget.amount - budget.spent),
          percentUsed: (budget.spent / budget.amount) * 100,
          transactions: 0 // Would need to count from transaction service
        };
      })
    );
  }

  // Check for budget alerts
  checkBudgetAlerts(): Observable<BudgetAlert[]> {
    // getBudgets() sets the budgets signal before this map runs,
    // so the derived budgetAlerts signal is already up to date.
    return this.getBudgets().pipe(map(() => this.budgetAlerts()));
  }

  // Update spent amount for a budget (called when transactions change)
  async updateBudgetSpent(budgetId: string, spent: number, spentPeriod?: string): Promise<void> {
    const data: Partial<Budget> = spentPeriod === undefined ? { spent } : { spent, spentPeriod };
    await this.firestoreService.updateDocument(
      `${this.userBudgetsPath}/${budgetId}`,
      data
    );
  }

  // Recalculate spent amount for a budget based on transactions
  async recalculateBudgetSpent(budgetId: string): Promise<void> {
    const budget = await this.firestoreService.getDocument<Budget>(
      `${this.userBudgetsPath}/${budgetId}`
    );

    if (!budget) return;

    const { start, end } = this.getBudgetPeriodDates(budget);

    // Get expense transactions for this category in the budget period.
    // Uses the non-mutating query: recalculation runs as a side effect of
    // posting transactions and must never overwrite the shared transactions
    // signal the dashboard binds its summary to.
    const txns = await firstValueFrom(
      this.transactionService.getExpensesInRange(start, end, budget.categoryId)
    );

    // Ensure exchange rates are loaded before currency conversion
    await this.currencyService.ensureRatesLoaded();

    // Sum the write-time snapshots rather than re-converting each row at
    // the live rate: budgets must agree with the dashboard and reports,
    // and spent must not drift when rates move without any transaction
    // changing. A budget kept in another currency converts once, from the
    // snapshot base into the budget currency.
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    const totalSpent = txns.reduce((sum, t) => {
      const inBase = this.currencyService.amountInBase(t, baseCurrency);
      return sum + (budget.currency === baseCurrency
        ? inBase
        : this.currencyService.convert(inBase, baseCurrency, budget.currency));
    }, 0);

    await this.updateBudgetSpent(budgetId, roundMoney(totalSpent), dayKey(start));
  }

  // Recalculate spent for all active budgets in a category
  async recalculateBudgetsForCategory(categoryId: string): Promise<void> {
    const budgets = this.budgets().filter(b =>
      b.categoryId === categoryId && b.isActive
    );

    for (const budget of budgets) {
      await this.recalculateBudgetSpent(budget.id);
    }
  }

  // Get budgets by category
  getBudgetsByCategory(categoryId: string): Observable<Budget[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Budget>(
      this.userBudgetsPath,
      {
        where: [
          { field: 'categoryId', op: '==', value: categoryId },
          { field: 'isActive', op: '==', value: true }
        ]
      }
    );
  }

  // Helper: Get default start date based on period
  private getDefaultStartDate(period: BudgetPeriod): Timestamp {
    return Timestamp.fromDate(defaultBudgetStart(period, new Date()));
  }

  /**
   * The budget period containing today. The anchoring, and the clamp that
   * keeps a day-31 anchor inside a short month, are budgetPeriodWindow's; the
   * only budget-specific rule left here is that a user-set end date can close
   * the period early.
   */
  private getBudgetPeriodDates(budget: Budget): DateWindow {
    const { start, end } = budgetPeriodWindow(
      budget.period, budget.startDate.toDate(), new Date());

    const customEnd = budget.endDate?.toDate();
    return { start, end: customEnd && customEnd < end ? customEnd : end };
  }
}
