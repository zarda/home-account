import { Injectable, inject, signal, computed, Injector } from '@angular/core';
import { Timestamp, deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { StorageService, MAX_RECEIPTS_PER_TRANSACTION } from './storage.service';
import { ReceiptQuotaService } from './receipt-quota.service';

/**
 * Thrown when storing a receipt image would exceed the user's tier limit.
 * Callers surface the quota dialog instead of a generic error message.
 */
export const RECEIPT_IMAGE_LIMIT_ERROR = 'RECEIPT_IMAGE_LIMIT_REACHED';

/**
 * Thrown when a batch of receipt images could not be stored — one upload
 * failed and the ones that landed were rolled back, or the batch would push
 * the transaction past MAX_RECEIPTS_PER_TRANSACTION. Nothing was saved;
 * callers can say so instead of showing a generic error.
 */
export const RECEIPT_ATTACH_FAILED = 'RECEIPT_ATTACH_FAILED';

/**
 * Thrown when an amount is zero, negative or not a number. Import sources
 * (CSV columns, model-extracted receipts) can produce these; the write would
 * be rejected by firestore.rules anyway.
 */
export const INVALID_AMOUNT_ERROR = 'INVALID_TRANSACTION_AMOUNT';
import {
  Transaction,
  TransactionFilters,
  CreateTransactionDTO,
  MonthlyTotal,
  CategoryTotal,
  receiptImageCount
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
        // query, so they are applied after fetch. No context is passed: no
        // caller of this path searches, so category-name matching (supplied
        // by TransactionWindowService for the transactions page) is not
        // wired here — wire it up before routing a searchQuery through this.
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

      // firestore.rules rejects non-positive amounts. Fail here so importers
      // get a row they can report rather than an opaque permission error.
      if (!Number.isFinite(data.amount) || data.amount <= 0) {
        throw new Error(INVALID_AMOUNT_ERROR);
      }

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
      const receiptFiles = data.receiptFiles ?? [];
      if (receiptFiles.length > 0) {
        if (receiptFiles.length > MAX_RECEIPTS_PER_TRANSACTION) {
          throw new Error(RECEIPT_ATTACH_FAILED);
        }
        // A new transaction always stores NEW images — enforce the tier quota
        if (!(await this.receiptQuota.canAddImages(receiptFiles.length))) {
          throw new Error(RECEIPT_IMAGE_LIMIT_ERROR);
        }
        // Pre-generate the id so the receipts' storage objects and the
        // Firestore document share the same key, then upload before saving.
        id = this.firestoreService.generateId(this.userTransactionsPath);
        const urls = await this.uploadReceiptBatch(userId, id, receiptFiles, 0);
        transaction.receiptUrl = urls[0];
        transaction.receiptUrls = urls;
        transaction.receiptCount = urls.length;
        await this.firestoreService.setDocument(
          `${this.userTransactionsPath}/${id}`,
          transaction
        );
        this.receiptQuota.noteImagesAdded(urls.length);
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
      // Distinguish "not part of this update" (key absent — e.g. the
      // note-only update conversion issues) from "cleared" (key present,
      // value undefined): a cleared location is removed from the document.
      if ('location' in data) {
        updateData.location = data.location
          ?? (deleteField() as unknown as Transaction['location']);
      }

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

      // Append newly provided receipt images after the existing ones.
      // Replacing an image is remove-then-attach; an update never overwrites
      // a stored object.
      if (data.receiptFiles?.length) {
        const userId = this.authService.userId();
        if (userId) {
          // The slot array as stored: a legacy row's single receiptUrl is its
          // slot 0. Length (tombstones included) is the next free slot —
          // interior tombstones are never reused so images keep their order.
          const existingSlots = currentTransaction?.receiptUrls
            ? [...currentTransaction.receiptUrls]
            : currentTransaction?.receiptUrl
              ? [currentTransaction.receiptUrl]
              : [];

          const total = receiptImageCount(currentTransaction) + data.receiptFiles.length;
          if (total > MAX_RECEIPTS_PER_TRANSACTION) {
            throw new Error(RECEIPT_ATTACH_FAILED);
          }
          // Appended images are always new — enforce the tier quota
          if (!(await this.receiptQuota.canAddImages(data.receiptFiles.length))) {
            throw new Error(RECEIPT_IMAGE_LIMIT_ERROR);
          }

          const urls = await this.uploadReceiptBatch(
            userId,
            id,
            data.receiptFiles,
            existingSlots.length
          );
          const merged = [...existingSlots, ...urls];
          updateData.receiptUrl = merged.find(url => !!url);
          updateData.receiptUrls = merged;
          updateData.receiptCount = merged.filter(url => !!url).length;
          this.receiptQuota.noteImagesAdded(urls.length);
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
   * Upload a batch of receipt images into consecutive slots, all-or-nothing:
   * if any upload rejects, the slots that did land are deleted best-effort
   * and the whole batch fails. The caller writes the document only after
   * this resolves, so a failed batch leaves the row exactly as it was — and
   * because the document never referenced the attempted slots, a retry
   * simply overwrites them, so even a rollback whose deletes fail leaves no
   * permanent orphan.
   */
  private async uploadReceiptBatch(
    userId: string,
    transactionId: string,
    files: File[],
    firstSlot: number
  ): Promise<string[]> {
    const results = await Promise.allSettled(
      files.map((file, i) =>
        this.storageService.uploadReceipt(userId, transactionId, file, firstSlot + i)
      )
    );

    if (results.some(result => result.status === 'rejected')) {
      const landed = results
        .map((result, i) => (result.status === 'fulfilled' ? firstSlot + i : -1))
        .filter(slot => slot >= 0);
      await this.storageService.deleteReceiptSlots(userId, transactionId, landed);
      throw new Error(RECEIPT_ATTACH_FAILED);
    }

    return results.map(result => (result as PromiseFulfilledResult<string>).value);
  }

  /**
   * Remove one of a transaction's stored receipt images, freeing one quota
   * slot. The slot is tombstoned in receiptUrls (never re-indexed) so the
   * remaining entries keep matching their storage keys; the transaction
   * itself is untouched. Removing an already-empty slot is a no-op.
   */
  async removeReceiptAt(id: string, slot: number): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const transaction = await this.firestoreService.getDocument<Transaction>(
      `${this.userTransactionsPath}/${id}`
    );
    if (!transaction) return;

    const slots = transaction.receiptUrls
      ? [...transaction.receiptUrls]
      : transaction.receiptUrl
        ? [transaction.receiptUrl]
        : [];
    if (!slots[slot]) return;

    await this.storageService.deleteReceipt(userId, id, slot);

    slots[slot] = '';
    // Truncate trailing tombstones so the array never grows past the highest
    // live slot; a truncated slot is safe to append into later because its
    // object is confirmed gone.
    while (slots.length > 0 && !slots[slots.length - 1]) slots.pop();

    const remaining = slots.filter(url => !!url).length;
    if (remaining === 0) {
      await this.firestoreService.updateDocument(
        `${this.userTransactionsPath}/${id}`,
        { receiptUrl: deleteField(), receiptUrls: deleteField(), receiptCount: 0 }
      );
    } else {
      await this.firestoreService.updateDocument(
        `${this.userTransactionsPath}/${id}`,
        {
          // The pointer follows the first live image so the quota query and
          // single-image read sites keep resolving.
          receiptUrl: slots.find(url => !!url),
          receiptUrls: slots,
          receiptCount: remaining
        }
      );
    }
    this.receiptQuota.noteImagesRemoved(1);
  }

  /**
   * Remove every stored receipt image of a transaction, freeing their quota
   * slots. The transaction itself is untouched.
   */
  async removeAllReceipts(id: string): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const transaction = await this.firestoreService.getDocument<Transaction>(
      `${this.userTransactionsPath}/${id}`
    );
    const count = receiptImageCount(transaction);
    if (!transaction || count === 0) return;

    const slotSpan = transaction.receiptUrls?.length ?? 1;
    await this.storageService.deleteReceiptSlots(
      userId,
      id,
      Array.from({ length: slotSpan }, (_, slot) => slot)
    );
    await this.firestoreService.updateDocument(
      `${this.userTransactionsPath}/${id}`,
      { receiptUrl: deleteField(), receiptUrls: deleteField(), receiptCount: 0 }
    );
    this.receiptQuota.noteImagesRemoved(count);
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

      // Remove the stored receipt objects to avoid orphaned files. The slot
      // sweep tolerates gaps (tombstoned removals) and never rejects, so the
      // document delete wins either way.
      const imageCount = receiptImageCount(transaction);
      if (transaction && imageCount > 0) {
        const userId = this.authService.userId();
        if (userId) {
          const slotSpan = transaction.receiptUrls?.length ?? 1;
          await this.storageService.deleteReceiptSlots(
            userId,
            id,
            Array.from({ length: slotSpan }, (_, slot) => slot)
          );
        }
        // The document is gone either way, so the images no longer count
        // against the quota
        this.receiptQuota.noteImagesRemoved(imageCount);
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

        // Remove any stored receipts to avoid orphaned files. Best-effort:
        // the slot sweep never rejects.
        if (userId && receiptImageCount(transaction) > 0) {
          const slotSpan = transaction.receiptUrls?.length ?? 1;
          await this.storageService.deleteReceiptSlots(
            userId,
            transaction.id,
            Array.from({ length: slotSpan }, (_, slot) => slot)
          );
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

  /**
   * Non-mutating fetch of every transaction (both types) in a date range.
   * Unlike getTransactions()/getByDateRange(), this leaves the main
   * `transactions` signal untouched; used for aggregate computations that
   * must not disturb the visible list (smart search answers).
   */
  getTransactionsInRange(start: Date, end: Date): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

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
      // Filters on receiptUrl, which stays a string even once a transaction
      // can hold several images — it points at the first one. An inequality
      // against a field that can hold an array would match every document,
      // since Firestore orders arrays after strings. Ordering on the
      // inequality field is implicit, so sort by date client-side instead.
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
