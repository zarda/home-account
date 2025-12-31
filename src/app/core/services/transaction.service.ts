import { Injectable, inject, signal, computed } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import {
  Transaction,
  TransactionFilters,
  CreateTransactionDTO,
  MonthlyTotal,
  CategoryTotal
} from '../../models';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);

  // Signals
  transactions = signal<Transaction[]>([]);
  isLoading = signal<boolean>(false);

  // Computed signals
  totalIncome = computed(() =>
    this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amountInBaseCurrency, 0)
  );

  totalExpense = computed(() =>
    this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amountInBaseCurrency, 0)
  );

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

    const whereConditions: NonNullable<typeof options>['where'] = [];

    if (filters?.type) {
      whereConditions.push({ field: 'type', op: '==', value: filters.type });
    }

    if (filters?.categoryId) {
      whereConditions.push({ field: 'categoryId', op: '==', value: filters.categoryId });
    }

    if (filters?.startDate) {
      whereConditions.push({
        field: 'date',
        op: '>=',
        value: Timestamp.fromDate(filters.startDate)
      });
    }

    if (filters?.endDate) {
      // Set end date to end of day (23:59:59.999) to make it inclusive
      const endOfDay = new Date(filters.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      whereConditions.push({
        field: 'date',
        op: '<=',
        value: Timestamp.fromDate(endOfDay)
      });
    }

    if (filters?.currency) {
      whereConditions.push({ field: 'currency', op: '==', value: filters.currency });
    }

    if (whereConditions.length > 0) {
      options.where = whereConditions;
    }

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        let result = transactions;

        // Client-side filtering for amount range (Firestore limitation)
        if (filters?.minAmount !== undefined) {
          result = result.filter(t => t.amount >= filters.minAmount!);
        }

        if (filters?.maxAmount !== undefined) {
          result = result.filter(t => t.amount <= filters.maxAmount!);
        }

        // Client-side search query
        if (filters?.searchQuery) {
          const query = filters.searchQuery.toLowerCase();
          result = result.filter(t =>
            t.description.toLowerCase().includes(query) ||
            t.note?.toLowerCase().includes(query) ||
            t.tags?.some(tag => tag.toLowerCase().includes(query))
          );
        }

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
  async addTransaction(data: CreateTransactionDTO): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const baseCurrency = this.authService.currentUser()?.preferences.baseCurrency ?? 'USD';
      const exchangeRate = this.currencyService.getExchangeRate(data.currency, baseCurrency);
      const amountInBaseCurrency = data.amount * exchangeRate;

      const transaction: Omit<Transaction, 'id'> = {
        userId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        amountInBaseCurrency,
        exchangeRate,
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

      // TODO: Handle receipt file upload to Firebase Storage

      const id = await this.firestoreService.addDocument(
        this.userTransactionsPath,
        transaction
      );

      return id;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing transaction
  async updateTransaction(id: string, data: Partial<CreateTransactionDTO>): Promise<void> {
    this.isLoading.set(true);

    try {
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
        const currentTransaction = await this.firestoreService.getDocument<Transaction>(
          `${this.userTransactionsPath}/${id}`
        );

        if (currentTransaction) {
          const amount = data.amount ?? currentTransaction.amount;
          const currency = data.currency ?? currentTransaction.currency;
          const baseCurrency = this.authService.currentUser()?.preferences.baseCurrency ?? 'USD';
          const exchangeRate = this.currencyService.getExchangeRate(currency, baseCurrency);

          updateData.amount = amount;
          updateData.currency = currency;
          updateData.exchangeRate = exchangeRate;
          updateData.amountInBaseCurrency = amount * exchangeRate;
        }
      }

      await this.firestoreService.updateDocument(
        `${this.userTransactionsPath}/${id}`,
        updateData
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a transaction
  async deleteTransaction(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userTransactionsPath}/${id}`
      );
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
        const income = transactions
          .filter(t => t.type === 'income')
          .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

        const expense = transactions
          .filter(t => t.type === 'expense')
          .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

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
  private groupByCategory(transactions: Transaction[]): CategoryTotal[] {
    const categoryMap = new Map<string, number>();

    for (const transaction of transactions) {
      const current = categoryMap.get(transaction.categoryId) ?? 0;
      categoryMap.set(
        transaction.categoryId,
        current + transaction.amountInBaseCurrency
      );
    }

    return Array.from(categoryMap.entries()).map(([categoryId, total]) => ({
      categoryId,
      total
    }));
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
}
