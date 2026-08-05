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
import { Budget, Category, InsightSnapshot, RecurringTransaction, Transaction } from '../../models';

describe('BackupRestoreService', () => {
  let service: BackupRestoreService;
  let transactions: jasmine.SpyObj<TransactionService>;
  let categories: jasmine.SpyObj<CategoryService>;
  let budgets: jasmine.SpyObj<BudgetService>;
  let recurring: jasmine.SpyObj<RecurringService>;
  let snapshots: jasmine.SpyObj<InsightSnapshotService>;

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

  function backup(overrides: Partial<ExportData> = {}): ExportData {
    return {
      transactions: [], categories: [], budgets: [], recurring: [], insightSnapshots: [],
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
    snapshots.restore.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        BackupRestoreService,
        { provide: TransactionService, useValue: transactions },
        { provide: CategoryService, useValue: categories },
        { provide: BudgetService, useValue: budgets },
        { provide: RecurringService, useValue: recurring },
        { provide: InsightSnapshotService, useValue: snapshots },
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
      for (const version of ['1.0', '1.1', '1.2']) {
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
        insightSnapshots: [{ id: '2026-06', monthKey: '2026-06',
          generatedAt: ts('2026-07-01'), createdAt: ts('2026-07-01') } as InsightSnapshot],
      }));

      expect(summary).toEqual(jasmine.objectContaining({
        transactions: 1, categories: 1, budgets: 1, recurring: 1, insightSnapshots: 1,
      }));
      expect(summary.skipped).toEqual([]);
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
        jasmine.anything(), { id: 'cat-7' });
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

    it('does not restore receipt fields, which point at objects a backup cannot hold', async () => {
      await service.restore(backup({
        transactions: [transaction({
          receiptUrl: 'https://example.test/r0.png',
          receiptUrls: ['https://example.test/r0.png'],
          receiptCount: 1,
        })],
      }));

      const [dto] = transactions.addTransaction.calls.mostRecent().args;
      const written = dto as unknown as Record<string, unknown>;
      expect('receiptUrl' in written).toBeFalse();
      expect('receiptUrls' in written).toBeFalse();
      expect('receiptCount' in written).toBeFalse();
      expect('receiptFiles' in written).toBeFalse();
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
      expect(categories.addCategory).toHaveBeenCalledWith(jasmine.anything(), { id: 'cat-1' });
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
  });
});
