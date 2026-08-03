import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionFormComponent } from './transaction-form.component';
import { TransactionService, RECEIPT_IMAGE_LIMIT_ERROR, RECEIPT_ATTACH_FAILED } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { ReceiptToNoteService } from '../../../core/services/receipt-to-note.service';
import { ReceiptLimitDialogComponent } from '../receipt-images/receipt-limit-dialog.component';
import { CameraCaptureComponent } from '../camera-capture/camera-capture.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AIImportService } from '../../../core/services/ai-import.service';
import { Router } from '@angular/router';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AIStrategyService, ProcessingResult, ProcessedTransaction } from '../../../core/services/ai-strategy.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { Transaction, Category, User } from '../../../models';
import { createTransaction, createCategory, createUser } from '../../../core/services/testing';
import { NotificationService } from '../../../core/services/notification.service';

describe('TransactionFormComponent', () => {
  let transactionService: jasmine.SpyObj<TransactionService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let categoryService: {
    categories: ReturnType<typeof signal<Category[]>>;
    expenseCategories: ReturnType<typeof signal<Category[]>>;
    incomeCategories: ReturnType<typeof signal<Category[]>>;
    loadCategories: jasmine.Spy;
  };
  let strategy: jasmine.SpyObj<AIStrategyService>;
  let aiImport: jasmine.SpyObj<AIImportService>;
  let router: jasmine.SpyObj<Router>;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<TransactionFormComponent>>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let receiptQuota: jasmine.SpyObj<ReceiptQuotaService>;
  let receiptToNote: jasmine.SpyObj<ReceiptToNoteService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  /** One receipt photo, as the strategy service hands it back. */
  function scanResult(
    row: Partial<ProcessedTransaction> = {},
    result: Partial<ProcessingResult> = {},
  ): ProcessingResult {
    return {
      transactions: [{
        date: new Date(2026, 0, 1),
        description: 'Cafe',
        amount: 12,
        type: 'expense',
        currency: 'USD',
        confidence: 0.9,
        source: 'cloud',
        suggestedCategoryId: 'food',
        ...row,
      }],
      source: 'cloud',
      confidence: 0.9,
      processingTimeMs: 1,
      ...result,
    };
  }

  const receiptFile = () => new File(['x'], 'r.jpg', { type: 'image/jpeg' });

  const expense = createCategory({ id: 'food', type: 'expense' });
  const income = createCategory({ id: 'salary', type: 'income' });

  function build(data: { mode: 'add' | 'edit'; transaction?: Transaction } = { mode: 'add' }) {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    const fixture = TestBed.createComponent(TransactionFormComponent);
    fixture.componentInstance.ngOnInit();
    return fixture;
  }

  beforeEach(async () => {
    transactionService = jasmine.createSpyObj('TransactionService', [
      'addTransaction', 'updateTransaction', 'removeReceiptAt', 'removeAllReceipts', 'getTransactionDatesForMonth',
    ]);
    transactionService.addTransaction.and.resolveTo('new-id');
    transactionService.updateTransaction.and.resolveTo(undefined);
    transactionService.removeReceiptAt.and.resolveTo(undefined);
    transactionService.removeAllReceipts.and.resolveTo(undefined);
    transactionService.getTransactionDatesForMonth.and.returnValue(of(new Map()));

    categoryService = {
      categories: signal<Category[]>([expense, income]),
      expenseCategories: signal<Category[]>([expense]),
      incomeCategories: signal<Category[]>([income]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };
    strategy = jasmine.createSpyObj('AIStrategyService', [
      'hasAnyEngine', 'canProcessNow', 'canUseCloud', 'processReceipt', 'suggestCategory',
    ]);
    aiImport = jasmine.createSpyObj('AIImportService', ['importFromMultipleImages']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    strategy.hasAnyEngine.and.returnValue(true);
    strategy.canProcessNow.and.returnValue(true);
    strategy.canUseCloud.and.returnValue(true);
    strategy.processReceipt.and.resolveTo(scanResult());
    strategy.suggestCategory.and.resolveTo('food');
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'afterClosed']);
    dialogRef.afterClosed.and.returnValue(of(undefined) as never);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    receiptQuota = jasmine.createSpyObj('ReceiptQuotaService', ['canAddImages']);
    receiptQuota.canAddImages.and.resolveTo(true);
    receiptToNote = jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackTransactionAdd', 'trackAiAssistUsed']);
    currentUser = signal<User | null>(createUser());

    const currency = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies', 'getCurrencyInfo']);
    currency.getSupportedCurrencies.and.returnValue([{ code: 'USD', name: 'US Dollar', symbol: '$' }]);
    currency.getCurrencyInfo.and.callFake((code: string) => ({ code, nameKey: code, symbol: code }));
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    await TestBed.configureTestingModule({
      imports: [TransactionFormComponent, ReactiveFormsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser } },
        { provide: TranslationService, useValue: translation },
        { provide: AIStrategyService, useValue: strategy },
        { provide: AIImportService, useValue: aiImport },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: dialog },
        { provide: ReceiptQuotaService, useValue: receiptQuota },
        { provide: ReceiptToNoteService, useValue: receiptToNote },
        { provide: AnalyticsService, useValue: analytics },
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'add' } },
      ],
    })
      .overrideComponent(TransactionFormComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  it('initialises an empty form in add mode', () => {
    const component = build().componentInstance;
    expect(component.form.get('type')?.value).toBe('expense');
    expect(component.form.get('currency')?.value).toBe('USD');
    expect(component.form.valid).toBeFalse();
  });

  it('loads categories when none are cached', () => {
    categoryService.categories.set([]);
    build();
    expect(categoryService.loadCategories).toHaveBeenCalled();
  });

  it('populates the form in edit mode', () => {
    const txn = createTransaction({
      type: 'income', amount: 200, categoryId: 'salary', description: 'Pay',
      date: Timestamp.fromDate(new Date(2026, 0, 2)),
    });
    const component = build({ mode: 'edit', transaction: txn }).componentInstance;
    expect(component.form.get('amount')?.value).toBe(200);
    expect(component.transactionType()).toBe('income');
  });

  describe('computed categories', () => {
    it('filteredCategories switches with the type', () => {
      const component = build().componentInstance;
      expect(component.filteredCategories()).toEqual([expense]);
      component.form.get('type')?.setValue('income');
      expect(component.filteredCategories()).toEqual([income]);
    });

    it('selectedCategory resolves the chosen id', () => {
      const component = build().componentInstance;
      expect(component.selectedCategory()).toBeNull();
      component.form.get('categoryId')?.setValue('food');
      expect(component.selectedCategory()).toEqual(expense);
    });

    it('resets an incompatible category when the type changes', () => {
      const component = build().componentInstance;
      component.form.patchValue({ categoryId: 'food' });
      component.form.get('type')?.setValue('income');
      expect(component.form.get('categoryId')?.value).toBe('');
    });
  });

  describe('onSubmit', () => {
    function validForm(component: TransactionFormComponent) {
      component.form.patchValue({
        type: 'expense', amount: '15.5', currency: 'USD', categoryId: 'food',
        description: 'Lunch', date: new Date(2026, 0, 1), note: 'tasty', period: 'monthly',
      });
    }

    it('does nothing when the form is invalid', async () => {
      const component = build().componentInstance;
      await component.onSubmit();
      expect(transactionService.addTransaction).not.toHaveBeenCalled();
    });

    it('adds a transaction and closes the dialog', async () => {
      const component = build().componentInstance;
      validForm(component);
      await component.onSubmit();
      expect(transactionService.addTransaction).toHaveBeenCalled();
      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.amount).toBe(15.5);
      expect(dto.note).toBe('tasty');
      expect(dto.period).toBe('monthly');
      // No tags typed and add mode: the field is omitted entirely.
      expect(dto.tags).toBeUndefined();
      expect(dialogRef.close).toHaveBeenCalledWith(true);
      expect(analytics.trackTransactionAdd).toHaveBeenCalledWith({
        method: 'manual',
        type: 'expense',
        has_tags: false,
        has_location: false,
        receipt_image_count: 0,
      });
    });

    it('reports a generic save failure instead of swallowing it', async () => {
      // Anything outside the two receipt-specific cases used to fall through
      // a bare comment: dialog open, spinner stopped, no message, no log.
      transactionService.addTransaction.and.rejectWith(new Error('permission-denied'));
      spyOn(console, 'error');
      const component = build().componentInstance;
      validForm(component);

      await component.onSubmit();

      expect(notifications.error).toHaveBeenCalledWith('common.error');
      expect(console.error).toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(component.isSubmitting()).toBeFalse();
    });

    it('reports tag, location and image usage on the add event', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.tags.set(['groceries']);
      component.form.patchValue({ locationName: 'Aoyama Market' });
      component.pendingReceipts.set([
        { file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }), preview: 'data:image/jpeg;base64,a' },
        { file: new File(['b'], 'b.jpg', { type: 'image/jpeg' }), preview: 'data:image/jpeg;base64,b' },
      ]);

      await component.onSubmit();

      expect(analytics.trackTransactionAdd).toHaveBeenCalledWith({
        method: 'manual',
        type: 'expense',
        has_tags: true,
        has_location: true,
        receipt_image_count: 2,
      });
    });

    it('does not report transaction_add when editing', async () => {
      const txn = createTransaction({ id: 'e1' });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);

      await component.onSubmit();

      expect(analytics.trackTransactionAdd).not.toHaveBeenCalled();
    });

    it('sends the period key when editing clears it, so the stored one is removed', async () => {
      const txn = createTransaction({ id: 'e1', period: 'monthly' });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      component.form.patchValue({ period: null });

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      // Present-and-undefined, not absent: the service reads the key to tell
      // "cleared" from "not part of this update".
      expect('period' in dto).toBeTrue();
      expect(dto.period).toBeUndefined();
    });

    it('forwards the captured receipt file in the DTO', async () => {
      const component = build().componentInstance;
      validForm(component);
      const receipt = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
      component.pendingReceipts.set([{ file: receipt, preview: 'data:image/jpeg;base64,x' }]);
      await component.onSubmit();
      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.receiptFiles).toEqual([receipt]);
    });

    it('omits receiptFiles when none was captured', async () => {
      const component = build().componentInstance;
      validForm(component);
      await component.onSubmit();
      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.receiptFiles).toBeUndefined();
    });

    it('sends a newly attached receipt when editing', async () => {
      // updateTransaction has always accepted a receipt file; only the UI
      // withheld the scanner in edit mode, so it could never be set.
      const txn = createTransaction({ id: 'e1' });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      const file = new File([''], 'receipt.jpg', { type: 'image/jpeg' });
      component.pendingReceipts.set([{ file, preview: 'data:image/jpeg;base64,x' }]);

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      expect(dto.receiptFiles).toEqual([file]);
    });

    it('appends a queued receipt alongside a stored one when editing', async () => {
      // Since images became a list, a queued image adds to the strip rather
      // than replacing the stored one; replacing is remove-then-attach.
      const stored = createTransaction({ id: 'e2', receiptUrl: 'https://example.test/old.jpg' });
      const component = build({ mode: 'edit', transaction: stored }).componentInstance;
      validForm(component);
      const file = new File([''], 'new-receipt.jpg', { type: 'image/jpeg' });
      component.pendingReceipts.set([{ file, preview: 'data:image/jpeg;base64,x' }]);

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      expect(dto.receiptFiles).toEqual([file]);
      // The stored image stays visible next to the queued one.
      expect(component.storedReceipts()).toEqual([
        { url: 'https://example.test/old.jpg', slot: 0 },
      ]);
    });

    it('queues several files and submits them in pick order', async () => {
      const component = build().componentInstance;
      validForm(component);
      const files = [0, 1, 2].map(
        i => new File([`r${i}`], `r${i}.jpg`, { type: 'image/jpeg' })
      );

      await component.onReceiptSelected({ target: { files, value: '' } } as unknown as Event);
      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.receiptFiles?.length).toBe(3);
      expect(dto.receiptFiles?.map(f => f.name)).toEqual(['r0.jpg', 'r1.jpg', 'r2.jpg']);
    });

    it('reports a rolled-back batch without closing the dialog', async () => {
      transactionService.addTransaction.and.rejectWith(new Error(RECEIPT_ATTACH_FAILED));
      const component = build().componentInstance;
      validForm(component);

      await component.onSubmit();

      expect(notifications.error).toHaveBeenCalledWith('receiptImages.attachFailed');
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('carries the typed tags in the DTO', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.tags.set(['groceries', 'reimbursable']);
      await component.onSubmit();
      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.tags).toEqual(['groceries', 'reimbursable']);
    });

    it('sends an emptied tag list in edit mode so stored tags clear', async () => {
      const txn = createTransaction({ id: 'e1', tags: ['old'] });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      component.tags.set([]);

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      // Omitting the field would leave the stored tags in place.
      expect(dto.tags).toEqual([]);
    });

    it('writes a name-only location without coordinates', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.form.patchValue({ locationName: '  Aoyama Market ' });

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: 'Aoyama Market' });
    });

    it('attaches captured coordinates and the country they fall in', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.form.patchValue({ locationName: 'Aoyama Market' });
      component.locationCoords.set({ lat: 35.66, lng: 139.71 });

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({
        name: 'Aoyama Market', lat: 35.66, lng: 139.71, country: 'JP',
      });
    });

    it('omits the country when the coordinates cannot be placed', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.form.patchValue({ locationName: 'Somewhere at sea' });
      component.locationCoords.set({ lat: 0, lng: -140 });

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: 'Somewhere at sea', lat: 0, lng: -140 });
    });

    it('omits the location entirely when the name is blank', async () => {
      const component = build().componentInstance;
      validForm(component);
      // Coordinates without a name are meaningless to render; they hang off
      // the name.
      component.locationCoords.set({ lat: 35.66, lng: 139.71 });

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect('location' in dto).toBeFalse();
    });

    it('clears a stored location when the name is emptied in edit mode', async () => {
      const txn = createTransaction({
        id: 'e1',
        location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 },
      });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      component.form.patchValue({ locationName: '' });

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      // Key present, value undefined: the service reads that as "clear".
      expect('location' in dto).toBeTrue();
      expect(dto.location).toBeUndefined();
    });

    it('updates an existing transaction in edit mode', async () => {
      const txn = createTransaction({ id: 'e1' });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      await component.onSubmit();
      expect(transactionService.updateTransaction).toHaveBeenCalledWith('e1', jasmine.any(Object));
    });

    it('swallows save errors', async () => {
      transactionService.addTransaction.and.rejectWith(new Error('fail'));
      const component = build().componentInstance;
      validForm(component);
      await component.onSubmit();
      expect(component.isSubmitting()).toBeFalse();
    });

    it('opens the quota dialog when saving rejects with the image limit error', async () => {
      transactionService.addTransaction.and.rejectWith(new Error(RECEIPT_IMAGE_LIMIT_ERROR));
      const component = build().componentInstance;
      validForm(component);
      await component.onSubmit();
      expect(dialog.open).toHaveBeenCalledWith(ReceiptLimitDialogComponent, jasmine.any(Object));
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  it('onCancel closes the dialog with false', () => {
    build().componentInstance.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('openLongReceiptCapture opens the camera dialog only after this dialog closes', () => {
    const closed$ = new Subject<unknown>();
    dialogRef.afterClosed.and.returnValue(closed$.asObservable() as never);
    const component = build().componentInstance;

    component.openLongReceiptCapture();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
    expect(dialog.open).not.toHaveBeenCalled();

    closed$.next(undefined);
    expect(dialog.open).toHaveBeenCalledWith(CameraCaptureComponent, jasmine.any(Object));
  });

  describe('existing receipt housekeeping (edit mode)', () => {
    const txnWithReceipt = () =>
      createTransaction({ id: 'e1', receiptUrl: 'https://storage.example.com/r.jpg' });

    const multiImageTxn = () =>
      createTransaction({
        id: 'e1',
        receiptUrl: 'https://storage.example.com/r0.jpg',
        receiptUrls: [
          'https://storage.example.com/r0.jpg',
          'https://storage.example.com/r1.jpg',
        ],
        receiptCount: 2,
      });

    it('seeds one stored entry per image, keyed by slot', () => {
      const component = build({ mode: 'edit', transaction: multiImageTxn() }).componentInstance;
      expect(component.storedReceipts()).toEqual([
        { url: 'https://storage.example.com/r0.jpg', slot: 0 },
        { url: 'https://storage.example.com/r1.jpg', slot: 1 },
      ]);
    });

    it('keeps surviving slots when seeding across a tombstone', () => {
      const txn = createTransaction({
        id: 'e1',
        receiptUrl: 'https://storage.example.com/r2.jpg',
        receiptUrls: ['', '', 'https://storage.example.com/r2.jpg'],
        receiptCount: 1,
      });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      expect(component.storedReceipts()).toEqual([
        { url: 'https://storage.example.com/r2.jpg', slot: 2 },
      ]);
    });

    it('removes one stored image by its slot after confirmation', async () => {
      const component = build({ mode: 'edit', transaction: multiImageTxn() }).componentInstance;

      await component.removeStoredReceipt({ url: 'https://storage.example.com/r1.jpg', slot: 1 });

      expect(transactionService.removeReceiptAt).toHaveBeenCalledWith('e1', 1);
      // Only the removed image leaves the strip.
      expect(component.storedReceipts()).toEqual([
        { url: 'https://storage.example.com/r0.jpg', slot: 0 },
      ]);
      expect(notifications.success).toHaveBeenCalledWith('receiptImages.removed');
    });

    it('keeps the image when the confirmation is declined', async () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      const component = build({ mode: 'edit', transaction: txnWithReceipt() }).componentInstance;

      await component.removeStoredReceipt({ url: 'https://storage.example.com/r.jpg', slot: 0 });

      expect(transactionService.removeReceiptAt).not.toHaveBeenCalled();
      expect(component.storedReceipts().length).toBe(1);
    });

    it('converts one stored image by its slot into the note field', async () => {
      receiptToNote.convertReceiptToNote.and.resolveTo('Latte — 5.00\nTotal 5.00');
      const component = build({ mode: 'edit', transaction: multiImageTxn() }).componentInstance;

      await component.convertStoredReceiptToNote({ url: 'https://storage.example.com/r1.jpg', slot: 1 });

      expect(receiptToNote.convertReceiptToNote).toHaveBeenCalledWith(jasmine.any(Object), 1);
      expect(component.form.get('note')?.value).toBe('Latte — 5.00\nTotal 5.00');
      // The converted image leaves the strip; the other stays.
      expect(component.storedReceipts()).toEqual([
        { url: 'https://storage.example.com/r0.jpg', slot: 0 },
      ]);
      expect(notifications.success).toHaveBeenCalledWith('receiptImages.converted');
    });

    it('keeps the image and reports a conversion failure', async () => {
      receiptToNote.convertReceiptToNote.and.rejectWith(new Error('RECEIPT_TO_NOTE_NO_DETAILS'));
      const component = build({ mode: 'edit', transaction: txnWithReceipt() }).componentInstance;

      await component.convertStoredReceiptToNote({ url: 'https://storage.example.com/r.jpg', slot: 0 });

      expect(component.storedReceipts().length).toBe(1);
      expect(notifications.error).toHaveBeenCalledWith('receiptImages.convertFailedNoDetails');
    });
  });

  describe('currency picker', () => {
    it('lists only the curated currencies for an ordinary transaction', () => {
      const component = build().componentInstance;
      expect(component.currencies().map(c => c.code)).toEqual(['USD']);
    });

    it('keeps a transaction in an uncurated currency selectable when editing it', () => {
      // Extraction can now read any currency the rates endpoint knows, which
      // is far more than the picker lists. With no matching option the select
      // shows nothing selected, and saving would rewrite the currency.
      const component = build({
        mode: 'edit',
        transaction: { ...createTransaction(), currency: 'MXN' },
      }).componentInstance;

      expect(component.currencies().map(c => c.code)).toContain('MXN');
    });

    it('makes a scanned currency selectable when it is not curated', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'MXN' }));
      const component = build().componentInstance;

      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

      expect(component.currencies().map(c => c.code)).toContain('MXN');
      expect(component.form.get('currency')?.value).toBe('MXN');
    });
  });

  describe('currency suggested from location', () => {
    const scan = (component: TransactionFormComponent) =>
      (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

    it('offers the local currency when the receipt did not state one', async () => {
      // currencyFellBack means the amount is sitting in the account's base
      // currency because nothing was read — where the user is standing is a
      // better guess than where they live.
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 }); // Seoul

      await scan(component);

      expect(component.suggestedCurrency()).toEqual({ code: 'KRW', country: 'KR' });
      // Offered, not applied.
      expect(component.form.get('currency')?.value).toBe('USD');
    });

    it('says nothing when the model actually read a currency', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: false }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 });

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
    });

    it('says nothing when the local currency is already in the field', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'KRW', currencyFellBack: true }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 });

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
    });

    it('says nothing when the coordinates cannot be placed', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 0, lng: -140 }); // mid-Pacific

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
    });

    it('says nothing when the platform refuses a position', async () => {
      // A refusal is silent on purpose: the base currency is already in the
      // field, and a suggestion nobody asked for is not worth an error.
      const geolocation = { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() };
      spyOnProperty(navigator, 'geolocation', 'get').and.returnValue(geolocation as never);
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
      expect(notifications.error).not.toHaveBeenCalledWith(jasmine.stringMatching(/location/i));
    });

    it('accepting applies it and keeps it selectable', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 });
      await scan(component);

      component.acceptCurrencySuggestion();

      expect(component.form.get('currency')?.value).toBe('KRW');
      expect(component.currencies().map(c => c.code)).toContain('KRW');
      expect(component.suggestedCurrency()).toBeNull();
    });

    it('dismissing leaves the form alone', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 });
      await scan(component);

      component.dismissCurrencySuggestion();

      expect(component.suggestedCurrency()).toBeNull();
      expect(component.form.get('currency')?.value).toBe('USD');
    });
  });

  describe('receipt scanning', () => {
    it('ignores a non-image file', () => {
      const component = build().componentInstance;
      const file = new File(['x'], 'a.txt', { type: 'text/plain' });
      component.onReceiptSelected({ target: { files: [file], value: '' } } as unknown as Event);
      expect(notifications.error).toHaveBeenCalledWith('ai.invalidFileType');
    });

    it('ignores an empty selection', () => {
      const component = build().componentInstance;
      component.onReceiptSelected({ target: { files: [], value: '' } } as unknown as Event);
      expect(notifications.error).not.toHaveBeenCalled();
    });

    it('blocks attaching a new image at the quota limit and shows the limit dialog', async () => {
      receiptQuota.canAddImages.and.resolveTo(false);
      const component = build().componentInstance;
      const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
      await component.onReceiptSelected({ target: { files: [file], value: '' } } as unknown as Event);
      expect(dialog.open).toHaveBeenCalledWith(ReceiptLimitDialogComponent, jasmine.any(Object));
      // Nothing is queued: a partial queue would save a different set of
      // images than the user picked.
      expect(component.pendingReceipts()).toEqual([]);
    });

    it('caps a pick at the per-transaction maximum', async () => {
      const component = build().componentInstance;
      const files = Array.from(
        { length: 6 },
        (_, i) => new File([`r${i}`], `r${i}.jpg`, { type: 'image/jpeg' })
      );

      await component.onReceiptSelected({ target: { files, value: '' } } as unknown as Event);

      expect(component.pendingReceipts().length).toBe(5);
      expect(notifications.info).toHaveBeenCalledWith('receiptImages.maxPerTransaction');
    });

    it('scanReceipt fills the form on success', async () => {
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.form.get('description')?.value).toBe('Cafe');
      expect(component.form.get('categoryId')?.value).toBe('food');
      expect(component.isScanning()).toBeFalse();
      expect(notifications.success).toHaveBeenCalledWith('ai.scanSuccess');
    });

    it('scanReceipt records the full receipt details in the note field', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ notes: 'Latte — 5.00\nBagel — 7.00\nTotal 12.00' }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.form.get('note')?.value).toBe('Latte — 5.00\nBagel — 7.00\nTotal 12.00');
    });

    // Assembling the itemized fallback is AIStrategyService's job (see its
    // spec); the form's job is only to surface whatever came back.
    it('scanReceipt records the itemized fallback the strategy assembled', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ notes: 'Latte — USD 5.00\nBagel — USD 7.00' }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.form.get('note')?.value).toBe('Latte — USD 5.00\nBagel — USD 7.00');
    });

    it('scanReceipt reports an unreadable photo rather than filling the form', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({}, { transactions: [] }));
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.scanError()).toBe('ai.scanError');
      expect(component.form.get('description')?.value).toBeFalsy();
    });

    it('scanReceipt flags a field the model was unsure of', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ fieldConfidence: { amount: 0.4, date: 0.95 } }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('amount')).toBeTrue();
      expect(component.shouldVerifyField('date')).toBeFalse();
    });

    it('scanReceipt leaves an existing note untouched when no details were extracted', async () => {
      const component = build().componentInstance;
      component.form.patchValue({ note: 'my note' });
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.form.get('note')?.value).toBe('my note');
    });

    it('scanReceipt records an error on failure', async () => {
      strategy.processReceipt.and.rejectWith(new Error('bad'));
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.scanError()).toBe('ai.scanError');
      expect(notifications.error).toHaveBeenCalledWith('ai.scanError');
    });

    describe('multi-receipt chooser', () => {
      const scan = (component: TransactionFormComponent) =>
        (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

      function primeMultiReceiptScan(count = 2) {
        strategy.processReceipt.and.resolveTo(scanResult({}, { receiptCount: count }));
        const component = build().componentInstance;
        component.pendingReceipts.set([
          { file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), preview: 'data:image/jpeg;base64,x' },
        ]);
        return component;
      }

      it('does not offer the chooser for a single-receipt photo', async () => {
        const component = build().componentInstance;
        component.pendingReceipts.set([
          { file: new File(['x'], 'r.jpg', { type: 'image/jpeg' }), preview: 'data:image/jpeg;base64,x' },
        ]);
        await scan(component);
        expect(dialog.open).not.toHaveBeenCalledWith(ConfirmDialogComponent, jasmine.any(Object));
      });

      it('declining keeps the patched form and skips the pipeline', async () => {
        const component = primeMultiReceiptScan();
        dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

        await scan(component);

        expect(dialog.open).toHaveBeenCalledWith(ConfirmDialogComponent, jasmine.any(Object));
        expect(aiImport.importFromMultipleImages).not.toHaveBeenCalled();
        expect(component.form.get('description')?.value).toBe('Cafe');
        expect(dialogRef.close).not.toHaveBeenCalled();
      });

      it('confirming routes the photo through the import pipeline to the wizard', async () => {
        const component = primeMultiReceiptScan(3);
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        const importResult = { source: 'image', transactions: [] } as never;
        aiImport.importFromMultipleImages.and.resolveTo(importResult);

        await scan(component);

        expect(aiImport.importFromMultipleImages).toHaveBeenCalledWith([component.pendingReceipts()[0].file]);
        expect(dialogRef.close).toHaveBeenCalledWith(false);
        expect(router.navigate).toHaveBeenCalledWith(['/import/file'], {
          state: { importResult, fromCamera: true, multiImage: false },
        });
      });

      it('a pipeline failure reports the error and keeps the form open', async () => {
        const component = primeMultiReceiptScan();
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        aiImport.importFromMultipleImages.and.rejectWith(new Error('bad'));

        await scan(component);

        expect(notifications.error).toHaveBeenCalledWith('ai.scanError');
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
        expect(component.isScanning()).toBeFalse();
      });
    });

    it('useMyLocation captures coordinates on success', () => {
      const component = build().componentInstance;
      spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake(success => {
        (success as PositionCallback)({
          coords: { latitude: 35.66, longitude: 139.71 },
        } as GeolocationPosition);
      });

      component.useMyLocation();

      expect(component.locationCoords()).toEqual({ lat: 35.66, lng: 139.71 });
      expect(component.isLocating()).toBeFalse();
      expect(notifications.success).toHaveBeenCalledWith('transactions.locationCaptured');
    });

    it('useMyLocation degrades to name-only when permission is denied', () => {
      const component = build().componentInstance;
      component.form.patchValue({ locationName: 'Aoyama Market' });
      spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((success, error) => {
        (error as PositionErrorCallback)({ code: 1 } as GeolocationPositionError);
      });

      component.useMyLocation();

      expect(component.locationCoords()).toBeNull();
      // The typed name survives; only the coordinates are refused.
      expect(component.form.get('locationName')?.value).toBe('Aoyama Market');
      expect(notifications.error).toHaveBeenCalledWith('transactions.locationDenied');
      expect(component.isLocating()).toBeFalse();
    });

    it('useMyLocation reports an unavailable position distinctly', () => {
      const component = build().componentInstance;
      spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake((success, error) => {
        (error as PositionErrorCallback)({ code: 2 } as GeolocationPositionError);
      });

      component.useMyLocation();

      expect(notifications.error).toHaveBeenCalledWith('transactions.locationUnavailable');
    });

    it('clearCoordinates detaches them', () => {
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 1, lng: 2 });
      component.clearCoordinates();
      expect(component.locationCoords()).toBeNull();
    });

    it('tag input trims, lowercases, dedupes and seeds from the transaction', () => {
      const txn = createTransaction({ id: 'e1', tags: ['coffee'] });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      expect(component.tags()).toEqual(['coffee']);

      const chipInput = { clear: jasmine.createSpy('clear') };
      component.addTag({ value: '  Coffee ', chipInput } as never);
      // "Coffee" is already there once lowercased.
      expect(component.tags()).toEqual(['coffee']);

      component.addTag({ value: 'Reimbursable', chipInput } as never);
      expect(component.tags()).toEqual(['coffee', 'reimbursable']);

      component.addTag({ value: '   ', chipInput } as never);
      expect(component.tags()).toEqual(['coffee', 'reimbursable']);
      expect(chipInput.clear).toHaveBeenCalledTimes(3);

      component.removeTag('coffee');
      expect(component.tags()).toEqual(['reimbursable']);
    });

    it('removing a queued image drops it from the strip', () => {
      const component = build().componentInstance;
      const keep = { file: new File(['a'], 'a.jpg', { type: 'image/jpeg' }), preview: 'data:a' };
      const drop = { file: new File(['b'], 'b.jpg', { type: 'image/jpeg' }), preview: 'data:b' };
      component.pendingReceipts.set([keep, drop]);

      component.removePendingReceipt(1);

      expect(component.pendingReceipts()).toEqual([keep]);
    });
  });

  describe('category suggestion', () => {
    it('suggests a category from the description after debounce', fakeAsync(() => {
      const component = build().componentInstance;
      component.form.get('description')?.setValue('coffee shop');
      tick(500);
      expect(strategy.suggestCategory).toHaveBeenCalled();
      expect(component.suggestedCategory()).toEqual(expense);
    }));

    it('acceptSuggestion applies the suggested category', () => {
      const component = build().componentInstance;
      component.suggestedCategory.set(expense);
      component.acceptSuggestion();
      expect(component.form.get('categoryId')?.value).toBe('food');
      expect(component.suggestedCategory()).toBeNull();
    });

    it('acceptSuggestion is a no-op without a suggestion', () => {
      const component = build().componentInstance;
      component.acceptSuggestion();
      expect(component.form.get('categoryId')?.value).toBe('');
    });
  });

  describe('calendar date helpers', () => {
    it('preloads transaction dates on month/year change', () => {
      const component = build().componentInstance;
      component.onCalendarMonthChange(new Date(2026, 5, 1));
      component.onCalendarYearChange(new Date(2026, 0, 1));
      expect(transactionService.getTransactionDatesForMonth).toHaveBeenCalled();
    });

    it('dateClass loads uncached months and returns a class for cached data', () => {
      transactionService.getTransactionDatesForMonth.and.returnValue(
        of(new Map([['2026-0-5', 'income' as const]])),
      );
      const component = build().componentInstance;
      // First call triggers a load and returns empty.
      expect(component.dateClass(new Date(2026, 0, 5))).toBe('');
      // Now cached -> resolves the class.
      expect(component.dateClass(new Date(2026, 0, 5))).toBe('has-income');
    });

    it('wires datepicker open events in ngAfterViewInit', () => {
      const component = build().componentInstance;
      const opened = new Subject<void>();
      component.picker = { openedStream: opened.asObservable() } as never;
      component.ngAfterViewInit();
      opened.next();
      expect(transactionService.getTransactionDatesForMonth).toHaveBeenCalled();
    });

    it('exposes the period options', () => {
      expect(build().componentInstance.periods.map((p) => p.value)).toEqual(['weekly', 'monthly', 'yearly']);
    });

    it('ngOnDestroy unsubscribes without error', () => {
      const fixture = build();
      expect(() => fixture.destroy()).not.toThrow();
    });
  });
});
