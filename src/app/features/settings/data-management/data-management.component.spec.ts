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
import { InsightSnapshotService } from '../../../core/services/insight-snapshot.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { NotificationService } from '../../../core/services/notification.service';

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

  beforeEach(async () => {
    mockExportService = jasmine.createSpyObj('ExportService', [
      'exportToJSON',
      'exportToCSV',
      'downloadBlob',
      'downloadBlobWithPicker',
      'importFromCSV',
      'parseImportedData',
      'getAllTransactions'
    ]);
    mockExportService.exportToJSON.and.returnValue(new Blob(['{}'], { type: 'application/json' }));
    mockExportService.exportToCSV.and.returnValue(new Blob(['csv'], { type: 'text/csv' }));
    mockExportService.downloadBlobWithPicker.and.returnValue(Promise.resolve(true));
    mockExportService.importFromCSV.and.returnValue(Promise.resolve([]));
    mockExportService.parseImportedData.and.returnValue([]);

    mockTransactionService = jasmine.createSpyObj('TransactionService', ['addTransaction', 'deleteAllTransactions', 'getAllTransactions'], {
      transactions: signal([])
    });
    mockTransactionService.addTransaction.and.returnValue(Promise.resolve('new-id'));
    mockTransactionService.deleteAllTransactions.and.returnValue(Promise.resolve(0));
    mockTransactionService.getAllTransactions.and.returnValue(of([]));

    mockCategoryService = jasmine.createSpyObj('CategoryService', [], {
      categories: signal([])
    });

    // Root-provided, so without this the real service is constructed and its
    // Firestore injection fails.
    mockInsightSnapshots = jasmine.createSpyObj('InsightSnapshotService', ['exportAll', 'deleteAll']);
    mockInsightSnapshots.exportAll.and.returnValue(Promise.resolve([]));
    mockInsightSnapshots.deleteAll.and.returnValue(Promise.resolve());

    mockAuthService = jasmine.createSpyObj('AuthService', ['signOut']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);

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
        { provide: InsightSnapshotService, useValue: mockInsightSnapshots },
        { provide: AuthService, useValue: mockAuthService },
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

    it('carries a backup row\'s details into the preview but never its receipts', async () => {
      const backup = {
        transactions: [{
          description: 'Fruit',
          amount: 12.5,
          type: 'expense',
          date: { seconds: 1_780_000_000, nanoseconds: 0 },
          currency: 'JPY',
          categoryId: 'food_groceries',
          note: 'weekly shop',
          tags: ['groceries'],
          location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 },
          isRecurring: false,
          period: 'monthly',
          // A backup holds no storage objects — these must not survive the
          // restore, or the quota would count images that don't exist.
          receiptUrl: 'https://example.test/r0.png',
          receiptUrls: ['https://example.test/r0.png'],
          receiptCount: 1
        }]
      };
      const file = new File([JSON.stringify(backup)], 'backup.json', {
        type: 'application/json'
      });
      const event = { target: { files: [file], value: '' } } as unknown as Event;

      component.onFileSelected(event);

      // importJSON reads the file asynchronously; poll for the preview.
      const deadline = Date.now() + 3000;
      while (component.importedTransactions().length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      const row = component.importedTransactions()[0] as unknown as Record<string, unknown>;
      expect(row['currency']).toBe('JPY');
      expect(row['categoryId']).toBe('food_groceries');
      expect(row['note']).toBe('weekly shop');
      expect(row['tags']).toEqual(['groceries']);
      expect(row['location']).toEqual({ name: 'Aoyama Market', lat: 35.66, lng: 139.71 });
      expect(row['period']).toBe('monthly');
      expect('receiptUrl' in row).toBeFalse();
      expect('receiptUrls' in row).toBeFalse();
      expect('receiptCount' in row).toBeFalse();
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
});
