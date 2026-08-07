import { Injectable, effect, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, map, of, firstValueFrom } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { CurrencyService } from './currency.service';
import { getBudgetAlertSeverity } from '../utils/budget-alert.utils';
import { roundMoney } from '../utils/transaction-aggregation.utils';
import { dayKey } from '../utils/transaction-date.utils';
import {
  Budget,
  BudgetSummary,
  BudgetAlert,
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
   */
  async createBudget(data: CreateBudgetDTO, options?: { id?: string }): Promise<string> {
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
        isActive: true,
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

      // Recalculate spent if category, period, or dates changed
      if (data.categoryId !== undefined || data.period !== undefined ||
          data.startDate !== undefined || data.endDate !== undefined) {
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
        const periodString = this.formatPeriodString(start, budget.period);

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
  private getDefaultStartDate(period: 'weekly' | 'monthly' | 'yearly'): Timestamp {
    const now = new Date();

    switch (period) {
      case 'weekly': {
        // Start of current week (Sunday)
        const day = now.getDay();
        const diff = now.getDate() - day;
        return Timestamp.fromDate(new Date(now.setDate(diff)));
      }

      case 'monthly':
        // Start of current month
        return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1));

      case 'yearly':
        // Start of current year
        return Timestamp.fromDate(new Date(now.getFullYear(), 0, 1));
    }
  }

  // Helper: Get budget period start and end dates for the CURRENT period
  private getBudgetPeriodDates(budget: Budget): { start: Date; end: Date } {
    const now = new Date();
    const budgetStartDate = budget.startDate.toDate();
    let periodStart: Date;
    let periodEnd: Date;

    switch (budget.period) {
      case 'weekly': {
        // Get the day of week from budget start (0=Sunday, 1=Monday, etc.)
        const startDayOfWeek = budgetStartDate.getDay();
        // Calculate current week's start based on the same day of week
        const currentDayOfWeek = now.getDay();
        const daysToSubtract = (currentDayOfWeek - startDayOfWeek + 7) % 7;
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - daysToSubtract);
        periodStart.setHours(0, 0, 0, 0);

        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodStart.getDate() + 6);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      }

      case 'monthly': {
        // Get the day of month from budget start
        const startDayOfMonth = budgetStartDate.getDate();
        // Calculate current period based on the same day of month
        let year = now.getFullYear();
        let month = now.getMonth();

        // If we haven't reached the start day this month, use previous month.
        // Compare against the anchor as THIS month sees it: a day-31 anchor
        // falls on Feb 28 in February, otherwise the last day of a short
        // month would belong to no period at all.
        const daysInThisMonth = new Date(year, month + 1, 0).getDate();
        const anchorThisMonth = Math.min(startDayOfMonth, daysInThisMonth);
        if (now.getDate() < anchorThisMonth) {
          month--;
          if (month < 0) {
            month = 11;
            year--;
          }
        }

        // Handle case where start day doesn't exist in current month (e.g., 31st in Feb)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const actualStartDay = Math.min(startDayOfMonth, daysInMonth);

        periodStart = new Date(year, month, actualStartDay, 0, 0, 0, 0);

        // End is one day before next period start
        let endYear = year;
        let endMonth = month + 1;
        if (endMonth > 11) {
          endMonth = 0;
          endYear++;
        }
        const daysInEndMonth = new Date(endYear, endMonth + 1, 0).getDate();
        const actualEndDay = Math.min(startDayOfMonth, daysInEndMonth);
        periodEnd = new Date(endYear, endMonth, actualEndDay, 0, 0, 0, 0);
        periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
        break;
      }

      case 'yearly': {
        // Get month and day from budget start
        const startMonth = budgetStartDate.getMonth();
        const startDay = budgetStartDate.getDate();
        let year = now.getFullYear();

        // Check if we've passed the start date this year
        const thisYearStart = new Date(year, startMonth, startDay);
        if (now < thisYearStart) {
          year--;
        }

        periodStart = new Date(year, startMonth, startDay, 0, 0, 0, 0);
        periodEnd = new Date(year + 1, startMonth, startDay, 0, 0, 0, 0);
        periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
        break;
      }
    }

    // Respect budget's custom end date if set
    if (budget.endDate) {
      const budgetEndDate = budget.endDate.toDate();
      if (budgetEndDate < periodEnd) {
        periodEnd = budgetEndDate;
      }
    }

    return { start: periodStart, end: periodEnd };
  }

  // Helper: Format period string
  private formatPeriodString(date: Date, period: 'weekly' | 'monthly' | 'yearly'): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    switch (period) {
      case 'weekly': {
        const weekNum = this.getWeekNumber(date);
        return `${year}-W${weekNum}`;
      }

      case 'monthly':
        return `${year}-${month}`;

      case 'yearly':
        return String(year);
    }
  }

  // Helper: Get ISO week number
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}
