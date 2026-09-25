import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { of, EMPTY } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatStepper } from '@angular/material/stepper';

import { ImportWizardComponent } from './import-wizard.component';
import { AIImportService, AI_QUEUED_OFFLINE, IMPORT_READBACK_FAILED } from '../../../../core/services/ai-import.service';
import { DuplicateDetectionService } from '../../../../core/services/duplicate-detection.service';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { AnnouncerService } from '../../../../core/services/announcer.service';
import { Category, CategorizedImportTransaction, DuplicateCheck, ImportResult, ProcessingStep } from '../../../../models';
import { NotificationService } from '../../../../core/services/notification.service';
import { ShareIntakeService } from '../../../../core/services/share-intake.service';
import { ReceiptAttempt, ReceiptAttemptService } from '../../../../core/services/receipt-attempt.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { AuthService } from '../../../../core/services/auth.service';
import { MockAuthService } from '../../../../core/services/testing';
import { blankImportRow, joinSentences, splitImportRow } from '../../../../core/utils/import-review.utils';
import { AI_QUEUE_WRITE_FAILED, AI_QUEUE_WRITE_PARTIAL } from '../../../../core/utils/ai-error.utils';

function attemptStub() {
  const handle = jasmine.createSpyObj<ReceiptAttempt>('ReceiptAttempt', ['succeeded', 'failed', 'queued']);
  const service = jasmine.createSpyObj<ReceiptAttemptService>('ReceiptAttemptService', ['begin']);
  service.begin.and.returnValue(handle);
  return { service, handle };
}

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
  let attempts: ReturnType<typeof attemptStub>;
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
    mockImportService = jasmine.createSpyObj('AIImportService', ['importFromFile', 'importFromMultipleImages', 'importFromStatementImages', 'confirmImport', 'parseAIError', 'tagVocabulary', 'baseCurrency'], {
      isProcessing: signal(false),
      processingStep: signal(null),
      processingProgress: signal(0),
      processingRow: signal(null)
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
    // Resolved, never bare: the refresh below is a void-ed `.then`, and a bare
    // spy answers undefined, which throws inside a promise nobody is holding.
    mockImportService.tagVocabulary.and.resolveTo([]);
    // Read once, in a field initializer, so it has to answer before the
    // component is constructed rather than at the first template read.
    mockImportService.baseCurrency.and.returnValue('USD');
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
    mockRouter = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    mockDuplicateService = jasmine.createSpyObj('DuplicateDetectionService', [
      'findWithinBatchDuplicates',
      'checkDuplicates',
    ]);
    mockDuplicateService.findWithinBatchDuplicates.and.returnValue([]);
    // Resolved, never bare: a bare spy method answers undefined, which the
    // re-check's try/catch lets through, and the merge behind it would then
    // throw inside a void-ed promise — an unhandled rejection Jasmine pins
    // on whichever spec happens to be running. Empty, it applies to no row
    // and returns before the batch pass, so a case that needs the pass
    // answers one check per row, as the service does.
    mockDuplicateService.checkDuplicates.and.resolveTo([]);

    mockShareIntake = jasmine.createSpyObj('ShareIntakeService', ['consumeAll']);
    mockShareIntake.consumeAll.and.resolveTo([]);
    attempts = attemptStub();
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
        { provide: ReceiptAttemptService, useValue: attempts.service },
        { provide: ActivatedRoute, useValue: routeStub },
        // The real one is root-provided and fetches rates from its
        // constructor. The code-and-figure shape is what the assertions read:
        // the app's own formatter is the thing under test only in that it is
        // asked once per currency.
        { provide: CurrencyService, useValue: { formatCurrency: (a: number, c: string) => `${c} ${a}` } }
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
      expect(component.acceptedFileTypes).toBe('.csv,.pdf,.png,.jpg,.jpeg,.webp,.json');
    });

    it("takes the write's progress from the service's own signals", () => {
      // Identity is all this file can show: its template is the stub above.
      // The confirm step actually rendering these is the emulator case in
      // import-wizard.smoke.spec.ts.
      expect(component.processingRow).toBe(mockImportService.processingRow);
      expect(component.processingProgress).toBe(mockImportService.processingProgress);
    });
  });

  describe('processingStepText', () => {
    // The fake TranslationService echoes the key it was handed, so every
    // reading below is the key the step resolved to and never the sentence:
    // which line each step reads is this file's to pin, the wording is the
    // catalogs'.
    const resolve = (step: ProcessingStep | null): string => {
      mockImportService.processingStep.set(step);
      return component.processingStepText();
    };

    it('says nothing while no door is open', () => {
      expect(resolve(null)).toBe('');
    });

    it('reads each step off the catalogs', () => {
      expect(resolve({ name: 'reading' })).toBe('import.readingFile');
      expect(resolve({ name: 'extracting' })).toBe('import.extractingData');
      expect(resolve({ name: 'categorizing' })).toBe('import.categorizingTransactions');
      expect(resolve({ name: 'duplicates' })).toBe('import.checkingDuplicates');
    });

    it('hands the image counter to its line as parameters', () => {
      expect(resolve({ name: 'readingImage', done: 1, total: 2 })).toBe('import.readingImageOf');
      expect(mockTranslationService.t)
        .toHaveBeenCalledWith('import.readingImageOf', { done: 1, total: 2 });
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

    it('opens one attempt over the shared images and settles it from their own result', async () => {
      component.onFilesSelected([octetImage()]);
      await component.processFiles();

      expect(attempts.service.begin).toHaveBeenCalledTimes(1);
      const [door, kind] = attempts.service.begin.calls.mostRecent().args;
      expect(door).toBe('wizard');
      expect(kind).toBe('receipt_image');
      expect(attempts.handle.succeeded).toHaveBeenCalled();

      attempts.service.begin.calls.reset();
      attempts.handle.succeeded.calls.reset();
      const failure = new Error('extraction failed');
      mockImportService.importFromMultipleImages.and.rejectWith(failure);
      component.onFilesSelected([octetImage()]);
      await component.processFiles();

      expect(attempts.handle.failed).toHaveBeenCalledWith(failure);
      expect(attempts.handle.succeeded).not.toHaveBeenCalled();
    });

    it('reports nothing_extracted from the image result even when a CSV in the batch yielded rows', async () => {
      // The outcome used to be computed from the running row total, so a CSV
      // that parsed made an image that read nothing report ok.
      mockImportService.importFromMultipleImages.and.resolveTo({
        ...mockImportResult, source: 'image', fileType: 'receipt_image', transactions: [],
      });
      component.onFilesSelected([octetImage(), new File(['a,b'], 'rows.csv', { type: 'text/csv' })]);
      await component.processFiles();

      expect(attempts.handle.failed).toHaveBeenCalledWith('nothing_extracted');
      expect(component.extractedTransactions().length).toBe(2);
    });

    it('opens no attempt for statement screenshots', async () => {
      component.imageKind.set('statement');
      component.onFilesSelected([octetImage()]);
      await component.processFiles();

      expect(mockImportService.importFromStatementImages).toHaveBeenCalled();
      expect(attempts.service.begin).not.toHaveBeenCalled();
    });

    it('settles the one handle from the catch path when a later file throws', async () => {
      mockImportService.importFromFile.and.rejectWith(new Error('bad csv'));
      component.onFilesSelected([octetImage(), new File(['a,b'], 'rows.csv', { type: 'text/csv' })]);
      await component.processFiles();

      // One handle; the service's guard makes the second settle a no-op.
      expect(attempts.service.begin).toHaveBeenCalledTimes(1);
      expect(attempts.handle.succeeded).toHaveBeenCalledTimes(1);
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
      component.extractedTransactions.set(mockTransactions);

      expect(component.reviewComplete()).toBeTrue();
    });
  });

  describe('onReviewContinue', () => {
    // #430: a native `disabled` Continue eats the click, so the button stays
    // clickable (disabledInteractive) and every press reaches here. Which of
    // the two things a press can do is all this suite can pin — that
    // `disabledInteractive` itself renders `aria-disabled` and that a held
    // press actually moves focus into the card is the smoke suite's case,
    // the same split `reviewComplete` above draws.
    function stubTable(): jasmine.SpyObj<{ revealFirstBlocking(): boolean }> {
      const table = jasmine.createSpyObj('TransactionPreviewTableComponent', ['revealFirstBlocking']);
      component.table = (() => table) as unknown as typeof component.table;
      return table;
    }

    function stubStepper(): jasmine.SpyObj<{ next(): void }> {
      const stepper = jasmine.createSpyObj('MatStepper', ['next']);
      component.stepper = stepper as unknown as MatStepper;
      return stepper;
    }

    it('reveals instead of advancing on a held review step', () => {
      const table = stubTable();
      const stepper = stubStepper();
      // Nothing selected: reviewComplete() is false.

      component.onReviewContinue();

      expect(table.revealFirstBlocking).toHaveBeenCalled();
      expect(stepper.next).not.toHaveBeenCalled();
    });

    // reviewComplete() reads selectedCount(), which is live off
    // extractedTransactions() — the row set a deselect-all leaves in place.
    // A press here must not advance just because rows exist.
    it('neither advances nor throws when rows exist but none are selected', () => {
      const table = stubTable();
      table.revealFirstBlocking.and.returnValue(false);
      const stepper = stubStepper();
      component.extractedTransactions.set(mockTransactions.map(t => ({ ...t, selected: false })));

      expect(() => component.onReviewContinue()).not.toThrow();

      expect(stepper.next).not.toHaveBeenCalled();
    });

    it('advances on a clear step', () => {
      const table = stubTable();
      const stepper = stubStepper();
      component.extractedTransactions.set(mockTransactions);

      component.onReviewContinue();

      expect(stepper.next).toHaveBeenCalled();
      expect(table.revealFirstBlocking).not.toHaveBeenCalled();
    });
  });

  describe('the date question', () => {
    // Only a receipt reader's rows are asked about their date, and the set
    // is per row: one dropzone pick can put a photo and a CSV in the same
    // batch, and the CSV's historical rows are never a question. Whether
    // Continue and Import actually hold is a DOM matter for the smoke spec;
    // this suite overrides the template with a bare div.
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };
    const png = (name = 'r.png') => new File([''], name, { type: 'image/png' });
    const csv = () => new File(['a,b'], 'rows.csv', { type: 'text/csv' });
    const receiptRows = (): CategorizedImportTransaction[] => [
      { ...mockTransactions[0], id: 'photo1', date: yesterday() },
      { ...mockTransactions[1], id: 'photo2', date: yesterday() },
    ];
    const receiptResult = (): ImportResult => ({
      ...mockImportResult, source: 'image', fileType: 'receipt_image', transactions: receiptRows(),
    });
    const statementResult = (): ImportResult => ({
      ...mockImportResult, source: 'image', fileType: 'screenshot', transactions: receiptRows(),
    });

    it('holds every handed-over row on the camera hand-off', fakeAsync(() => {
      // That door only ever carries receipts.
      history.replaceState({ importResult: receiptResult(), fromCamera: true }, '');
      try {
        const cameraFixture = TestBed.createComponent(ImportWizardComponent);
        cameraFixture.detectChanges();
        // ngAfterViewInit defers the hand-off by a macrotask.
        tick();

        expect(cameraFixture.componentInstance.receiptRowIds()).toEqual(new Set(['photo1', 'photo2']));
      } finally {
        history.replaceState({}, '');
      }
    }));

    it('holds the image batch\'s rows for the receipt kind', async () => {
      mockImportService.importFromMultipleImages.and.resolveTo(receiptResult());
      component.onFilesSelected([png()]);

      await component.processFiles();

      expect(component.receiptRowIds()).toEqual(new Set(['photo1', 'photo2']));
    });

    it('holds nothing for the statement kind, even after a receipt batch ran', async () => {
      // Every row of a statement is dated in the past by nature; asking
      // about each one would train the reviewer to answer without looking.
      // The set is rebuilt per batch, so the receipt batch this re-pick
      // replaces does not leave its ids behind.
      mockImportService.importFromMultipleImages.and.resolveTo(receiptResult());
      mockImportService.importFromStatementImages.and.resolveTo(statementResult());
      component.onFilesSelected([png()]);
      await component.processFiles();
      expect(component.receiptRowIds().size).withContext('the receipt batch first').toBe(2);

      component.imageKind.set('statement');
      component.onFilesSelected([png('stmt.png')]);
      await component.processFiles();

      expect(component.receiptRowIds()).toEqual(new Set());
    });

    it('holds nothing for a CSV', async () => {
      mockImportService.importFromFile.and.resolveTo({ ...mockImportResult, transactions: receiptRows() });
      component.onFilesSelected([csv()]);

      await component.processFiles();

      expect(component.receiptRowIds()).toEqual(new Set());
    });

    it('holds only the photo\'s rows when a receipt photo and a CSV share one batch', async () => {
      mockImportService.importFromMultipleImages.and.resolveTo({
        ...receiptResult(), transactions: [{ ...mockTransactions[0], id: 'photo1', date: yesterday() }],
      });
      mockImportService.importFromFile.and.resolveTo({
        ...mockImportResult, transactions: [{ ...mockTransactions[1], id: 'csv1', date: yesterday() }],
      });
      component.onFilesSelected([png(), csv()]);

      await component.processFiles();

      expect(component.extractedTransactions().map(t => t.id)).toEqual(['photo1', 'csv1']);
      expect(component.receiptRowIds()).toEqual(new Set(['photo1']));
      // The CSV's row is dated yesterday too, and is not asked.
      expect(component.unansweredDates()).toBe(1);
    });

    it('counts only selected, unanswered rows inside the set', () => {
      component.extractedTransactions.set([
        { ...mockTransactions[0], id: 'asked', date: yesterday() },
        { ...mockTransactions[0], id: 'assumed', dateAssumed: true },
        { ...mockTransactions[0], id: 'unselected', date: yesterday(), selected: false },
        { ...mockTransactions[0], id: 'answered', date: yesterday(), dateReviewed: true },
        { ...mockTransactions[0], id: 'today' },
        { ...mockTransactions[0], id: 'outside', date: yesterday() },
      ]);
      component.receiptRowIds.set(new Set(['asked', 'assumed', 'unselected', 'answered', 'today']));

      expect(component.unansweredDates()).toBe(2);
    });

    it('holds the review step until every question is answered', () => {
      const rows = [{ ...mockTransactions[0], id: 'asked', date: yesterday() }];
      component.extractedTransactions.set(rows);
      component.selectedTransactionIds.set(new Set(['asked']));
      component.receiptRowIds.set(new Set(['asked']));

      expect(component.unansweredDates()).toBe(1);
      expect(component.reviewComplete()).toBeFalse();

      // The card answers through the same event every other edit rides.
      component.onTransactionsUpdated(rows.map(t => ({ ...t, dateReviewed: true as const })));

      expect(component.unansweredDates()).toBe(0);
      expect(component.reviewComplete()).toBeTrue();
    });

    it('never gates a statement batch, whatever its rows are dated', async () => {
      mockImportService.importFromStatementImages.and.resolveTo(statementResult());
      component.imageKind.set('statement');
      component.onFilesSelected([png('stmt.png')]);

      await component.processFiles();

      expect(component.selectedCount()).toBe(2);
      expect(component.unansweredDates()).toBe(0);
      expect(component.reviewComplete()).toBeTrue();
    });

    it('keeps the set through a partial import, so a failed receipt row is still asked', fakeAsync(() => {
      // The failed rows keep their ids and come back to the review step;
      // a receipt row among them still owes its answer unless it gave one.
      component.selectedFiles.set([png()]);
      component.extractedTransactions.set([
        { ...mockTransactions[0], id: 'saved', date: yesterday(), dateReviewed: true },
        { ...mockTransactions[0], id: 'failed', date: yesterday(), dateReviewed: true },
        {
          ...mockTransactions[0], id: 'deselected', date: yesterday(), dateReviewed: true,
          selected: false,
        },
      ]);
      component.receiptRowIds.set(new Set(['saved', 'failed', 'deselected']));
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'image' as const, fileType: 'receipt_image' as const,
        fileName: 'r.png', fileSize: 10,
        transactionCount: 2, successCount: 1, skippedCount: 0, errorCount: 1,
        totalIncome: 0, totalExpenses: 5, duplicatesSkipped: 0,
        status: 'partial' as const,
        // row is wrong on purpose: the wizard reads transactionId, not position.
        errors: [{ row: 99, transactionId: 'failed', message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      expect(component.extractedTransactions().map(t => t.id)).toEqual(['failed', 'deselected']);
      // The saved row left the batch and the set with it; the failed row and
      // the deselected one — never submitted — both stay named.
      expect(component.receiptRowIds()).toEqual(new Set(['failed', 'deselected']));
      expect(component.unansweredDates()).withContext('already answered, so not asked again').toBe(0);
      // The set still names the row: stripped of its answer, it is asked again.
      component.onTransactionsUpdated([{ ...mockTransactions[0], id: 'failed', date: yesterday() }]);
      expect(component.unansweredDates()).toBe(1);
    }));
  });

  describe('the rows still to fill in', () => {
    // The twin of the date question: a count over the same rows, holding the
    // same two buttons. Whether Continue and Import actually hold is a DOM
    // matter for the smoke spec; this suite overrides the template away.
    const blank = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
      ...mockTransactions[0], id: 'manual_1', description: '', amount: 0, ...overrides,
    });

    it('counts a selected row with no amount, and one with no description', () => {
      component.extractedTransactions.set([
        blank({ id: 'nothing' }),
        blank({ id: 'no-amount', description: 'Bread' }),
        blank({ id: 'no-description', amount: 4 }),
        blank({ id: 'whitespace', description: '   ', amount: 4 }),
        { ...mockTransactions[0], id: 'filled' },
      ]);

      expect(component.unfilledRows()).toBe(4);
    });

    it('ignores a row the reviewer left out', () => {
      component.extractedTransactions.set([blank({ id: 'left-out', selected: false })]);

      expect(component.unfilledRows()).toBe(0);
    });

    it('holds the review step until the row the reviewer added is filled in', () => {
      component.extractedTransactions.set([blank()]);
      component.selectedTransactionIds.set(new Set(['manual_1']));

      expect(component.unfilledRows()).toBe(1);
      expect(component.reviewComplete()).toBeFalse();

      // The card fills it through the same event every other edit rides.
      component.onTransactionsUpdated([blank({ description: 'Bread', amount: 4 })]);

      expect(component.unfilledRows()).toBe(0);
      expect(component.reviewComplete()).toBeTrue();
    });

    it('reads the base currency once, for the card to denominate a blank row in', () => {
      expect(component.baseCurrency).toBe('USD');
      expect(mockImportService.baseCurrency).toHaveBeenCalledTimes(1);
    });
  });

  describe('selectedCount', () => {
    it('should count selected transactions', () => {
      component.extractedTransactions.set(mockTransactions);

      expect(component.selectedCount()).toBe(2);
    });
  });

  describe('the confirm step\'s totals', () => {
    const row = (overrides: Partial<CategorizedImportTransaction>): CategorizedImportTransaction => ({
      ...mockTransactions[0], ...overrides,
    });

    it('gives one formatted line per currency the batch is in, first-seen order', () => {
      // Added blind these are 183.53 of nothing, and the bare currency pipe
      // printed that as dollars whatever the rows carried.
      //
      // USD first and JPY second: 'JPY' < 'USD', so a fixture that saw JPY
      // first would read the same whether the lines came out in first-seen
      // or alphabetical order. Seeing USD — the code that sorts last — first
      // is what an alphabetical sort would get wrong.
      component.extractedTransactions.set([
        row({ id: 'usd', currency: 'USD', amount: 4.13 }),
        row({ id: 'jpy', currency: 'JPY', amount: 179 }),
        row({ id: 'usd-2', currency: 'USD', amount: 0.4 }),
      ]);

      expect(component.expenseLines()).toEqual(['USD 4.53', 'JPY 179']);
    });

    it('gives one zero line in the base currency for a side nothing is on', () => {
      component.extractedTransactions.set([
        row({ id: 'jpy', currency: 'JPY', amount: 179 }),
        row({ id: 'usd', currency: 'USD', amount: 4.13 }),
      ]);

      // Never empty: the card holds a figure even when the batch is all one
      // way, and the base currency is what an account's own zero is in.
      expect(component.incomeLines()).toEqual(['USD 0']);
    });

    it('counts a row the reviewer left out for nothing', () => {
      component.extractedTransactions.set([
        row({ id: 'jpy', currency: 'JPY', amount: 179 }),
        row({ id: 'left-out', currency: 'USD', amount: 4.13, selected: false }),
      ]);

      expect(component.expenseLines()).toEqual(['JPY 179']);
      expect(component.incomeLines()).toEqual(['USD 0']);
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

    it('resets the receipt-row set with the rows', () => {
      component.receiptRowIds.set(new Set(['txn1']));

      component.onFilesSelected([new File([''], 'a.csv', { type: 'text/csv' })]);

      expect(component.receiptRowIds()).toEqual(new Set());
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

    it('raises the notice when the image batch reports a cut-off answer', fakeAsync(() => {
      mockImportService.importFromMultipleImages.and.returnValue(Promise.resolve({
        ...mockImportResult,
        source: 'image' as const,
        fileType: 'receipt_image' as const,
        warnings: [{ type: 'parse_error' as const, message: 'ran out of room' }],
      }));
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.answerIncomplete()).toBeTrue();
      // The rows that did arrive are still the review step's business.
      expect(component.extractedTransactions().length).toBe(2);
    }));

    it('reports a queued capture as kept rather than as a failure', fakeAsync(() => {
      // The template is the stub, so the state the step branches on is what
      // this reads: the error card and the empty card must both stay down.
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.queuedOfflineCount()).toBe(1);
      expect(component.processingError()).toBeNull();
      expect(component.processingErrorKey()).toBeNull();
    }));

    it('leaves no step looking like the work is still coming after a queued capture', fakeAsync(() => {
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.processingFinishedEmpty()).toBeFalse();
      expect(component.processingComplete()).toBeFalse();
      // Still settled at the one chokepoint that turns the sentinel into a
      // queue outcome rather than a failure class.
      expect(attempts.handle.failed).toHaveBeenCalled();
    }));

    it('takes the queued photos out of the picker so the step cannot store them twice', fakeAsync(() => {
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      const csv = new File([''], 'ledger.csv', { type: 'text/csv' });
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' }), csv]);

      component.processFiles();
      tick();

      expect(component.selectedFiles()).toEqual([csv]);
    }));

    it('still imports the files that needed no reader when the photos are queued', fakeAsync(() => {
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      component.selectedFiles.set([
        new File([''], 'r.png', { type: 'image/png' }),
        new File([''], 'ledger.csv', { type: 'text/csv' })
      ]);

      component.processFiles();
      tick();

      expect(mockImportService.importFromFile).toHaveBeenCalled();
      expect(component.extractedTransactions().length).toBe(mockTransactions.length);
      expect(component.queuedOfflineCount()).toBe(1);
      expect(component.processingError()).toBeNull();
    }));

    it('reports a failure elsewhere in the batch even when the photos were stored', fakeAsync(() => {
      // The template is the stub, so this reads the pair of signals the step
      // branches on: an error beside a queued count is the error card, with
      // the stored photos still named inside it.
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      mockImportService.importFromFile.and.returnValue(Promise.reject(new Error('bad csv')));
      component.selectedFiles.set([
        new File([''], 'r.png', { type: 'image/png' }),
        new File([''], 'ledger.csv', { type: 'text/csv' })
      ]);

      component.processFiles();
      tick();

      expect(component.processingError()).toBe('bad csv');
      expect(component.queuedOfflineCount()).toBe(1);
      expect(component.processingComplete()).toBeFalse();
    }));

    it('takes the photos out of the picker when only part of the capture was stored', fakeAsync(() => {
      // What the real parser answers for this sentinel: the pages already
      // written cannot be stored a second time, so the class is not retryable.
      mockImportService.parseAIError.and.returnValue({
        message: 'Only part of the capture could be stored for later.',
        messageKey: 'import.errorQueueWritePartial',
        type: 'unknown',
        retryable: false
      });
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUE_WRITE_PARTIAL))
      );
      const csv = new File([''], 'ledger.csv', { type: 'text/csv' });
      component.onFilesSelected([new File([''], 'r.png', { type: 'image/png' }), csv]);

      component.processFiles();
      tick();

      expect(component.selectedFiles()).toEqual([csv]);
      expect(component.imagePreviewUrls()).toEqual([]);
      // Not the dialog's wording: that one asks for the retry this card
      // must not offer.
      expect(component.processingErrorKey()).toBe('import.errorQueueWritePartial');
      expect(component.processingErrorRetryable()).toBeFalse();
      expect(component.queuedOfflineCount()).toBe(0);
    }));

    it('leaves the photos selected when the queue kept none of them', fakeAsync(() => {
      // Nothing is stored, so a second Process cannot duplicate anything —
      // and stripping the picker here would be the only copy of the capture
      // going out of reach.
      mockImportService.parseAIError.and.returnValue({
        message: 'The capture could not be stored for later.',
        messageKey: 'import.errorQueueWrite',
        type: 'unknown',
        retryable: false
      });
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUE_WRITE_FAILED))
      );
      const photo = new File([''], 'r.png', { type: 'image/png' });
      component.onFilesSelected([photo]);

      component.processFiles();
      tick();

      expect(component.selectedFiles()).toEqual([photo]);
      expect(component.processingErrorKey()).toBe('import.errorQueueWrite');
      expect(component.queuedOfflineCount()).toBe(0);
    }));

    it('drops the queued notice when the next batch is processed', fakeAsync(() => {
      component.queuedOfflineCount.set(1);
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.queuedOfflineCount()).toBe(0);
    }));

    it('leaves the notice down for an ordinary import', fakeAsync(() => {
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.answerIncomplete()).toBeFalse();
    }));

    it('clears a raised notice when the next batch is processed', fakeAsync(() => {
      component.answerIncomplete.set(true);
      component.selectedFiles.set([new File([''], 'r.png', { type: 'image/png' })]);

      component.processFiles();
      tick();

      expect(component.answerIncomplete()).toBeFalse();
    }));
  });

  describe('the tag vocabulary', () => {
    it('fills from the service once a batch\'s rows land', fakeAsync(() => {
      // Asked with the rows, not before them: the batch's own tags are part
      // of the vocabulary the card offers.
      mockImportService.tagVocabulary.and.resolveTo(['coffee', 'work']);
      component.selectedFiles.set([new File([''], 'test.csv', { type: 'text/csv' })]);

      component.processFiles();
      tick();

      expect(mockImportService.tagVocabulary).toHaveBeenCalledWith(component.extractedTransactions());
      expect(component.tagVocabulary()).toEqual(['coffee', 'work']);
    }));

    it('fills on the camera hand-off too', fakeAsync(() => {
      // The hand-off skips processFiles entirely, so its rows would arrive at
      // the card with nothing to suggest.
      mockImportService.tagVocabulary.and.resolveTo(['coffee']);
      history.replaceState({ importResult: mockImportResult, fromCamera: true }, '');
      try {
        const cameraFixture = TestBed.createComponent(ImportWizardComponent);
        cameraFixture.detectChanges();
        tick();

        expect(cameraFixture.componentInstance.tagVocabulary()).toEqual(['coffee']);
      } finally {
        history.replaceState({}, '');
      }
    }));
  });

  describe('the cut-off answer notice', () => {
    // Whether the strip actually renders is pinned in
    // import-wizard.smoke.spec.ts: this suite overrides the template with a
    // bare div, so nothing here can see the review step at all.

    it('titles the error card for an answer nobody could read', () => {
      component.processingErrorType.set('incomplete');

      expect(component.getErrorIcon()).toBe('content_cut');
      // The stub echoes the key, so this is the key the card would render.
      expect(component.getErrorTitle()).toBe('import.errorTitleIncomplete');
    });
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

    it('records the door the state named, not always the camera', async () => {
      // The transaction form's own multi-receipt review also arrives via
      // fromCamera — it reuses the same "already extracted" skip — so the
      // door has to be read from the state, not assumed (#151).
      history.replaceState({
        importResult: {
          ...mockImportResult,
          source: 'image', fileType: 'receipt_image',
          diagnostics: { engine: 'cloud', provider: 'gemini', durationMs: 500 },
        },
        fromCamera: true,
        door: 'form',
      }, '');
      try {
        const formFixture = TestBed.createComponent(ImportWizardComponent);
        formFixture.detectChanges();
        const formComponent = formFixture.componentInstance;
        formComponent.extractedTransactions.set(mockTransactions);

        await formComponent.confirmImport();

        expect(mockImportService.confirmImport.calls.mostRecent().args[6]).toEqual({
          door: 'form', engine: 'cloud', provider: 'gemini', durationMs: 500,
        });
      } finally {
        history.replaceState({}, '');
      }
    });

    it('defaults an unlabelled camera-style state to the camera door', async () => {
      history.replaceState({
        importResult: {
          ...mockImportResult,
          source: 'image', fileType: 'receipt_image',
          diagnostics: { engine: 'cloud', provider: 'gemini', durationMs: 500 },
        },
        fromCamera: true,
      }, '');
      try {
        const cameraFixture = TestBed.createComponent(ImportWizardComponent);
        cameraFixture.detectChanges();
        const cameraComponent = cameraFixture.componentInstance;
        cameraComponent.extractedTransactions.set(mockTransactions);

        await cameraComponent.confirmImport();

        expect(mockImportService.confirmImport.calls.mostRecent().args[6]?.door).toBe('camera');
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
      expect(notifications.success).toHaveBeenCalledWith('import.importComplete', { durationMs: 3000 });
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

    it('raises a success notice, up for the default time, when every row saved and no photo went missing', fakeAsync(() => {
      component.confirmImport();
      tick();

      expect(notifications.success).toHaveBeenCalledOnceWith('import.importComplete', { durationMs: 3000 });
      expect(notifications.info).not.toHaveBeenCalled();
      expect(notifications.error).not.toHaveBeenCalled();
    }));

    it('says when photos were skipped for the image quota, in the round\'s one notice, info-toned', fakeAsync(() => {
      // One notice per round: a snackbar replaces the one before it, so a
      // photo notice of its own ahead of the round's notice would not stay on
      // screen long enough to read. Every row saved, but a photo that did not
      // come with it is something to act on, so the notice is not a success.
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'image' as const, fileType: 'receipt_image' as const,
        fileName: 'r.png', fileSize: 10, transactionCount: 2, successCount: 2,
        skippedCount: 0, errorCount: 0, totalIncome: 0, totalExpenses: 5,
        duplicatesSkipped: 0, status: 'completed' as const, receiptsSkipped: 2
      }));

      component.confirmImport();
      tick();

      expect(notifications.info).toHaveBeenCalledOnceWith(
        joinSentences('import.importComplete', 'import.importPhotosSkipped'),
        { durationMs: 5000 }
      );
      expect(mockTranslationService.t).toHaveBeenCalledWith('import.importPhotosSkipped', { count: 2 });
      expect(notifications.success).not.toHaveBeenCalled();
      expect(notifications.error).not.toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalled();
    }));

    it('says when photos could not be uploaded, info-toned, without calling the import partial', fakeAsync(() => {
      // The rows landed; only their photos did not. Calling this partial would
      // invite re-importing transactions that already saved (#334), and
      // calling it a success would leave the photo unattended.
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'image' as const, fileType: 'receipt_image' as const,
        fileName: 'r.png', fileSize: 10, transactionCount: 1, successCount: 1,
        skippedCount: 0, errorCount: 0, totalIncome: 0, totalExpenses: 10503,
        duplicatesSkipped: 0, status: 'completed' as const, receiptsFailed: 1
      }));

      component.confirmImport();
      tick();

      expect(notifications.info).toHaveBeenCalledOnceWith(
        joinSentences('import.importComplete', 'import.importPhotosFailed'),
        { durationMs: 5000 }
      );
      expect(mockTranslationService.t).toHaveBeenCalledWith('import.importPhotosFailed', { count: 1 });
      expect(mockTranslationService.t).not.toHaveBeenCalledWith('import.importPhotosSkipped', jasmine.anything());
      expect(notifications.success).not.toHaveBeenCalled();
      expect(notifications.error).not.toHaveBeenCalled();
    }));

    // The photo-failure sentence is two sentences in en and in ja, where no
    // space follows the full stop, and each is read before the notice goes.
    for (const [locale, photosFailed] of [
      ['en', 'The transactions were saved, but 1 receipt photo could not be uploaded. You can attach it from the transaction.'],
      ['ja', '取引は保存されましたが、レシート写真1枚をアップロードできませんでした。取引の画面から添付し直せます。'],
    ] as const) {
      it(`gives the notice time for every sentence a part carries, not one a part (${locale})`, fakeAsync(() => {
        mockTranslationService.t.and.callFake((key: string) =>
          key === 'import.importPhotosFailed' ? photosFailed : key
        );
        mockImportService.confirmImport.and.returnValue(Promise.resolve({
          id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
          source: 'image' as const, fileType: 'receipt_image' as const,
          fileName: 'r.png', fileSize: 10, transactionCount: 1, successCount: 1,
          skippedCount: 0, errorCount: 0, totalIncome: 0, totalExpenses: 10503,
          duplicatesSkipped: 0, status: 'completed' as const, receiptsFailed: 1
        }));

        component.confirmImport();
        tick();

        // Three sentences: the info tone's three seconds and two more for each
        // sentence past the first.
        expect(notifications.info).toHaveBeenCalledOnceWith(
          joinSentences('import.importComplete', photosFailed),
          { durationMs: 7000 }
        );
      }));
    }

    it('carries the set-aside and photo sentences in the partial import\'s one error notice', fakeAsync(() => {
      // The rows that did save can still have lost their photos. Raised as
      // notices of their own, the photo sentences and the partial count would
      // replace one another on screen, leaving only the last to read.
      component.extractedTransactions.set([
        { ...mockTransactions[0], id: 'a' },
        { ...mockTransactions[0], id: 'b' },
        { ...mockTransactions[0], id: 'c', importAttempts: 1 },
      ]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'image' as const, fileType: 'receipt_image' as const,
        fileName: 'r.png', fileSize: 10, transactionCount: 2, successCount: 2,
        skippedCount: 0, errorCount: 1, totalIncome: 0, totalExpenses: 5,
        duplicatesSkipped: 0, status: 'partial' as const, receiptsSkipped: 1, receiptsFailed: 1,
        errors: [{ row: 3, transactionId: 'c', message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      // Four sentences: the error's own five seconds and two more for each
      // sentence past the first, so the last is still on screen to be read.
      expect(notifications.error).toHaveBeenCalledOnceWith(
        joinSentences(
          joinSentences(joinSentences('import.importPartial', 'import.importPartialSetAside'), 'import.importPhotosSkipped'),
          'import.importPhotosFailed'
        ),
        { durationMs: 11000 }
      );
      expect(notifications.info).not.toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
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

    it('keeps the failed rows selected and the deselected ones as they were after a partial import', fakeAsync(() => {
      const row = (id: string, selected: boolean, isDuplicate = false): CategorizedImportTransaction => ({
        ...mockTransactions[0], id, selected, isDuplicate,
      });
      // An unselected duplicate still sits between selected rows, but the
      // match is now by id: row is planted wrong (99) to prove the wizard
      // isn't reading position — only transactionId 'b' can land it on `b`.
      component.extractedTransactions.set([
        row('a', true), row('dup', false, true), row('b', true), row('c', true),
      ]);
      component.duplicateChecks.set([
        { transactionId: 'dup', isDuplicate: true, matchType: 'exact', existingTransactionId: 'stored-1', confidence: 1 },
      ]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 3, successCount: 2, skippedCount: 1, errorCount: 1,
        totalIncome: 0, totalExpenses: 10, duplicatesSkipped: 1,
        status: 'partial' as const,
        errors: [{ row: 99, transactionId: 'b', message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      // No navigation — leaving would destroy the only copy of the rows.
      expect(mockRouter.navigate).not.toHaveBeenCalled();
      // Nothing was set aside on a first failure, so the count stands alone.
      expect(notifications.error).toHaveBeenCalledOnceWith('import.importPartial', { durationMs: 5000 });
      expect(notifications.success).not.toHaveBeenCalled();
      expect(component.extractedTransactions().map(t => t.id)).toEqual(['dup', 'b']);
      expect(component.extractedTransactions()[0].selected).toBeFalse();
      expect(component.extractedTransactions()[0].isDuplicate).toBeTrue();
      expect(component.extractedTransactions()[1].selected).toBeTrue();
      expect(component.extractedTransactions()[1].isDuplicate).toBeFalse();
      expect(component.selectedTransactionIds()).toEqual(new Set(['b']));
      expect(component.duplicateChecks()).toEqual([
        { transactionId: 'dup', isDuplicate: true, matchType: 'exact', existingTransactionId: 'stored-1', confidence: 1 },
      ]);
      expect(component.isImporting()).toBeFalse();
    }));

    it('keeps a row the reviewer deselected, still deselected and out of the selected set', fakeAsync(() => {
      const row = (id: string, selected: boolean, isDuplicate = false): CategorizedImportTransaction => ({
        ...mockTransactions[0], id, selected, isDuplicate,
      });
      component.extractedTransactions.set([row('a', true), row('keep', false), row('b', true)]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 3, successCount: 2, skippedCount: 0, errorCount: 1,
        totalIncome: 0, totalExpenses: 10, duplicatesSkipped: 0,
        status: 'partial' as const,
        errors: [{ row: 1, transactionId: 'b', message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      expect(component.extractedTransactions().map(t => [t.id, t.selected])).toEqual([
        ['keep', false], ['b', true],
      ]);
      expect(component.selectedTransactionIds()).toEqual(new Set(['b']));
    }));

    it('a re-offered row carries its reason', fakeAsync(() => {
      component.extractedTransactions.set([{ ...mockTransactions[0], id: 'a' }]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 1, successCount: 0, skippedCount: 0, errorCount: 1,
        totalIncome: 0, totalExpenses: 0, duplicatesSkipped: 0,
        status: 'partial' as const,
        errors: [{ row: 1, transactionId: 'a', message: 'INVALID_TRANSACTION_AMOUNT', originalValue: 'Coffee' }],
      }));

      component.confirmImport();
      tick();

      const row = component.extractedTransactions().find(t => t.id === 'a')!;
      expect(row.importFailure).toBe('import.rowFailedAmount');
      expect(row.importAttempts).toBe(1);
      // One failure re-offers the row; it stops short of setting it aside,
      // so the round's notice is its count alone.
      expect(row.selected).toBeTrue();
      expect(notifications.error).toHaveBeenCalledOnceWith('import.importPartial', { durationMs: 5000 });
      expect(mockTranslationService.t)
        .not.toHaveBeenCalledWith('import.importPartialSetAside', jasmine.anything());
    }));

    it('a row that fails twice comes back deselected and is counted in the notice', fakeAsync(() => {
      component.extractedTransactions.set([{ ...mockTransactions[0], id: 'a', description: 'Coffee' }]);
      const refusal = {
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 1, successCount: 0, skippedCount: 0, errorCount: 1,
        totalIncome: 0, totalExpenses: 0, duplicatesSkipped: 0,
        status: 'partial' as const,
        // A rules denial the way it actually reaches this app: a stable
        // code, separate from prose meant for a console.
        errors: [{
          row: 1, transactionId: 'a',
          code: 'permission-denied', message: 'Missing or insufficient permissions.',
          originalValue: 'Coffee',
        }],
      };

      mockImportService.confirmImport.and.returnValue(Promise.resolve(refusal));
      component.confirmImport();
      tick();

      expect(component.extractedTransactions()[0].importAttempts).toBe(1);
      expect(component.extractedTransactions()[0].selected).toBeTrue();

      // Same id, refused a second time — the wizard reads the row's own
      // running count, not the response, so a fresh confirmImport stub with
      // the same shape is enough to drive the second failure.
      notifications.error.calls.reset();
      mockImportService.confirmImport.and.returnValue(Promise.resolve(refusal));
      component.confirmImport();
      tick();

      const row = component.extractedTransactions()[0];
      expect(row.selected)
        .withContext('re-offering the same refusal forever is a loop with no way out')
        .toBeFalse();
      expect(row.importAttempts).toBe(2);
      expect(row.importFailure).toBe('import.rowFailedConnection');
      // One notice for the whole round, carrying the round's count and how
      // many rows it set aside — not the row's own description, which its
      // card already shows. A second notice would replace the first on
      // screen, and the count with it.
      expect(notifications.error).toHaveBeenCalledOnceWith(
        joinSentences('import.importPartial', 'import.importPartialSetAside'),
        { durationMs: 7000 }
      );
      expect(mockTranslationService.t)
        .toHaveBeenCalledWith('import.importPartialSetAside', { count: 1 });
    }));

    it('counts every set-aside row in one notice, not one per row', fakeAsync(() => {
      // NotificationService shows a single snackbar at a time — a notice per
      // row would leave only the last one on screen with two rows set aside
      // in the same round.
      component.extractedTransactions.set([
        { ...mockTransactions[0], id: 'a', description: 'Coffee', importAttempts: 1 },
        { ...mockTransactions[0], id: 'b', description: 'Lunch', importAttempts: 1 },
      ]);
      mockImportService.confirmImport.and.returnValue(Promise.resolve({
        id: 'history1', userId: 'user1', importedAt: { seconds: 0 } as never,
        source: 'csv' as const, fileType: 'generic_csv' as const,
        fileName: 'test.csv', fileSize: 1024,
        transactionCount: 2, successCount: 0, skippedCount: 0, errorCount: 2,
        totalIncome: 0, totalExpenses: 0, duplicatesSkipped: 0,
        status: 'partial' as const,
        errors: [
          { row: 1, transactionId: 'a', code: 'permission-denied', message: 'Missing or insufficient permissions.', originalValue: 'Coffee' },
          { row: 2, transactionId: 'b', code: 'unavailable', message: 'The service is currently unavailable.', originalValue: 'Lunch' },
        ],
      }));

      component.confirmImport();
      tick();

      expect(component.extractedTransactions().every(t => !t.selected)).toBeTrue();
      expect(notifications.error).toHaveBeenCalledOnceWith(
        joinSentences('import.importPartial', 'import.importPartialSetAside'),
        { durationMs: 7000 }
      );
      expect(mockTranslationService.t)
        .toHaveBeenCalledWith('import.importPartialSetAside', { count: 2 });
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

    it('passes the image batch provenance to the confirm step', async () => {
      const diagnostics = { engine: 'cloud' as const, provider: 'gemini' as const, durationMs: 2000 };
      mockImportService.importFromMultipleImages.and.resolveTo({
        ...mockImportResult, source: 'image', fileType: 'receipt_image', diagnostics,
      });
      component.onFilesSelected([new File(['x'], 'r.jpg', { type: 'image/jpeg' })]);
      await component.processFiles();
      await component.confirmImport();

      expect(mockImportService.confirmImport.calls.mostRecent().args[6]).toEqual({
        door: 'wizard', engine: 'cloud', provider: 'gemini', durationMs: 2000,
      });
    });

    it('passes no provenance for a CSV-only batch', async () => {
      component.onFilesSelected([new File(['a,b'], 'rows.csv', { type: 'text/csv' })]);
      await component.processFiles();
      await component.confirmImport();

      expect(mockImportService.confirmImport.calls.mostRecent().args[6]).toBeUndefined();
    });
  });

  describe('the return to review after a partial import', () => {
    // The template is blanked here, so there is no real stepper and no
    // header to click; that the header itself refuses the move is the
    // smoke suite's case. What is testable here is the ordering the seal
    // forces: every step carries [editable]="!isImporting()", and the CDK's
    // selectedIndex setter takes a backward move only onto an editable step
    // (stepper.mjs: `index >= this.selectedIndex || steps[index].editable`).
    // The unlock is a binding, so it reaches the step at the next render and
    // a set in the same task would be dropped, stranding the failed rows.
    function stubStepper(at: number): { selectedIndex: number } {
      const stepper = { selectedIndex: at };
      component.stepper = stepper as unknown as MatStepper;
      return stepper;
    }

    it('unlocks the steps before it moves back onto Review', () => {
      const stepper = stubStepper(3);
      component.isImporting.set(true);

      component['returnToReview']();

      // Synchronously, not after an await: an await would let the
      // scheduler's own tick run the render hook first and the assertion
      // would pass whatever the order.
      expect(component.isImporting()).toBeFalse();
      expect(stepper.selectedIndex).toBe(3);

      fixture.detectChanges();

      expect(stepper.selectedIndex).toBe(2);
    });

    it('leaves the stepper alone once the wizard is destroyed', () => {
      const stepper = stubStepper(3);
      component.isImporting.set(true);
      fixture.destroy();

      // Registering a render hook on a destroyed injector throws NG0911,
      // and by this point the partial-import toast is already out: the
      // throw would surface as an unhandled error and nothing else.
      expect(() => component['returnToReview']()).not.toThrow();
      expect(stepper.selectedIndex).toBe(3);
    });
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

  describe('mergedItemsCount', () => {
    it('counts one merged item after a merged row is split in two', () => {
      const merged: CategorizedImportTransaction = {
        ...mockTransactions[0],
        imageMetadata: {
          imageIndex: 0, imageId: 'image_0', positionInImage: 'middle', confidenceScore: 0.9,
          receiptId: 1, wasMerged: true, mergedFromImages: [0, 1],
        },
      };
      const [kept, part] = splitImportRow(merged, 2, 'split_1')!;

      // The split part is a fraction of the receipt read once, not a second
      // deduplicated item — only the remainder still carries the mark.
      component.extractedTransactions.set([kept, part]);

      expect(component.mergedItemsCount()).toBe(1);
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

  describe('re-checking a corrected row', () => {
    // Detection ran inside the import doors, before the review step could
    // change anything it read. A row whose date, amount, type or description
    // the reviewer changed is checked again; a verdict the reviewer overruled
    // stays overruled until that row itself changes. The in-flight cases
    // resolve the checks by hand, out of order, because that is the only
    // way a per-row stamp can be told from a single token for the call.
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };
    const fresh = (): CategorizedImportTransaction[] => mockTransactions.map(t => ({ ...t }));
    const stored = (transactionId: string, isDuplicate: boolean): DuplicateCheck =>
      isDuplicate
        ? { transactionId, isDuplicate: true, matchType: 'exact', existingTransactionId: 'stored-1', confidence: 1 }
        : { transactionId, isDuplicate: false, matchType: 'none', confidence: 0 };
    const twin = (transactionId: string, of: string): DuplicateCheck =>
      ({ transactionId, isDuplicate: true, matchType: 'within_batch', existingTransactionId: of, confidence: 0.9 });
    const populate = (rows: CategorizedImportTransaction[], checks: DuplicateCheck[] = []) => {
      component.extractedTransactions.set(rows);
      component.duplicateChecks.set(checks);
      component.selectedTransactionIds.set(new Set(rows.filter(t => t.selected).map(t => t.id)));
    };
    // What the card emits: every row again, the edited one by a new identity.
    const edit = (id: string, changes: Partial<CategorizedImportTransaction>): CategorizedImportTransaction[] => {
      const next = component.extractedTransactions().map(t => (t.id === id ? { ...t, ...changes } : t));
      component.onTransactionsUpdated(next);
      return next;
    };
    const row = (id: string) => component.extractedTransactions().find(t => t.id === id)!;
    const checkedIds = (call: number) =>
      mockDuplicateService.checkDuplicates.calls.argsFor(call)[0].map(t => t.id);
    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('does not check a first population', fakeAsync(() => {
      component.onTransactionsUpdated(fresh());
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).not.toHaveBeenCalled();
      expect(mockDuplicateService.findWithinBatchDuplicates).not.toHaveBeenCalled();
    }));

    it('checks a filled row that appears beside the rows already here', fakeAsync(() => {
      // A split part is born already filled and under a new id, so the plain
      // "ids present before and after" reading would never check it — the
      // very re-check the split exists to trigger.
      populate(fresh());
      const part: CategorizedImportTransaction = {
        id: 'txn3', description: 'Part', amount: 3, currency: 'USD', date: new Date(),
        type: 'expense', suggestedCategoryId: 'food', categoryConfidence: 0,
        isDuplicate: false, selected: true,
      };

      component.onTransactionsUpdated([...component.extractedTransactions(), part]);
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn3']);
    }));

    it('does not check a blank row that appears', fakeAsync(() => {
      // 0103's rule: a hand-added row is unchecked until its first edit.
      populate(fresh());
      const blank = blankImportRow('txn3', row('txn2'), 'USD');

      component.onTransactionsUpdated([...component.extractedTransactions(), blank]);
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).not.toHaveBeenCalled();
    }));

    it('reads an Invalid Date as unchanged, so a currency edit elsewhere checks nothing', fakeAsync(() => {
      // A JSON-door row can carry an Invalid Date; NaN !== NaN would make
      // it "changed" on every emission.
      const rows = fresh();
      rows[0] = { ...rows[0], date: new Date('not a date') };
      populate(rows);

      edit('txn2', { currency: 'JPY' });
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).not.toHaveBeenCalled();
    }));

    it('checks exactly the changed row when its date changes', fakeAsync(() => {
      populate(fresh());
      const day = yesterday();

      edit('txn1', { date: day });
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn1']);
      expect(mockDuplicateService.checkDuplicates.calls.argsFor(0)[0][0].date)
        .withContext('the row as it is now, not as it was')
        .toBe(day);
    }));

    it('checks the row when its amount, type or description changes', fakeAsync(() => {
      populate(fresh());
      const edits: Partial<CategorizedImportTransaction>[] = [
        { amount: 6 }, { type: 'income' }, { description: 'Tea' },
      ];

      for (const changes of edits) {
        mockDuplicateService.checkDuplicates.calls.reset();
        edit('txn1', changes);
        flushMicrotasks();
        expect(mockDuplicateService.checkDuplicates).withContext(JSON.stringify(changes)).toHaveBeenCalledTimes(1);
        expect(checkedIds(0)).withContext(JSON.stringify(changes)).toEqual(['txn1']);
      }
    }));

    it('checks nothing for a currency, notes, category, date answer or selection change', fakeAsync(() => {
      populate(fresh());
      const edits: Partial<CategorizedImportTransaction>[] = [
        { currency: 'JPY' }, { notes: 'lunch' }, { suggestedCategoryId: 'salary' },
        { dateReviewed: true }, { selected: false },
      ];

      for (const changes of edits) {
        edit('txn1', changes);
        flushMicrotasks();
        expect(mockDuplicateService.checkDuplicates).withContext(JSON.stringify(changes)).not.toHaveBeenCalled();
      }
    }));

    it('flags and deselects a row whose fresh verdict is duplicate, and shows it in the panel', fakeAsync(() => {
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', true)]);

      const emitted = edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeTrue();
      expect(row('txn1').duplicateOf).toBe('stored-1');
      expect(row('txn1').selected).toBeFalse();
      expect(component.selectedTransactionIds().has('txn1')).toBeFalse();
      expect(component.selectedTransactionIds().has('txn2')).toBeTrue();
      expect(row('txn2')).withContext('the other row is not touched').toBe(emitted[1]);
      expect(component.duplicateInfos().map(i => [i.transaction.id, i.check.matchType])).toEqual([['txn1', 'exact']]);
      expect(component.duplicatesSkipped()).toBe(1);
    }));

    it('clears the flag and re-selects a row whose fresh verdict is none', fakeAsync(() => {
      const rows = fresh();
      rows[0] = { ...rows[0], isDuplicate: true, duplicateOf: 'stored-1', selected: false };
      populate(rows, [stored('txn1', true)]);
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);

      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeFalse();
      expect(row('txn1').duplicateOf).toBeUndefined();
      expect(row('txn1').selected).toBeTrue();
      expect(component.selectedTransactionIds().has('txn1')).toBeTrue();
      expect(component.duplicateInfos()).toEqual([]);
      expect(component.duplicateChecks().find(c => c.transactionId === 'txn1')?.isDuplicate).toBeFalse();
    }));

    it('leaves a manual deselection alone when the verdict is unchanged', fakeAsync(() => {
      const rows = fresh();
      rows[0] = { ...rows[0], selected: false };
      populate(rows);
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);

      const emitted = edit('txn1', { amount: 6 });
      flushMicrotasks();

      expect(row('txn1')).withContext('the row itself, not a rewrite of it').toBe(emitted[0]);
      expect(row('txn1').selected).toBeFalse();
      expect(component.selectedTransactionIds().has('txn1')).toBeFalse();
    }));

    it('leaves an included duplicate alone when the verdict is unchanged', fakeAsync(() => {
      // Included through the panel, then edited: still a duplicate, still
      // the reviewer's call to import it.
      const rows = fresh();
      rows[0] = { ...rows[0], isDuplicate: true, duplicateOf: 'stored-1', selected: true };
      populate(rows, [stored('txn1', true)]);
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', true)]);

      const emitted = edit('txn1', { description: 'Coffee beans' });
      flushMicrotasks();

      expect(row('txn1')).toBe(emitted[0]);
      expect(row('txn1').selected).toBeTrue();
      expect(component.selectedTransactionIds().has('txn1')).toBeTrue();
    }));

    it('shows the second verdict when two edits of the same row resolve out of order', fakeAsync(() => {
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValues(first.promise, second.promise);

      edit('txn1', { date: yesterday() });
      edit('txn1', { amount: 7 });
      second.resolve([stored('txn1', false)]);
      flushMicrotasks();
      expect(row('txn1').isDuplicate).toBeFalse();

      // The stale answer would flag and deselect a row the fresh check cleared.
      first.resolve([stored('txn1', true)]);
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeFalse();
      expect(row('txn1').selected).toBeTrue();
      expect(component.selectedTransactionIds().has('txn1')).toBeTrue();
    }));

    it('keeps both verdicts when edits of different rows resolve out of order', fakeAsync(() => {
      // One token for the whole call would discard txn1's answer the moment
      // txn2 was edited before it came back.
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValues(first.promise, second.promise);

      edit('txn1', { date: yesterday() });
      edit('txn2', { date: yesterday() });
      second.resolve([stored('txn2', true)]);
      flushMicrotasks();
      expect(row('txn2').isDuplicate).toBeTrue();

      first.resolve([stored('txn1', true)]);
      flushMicrotasks();

      expect(row('txn1').isDuplicate).withContext('the earlier answer still applies to its own row').toBeTrue();
      expect(row('txn1').selected).toBeFalse();
      expect(row('txn2').isDuplicate).withContext('the later answer survives the earlier one').toBeTrue();
      expect(component.selectedTransactionIds()).toEqual(new Set());
    }));

    it('counts a re-check as in flight until its answer lands, however it lands', fakeAsync(() => {
      // Import waits on this count: confirmImport snapshots the rows the
      // moment it is pressed, and an edit followed straight by Import would
      // ship a row whose fresh verdict had not arrived.
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValue(first.promise);
      expect(component.rechecksInFlight()).toBe(0);

      edit('txn1', { date: yesterday() });
      expect(component.rechecksInFlight()).toBe(1);
      flushMicrotasks();
      expect(component.rechecksInFlight()).withContext('still waiting on the read').toBe(1);

      first.resolve([stored('txn1', false)]);
      flushMicrotasks();
      expect(component.rechecksInFlight()).toBe(0);

      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValue(second.promise);
      edit('txn1', { amount: 6 });
      expect(component.rechecksInFlight()).toBe(1);

      second.reject(new Error('offline'));
      flushMicrotasks();
      expect(component.rechecksInFlight()).withContext('a failed read is not in flight either').toBe(0);
    }));

    it('never counts below zero when a stale answer is discarded', fakeAsync(() => {
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValues(first.promise, second.promise);

      edit('txn1', { date: yesterday() });
      edit('txn1', { amount: 7 });
      expect(component.rechecksInFlight()).toBe(2);

      second.resolve([stored('txn1', false)]);
      flushMicrotasks();
      expect(component.rechecksInFlight()).toBe(1);

      first.resolve([stored('txn1', true)]);
      flushMicrotasks();
      expect(component.rechecksInFlight()).toBe(0);
    }));

    it('keeps the standing verdict, and says so, when the check rejects or answers with no array', fakeAsync(() => {
      // Offline, a rules refusal, a bare stub: the last honest answer
      // stands, and the reviewer is told once per failed answer — a verdict
      // they believe was refreshed is the one they would import on, and the
      // overrule on the badge is theirs if they know better.
      const rows = fresh();
      rows[0] = { ...rows[0], isDuplicate: true, duplicateOf: 'stored-1', selected: false };
      const checks = [stored('txn1', true)];
      populate(rows, checks);

      mockDuplicateService.checkDuplicates.and.rejectWith(new Error('offline'));
      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeTrue();
      expect(row('txn1').selected).toBeFalse();
      expect(component.duplicateChecks()).toBe(checks);
      expect(notifications.info).toHaveBeenCalledTimes(1);
      expect(notifications.info).toHaveBeenCalledWith('import.recheckFailed');

      mockDuplicateService.checkDuplicates.and.resolveTo(undefined as unknown as DuplicateCheck[]);
      edit('txn1', { amount: 6 });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeTrue();
      expect(row('txn1').selected).toBeFalse();
      expect(component.duplicateChecks()).toBe(checks);
      expect(mockDuplicateService.findWithinBatchDuplicates).not.toHaveBeenCalled();
      expect(notifications.info).toHaveBeenCalledTimes(2);
      expect(notifications.info.calls.mostRecent().args).toEqual(['import.recheckFailed']);
      expect(notifications.error).not.toHaveBeenCalled();
    }));

    it('says nothing for a failed answer a later edit of the same row superseded', fakeAsync(() => {
      // The call that superseded it answers for the row; a notice here would
      // report an outage the reviewer never felt.
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValues(first.promise, second.promise);

      edit('txn1', { date: yesterday() });
      edit('txn1', { amount: 7 });
      second.resolve([stored('txn1', true)]);
      flushMicrotasks();
      first.reject(new Error('offline'));
      flushMicrotasks();

      expect(notifications.info).not.toHaveBeenCalled();
      expect(row('txn1').isDuplicate).withContext('the answer that stands is the later call\'s').toBeTrue();
    }));

    it('flags a within-batch twin a date edit creates, and leaves the earlier row alone', fakeAsync(() => {
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn2', false)]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([twin('txn2', 'txn1')]);

      const emitted = edit('txn2', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn2').isDuplicate).toBeTrue();
      expect(row('txn2').duplicateOf)
        .withContext('a batch row id is not a document; processFiles leaves it unset too')
        .toBeUndefined();
      expect(row('txn2').selected).toBeFalse();
      expect(row('txn1')).toBe(emitted[0]);
      expect(component.selectedTransactionIds()).toEqual(new Set(['txn1']));
      // The pass runs over the rows as they are now.
      const args = mockDuplicateService.findWithinBatchDuplicates.calls.mostRecent().args;
      expect(args[0]).withContext('the rows as emitted, which the handler stores as they are').toBe(emitted);
      expect(args[0].map(t => t.id)).toEqual(['txn1', 'txn2']);
      expect(component.duplicateInfos().map(i => i.check.matchType)).toEqual(['within_batch']);
    }));

    it('drops a within-batch verdict that dissolves when the other row is edited', fakeAsync(() => {
      // What processFiles leaves behind: a stored verdict per row, then the
      // twin's own. The pass regenerates those from the rows alone, so the
      // standing twin entry has to go before it runs — kept, it would still
      // say duplicate for a row the pass no longer flags, and by id it wins.
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, selected: false };
      populate(rows, [stored('txn1', false), stored('txn2', false), twin('txn2', 'txn1')]);
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([]);

      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn2').isDuplicate).toBeFalse();
      expect(row('txn2').duplicateOf).toBeUndefined();
      expect(row('txn2').selected).toBeTrue();
      expect(component.selectedTransactionIds().has('txn2')).toBeTrue();
      expect(component.duplicateChecks().some(c => c.matchType === 'within_batch')).toBeFalse();
      const args = mockDuplicateService.findWithinBatchDuplicates.calls.mostRecent().args;
      expect(args[1]?.some(c => c.matchType === 'within_batch'))
        .withContext('the pass is handed the stored verdicts only')
        .toBeFalse();
      expect(component.duplicateInfos()).toEqual([]);
    }));

    it('keeps an overruled within-batch row clear when a different row is edited', fakeAsync(() => {
      // The batch pass regenerates its verdicts from the rows alone, so
      // without the overrule set it would re-flag the twin on every edit.
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, selected: false };
      populate(rows, [twin('txn2', 'txn1')]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([twin('txn2', 'txn1')]);
      expect(component.duplicateInfos().length).toBe(1);
      expect(component.duplicatesSkipped()).toBe(1);

      // What clearDuplicate on the card emits.
      edit('txn2', { isDuplicate: false, duplicateOf: undefined, selected: true });
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).withContext('an overrule is not an edit').not.toHaveBeenCalled();
      expect(component.duplicateInfos()).toEqual([]);
      expect(component.duplicatesSkipped()).toBe(0);
      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2'))
        .toEqual({ transactionId: 'txn2', isDuplicate: false, matchType: 'none', confidence: 0 });

      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);
      edit('txn1', { description: 'Espresso' });
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn1']);
      expect(row('txn2').isDuplicate).toBeFalse();
      expect(row('txn2').selected).toBeTrue();
      expect(component.duplicateChecks().some(c => c.matchType === 'within_batch')).toBeFalse();
      expect(component.duplicateInfos()).toEqual([]);
    }));

    it('re-checks an overruled row when it is edited itself', fakeAsync(() => {
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, selected: false };
      populate(rows, [twin('txn2', 'txn1')]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([twin('txn2', 'txn1')]);
      edit('txn2', { isDuplicate: false, duplicateOf: undefined, selected: true });
      flushMicrotasks();

      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn2', false)]);
      edit('txn2', { amount: 3001 });
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn2']);
      // Its own edit reopened the question, and the pass still says twin.
      expect(row('txn2').isDuplicate).toBeTrue();
      expect(row('txn2').selected).toBeFalse();
      expect(component.duplicateInfos().map(i => i.transaction.id)).toEqual(['txn2']);
    }));

    it('takes an overrule off the panel and the skipped count', fakeAsync(() => {
      const rows = fresh();
      rows[0] = { ...rows[0], isDuplicate: true, duplicateOf: 'stored-1', selected: false };
      populate(rows, [stored('txn1', true)]);
      expect(component.duplicateInfos().length).toBe(1);
      expect(component.duplicatesSkipped()).toBe(1);

      edit('txn1', { isDuplicate: false, duplicateOf: undefined, selected: true });
      flushMicrotasks();

      expect(component.duplicateInfos()).toEqual([]);
      expect(component.duplicatesSkipped()).toBe(0);
      expect(mockDuplicateService.checkDuplicates).not.toHaveBeenCalled();
    }));

    it('hands the reconciled rows to confirmImport', fakeAsync(() => {
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', true)]);
      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      component.confirmImport();
      tick();

      const submitted = mockImportService.confirmImport.calls.mostRecent().args[0];
      expect(submitted.find(t => t.id === 'txn1')?.isDuplicate).toBeTrue();
      expect(submitted.find(t => t.id === 'txn1')?.selected).toBeFalse();
      expect(submitted.find(t => t.id === 'txn2')?.selected).toBeTrue();
    }));

    it('leaves a re-pick\'s checks alone when an earlier re-check answers late', fakeAsync(() => {
      // processFiles resets the rows and appends each batch's checks to the
      // last's; the overrule set and the stamps have to go with the rows, or
      // an answer for a row that is gone lands on the batch that replaced it.
      populate(fresh(), [stored('txn1', false), stored('txn2', false)]);
      const late = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValue(late.promise);
      edit('txn1', { date: yesterday() });

      mockImportService.importFromFile.and.resolveTo({
        ...mockImportResult, duplicates: [stored('txn1', false), stored('txn2', false)],
      });
      component.selectedFiles.set([new File([''], 'again.csv', { type: 'text/csv' })]);
      component.processFiles();
      tick();
      const checks = component.duplicateChecks();
      const rows = component.extractedTransactions();
      expect(checks.length).withContext('the new batch\'s checks, not piled on the old').toBe(2);

      late.resolve([stored('txn1', true)]);
      flushMicrotasks();

      expect(component.duplicateChecks()).toBe(checks);
      expect(component.extractedTransactions()).toBe(rows);
      expect(row('txn1').isDuplicate).toBeFalse();
      expect(component.selectedTransactionIds().has('txn1')).toBeTrue();
      expect(notifications.info).not.toHaveBeenCalled();
    }));

    it('forgets an overrule with the batch it belonged to', fakeAsync(() => {
      // The re-pick's own twin verdict stands: nobody overruled it in this
      // batch, and a set kept from the last would clear it on the first edit.
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, selected: false };
      populate(rows, [twin('txn2', 'txn1')]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([twin('txn2', 'txn1')]);
      edit('txn2', { isDuplicate: false, duplicateOf: undefined, selected: true });
      flushMicrotasks();

      component.selectedFiles.set([new File([''], 'again.csv', { type: 'text/csv' })]);
      component.processFiles();
      tick();
      expect(row('txn2').isDuplicate).withContext('flagged afresh by the batch pass').toBeTrue();

      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);
      edit('txn1', { description: 'Espresso' });
      flushMicrotasks();

      expect(row('txn2').isDuplicate).toBeTrue();
      expect(row('txn2').selected).toBeFalse();
      expect(component.duplicateChecks().some(c => c.matchType === 'within_batch')).toBeTrue();
    }));

    it('rewrites nothing for an answer every later edit superseded', fakeAsync(() => {
      // Applied to no row, it has nothing to say: the call that superseded
      // it ran the batch pass over the rows it answered for.
      populate(fresh());
      const first = deferred<DuplicateCheck[]>();
      const second = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValues(first.promise, second.promise);

      edit('txn1', { date: yesterday() });
      edit('txn1', { amount: 7 });
      second.resolve([stored('txn1', false)]);
      flushMicrotasks();
      const checks = component.duplicateChecks();
      const rows = component.extractedTransactions();
      expect(mockDuplicateService.findWithinBatchDuplicates).toHaveBeenCalledTimes(1);

      first.resolve([stored('txn1', true)]);
      flushMicrotasks();

      expect(component.duplicateChecks()).toBe(checks);
      expect(component.extractedTransactions()).toBe(rows);
      expect(mockDuplicateService.findWithinBatchDuplicates).toHaveBeenCalledTimes(1);
    }));

    it('forgets the verdict and the overrule of a row that left the batch', fakeAsync(() => {
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, duplicateOf: 'stored-1', selected: false };
      populate(rows, [stored('txn2', true)]);

      // What clearDuplicate on the card emits — the overrule this test then
      // has to see survive txn2's own departure.
      edit('txn2', { isDuplicate: false, duplicateOf: undefined, selected: true });
      flushMicrotasks();
      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2'))
        .withContext('the overrule\'s own rewrite')
        .toEqual({ transactionId: 'txn2', isDuplicate: false, matchType: 'none', confidence: 0 });

      // A merge (or any other edit) that drops txn2 from the batch.
      component.receiptRowIds.set(new Set(['txn1', 'txn2']));
      component.onTransactionsUpdated(component.extractedTransactions().filter(t => t.id !== 'txn2'));
      flushMicrotasks();

      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2'))
        .withContext('no verdict left to keep for a row that left the batch')
        .toBeUndefined();
      expect(component.receiptRowIds())
        .withContext('the departed row\'s id leaves the set too')
        .toEqual(new Set(['txn1']));

      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);
      edit('txn1', { description: 'Espresso' });
      flushMicrotasks();

      expect(checkedIds(0)).withContext('the gone row is not re-checked').toEqual(['txn1']);
      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2'))
        .withContext('the storedOnly fold does not carry it back in')
        .toBeUndefined();
    }));

    it('leaves the set alone when no receipt row left', fakeAsync(() => {
      const rows = fresh();
      populate(rows);
      component.receiptRowIds.set(new Set(['txn1', 'txn2']));
      const before = component.receiptRowIds();

      // Same rows back — an edit that removes nothing.
      component.onTransactionsUpdated(component.extractedTransactions());
      flushMicrotasks();

      expect(component.receiptRowIds()).toBe(before);
    }));

    it('re-checks a within-batch twin when its partner leaves, and drops its stale verdict', fakeAsync(() => {
      // findWithinBatchDuplicates flags the LATER row and keeps the earlier
      // one, so txn2's standing check names txn1 as the twin it repeats.
      const rows = fresh();
      rows[1] = { ...rows[1], isDuplicate: true, selected: false };
      populate(rows, [twin('txn2', 'txn1')]);
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn2', false)]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([]);

      // txn1 (the earlier twin) leaves the batch — a plain removal, not an
      // edit to txn2, so `changed` alone would never catch it.
      component.onTransactionsUpdated(component.extractedTransactions().filter(t => t.id !== 'txn1'));
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).withContext('the survivor is re-checked').toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn2']);
      expect(row('txn2').isDuplicate).withContext('nothing left to repeat').toBeFalse();
      expect(row('txn2').selected).toBeTrue();
      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2'))
        .withContext('the stale within_batch verdict does not stand')
        .toEqual({ transactionId: 'txn2', isDuplicate: false, matchType: 'none', confidence: 0 });
    }));

    it('re-checks the row a merge changed and nothing else', fakeAsync(() => {
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn2', false)]);

      // What the card emits for a merge: the target's id survives with a new
      // amount, and the source's id (txn1) is simply gone from the array.
      const merged = { ...row('txn2'), amount: row('txn1').amount + row('txn2').amount };
      component.onTransactionsUpdated([merged]);
      flushMicrotasks();

      expect(mockDuplicateService.checkDuplicates).toHaveBeenCalledTimes(1);
      expect(checkedIds(0)).toEqual(['txn2']);
    }));

    it('drops a re-check reply for a row that left the batch while it was in flight', fakeAsync(() => {
      // The stamp pruned out from under the read is what makes the reply
      // not standing; left in place, the gone id's verdict would ride the
      // storedOnly fold on every later re-check, with nothing on screen to
      // say so — duplicateInfos hides a check whose row is missing.
      populate(fresh());
      const pending = deferred<DuplicateCheck[]>();
      mockDuplicateService.checkDuplicates.and.returnValue(pending.promise);
      edit('txn2', { amount: 99 });
      component.onTransactionsUpdated(component.extractedTransactions().filter(t => t.id !== 'txn2'));
      pending.resolve([stored('txn2', true)]);
      flushMicrotasks();

      expect(component.duplicateChecks().find(c => c.transactionId === 'txn2')).toBeUndefined();
      expect(component.rechecksInFlight()).toBe(0);
    }));

    it('announces how many verdicts a re-check flips', fakeAsync(() => {
      // txn1's own edit flips it, and the within-batch pass — run over every
      // row, not only the edited one — flips txn2 in the same cycle: a
      // reviewer watching only txn1 would otherwise never learn txn2 moved.
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', true)]);
      mockDuplicateService.findWithinBatchDuplicates.and.returnValue([
        { transactionId: 'txn2', isDuplicate: true, matchType: 'within_batch', existingTransactionId: 'txn1', confidence: 0.9 },
      ]);

      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeTrue();
      expect(row('txn2').isDuplicate).toBeTrue();
      expect(mockAnnouncer.announce).toHaveBeenCalledOnceWith('import.announceVerdictsChanged');
      expect(mockTranslationService.t).toHaveBeenCalledWith('import.announceVerdictsChanged', { count: 2 });
    }));

    it('says nothing when a re-check flips no verdict', fakeAsync(() => {
      populate(fresh());
      mockDuplicateService.checkDuplicates.and.resolveTo([stored('txn1', false)]);

      edit('txn1', { date: yesterday() });
      flushMicrotasks();

      expect(row('txn1').isDuplicate).toBeFalse();
      expect(mockAnnouncer.announce).not.toHaveBeenCalled();
    }));
  });

  // Every case above blanks the template, so none of them can see which card
  // the processing step chose. The order of those branches is the whole of
  // what a batch that queued a photo and then failed on a later file gets
  // wrong, so one case renders the real thing.
  describe('the processing step as the user sees it', () => {
    let realFixture: ComponentFixture<ImportWizardComponent>;

    beforeEach(async () => {
      TestBed.resetTestingModule();
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
          { provide: ReceiptAttemptService, useValue: attempts.service },
          { provide: ActivatedRoute, useValue: routeStub },
          // Wider than the stub above: the review card builds its whole
          // currency picker in a field initializer, so the narrow shape the
          // blanked-template cases use throws before the step can render.
          {
            provide: CurrencyService,
            useValue: {
              formatCurrency: (a: number, c: string) => `${c} ${a}`,
              getSupportedCurrencies: () => [{ code: 'USD', nameKey: 'currencies.usd', symbol: '$' }],
              getCurrencyInfo: (code: string) => ({ code, nameKey: `currencies.${code.toLowerCase()}`, symbol: code }),
              getExchangeRate: () => 1,
              ensureRatesLoaded: () => Promise.resolve()
            }
          },
          // The real template builds every step, including the review card,
          // whose currency memory reaches AuthService and from there the
          // Firebase Auth token the unit run has no provider for.
          { provide: AuthService, useValue: new MockAuthService() }
        ],
        schemas: [NO_ERRORS_SCHEMA]
      }).compileComponents();

      realFixture = TestBed.createComponent(ImportWizardComponent);
      realFixture.detectChanges();
    });

    it('puts a same-batch failure on the error card, with the stored photos named in it', fakeAsync(() => {
      mockImportService.importFromMultipleImages.and.returnValue(
        Promise.reject(new Error(AI_QUEUED_OFFLINE))
      );
      mockImportService.importFromFile.and.returnValue(Promise.reject(new Error('bad csv')));
      const real = realFixture.componentInstance;
      real.onFilesSelected([
        new File([''], 'r.png', { type: 'image/png' }),
        new File([''], 'ledger.csv', { type: 'text/csv' })
      ]);
      realFixture.detectChanges();

      real.processFiles();
      real.stepper.next();
      tick();
      realFixture.detectChanges();

      const card: HTMLElement | null = realFixture.nativeElement.querySelector('.error-card');
      expect(card).withContext('the error card, not the queued one').not.toBeNull();
      expect(card!.querySelector('.error-title')).not.toBeNull();
      expect(card!.textContent).toContain('import.queuedForLater');
      // The queued card's own way out, which would end the batch as if
      // nothing had failed.
      expect(realFixture.nativeElement.textContent).not.toContain('common.done');
    }));

    it('names the file that failed on the card that offers the rows that landed', fakeAsync(() => {
      // Rows from one file and a throw from the next: the success card wins
      // the branch, because those rows are real and still importable, so it
      // is the only place the failure can be said at all.
      mockImportService.importFromFile.and.returnValues(
        Promise.resolve(mockImportResult),
        Promise.reject(new Error('bad csv'))
      );
      const real = realFixture.componentInstance;
      real.onFilesSelected([
        new File([''], 'january.csv', { type: 'text/csv' }),
        new File([''], 'february.csv', { type: 'text/csv' })
      ]);
      realFixture.detectChanges();

      real.processFiles();
      real.stepper.next();
      tick();
      realFixture.detectChanges();

      const card: HTMLElement | null = realFixture.nativeElement.querySelector('.success-card');
      expect(card).withContext('the rows are offered').not.toBeNull();
      expect(card!.textContent).toContain('bad csv');
    }));
  });
});
