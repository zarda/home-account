import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ImportWizardComponent } from './import-wizard.component';
import { AIImportService, IMPORT_READBACK_FAILED } from '../../../../core/services/ai-import.service';
import { DuplicateDetectionService } from '../../../../core/services/duplicate-detection.service';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { AnnouncerService } from '../../../../core/services/announcer.service';
import { Category, CategorizedImportTransaction, ImportResult } from '../../../../models';
import { NotificationService } from '../../../../core/services/notification.service';
import { ShareIntakeService } from '../../../../core/services/share-intake.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';

describe('ImportWizardComponent', () => {
  let component: ImportWizardComponent;
  let fixture: ComponentFixture<ImportWizardComponent>;
  let mockImportService: jasmine.SpyObj<AIImportService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockDuplicateService: jasmine.SpyObj<DuplicateDetectionService>;
  let mockShareIntake: jasmine.SpyObj<ShareIntakeService>;
  let mockAnalytics: jasmine.SpyObj<AnalyticsService>;
  let routeStub: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> } };

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
    mockImportService = jasmine.createSpyObj('AIImportService', ['importFromFile', 'importFromMultipleImages', 'importFromStatementImages', 'confirmImport', 'parseAIError'], {
      isProcessing: signal(false),
      processingStatus: signal(''),
      processingProgress: signal(0)
    });
    // Per-path results carry the pair the real service reports; a shared
    // csv-shaped fixture here is what let the confirm step's hardcoded
    // 'csv'/'generic_csv' pass unnoticed.
    mockImportService.importFromFile.and.returnValue(Promise.resolve(mockImportResult));
    mockImportService.importFromMultipleImages.and.returnValue(Promise.resolve({
      ...mockImportResult, source: 'image' as const, fileType: 'receipt_image' as const
    }));
    mockImportService.importFromStatementImages.and.returnValue(Promise.resolve({
      ...mockImportResult, source: 'image' as const, fileType: 'screenshot' as const
    }));
    mockImportService.parseAIError.and.callFake((error: unknown) => ({
      message: error instanceof Error ? error.message : String(error),
      type: 'unknown',
      retryable: true
    }));
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

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories'], {
      categories: signal(mockCategories)
    });
    mockCategoryService.loadCategories.and.returnValue(of([]));

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    mockTranslationService.t.and.callFake((key: string) => key);

    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockDuplicateService = jasmine.createSpyObj('DuplicateDetectionService', [
      'findWithinBatchDuplicates',
    ]);
    mockDuplicateService.findWithinBatchDuplicates.and.returnValue([]);

    mockShareIntake = jasmine.createSpyObj('ShareIntakeService', ['consumeAll']);
    mockShareIntake.consumeAll.and.resolveTo([]);
    mockAnalytics = jasmine.createSpyObj('AnalyticsService', ['trackReceiptImport']);
    routeStub = { snapshot: { queryParamMap: convertToParamMap({}) } };

    await TestBed.configureTestingModule({
      imports: [ImportWizardComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIImportService, useValue: mockImportService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        { provide: Router, useValue: mockRouter },
        { provide: DuplicateDetectionService, useValue: mockDuplicateService },
        { provide: ShareIntakeService, useValue: mockShareIntake },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: ActivatedRoute, useValue: routeStub }
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

  describe('share intake', () => {
    it('consumes shared files when arriving from a share', fakeAsync(() => {
      const shared = [new File(['x'], 'shared.png', { type: 'image/png' })];
      mockShareIntake.consumeAll.and.resolveTo(shared);
      routeStub.snapshot = { queryParamMap: convertToParamMap({ source: 'share' }) };

      component.ngOnInit();
      tick();

      expect(mockShareIntake.consumeAll).toHaveBeenCalled();
      expect(component.selectedFiles()).toEqual(shared);
    }));

    it('leaves the stash alone on a plain visit', () => {
      expect(mockShareIntake.consumeAll).not.toHaveBeenCalled();
    });
  });

  describe('shared images with a generic mime type', () => {
    // The shape the iOS share pipeline used to deliver: real image bytes,
    // application/octet-stream label. The extension is what says image.
    const octetImage = (name = 'photo.jpg') =>
      new File(['x'], name, { type: 'application/octet-stream' });

    it('treats an octet-stream jpg as an image', () => {
      component.onFilesSelected([octetImage()]);

      expect(component.hasImageFiles()).toBeTrue();
      expect(component.imagePreviewUrls().length).toBe(1);
    });

    it('routes octet-stream images through the multi-image import', async () => {
      component.onFilesSelected([octetImage('a.jpg'), octetImage('b.jpg')]);

      await component.processFiles();

      expect(mockImportService.importFromMultipleImages).toHaveBeenCalled();
      expect(mockImportService.importFromFile).not.toHaveBeenCalled();
    });

    it('reports a receipt import for shared images on success and on failure', async () => {
      component.onFilesSelected([octetImage()]);
      await component.processFiles();

      expect(mockAnalytics.trackReceiptImport).toHaveBeenCalledWith(jasmine.objectContaining({ outcome: 'ok' }));

      mockAnalytics.trackReceiptImport.calls.reset();
      mockImportService.importFromMultipleImages.and.rejectWith(new Error('extraction failed'));
      component.onFilesSelected([octetImage()]);
      await component.processFiles();

      expect(mockAnalytics.trackReceiptImport).toHaveBeenCalledWith(jasmine.objectContaining({ outcome: 'failed' }));
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

  describe('image previews', () => {
    const image = (name: string) => new File([''], name, { type: 'image/jpeg' });

    it('mints a preview only for the image files', () => {
      component.onFilesSelected([image('a.jpg'), new File([''], 'b.csv', { type: 'text/csv' })]);

      expect(component.imagePreviewUrls().map(p => p.name)).toEqual(['a.jpg']);
    });

    it('revokes the previous batch when files are re-picked', () => {
      component.onFilesSelected([image('a.jpg'), image('b.jpg')]);
      const first = component.imagePreviewUrls().map(p => p.url);
      const revoke = spyOn(URL, 'revokeObjectURL');

      component.onFilesSelected([image('c.jpg')]);

      // Without this, re-picking four 4MB photos three times pinned about
      // 50MB for the life of the document.
      expect(revoke.calls.allArgs().flat()).toEqual(first);
      expect(component.imagePreviewUrls().length).toBe(1);
    });

    it('revokes what is on screen when the wizard is destroyed', () => {
      component.onFilesSelected([image('a.jpg')]);
      const shown = component.imagePreviewUrls().map(p => p.url);
      const revoke = spyOn(URL, 'revokeObjectURL');

      component.ngOnDestroy();

      // The URLs the template actually rendered — reading a computed here
      // used to mint a fresh set and revoke those instead.
      expect(revoke.calls.allArgs().flat()).toEqual(shown);
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
    it('should select the duplicates', () => {
      const transactions: CategorizedImportTransaction[] = [
        { ...mockTransactions[0], isDuplicate: true, selected: false },
        { ...mockTransactions[1], isDuplicate: false, selected: true }
      ];
      component.extractedTransactions.set(transactions);

      component.includeAllDuplicates();

      const updated = component.extractedTransactions();
      expect(updated.find(t => t.isDuplicate)?.selected).toBeTrue();
    });

    it('should leave a manually deselected non-duplicate alone', () => {
      // The button says "include duplicates". Selecting everything threw away
      // the user's own decisions about the rest of the list.
      const transactions: CategorizedImportTransaction[] = [
        { ...mockTransactions[0], isDuplicate: true, selected: false },
        { ...mockTransactions[1], isDuplicate: false, selected: false }
      ];
      component.extractedTransactions.set(transactions);

      component.includeAllDuplicates();

      const updated = component.extractedTransactions();
      expect(updated.find(t => t.isDuplicate)?.selected).toBeTrue();
      expect(updated.find(t => !t.isDuplicate)?.selected).toBeFalse();
    });
  });

  describe('batch provenance', () => {
    it('records receipt photos as an image import, sized by the whole batch', async () => {
      const imgA = new File(['aa'], 'a.png', { type: 'image/png' });
      const imgB = new File(['bbb'], 'b.png', { type: 'image/png' });
      component.selectedFiles.set([imgA, imgB]);

      await component.processFiles();
      await component.confirmImport();

      const args = mockImportService.confirmImport.calls.mostRecent().args;
      expect(args[1]).toBe('a.png');
      expect(args[2]).toBe(imgA.size + imgB.size);
      expect(args[3]).toBe('image');
      expect(args[4]).toBe('receipt_image');
    });

    it('records statement photos as a screenshot import', async () => {
      component.imageKind.set('statement');
      component.selectedFiles.set([new File(['x'], 'stmt.png', { type: 'image/png' })]);

      await component.processFiles();
      await component.confirmImport();

      const args = mockImportService.confirmImport.calls.mostRecent().args;
      expect(mockImportService.importFromStatementImages).toHaveBeenCalled();
      expect(args[3]).toBe('image');
      expect(args[4]).toBe('screenshot');
    });

    it('records a PDF as a bank PDF import', async () => {
      mockImportService.importFromFile.and.returnValue(Promise.resolve({
        ...mockImportResult, source: 'pdf' as const, fileType: 'bank_pdf' as const
      }));
      component.selectedFiles.set([new File(['x'], 'statement.pdf', { type: 'application/pdf' })]);

      await component.processFiles();
      await component.confirmImport();

      const args = mockImportService.confirmImport.calls.mostRecent().args;
      expect(args[3]).toBe('pdf');
      expect(args[4]).toBe('bank_pdf');
    });

    it('labels a mixed batch by its dominant kind, counted in rows', async () => {
      // One receipt row against a two-row CSV: the record's own numbers are
      // row-denominated, so the kind label follows the same measure.
      mockImportService.importFromMultipleImages.and.returnValue(Promise.resolve({
        ...mockImportResult, source: 'image' as const, fileType: 'receipt_image' as const,
        transactions: [mockTransactions[0]]
      }));
      const img = new File(['aa'], 'r.png', { type: 'image/png' });
      const csv = new File(['bbbb'], 'rows.csv', { type: 'text/csv' });
      component.selectedFiles.set([img, csv]);

      await component.processFiles();
      await component.confirmImport();

      const args = mockImportService.confirmImport.calls.mostRecent().args;
      expect(args[3]).toBe('csv');
      expect(args[4]).toBe('generic_csv');
      expect(args[2]).toBe(img.size + csv.size);
    });

    it('records a camera batch by what the capture handed over', async () => {
      history.replaceState({
        importResult: {
          ...mockImportResult,
          source: 'image', fileType: 'receipt_image',
          fileName: '3 images', fileSize: 999
        },
        fromCamera: true
      }, '');
      try {
        const cameraFixture = TestBed.createComponent(ImportWizardComponent);
        cameraFixture.detectChanges();
        const cameraComponent = cameraFixture.componentInstance;
        cameraComponent.extractedTransactions.set(mockTransactions);

        await cameraComponent.confirmImport();

        const args = mockImportService.confirmImport.calls.mostRecent().args;
        expect(args[1]).toBe('3 images');
        expect(args[2]).toBe(999);
        expect(args[3]).toBe('image');
        expect(args[4]).toBe('receipt_image');
      } finally {
        history.replaceState({}, '');
      }
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
      expect(notifications.success).toHaveBeenCalledWith('import.importComplete');
    }));

    it('should navigate to transactions page on success', fakeAsync(() => {
      component.confirmImport();
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions'], {
        queryParams: { showAll: 'true' }
      });
    }));

    it('hands the batch\'s image files to the service, and only those', fakeAsync(() => {
      // imageIndex on a row indexes the image subset the extraction ran
      // over, so a mixed batch must pass exactly that subset, in order.
      const csv = new File([''], 'test.csv', { type: 'text/csv' });
      const imgA = new File(['a'], 'a.png', { type: 'image/png' });
      const imgB = new File(['b'], 'b.png', { type: 'image/png' });
      component.selectedFiles.set([imgA, csv, imgB]);
      component.confirmImport();
      tick();

      expect(mockImportService.confirmImport.calls.mostRecent().args[5]).toEqual([imgA, imgB]);
    }));

    it('hands the reviewed rows to confirm, currency edits included', fakeAsync(() => {
      // args[0] was never asserted: the rows the user corrected could have been
      // replaced by the original extraction without any test noticing.
      component.onTransactionsUpdated([{ ...mockTransactions[0], currency: 'JPY', selected: true }]);
      component.confirmImport();
      tick();
      const args = mockImportService.confirmImport.calls.mostRecent().args;
      expect(args[0][0].currency).toBe('JPY');
    }));

    it('hands the camera batch\'s own files to the service', fakeAsync(() => {
      const img = new File(['x'], 'shot.jpg', { type: 'image/jpeg' });
      history.replaceState({
        importResult: { ...mockImportResult, sourceFiles: [img] },
        fromCamera: true
      }, '');
      try {
        const cameraFixture = TestBed.createComponent(ImportWizardComponent);
        cameraFixture.detectChanges();
        const cameraComponent = cameraFixture.componentInstance;
        cameraComponent.extractedTransactions.set(mockTransactions);

        cameraComponent.confirmImport();
        tick();

        // The camera wizard holds no selectedFiles; the photos ride the
        // handed-over result or the receipts save photo-less.
        expect(mockImportService.confirmImport.calls.mostRecent().args[5]).toEqual([img]);
      } finally {
        history.replaceState({}, '');
      }
    }));

    it('says when photos were skipped for the image quota, without failing the import', fakeAsync(() => {
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'image' as const, fileType: 'receipt_image' as const,
        fileName: 'r.png', fileSize: 10, transactionCount: 2, successCount: 2,
        skippedCount: 0, errorCount: 0, totalIncome: 0, totalExpenses: 5,
        duplicatesSkipped: 0, status: 'completed' as const, receiptsSkipped: 2
      }));

      component.confirmImport();
      tick();

      expect(notifications.info).toHaveBeenCalledWith('import.importPhotosSkipped');
      expect(notifications.success).toHaveBeenCalledWith('import.importComplete');
      expect(mockRouter.navigate).toHaveBeenCalled();
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
      expect(notifications.error).toHaveBeenCalledWith('import.importFailed');
    }));

    it('keeps exactly the failed rows on screen after a partial import', fakeAsync(() => {
      const row = (id: string, selected: boolean, isDuplicate = false): CategorizedImportTransaction => ({
        ...mockTransactions[0], id, selected, isDuplicate,
      });
      // An unselected duplicate sits between selected rows: the service
      // numbers its errors against the selected subset only, so mapping
      // row 2 must land on `b`, not on the duplicate.
      component.extractedTransactions.set([
        row('a', true), row('dup', false, true), row('b', true), row('c', true),
      ]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 3, successCount: 2, skippedCount: 1, errorCount: 1,
        totalIncome: 0, totalExpenses: 10, duplicatesSkipped: 1,
        status: 'partial' as const,
        errors: [{ row: 2, message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      // No navigation — leaving would destroy the only copy of the rows.
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      expect(notifications.error).toHaveBeenCalledWith('import.importPartial');
      expect(notifications.success).not.toHaveBeenCalled();
      expect(component.extractedTransactions().map(t => t.id)).toEqual(['b']);
      expect(component.extractedTransactions()[0].selected).toBeTrue();
      expect(component.selectedTransactionIds().has('b')).toBeTrue();
      expect(component.duplicateChecks()).toEqual([]);
      expect(component.isImporting()).toBeFalse();
    }));

    it('treats a failed read-back as saved: info toast, still navigates', fakeAsync(() => {
      // The rows were written; only the summary read failed. An error toast
      // here would invite a retry that duplicates the whole batch.
      mockImportService.confirmImport.and.returnValue(
        Promise.reject(new Error(IMPORT_READBACK_FAILED)));

      component.confirmImport();
      tick();

      expect(notifications.info).toHaveBeenCalledWith('import.importSavedHistoryUnavailable');
      expect(notifications.error).not.toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions'], {
        queryParams: { showAll: 'true' }
      });
      expect(component.isImporting()).toBeFalse();
    }));
  });

  describe('goBack', () => {
    it('should navigate to transactions', () => {
      component.goBack();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/transactions']);
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

  describe('in-batch duplicates', () => {
    it('flags and deselects a row that repeats another in the same import', async () => {
      // Two overlapping files: the same charge arrives twice, and the
      // per-file checks only ever compared against stored history.
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([
        { transactionId: 'txn2', isDuplicate: true, matchType: 'within_batch',
          existingTransactionId: 'txn1', confidence: 0.9 },
      ]);

      component.selectedFiles.set([new File([''], 'a.csv', { type: 'text/csv' })]);
      await component.processFiles();

      const repeated = component.extractedTransactions().find(t => t.id === 'txn2');
      expect(repeated?.isDuplicate).toBeTrue();
      expect(repeated?.selected).toBeFalse();
      expect(component.selectedTransactionIds().has('txn2')).toBeFalse();
    });

    it('leaves the first occurrence selected', async () => {
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([
        { transactionId: 'txn2', isDuplicate: true, matchType: 'within_batch',
          existingTransactionId: 'txn1', confidence: 0.9 },
      ]);

      component.selectedFiles.set([new File([''], 'a.csv', { type: 'text/csv' })]);
      await component.processFiles();

      const first = component.extractedTransactions().find(t => t.id === 'txn1');
      expect(first?.isDuplicate).toBeFalse();
      expect(component.selectedTransactionIds().has('txn1')).toBeTrue();
    });

    it('surfaces the repeat in the duplicate panel so it can be recovered', async () => {
      // Deselected, not dropped: a genuine pair of identical charges on one
      // day exists, and only the user can tell it from an overlap.
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([
        { transactionId: 'txn2', isDuplicate: true, matchType: 'within_batch',
          existingTransactionId: 'txn1', confidence: 0.9 },
      ]);

      component.selectedFiles.set([new File([''], 'a.csv', { type: 'text/csv' })]);
      await component.processFiles();

      expect(component.duplicateInfos().some(i => i.check.matchType === 'within_batch')).toBeTrue();

      component.includeAllDuplicates();
      expect(component.extractedTransactions().find(t => t.id === 'txn2')?.selected).toBeTrue();
    });

    it('runs the pass over every file\'s rows at once', async () => {
      component.selectedFiles.set([
        new File([''], 'a.csv', { type: 'text/csv' }),
        new File([''], 'b.csv', { type: 'text/csv' }),
      ]);
      await component.processFiles();

      // One call, after both files are concatenated — a per-file pass could
      // never see a duplicate that spans them.
      expect(mockDuplicateService.findWithinBatchDuplicates).toHaveBeenCalledTimes(1);
      const rows = mockDuplicateService.findWithinBatchDuplicates.calls.mostRecent().args[0];
      expect(rows.length).toBe(4);
    });
  });
});
