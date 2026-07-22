import { Injectable, inject, signal, computed, Injector } from '@angular/core';
import { Timestamp, deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';

/**
 * Thrown when storing a receipt image would exceed the user's tier limit.
 * Callers surface the quota dialog instead of a generic error message.
 */
export const RECEIPT_IMAGE_LIMIT_ERROR = 'RECEIPT_IMAGE_LIMIT_REACHED';
import {
  Transaction,
  TransactionFilters,
  CreateTransactionDTO,
  MonthlyTotal,
  CategoryTotal
} from '../../models';
import {
  applyClientTransactionFilters,
  buildTransactionWhere
} from '../utils/transaction-query.utils';

export interface TransactionMutation {
  kind: 'add' | 'update' | 'delete';
  id: string;
  // Where the affected row now lives in date order; absent for deletes and
  // for updates that did not touch the date.
  date?: Timestamp;
  seq: number;
}

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);
  private storageService = inject(StorageService);
  private receiptQuota = inject(ReceiptQuotaService);
  private injector = inject(Injector);

  // Helper to update budgets after transaction changes
  private async updateAffectedBudgets(categoryId: string): Promise<void> {
    // Lazy import to avoid circular dependency
    const { BudgetService } = await import('./budget.service');
    const budgetService = this.injector.get(BudgetService);
    await budgetService.recalculateBudgetsForCategory(categoryId);
  }

  // Signals
  transactions = signal<Transaction[]>([]);
  isLoading = signal<boolean>(false);

  // Last successful write, for consumers that read via one-shot windowed
  // queries instead of a live subscription (the transactions page). The seq
  // makes back-to-back writes to the same document distinct signal values.
  lastMutation = signal<TransactionMutation | null>(null);
  private mutationSeq = 0;

  private noteMutation(kind: TransactionMutation['kind'], id: string, date?: Timestamp): void {
    this.lastMutation.set({ kind, id, date, seq: ++this.mutationSeq });
  }

  // Computed signals. Totals go through amountInBase so rows whose stored
  // snapshot is stale (base currency changed) or corrupt (written against
  // unloaded rates) are converted live instead of summed as raw amounts.
  totalIncome = computed(() => {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.currencyService.amountInBase(t, baseCurrency), 0);
  });

  totalExpense = computed(() => {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
    return this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + this.currencyService.amountInBase(t, baseCurrency), 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpense());

  private get userTransactionsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/transactions`;
  }

  // Get transactions with optional filters
  getTransactions(filters?: TransactionFilters): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    const options: Parameters<typeof this.firestoreService.subscribeToCollection>[1] = {
      orderBy: [{ field: 'date', direction: 'desc' }]
    };

    const whereConditions = buildTransactionWhere(filters);
    if (whereConditions) {
      options.where = whereConditions;
    }

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        // Amount range and text search cannot be expressed on this Firestore
        // query, so they are applied after fetch.
        const result = applyClientTransactionFilters(transactions, filters);

        // Update the signal
        this.transactions.set(result);
        return result;
      })
    );
  }

  // Get a single transaction by ID
  getTransactionById(id: string): Observable<Transaction | null> {
    return this.firestoreService.subscribeToDocument<Transaction>(
      `${this.userTransactionsPath}/${id}`
    );
  }

  // Add a new transaction
  async addTransaction(data: CreateTransactionDTO, options?: { id?: string }): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const baseCurrency = this.authService.currentUser()?.preferences.baseCurrency ?? 'USD';
      // The persisted base-currency snapshot must never be computed against
      // the not-yet-loaded default rate table (which silently maps unknown
      // currencies to 1:1 and stores raw foreign amounts as base amounts).
      await this.currencyService.ensureRatesLoaded();
      const exchangeRate = this.currencyService.getExchangeRate(data.currency, baseCurrency);
      const amountInBaseCurrency = data.amount * exchangeRate;

      const transaction: Omit<Transaction, 'id'> = {
        userId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        amountInBaseCurrency,
        exchangeRate,
        baseCurrency,
        categoryId: data.categoryId,
        description: data.description,
        date: this.firestoreService.dateToTimestamp(data.date),
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp(),
        isRecurring: data.isRecurring ?? false,
        // Only include optional fields if they have values (Firestore rejects undefined)
        ...(data.note ? { note: data.note } : {}),
        ...(data.tags?.length ? { tags: data.tags } : {}),
        ...(data.recurringId ? { recurringId: data.recurringId } : {}),
        ...(data.location ? { location: data.location } : {})
      };

      let id: string;
      if (data.receiptFile) {
        // A new transaction always stores a NEW image — enforce the tier quota
        if (!(await this.receiptQuota.canAddImage())) {
          throw new Error(RECEIPT_IMAGE_LIMIT_ERROR);
        }
        // Pre-generate the id so the receipt's storage object and the
        // Firestore document share the same key, then upload before saving.
        id = this.firestoreService.generateId(this.userTransactionsPath);
        transaction.receiptUrl = await this.storageService.uploadReceipt(
          userId,
          id,
          data.receiptFile
        );
        await this.firestoreService.setDocument(
          `${this.userTransactionsPath}/${id}`,
          transaction
        );
        this.receiptQuota.noteImageAdded();
      } else if (options?.id) {
        // Caller-supplied deterministic id (recurring engine idempotency):
        // posting the same occurrence twice overwrites one document instead
        // of duplicating it.
        id = options.id;
        await this.firestoreService.setDocument(
          `${this.userTransactionsPath}/${id}`,
          transaction
        );
      } else {
        id = await this.firestoreService.addDocument(
          this.userTransactionsPath,
          transaction
        );
      }

      // Update affected budgets if this is an expense
      if (data.type === 'expense') {
        await this.updateAffectedBudgets(data.categoryId);
      }

      this.noteMutation('add', id, transaction.date);
      return id;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing transaction
  async updateTransaction(id: string, data: Partial<CreateTransactionDTO>): Promise<void> {
    this.isLoading.set(true);

    try {
      // Get the current transaction to track category changes
      const currentTransaction = await this.firestoreService.getDocument<Transaction>(
        `${this.userTransactionsPath}/${id}`
      );

      const updateData: Partial<Transaction> = {};

      if (data.type !== undefined) updateData.type = data.type;
      if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.note !== undefined) updateData.note = data.note;
      if (data.tags !== undefined) updateData.tags = data.tags;
      if (data.location !== undefined) updateData.location = data.location;

      if (data.date !== undefined) {
        updateData.date = this.firestoreService.dateToTimestamp(data.date);
      }

      // Recalculate amount in base currency if amount or currency changed
      if (data.amount !== undefined || data.currency !== undefined) {
        if (currentTransaction) {
          const amount = data.amount ?? currentTransaction.amount;
          const currency = data.currency ?? currentTransaction.currency;
          const baseCurrency = this.authService.currentUser()?.preferences.baseCurrency ?? 'USD';
          // Same guard as addTransaction: never snapshot against unloaded rates.
          await this.currencyService.ensureRatesLoaded();
          const exchangeRate = this.currencyService.getExchangeRate(currency, baseCurrency);

          updateData.amount = amount;
          updateData.currency = currency;
          updateData.exchangeRate = exchangeRate;
          updateData.amountInBaseCurrency = amount * exchangeRate;
          updateData.baseCurrency = baseCurrency;
        }
      }

      // Upload a new receipt if one was provided (overwrites the per-id object).
      if (data.receiptFile) {
        const userId = this.authService.userId();
        if (userId) {
          // Replacing an existing image reuses its quota slot; only a
          // transaction without a stored receipt consumes a new one
          const isNewImage = !currentTransaction?.receiptUrl;
          if (isNewImage && !(await this.receiptQuota.canAddImage())) {
            throw new Error(RECEIPT_IMAGE_LIMIT_ERROR);
          }
          updateData.receiptUrl = await this.storageService.uploadReceipt(
            userId,
            id,
            data.receiptFile
          );
          if (isNewImage) {
            this.receiptQuota.noteImageAdded();
          }
        }
      }

      await this.firestoreService.updateDocument(
        `${this.userTransactionsPath}/${id}`,
        updateData
      );

      // Update affected budgets for expense transactions
      if (currentTransaction) {
        const wasExpense = currentTransaction.type === 'expense';
        const isExpense = (data.type ?? currentTransaction.type) === 'expense';
        const oldCategoryId = currentTransaction.categoryId;
        const newCategoryId = data.categoryId ?? oldCategoryId;

        // If category changed or amount/type changed, recalculate affected budgets
        if (wasExpense || isExpense) {
          if (oldCategoryId !== newCategoryId) {
            // Category changed - update both old and new
            await this.updateAffectedBudgets(oldCategoryId);
            await this.updateAffectedBudgets(newCategoryId);
          } else if (wasExpense || isExpense) {
            // Same category but amount or type might have changed
            await this.updateAffectedBudgets(oldCategoryId);
          }
        }
      }

      this.noteMutation('update', id, updateData.date ?? currentTransaction?.date);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Remove a transaction's stored receipt image, freeing one quota slot.
   * Deletes the storage object and clears the receiptUrl field; the
   * transaction itself is untouched.
   */
  async removeReceipt(id: string): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const transaction = await this.firestoreService.getDocument<Transaction>(
      `${this.userTransactionsPath}/${id}`
    );
    if (!transaction?.receiptUrl) return;

    await this.storageService.deleteReceipt(userId, id);
    await this.firestoreService.updateDocument(
      `${this.userTransactionsPath}/${id}`,
      { receiptUrl: deleteField() }
    );
    this.receiptQuota.noteImageRemoved();
  }

  // Delete a transaction
  async deleteTransaction(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      // Get the transaction before deleting to know which budget to update
      const transaction = await this.firestoreService.getDocument<Transaction>(
        `${this.userTransactionsPath}/${id}`
      );

      await this.firestoreService.deleteDocument(
        `${this.userTransactionsPath}/${id}`
      );

      // Remove the stored receipt object to avoid orphaned files.
      if (transaction?.receiptUrl) {
        const userId = this.authService.userId();
        if (userId) {
          try {
            await this.storageService.deleteReceipt(userId, id);
          } catch {
            // Don't fail the transaction delete if receipt cleanup fails.
          }
        }
        // The document is gone either way, so the image no longer counts
        // against the quota
        this.receiptQuota.noteImageRemoved();
      }

      // Update affected budget if this was an expense
      if (transaction?.type === 'expense') {
        await this.updateAffectedBudgets(transaction.categoryId);
      }

      this.noteMutation('delete', id);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Rewrite every transaction's stored base-currency snapshot against the
   * given base currency. Run after the user changes their base currency so
   * stored aggregates and the per-row "≈" conversions match the new base
   * (the snapshots are otherwise permanently frozen against the old one).
   * Returns the number of rows that needed rewriting.
   */
  async resnapshotBaseCurrency(baseCurrency: string): Promise<number> {
    this.isLoading.set(true);

    try {
      await this.currencyService.ensureRatesLoaded();
      const transactions = await this.firestoreService.getCollection<Transaction>(
        this.userTransactionsPath
      );

      let updated = 0;
      for (const t of transactions) {
        const exchangeRate = this.currencyService.getExchangeRate(t.currency, baseCurrency);
        const amountInBaseCurrency = t.amount * exchangeRate;

        const alreadyCurrent =
          t.baseCurrency === baseCurrency &&
          t.exchangeRate === exchangeRate &&
          t.amountInBaseCurrency === amountInBaseCurrency;
        if (alreadyCurrent) continue;

        await this.firestoreService.updateDocument(
          `${this.userTransactionsPath}/${t.id}`,
          { exchangeRate, amountInBaseCurrency, baseCurrency }
        );
        updated++;
      }

      return updated;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete all transactions (danger zone)
  async deleteAllTransactions(): Promise<void> {
    this.isLoading.set(true);

    try {
      const transactions = this.transactions();
      const userId = this.authService.userId();

      // Delete in batches
      for (const transaction of transactions) {
        await this.firestoreService.deleteDocument(
          `${this.userTransactionsPath}/${transaction.id}`
        );

        // Remove any stored receipt to avoid orphaned files.
        if (userId && transaction.receiptUrl) {
          try {
            await this.storageService.deleteReceipt(userId, transaction.id);
          } catch {
            // Best-effort cleanup; continue clearing the rest.
          }
        }
      }

      // Everything is gone — force a quota recount on next check
      this.receiptQuota.invalidateCount();
    } finally {
      this.isLoading.set(false);
    }
  }

  // Get transactions by date range
  getByDateRange(start: Date, end: Date): Observable<Transaction[]> {
    return this.getTransactions({
      startDate: start,
      endDate: end
    });
  }

  // Get period totals without updating the main transactions signal
  // Used for comparing with previous periods
  getPeriodTotals(start: Date, end: Date): Observable<{ income: number; expense: number }> {
    const userId = this.authService.userId();
    if (!userId) return of({ income: 0, expense: 0 });

    const options: Parameters<typeof this.firestoreService.subscribeToCollection>[1] = {
      orderBy: [{ field: 'date', direction: 'desc' }],
      where: [
        { field: 'date', op: '>=', value: Timestamp.fromDate(start) },
        { field: 'date', op: '<=', value: Timestamp.fromDate(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)) }
      ]
    };

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
        const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);

        const income = transactions
          .filter(t => t.type === 'income')
          .reduce((sum, t) => sum + toBase(t), 0);
        const expense = transactions
          .filter(t => t.type === 'expense')
          .reduce((sum, t) => sum + toBase(t), 0);
        return { income, expense };
      })
    );
  }

  // Get transactions by category
  getByCategory(categoryId: string): Observable<Transaction[]> {
    return this.getTransactions({ categoryId });
  }

  // Get monthly totals
  getMonthlyTotals(year: number, month: number): Observable<MonthlyTotal> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    return this.getByDateRange(startDate, endDate).pipe(
      map(transactions => {
        const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
        const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);

        const income = transactions
          .filter(t => t.type === 'income')
          .reduce((sum, t) => sum + toBase(t), 0);

        const expense = transactions
          .filter(t => t.type === 'expense')
          .reduce((sum, t) => sum + toBase(t), 0);

        const byCategory = this.groupByCategory(transactions);

        return {
          income,
          expense,
          balance: income - expense,
          transactionCount: transactions.length,
          byCategory
        };
      })
    );
  }

  // Search transactions
  searchTransactions(query: string): Observable<Transaction[]> {
    return this.getTransactions({ searchQuery: query });
  }

  // Helper to group transactions by category
  /**
   * Non-mutating period totals with a per-category expense breakdown
   * (in base currency). Used for previous-period comparisons.
   */
  getPeriodCategoryTotals(start: Date, end: Date): Observable<{ income: number; expense: number; byCategory: CategoryTotal[] }> {
    const userId = this.authService.userId();
    if (!userId) return of({ income: 0, expense: 0, byCategory: [] });

    const options: Parameters<typeof this.firestoreService.subscribeToCollection>[1] = {
      orderBy: [{ field: 'date', direction: 'desc' }],
      where: [
        { field: 'date', op: '>=', value: Timestamp.fromDate(start) },
        { field: 'date', op: '<=', value: Timestamp.fromDate(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)) }
      ]
    };

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
        const toBase = (t: Transaction) => this.currencyService.amountInBase(t, baseCurrency);

        let income = 0;
        let expense = 0;
        const categoryTotals = new Map<string, number>();
        for (const t of transactions) {
          const amount = toBase(t);
          if (t.type === 'income') {
            income += amount;
          } else if (t.type === 'expense') {
            expense += amount;
            categoryTotals.set(t.categoryId, (categoryTotals.get(t.categoryId) ?? 0) + amount);
          }
        }

        const byCategory: CategoryTotal[] = Array.from(categoryTotals.entries())
          .map(([categoryId, total]) => ({ categoryId, total }));
        return { income, expense, byCategory };
      })
    );
  }

  /**
   * Non-mutating fetch of expense transactions within a date range,
   * optionally narrowed to a single category. Used to build a longer
   * historical baseline (e.g. the trailing few months) for anomaly detection
   * and for budget-spent recalculation, without disturbing the main
   * `transactions` signal.
   */
  getExpensesInRange(start: Date, end: Date, categoryId?: string): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    const options: Parameters<typeof this.firestoreService.subscribeToCollection>[1] = {
      orderBy: [{ field: 'date', direction: 'desc' }],
      where: [
        { field: 'date', op: '>=', value: Timestamp.fromDate(start) },
        { field: 'date', op: '<=', value: Timestamp.fromDate(new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)) }
      ]
    };

    if (categoryId) {
      options.where!.push({ field: 'categoryId', op: '==', value: categoryId });
    }

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => transactions.filter(t => t.type === 'expense'))
    );
  }

  private groupByCategory(transactions: Transaction[]): CategoryTotal[] {
    const baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency ?? 'USD';
    const categoryMap = new Map<string, number>();

    for (const transaction of transactions) {
      const current = categoryMap.get(transaction.categoryId) ?? 0;
      categoryMap.set(
        transaction.categoryId,
        current + this.currencyService.amountInBase(transaction, baseCurrency)
      );
    }

    return Array.from(categoryMap.entries()).map(([categoryId, total]) => ({
      categoryId,
      total
    }));
  }

  // Get all transactions (for full export - no filters)
  getAllTransactions(): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      {
        orderBy: [{ field: 'date', direction: 'desc' }]
      }
    );
  }

  // Get every transaction with a stored receipt image, newest first.
  // Backs the receipt image manager (quota housekeeping).
  getTransactionsWithReceipts(): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      // Matches non-empty receiptUrl values; ordering on the inequality
      // field is implicit, so sort by date client-side instead
      { where: [{ field: 'receiptUrl', op: '>', value: '' }] }
    ).pipe(
      map(transactions =>
        [...transactions].sort((a, b) => b.date.toMillis() - a.date.toMillis())
      )
    );
  }

  // Get recent transactions
  getRecentTransactions(count = 10): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      {
        orderBy: [{ field: 'date', direction: 'desc' }],
        limit: count
      }
    );
  }

  // Get transaction dates for a month (for calendar highlighting)
  getTransactionDatesForMonth(year: number, month: number): Observable<Map<string, 'income' | 'expense' | 'both'>> {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const userId = this.authService.userId();
    if (!userId) return of(new Map());

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      {
        where: [
          { field: 'date', op: '>=', value: Timestamp.fromDate(startDate) },
          { field: 'date', op: '<=', value: Timestamp.fromDate(endDate) }
        ]
      }
    ).pipe(
      map(transactions => {
        const dateMap = new Map<string, 'income' | 'expense' | 'both'>();

        for (const t of transactions) {
          const date = t.date.toDate();
          const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const existing = dateMap.get(dateKey);

          if (!existing) {
            dateMap.set(dateKey, t.type);
          } else if (existing !== t.type) {
            dateMap.set(dateKey, 'both');
          }
        }

        return dateMap;
      })
    );
  }
}
