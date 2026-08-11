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
import { Firestore } from '@angular/fire/firestore';

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
    mockBudgetService = jasmine.createSpyObj('BudgetService', ['exportAll', 'createBudget']);
    mockBudgetService.exportAll.and.returnValue(Promise.resolve([]));
    mockRecurringService = jasmine.createSpyObj('RecurringService', ['exportAll', 'createRecurring']);
    mockRecurringService.exportAll.and.returnValue(Promise.resolve([]));
    mockGoalService = jasmine.createSpyObj('GoalService', ['exportAll', 'createGoal']);
    mockGoalService.exportAll.and.resolveTo([]);
    mockBackupRestore = jasmine.createSpyObj('BackupRestoreService', ['parse', 'describe', 'restore']);

    // Root-provided, so without this the real service is constructed and its
    // Firestore injection fails.
    mockInsightSnapshots = jasmine.createSpyObj('InsightSnapshotService', ['exportAll', 'deleteAll']);
    mockInsightSnapshots.exportAll.and.returnValue(Promise.resolve([]));
    mockInsightSnapshots.deleteAll.and.returnValue(Promise.resolve());

    mockAuthService = jasmine.createSpyObj('AuthService', ['signOut']);
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
  describe('confirmRestore', () => {
    const emptySummary = {
      transactions: 0, categories: 0, budgets: 0, recurring: 0, goals: 0,
      insightSnapshots: 0, skipped: [] as { section: string; id: string; reason: string }[],
    };

    const emptyContents = {
      version: '1.4', exportDate: '2026-08-01',
      transactions: 0, categories: 0, budgets: 0, recurring: 0, goals: 0, insightSnapshots: 0,
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
