import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TransactionFormComponent } from './transaction-form.component';
import { TransactionService, RECEIPT_IMAGE_LIMIT_ERROR, RECEIPT_ATTACH_FAILED, GOAL_LINK_INVALID } from '../../../core/services/transaction.service';
import { GoalService } from '../../../core/services/goal.service';
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
import { ReceiptAttempt, ReceiptAttemptService } from '../../../core/services/receipt-attempt.service';
import { GroundingHistoryService } from '../../../core/services/grounding-history.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { TagSuggestionService } from '../../../core/services/tag-suggestion.service';
import { CurrencyChoiceSessionService } from '../../../core/services/currency-choice-session.service';
import { Transaction, Category, Goal, User } from '../../../models';
import { createTransaction, createCategory, createUser } from '../../../core/services/testing';
import { NotificationService } from '../../../core/services/notification.service';

function attemptStub() {
  const handle = jasmine.createSpyObj<ReceiptAttempt>('ReceiptAttempt', ['succeeded', 'failed', 'queued']);
  const service = jasmine.createSpyObj<ReceiptAttemptService>('ReceiptAttemptService', ['begin']);
  service.begin.and.returnValue(handle);
  return { service, handle };
}

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
  let tagSuggestions: jasmine.SpyObj<TagSuggestionService>;
  let groundingHistory: jasmine.SpyObj<GroundingHistoryService>;
  let tagMemory: jasmine.SpyObj<TagMemoryService>;
  let currencySession: jasmine.SpyObj<CurrencyChoiceSessionService>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let goalService: {
    goals: ReturnType<typeof signal<Goal[]>>;
    activeGoals: ReturnType<typeof signal<Goal[]>>;
    getGoals: jasmine.Spy;
  };
  let attempts: ReturnType<typeof attemptStub>;

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
    tagSuggestions = jasmine.createSpyObj<TagSuggestionService>('TagSuggestionService', ['suggest']);
    tagSuggestions.suggest.and.resolveTo([[]]);
    groundingHistory = jasmine.createSpyObj<GroundingHistoryService>('GroundingHistoryService', ['recent']);
    groundingHistory.recent.and.resolveTo([]);
    tagMemory = jasmine.createSpyObj<TagMemoryService>('TagMemoryService', ['remember']);
    tagMemory.remember.and.resolveTo(undefined);
    currencySession = jasmine.createSpyObj<CurrencyChoiceSessionService>('CurrencyChoiceSessionService', ['remember', 'current', 'clear']);
    currencySession.current.and.returnValue(null);
    currentUser = signal<User | null>(createUser());
    goalService = {
      goals: signal<Goal[]>([]),
      activeGoals: signal<Goal[]>([]),
      getGoals: jasmine.createSpy('getGoals').and.returnValue(of([])),
    };
    attempts = attemptStub();

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
        { provide: TagSuggestionService, useValue: tagSuggestions },
        { provide: GroundingHistoryService, useValue: groundingHistory },
        { provide: TagMemoryService, useValue: tagMemory },
        { provide: GoalService, useValue: goalService },
        { provide: ReceiptAttemptService, useValue: attempts.service },
        { provide: CurrencyChoiceSessionService, useValue: currencySession },
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

  describe('goal picker', () => {
    function goalOf(overrides: Partial<Goal> = {}): Goal {
      return {
        id: 'g1',
        userId: 'u1',
        kind: 'saving',
        name: 'Emergency fund',
        targetAmount: 1000,
        contributedAmount: 0,
        currency: 'USD',
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...overrides,
      };
    }

    it('owns a goals subscription: the signal is only warm if a page subscribed', () => {
      build();
      expect(goalService.getGoals).toHaveBeenCalled();
    });

    it('offers the active goals', () => {
      goalService.activeGoals.set([goalOf()]);
      const component = build().componentInstance;
      expect(component.goalOptions().map(goal => goal.id)).toEqual(['g1']);
    });

    it('keeps a since-deactivated linked goal in the options on edit', () => {
      const inactive = goalOf({ id: 'g9', isActive: false });
      goalService.goals.set([inactive]);
      goalService.activeGoals.set([]);
      const txn = createTransaction({ id: 'e1', goalId: 'g9', goalAmount: 50 });

      const component = build({ mode: 'edit', transaction: txn }).componentInstance;

      // The stored value must render and stay clearable.
      expect(component.goalOptions().map(goal => goal.id)).toEqual(['g9']);
    });

    it('labels a goal with its currency only when it differs from the form', () => {
      const component = build().componentInstance; // form currency USD
      expect(component.goalLabel(goalOf())).toBe('Emergency fund');
      expect(component.goalLabel(goalOf({ currency: 'EUR' })))
        .toBe('Emergency fund (EUR)');
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

    it('links the chosen goal on add', async () => {
      const component = build().componentInstance;
      validForm(component);
      component.form.patchValue({ goalId: 'g1' });
      await component.onSubmit();
      expect(transactionService.addTransaction.calls.mostRecent().args[0].goalId).toBe('g1');
    });

    it('omits the goal key on add when none is chosen', async () => {
      const component = build().componentInstance;
      validForm(component);
      await component.onSubmit();
      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect('goalId' in dto).toBeFalse();
    });

    it('sends the goal key when editing clears it, so the link is removed', async () => {
      const txn = createTransaction({ id: 'e1', goalId: 'g1', goalAmount: 100 });
      const component = build({ mode: 'edit', transaction: txn }).componentInstance;
      validForm(component);
      expect(component.form.get('goalId')?.value).toBe('g1');
      component.form.patchValue({ goalId: null });

      await component.onSubmit();

      const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
      // Present-and-undefined, the period contract: absent would keep the link.
      expect('goalId' in dto).toBeTrue();
      expect(dto.goalId).toBeUndefined();
    });

    it('reports a dead goal link without closing the dialog', async () => {
      transactionService.addTransaction.and.rejectWith(new Error(GOAL_LINK_INVALID));
      const component = build().componentInstance;
      validForm(component);
      component.form.patchValue({ goalId: 'g1' });

      await component.onSubmit();

      expect(notifications.error).toHaveBeenCalledWith('transactions.goalLinkInvalid');
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(component.isSubmitting()).toBeFalse();
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

    // 0068: a receipt can name the country it was issued in through a tax
    // number, a phone format or its own script while printing no address at
    // all. 0064 kept that country as a review mark because nothing rendered
    // it; these pin that it now reaches the document, and the two places it
    // still must not.
    describe('the country a scan concluded', () => {
      const scan = (component: TransactionFormComponent) =>
        (component as unknown as { scanReceipt: (f: File) => Promise<void> })
          .scanReceipt(receiptFile());

      it('stores the scanned country when the receipt printed no address', async () => {
        strategy.processReceipt.and.resolveTo(scanResult({ receiptCountry: 'KR' }));
        const component = build().componentInstance;
        await scan(component);
        validForm(component);
        component.form.patchValue({ locationName: '' });

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect(dto.location).toEqual({ country: 'KR' });
      });

      it('keeps the printed address and its country together', async () => {
        strategy.processReceipt.and.resolveTo(scanResult({
          receiptCountry: 'KR',
          location: { name: 'Myeongdong', country: 'KR' },
        }));
        const component = build().componentInstance;
        await scan(component);
        validForm(component);

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect(dto.location).toEqual({ name: 'Myeongdong', country: 'KR' });
      });

      it('does not attach the paper country to a place the user typed instead', async () => {
        // The name-equality gate 0064 set: a typed name is the user's own
        // answer to "where", and the paper's country is not attached to it.
        strategy.processReceipt.and.resolveTo(scanResult({
          receiptCountry: 'KR',
          location: { name: 'Myeongdong', country: 'KR' },
        }));
        const component = build().componentInstance;
        await scan(component);
        validForm(component);
        component.form.patchValue({ locationName: "Mum's place" });

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect(dto.location).toEqual({ name: "Mum's place" });
      });

      it('lets an attached coordinate overrule the scanned country', async () => {
        // 0064's one exception, unchanged: a coordinate lands on the row only
        // by a deliberate user action, so it outranks the paper.
        strategy.processReceipt.and.resolveTo(scanResult({ receiptCountry: 'KR' }));
        const component = build().componentInstance;
        await scan(component);
        validForm(component);
        component.form.patchValue({ locationName: 'Aoyama Market' });
        component.locationCoords.set({ lat: 35.66, lng: 139.71 }); // Tokyo

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect(dto.location).toEqual({
          name: 'Aoyama Market', lat: 35.66, lng: 139.71, country: 'JP',
        });
      });

      it('drops the scanned country when a new scan replaces it', async () => {
        strategy.processReceipt.and.resolveTo(scanResult({ receiptCountry: 'KR' }));
        const component = build().componentInstance;
        await scan(component);

        strategy.processReceipt.and.resolveTo(scanResult({}));
        await scan(component);
        validForm(component);
        component.form.patchValue({ locationName: '' });

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect('location' in dto).toBeFalse();
      });

      it('stores no country when the scan concluded none', async () => {
        strategy.processReceipt.and.resolveTo(scanResult({}));
        const component = build().componentInstance;
        await scan(component);
        validForm(component);
        component.form.patchValue({ locationName: '' });

        await component.onSubmit();

        const dto = transactionService.addTransaction.calls.mostRecent().args[0];
        expect('location' in dto).toBeFalse();
      });

      it('still clears a stored location in edit mode when nothing was scanned', async () => {
        const txn = createTransaction({
          id: 'e1',
          location: { name: 'Aoyama Market', country: 'JP' },
        });
        const component = build({ mode: 'edit', transaction: txn }).componentInstance;
        validForm(component);
        component.form.patchValue({ locationName: '' });

        await component.onSubmit();

        const dto = transactionService.updateTransaction.calls.mostRecent().args[1];
        expect('location' in dto).toBeTrue();
        expect(dto.location).toBeUndefined();
      });
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
    const fellBack = (row: Partial<ProcessedTransaction> = {}) =>
      scanResult({ currency: 'USD', currencyFellBack: true, ...row });
    let getCurrentPosition: jasmine.Spy;

    beforeEach(() => {
      getCurrentPosition = jasmine.createSpy('getCurrentPosition')
        .and.callFake((ok: (p: GeolocationPosition) => void) =>
          ok({ coords: { latitude: 37.5665, longitude: 126.978 } } as GeolocationPosition)); // Seoul
      spyOnProperty(navigator, 'geolocation', 'get').and.returnValue({ getCurrentPosition } as never);
      spyOnProperty(navigator, 'language', 'get').and.returnValue('en-US');
    });

    it('offers the currency of the country read off the receipt, over where the phone is', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'JP' }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 }); // Seoul

      await scan(component);

      expect(component.suggestedCurrency()).toEqual({ code: 'JPY', country: 'JP', reason: 'receipt' });
      expect(getCurrentPosition).not.toHaveBeenCalled();
      // Offered, not applied.
      expect(component.form.get('currency')?.value).toBe('USD');
    });

    it('falls through to the position when the receipt did not say where it was issued', async () => {
      strategy.processReceipt.and.resolveTo(fellBack());
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 37.5665, lng: 126.978 });

      await scan(component);

      expect(component.suggestedCurrency()).toEqual({ code: 'KRW', country: 'KR', reason: 'position' });
    });

    it('never asks for a position for a receipt that is not from today', async () => {
      // 2026-01-01 is never today; a fix taken now says nothing about it.
      strategy.processReceipt.and.resolveTo(fellBack({ date: new Date(2026, 0, 1) }));
      const component = build().componentInstance;

      await scan(component);

      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(component.suggestedCoordinates()).toBeNull();
      // en-US locale → USD, which is already in the field, so nothing speaks.
      expect(component.suggestedCurrency()).toBeNull();
    });

    it('offers what the user chose for the last fallen-back receipt this session', async () => {
      currencySession.current.and.returnValue('THB');
      strategy.processReceipt.and.resolveTo(fellBack({ date: new Date(2026, 0, 1) }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCurrency()).toEqual({ code: 'THB', reason: 'session' });
    });

    it('falls back to the device locale\'s region when nothing else speaks', async () => {
      (Object.getOwnPropertyDescriptor(navigator, 'language')?.get as jasmine.Spy).and.returnValue('ja-JP');
      strategy.processReceipt.and.resolveTo(fellBack({ date: new Date(2026, 0, 1) }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCurrency()).toEqual({ code: 'JPY', country: 'JP', reason: 'locale' });
    });

    it('says nothing when the model actually read a currency', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: false, receiptCountry: 'KR' }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
    });

    it('says nothing when the suggested currency is already in the field', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'KRW', currencyFellBack: true, receiptCountry: 'KR' }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCurrency()).toBeNull();
    });

    it('says nothing when the platform refuses a position', async () => {
      // Dated today, no receipt country and nothing attached: the one shape
      // that actually reaches getCurrentPosition. scanResult's default date
      // (2026-01-01) would be gated out before the platform was ever asked.
      getCurrentPosition.and.callFake((_ok: unknown, fail: () => void) => fail());
      strategy.processReceipt.and.resolveTo(fellBack({ date: new Date() }));
      const component = build().componentInstance;

      await scan(component);

      expect(getCurrentPosition).toHaveBeenCalled();
      expect(component.suggestedCurrency()).toBeNull();
      expect(notifications.error).not.toHaveBeenCalledWith(jasmine.stringMatching(/location/i));
    });

    it('renders the country name and the reason, in the active locale', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);

      component.suggestionLabel(component.suggestedCurrency()!);
      // The form and the review card share one namespace for these strings
      // (M7), the review card's own.
      expect(TestBed.inject(TranslationService).t)
        .toHaveBeenCalledWith('import.currencyFromCountry', { country: 'South Korea', currency: 'KRW' });
      expect(component.reasonLabel('receipt')).toBe('import.currencyReasonReceipt');
      expect(component.reasonLabel('position')).toBe('import.currencyReasonPosition');
      expect(component.reasonLabel('session')).toBe('import.currencyReasonSession');
      expect(component.reasonLabel('locale')).toBe('import.currencyReasonLocale');
    });

    it('labels a session suggestion without a country', async () => {
      currencySession.current.and.returnValue('THB');
      strategy.processReceipt.and.resolveTo(fellBack({ date: new Date(2026, 0, 1) }));
      const component = build().componentInstance;
      await scan(component);

      component.suggestionLabel(component.suggestedCurrency()!);
      expect(TestBed.inject(TranslationService).t)
        .toHaveBeenCalledWith('import.currencySuggested', { currency: 'THB' });
    });

    it('accepting applies it, keeps it selectable and remembers it for the session', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);

      component.acceptCurrencySuggestion();

      expect(component.form.get('currency')?.value).toBe('KRW');
      expect(component.currencies().map(c => c.code)).toContain('KRW');
      expect(component.suggestedCurrency()).toBeNull();
      expect(currencySession.remember).toHaveBeenCalledWith('KRW');
    });

    it('dismissing leaves the form alone and remembers nothing', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);

      component.dismissCurrencySuggestion();

      expect(component.suggestedCurrency()).toBeNull();
      expect(component.form.get('currency')?.value).toBe('USD');
      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('remembers a currency the user picks by hand for a fallen-back scan, and drops the chip', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);

      component.form.patchValue({ currency: 'JPY' });

      expect(currencySession.remember).toHaveBeenCalledWith('JPY');
      expect(component.suggestedCurrency()).toBeNull();
    });

    it('remembers nothing when the model read the currency and the user merely edits it', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: false }));
      const component = build().componentInstance;
      await scan(component);

      component.form.patchValue({ currency: 'JPY' });

      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('does not credit a second scan\'s own read currency to a fallback the first scan left unsettled', async () => {
      // Two scans in sequence, unlike spec:913's single patchValue — that
      // test cannot distinguish a user's hand edit from the scan's own
      // currency patch, because both go through the same form.patchValue.
      // Driving a real second scan is the only way to see the stale flag.
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);
      expect(component.suggestedCurrency()).not.toBeNull();

      // The user never touched the chip or the field by hand — they just
      // ran a second scan, whose own currency was read rather than guessed.
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'JPY', currencyFellBack: false }));
      await scan(component);

      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('remembers the user\'s final answer when an accepted suggestion is then hand-corrected', async () => {
      strategy.processReceipt.and.resolveTo(fellBack({ receiptCountry: 'KR' }));
      const component = build().componentInstance;
      await scan(component);

      component.acceptCurrencySuggestion(); // accepts KRW
      component.form.patchValue({ currency: 'JPY' }); // then corrected by hand

      expect(currencySession.remember.calls.allArgs()).toEqual([['KRW'], ['JPY']]);
    });
  });

  describe('location read off the receipt', () => {
    const scan = (component: TransactionFormComponent) =>
      (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

    it('prefills an empty Location field with the printed address', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店' } }));
      const component = build().componentInstance;
      await scan(component);
      expect(component.form.get('locationName')?.value).toBe('渋谷店');
    });

    it('never overwrites a location the user typed', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店' } }));
      const component = build().componentInstance;
      component.form.patchValue({ locationName: 'My café' });
      await scan(component);
      expect(component.form.get('locationName')?.value).toBe('My café');
    });

    it('leaves Location empty when the receipt printed no address', async () => {
      strategy.processReceipt.and.resolveTo(scanResult());
      const component = build().componentInstance;
      await scan(component);
      expect(component.form.get('locationName')?.value ?? '').toBe('');
    });

    it('treats a Location holding only whitespace as empty', async () => {
      // Nothing the user can see is in the field, so nothing of theirs is
      // being overwritten — the guard trims before it decides.
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店' } }));
      const component = build().componentInstance;
      component.form.patchValue({ locationName: '   ' });
      await scan(component);
      expect(component.form.get('locationName')?.value).toBe('渋谷店');
    });

    it('carries the country the reader read off the address to the saved transaction, when the prefill is kept', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店', country: 'JP' } }));
      const component = build().componentInstance;
      await scan(component);

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: '渋谷店', country: 'JP' });
    });

    it('drops the printed country once the prefilled name is edited', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店', country: 'JP' } }));
      const component = build().componentInstance;
      await scan(component);
      component.form.patchValue({ locationName: 'My café' });

      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: 'My café' });
    });

    it('drops the printed country on a second scan, even though the field still shows the earlier prefill', async () => {
      // Conservative and deliberate, not an accident: the field is non-empty
      // once the first scan prefills it, so the second scan's own prefill
      // guard treats it the same as a name the user typed by hand and never
      // re-derives a country for it.
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: '渋谷店', country: 'JP' } }));
      const component = build().componentInstance;
      await scan(component);

      strategy.processReceipt.and.resolveTo(scanResult());
      await scan(component);

      expect(component.form.get('locationName')?.value).toBe('渋谷店');
      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: '渋谷店' });
    });
  });

  describe('coordinate fetched during the scan', () => {
    const scan = (component: TransactionFormComponent) =>
      (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
    const geolocation = (lat: number, lng: number) => ({
      getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: lat, longitude: lng } }),
    });

    it('offers the fix for a receipt dated today, and attaches it only on accept', async () => {
      spyOnProperty(navigator, 'geolocation', 'get').and.returnValue(geolocation(37.5665, 126.978) as never);
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true, date: new Date() }));
      const component = build().componentInstance;

      await scan(component);

      expect(component.suggestedCoordinates()).toEqual({ lat: 37.5665, lng: 126.978 });
      expect(component.locationCoords()).toBeNull();
      component.acceptCoordinateSuggestion();
      expect(component.locationCoords()).toEqual({ lat: 37.5665, lng: 126.978 });
      expect(component.suggestedCoordinates()).toBeNull();
    });

    it('offers nothing for a receipt from another day', async () => {
      spyOnProperty(navigator, 'geolocation', 'get').and.returnValue(geolocation(37.5665, 126.978) as never);
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true, date: new Date(2026, 0, 1) }));
      const component = build().componentInstance;
      await scan(component);
      expect(component.suggestedCoordinates()).toBeNull();
    });

    it('offers nothing when a coordinate is already attached', async () => {
      strategy.processReceipt.and.resolveTo(scanResult({ currency: 'USD', currencyFellBack: true, date: new Date() }));
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 1, lng: 2 });
      await scan(component);
      expect(component.suggestedCoordinates()).toBeNull();
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
      // Dated today, so the date's flag is the grade's alone.
      strategy.processReceipt.and.resolveTo(
        scanResult({ fieldConfidence: { amount: 0.4, date: 0.95 }, date: new Date() }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('amount')).toBeTrue();
      expect(component.shouldVerifyField('date')).toBeFalse();
    });

    it('scanReceipt flags a date that is not today, with the not-today wording alone when the reader was sure', async () => {
      // This form has no review step to hold, so the field is flagged where
      // it stands: an August receipt scanned in September is usually right,
      // and a glance settles it. The stub echoes the key, so the tooltip is
      // the key the field would render.
      strategy.processReceipt.and.resolveTo(
        scanResult({ date: new Date(2026, 7, 14), fieldConfidence: { date: 0.9 } }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('date')).toBeTrue();
      expect(component.verifyFieldTooltip('date')).toBe('import.dateNotTodayTooltip');
    });

    it('scanReceipt puts the reader\'s own doubt first when the date is also not today', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ date: new Date(2026, 7, 14), fieldConfidence: { date: 0.4 } }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('date')).toBeTrue();
      expect(component.verifyFieldTooltip('date')).toBe('import.verifyDate. import.dateNotTodayTooltip');
    });

    it('scanReceipt leaves a date read as today unflagged', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ date: new Date(), fieldConfidence: { date: 0.9 } }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('date')).toBeFalse();
    });

    it('drops the not-today flag once the date is moved to another day', async () => {
      strategy.processReceipt.and.resolveTo(
        scanResult({ date: new Date(2026, 7, 14), fieldConfidence: { date: 0.9 } }),
      );
      const component = build().componentInstance;
      await (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());
      expect(component.shouldVerifyField('date')).toBeTrue();

      // The same day again, re-picked or re-typed, is not a change of mind.
      component.form.get('date')!.setValue(new Date(2026, 7, 14, 9, 30));
      expect(component.shouldVerifyField('date')).withContext('same day').toBeTrue();

      component.form.get('date')!.setValue(new Date(2026, 7, 20));
      expect(component.shouldVerifyField('date')).withContext('another day').toBeFalse();
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
        const importResult = { source: 'image', transactions: [{ id: 't1' }] } as never;
        aiImport.importFromMultipleImages.and.resolveTo(importResult);

        await scan(component);

        expect(aiImport.importFromMultipleImages).toHaveBeenCalledWith([component.pendingReceipts()[0].file]);
        expect(dialogRef.close).toHaveBeenCalledWith(false);
        // Named as the form's own door, not the camera's — this extraction
        // began at the form, from an image the user chose there (#151).
        expect(router.navigate).toHaveBeenCalledWith(['/import/file'], {
          state: { importResult, fromCamera: true, door: 'form', multiImage: false },
        });
      });

      it('opens and settles its own attempt, distinct from the single-shot scan\'s', async () => {
        const component = primeMultiReceiptScan(3);
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        const importResult = { source: 'image', transactions: [{ id: 't1' }] } as never;
        aiImport.importFromMultipleImages.and.resolveTo(importResult);

        await scan(component);

        // Once for the primary scan, once for this second extraction.
        expect(attempts.service.begin.calls.count()).toBe(2);
        const [door, kind, files] = attempts.service.begin.calls.mostRecent().args;
        expect(door).toBe('form');
        expect(kind).toBe('receipt_image');
        expect(files).toEqual([component.pendingReceipts()[0].file]);
        expect(attempts.handle.succeeded).toHaveBeenCalledWith(importResult);
      });

      it('reports no transaction extracted rather than a silent success', async () => {
        const component = primeMultiReceiptScan(3);
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        aiImport.importFromMultipleImages.and.resolveTo({ source: 'image', transactions: [] } as never);

        await scan(component);

        expect(attempts.handle.failed).toHaveBeenCalledWith('nothing_extracted');
      });

      it('a pipeline failure reports the error and keeps the form open', async () => {
        const component = primeMultiReceiptScan();
        dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
        const failure = new Error('bad');
        aiImport.importFromMultipleImages.and.rejectWith(failure);

        await scan(component);

        expect(notifications.error).toHaveBeenCalledWith('ai.scanError');
        expect(dialogRef.close).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
        expect(component.isScanning()).toBeFalse();
        expect(attempts.handle.failed).toHaveBeenCalledWith(failure);
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

    it('clearCoordinates detaches them and drops the scan\'s offer with them', () => {
      // Clearing is a refusal. Leaving the offer up would re-present the very
      // coordinate the user just took off the form.
      const component = build().componentInstance;
      component.locationCoords.set({ lat: 1, lng: 2 });
      component.suggestedCoordinates.set({ lat: 3, lng: 4 });
      component.clearCoordinates();
      expect(component.locationCoords()).toBeNull();
      expect(component.suggestedCoordinates()).toBeNull();
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

    it('withdraws the scan\'s country claim when its receipt is removed', async () => {
      // The scan prefilled Location from the printed address and remembered
      // the country that address implied. Discarding the receipt image must
      // withdraw that claim too — otherwise a save with the field still
      // reading the prefill writes a country the user never confirmed.
      strategy.processReceipt.and.resolveTo(scanResult({ location: { name: 'Bakery St', country: 'JP' } }));
      const component = build().componentInstance;
      const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });

      await component.onReceiptSelected({ target: { files: [file], value: '' } } as unknown as Event);
      expect(component.form.get('locationName')?.value).toBe('Bakery St');

      component.removePendingReceipt(0);
      component.form.patchValue({
        type: 'expense', amount: '15.5', currency: 'USD', categoryId: 'food',
        description: 'Lunch', date: new Date(2026, 0, 1),
      });
      await component.onSubmit();

      const dto = transactionService.addTransaction.calls.mostRecent().args[0];
      expect(dto.location).toEqual({ name: 'Bakery St' });
    });
  });

  describe('tags offered by the scan', () => {
    const scan = (component: TransactionFormComponent) =>
      (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

    it('puts the offered tags in the chip input, beside what was typed', async () => {
      // Chips, not a silent write: each one can be taken off before saving.
      tagSuggestions.suggest.and.resolveTo([['coffee', 'work']]);
      const component = build().componentInstance;
      component.tags.set(['work', 'lunch']);

      await scan(component);

      expect(component.tags()).toEqual(['work', 'lunch', 'coffee']);
      expect(tagSuggestions.suggest.calls.mostRecent().args[0]).toEqual([{ description: 'Cafe' }]);
    });

    it('sends the receipt body as details and the recent history as grounding', async () => {
      const history = [createTransaction()];
      groundingHistory.recent.and.resolveTo(history);
      strategy.processReceipt.and.resolveTo(scanResult({ notes: 'Latte — 5.00' }));
      const component = build().componentInstance;

      await scan(component);

      const [rows, passed] = tagSuggestions.suggest.calls.mostRecent().args;
      expect(rows).toEqual([{ description: 'Cafe', details: 'Latte — 5.00' }]);
      expect(passed).toEqual(history);
    });

    it('reports the scan as succeeded even when no tag could be offered', async () => {
      // A second round-trip must not delay or undo the first one's answer.
      const warn = spyOn(console, 'warn');
      tagSuggestions.suggest.and.rejectWith(new Error('rate limited'));
      const component = build().componentInstance;

      await scan(component);

      expect(notifications.success).toHaveBeenCalledWith('ai.scanSuccess');
      expect(component.scanError()).toBeNull();
      expect(component.form.get('description')?.value).toBe('Cafe');
      expect(warn).toHaveBeenCalled();
    });

    it('asks for nothing when the scan itself failed', async () => {
      strategy.processReceipt.and.rejectWith(new Error('unreadable'));
      spyOn(console, 'error');
      const component = build().componentInstance;

      await scan(component);

      expect(tagSuggestions.suggest).not.toHaveBeenCalled();
    });

    it('remembers the chips left on and the offers taken off, on save', async () => {
      tagSuggestions.suggest.and.resolveTo([['coffee', 'work']]);
      const component = build().componentInstance;
      await scan(component);
      component.removeTag('work');

      await component.onSubmit();

      expect(transactionService.addTransaction).toHaveBeenCalled();
      expect(tagMemory.remember).toHaveBeenCalledWith('Cafe', ['coffee'], ['work']);
    });

    it('remembers nothing when the row was filled in by hand', async () => {
      const component = build().componentInstance;
      component.form.patchValue({
        type: 'expense', amount: '15.5', currency: 'USD', categoryId: 'food',
        description: 'Lunch', date: new Date(2026, 0, 1),
      });
      component.tags.set(['work']);

      await component.onSubmit();

      expect(tagMemory.remember).not.toHaveBeenCalled();
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

  describe('the in-form scan as a receipt attempt', () => {
    const scan = (component: TransactionFormComponent) =>
      (component as unknown as { scanReceipt: (f: File) => Promise<void> }).scanReceipt(receiptFile());

    it('opens a form-door handle and reports success with the result diagnostics', async () => {
      const diagnostics = { engine: 'cloud' as const, provider: 'gemini' as const, durationMs: 1200 };
      strategy.processReceipt.and.resolveTo({ ...scanResult(), diagnostics });
      await scan(build().componentInstance);

      const [door, kind] = attempts.service.begin.calls.mostRecent().args;
      expect(door).toBe('form');
      expect(kind).toBe('receipt_image');
      expect(attempts.handle.succeeded).toHaveBeenCalledWith(jasmine.objectContaining({ diagnostics }));
    });

    it('reports nothing_extracted when the scan produced no row', async () => {
      strategy.processReceipt.and.resolveTo({ ...scanResult(), transactions: [] });
      const component = build().componentInstance;
      await scan(component);

      expect(attempts.handle.failed).toHaveBeenCalledWith('nothing_extracted');
      expect(component.scanError()).toBe('ai.scanError');
    });

    it('reports the thrown error', async () => {
      const failure = new Error('429 too many requests');
      strategy.processReceipt.and.rejectWith(failure);
      await scan(build().componentInstance);

      expect(attempts.handle.failed).toHaveBeenCalledWith(failure);
    });
  });
});
