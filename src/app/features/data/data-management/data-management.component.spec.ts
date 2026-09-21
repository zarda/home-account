import { provideRouter } from '@angular/router';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { createTranslationStub, createLocaleFormatStub } from '../../../core/services/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DataManagementComponent } from './data-management.component';
import { ExportService } from '../../../core/services/export.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { CategoryService } from '../../../core/services/category.service';
import { BudgetService } from '../../../core/services/budget.service';
import { RecurringService } from '../../../core/services/recurring.service';
import {
  BackupRestoreService,
  UNSUPPORTED_BACKUP_VERSION,
} from '../../../core/services/backup-restore.service';
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AccountDeletionService } from '../../../core/services/account-deletion.service';
import { GoalService } from '../../../core/services/goal.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { SearchAnswerHistoryService } from '../../../core/services/search-answer-history.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ImportHistoryService } from '../../../core/services/import-history.service';
import { Firestore } from '@angular/fire/firestore';
import { Transaction } from '../../../models';
import { BACKUP_SECTIONS, NOT_IN_BACKUP } from '../../../core/services/export.service';
import en from '../../../../assets/i18n/en.json';

describe('DataManagementComponent', () => {
  let component: DataManagementComponent;
  let fixture: ComponentFixture<DataManagementComponent>;
  let mockExportService: jasmine.SpyObj<ExportService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockInsightSnapshots: jasmine.SpyObj<InsightSnapshotService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;
  let mockBudgetService: jasmine.SpyObj<BudgetService>;
  let mockRecurringService: jasmine.SpyObj<RecurringService>;
  let mockBackupRestore: jasmine.SpyObj<BackupRestoreService>;
  let mockAccountDeletion: jasmine.SpyObj<AccountDeletionService>;
  let mockGoalService: jasmine.SpyObj<GoalService>;
  let mockSearchHistory: jasmine.SpyObj<SearchHistoryService>;
  let mockSearchAnswers: jasmine.SpyObj<SearchAnswerHistoryService>;
  let mockCategoryMemory: jasmine.SpyObj<CategoryMemoryService>;
  let mockTagMemory: jasmine.SpyObj<TagMemoryService>;
  let mockImportHistory: jasmine.SpyObj<ImportHistoryService>;

  beforeEach(async () => {
    mockExportService = jasmine.createSpyObj('ExportService', [
      'exportToJSON',
      'exportToCSV',
      'downloadBlob',
      'downloadBlobWithPicker',
      'importFromCSV',
      'parseImportedData'
    ]);
    mockExportService.exportToJSON.and.returnValue(new Blob(['{}'], { type: 'application/json' }));
    mockExportService.exportToCSV.and.returnValue(new Blob(['csv'], { type: 'text/csv' }));
    mockExportService.downloadBlobWithPicker.and.returnValue(Promise.resolve(true));
    mockExportService.importFromCSV.and.returnValue(Promise.resolve([]));
    mockExportService.parseImportedData.and.returnValue([]);

    mockTransactionService = jasmine.createSpyObj('TransactionService', ['addTransaction', 'deleteAllTransactions', 'exportAll'], {
      transactions: signal([])
    });
    mockTransactionService.addTransaction.and.returnValue(Promise.resolve('new-id'));
    mockTransactionService.deleteAllTransactions.and.returnValue(Promise.resolve(0));
    mockTransactionService.exportAll.and.resolveTo([]);

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['exportAll'], {
      categories: signal([])
    });
    mockCategoryService.exportAll.and.returnValue(Promise.resolve([]));

    // Root-provided like InsightSnapshotService below: without stubs the real
    // services are constructed and their Firestore injection fails.
    mockBudgetService = jasmine.createSpyObj('BudgetService', [
      'exportAll', 'createBudget', 'recalculateBudgetsForCategory'
    ]);
    mockBudgetService.exportAll.and.returnValue(Promise.resolve([]));
    mockBudgetService.recalculateBudgetsForCategory.and.resolveTo();
    mockRecurringService = jasmine.createSpyObj('RecurringService', ['exportAll', 'createRecurring']);
    mockRecurringService.exportAll.and.returnValue(Promise.resolve([]));
    mockGoalService = jasmine.createSpyObj('GoalService', ['exportAll', 'createGoal']);
    mockGoalService.exportAll.and.resolveTo([]);
    // The five sections backup 1.5 added. Root-provided like the rest, so
    // without stubs the real services are constructed against a bare Firestore.
    mockSearchHistory = jasmine.createSpyObj('SearchHistoryService', ['exportAll']);
    mockSearchHistory.exportAll.and.resolveTo([]);
    mockSearchAnswers = jasmine.createSpyObj('SearchAnswerHistoryService', ['exportAll']);
    mockSearchAnswers.exportAll.and.resolveTo([]);
    mockCategoryMemory = jasmine.createSpyObj('CategoryMemoryService', ['exportAll']);
    mockCategoryMemory.exportAll.and.resolveTo([]);
    mockTagMemory = jasmine.createSpyObj('TagMemoryService', ['exportAll']);
    mockTagMemory.exportAll.and.resolveTo([]);
    mockImportHistory = jasmine.createSpyObj('ImportHistoryService', ['exportAll']);
    mockImportHistory.exportAll.and.resolveTo([]);
    mockBackupRestore = jasmine.createSpyObj('BackupRestoreService', ['parse', 'describe', 'restore']);

    // Root-provided, so without this the real service is constructed and its
    // Firestore injection fails.
    mockInsightSnapshots = jasmine.createSpyObj('InsightSnapshotService', ['exportAll', 'deleteAll']);
    mockInsightSnapshots.exportAll.and.returnValue(Promise.resolve([]));
    mockInsightSnapshots.deleteAll.and.returnValue(Promise.resolve());

    // currentUser is read through the component's baseCurrency computed, which
    // the CSV import path reaches and the restore path does not.
    mockAuthService = jasmine.createSpyObj('AuthService', ['signOut', 'currentUser']);
    mockAuthService.currentUser.and.returnValue(null);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    mockAccountDeletion = jasmine.createSpyObj('AccountDeletionService', ['deleteAccount']);
    mockAccountDeletion.deleteAccount.and.resolveTo({ ok: true, failed: [] });

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => key);

    const mockReceiptQuota = jasmine.createSpyObj(
      'ReceiptQuotaService',
      ['refreshCount', 'hasUnlimitedImages', 'imageLimit'],
      { imageCount: signal<number | null>(null) }
    );
    mockReceiptQuota.refreshCount.and.resolveTo(0);
    mockReceiptQuota.hasUnlimitedImages.and.returnValue(false);
    mockReceiptQuota.imageLimit.and.returnValue(200);

    await TestBed.configureTestingModule({
      imports: [DataManagementComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: ExportService, useValue: mockExportService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: BudgetService, useValue: mockBudgetService },
        { provide: RecurringService, useValue: mockRecurringService },
        { provide: GoalService, useValue: mockGoalService },
        { provide: SearchHistoryService, useValue: mockSearchHistory },
        { provide: SearchAnswerHistoryService, useValue: mockSearchAnswers },
        { provide: CategoryMemoryService, useValue: mockCategoryMemory },
        { provide: TagMemoryService, useValue: mockTagMemory },
        { provide: ImportHistoryService, useValue: mockImportHistory },
        { provide: BackupRestoreService, useValue: mockBackupRestore },
        { provide: InsightSnapshotService, useValue: mockInsightSnapshots },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AccountDeletionService, useValue: mockAccountDeletion },
        { provide: Firestore, useValue: {} },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        { provide: ReceiptQuotaService, useValue: mockReceiptQuota }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(DataManagementComponent, {
        set: {
          template: '<div></div>',
          providers: [
        { provide: NotificationService, useValue: notifications },
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar },
            { provide: TranslationService, useValue: mockTranslationService },
            { provide: ReceiptQuotaService, useValue: mockReceiptQuota }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(DataManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should not be exporting initially', () => {
      expect(component.isExporting()).toBeFalse();
    });

    it('should not be importing initially', () => {
      expect(component.isImporting()).toBeFalse();
    });

    it('should have zero import progress initially', () => {
      expect(component.importProgress()).toBe(0);
    });

    it('should not show import preview initially', () => {
      expect(component.showImportPreview()).toBeFalse();
    });
  });

  describe('exportFullBackup', () => {
    it('should call exportToJSON with transactions and categories', fakeAsync(() => {
      component.exportFullBackup();
      tick();

      expect(mockExportService.exportToJSON).toHaveBeenCalled();
      expect(mockExportService.downloadBlobWithPicker).toHaveBeenCalled();
    }));

    it('should show success snackbar', fakeAsync(() => {
      component.exportFullBackup();
      tick();

      expect(notifications.success).toHaveBeenCalledWith('settings.backupExported');
    }));

    it('should set isExporting to false after completion', fakeAsync(() => {
      component.exportFullBackup();
      tick();

      expect(component.isExporting()).toBeFalse();
    }));

    it('reads every section the file carries, one-shot and server-only', fakeAsync(() => {
      // Eleven from 1.5. A section the assembly forgets is a section the
      // deletion cascade still removes and the file no longer holds.
      component.exportFullBackup();
      tick();

      const sections: [string, jasmine.Spy][] = [
        ['transactions', mockTransactionService.exportAll],
        ['categories', mockCategoryService.exportAll],
        ['insightSnapshots', mockInsightSnapshots.exportAll],
        ['budgets', mockBudgetService.exportAll],
        ['recurring', mockRecurringService.exportAll],
        ['goals', mockGoalService.exportAll],
        ['savedSearches', mockSearchHistory.exportAll],
        ['searchAnswers', mockSearchAnswers.exportAll],
        ['categoryMemory', mockCategoryMemory.exportAll],
        ['tagMemory', mockTagMemory.exportAll],
        ['imports', mockImportHistory.exportAll],
      ];

      expect(sections.length).toBe(11);
      expect(sections.filter(([, spy]) => spy.calls.count() === 1).map(([name]) => name))
        .toEqual(sections.map(([name]) => name));
    }));

    it('hands the blob every section it read', fakeAsync(() => {
      mockSearchHistory.exportAll.and.resolveTo([{ id: 's-1' }] as never);
      mockSearchAnswers.exportAll.and.resolveTo([{ id: 'a-1' }] as never);
      mockCategoryMemory.exportAll.and.resolveTo([{ merchantKey: 'starbucks' }] as never);
      mockTagMemory.exportAll.and.resolveTo([{ merchantKey: 'starbucks' }] as never);
      mockImportHistory.exportAll.and.resolveTo([{ id: 'i-1' }] as never);

      component.exportFullBackup();
      tick();

      expect(mockExportService.exportToJSON).toHaveBeenCalledWith(
        jasmine.objectContaining({
          savedSearches: [{ id: 's-1' }],
          searchAnswers: [{ id: 'a-1' }],
          categoryMemory: [{ merchantKey: 'starbucks' }],
          tagMemory: [{ merchantKey: 'starbucks' }],
          imports: [{ id: 'i-1' }],
        }) as never
      );
    }));
  });

  describe('exportTransactionsCSV', () => {
    it('should call exportToCSV', fakeAsync(() => {
      component.exportTransactionsCSV();
      tick();

      expect(mockExportService.exportToCSV).toHaveBeenCalled();
      expect(mockExportService.downloadBlobWithPicker).toHaveBeenCalled();
    }));

    it('should show success snackbar', fakeAsync(() => {
      component.exportTransactionsCSV();
      tick();

      expect(notifications.success).toHaveBeenCalledWith('settings.transactionsExported');
    }));

    it('writes the one-shot read, not the window the signal holds', fakeAsync(() => {
      const full = [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Transaction[];
      mockTransactionService.transactions.set([full[0]]);
      mockTransactionService.exportAll.and.resolveTo(full);

      component.exportTransactionsCSV();
      tick();

      expect(mockExportService.exportToCSV).toHaveBeenCalledWith(full);
    }));

    it('shows the error notification when the server read fails', fakeAsync(() => {
      mockTransactionService.exportAll.and.rejectWith(new Error('unavailable'));

      component.exportTransactionsCSV();
      tick();

      expect(mockExportService.exportToCSV).not.toHaveBeenCalled();
      expect(notifications.error).toHaveBeenCalledWith('settings.transactionsExportFailed');
    }));
  });

  describe('onFileSelected', () => {
    it('should reject non-CSV and non-JSON files', () => {
      const event = {
        target: {
          files: [{ name: 'test.txt' }],
          value: ''
        }
      } as unknown as Event;

      component.onFileSelected(event);

      expect(notifications.error).toHaveBeenCalledWith('settings.selectCsvOrJson');
    });

    it('should handle no file selected', () => {
      const event = {
        target: {
          files: [],
          value: ''
        }
      } as unknown as Event;

      component.onFileSelected(event);

      expect(mockExportService.importFromCSV).not.toHaveBeenCalled();
    });

    // A backup keeps its own shape now rather than being flattened into the
    // CSV importer's row type, which is what used to drop every section but
    // transactions. What each section restores to is covered in
    // backup-restore.service.spec.ts; this covers the wiring.
    it('hands a backup file to the restore service and previews every section', async () => {
      const parsed = {
        transactions: [], categories: [], budgets: [], recurring: [],
        insightSnapshots: [], exportDate: '2026-08-01', version: '1.2',
      };
      const contents = {
        version: '1.2', exportDate: '2026-08-01',
        transactions: 12, categories: 3, budgets: 2, recurring: 1, goals: 0, insightSnapshots: 4,
        savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
      };
      mockBackupRestore.parse.and.returnValue(parsed);
      mockBackupRestore.describe.and.returnValue(contents);

      const file = new File([JSON.stringify({ transactions: [], version: '1.2' })],
        'backup.json', { type: 'application/json' });
      component.onFileSelected({ target: { files: [file], value: '' } } as unknown as Event);

      const deadline = Date.now() + 3000;
      while (!component.backupContents() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      expect(mockBackupRestore.parse).toHaveBeenCalled();
      expect(component.pendingBackup()).toBe(parsed);
      expect(component.backupContents()).toEqual(contents);
      expect(component.showImportPreview()).toBeTrue();
    });

    it('refuses a backup written by a newer build instead of half-reading it', async () => {
      mockBackupRestore.parse.and.throwError(new Error(UNSUPPORTED_BACKUP_VERSION));

      const file = new File([JSON.stringify({ transactions: [], version: '9.9' })],
        'backup.json', { type: 'application/json' });
      component.onFileSelected({ target: { files: [file], value: '' } } as unknown as Event);

      const deadline = Date.now() + 3000;
      while (!notifications.error.calls.any() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      expect(notifications.error).toHaveBeenCalledWith('settings.unsupportedBackupVersion');
      expect(component.pendingBackup()).toBeNull();
      expect(component.showImportPreview()).toBeFalse();
    });
  });

  // The service half was already right; the component discarded a counter it
  // was handed. A backup of nothing but goals reported "0 records restored"
  // while every goal landed, and the preview panel one line above the dialog
  // showed the goal count all along.


  describe('the CSV bulk import', () => {
    /** Stage parsed rows and a confirmed dialog, then run the import. */
    async function importRows(rows: { type: string; categoryId: string }[]): Promise<void> {
      component.pendingBackup.set(null);
      component.importedTransactions.set(rows.map(() => ({}) as never));
      mockExportService.parseImportedData.and.returnValue(rows as never);
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.confirmImport();

      const deadline = Date.now() + 3000;
      while (!notifications.success.calls.any() && !notifications.info.calls.any()
        && !notifications.error.calls.any() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }

    it('recalculates once per affected category, not once per row', async () => {
      // addTransaction recomputes every budget on the row's category by
      // default, so a fifty-row file read and rewrote the same two budgets
      // fifty times — the same defect the AI import path already fixed.
      await importRows(Array.from({ length: 50 }, (_, i) => ({
        type: 'expense',
        categoryId: i % 2 === 0 ? 'food_restaurants' : 'housing_rent',
      })));

      expect(mockTransactionService.addTransaction).toHaveBeenCalledTimes(50);
      expect(mockTransactionService.addTransaction.calls.allArgs()
        .every(args => args[1]?.skipBudgetRecalc === true)).toBeTrue();
      expect(mockBudgetService.recalculateBudgetsForCategory.calls.allArgs()
        .map(args => args[0]).sort())
        .toEqual(['food_restaurants', 'housing_rent']);
    });

    it('counts only the expense rows it actually wrote', async () => {
      mockTransactionService.addTransaction.and.callFake(async (dto: { categoryId: string }) => {
        if (dto.categoryId === 'housing_rent') throw new Error('invalid amount');
        return 'id';
      });

      await importRows([
        { type: 'expense', categoryId: 'food_restaurants' },
        { type: 'expense', categoryId: 'housing_rent' },
        { type: 'income', categoryId: 'salary' },
      ]);

      expect(mockBudgetService.recalculateBudgetsForCategory.calls.allArgs())
        .toEqual([['food_restaurants']]);
    });

    it('a lagging counter never fails an import that already wrote its rows', async () => {
      mockBudgetService.recalculateBudgetsForCategory.and.rejectWith(new Error('offline'));

      await importRows([{ type: 'expense', categoryId: 'food_restaurants' }]);

      expect(notifications.success).toHaveBeenCalledWith('settings.transactionsImported');
      expect(notifications.error).not.toHaveBeenCalled();
    });
  });

  describe('confirmRestore', () => {
    const emptySummary = {
      transactions: 0, categories: 0, budgets: 0, recurring: 0, goals: 0,
      insightSnapshots: 0,
      savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
      skipped: [] as { section: string; id: string; reason: string }[],
    };

    const emptyContents = {
      version: '1.5', exportDate: '2026-08-01',
      transactions: 0, categories: 0, budgets: 0, recurring: 0, goals: 0, insightSnapshots: 0,
      savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
    };

    /** Stage a parsed backup and a confirmed dialog, then run the restore. */
    async function restoreWith(
      summary: Partial<typeof emptySummary>,
      contents: Partial<typeof emptyContents> = {},
    ): Promise<void> {
      component.pendingBackup.set({
        transactions: [], categories: [], exportDate: '2026-08-01', version: '1.4',
      } as never);
      component.backupContents.set({ ...emptyContents, ...contents } as never);
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      mockBackupRestore.restore.and.resolveTo({ ...emptySummary, ...summary });

      component.confirmImport();

      const deadline = Date.now() + 3000;
      while (!notifications.success.calls.any() && !notifications.info.calls.any()
        && !notifications.error.calls.any() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }

    describe('what the dialogs say the file covers', () => {
      it('interpolates a count for every section the backup carries', async () => {
        // Six of the eleven before 1.5, so the confirmation described a third of
        // what it was about to write.
        await restoreWith({}, {
          transactions: 12, categories: 3, budgets: 2, recurring: 1, goals: 4,
          insightSnapshots: 6, savedSearches: 5, searchAnswers: 7,
          categoryMemory: 8, tagMemory: 9, imports: 10,
        });

        const call = mockTranslationService.t.calls.all()
          .find(c => c.args[0] === 'settings.confirmRestoreMessage');
        expect(call).toBeDefined();
        const params = call!.args[1] as Record<string, number>;
        expect(Object.keys(params).sort()).toEqual([...BACKUP_SECTIONS].sort());
        expect(params['savedSearches']).toBe(5);
        expect(params['imports']).toBe(10);
      });

      // The English catalog is the source text; ja and tc are held to the same
      // placeholders by translation-keys.spec.ts, and their prose is a
      // translator's business rather than a spec's.
      it('names every section the file carries, in the message itself', () => {
        const message = en.settings.confirmRestoreMessage;
        const missing = BACKUP_SECTIONS.filter(section => !message.includes(`{{${section}}}`));

        expect(missing).toEqual([]);
      });

      it('stops calling the backup a full one, and names what it cannot carry', () => {
        const offer = en.settings.deleteAccountBackupMessage.toLowerCase();

        // Each excluded kind, by the word the English message uses for it.
        // Keyed against NOT_IN_BACKUP, so a fourth exclusion has to be given a
        // word here before this passes.
        const named: Record<string, string> = {
          secrets: 'keys',
          securityEvents: 'sign-in history',
          feedback: 'feedback',
        };
        expect(Object.keys(named).sort()).toEqual(Object.keys(NOT_IN_BACKUP).sort());

        const unmentioned = Object.entries(named)
          .filter(([, word]) => !offer.includes(word))
          .map(([kind]) => kind);

        expect(unmentioned).toEqual([]);
        expect(offer).not.toContain('full backup');
      });

      it('warns about the kinds the cascade removes that the old wording left out', () => {
        const warning = en.settings.deleteAccountWarning.toLowerCase();

        const missing = ['goals', 'stored answers', 'merchant', 'import history', 'feedback']
          .filter(word => !warning.includes(word));

        expect(missing).toEqual([]);
      });
    });

    it('counts the goals it restored, in a backup that holds nothing else', async () => {
      await restoreWith({ goals: 12 });

      expect(notifications.success).toHaveBeenCalledWith('settings.backupRestored');
      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.backupRestored', { count: 12 });
    });

    it('totals every section, so the toast matches the preview panel', async () => {
      await restoreWith({
        transactions: 12, categories: 3, budgets: 2, recurring: 1, goals: 4,
        insightSnapshots: 5,
      });

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.backupRestored', { count: 27 });
    });

    it('names the goal count in the confirmation dialog', async () => {
      await restoreWith({}, { transactions: 12, goals: 4 });

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.confirmRestoreMessage',
        jasmine.objectContaining({ transactions: 12, goals: 4 }));
    });

    // A bare count told the user something had gone wrong and nothing about
    // where; the console line naming the sections was the only signal.
    it('names the sections a partial restore could not write', async () => {
      await restoreWith({
        transactions: 8,
        skipped: [
          { section: 'insightSnapshots', id: '2026-06', reason: 'PERMISSION_DENIED' },
          { section: 'insightSnapshots', id: '2026-07', reason: 'PERMISSION_DENIED' },
          { section: 'goals', id: 'g-1', reason: 'offline' },
        ],
      });

      expect(notifications.info).toHaveBeenCalledWith('settings.backupRestoredPartial');
      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.backupRestoredPartial',
        { count: 8, skipped: 3, sections: 'insightSnapshots, goals' });
    });

    it('leaves a failed section out of the total and reports it as skipped', async () => {
      await restoreWith({
        transactions: 3, goals: 0,
        skipped: [{ section: 'goals', id: 'g-1', reason: 'offline' }],
      });

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.backupRestoredPartial',
        jasmine.objectContaining({ count: 3, skipped: 1 }));
    });

    it('does nothing at all when the dialog is dismissed', async () => {
      component.pendingBackup.set({
        transactions: [], categories: [], exportDate: '2026-08-01', version: '1.4',
      } as never);
      component.backupContents.set(emptyContents as never);
      mockDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

      component.confirmImport();
      await new Promise(resolve => setTimeout(resolve, 40));

      expect(mockBackupRestore.restore).not.toHaveBeenCalled();
    });
  });

  describe('cancelImport', () => {
    it('should reset import state', () => {
      component.importedTransactions.set([{ description: 'test', amount: 100, date: new Date(), type: 'expense' }]);
      component.showImportPreview.set(true);
      component.importProgress.set(50);

      component.cancelImport();

      expect(component.importedTransactions().length).toBe(0);
      expect(component.showImportPreview()).toBeFalse();
      expect(component.importProgress()).toBe(0);
    });
  });

  describe('deleteAllTransactions', () => {
    it('should open confirm dialog', () => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteAllTransactions();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    // The old message claimed everything was gone regardless of what the
    // service managed to remove.
    it('reports the number of transactions actually deleted', fakeAsync(() => {
      mockTransactionService.deleteAllTransactions.and.returnValue(Promise.resolve(488));
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.allTransactionsDeleted', { count: 488 }
      );
      expect(notifications.success).toHaveBeenCalled();
    }));
  });

  describe('exportFullBackup', () => {
    it('resolves true when the picker saves the file', fakeAsync(() => {
      let result: boolean | undefined;
      component.exportFullBackup().then(r => (result = r));
      tick();

      expect(result).toBeTrue();
    }));

    it('resolves false when the picker is cancelled', fakeAsync(() => {
      mockExportService.downloadBlobWithPicker.and.resolveTo(false);

      let result: boolean | undefined;
      component.exportFullBackup().then(r => (result = r));
      tick();

      expect(result).toBeFalse();
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    it('writes the one-shot read, not the window the signal holds', fakeAsync(() => {
      // The signal holds one browsed row; the account holds three. The blob
      // must carry what the collection read returned, never the signal.
      const full = [{ id: 't1' }, { id: 't2' }, { id: 't3' }] as Transaction[];
      mockTransactionService.transactions.set([full[0]]);
      mockTransactionService.exportAll.and.resolveTo(full);

      component.exportFullBackup();
      tick();

      const payload = mockExportService.exportToJSON.calls.mostRecent()
        .args[0] as { transactions: Transaction[] };
      expect(payload.transactions).toEqual(full);
    }));

    it('resolves false and notifies when the transactions read fails', fakeAsync(() => {
      // Offline, the server-only read rejects rather than serving the cache;
      // a backup that cannot see the whole account must not report success.
      mockTransactionService.exportAll.and.rejectWith(new Error('unavailable'));

      let result: boolean | undefined;
      component.exportFullBackup().then(r => (result = r));
      tick();

      expect(result).toBeFalse();
      expect(mockExportService.exportToJSON).not.toHaveBeenCalled();
      expect(notifications.error).toHaveBeenCalledWith('settings.backupExportFailed');
    }));
  });

  describe('deleteAccount', () => {
    function redirectSpy(): jasmine.Spy {
      return spyOn(
        component as unknown as { redirectToLogin: () => void },
        'redirectToLogin'
      );
    }

    function stubDialogs(...results: (boolean | undefined)[]): void {
      const refs = results.map(r => ({ afterClosed: () => of(r) }));
      mockDialog.open.and.returnValues(...(refs as never[]));
    }

    it('runs the cascade only after the backup offer, warning, and typed confirmation', fakeAsync(() => {
      const redirect = redirectSpy();
      stubDialogs(false, true, true); // skip backup, accept warning, typed DELETE

      component.deleteAccount();
      tick();

      expect(mockDialog.open).toHaveBeenCalledTimes(3);
      const typedConfig = mockDialog.open.calls.argsFor(2)[1] as { data: { requireText?: string } };
      expect(typedConfig.data.requireText).toBe('DELETE');
      expect(mockExportService.downloadBlobWithPicker).not.toHaveBeenCalled();
      expect(mockAccountDeletion.deleteAccount).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalled();
    }));

    it('aborts when the backup offer is dismissed', fakeAsync(() => {
      const redirect = redirectSpy();
      stubDialogs(undefined);

      component.deleteAccount();
      tick();

      expect(mockDialog.open).toHaveBeenCalledTimes(1);
      expect(mockAccountDeletion.deleteAccount).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    }));

    it('stops when the chosen backup export is cancelled', fakeAsync(() => {
      const redirect = redirectSpy();
      mockExportService.downloadBlobWithPicker.and.resolveTo(false);
      stubDialogs(true);

      component.deleteAccount();
      tick();

      expect(mockDialog.open).toHaveBeenCalledTimes(1);
      expect(mockAccountDeletion.deleteAccount).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    }));

    it('stops when the chosen backup export fails to read the account', fakeAsync(() => {
      // The boolean the export resolves is the only gate on the cascade: a
      // failed read must hold it, not fall through to the confirmations.
      const redirect = redirectSpy();
      mockTransactionService.exportAll.and.rejectWith(new Error('unavailable'));
      stubDialogs(true);

      component.deleteAccount();
      tick();

      expect(mockDialog.open).toHaveBeenCalledTimes(1);
      expect(mockAccountDeletion.deleteAccount).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    }));

    it('reports the failed steps and stays signed in on a partial failure', fakeAsync(() => {
      const redirect = redirectSpy();
      mockAccountDeletion.deleteAccount.and.resolveTo({
        ok: false,
        failed: [
          { step: 'budgets', error: new Error('offline') },
          { step: 'userDoc', error: new Error('offline') }
        ]
      });
      stubDialogs(false, true, true);

      component.deleteAccount();
      tick();

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.deleteAccountFailedSteps', { steps: 'budgets, userDoc' }
      );
      expect(notifications.error).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      expect(component.isDeletingAccount()).toBeFalse();
    }));

    it('surfaces a reauthentication failure as nothing-deleted', fakeAsync(() => {
      const redirect = redirectSpy();
      mockAccountDeletion.deleteAccount.and.resolveTo({
        ok: false,
        failed: [{ step: 'reauth', error: new Error('popup closed') }]
      });
      stubDialogs(false, true, true);

      component.deleteAccount();
      tick();

      expect(notifications.error).toHaveBeenCalledWith('settings.deleteAccountReauthFailed');
      expect(redirect).not.toHaveBeenCalled();
    }));
  });
});

/**
 * The cases above override the template to `<div></div>`, so the page's five
 * sections, the two mutually exclusive import previews (a full backup's
 * section counts vs a CSV's first five rows), the receipt-usage line's three
 * states, and every danger-zone control are unproven by them. The
 * `routerLink` buttons are the only way into the import wizard from here and
 * nothing has ever checked they resolve.
 */
describe('DataManagementComponent, through its own template', () => {
  let fixture: ComponentFixture<DataManagementComponent>;
  let component: DataManagementComponent;
  let backupRestore: jasmine.SpyObj<BackupRestoreService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let quota: {
    imageCount: ReturnType<typeof signal<number | null>>;
    refreshCount: jasmine.Spy;
    hasUnlimitedImages: jasmine.Spy;
    imageLimit: jasmine.Spy;
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const button = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );
  const link = (label: string): HTMLElement | undefined =>
    (Array.from(el().querySelectorAll('[routerlink], a, button')) as HTMLElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );
  /**
   * A preview row by the key in its description. Looked up by key rather than
   * by index so widening the backup with further sections does not move it.
   */
  const previewRow = (key: string): string | null => {
    const row = (Array.from(el().querySelectorAll('.preview-item')) as HTMLElement[]).find(
      item => item.querySelector('.preview-desc')?.textContent?.trim() === key
    );
    return row?.querySelector('.preview-amount')?.textContent?.trim() ?? null;
  };

  const spy = (name: string, methods: string[], resolve: unknown = []) => {
    const obj = jasmine.createSpyObj(name, methods);
    methods.forEach(m => (obj[m] as jasmine.Spy).and.resolveTo(resolve));
    return obj;
  };

  beforeEach(async () => {
    backupRestore = jasmine.createSpyObj('BackupRestoreService', ['parse', 'describe', 'restore']);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    quota = {
      imageCount: signal<number | null>(null),
      refreshCount: jasmine.createSpy('refreshCount').and.resolveTo(0),
      hasUnlimitedImages: jasmine.createSpy('hasUnlimitedImages').and.returnValue(false),
      imageLimit: jasmine.createSpy('imageLimit').and.returnValue(200),
    };

    await TestBed.configureTestingModule({
      imports: [DataManagementComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: NotificationService, useValue: spy('NotificationService', ['success', 'error', 'info']) },
        { provide: ExportService, useValue: spy('ExportService', ['exportToJSON', 'exportTransactionsToCSV', 'downloadFile', 'parseImportFile']) },
        { provide: TransactionService, useValue: spy('TransactionService', ['exportAll', 'addTransaction', 'deleteAllTransactions']) },
        { provide: CategoryService, useValue: spy('CategoryService', ['exportAll']) },
        { provide: BudgetService, useValue: spy('BudgetService', ['exportAll']) },
        { provide: RecurringService, useValue: spy('RecurringService', ['exportAll']) },
        { provide: GoalService, useValue: spy('GoalService', ['exportAll']) },
        { provide: SearchHistoryService, useValue: spy('SearchHistoryService', ['exportAll']) },
        { provide: SearchAnswerHistoryService, useValue: spy('SearchAnswerHistoryService', ['exportAll']) },
        { provide: CategoryMemoryService, useValue: spy('CategoryMemoryService', ['exportAll']) },
        { provide: TagMemoryService, useValue: spy('TagMemoryService', ['exportAll']) },
        { provide: ImportHistoryService, useValue: spy('ImportHistoryService', ['exportAll']) },
        { provide: BackupRestoreService, useValue: backupRestore },
        { provide: InsightSnapshotService, useValue: spy('InsightSnapshotService', ['exportAll', 'deleteAll']) },
        { provide: AuthService, useValue: { signOut: jasmine.createSpy('signOut'), currentUser: signal(null) } },
        { provide: AccountDeletionService, useValue: spy('AccountDeletionService', ['deleteAccount'], { ok: true, failed: [] }) },
        { provide: Firestore, useValue: {} },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: ReceiptQuotaService, useValue: quota },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataManagementComponent);
    component = fixture.componentInstance;
  });

  it('offers both exports, and locks them both while one runs', () => {
    fixture.detectChanges();

    const exports = Array.from(el().querySelectorAll('.export-btn')) as HTMLButtonElement[];
    expect(exports.length).toBe(2);
    expect(exports.map(b => b.querySelector('.btn-title')?.textContent?.trim()))
      .toEqual(['settings.fullBackup', 'settings.transactionsCsv']);
    expect(exports.every(b => !b.disabled)).toBeTrue();

    component.isExporting.set(true);
    fixture.detectChanges();

    expect((Array.from(el().querySelectorAll('.export-btn')) as HTMLButtonElement[])
      .every(b => b.disabled)).toBeTrue();
  });

  it('routes into the import wizard and its history', () => {
    fixture.detectChanges();

    expect(link('import.startSmartImport')?.getAttribute('routerlink')).toBe('/import/file');
    expect(link('import.viewHistory')?.getAttribute('routerlink')).toBe('/import/history');
  });

  it('says nothing about receipt usage until the count is known', () => {
    fixture.detectChanges();
    expect(text('.receipt-usage')).toBe('');

    quota.imageCount.set(12);
    fixture.detectChanges();
    expect(text('.receipt-usage')).toBe('receiptImages.usage:{"used":12,"limit":200}');
  });

  it('drops the limit from the usage line when there is no limit', () => {
    quota.hasUnlimitedImages.and.returnValue(true);
    quota.imageCount.set(12);
    fixture.detectChanges();

    expect(text('.receipt-usage')).toBe('receiptImages.usageUnlimited:{"used":12}');
  });

  it('offers the dropzone as a keyboard-reachable target, and a spinner while it reads', () => {
    fixture.detectChanges();

    const dropzone = el().querySelector('.import-dropzone') as HTMLElement;
    expect(dropzone.getAttribute('role')).toBe('button');
    expect(dropzone.getAttribute('tabindex')).toBe('0');
    expect(text('.dropzone-text')).toBe('settings.uploadPrompt');

    component.isImporting.set(true);
    fixture.detectChanges();

    expect(el().querySelector('app-loading-spinner')).not.toBeNull();
    expect(el().querySelector('.dropzone-text')).toBeNull();
  });

  it('previews a full backup as its section counts, and offers a restore', () => {
    fixture.detectChanges();
    component.backupContents.set({
      version: '1.4', exportDate: '2026-03-04',
      transactions: 42, categories: 8, budgets: 3, recurring: 2, goals: 1, insightSnapshots: 6,
    } as never);
    component.showImportPreview.set(true);
    fixture.detectChanges();

    expect(text('.preview-header span')).toBe('settings.previewBackup:{"version":"1.4"}');
    expect(previewRow('settings.sectionTransactions')).toBe('42');
    expect(previewRow('settings.sectionCategories')).toBe('8');
    expect(previewRow('settings.sectionInsightSnapshots')).toBe('6');
    expect(button('settings.restoreBackup')).toBeDefined();
    expect(button('settings.importTransactions')).toBeUndefined();
  });

  it('previews a CSV as its first five rows and counts the rest', () => {
    fixture.detectChanges();
    component.importedTransactions.set(
      Array.from({ length: 7 }, (_, i) => ({
        date: new Date('2026-03-04T00:00:00Z'),
        description: `Row ${i}`,
        amount: 10 + i,
        type: 'expense' as const,
        currency: 'USD',
      })) as never
    );
    component.showImportPreview.set(true);
    fixture.detectChanges();

    expect(text('.preview-header span')).toBe('settings.previewTransactions:{"count":7}');
    expect(el().querySelectorAll('.preview-item').length).toBe(5);
    expect(text('.preview-more')).toBe('settings.moreTransactions:{"count":2}');
    expect(text('.preview-item .preview-amount')).toBe('-$10.00');
    expect(text('.preview-item .preview-date')).toBe('2026-03-04');
    expect(button('settings.importTransactions')).toBeDefined();
  });

  it('shows the progress bar only while an import is partway through', () => {
    fixture.detectChanges();
    component.showImportPreview.set(true);
    fixture.detectChanges();
    expect(el().querySelector('mat-progress-bar')).toBeNull();

    component.importProgress.set(40);
    fixture.detectChanges();
    expect(el().querySelector('mat-progress-bar')).not.toBeNull();
    expect(text('.progress-text')).toBe('settings.importingProgress:{"progress":40}');

    component.importProgress.set(100);
    fixture.detectChanges();
    expect(el().querySelector('mat-progress-bar')).toBeNull();
  });

  it('carries both danger-zone actions, and locks account deletion while it runs', () => {
    fixture.detectChanges();

    const items = Array.from(el().querySelectorAll('.danger-item')) as HTMLElement[];
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.danger-title')?.textContent?.trim())
      .toBe('settings.deleteAllTransactions');
    expect(el().querySelector('.danger-zone mat-progress-bar')).toBeNull();

    component.isDeletingAccount.set(true);
    fixture.detectChanges();

    const deleteAccount = (Array.from(el().querySelectorAll('.danger-item button')) as HTMLButtonElement[])[1];
    expect(deleteAccount.disabled).toBeTrue();
    expect(el().querySelector('.danger-zone mat-progress-bar')).not.toBeNull();
  });

  it('reaches the receipt image manager from its own button', () => {
    // The handler is `async` and opens the dialog behind a lazy `import()`,
    // so what a template describe can honestly pin is that the control
    // exists and its `(click)` is bound — the dialog's own arguments belong
    // to the component, not to this markup.
    const open = spyOn(component, 'openReceiptImageManager').and.resolveTo();
    fixture.detectChanges();

    button('receiptImages.manage')?.click();

    expect(open).toHaveBeenCalled();
  });
});
