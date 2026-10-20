import { provideRouter } from '@angular/router';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import {
  createTranslationStub,
  createLocaleFormatStub,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  textLines,
  withTheme,
  provideNoMotion,
  TranslationStub,
} from '../../../core/services/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DataManagementComponent } from './data-management.component';
import { ExportService } from '../../../core/services/export.service';
import { CopiesNotPurgedError, TransactionService } from '../../../core/services/transaction.service';
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
import { Category, FONT_SCALES, Transaction } from '../../../models';
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

    mockTransactionService = jasmine.createSpyObj('TransactionService', ['addTransaction', 'wipeTransactions', 'exportAll'], {
      transactions: signal([])
    });
    mockTransactionService.addTransaction.and.returnValue(Promise.resolve('new-id'));
    mockTransactionService.wipeTransactions.and.resolveTo({ deleted: 0, copiesPurged: 0 });
    mockTransactionService.exportAll.and.resolveTo([]);

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['exportAll', 'loadCategories'], {
      categories: signal([])
    });
    mockCategoryService.exportAll.and.returnValue(Promise.resolve([]));
    mockCategoryService.loadCategories.and.returnValue(of([]));

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
      imports: [DataManagementComponent],
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
        { provide: ReceiptQuotaService, useValue: mockReceiptQuota },
        provideNoMotion()
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

  // The transactions CSV names each row's category from CategoryService's
  // signal, and the CSV import resolves names against it; only a live
  // loadCategories() subscription fills it, so the page must hold one.
  describe('the category catalog', () => {
    it('is subscribed to when the page opens', () => {
      const catalog$ = new Subject<Category[]>();
      mockCategoryService.loadCategories.and.returnValue(catalog$);

      const page = TestBed.createComponent(DataManagementComponent);
      page.detectChanges();

      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
      expect(catalog$.observed).toBeTrue();
      page.destroy();
    });

    it('is released when the page closes', () => {
      const catalog$ = new Subject<Category[]>();
      mockCategoryService.loadCategories.and.returnValue(catalog$);

      const page = TestBed.createComponent(DataManagementComponent);
      page.detectChanges();
      // Positive proof first: without it the release below would pass for a
      // page that never subscribed at all.
      expect(catalog$.observed).toBeTrue();

      page.destroy();

      expect(catalog$.observed).toBeFalse();
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

      // A restore writes every row private: the backup carries neither the
      // shares nor anything a household holds, so sharing has to be redone.
      it('says the backup carries neither the shares nor what belongs to a household', () => {
        const offer = en.settings.deleteAccountBackupMessage.toLowerCase();

        const missing = [
          'which households your transactions are shared with',
          'anything that belongs to a household',
          'come back private',
        ].filter(phrase => !offer.includes(phrase));

        expect(missing).toEqual([]);
      });

      it('warns about the kinds the cascade removes that the old wording left out', () => {
        const warning = en.settings.deleteAccountWarning.toLowerCase();

        // The household step ends every membership, takes the transactions
        // this account shared out of each household, and dissolves an owner's
        // household for every other member too, which nothing of the
        // account's own records says. The budgets and goals it made in a
        // household it does not own belong to that household and stay. Its
        // contributions go from every household it is still in; those in a
        // household it has left or been removed from stay there.
        const missing = [
          'goals', 'stored answers', 'merchant', 'import history', 'feedback',
          'household memberships', 'the transactions you shared into them', 'every member',
          "the household budgets and goals you made in a household you don't own stay with that household",
          "the contributions you recorded on the goals of a household you're still in",
          "as do the contributions you recorded in a household you've left or been removed from",
        ].filter(word => !warning.includes(word));

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
      mockTransactionService.wipeTransactions.and.resolveTo({ deleted: 488, copiesPurged: 0 });
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.allTransactionsDeleted', { count: 488 }
      );
      expect(notifications.success).toHaveBeenCalled();
    }));

    // The rows are gone while a household may still show copies of them:
    // "failed" would contradict the empty list, and a retry would then report
    // 0 deleted with nothing said about the households.
    it('says the rows are deleted and that households still show them when the copies were not purged', fakeAsync(() => {
      mockTransactionService.wipeTransactions.and.rejectWith(
        new CopiesNotPurgedError(40, { cause: new Error('unavailable') }));
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(mockTranslationService.t).toHaveBeenCalledWith(
        'settings.transactionsDeletedCopiesKept', { count: 40 }
      );
      expect(notifications.error).toHaveBeenCalledOnceWith('settings.transactionsDeletedCopiesKept');
      expect(notifications.error).not.toHaveBeenCalledWith('settings.deleteTransactionsFailed');
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    // A retry after a failed purge finds no rows: a count of 0 would have
    // "them" name nothing.
    it('says households still show deleted transactions when a run with no rows left fails to purge', fakeAsync(() => {
      mockTransactionService.wipeTransactions.and.rejectWith(
        new CopiesNotPurgedError(0, { cause: new Error('unavailable') }));
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(notifications.error).toHaveBeenCalledOnceWith('settings.householdCopiesNotPurged');
      expect(mockTranslationService.t).not.toHaveBeenCalledWith(
        'settings.transactionsDeletedCopiesKept', jasmine.anything());
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    it('says the households no longer show the rows when a run with no rows left purges their copies', fakeAsync(() => {
      mockTransactionService.wipeTransactions.and.resolveTo({ deleted: 0, copiesPurged: 40 });
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(notifications.success).toHaveBeenCalledOnceWith('settings.householdCopiesRemoved');
      expect(mockTranslationService.t).not.toHaveBeenCalledWith(
        'settings.allTransactionsDeleted', jasmine.anything());
    }));

    it('reports 0 deleted for an account that had nothing to delete', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(mockTranslationService.t).toHaveBeenCalledWith('settings.allTransactionsDeleted', { count: 0 });
      expect(notifications.success).toHaveBeenCalledOnceWith('settings.allTransactionsDeleted');
    }));

    it('keeps saying the delete failed for any other rejection', fakeAsync(() => {
      mockTransactionService.wipeTransactions.and.rejectWith(new Error('unavailable'));
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteAllTransactions();
      tick();

      expect(notifications.error).toHaveBeenCalledOnceWith('settings.deleteTransactionsFailed');
      expect(mockTranslationService.t).not.toHaveBeenCalledWith(
        'settings.transactionsDeletedCopiesKept', jasmine.anything());
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
      imports: [DataManagementComponent],
      providers: [
        provideRouter([]),
        { provide: NotificationService, useValue: spy('NotificationService', ['success', 'error', 'info']) },
        { provide: ExportService, useValue: spy('ExportService', ['exportToJSON', 'exportTransactionsToCSV', 'downloadFile', 'parseImportFile']) },
        { provide: TransactionService, useValue: spy('TransactionService', ['exportAll', 'addTransaction', 'wipeTransactions']) },
        {
          provide: CategoryService,
          useValue: Object.assign(spy('CategoryService', ['exportAll']), {
            loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
          }),
        },
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
        provideNoMotion(),
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

  it('counts the rows that will land on the catch-all category', () => {
    fixture.detectChanges();
    component.importedTransactions.set([
      // Its own Category cell resolved — not part of the count.
      { date: new Date(), description: 'Lunch', amount: 12, type: 'expense', category: 'Restaurants', categoryId: 'food_restaurants' },
      // A cell the catalog could not match.
      { date: new Date(), description: 'Widget', amount: 8, type: 'expense', category: 'Nonexistent' },
      // No cell at all, in a file that carries the column.
      { date: new Date(), description: 'Gadget', amount: 5, type: 'expense', category: '' },
    ] as never);
    component.showImportPreview.set(true);
    fixture.detectChanges();

    expect(text('.unmatched-categories')).toBe('settings.csvUnmatchedCategories:{"count":2}');
  });

  it('says nothing about unmatched categories when the file carries no Category column at all', () => {
    fixture.detectChanges();
    component.importedTransactions.set([
      { date: new Date(), description: 'Lunch', amount: 12, type: 'expense' },
    ] as never);
    component.showImportPreview.set(true);
    fixture.detectChanges();

    expect(el().querySelector('.unmatched-categories')).toBeNull();
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
    expect(el().querySelector('mat-progress-bar')?.getAttribute('aria-label'))
      .toBe('settings.importProgressLabel:{"progress":40}');

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
    const bar = el().querySelector('.danger-zone mat-progress-bar');
    expect(bar).not.toBeNull();
    // Too generic a state to earn its own catalog entry.
    expect(bar?.getAttribute('aria-label')).toBe('common.loading');
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

  /**
   * A CSV preview's dates are a column: a box of one width on every row, so
   * the descriptions beside them start at one edge. `localeDate`'s medium
   * style is May 10, 2026 in en and 2026年10月17日 in ja (tc renders the same
   * string), so the box holds the widest of those on one line.
   *
   * Karma serves none of the app's fonts, so the host is pinned to Verdana,
   * whose metrics the Linux runner's DejaVu Sans matches to within a few
   * pixels, and its digits to a hundredth of one. Neither draws a CJK glyph:
   * those fall back to whatever face the machine has, 1 em each where there is
   * one, and to DejaVu's missing-glyph box, 0.6 em, where there is none.
   * Verdana's digits are wider than PT Sans's, so in this face a Japanese date
   * runs a few pixels past a box that holds it in the app's own. What holds in
   * both, Verdana on the Mac and DejaVu Sans on the runner, with or without a
   * CJK face, is that it ends before the description begins, and that is what
   * the Japanese case asserts; the English one, in Latin glyphs only, asserts
   * the box holds it, at the default font scale and at Extra large.
   */
  describe('a CSV preview date, in each language', () => {
    const FACE = "Verdana, 'DejaVu Sans', sans-serif";
    /** What `localeDate`'s medium style renders, by language and ISO day. */
    const MEDIUM: Record<string, Record<string, string>> = {
      en: { '2026-05-10': 'May 10, 2026', '2026-03-04': 'Mar 4, 2026' },
      ja: { '2026-10-17': '2026年10月17日', '2026-03-04': '2026年3月4日' },
    };

    afterEach(() => document.documentElement.style.removeProperty('--app-font-scale'));

    /**
     * The preview a CSV of one row per day in `MEDIUM[language]` reaches, the
     * rows' amounts in that order.
     */
    function preview(
      language: string,
      amounts = [10, 11]
    ): { row: HTMLElement; date: HTMLElement; description: HTMLElement; amount: HTMLElement }[] {
      const translation = TestBed.inject(TranslationService) as unknown as TranslationStub;
      translation.currentLocale.set(language);
      spyOn(TestBed.inject(LocaleFormatService), 'formatDate').and.callFake(
        value => MEDIUM[translation.currentLocale()][(value as Date).toISOString().slice(0, 10)] ?? ''
      );
      el().style.fontFamily = FACE;
      fixture.detectChanges();
      component.importedTransactions.set(
        Object.keys(MEDIUM[language]).map((day, i) => ({
          date: new Date(`${day}T00:00:00Z`),
          description: `Row ${i}`,
          amount: amounts[i],
          type: 'expense' as const,
          currency: 'USD',
        })) as never
      );
      component.showImportPreview.set(true);
      fixture.detectChanges();

      return (Array.from(el().querySelectorAll('.preview-item')) as HTMLElement[]).map(row => ({
        row,
        date: row.querySelector('.preview-date') as HTMLElement,
        description: row.querySelector('.preview-desc') as HTMLElement,
        amount: row.querySelector('.preview-amount') as HTMLElement,
      }));
    }

    /** Where the laid-out text ends, which a box that does not wrap can overrun. */
    function textEnd(element: Element): number {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().right;
    }

    it('keeps a Japanese date on one line, ending before its description, in boxes of one width', () => {
      const rows = preview('ja');
      expect(rows.map(row => row.date.textContent?.trim())).toEqual(['2026年10月17日', '2026年3月4日']);

      for (const { date, description } of rows) {
        const shown = date.textContent?.trim();
        expect(textLines(date)).withContext(`${shown} lines`).toBe(1);
        expect(textEnd(date))
          .withContext(`${shown} text end against its description's start, px`)
          .toBeLessThanOrEqual(description.getBoundingClientRect().left);
      }
      expect(rows[1].date.getBoundingClientRect().width)
        .withContext('the short date box against the long one, px')
        .toBe(rows[0].date.getBoundingClientRect().width);
    });

    /** The English dates, each on one line inside its box, the boxes of one width. */
    function expectEnglishDatesHeld(where: string): void {
      const rows = preview('en');
      expect(rows.map(row => row.date.textContent?.trim())).toEqual(['May 10, 2026', 'Mar 4, 2026']);

      for (const { date } of rows) {
        const shown = `${where}: ${date.textContent?.trim()}`;
        expect(textLines(date)).withContext(`${shown} lines`).toBe(1);
        expect(date.scrollWidth).withContext(`${shown} text width against its box, px`).toBeLessThanOrEqual(date.clientWidth);
      }
      expect(rows[1].date.getBoundingClientRect().width)
        .withContext(`${where}: the short date box against the long one, px`)
        .toBe(rows[0].date.getBoundingClientRect().width);
    }

    it('keeps an English date on one line, inside its box, in boxes of one width', () => {
      expectEnglishDatesHeld('at the default font scale');
    });

    // Pin: the box is in em, so it grows with the text at Extra large, where
    // May 10, 2026 is about 126 px in this face and a 105 px box would not hold it.
    it('keeps an English date inside its box at the Extra large font scale (pin)', () => {
      document.documentElement.style.setProperty('--app-font-scale', '1.3');
      expectEnglishDatesHeld('at Extra large');
    });

    /**
     * A 320 px phone leaves the preview 256 px, and each row 224 px with 200
     * of content: the stylesheet's arithmetic. At Extra large the date box is
     * 136.5 px and -$12,345.67 about 114 px in this face, and at the default
     * scale 105 and 88, so at no scale do the date, the description's floor
     * and the amount share a line; the row wraps, the description keeps its
     * floor on whichever line it lands, and the amount still ends the row.
     */
    describe('the row at a 320 px phone', () => {
      const DESCRIPTION_FLOOR_PX = 56;

      it('keeps every part inside the row at every font scale, the description at its floor or wider', () => {
        const host = el();
        host.style.display = 'block';
        host.style.width = '256px';
        const rows = preview('en', [12345.67, 4.5]);
        expect(rows.map(({ amount }) => amount.textContent?.trim())).toEqual(['-$12,345.67', '-$4.50']);

        for (const scale of FONT_SCALES) {
          document.documentElement.style.setProperty('--app-font-scale', String(scale));
          for (const { row, date, description, amount } of rows) {
            const shown = `at ${scale}: ${amount.textContent?.trim()}`;
            const edges = row.getBoundingClientRect();
            expect(edges.width).withContext(`${shown}: the row, px`).toBeCloseTo(224, 0);
            const contentEnd = edges.right - parseFloat(getComputedStyle(row).paddingRight);
            for (const [name, part] of [['date', date], ['description', description], ['amount', amount]] as const) {
              expect(part.getBoundingClientRect().right)
                .withContext(`${shown}: the ${name}'s end against the row's content edge, px`)
                .toBeLessThanOrEqual(contentEnd);
            }
            expect(amount.getBoundingClientRect().right)
              .withContext(`${shown}: the amount's end, on whichever line, against the row's content edge, px`)
              .toBeCloseTo(contentEnd, 0);
            expect(description.getBoundingClientRect().width)
              .withContext(`${shown}: the description's width, px`)
              .toBeGreaterThanOrEqual(DESCRIPTION_FLOOR_PX);
          }
        }
      });
    });
  });

  /**
   * The Smart Import card's two actions share a flex row, 261 px wide at a
   * 375 px phone: the browser run measured it there, and it is what the
   * 303 px section leaves inside its 20 px padding and 1 px border. Both
   * English labels took two lines in it, each button shrinking to make room
   * for the other. The row wraps instead, so a label that fits the row on
   * one line gets one, on a line of its own if need be.
   *
   * The stub renders a key as one long word, so the labels are the English
   * catalog's, and the face is pinned as docs/testing.md *Karma serves no
   * fonts* says: on the host, and on the three tokens Material's fields and
   * buttons take their faces from.
   */
  describe('the Smart Import actions at phone width', () => {
    const FACE = "Verdana, 'DejaVu Sans', sans-serif";
    const ROW_WIDTH_PX = 261;
    /** The section's 20 px padding and 1 px border, a side. */
    const SECTION_INSET_PX = 21;

    /** A key's English copy, or the key itself where the catalog has none. */
    function english(key: string): string {
      const found = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
      return typeof found === 'string' ? found : key;
    }

    /**
     * The row in a section `sectionWidth` px wide, with each action's label
     * checked to be one line inside it. Returns the line each action stands
     * on, by its top edge.
     */
    function actionLines(sectionWidth: number, where: string): number[] {
      (TestBed.inject(TranslationService) as unknown as TranslationStub).t = english;
      const host = el();
      host.style.display = 'block';
      host.style.width = `${sectionWidth}px`;
      host.style.fontFamily = FACE;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, FACE);
      }
      fixture.detectChanges();

      const row = el().querySelector('.smart-import-actions') as HTMLElement;
      const edges = row.getBoundingClientRect();
      expect(edges.width).withContext(`${where}: the row, px`).toBeCloseTo(sectionWidth - 2 * SECTION_INSET_PX, 0);

      const actions = Array.from(row.querySelectorAll<HTMLElement>('button'));
      const label = (action: HTMLElement) => action.querySelector('.mdc-button__label') as HTMLElement;
      expect(actions.map(action => label(action).textContent?.trim())).toEqual(['Start Smart Import', 'View History']);
      for (const action of actions) {
        const shown = `${where}: ${label(action).textContent?.trim()}`;
        const box = action.getBoundingClientRect();
        expect(textLines(label(action))).withContext(`${shown}: label lines`).toBe(1);
        expect(box.left).withContext(`${shown}: start against the row's, px`).toBeGreaterThanOrEqual(edges.left);
        expect(box.right).withContext(`${shown}: end against the row's, px`).toBeLessThanOrEqual(edges.right);
      }
      return actions.map(action => Math.round(action.getBoundingClientRect().top));
    }

    it('puts each action on one line inside the 261 px row, in English', () => {
      actionLines(ROW_WIDTH_PX + 2 * SECTION_INSET_PX, 'at 375 px');
    });

    // Pin: a row wide enough for both keeps them side by side.
    it('keeps both actions side by side where the row holds them, in English (pin)', () => {
      const lines = actionLines(600, 'in a 600 px section');
      expect(new Set(lines).size).withContext('lines the two actions stand on').toBe(1);
    });
  });

  describe('colours, as painted', () => {
    const THEMES = ['light', 'dark'] as const;

    /** What `<property>: <value>` computes to under the theme on <html> now. */
    function computedAs(value: string, property = 'color'): string {
      const probe = document.createElement('span');
      probe.style.setProperty(property, value);
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).getPropertyValue(property);
      } finally {
        probe.remove();
      }
    }

    const tokenValue = (token: string, property = 'color') => computedAs(`var(${token})`, property);

    /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: Element | null, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      if (!node) return;
      settleAnimations(document);
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on what it sits on`)
        .toBeGreaterThanOrEqual(floor);
    }

    /** Runs `fn` with `value` laid inline on `node` as `property`, then takes it off again. */
    function withInline(node: HTMLElement, property: string, value: string, fn: () => void): void {
      node.style.setProperty(property, value);
      try {
        settleAnimations(document);
        fn();
      } finally {
        node.style.removeProperty(property);
      }
    }

    // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11); text owes 4.5.
    it('paints the danger zone as an error tint on the card, its items on the card, and its copy at AA, in both themes', () => {
      fixture.detectChanges();
      const zone = el().querySelector('.danger-zone') as HTMLElement;
      const items = Array.from(zone.querySelectorAll('.danger-item')) as HTMLElement[];
      expect(items.length).withContext('the two danger items').toBe(2);

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const zoneStyle = getComputedStyle(zone);
          expect(zoneStyle.backgroundColor)
            .withContext(`${theme} zone fill`)
            .toBe(computedAs('color-mix(in srgb, var(--color-error) 8%, var(--surface-card))', 'background-color'));
          expect(zoneStyle.borderTopColor)
            .withContext(`${theme} zone edge`)
            .toBe(computedAs('color-mix(in srgb, var(--color-error) 30%, transparent)', 'border-top-color'));

          expectPainted(zone.querySelector('.section-header h3'), '--text-primary', `${theme} heading`);
          expectPainted(zone.querySelector('.section-description'), '--text-muted', `${theme} description`);
          expectPainted(zone.querySelector('.section-icon.danger'), '--color-error', `${theme} warning glyph`, 3);

          items.forEach((item, i) => {
            expect(getComputedStyle(item).backgroundColor)
              .withContext(`${theme} item ${i} fill`)
              .toBe(tokenValue('--surface-card', 'background-color'));
            expectPainted(item.querySelector('.danger-title'), '--text-primary', `${theme} item ${i} title`);
            expectPainted(item.querySelector('.danger-desc'), '--text-muted', `${theme} item ${i} description`);
          });
        });
      }
    });

    /**
     * The painted helpers do not see a gradient, so each end of it is laid
     * under the section in turn as a flat fill, and the copy is measured on
     * both.
     */
    it('tints Smart Import from accent to AI over the page, with its AI glyphs in --color-ai and its copy at AA at both ends, in both themes', () => {
      fixture.detectChanges();
      const section = el().querySelector('.smart-import-section') as HTMLElement;
      const features = Array.from(section.querySelectorAll('.feature-item')) as HTMLElement[];
      expect(features.length).withContext('the four features').toBe(4);
      const ends = {
        start: 'color-mix(in srgb, var(--color-accent) 10%, var(--surface-background))',
        end: 'color-mix(in srgb, var(--color-ai) 10%, var(--surface-background))',
      };

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const style = getComputedStyle(section);
          expect(style.backgroundImage)
            .withContext(`${theme} tint`)
            .toBe(computedAs(`linear-gradient(to right, ${ends.start}, ${ends.end})`, 'background-image'));
          expect(style.borderTopColor)
            .withContext(`${theme} edge`)
            .toBe(computedAs('color-mix(in srgb, var(--color-accent) 30%, transparent)', 'border-top-color'));

          for (const [name, end] of Object.entries(ends)) {
            withInline(section, 'background', end, () => {
              const at = `${theme}, at the ${name}`;
              expectPainted(section.querySelector('.section-header h3'), '--text-primary', `${at}: heading`);
              expectPainted(section.querySelector('.section-description'), '--text-muted', `${at}: description`);
              expectPainted(section.querySelector('.section-icon.ai-icon'), '--color-ai', `${at}: AI glyph`, 3);
              features.forEach((feature, i) => {
                expectPainted(feature.querySelector('span'), '--text-secondary', `${at}: feature ${i}`);
                expectPainted(feature.querySelector('mat-icon'), '--color-ai', `${at}: feature ${i} glyph`, 3);
              });
            });
          }
        });
      }
    });

    it('paints the export buttons in the text tokens on the page, edged in --border-primary, in both themes', () => {
      fixture.detectChanges();
      const buttons = Array.from(el().querySelectorAll('.export-btn')) as HTMLElement[];
      expect(buttons.length).withContext('the two exports').toBe(2);

      for (const theme of THEMES) {
        withTheme(theme, () => {
          buttons.forEach((exportButton, i) => {
            settleAnimations(document);
            expect(getComputedStyle(exportButton).borderTopColor)
              .withContext(`${theme} export ${i} edge`)
              .toBe(tokenValue('--border-primary', 'border-top-color'));
            expectPainted(exportButton.querySelector('.btn-title'), '--text-primary', `${theme} export ${i} title`);
            expectPainted(exportButton.querySelector('.btn-subtitle'), '--text-muted', `${theme} export ${i} subtitle`);
          });
        });
      }
    });

    it('tints a hovered export button with the primary over the page, its copy still at AA, in both themes', () => {
      fixture.detectChanges();
      const exportButton = el().querySelector('.export-btn') as HTMLElement;
      const fill = hoverValue(exportButton, '.export-btn', 'background-color');
      const edge = hoverValue(exportButton, '.export-btn', 'border-color');
      expect(fill).withContext('the hover fill').toBe('color-mix(in srgb, var(--color-primary) 10%, var(--surface-background))');
      expect(edge).withContext('the hover edge').toBe('color-mix(in srgb, var(--color-primary) 40%, transparent)');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          withInline(exportButton, 'background-color', fill, () => {
            expectPainted(exportButton.querySelector('.btn-title'), '--text-primary', `${theme} hovered title`);
            expectPainted(exportButton.querySelector('.btn-subtitle'), '--text-muted', `${theme} hovered subtitle`);
          });
        });
      }
    });

    it('paints the dropzone in the text tokens on its subtle fill, at rest and hovered, in both themes', () => {
      fixture.detectChanges();
      const zone = el().querySelector('.import-dropzone') as HTMLElement;
      const glyph = zone.querySelector('mat-icon') as HTMLElement;
      const fill = hoverValue(zone, '.import-dropzone', 'background');
      const edge = hoverValue(zone, '.import-dropzone', 'border-color');
      const hoveredGlyph = hoverValue(glyph, '.import-dropzone', 'color');
      expect(fill).withContext('the hover fill').toBe('color-mix(in srgb, var(--color-primary) 10%, var(--surface-subtle))');
      expect(edge).withContext('the hover edge').toBe('color-mix(in srgb, var(--color-primary) 40%, transparent)');
      expect(hoveredGlyph).withContext('the hovered glyph').toBe('var(--color-primary)');

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          const style = getComputedStyle(zone);
          expect(style.borderTopColor).withContext(`${theme} edge`).toBe(tokenValue('--border-primary', 'border-top-color'));
          expect(style.borderTopStyle).withContext(`${theme} edge style`).toBe('dashed');
          expect(style.backgroundColor).withContext(`${theme} fill`).toBe(tokenValue('--surface-subtle', 'background-color'));
          expectPainted(glyph, '--text-muted', `${theme} glyph`, 3);
          expectPainted(zone.querySelector('.dropzone-text'), '--text-secondary', `${theme} prompt`);
          expectPainted(zone.querySelector('.dropzone-hint'), '--text-muted', `${theme} hint`);

          withInline(zone, 'background', fill, () => {
            // The hovered glyph's colour is the CSSOM rule read above; laid
            // inline, only its contrast on the hovered fill is left to measure.
            withInline(glyph, 'color', hoveredGlyph, () => {
              expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
                .withContext(`${theme} hovered glyph on the hovered fill`)
                .toBeGreaterThanOrEqual(3);
            });
            expectPainted(zone.querySelector('.dropzone-text'), '--text-secondary', `${theme} hovered prompt`);
            expectPainted(zone.querySelector('.dropzone-hint'), '--text-muted', `${theme} hovered hint`);
          });
        });
      }
    });

    it('paints a CSV preview in the text tokens, divided from its actions by --border-primary, in both themes', () => {
      fixture.detectChanges();
      component.importedTransactions.set(
        Array.from({ length: 6 }, (_, i) => ({
          date: new Date('2026-03-04T00:00:00Z'),
          description: `Row ${i}`,
          amount: 10 + i,
          type: 'expense' as const,
          currency: 'USD',
        })) as never
      );
      component.showImportPreview.set(true);
      fixture.detectChanges();
      const row = el().querySelector('.preview-item') as HTMLElement;
      const actions = el().querySelector('.preview-actions') as HTMLElement;

      for (const theme of THEMES) {
        withTheme(theme, () => {
          settleAnimations(document);
          expectPainted(el().querySelector('.preview-header'), '--text-secondary', `${theme} header`);
          expectPainted(row.querySelector('.preview-date'), '--text-muted', `${theme} date`);
          expectPainted(row.querySelector('.preview-desc'), '--text-secondary', `${theme} description`);
          expectPainted(el().querySelector('.preview-more'), '--text-muted', `${theme} the rest`);
          expect(getComputedStyle(actions).borderTopColor)
            .withContext(`${theme} actions divider`)
            .toBe(tokenValue('--border-primary', 'border-top-color'));
        });
      }
    });
  });
});

/**
 * Every text-label appearance Material offers, each alone in a flex row of
 * the probe's width, once bare and once with a leading icon, which moves a
 * text button onto Material's own icon padding rule. Then the controls the
 * rule must not reach: an icon button, a FAB and a mini FAB.
 */
@Component({
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @for (appearance of appearances; track appearance) {
      @for (icon of [false, true]; track icon) {
        <div class="probe-row" [style.width.px]="width()">
          <button type="button" [matButton]="appearance" [attr.data-probe]="appearance + (icon ? ' with an icon' : '')">
            @if (icon) {
              <mat-icon>upload</mat-icon>
            }
            {{ label() }}
          </button>
        </div>
      }
    }
    <div class="probe-row">
      <button type="button" mat-icon-button data-untouched="icon button" aria-label="Upload"><mat-icon>upload</mat-icon></button>
      <button type="button" mat-fab data-untouched="FAB" aria-label="Upload"><mat-icon>upload</mat-icon></button>
      <button type="button" mat-mini-fab data-untouched="mini FAB" aria-label="Upload"><mat-icon>upload</mat-icon></button>
    </div>
  `,
  styles: `.probe-row { display: flex; }`,
})
class ButtonLabelProbeComponent {
  readonly appearances = ['text', 'filled', 'elevated', 'outlined', 'tonal'] as const;
  readonly width = signal(90);
  readonly label = signal('Start Smart Import');
}

/**
 * Two outlined buttons with one-line labels in an open expansion panel, whose
 * content Material sets in `--mat-sys-body-large-line-height`, 1.5rem: a
 * length, so it grows with the account's font scale and not with a label's
 * own size. One at Material's own 40 px, and one as the duplicate warning
 * styles its actions (duplicate-warning.component.scss): 34 px tall, a 0.75rem
 * label and a 1em icon at 1rem.
 */
@Component({
  standalone: true,
  imports: [MatButtonModule, MatExpansionModule, MatIconModule],
  template: `
    <mat-expansion-panel [expanded]="true">
      <div class="probe-row">
        <button type="button" matButton="outlined" data-in-panel="40">Test</button>
        <button type="button" matButton="outlined" class="compact" data-in-panel="34"><mat-icon>block</mat-icon>Test</button>
      </div>
    </mat-expansion-panel>
  `,
  styles: `
    .probe-row { display: flex; gap: 8px; }
    .compact { font-size: var(--text-xs); height: 34px; }
    .compact mat-icon { font-size: var(--text-base); width: 1em; height: 1em; }
  `,
})
class PanelButtonProbeComponent {}

/**
 * A Material button keeps a fixed 40 px height whatever its label does, so a
 * label that wraps in a narrow row paints above and below the pill: the
 * browser run found 履歴を見る on three lines in a 99 px button on this page
 * at 375 px. styles.scss lets every text-label button grow with its label
 * instead. Karma bundles styles.scss (angular.json's test `styles`), so the
 * rule is in force here as it is in the app.
 *
 * Karma serves none of the app's fonts, so the face is pinned as
 * docs/testing.md *Karma serves no fonts* says: on the host, and on the three
 * tokens Material's fields and buttons take their faces from (an expansion
 * panel's content reads the body one).
 */
describe('a Material button whose label wraps', () => {
  const FACE = "Verdana, 'DejaVu Sans', sans-serif";
  let fixture: ComponentFixture<ButtonLabelProbeComponent>;

  function pinFace(host: HTMLElement): void {
    host.style.display = 'block';
    host.style.fontFamily = FACE;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
      host.style.setProperty(token, FACE);
    }
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonLabelProbeComponent, PanelButtonProbeComponent],
      providers: [provideNoMotion()],
    }).compileComponents();
    fixture = TestBed.createComponent(ButtonLabelProbeComponent);
    pinFace(fixture.nativeElement as HTMLElement);
  });

  afterEach(() => document.documentElement.style.removeProperty('--app-font-scale'));

  const probes = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-probe]'));
  const label = (button: HTMLElement) => button.querySelector('.mdc-button__label') as HTMLElement;

  /** Where the label's text is drawn: the union of its laid-out glyph boxes. */
  function ink(button: HTMLElement): DOMRect {
    const range = document.createRange();
    range.selectNodeContents(label(button));
    return range.getBoundingClientRect();
  }

  it('grows a button around a label wrapped in a 90 px row, in every appearance', () => {
    fixture.detectChanges();

    expect(probes().length).withContext('five appearances, bare and with an icon').toBe(10);
    for (const button of probes()) {
      const name = button.dataset['probe'];
      const box = button.getBoundingClientRect();
      const drawn = ink(button);
      expect(textLines(label(button))).withContext(`${name}: the label wraps`).toBeGreaterThan(1);
      expect(box.height).withContext(`${name}: height, px`).toBeGreaterThanOrEqual(40);
      expect(drawn.top).withContext(`${name}: ink top against the button's top edge, px`).toBeGreaterThanOrEqual(box.top);
      expect(drawn.bottom).withContext(`${name}: ink bottom against the button's bottom edge, px`).toBeLessThanOrEqual(box.bottom);
      expect(drawn.left).withContext(`${name}: ink start against the button's start edge, px`).toBeGreaterThanOrEqual(box.left);
      expect(drawn.right).withContext(`${name}: ink end against the button's end edge, px`).toBeLessThanOrEqual(box.right);
      // The ink sits the line's half-leading inside the content box (2 px in
      // Verdana, 2.5 in DejaVu Sans, about 1.5 in the app's PT Sans), and the
      // rule's 4 px of block padding, with the outline where there is one,
      // adds to it: 6 px in Verdana, 7 outlined. So 4 is a floor that fails
      // once the padding falls below about 2 px, not a pin on the 4 px
      // itself. Material's (0,2,0) rule for a text button with an icon keeps
      // that one at no block padding, and it draws no edge.
      if (name !== 'text with an icon') {
        expect(drawn.top - box.top).withContext(`${name}: room above the ink, px`).toBeGreaterThanOrEqual(4);
        expect(box.bottom - drawn.bottom).withContext(`${name}: room below the ink, px`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  // Pin: the room the rule keeps around a wrapped label must not make a label
  // that fits taller, at the largest font scale either.
  for (const scale of ['1', '1.3'] as const) {
    it(`keeps a one-line label's button at exactly 40 px in every appearance at scale ${scale} (pin)`, () => {
      document.documentElement.style.setProperty('--app-font-scale', scale);
      fixture.componentInstance.width.set(400);
      fixture.componentInstance.label.set('Test');
      fixture.detectChanges();

      for (const button of probes()) {
        const name = button.dataset['probe'];
        expect(textLines(label(button))).withContext(`${name}: label lines`).toBe(1);
        expect(button.getBoundingClientRect().height).withContext(`${name}: height, px`).toBe(40);
      }
    });
  }

  /**
   * An expansion panel's content carries a line height of 1.5rem, which an
   * inherited line-height takes into a button's label as 24 px times the font
   * scale, whatever the label's own size: an outlined button's one line would
   * come to 31.2 + 8 + 2 = 41.2 px at Extra large, and the duplicate warning's
   * 34 px buttons to 37.6 px at 1.15. The rule gives the label a unitless 1.5
   * of its own, so one line is 1.5 times the label's size wherever the button
   * sits: 37.3 px for Material's 0.875rem at 1.3, and 33.4 px for 0.75rem.
   */
  describe('in an expansion panel', () => {
    let panel: ComponentFixture<PanelButtonProbeComponent>;

    beforeEach(() => {
      panel = TestBed.createComponent(PanelButtonProbeComponent);
      pinFace(panel.nativeElement as HTMLElement);
    });

    for (const scale of [1.15, 1.3]) {
      it(`keeps a one-line label's outlined button at its own height at scale ${scale}`, () => {
        document.documentElement.style.setProperty('--app-font-scale', String(scale));
        panel.detectChanges();

        const root = panel.nativeElement as HTMLElement;
        const body = root.querySelector('.mat-expansion-panel-body') as HTMLElement;
        expect(parseFloat(getComputedStyle(body).lineHeight))
          .withContext("the panel body's line height, px")
          .toBeCloseTo(24 * scale, 1);
        const buttons = Array.from(root.querySelectorAll<HTMLElement>('[data-in-panel]'));
        expect(buttons.map(button => button.dataset['inPanel'])).toEqual(['40', '34']);
        for (const button of buttons) {
          const height = Number(button.dataset['inPanel']);
          expect(textLines(label(button))).withContext(`the ${height} px button: label lines`).toBe(1);
          expect(button.getBoundingClientRect().height).withContext(`the ${height} px button: height, px`).toBe(height);
        }
      });
    }
  });

  // Pin: icon buttons and FABs size themselves around a glyph, and the rule
  // is for labels only.
  it('leaves icon buttons and FABs as Material sizes them (pin)', () => {
    fixture.detectChanges();

    const untouched = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-untouched]')
    );
    expect(untouched.map(button => button.dataset['untouched'])).toEqual(['icon button', 'FAB', 'mini FAB']);
    for (const button of untouched) {
      expect(getComputedStyle(button).minHeight).withContext(`${button.dataset['untouched']}: min-height`).toBe('auto');
    }
    expect(untouched.map(button => button.getBoundingClientRect().height)).toEqual([40, 56, 40]);
  });
});
