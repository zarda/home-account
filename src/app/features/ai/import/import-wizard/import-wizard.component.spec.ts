import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ImportWizardComponent } from './import-wizard.component';
import { AIImportService } from '../../../../core/services/ai-import.service';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { Category, CategorizedImportTransaction, ImportResult } from '../../../../models';

describe('ImportWizardComponent', () => {
  let component: ImportWizardComponent;
  let fixture: ComponentFixture<ImportWizardComponent>;
  let mockImportService: jasmine.SpyObj<AIImportService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockRouter: jasmine.SpyObj<Router>;

  const mockCategories: Category[] = [
    {
      id: 'food',
      name: 'Food',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      isActive: true,
      isDefault: true,
      userId: 'user1',
      order: 0
    }
  ];

  const mockTransactions: CategorizedImportTransaction[] = [
    {
      id: 'txn1',
      description: 'Coffee',
      amount: 5,
      currency: 'USD',
      date: new Date(),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.9,
      isDuplicate: false,
      selected: true
    },
    {
      id: 'txn2',
      description: 'Salary',
      amount: 3000,
      currency: 'USD',
      date: new Date(),
      type: 'income',
      suggestedCategoryId: 'salary',
      categoryConfidence: 0.95,
      isDuplicate: false,
      selected: true
    }
  ];

  const mockImportResult: ImportResult = {
    source: 'csv',
    fileType: 'generic_csv',
    fileName: 'test.csv',
    fileSize: 1024,
    transactions: mockTransactions,
    confidence: 0.9,
    warnings: [],
    duplicates: []
  };

  beforeEach(async () => {
    mockImportService = jasmine.createSpyObj('AIImportService', ['importFromFile', 'confirmImport'], {
      isProcessing: signal(false),
      processingStatus: signal(''),
      processingProgress: signal(0)
    });
    mockImportService.importFromFile.and.returnValue(Promise.resolve(mockImportResult));
    mockImportService.confirmImport.and.returnValue(Promise.resolve({
      id: 'history1',
      userId: 'user1',
      importedAt: { seconds: Date.now() / 1000 } as never,
      source: 'csv',
      fileType: 'generic_csv',
      fileName: 'test.csv',
      fileSize: 1024,
      transactionCount: 2,
      successCount: 2,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 3000,
      totalExpenses: 5,
      duplicatesSkipped: 0,
      status: 'completed' as const
    }));

    mockCategoryService = jasmine.createSpyObj('CategoryService', [], {
      categories: signal(mockCategories)
    });

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => key);

    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [ImportWizardComponent, NoopAnimationsModule],
      providers: [
        { provide: AIImportService, useValue: mockImportService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: Router, useValue: mockRouter }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(ImportWizardComponent, {
        set: {
          template: '<div></div>',
          providers: []
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ImportWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should have no selected files initially', () => {
      expect(component.selectedFiles().length).toBe(0);
    });

    it('should have no extracted transactions initially', () => {
      expect(component.extractedTransactions().length).toBe(0);
    });

    it('should not be importing initially', () => {
      expect(component.isImporting()).toBeFalse();
    });

    it('should have accepted file types', () => {
      expect(component.acceptedFileTypes).toBe('.csv,.pdf,.png,.jpg,.jpeg,.webp');
    });
  });

  describe('uploadComplete', () => {
    it('should return false when no files selected', () => {
      expect(component.uploadComplete()).toBeFalse();
    });

    it('should return true when files are selected', () => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);

      expect(component.uploadComplete()).toBeTrue();
    });
  });

  describe('processingComplete', () => {
    it('should return false when still processing', () => {
      expect(component.processingComplete()).toBeFalse();
    });

    it('should return true when not processing and has transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      expect(component.processingComplete()).toBeTrue();
    });
  });

  describe('reviewComplete', () => {
    it('should return false when no transactions selected', () => {
      expect(component.reviewComplete()).toBeFalse();
    });

    it('should return true when transactions are selected', () => {
      component.selectedTransactionIds.set(new Set(['txn1']));

      expect(component.reviewComplete()).toBeTrue();
    });
  });

  describe('selectedCount', () => {
    it('should count selected transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      expect(component.selectedCount()).toBe(2);
    });
  });

  describe('selectedIncome', () => {
    it('should sum income transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      expect(component.selectedIncome()).toBe(3000);
    });
  });

  describe('selectedExpenses', () => {
    it('should sum expense transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      expect(component.selectedExpenses()).toBe(5);
    });
  });

  describe('onFilesSelected', () => {
    it('should set selected files', () => {
      const files = [new File([''], 'test.csv', { type: 'text/csv' })];

      component.onFilesSelected(files);

      expect(component.selectedFiles()).toEqual(files);
    });

    it('should reset extracted transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      component.onFilesSelected([]);

      expect(component.extractedTransactions().length).toBe(0);
    });

    it('should reset processing error', () => {
      component.processingError.set('Some error');

      component.onFilesSelected([]);

      expect(component.processingError()).toBeNull();
    });
  });

  describe('processFiles', () => {
    it('should call importFromFile for each file', fakeAsync(() => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);

      component.processFiles();
      tick();

      expect(mockImportService.importFromFile).toHaveBeenCalledWith(file);
    }));

    it('should set extracted transactions from result', fakeAsync(() => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);

      component.processFiles();
      tick();

      expect(component.extractedTransactions().length).toBe(2);
    }));

    it('should auto-select non-duplicate transactions', fakeAsync(() => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);

      component.processFiles();
      tick();

      expect(component.selectedTransactionIds().size).toBe(2);
    }));

    it('should set processing error on failure', fakeAsync(() => {
      mockImportService.importFromFile.and.returnValue(Promise.reject(new Error('Test error')));
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);

      component.processFiles();
      tick();

      expect(component.processingError()).toBe('Test error');
    }));
  });

  describe('onTransactionsUpdated', () => {
    it('should update extracted transactions', () => {
      component.onTransactionsUpdated(mockTransactions);

      expect(component.extractedTransactions()).toEqual(mockTransactions);
    });
  });

  describe('onSelectionChanged', () => {
    it('should update selected transaction ids', () => {
      const ids = new Set(['txn1', 'txn2']);

      component.onSelectionChanged(ids);

      expect(component.selectedTransactionIds()).toEqual(ids);
    });
  });

  describe('excludeAllDuplicates', () => {
    it('should deselect all duplicate transactions', () => {
      const transactions: CategorizedImportTransaction[] = [
        { ...mockTransactions[0], isDuplicate: true, selected: true },
        { ...mockTransactions[1], isDuplicate: false, selected: true }
      ];
      component.extractedTransactions.set(transactions);

      component.excludeAllDuplicates();

      const updated = component.extractedTransactions();
      expect(updated.find(t => t.isDuplicate)?.selected).toBeFalse();
      expect(updated.find(t => !t.isDuplicate)?.selected).toBeTrue();
    });
  });

  describe('includeAllDuplicates', () => {
    it('should select all transactions including duplicates', () => {
      const transactions: CategorizedImportTransaction[] = [
        { ...mockTransactions[0], isDuplicate: true, selected: false },
        { ...mockTransactions[1], isDuplicate: false, selected: false }
      ];
      component.extractedTransactions.set(transactions);

      component.includeAllDuplicates();

      const updated = component.extractedTransactions();
      expect(updated.every(t => t.selected)).toBeTrue();
    });
  });

  describe('confirmImport', () => {
    beforeEach(() => {
      const file = new File([''], 'test.csv', { type: 'text/csv' });
      component.selectedFiles.set([file]);
      component.extractedTransactions.set(mockTransactions);
    });

    it('should call confirmImport on service', fakeAsync(() => {
      component.confirmImport();
      tick();

      expect(mockImportService.confirmImport).toHaveBeenCalled();
    }));

    it('should navigate to transactions page on success', fakeAsync(() => {
      component.confirmImport();
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions']);
    }));

    it('should set isImporting to false after completion', fakeAsync(() => {
      component.confirmImport();
      tick();

      expect(component.isImporting()).toBeFalse();
    }));

    it('should handle import failure gracefully', fakeAsync(() => {
      mockImportService.confirmImport.and.returnValue(Promise.reject(new Error('Import failed')));

      // Should not throw
      expect(() => {
        component.confirmImport();
        tick();
      }).not.toThrow();

      expect(component.isImporting()).toBeFalse();
    }));
  });

  describe('goBack', () => {
    it('should navigate to settings', () => {
      component.goBack();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/settings']);
    });
  });

  describe('duplicatesSkipped', () => {
    it('should count unselected duplicates', () => {
      const transactions: CategorizedImportTransaction[] = [
        { ...mockTransactions[0], isDuplicate: true, selected: false },
        { ...mockTransactions[1], isDuplicate: true, selected: true },
        { ...mockTransactions[0], id: 'txn3', isDuplicate: false, selected: true }
      ];
      component.extractedTransactions.set(transactions);

      expect(component.duplicatesSkipped()).toBe(1);
    });
  });
});
