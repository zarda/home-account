import { Injectable, effect, inject, signal, computed, Injector } from '@angular/core';
import {
  DocumentReference,
  Timestamp,
  deleteField,
  Transaction as FirestoreTransaction
} from '@angular/fire/firestore';
import { Observable, map, of, tap } from 'rxjs';
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

/**
 * Thrown when a new link names a goal that does not exist or is no longer
 * active. Only the act of linking demands an active target — a link a row
 * already carries keeps counting through later edits whatever the goal's
 * state, and a vanished goal never blocks an unlink or a delete.
 */
export const GOAL_LINK_INVALID = 'GOAL_LINK_INVALID';
import {
  Transaction,
  TransactionFilters,
  CreateTransactionDTO,
  MonthlyTotal,
  CategoryTotal,
  Goal,
  receiptImageCount,
  baseCurrencyOf
} from '../../models';
import { roundMoney } from '../utils/transaction-aggregation.utils';
import {
  applyClientTransactionFilters,
  buildTransactionWhere
} from '../utils/transaction-query.utils';
import { endOfDay, monthWindow } from '../utils/transaction-date.utils';

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

  constructor() {
    // Root singletons survive the router navigation a sign-out performs, so
    // the published window has to be told or the next account renders the
    // previous account's totals until its first snapshot lands. Driven from
    // here rather than AuthService.signOut() because this service injects
    // AuthService — calling back the other way would close a dependency
    // cycle — and an effect also covers sign-outs the app never initiated
    // (token revocation, another tab). Reset only on the signed-out edge:
    // resetting on sign-in as well could race the first snapshot of a fresh
    // load and blank it with nothing to re-emit.
    effect(() => {
      if (this.authService.userId() === null) {
        this.transactions.set([]);
        this.lastMutation.set(null);
      }
    });
  }

  // Computed signals. Totals go through amountInBase so rows whose stored
  // snapshot is stale (base currency changed) or corrupt (written against
  // unloaded rates) are converted live instead of summed as raw amounts.
  totalIncome = computed(() => {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.currencyService.amountInBase(t, baseCurrency), 0);
  });

  totalExpense = computed(() => {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
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

  // The goals collection, addressed directly rather than through
  // GoalService: the linked counter must commit in the same Firestore
  // transaction as the row write, GoalService reaches into transactions
  // for its delete sweep, and injecting each service into the other would
  // close a cycle for the sake of a template literal.
  private get userGoalsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/goals`;
  }

  // Get transactions with optional filters. A pure query: it never writes the
  // shared `transactions` signal, so importers and detectors can run narrow
  // windows without moving what the dashboard displays. Publishing is owned by
  // getByDateRange alone.
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
        return applyClientTransactionFilters(transactions, filters);
      })
    );
  }

  // Get a single transaction by ID
  getTransactionById(id: string): Observable<Transaction | null> {
    return this.firestoreService.subscribeToDocument<Transaction>(
      `${this.userTransactionsPath}/${id}`
    );
  }

  /**
   * Does a transaction already exist at this id?
   *
   * A one-shot read rather than a subscription: callers writing at
   * deterministic ids (the recurring engine, the queue processor replaying a
   * reclaimed receipt) need to know whether a write already landed before
   * they issue another, and have nothing to keep a subscription alive for.
   */
  async hasTransaction(id: string): Promise<boolean> {
    return (await this.firestoreService.getDocument(
      `${this.userTransactionsPath}/${id}`
    )) !== null;
  }

  /**
   * Add a new transaction.
   *
   * `options.id` writes at a caller-chosen id (backup restore, and the offline
   * queue replaying a row it already keyed). `options.snapshot` writes the
   * base-currency conversion verbatim instead of recomputing it: a restore
   * must not rewrite a row's historical rate at today's, which would both
   * change stored figures and make restoring the same backup twice produce
   * different documents. `options.goalSnapshot` is the same contract for a
   * goal link: the pair is written verbatim and no goal counter is touched —
   * mid-restore the goal may not even exist yet, and the restore flow
   * recomputes every counter from the ledger afterwards. `data.goalId` is the
   * live path instead: the link and the goal's counter commit in one
   * Firestore transaction.
   *
   * `options.merge` and `options.createdAt` are restore-only too. Merging
   * leaves keys the write does not mention alone, which is what stops a
   * restore erasing the receipt fields a live row already carries — a backup
   * holds no storage objects, so it can never re-supply them. The cost is
   * that a restore can no longer *clear* a field the backup dropped. And
   * `createdAt` has to come from the file for the same reason the rate does:
   * stamping now would restamp every pre-existing row and make a second
   * restore of the same file produce different documents.
   */
  async addTransaction(
    data: CreateTransactionDTO,
    options?: {
      id?: string;
      merge?: boolean;
      createdAt?: Timestamp;
      snapshot?: { exchangeRate: number; baseCurrency: string; amountInBaseCurrency: number };
      goalSnapshot?: { goalId: string; goalAmount: number };
    }
  ): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      // firestore.rules rejects non-positive amounts. Fail here so importers
      // get a row they can report rather than an opaque permission error.
      if (!Number.isFinite(data.amount) || data.amount <= 0) {
        throw new Error(INVALID_AMOUNT_ERROR);
      }

      // Both refusals are the same shape as the two below: a merge that cannot
      // reach the write would be dropped in silence, and silence is what made
      // the receipt erasure survive a spec suite. Without an id the write goes
      // through addDocument, which has no merge to pass; with a goal link it
      // goes through createWithGoalLink, whose set() inside runTransaction
      // replaces the document outright — exactly the write being fixed here.
      if (options?.merge && !options.id) {
        throw new Error('A merge write needs a caller-chosen id');
      }
      if (options?.merge && data.goalId) {
        throw new Error('A merge write cannot be combined with a goal link');
      }

      let baseCurrency: string;
      let exchangeRate: number;
      let amountInBaseCurrency: number;
      if (options?.snapshot) {
        // A restore carries the conversion the row was written with; keep it.
        ({ baseCurrency, exchangeRate, amountInBaseCurrency } = options.snapshot);
      } else {
        baseCurrency = baseCurrencyOf(this.authService.currentUser());
        // The persisted base-currency snapshot must never be computed against
        // the not-yet-loaded default rate table (which silently maps unknown
        // currencies to 1:1 and stores raw foreign amounts as base amounts).
        await this.currencyService.ensureRatesLoaded();
        exchangeRate = this.currencyService.getExchangeRate(data.currency, baseCurrency);
        amountInBaseCurrency = data.amount * exchangeRate;
      }

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
        createdAt: options?.createdAt ?? this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp(),
        isRecurring: data.isRecurring ?? false,
        // Only include optional fields if they have values (Firestore rejects undefined)
        ...(data.note ? { note: data.note } : {}),
        ...(data.tags?.length ? { tags: data.tags } : {}),
        ...(data.recurringId ? { recurringId: data.recurringId } : {}),
        ...(data.period ? { period: data.period } : {}),
        ...(data.location ? { location: data.location } : {})
      };

      if (options?.goalSnapshot) {
        // Refused rather than resolved by precedence, like receipts+id below.
        if (data.goalId) {
          throw new Error('A goal snapshot cannot be combined with a goal link');
        }
        transaction.goalId = options.goalSnapshot.goalId;
        transaction.goalAmount = options.goalSnapshot.goalAmount;
      }

      let id: string;
      const receiptFiles = data.receiptFiles ?? [];
      // The receipts branch below has to pre-generate its own id to key the
      // storage objects with, so it cannot also write at the caller's. It used
      // to just win, discarding `options.id` without a word — quiet precedence
      // that turned a caller's idempotency key into no key at all. Refuse the
      // combination instead; no caller has a use for both at once.
      if (receiptFiles.length > 0 && options?.id) {
        throw new Error('A caller-chosen id cannot be combined with receipt files');
      }

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
        if (data.goalId) {
          await this.createWithGoalLink(id, transaction, data.goalId);
        } else {
          await this.firestoreService.setDocument(
            `${this.userTransactionsPath}/${id}`,
            transaction
          );
        }
        this.receiptQuota.noteImagesAdded(urls.length);
      } else if (options?.id) {
        // Caller-supplied deterministic id: writing the same row twice lands
        // on one document instead of duplicating it. Whether that write
        // replaces or merges is the caller's to say — a restore merges so a
        // live row keeps what the file could not carry, while a replayed
        // queue row wants the plain overwrite.
        id = options.id;
        if (data.goalId) {
          await this.createWithGoalLink(id, transaction, data.goalId);
        } else {
          await this.firestoreService.setDocument(
            `${this.userTransactionsPath}/${id}`,
            transaction,
            options.merge ?? false
          );
        }
      } else if (data.goalId) {
        // A linked create commits row and counter together, which needs a
        // ref before the write — so the id is pre-generated like the
        // receipts branch's rather than taken from addDocument.
        id = this.firestoreService.generateId(this.userTransactionsPath);
        await this.createWithGoalLink(id, transaction, data.goalId);
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

  /**
   * Write a new linked row and its goal's counter in one Firestore
   * transaction (the contribute() precedent): the link cannot land without
   * the counter moving, and two devices linking rows to the same goal both
   * land because the loser retries against the winner's counter. The
   * converted figure snapshots here, at write time, against loaded rates.
   */
  private async createWithGoalLink(
    id: string,
    transaction: Omit<Transaction, 'id'>,
    goalId: string
  ): Promise<void> {
    // Same guard as the base-currency snapshot: never against the unloaded
    // 1:1 fallback table.
    await this.currencyService.ensureRatesLoaded();
    const rowRef = this.firestoreService.getDocRef(`${this.userTransactionsPath}/${id}`);
    const goalRef = this.firestoreService.getDocRef(`${this.userGoalsPath}/${goalId}`);

    await this.firestoreService.runTransaction(async tx => {
      const goalSnapshot = await tx.get(goalRef);
      if (!goalSnapshot.exists()) throw new Error(GOAL_LINK_INVALID);
      const goal = goalSnapshot.data() as Goal;
      if (!goal.isActive) throw new Error(GOAL_LINK_INVALID);

      const goalAmount = roundMoney(
        this.currencyService.convert(transaction.amount, transaction.currency, goal.currency)
      );
      tx.set(rowRef, { ...transaction, goalId, goalAmount });
      tx.update(goalRef, {
        linkedAmount: roundMoney((goal.linkedAmount ?? 0) + goalAmount),
        updatedAt: this.firestoreService.getTimestamp()
      });
    });
  }

  /**
   * Stage the goal-counter consequences of an update, against the row as
   * this transaction actually read it. Only reads: it returns the row's
   * link fields and the goal writes for the caller to apply after its own
   * reads, because Firestore orders every read in a transaction before the
   * first write.
   *
   * The stored figure is re-snapshotted only when the update touches amount
   * or currency — an unrelated edit converting at today's rates would move
   * a counter the user never touched. `moneyTouched` is that decision, made
   * once in updateTransaction against the stored row and passed in rather
   * than re-derived here: it is a comparison, not something the shape of
   * `updateData` can be trusted to reveal. Decrements clamp at zero so
   * counter drift can never block an edit; a vanished goal is finished off
   * rather than resurrected; only a NEW link demands an existing, active goal.
   *
   * Precondition: rates are loaded whenever a conversion may be needed
   * (updateTransaction awaits ensureRatesLoaded before any link-involved
   * branch).
   */
  private async stageGoalTransition(
    tx: FirestoreTransaction,
    row: Transaction,
    data: Partial<CreateTransactionDTO>,
    updateData: Partial<Transaction>,
    moneyTouched: boolean
  ): Promise<{
    linkFields: Record<string, unknown>;
    goalWrites: { ref: DocumentReference; data: Record<string, unknown> }[];
  }> {
    const none = { linkFields: {}, goalWrites: [] };
    const oldGoalId = row.goalId;
    // A PRESENCE test, deliberately: it separates "clear the link" (key
    // present, value undefined) from "the caller did not mention it" (key
    // absent), which a truthiness test would collapse into an unlink. Not the
    // same question as the `linkInvolved` gate in updateTransaction, which
    // tests the value.
    const newGoalId = 'goalId' in data ? data.goalId : oldGoalId;
    if (!oldGoalId && !newGoalId) return none;

    const oldGoalAmount = row.goalAmount ?? 0;
    // What the row will hold after this update, whichever side supplies it.
    const amount = updateData.amount ?? row.amount;
    const currency = updateData.currency ?? row.currency;
    const clearedLink = { goalId: deleteField(), goalAmount: deleteField() };
    const goalRefOf = (goalId: string): DocumentReference =>
      this.firestoreService.getDocRef(`${this.userGoalsPath}/${goalId}`);
    const counterWrite = (ref: DocumentReference, linkedAmount: number) => ({
      ref,
      data: {
        linkedAmount: Math.max(0, roundMoney(linkedAmount)),
        updatedAt: this.firestoreService.getTimestamp()
      }
    });

    // Unlink: back the stored figure out and clear the pair.
    if (oldGoalId && !newGoalId) {
      const goalRef = goalRefOf(oldGoalId);
      const snapshot = await tx.get(goalRef);
      if (!snapshot.exists()) return { linkFields: clearedLink, goalWrites: [] };
      const goal = snapshot.data() as Goal;
      return {
        linkFields: clearedLink,
        goalWrites: [counterWrite(goalRef, (goal.linkedAmount ?? 0) - oldGoalAmount)]
      };
    }

    // Link kept (active or not — leaving needs no gate, only arriving does).
    if (oldGoalId && oldGoalId === newGoalId) {
      const goalRef = goalRefOf(oldGoalId);
      const snapshot = await tx.get(goalRef);
      if (!snapshot.exists()) {
        // A deleteGoal sweep raced this edit: finish the sweep's work
        // rather than resurrect a link to nothing.
        return { linkFields: clearedLink, goalWrites: [] };
      }
      if (!moneyTouched) return none;
      const goal = snapshot.data() as Goal;
      const goalAmount = roundMoney(
        this.currencyService.convert(amount, currency, goal.currency)
      );
      if (goalAmount === oldGoalAmount) return none;
      return {
        linkFields: { goalAmount },
        goalWrites: [
          counterWrite(goalRef, (goal.linkedAmount ?? 0) - oldGoalAmount + goalAmount)
        ]
      };
    }

    // New link, possibly a switch: the target must exist and be active.
    const newRef = goalRefOf(newGoalId as string);
    const newSnapshot = await tx.get(newRef);
    if (!newSnapshot.exists()) throw new Error(GOAL_LINK_INVALID);
    const newGoal = newSnapshot.data() as Goal;
    if (!newGoal.isActive) throw new Error(GOAL_LINK_INVALID);
    const goalAmount = roundMoney(
      this.currencyService.convert(amount, currency, newGoal.currency)
    );

    const goalWrites = [counterWrite(newRef, (newGoal.linkedAmount ?? 0) + goalAmount)];
    if (oldGoalId) {
      const oldRef = goalRefOf(oldGoalId);
      const oldSnapshot = await tx.get(oldRef);
      if (oldSnapshot.exists()) {
        const oldGoal = oldSnapshot.data() as Goal;
        goalWrites.push(counterWrite(oldRef, (oldGoal.linkedAmount ?? 0) - oldGoalAmount));
      }
    }
    return { linkFields: { goalId: newGoalId, goalAmount }, goalWrites };
  }

  /**
   * Commit a link-involved update: one transaction re-reads the row, stages
   * the link against that fresh read and adjusts the affected counters, so
   * the link fields and the goal counters cannot disagree.
   */
  private async updateWithGoalSync(
    id: string,
    data: Partial<CreateTransactionDTO>,
    updateData: Partial<Transaction>,
    moneyTouched: boolean
  ): Promise<void> {
    const rowRef = this.firestoreService.getDocRef(`${this.userTransactionsPath}/${id}`);

    await this.firestoreService.runTransaction(async tx => {
      const snapshot = await tx.get(rowRef);
      if (!snapshot.exists()) throw new Error('Transaction not found');

      const staged = await this.stageGoalTransition(
        tx,
        snapshot.data() as Transaction,
        data,
        updateData,
        moneyTouched
      );
      tx.update(rowRef, {
        ...updateData,
        ...staged.linkFields,
        updatedAt: this.firestoreService.getTimestamp()
      });
      for (const write of staged.goalWrites) {
        tx.update(write.ref, write.data);
      }
    });
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
      // value undefined): a cleared location or budget period is removed from
      // the document rather than left at its old value.
      if ('location' in data) {
        updateData.location = data.location
          ?? (deleteField() as unknown as Transaction['location']);
      }
      if ('period' in data) {
        updateData.period = data.period
          ?? (deleteField() as unknown as Transaction['period']);
      }

      if (data.date !== undefined) {
        updateData.date = this.firestoreService.dateToTimestamp(data.date);
      }

      // Whether this edit moved the money, measured against the STORED row
      // rather than against which keys the caller supplied. The transaction
      // form sends amount and currency on every edit, so a key-presence test
      // re-snapshots at today's rate under a description edit — rewriting the
      // row's base-currency value and every total that reads it.
      const moneyTouched = !!currentTransaction && (
        (data.amount !== undefined && data.amount !== currentTransaction.amount) ||
        (data.currency !== undefined && data.currency !== currentTransaction.currency)
      );

      // Recalculate amount in base currency if amount or currency changed
      if (moneyTouched && currentTransaction) {
        const amount = data.amount ?? currentTransaction.amount;
        const currency = data.currency ?? currentTransaction.currency;
        const baseCurrency = baseCurrencyOf(this.authService.currentUser());
        // Same guard as addTransaction: never snapshot against unloaded rates.
        await this.currencyService.ensureRatesLoaded();
        const exchangeRate = this.currencyService.getExchangeRate(currency, baseCurrency);

        updateData.amount = amount;
        updateData.currency = currency;
        updateData.exchangeRate = exchangeRate;
        updateData.amountInBaseCurrency = amount * exchangeRate;
        updateData.baseCurrency = baseCurrency;
      }

      // Whether this update can move a goal counter: it names a link (set or
      // switch), or the row already carries one — which covers clearing it
      // too, since there is nothing to clear otherwise. A test on the VALUE,
      // not the key: the transaction form installs `goalId` on every edit, so
      // a presence test sends every unlinked edit down the transactional path
      // and off the offline-capable one. Not to be confused with the presence
      // test in stageGoalTransition, which answers a different question.
      // Conversions must never run against the unloaded 1:1 fallback table.
      const linkInvolved = !!data.goalId || !!currentTransaction?.goalId;
      if (linkInvolved) {
        await this.currencyService.ensureRatesLoaded();
      }

      // Append newly provided receipt images after the existing ones.
      // Replacing an image is remove-then-attach; an update never overwrites
      // a stored object another writer still references.
      const appendUserId = data.receiptFiles?.length ? this.authService.userId() : null;
      if (data.receiptFiles?.length && appendUserId) {
        const total = receiptImageCount(currentTransaction) + data.receiptFiles.length;
        if (total > MAX_RECEIPTS_PER_TRANSACTION) {
          throw new Error(RECEIPT_ATTACH_FAILED);
        }
        // Appended images are always new — enforce the tier quota
        if (!(await this.receiptQuota.canAddImages(data.receiptFiles.length))) {
          throw new Error(RECEIPT_IMAGE_LIMIT_ERROR);
        }

        const appended = await this.appendReceiptsTransactionally(
          id,
          appendUserId,
          data.receiptFiles,
          this.receiptSlotsOf(currentTransaction).length,
          updateData,
          data,
          moneyTouched
        );
        // After the commit, not before: a placement retry or abort must not
        // bump the local quota count for images that never landed.
        this.receiptQuota.noteImagesAdded(appended);
      } else if (linkInvolved) {
        await this.updateWithGoalSync(id, data, updateData, moneyTouched);
      } else {
        await this.firestoreService.updateDocument(
          `${this.userTransactionsPath}/${id}`,
          updateData
        );
      }

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
   * The slot array as stored: a legacy row's single receiptUrl is its slot 0.
   * Length (tombstones included) is the next free slot — interior tombstones
   * are never reused so images keep their order.
   */
  private receiptSlotsOf(
    transaction: Pick<Transaction, 'receiptUrl' | 'receiptUrls'> | null | undefined
  ): string[] {
    return transaction?.receiptUrls
      ? [...transaction.receiptUrls]
      : transaction?.receiptUrl
        ? [transaction.receiptUrl]
        : [];
  }

  /**
   * The three receipt fields for a slot array, trailing tombstones truncated.
   * A truncated slot is safe to append into later because its object is
   * confirmed gone. Clearing the last image deletes the fields rather than
   * writing [] or '' — the quota query's receiptUrl > '' range filter
   * requires it (ADR 0006).
   */
  private receiptFieldPayload(slots: string[]): Record<string, unknown> {
    const truncated = [...slots];
    while (truncated.length > 0 && !truncated[truncated.length - 1]) truncated.pop();

    const remaining = truncated.filter(url => !!url).length;
    if (remaining === 0) {
      return { receiptUrl: deleteField(), receiptUrls: deleteField(), receiptCount: 0 };
    }
    return {
      // The pointer follows the first live image so the quota query and
      // single-image read sites keep resolving.
      receiptUrl: truncated.find(url => !!url),
      receiptUrls: truncated,
      receiptCount: remaining
    };
  }

  /**
   * Upload the files at optimistically chosen slots, then place their URLs
   * into receiptUrls inside a Firestore transaction that re-reads the
   * document, so a rival's concurrent slot edit is never clobbered by a
   * stale array. The upload has to happen before the transaction (a
   * transaction cannot wait on Storage), which is why placement can fail:
   *
   * - A rival append committed the same indices first: back off and retry at
   *   fresh slots (bounded). The contested keys hold our bytes but the
   *   rival's committed URLs — never delete them; the orphaned uncontested
   *   uploads are invisible and get overwritten by any later append.
   * - The document vanished, or fresh state is at the cap: sweep whatever we
   *   uploaded that no committed entry references, and fail the attach whole.
   *
   * Returns the number of images appended. The scalar fields of updateData
   * commit in the same transaction so an update is atomic as a whole —
   * including, via `data`, any goal-link transition the update carries.
   */
  private async appendReceiptsTransactionally(
    id: string,
    userId: string,
    files: File[],
    optimisticFirstSlot: number,
    updateData: Partial<Transaction>,
    data: Partial<CreateTransactionDTO>,
    moneyTouched: boolean
  ): Promise<number> {
    const path = `${this.userTransactionsPath}/${id}`;
    const docRef = this.firestoreService.getDocRef(path);
    const maxPlacementAttempts = 3;

    let firstSlot = optimisticFirstSlot;
    let uploadedSlots: number[] = [];

    for (let attempt = 1; attempt <= maxPlacementAttempts; attempt++) {
      const urls = await this.uploadReceiptBatch(userId, id, files, firstSlot);
      uploadedSlots = urls.map((_, i) => firstSlot + i);

      let outcome: 'vanished' | 'collision' | 'over_cap' | 'committed';
      try {
        outcome = await this.firestoreService.runTransaction(async tx => {
          const snapshot = await tx.get(docRef);
          if (!snapshot.exists()) return 'vanished';

          const row = snapshot.data() as Transaction;
          const slots = this.receiptSlotsOf(row);
          // A live entry at one of our indices means a rival append won them.
          if (uploadedSlots.some(slot => !!slots[slot])) return 'collision';

          const liveCount = slots.filter(url => !!url).length;
          if (liveCount + urls.length > MAX_RECEIPTS_PER_TRANSACTION) return 'over_cap';

          // Goal reads must land here, after the row read and before the
          // first write (Firestore orders all of a transaction's reads
          // ahead of its writes).
          const staged = await this.stageGoalTransition(
            tx, row, data, updateData, moneyTouched
          );

          // Pad up to our first index with tombstones — a racing removal may
          // have truncated the array underneath the upload — so that
          // index == storage slot keeps holding.
          while (slots.length < firstSlot) slots.push('');
          urls.forEach((url, i) => {
            slots[firstSlot + i] = url;
          });

          tx.update(docRef, {
            ...updateData,
            ...staged.linkFields,
            ...this.receiptFieldPayload(slots),
            updatedAt: this.firestoreService.getTimestamp()
          });
          for (const write of staged.goalWrites) {
            tx.update(write.ref, write.data);
          }
          return 'committed';
        });
      } catch (error) {
        // A link error (dead or inactive goal) aborts the attach whole.
        // Nothing committed references the uploads, so sweep them like any
        // other failed attempt before letting the error surface.
        await this.sweepUncommittedSlots(path, userId, id, uploadedSlots);
        throw error;
      }

      if (outcome === 'committed') return urls.length;

      if (outcome === 'collision' && attempt < maxPlacementAttempts) {
        const fresh = await this.firestoreService.getDocument<Transaction>(path);
        if (fresh) {
          firstSlot = this.receiptSlotsOf(fresh).length;
          continue;
        }
      }
      break;
    }

    await this.sweepUncommittedSlots(path, userId, id, uploadedSlots);
    throw new Error(RECEIPT_ATTACH_FAILED);
  }

  /**
   * Delete the uploaded objects a failed attach left behind — but only at
   * slots no committed entry references: a contested slot is the rival's
   * now, and deleting it would break their committed image.
   */
  private async sweepUncommittedSlots(
    path: string,
    userId: string,
    id: string,
    uploadedSlots: number[]
  ): Promise<void> {
    const fresh = await this.firestoreService.getDocument<Transaction>(path);
    const freshSlots = this.receiptSlotsOf(fresh);
    const orphaned = uploadedSlots.filter(slot => !freshSlots[slot]);
    await this.storageService.deleteReceiptSlots(userId, id, orphaned);
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

    const path = `${this.userTransactionsPath}/${id}`;
    const transaction = await this.firestoreService.getDocument<Transaction>(path);
    if (!transaction) return;
    if (!this.receiptSlotsOf(transaction)[slot]) return;

    // Storage before Firestore, deliberately: the truncation invariant ("a
    // truncated slot is safe to append into because its object is confirmed
    // gone") only holds if the object is deleted before the array commits.
    // Committing first would let this delete land after a racing append
    // reused the slot, silently destroying the appender's object. The
    // residual the other way — this delete lands, then the commit fails —
    // leaves a visibly broken image that retrying the removal heals, since
    // deleteReceipt treats object-not-found as success. See ADR 0007.
    await this.storageService.deleteReceipt(userId, id, slot);

    const docRef = this.firestoreService.getDocRef(path);
    const removed = await this.firestoreService.runTransaction(async tx => {
      const snapshot = await tx.get(docRef);
      if (!snapshot.exists()) return false;

      // Tombstone against the transaction's fresh read, never the earlier
      // one: a rival's tombstone or truncation must not be resurrected by a
      // stale copy of the array.
      const slots = this.receiptSlotsOf(snapshot.data() as Transaction);
      if (!slots[slot]) return false;

      slots[slot] = '';
      tx.update(docRef, {
        ...this.receiptFieldPayload(slots),
        updatedAt: this.firestoreService.getTimestamp()
      });
      return true;
    });

    // Only a commit that actually tombstoned the slot frees a quota slot — a
    // rival that emptied it first already took the decrement.
    if (removed) this.receiptQuota.noteImagesRemoved(1);
  }

  /**
   * Remove every stored receipt image of a transaction, freeing their quota
   * slots. The transaction itself is untouched.
   */
  async removeAllReceipts(id: string): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const path = `${this.userTransactionsPath}/${id}`;
    const transaction = await this.firestoreService.getDocument<Transaction>(path);
    const count = receiptImageCount(transaction);
    if (!transaction || count === 0) return;

    // "Remove what existed when clicked": the sweep covers only the span
    // seen at read time. An appender always targets slots at or past this
    // length, so the sweep cannot hit a racing append's fresh object — its
    // entries survive the clear instead. Storage before Firestore for the
    // same reason as removeReceiptAt.
    const slotSpan = transaction.receiptUrls?.length ?? 1;
    await this.storageService.deleteReceiptSlots(
      userId,
      id,
      Array.from({ length: slotSpan }, (_, slot) => slot)
    );

    const docRef = this.firestoreService.getDocRef(path);
    const removed = await this.firestoreService.runTransaction(async tx => {
      const snapshot = await tx.get(docRef);
      if (!snapshot.exists()) return 0;

      const slots = this.receiptSlotsOf(snapshot.data() as Transaction);
      let tombstoned = 0;
      for (let slot = 0; slot < slotSpan && slot < slots.length; slot++) {
        if (slots[slot]) {
          slots[slot] = '';
          tombstoned += 1;
        }
      }
      if (tombstoned === 0) return 0;

      tx.update(docRef, {
        ...this.receiptFieldPayload(slots),
        updatedAt: this.firestoreService.getTimestamp()
      });
      return tombstoned;
    });

    // The delta is what the commit actually tombstoned, not the count seen
    // at read time — a rival removal may have taken some slots first.
    if (removed > 0) this.receiptQuota.noteImagesRemoved(removed);
  }

  // Delete a transaction
  async deleteTransaction(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      // Get the transaction before deleting to know which budget to update
      const transaction = await this.firestoreService.getDocument<Transaction>(
        `${this.userTransactionsPath}/${id}`
      );

      if (transaction?.goalId) {
        // A linked row's delete and its counter back-out commit together.
        // The tx's own read decides what to back out, so the figure is the
        // one actually stored; a goal already gone never blocks the delete.
        // Unlinked deletes keep the plain (offline-capable) path below —
        // a transaction requires the network, as every link write does.
        const rowRef = this.firestoreService.getDocRef(`${this.userTransactionsPath}/${id}`);
        await this.firestoreService.runTransaction(async tx => {
          const snapshot = await tx.get(rowRef);
          if (!snapshot.exists()) return;

          const row = snapshot.data() as Transaction;
          let goalWrite: { ref: DocumentReference; data: Record<string, unknown> } | null = null;
          if (row.goalId) {
            const goalRef = this.firestoreService.getDocRef(
              `${this.userGoalsPath}/${row.goalId}`
            );
            const goalSnapshot = await tx.get(goalRef);
            if (goalSnapshot.exists()) {
              const goal = goalSnapshot.data() as Goal;
              goalWrite = {
                ref: goalRef,
                data: {
                  linkedAmount: Math.max(
                    0,
                    roundMoney((goal.linkedAmount ?? 0) - (row.goalAmount ?? 0))
                  ),
                  updatedAt: this.firestoreService.getTimestamp()
                }
              };
            }
          }
          tx.delete(rowRef);
          if (goalWrite) tx.update(goalWrite.ref, goalWrite.data);
        });
      } else {
        await this.firestoreService.deleteDocument(
          `${this.userTransactionsPath}/${id}`
        );
      }

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

  /**
   * Delete every transaction in the account (danger zone). Returns how many
   * documents were actually removed, so the caller can report a number rather
   * than an unconditional "all deleted".
   *
   * Enumerates the collection, never the `transactions` signal: that signal
   * holds only whatever the last live query published — usually the current
   * month, and nothing at all if the user reached Settings without visiting
   * the dashboard first. Reading it deleted a slice of the account and called
   * it complete.
   */
  async deleteAllTransactions(): Promise<number> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      const transactions = await this.firestoreService.getCollection<Transaction>(
        this.userTransactionsPath
      );

      let deleted = 0;
      let lastId = '';
      for (const transaction of transactions) {
        await this.firestoreService.deleteDocument(
          `${this.userTransactionsPath}/${transaction.id}`
        );
        deleted++;
        lastId = transaction.id;

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

      // Every link died with the wipe, so every counter must read zero —
      // else the goals would keep reporting progress from rows that no
      // longer exist.
      const goals = await this.firestoreService.getCollection<Goal>(this.userGoalsPath);
      for (const goal of goals) {
        if ((goal.linkedAmount ?? 0) !== 0) {
          await this.firestoreService.updateDocument(
            `${this.userGoalsPath}/${goal.id}`,
            { linkedAmount: 0 }
          );
        }
      }

      this.transactions.set([]);
      // Everything is gone — force a quota recount on next check
      this.receiptQuota.invalidateCount();
      // One mutation for the whole wipe. Consumers refresh their window per
      // emission, so emitting per row would trigger a refresh per row.
      if (deleted > 0) {
        this.noteMutation('delete', lastId);
      }

      return deleted;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Get transactions by date range. The ONE path that publishes the shared
  // `transactions` signal the dashboard and reports render from — every other
  // reader in this service is non-mutating by contract, so a query run for
  // duplicate detection or AI import cannot repaint the visible window.
  getByDateRange(start: Date, end: Date): Observable<Transaction[]> {
    return this.getTransactions({
      startDate: start,
      endDate: end
    }).pipe(
      tap(result => this.transactions.set(result))
    );
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
        { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(end)) }
      ]
    };

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        const baseCurrency = baseCurrencyOf(this.authService.currentUser());
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
    // One-based month here, unlike everywhere else in the app.
    const { start: startDate, end: endDate } = monthWindow({ year, month: month - 1 });

    return this.getByDateRange(startDate, endDate).pipe(
      map(transactions => {
        const baseCurrency = baseCurrencyOf(this.authService.currentUser());
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
        { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(end)) }
      ]
    };

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    ).pipe(
      map(transactions => {
        const baseCurrency = baseCurrencyOf(this.authService.currentUser());
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
        { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(end)) }
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
   * Unlike getByDateRange(), this leaves the main `transactions` signal
   * untouched; used for aggregate computations that must not disturb the
   * visible list (smart search answers).
   */
  getTransactionsInRange(start: Date, end: Date): Observable<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    const options: Parameters<typeof this.firestoreService.subscribeToCollection>[1] = {
      orderBy: [{ field: 'date', direction: 'desc' }],
      where: [
        { field: 'date', op: '>=', value: Timestamp.fromDate(start) },
        { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(end)) }
      ]
    };

    return this.firestoreService.subscribeToCollection<Transaction>(
      this.userTransactionsPath,
      options
    );
  }

  private groupByCategory(transactions: Transaction[]): CategoryTotal[] {
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
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

  /**
   * One-shot read of every transaction, for the backup and CSV exports.
   *
   * Answered by the server, not the cache: this read gates account deletion,
   * and with the persistent cache enabled a warm session's first listener
   * emission is whatever narrow windows it happened to browse. Offline it
   * rejects, so the export reports failure instead of writing a subset and
   * calling it a backup.
   */
  async exportAll(): Promise<Transaction[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollectionFromServer<Transaction>(
      this.userTransactionsPath,
      { orderBy: [{ field: 'date', direction: 'desc' }] }
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
    const { start: startDate, end: endDate } = monthWindow({ year, month });

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
