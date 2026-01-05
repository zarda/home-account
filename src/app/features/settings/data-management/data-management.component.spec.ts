import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DataManagementComponent } from './data-management.component';
import { ExportService } from '../../../core/services/export.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { CategoryService } from '../../../core/services/category.service';
import { AuthService } from '../../../core/services/auth.service';

describe('DataManagementComponent', () => {
  let component: DataManagementComponent;
  let fixture: ComponentFixture<DataManagementComponent>;
  let mockExportService: jasmine.SpyObj<ExportService>;
  let mockTransactionService: jasmine.SpyObj<TransactionService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;

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
    mockTransactionService.deleteAllTransactions.and.returnValue(Promise.resolve());
    mockTransactionService.getAllTransactions.and.returnValue(of([]));

    mockCategoryService = jasmine.createSpyObj('CategoryService', [], {
      categories: signal([])
    });

    mockAuthService = jasmine.createSpyObj('AuthService', ['signOut']);

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [DataManagementComponent, NoopAnimationsModule],
      providers: [
        { provide: ExportService, useValue: mockExportService },
        { provide: TransactionService, useValue: mockTransactionService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(DataManagementComponent, {
        set: {
          template: '<div></div>',
          providers: [
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar }
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

      expect(mockSnackBar.open).toHaveBeenCalledWith('settings.backupExported', 'common.close', { duration: 3000 });
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

      expect(mockSnackBar.open).toHaveBeenCalledWith('settings.transactionsExported', 'common.close', { duration: 3000 });
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

      expect(mockSnackBar.open).toHaveBeenCalledWith('settings.invalidFileType', 'common.close', { duration: 3000 });
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
  });

  describe('signOut', () => {
    it('should open confirm dialog', () => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.signOut();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should call authService.signOut when confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(true) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.signOut();
      tick();

      expect(mockAuthService.signOut).toHaveBeenCalled();
    }));
  });
});
