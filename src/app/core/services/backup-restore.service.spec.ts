import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';

import {
  BackupRestoreService,
  INVALID_BACKUP_FORMAT,
  UNSUPPORTED_BACKUP_VERSION,
} from './backup-restore.service';
import { ExportData } from './export.service';
import { TransactionService } from './transaction.service';
import { CategoryService } from './category.service';
import { BudgetService } from './budget.service';
import { INVALID_FREQUENCY_ERROR, RecurringService } from './recurring.service';
import { InsightSnapshotService } from './insight-snapshot.service';
import { GoalService } from './goal.service';
import { SearchHistoryService } from './search-history.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { CategoryMemoryService } from './category-memory.service';
import { TagMemoryService } from './tag-memory.service';
import { ImportHistoryService } from './import-history.service';
import {
  Budget,
  Category,
  CategoryMemoryEntry,
  Goal,
  ImportHistory,
  InsightSnapshot,
  RecurringTransaction,
  SavedSearch,
  SearchRecord,
  TagMemoryEntry,
  Transaction
} from '../../models';

describe('BackupRestoreService', () => {
  let service: BackupRestoreService;
  let transactions: jasmine.SpyObj<TransactionService>;
  let categories: jasmine.SpyObj<CategoryService>;
  let budgets: jasmine.SpyObj<BudgetService>;
  let recurring: jasmine.SpyObj<RecurringService>;
  let snapshots: jasmine.SpyObj<InsightSnapshotService>;
  let goals: jasmine.SpyObj<GoalService>;
  let searchHistory: jasmine.SpyObj<SearchHistoryService>;
  let searchAnswers: jasmine.SpyObj<SearchAnswerHistoryService>;
  let categoryMemory: jasmine.SpyObj<CategoryMemoryService>;
  let tagMemory: jasmine.SpyObj<TagMemoryService>;
  let importHistory: jasmine.SpyObj<ImportHistoryService>;

  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

  function transaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 'txn-1',
      userId: 'user-a',
      type: 'expense',
      amount: 1200,
      currency: 'THB',
      amountInBaseCurrency: 34.78,
      exchangeRate: 0.029,
      baseCurrency: 'USD',
      categoryId: 'food_restaurants',
      description: 'Dinner',
      date: ts('2026-06-15'),
      createdAt: ts('2026-06-15'),
      updatedAt: ts('2026-06-15'),
      isRecurring: false,
      ...overrides,
    } as Transaction;
  }

  function category(overrides: Partial<Category> = {}): Category {
    return {
      id: 'cat-1',
      userId: 'user-a',
      name: 'Bouldering',
      icon: 'sports_handball',
      color: '#ff8800',
      type: 'expense',
      order: 5,
      isActive: true,
      isDefault: false,
      ...overrides,
    } as Category;
  }

  function recurringRule(overrides: Partial<RecurringTransaction> = {}): RecurringTransaction {
    return {
      id: 'r-1',
      userId: 'user-a',
      name: 'Rent',
      type: 'expense',
      amount: 1200,
      currency: 'USD',
      categoryId: 'housing_rent',
      description: 'Rent',
      frequency: { type: 'monthly', interval: 1 },
      startDate: ts('2026-01-01'),
      nextOccurrence: ts('2026-07-01'),
      isActive: true,
      ...overrides,
    } as RecurringTransaction;
  }

  function goal(overrides: Partial<Goal> = {}): Goal {
    return {
      id: 'g-1',
      userId: 'user-a',
      kind: 'project',
      name: 'Japan trip',
      targetAmount: 2000,
      contributedAmount: 750,
      currency: 'USD',
      targetDate: ts('2027-04-01'),
      items: [{ name: 'Flights', amount: 800, done: true }],
      isActive: true,
      createdAt: ts('2026-08-01'),
      updatedAt: ts('2026-08-01'),
      ...overrides,
    } as Goal;
  }

  function savedSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
    return {
      id: 's-1', userId: 'user-a', query: 'coffee', pinned: false,
      lastUsedAt: ts('2026-08-01'),
      ...overrides,
    } as SavedSearch;
  }

  function searchAnswer(overrides: Record<string, unknown> = {}): SearchRecord {
    return {
      id: 'a-1', userId: 'user-a', schemaVersion: 2, kind: 'aggregate',
      query: 'how much on coffee', operation: 'sum', limit: 3,
      scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
      baseCurrency: 'USD', value: 42, transactionCount: 7,
      computedAt: ts('2026-08-31'), lastUsedAt: ts('2026-08-31'),
      ...overrides,
    } as unknown as SearchRecord;
  }

  function memory(overrides: Partial<CategoryMemoryEntry> = {}): CategoryMemoryEntry {
    return {
      merchantKey: 'starbucks', categoryId: 'food_coffee',
      sampleDescription: 'STARBUCKS #123', count: 3,
      ...overrides,
    } as CategoryMemoryEntry;
  }

  function tags(overrides: Partial<TagMemoryEntry> = {}): TagMemoryEntry {
    return {
      merchantKey: 'starbucks', tags: ['coffee'], suppressed: [],
      sampleDescription: 'STARBUCKS #123', count: 2,
      ...overrides,
    } as TagMemoryEntry;
  }

  function importRecord(overrides: Partial<ImportHistory> = {}): ImportHistory {
    return {
      id: 'i-1', userId: 'user-a', importedAt: ts('2026-07-01'), source: 'csv',
      fileType: 'generic_csv', fileName: 'statement.csv', fileSize: 1024,
      transactionCount: 1, successCount: 1, skippedCount: 0, errorCount: 0,
      totalIncome: 0, totalExpenses: 1200, status: 'completed', duplicatesSkipped: 0,
      ...overrides,
    } as ImportHistory;
  }

  function backup(overrides: Partial<ExportData> = {}): ExportData {
    return {
      transactions: [], categories: [], budgets: [], recurring: [], insightSnapshots: [],
      goals: [],
      savedSearches: [], searchAnswers: [], categoryMemory: [], tagMemory: [], imports: [],
      exportDate: '2026-08-01T00:00:00.000Z',
      version: '1.2',
      ...overrides,
    };
  }

  beforeEach(() => {
    transactions = jasmine.createSpyObj<TransactionService>('TransactionService', ['addTransaction']);
    transactions.addTransaction.and.resolveTo('id');
    categories = jasmine.createSpyObj<CategoryService>('CategoryService', ['addCategory']);
    categories.addCategory.and.resolveTo('id');
    budgets = jasmine.createSpyObj<BudgetService>('BudgetService', ['createBudget']);
    budgets.createBudget.and.resolveTo('id');
    recurring = jasmine.createSpyObj<RecurringService>('RecurringService', ['createRecurring']);
    recurring.createRecurring.and.resolveTo('id');
    snapshots = jasmine.createSpyObj<InsightSnapshotService>('InsightSnapshotService', ['restore']);
    snapshots.restore.and.resolveTo('written');
    goals = jasmine.createSpyObj<GoalService>('GoalService', [
      'createGoal', 'recomputeLinkedAmount'
    ]);
    goals.createGoal.and.resolveTo('id');
    goals.recomputeLinkedAmount.and.resolveTo();
    searchHistory = jasmine.createSpyObj<SearchHistoryService>('SearchHistoryService', ['restore']);
    searchHistory.restore.and.resolveTo();
    searchAnswers = jasmine.createSpyObj<SearchAnswerHistoryService>(
      'SearchAnswerHistoryService', ['restore']);
    searchAnswers.restore.and.resolveTo();
    categoryMemory = jasmine.createSpyObj<CategoryMemoryService>(
      'CategoryMemoryService', ['restore']);
    categoryMemory.restore.and.resolveTo();
    tagMemory = jasmine.createSpyObj<TagMemoryService>('TagMemoryService', ['restore']);
    tagMemory.restore.and.resolveTo();
    importHistory = jasmine.createSpyObj<ImportHistoryService>('ImportHistoryService', ['restore']);
    importHistory.restore.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        BackupRestoreService,
        { provide: TransactionService, useValue: transactions },
        { provide: CategoryService, useValue: categories },
        { provide: BudgetService, useValue: budgets },
        { provide: RecurringService, useValue: recurring },
        { provide: InsightSnapshotService, useValue: snapshots },
        { provide: GoalService, useValue: goals },
        { provide: SearchHistoryService, useValue: searchHistory },
        { provide: SearchAnswerHistoryService, useValue: searchAnswers },
        { provide: CategoryMemoryService, useValue: categoryMemory },
        { provide: TagMemoryService, useValue: tagMemory },
        { provide: ImportHistoryService, useValue: importHistory },
      ],
    });
    service = TestBed.inject(BackupRestoreService);
  });

  describe('parse', () => {
    it('rejects a file that is not a backup', () => {
      expect(() => service.parse({ nope: true })).toThrowError(INVALID_BACKUP_FORMAT);
      expect(() => service.parse(null)).toThrowError(INVALID_BACKUP_FORMAT);
    });

    // BACKUP_SCHEMA_VERSION was written on export and never read on import, so
    // a file from a newer build was half-restored without a word.
    it('refuses a version this build does not know', () => {
      expect(() => service.parse({ transactions: [], version: '9.9' }))
        .toThrowError(UNSUPPORTED_BACKUP_VERSION);
    });

    it('accepts every version this build can read', () => {
      for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5']) {
        expect(service.parse({ transactions: [], version }).version).toBe(version);
      }
    });

    it('treats a versionless file as the oldest schema rather than refusing it', () => {
      expect(service.parse({ transactions: [] }).version).toBe('1.0');
    });

    it('defaults the sections an older backup does not carry', () => {
      const data = service.parse({ transactions: [], version: '1.0' });
      expect(data.categories).toEqual([]);
      expect(data.budgets).toEqual([]);
      expect(data.recurring).toEqual([]);
      expect(data.insightSnapshots).toEqual([]);
      // The five 1.5 added. A 1.4 file carries none of them and must still
      // restore rather than reaching a section-loop with an undefined.
      expect(data.savedSearches).toEqual([]);
      expect(data.searchAnswers).toEqual([]);
      expect(data.categoryMemory).toEqual([]);
      expect(data.tagMemory).toEqual([]);
      expect(data.imports).toEqual([]);
    });

    it('keeps the five new sections a 1.5 file does carry', () => {
      const data = service.parse({
        transactions: [],
        version: '1.5',
        savedSearches: [{ id: 's-1' }],
        searchAnswers: [{ id: 'a-1' }],
        categoryMemory: [{ merchantKey: 'starbucks' }],
        tagMemory: [{ merchantKey: 'starbucks' }],
        imports: [{ id: 'i-1' }],
      });

      expect(data.savedSearches?.length).toBe(1);
      expect(data.searchAnswers?.length).toBe(1);
      expect(data.categoryMemory?.length).toBe(1);
      expect(data.tagMemory?.length).toBe(1);
      expect(data.imports?.length).toBe(1);
    });
  });

  describe('restore', () => {
    // The regression. importJSON validated and mapped only data.transactions;
    // categories and insight snapshots were never read, and budgets and
    // recurring rules were in neither the export nor the import.
    it('writes back every section the exporter produces', async () => {
      const summary = await service.restore(backup({
        transactions: [transaction()],
        categories: [category()],
        budgets: [{ id: 'b-1', categoryId: 'food_restaurants', name: 'Food', amount: 300,
          currency: 'USD', period: 'monthly', startDate: ts('2026-06-01'), spent: 0,
          isActive: true, alertThreshold: 80 } as Budget],
        recurring: [{ id: 'r-1', userId: 'user-a', name: 'Rent', type: 'expense', amount: 1200,
          currency: 'USD', categoryId: 'housing_rent', description: 'Rent',
          frequency: { type: 'monthly', interval: 1 }, startDate: ts('2026-01-01'),
          nextOccurrence: ts('2026-07-01'), isActive: true } as RecurringTransaction],
        goals: [goal()],
        insightSnapshots: [{ id: '2026-06', monthKey: '2026-06',
          generatedAt: ts('2026-07-01'), createdAt: ts('2026-07-01') } as InsightSnapshot],
      }));

      // The whole shape, not objectContaining: goals were absent from this
      // assertion, which is how the component came to leave them out of the
      // total it reports. A seventh section has to be added here to pass.
      expect(summary).toEqual({
        transactions: 1, categories: 1, budgets: 1, recurring: 1, goals: 1,
        insightSnapshots: 1,
        savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
        skipped: [],
      });
    });

    // Restoring used to call addTransaction with no id — an unconditional
    // addDoc — so a second restore doubled every balance, budget and chart
    // while reporting success.
    it('writes every row at the id the backup carries', async () => {
      await service.restore(backup({
        transactions: [transaction({ id: 'txn-42' })],
        categories: [category({ id: 'cat-7' })],
      }));

      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.anything(), jasmine.objectContaining({ id: 'txn-42' }));
      expect(categories.addCategory).toHaveBeenCalledWith(
        jasmine.anything(), jasmine.objectContaining({ id: 'cat-7' }));
    });

    it('restores the same file twice with the same ids, so the second is a no-op', async () => {
      const data = backup({ transactions: [transaction({ id: 'txn-42' })] });

      await service.restore(data);
      await service.restore(data);

      const ids = transactions.addTransaction.calls.allArgs()
        .map(([, options]) => (options as { id?: string })?.id);
      expect(ids).toEqual(['txn-42', 'txn-42']);
    });

    // addTransaction recomputes the base-currency conversion at today's rate.
    // On a restore that silently rewrites a historical figure, and makes the
    // second restore of the same file produce a different document.
    it('preserves the stored base-currency snapshot rather than reconverting', async () => {
      await service.restore(backup({ transactions: [transaction()] }));

      const [, options] = transactions.addTransaction.calls.mostRecent().args;
      expect((options as { snapshot?: unknown }).snapshot).toEqual({
        exchangeRate: 0.029,
        baseCurrency: 'USD',
        amountInBaseCurrency: 34.78,
      });
    });

    // Both halves of the receipt contract. A backup holds no storage objects,
    // so a receiptUrl can never be sourced from one — but the write that
    // followed replaced the whole document, which erased the receipts the
    // live row already had, and Storage objects are reachable only through
    // the transaction that names them, so nothing could ever reclaim them.
    it('sources no receipt field from the file, and merges so the stored ones survive', async () => {
      await service.restore(backup({
        transactions: [transaction({
          receiptUrl: 'https://example.test/r0.png',
          receiptUrls: ['https://example.test/r0.png'],
          receiptCount: 1,
        })],
      }));

      const [dto, options] = transactions.addTransaction.calls.mostRecent().args;
      const written = dto as unknown as Record<string, unknown>;
      expect('receiptUrl' in written).toBeFalse();
      expect('receiptUrls' in written).toBeFalse();
      expect('receiptCount' in written).toBeFalse();
      expect('receiptFiles' in written).toBeFalse();
      expect((options as { merge?: boolean }).merge).toBeTrue();
    });

    // Restore used to stamp createdAt at today, so every pre-existing row was
    // restamped and the second restore of one file produced different
    // documents than the first.
    it('writes the createdAt the file carries rather than stamping today', async () => {
      await service.restore(backup({
        transactions: [transaction({ createdAt: ts('2026-06-15') })],
      }));

      const [, options] = transactions.addTransaction.calls.mostRecent().args;
      expect((options as { createdAt?: Timestamp }).createdAt).toEqual(ts('2026-06-15'));
    });

    // Without it the subscription detector reads engine-posted history as
    // untagged charges and re-offers rules the user already declared.
    it('restores the link to the rule that posted a row', async () => {
      await service.restore(backup({
        transactions: [transaction({ recurringId: 'r-9' })],
      }));

      const [dto] = transactions.addTransaction.calls.mostRecent().args;
      expect(dto.recurringId).toBe('r-9');
    });

    it('omits recurringId for a row no rule posted, rather than writing an empty one', async () => {
      await service.restore(backup({ transactions: [transaction()] }));

      const [dto] = transactions.addTransaction.calls.mostRecent().args;
      expect('recurringId' in dto).toBeFalse();
    });

    // The field alone says "part of a split"; the composer carries it back
    // in the same shape as recurringId, so the group survives a restore.
    it('restores the group id of a row that was part of a split purchase', async () => {
      await service.restore(backup({
        transactions: [transaction({ splitGroupId: 'txn-1' })],
      }));

      const [dto] = transactions.addTransaction.calls.mostRecent().args;
      expect(dto.splitGroupId).toBe('txn-1');
    });

    it('carries the budget period a backed-up transaction was saved with', async () => {
      await service.restore(backup({
        transactions: [transaction({ period: 'monthly' })],
      }));

      const [dto] = transactions.addTransaction.calls.mostRecent().args;
      expect(dto.period).toBe('monthly');
    });

    // Restoring onto a clean account used to leave every transaction pointing
    // at a category document that was never written.
    it('writes categories before the transactions that reference them', async () => {
      const order: string[] = [];
      categories.addCategory.and.callFake(async () => { order.push('category'); return 'id'; });
      transactions.addTransaction.and.callFake(async () => { order.push('transaction'); return 'id'; });

      await service.restore(backup({
        transactions: [transaction()],
        categories: [category()],
      }));

      expect(order).toEqual(['category', 'transaction']);
    });

    // createBudget recomputes `spent` from the ledger, so it has to see the
    // restored transactions.
    it('writes budgets after the transactions their spend is computed from', async () => {
      const order: string[] = [];
      transactions.addTransaction.and.callFake(async () => { order.push('transaction'); return 'id'; });
      budgets.createBudget.and.callFake(async () => { order.push('budget'); return 'id'; });

      await service.restore(backup({
        transactions: [transaction()],
        budgets: [{ id: 'b-1', categoryId: 'food_restaurants', name: 'Food', amount: 300,
          currency: 'USD', period: 'monthly', startDate: ts('2026-06-01'), spent: 0,
          isActive: true, alertThreshold: 80 } as Budget],
      }));

      expect(order).toEqual(['transaction', 'budget']);
    });

    it('skips the built-in categories, which are generated rather than stored', async () => {
      await service.restore(backup({
        categories: [category({ id: 'food', isDefault: true }), category({ id: 'cat-1' })],
      }));

      expect(categories.addCategory).toHaveBeenCalledTimes(1);
      expect(categories.addCategory).toHaveBeenCalledWith(
        jasmine.anything(), jasmine.objectContaining({ id: 'cat-1' }));
    });

    it('reports the rows it could not write instead of abandoning the rest', async () => {
      transactions.addTransaction.and.callFake(async (dto) => {
        if (dto.description === 'Bad') throw new Error('Invalid amount');
        return 'id';
      });

      const summary = await service.restore(backup({
        transactions: [
          transaction({ id: 'good-1' }),
          transaction({ id: 'bad-1', description: 'Bad' }),
          transaction({ id: 'good-2' }),
        ],
      }));

      expect(summary.transactions).toBe(2);
      expect(summary.skipped).toEqual([
        { section: 'transactions', id: 'bad-1', reason: 'Invalid amount' },
      ]);
    });

    // A backup is restored verbatim, so a rule saved with an interval that
    // cannot advance comes back exactly as it was stored. The rule now
    // refuses it, and the refusal has to land in the same per-row report the
    // rest of the restore uses rather than taking the whole file down with it.
    it('reports a rule whose frequency cannot advance as skipped', async () => {
      recurring.createRecurring.and.callFake(async (dto) => {
        if (dto.frequency.interval < 1) throw new Error(INVALID_FREQUENCY_ERROR);
        return 'id';
      });

      const summary = await service.restore(backup({
        recurring: [
          recurringRule({ id: 'r-good' }),
          recurringRule({ id: 'r-stuck', frequency: { type: 'daily', interval: 0 } }),
        ],
      }));

      expect(summary.recurring).toBe(1);
      expect(summary.skipped).toEqual([
        { section: 'recurring', id: 'r-stuck', reason: INVALID_FREQUENCY_ERROR },
      ]);
    });
  });

  // The create paths hard-coded isActive: true, so a restore switched
  // everything back on. Catch-up runs unprompted on every dashboard load, so
  // a resurrected rule starts posting money the user had stopped.
  describe('the active flag', () => {
    it('brings a paused rule back paused', async () => {
      await service.restore(backup({
        recurring: [recurringRule({ id: 'r-paused', isActive: false })],
      }));

      expect(recurring.createRecurring).toHaveBeenCalledWith(
        jasmine.anything(), { id: 'r-paused', isActive: false });
    });

    it('brings a running rule back running', async () => {
      await service.restore(backup({ recurring: [recurringRule({ id: 'r-live' })] }));

      expect(recurring.createRecurring).toHaveBeenCalledWith(
        jasmine.anything(), { id: 'r-live', isActive: true });
    });

    // Deleting a category is a soft delete, so the file records the deletion
    // and the restore has to honour it rather than repopulating every picker.
    it('leaves a deleted category deleted', async () => {
      await service.restore(backup({
        categories: [category({ id: 'cat-gone', isActive: false })],
      }));

      expect(categories.addCategory).toHaveBeenCalledWith(
        jasmine.anything(), { id: 'cat-gone', isActive: false });
    });

    // Latent: nothing in the app can deactivate a budget or a goal yet. Pinned
    // so wiring up archiving later does not have to rediscover this.
    it('threads the flag for budgets and goals too', async () => {
      await service.restore(backup({
        version: '1.3',
        budgets: [{ id: 'b-off', categoryId: 'food_restaurants', name: 'Food', amount: 300,
          currency: 'USD', period: 'monthly', startDate: ts('2026-06-01'), spent: 0,
          isActive: false, alertThreshold: 80 } as Budget],
        goals: [goal({ id: 'g-off', isActive: false })],
      }));

      expect(budgets.createBudget).toHaveBeenCalledWith(
        jasmine.anything(), { id: 'b-off', isActive: false });
      expect(goals.createGoal).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({ id: 'g-off', isActive: false }));
    });

    // A backup written before the flag existed: those rows were all live.
    it('reads an absent flag as active', async () => {
      const rule = recurringRule({ id: 'r-old' });
      delete (rule as Partial<RecurringTransaction>).isActive;

      await service.restore(backup({ recurring: [rule] }));

      expect(recurring.createRecurring).toHaveBeenCalledWith(
        jasmine.anything(), { id: 'r-old', isActive: true });
    });
  });

  // A field missing from the restore's own list is dropped in silence: the
  // export carries the whole document, so only this side can lose it.
  describe('the reminder lead time', () => {
    it('brings a rule back with its lead time', async () => {
      await service.restore(backup({
        recurring: [recurringRule({ id: 'r-lead', remindDaysBefore: 3 })],
      }));

      const dto = recurring.createRecurring.calls.mostRecent().args[0];
      expect(dto.remindDaysBefore).toBe(3);
    });

    // Zero means "on the day", and a truthiness spread reads it as no
    // reminder at all.
    it('brings back a zero lead time', async () => {
      await service.restore(backup({
        recurring: [recurringRule({ id: 'r-same-day', remindDaysBefore: 0 })],
      }));

      const dto = recurring.createRecurring.calls.mostRecent().args[0];
      expect(dto.remindDaysBefore).toBe(0);
    });

    it('sends none for a rule saved without one', async () => {
      await service.restore(backup({ recurring: [recurringRule({ id: 'r-silent' })] }));

      const dto = recurring.createRecurring.calls.mostRecent().args[0];
      expect('remindDaysBefore' in dto).toBeFalse();
    });
  });

  // Restoring the same file twice is supposed to be a no-op, but the rules
  // demand a strictly higher revision on every snapshot rewrite, so the second
  // run reported every month as skipped in the one flow built to be idempotent.
  describe('insight snapshots', () => {
    const snapshot = (id: string) => ({
      id, monthKey: id, revision: 1,
      generatedAt: ts('2026-07-01'), createdAt: ts('2026-07-01'),
    } as InsightSnapshot);

    it('counts a month left alone because the stored one is already current', async () => {
      snapshots.restore.and.resolveTo('alreadyCurrent');

      const summary = await service.restore(backup({
        insightSnapshots: [snapshot('2026-06'), snapshot('2026-07')],
      }));

      expect(summary.insightSnapshots).toBe(2);
      expect(summary.skipped).toEqual([]);
    });

    it('still reports a month it genuinely could not write', async () => {
      snapshots.restore.and.rejectWith(new Error('PERMISSION_DENIED'));

      const summary = await service.restore(backup({
        insightSnapshots: [snapshot('2026-06')],
      }));

      expect(summary.insightSnapshots).toBe(0);
      expect(summary.skipped).toEqual([
        { section: 'insightSnapshots', id: '2026-06', reason: 'PERMISSION_DENIED' },
      ]);
    });
  });


  describe('the five sections 1.5 added', () => {
    it('hands each door the record at its own id', async () => {
      const summary = await service.restore(backup({
        version: '1.5',
        savedSearches: [savedSearch({ id: 's-9' })],
        searchAnswers: [searchAnswer({ id: 'a-9' })],
        categoryMemory: [memory({ merchantKey: 'costa' })],
        tagMemory: [tags({ merchantKey: 'costa' })],
        imports: [importRecord({ id: 'i-9' })],
      }));

      expect(searchHistory.restore).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 's-9' }) as never);
      expect(searchAnswers.restore).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'a-9' }) as never);
      expect(categoryMemory.restore).toHaveBeenCalledWith(
        jasmine.objectContaining({ merchantKey: 'costa' }) as never);
      expect(tagMemory.restore).toHaveBeenCalledWith(
        jasmine.objectContaining({ merchantKey: 'costa' }) as never);
      expect(importHistory.restore).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'i-9' }) as never);
      expect(summary).toEqual(jasmine.objectContaining({
        savedSearches: 1, searchAnswers: 1, categoryMemory: 1, tagMemory: 1, imports: 1,
      }));
    });

    it('restores the import history after the transactions it names', async () => {
      // transactionIds is pruned against what the transactions loop actually
      // wrote, so the order is load-bearing rather than tidy.
      const order: string[] = [];
      transactions.addTransaction.and.callFake(async () => {
        order.push('transaction');
        return 'id';
      });
      importHistory.restore.and.callFake(async () => {
        order.push('import');
      });

      await service.restore(backup({
        version: '1.5',
        transactions: [transaction()],
        imports: [importRecord()],
      }));

      expect(order).toEqual(['transaction', 'import']);
    });

    it('drops a transaction id the restore could not write, and says so in the count', async () => {
      transactions.addTransaction.and.callFake(async (_dto, options) => {
        if (options?.id === 'txn-2') throw new Error('permission-denied');
        return 'id';
      });

      await service.restore(backup({
        version: '1.5',
        transactions: [transaction({ id: 'txn-1' }), transaction({ id: 'txn-2' })],
        imports: [importRecord({
          transactionIds: ['txn-1', 'txn-2'],
          successCount: 2,
          transactionCount: 2,
        })],
      }));

      expect(importHistory.restore).toHaveBeenCalledWith(jasmine.objectContaining({
        transactionIds: ['txn-1'],
        successCount: 1,
      }) as never);
    });

    it('leaves a transaction id the file never carried alone', async () => {
      // An id the backup does not mention was never offered to the restore, so
      // it is not a row the restore skipped — the account may well hold it.
      await service.restore(backup({
        version: '1.5',
        transactions: [transaction({ id: 'txn-1' })],
        imports: [importRecord({ transactionIds: ['txn-1', 'txn-from-another-import'], successCount: 2 })],
      }));

      expect(importHistory.restore).toHaveBeenCalledWith(jasmine.objectContaining({
        transactionIds: ['txn-1', 'txn-from-another-import'],
        successCount: 2,
      }) as never);
    });

    it('records a door that refused, without stopping the section', async () => {
      searchHistory.restore.and.callFake(async (record: SavedSearch) => {
        if (record.id === 's-2') throw new Error('permission-denied');
      });

      const summary = await service.restore(backup({
        version: '1.5',
        savedSearches: [savedSearch({ id: 's-1' }), savedSearch({ id: 's-2' }), savedSearch({ id: 's-3' })],
      }));

      expect(summary.savedSearches).toBe(2);
      expect(summary.skipped).toEqual([
        { section: 'savedSearches', id: 's-2', reason: 'permission-denied' },
      ]);
    });

    it('leaves a 1.4 file alone: no door is called and no section throws', async () => {
      const parsed = service.parse({
        transactions: [], categories: [], version: '1.4', exportDate: '2026-08-01',
      });

      const summary = await service.restore(parsed);

      expect(searchHistory.restore).not.toHaveBeenCalled();
      expect(searchAnswers.restore).not.toHaveBeenCalled();
      expect(categoryMemory.restore).not.toHaveBeenCalled();
      expect(tagMemory.restore).not.toHaveBeenCalled();
      expect(importHistory.restore).not.toHaveBeenCalled();
      expect(summary).toEqual(jasmine.objectContaining({
        savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
      }));
    });
  });

  describe('describe', () => {
    it('counts every section for the confirmation dialog', () => {
      const contents = service.describe(backup({
        transactions: [transaction(), transaction()],
        categories: [category()],
      }));

      expect(contents).toEqual(jasmine.objectContaining({
        version: '1.2', transactions: 2, categories: 1, budgets: 0, recurring: 0,
        insightSnapshots: 0,
      }));
    });

    it('counts goals in the preview', () => {
      const contents = service.describe(backup({ version: '1.3', goals: [goal(), goal()] }));

      expect(contents).toEqual(jasmine.objectContaining({ goals: 2 }));
    });

    it('counts all eleven sections, so the confirmation names what it will write', () => {
      const contents = service.describe(backup({
        version: '1.5',
        transactions: [transaction()],
        categories: [category()],
        savedSearches: [savedSearch()],
        searchAnswers: [searchAnswer()],
        categoryMemory: [memory()],
        tagMemory: [tags()],
        imports: [importRecord()],
      }));

      expect(contents).toEqual({
        version: '1.5', exportDate: '2026-08-01T00:00:00.000Z',
        transactions: 1, categories: 1, budgets: 0, recurring: 0, goals: 0,
        insightSnapshots: 0,
        savedSearches: 1, searchAnswers: 1, categoryMemory: 1, tagMemory: 1, imports: 1,
      });
    });
  });

  describe('goals', () => {
    it('restores goals at their ids with contributed amounts intact', async () => {
      const summary = await service.restore(backup({ version: '1.3', goals: [goal()] }));

      expect(summary.goals).toBe(1);
      expect(goals.createGoal).toHaveBeenCalledWith(
        jasmine.objectContaining({
          kind: 'project',
          name: 'Japan trip',
          targetAmount: 2000,
          currency: 'USD',
          items: [{ name: 'Flights', amount: 800, done: true }]
        }),
        { id: 'g-1', contributedAmount: 750, isActive: true }
      );
    });

    it('accepts a 1.2 backup with no goals section', () => {
      const parsed = service.parse({
        transactions: [],
        categories: [],
        version: '1.2',
        exportDate: '2026-08-01',
      });

      expect(parsed.goals).toEqual([]);
      expect(service.describe(parsed).goals).toBe(0);
    });
  });

  describe('goal links', () => {
    it('passes a linked row through verbatim, counters untouched', async () => {
      await service.restore(backup({
        version: '1.4',
        transactions: [transaction({ goalId: 'g-1', goalAmount: 34.78 })],
      }));

      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.objectContaining({ description: 'Dinner' }),
        jasmine.objectContaining({
          id: 'txn-1',
          goalSnapshot: { goalId: 'g-1', goalAmount: 34.78 },
        })
      );
      // No goalId in the DTO itself: that is the live path, which would
      // fail on a goal that restores later — and double-count after it.
      const dto = transactions.addTransaction.calls.mostRecent().args[0];
      expect('goalId' in dto).toBeFalse();
    });

    it('carries a hand-edited link with no stored figure as zero rather than dropping it', async () => {
      await service.restore(backup({
        version: '1.4',
        transactions: [transaction({ goalId: 'g-1' })],
      }));

      expect(transactions.addTransaction).toHaveBeenCalledWith(
        jasmine.anything(),
        jasmine.objectContaining({ goalSnapshot: { goalId: 'g-1', goalAmount: 0 } })
      );
    });

    it('recomputes each involved goal once: linked ids and restored goals, deduplicated', async () => {
      await service.restore(backup({
        version: '1.4',
        transactions: [
          transaction({ id: 'txn-1', goalId: 'g-1', goalAmount: 10 }),
          transaction({ id: 'txn-2', goalId: 'g-1', goalAmount: 20 }),
          transaction({ id: 'txn-3', goalId: 'g-other', goalAmount: 5 }),
        ],
        // g-1 is also in the backup; g-other is a link to a goal the file
        // does not contain; g-2 has no links but may have pre-existing ones
        // in the account, so it is settled too.
        goals: [goal({ id: 'g-1' }), goal({ id: 'g-2' })],
      }));

      const recomputed = goals.recomputeLinkedAmount.calls.allArgs().map(([id]) => id);
      expect(recomputed.length).toBe(3);
      expect(new Set(recomputed)).toEqual(new Set(['g-1', 'g-other', 'g-2']));
    });

    it('leaves counters alone when a pre-link backup names no goals at all', async () => {
      await service.restore(backup({
        version: '1.2',
        transactions: [transaction()],
      }));

      expect(goals.recomputeLinkedAmount).not.toHaveBeenCalled();
    });

    it('reports a failed recompute without abandoning the rest', async () => {
      goals.recomputeLinkedAmount.and.rejectWith(new Error('offline'));

      const summary = await service.restore(backup({
        version: '1.4',
        transactions: [transaction({ goalId: 'g-1', goalAmount: 10 })],
      }));

      expect(summary.transactions).toBe(1);
      expect(summary.skipped).toEqual([
        { section: 'goals', id: 'g-1', reason: 'offline' },
      ]);
    });
  });
});
