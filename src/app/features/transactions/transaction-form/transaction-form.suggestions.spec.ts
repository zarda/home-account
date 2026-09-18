import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of, EMPTY } from 'rxjs';
import { TransactionFormComponent } from './transaction-form.component';
import { TransactionService } from '../../../core/services/transaction.service';
import { GoalService } from '../../../core/services/goal.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { ReceiptToNoteService } from '../../../core/services/receipt-to-note.service';
import { AIImportService } from '../../../core/services/ai-import.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { GroundingHistoryService } from '../../../core/services/grounding-history.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { TagSuggestionService } from '../../../core/services/tag-suggestion.service';
import { NotificationService } from '../../../core/services/notification.service';
import { NoteTranslationService } from '../../../core/services/note-translation.service';
import { NoteTranslationComponent } from '../../../shared/components/note-translation/note-translation.component';
import { PwaService } from '../../../core/services/pwa.service';
import { Category, Goal, Transaction, User } from '../../../models';
import { createCategory, createTransaction, createUser } from '../../../core/services/testing';
import { ReceiptAttempt, ReceiptAttemptService } from '../../../core/services/receipt-attempt.service';

function attemptStub() {
  const handle = jasmine.createSpyObj<ReceiptAttempt>('ReceiptAttempt', ['succeeded', 'failed', 'queued']);
  const service = jasmine.createSpyObj<ReceiptAttemptService>('ReceiptAttemptService', ['begin']);
  service.begin.and.returnValue(handle);
  return { service, handle };
}

/**
 * The suggestion chips, rendered.
 *
 * The component's main spec overrides the template away, so nothing had ever
 * asserted what these two chips actually render — which is how a `mat-chip`
 * with a click handler survived: it looks interactive in the template and is
 * not one in the DOM. These tests render for real and assert the element type,
 * because that is what decides whether a keyboard can reach it.
 */
describe('TransactionFormComponent suggestion chips', () => {
  const expense = createCategory({ id: 'food', type: 'expense', name: 'categoryNames.food' });

  // The real PwaService registers window and service-worker listeners from
  // its constructor; the split's offline hint only needs the signal.
  let isOnline: ReturnType<typeof signal<boolean>>;
  let activeGoals: ReturnType<typeof signal<Goal[]>>;

  function build() {
    const fixture = TestBed.createComponent(TransactionFormComponent);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    isOnline = signal(true);
    activeGoals = signal<Goal[]>([]);
    const transactionService = jasmine.createSpyObj('TransactionService', [
      'addTransaction', 'updateTransaction', 'removeReceiptAt', 'removeAllReceipts',
      'getTransactionDatesForMonth',
    ]);
    transactionService.getTransactionDatesForMonth.and.returnValue(of(new Map()));

    const categoryService = {
      categories: signal<Category[]>([expense]),
      expenseCategories: signal<Category[]>([expense]),
      incomeCategories: signal<Category[]>([]),
      loadCategories: jasmine.createSpy('loadCategories').and.returnValue(of([])),
    };

    const strategy = jasmine.createSpyObj('AIStrategyService', [
      'hasAnyEngine', 'canProcessNow', 'canUseCloud', 'processReceipt', 'suggestCategory',
    ]);
    strategy.hasAnyEngine.and.returnValue(true);
    strategy.canProcessNow.and.returnValue(true);
    strategy.canUseCloud.and.returnValue(true);

    const currency = jasmine.createSpyObj('CurrencyService', [
      'getSupportedCurrencies', 'getCurrencyInfo', 'formatCurrency',
    ]);
    currency.getSupportedCurrencies.and.returnValue([{ code: 'USD', name: 'US Dollar', symbol: '$' }]);
    currency.getCurrencyInfo.and.callFake((code: string) => ({ code, nameKey: code, symbol: code }));
    // The split's remainder line is money; the real formatter resolves a
    // locale off TranslationService, which is a spy here.
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    // Echoes the key and its params, so a test can tell an accessible name
    // built from the right key apart from one that merely has text in it.
    const translation = jasmine.createSpyObj('TranslationService', ['t', 'currentLocale']);
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key);

    const dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'afterClosed']);
    dialogRef.afterClosed.and.returnValue(of(undefined));

    // The scan's tag ladder, kept inert: this suite renders chips, and the
    // real services would pull the provider chain and Firestore in behind them.
    const tagSuggestions = jasmine.createSpyObj<TagSuggestionService>('TagSuggestionService', ['suggest']);
    tagSuggestions.suggest.and.resolveTo([[]]);
    const groundingHistory = jasmine.createSpyObj<GroundingHistoryService>('GroundingHistoryService', ['recent']);
    groundingHistory.recent.and.resolveTo([]);
    const tagMemory = jasmine.createSpyObj<TagMemoryService>('TagMemoryService', ['remember']);
    tagMemory.remember.and.resolveTo(undefined);

    // The component now constructs the real CurrencyChoiceSessionService,
    // whose constructor effect reads authService.userId() — this stub needs
    // to answer that too, derived the way the real service derives it.
    const currentUser = signal<User | null>(createUser());

    await TestBed.configureTestingModule({
      imports: [TransactionFormComponent, ReactiveFormsModule],
      providers: [
        provideNoopAnimations(),
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser, userId: computed(() => currentUser()?.id ?? null) } },
        { provide: TranslationService, useValue: translation },
        { provide: AIStrategyService, useValue: strategy },
        { provide: AIImportService, useValue: jasmine.createSpyObj('AIImportService', ['importFromMultipleImages']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY }) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: ReceiptQuotaService, useValue: jasmine.createSpyObj('ReceiptQuotaService', ['canAddImages']) },
        { provide: ReceiptToNoteService, useValue: jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']) },
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['trackTransactionAdd', 'trackAiAssistUsed']) },
        { provide: TagSuggestionService, useValue: tagSuggestions },
        // The lens under the note field is the real component; its service is
        // not, because the real one builds the cloud-LLM graph and there is no
        // Firestore here to build it from.
        {
          provide: NoteTranslationService,
          useValue: jasmine.createSpyObj<NoteTranslationService>(
            'NoteTranslationService',
            ['translate', 'failureKey'],
            { available: signal(false) }
          ),
        },
        { provide: GroundingHistoryService, useValue: groundingHistory },
        { provide: TagMemoryService, useValue: tagMemory },
        // The form door's attempt handle; the real service reaches Firestore.
        { provide: ReceiptAttemptService, useValue: attemptStub().service },
        { provide: GoalService, useValue: {
          goals: signal([]),
          activeGoals,
          getGoals: jasmine.createSpy('getGoals').and.returnValue(of([])),
        } },
        { provide: PwaService, useValue: { isOnline } },
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'add' } },
      ],
    }).compileComponents();
  });

  describe('the currency suggestion', () => {
    it('renders as a button, so a keyboard can reach the accept', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH', reason: 'position' });
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
    });

    it('says what accepting does', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH', reason: 'position' });
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      // Its own text is the name — it already reads as an offer to accept.
      // The form reads the same namespace the review card does (M7).
      expect(chip.getAttribute('aria-label')).toBeNull();
      expect(chip.textContent).toContain('import.currencyFromCountry:Thailand,THB');
      expect(chip.textContent).toContain('import.currencyReasonPosition');
    });

    it('applies the currency when activated', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH', reason: 'position' });
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.suggestion-chip').click();
      fixture.detectChanges();

      expect(fixture.componentInstance.form.get('currency')?.value).toBe('THB');
      expect(fixture.componentInstance.suggestedCurrency()).toBeNull();
    });

    it('gives accept and dismiss the same keyboard affordance', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH', reason: 'position' });
      fixture.detectChanges();

      // The asymmetry this fixes: dismiss was always a real button, accept
      // was not, so a keyboard user could decline but never accept.
      const accept: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');
      const dismiss: HTMLElement = fixture.nativeElement.querySelector('.suggestion-dismiss');

      expect(accept.tagName).toBe(dismiss.tagName);
      expect(accept.hasAttribute('disabled')).toBeFalse();
    });
  });

  describe('the category suggestion', () => {
    it('renders as a button, so a keyboard can reach the accept', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCategory.set(expense);
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
    });

    it('names the action, not just the category', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCategory.set(expense);
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      // The visible label is only the category name, so the accessible name
      // has to say what pressing it does — and still contain that name.
      expect(chip.getAttribute('aria-label'))
        .toBe('transactions.useSuggestedCategory:categoryNames.food');
    });

    it('applies the category when activated', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCategory.set(expense);
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.suggestion-chip').click();
      fixture.detectChanges();

      expect(fixture.componentInstance.form.get('categoryId')?.value).toBe('food');
      expect(fixture.componentInstance.suggestedCategory()).toBeNull();
    });

    it('renders the pending state as a status rather than a dead control', () => {
      const fixture = build();
      fixture.componentInstance.isSuggesting.set(true);
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      // Nothing to activate while it is thinking, so it must not be a focus
      // stop; role=status is what announces it instead.
      expect(chip.tagName).not.toBe('BUTTON');
      expect(chip.getAttribute('role')).toBe('status');
    });
  });

  /**
   * The translation lens under the note field. Same reason the chips are
   * asserted here: this is the only spec that renders the real template, so
   * nothing else can see whether the lens is mounted at all — or whether it
   * is reading the note being typed rather than the one the dialog opened
   * with, which is the difference between translating a receipt and
   * translating whatever was there before the user replaced it.
   */
  describe('the note translation lens', () => {
    function lens(fixture: ComponentFixture<TransactionFormComponent>) {
      return fixture.debugElement.query(By.directive(NoteTranslationComponent));
    }

    function noteField(fixture: ComponentFixture<TransactionFormComponent>): Element {
      const textarea = fixture.nativeElement.querySelector(
        'textarea[formControlName="note"]'
      ) as HTMLElement;
      return textarea.closest('mat-form-field')!;
    }

    it('sits directly beneath the note field', () => {
      const fixture = build();

      expect(lens(fixture)).withContext('the lens is mounted').not.toBeNull();
      expect(noteField(fixture).nextElementSibling)
        .withContext('beneath the field, not inside it')
        .toBe(lens(fixture).nativeElement);
    });

    it('reads the note as it is typed', () => {
      const fixture = build();
      const mounted = () => (lens(fixture).componentInstance as NoteTranslationComponent).note();

      expect(mounted()).toBe('');

      fixture.componentInstance.form.get('note')!.setValue('おにぎり 150');
      fixture.detectChanges();

      expect(mounted()).toBe('おにぎり 150');
    });
  });
  /**
   * The split section, rendered. The component's main spec overrides the
   * template away, so only here can anything see whether the section, the
   * goal field and the notice actually appear when they should.
   */
  describe('the split section', () => {
    const section = (fixture: ComponentFixture<TransactionFormComponent>): Element | null =>
      fixture.nativeElement.querySelector('app-split-parts');

    const goalField = (fixture: ComponentFixture<TransactionFormComponent>): Element | null =>
      fixture.nativeElement.querySelector('mat-select[formControlName="goalId"]');

    const submitButton = (fixture: ComponentFixture<TransactionFormComponent>): HTMLButtonElement =>
      fixture.nativeElement.querySelector('.submit-button');

    function validForm(fixture: ComponentFixture<TransactionFormComponent>): void {
      fixture.componentInstance.form.patchValue({
        type: 'expense', amount: '100', currency: 'USD', categoryId: 'food',
        description: 'Weekly shop', date: new Date(2026, 0, 1),
      });
    }

    function editing(transaction: Partial<Transaction>) {
      TestBed.overrideProvider(MAT_DIALOG_DATA, {
        useValue: { mode: 'edit', transaction: createTransaction(transaction) },
      });
      return build();
    }

    it('is offered on a new purchase', () => {
      const fixture = build();

      expect(section(fixture)).not.toBeNull();
    });

    it('goes away once a goal is chosen', () => {
      activeGoals.set([{ id: 'g1', name: 'Trip', currency: 'USD' } as Goal]);
      const fixture = build();

      fixture.componentInstance.form.patchValue({ goalId: 'g1' });
      fixture.detectChanges();

      expect(section(fixture)).toBeNull();
    });

    it('takes the goal field away once a part is added', () => {
      activeGoals.set([{ id: 'g1', name: 'Trip', currency: 'USD' } as Goal]);
      const fixture = build();
      expect(goalField(fixture)).withContext('offered before the split').not.toBeNull();

      fixture.componentInstance.splitParts.set([{ categoryId: 'food', amount: 30 }]);
      fixture.detectChanges();

      expect(goalField(fixture)).toBeNull();
    });

    it('is not offered on a row already linked to a goal', () => {
      const fixture = editing({ id: 'e1', goalId: 'g1' });

      expect(section(fixture)).toBeNull();
    });

    it('says so on a row that is already one part of a split', () => {
      const fixture = editing({ id: 'e1', splitGroupId: 'grp-1' });

      const notice: HTMLElement = fixture.nativeElement.querySelector('.split-part-notice');
      expect(notice).not.toBeNull();
      expect(notice.textContent).toContain('transactions.splitPartNotice');
      // Splitting further joins the same group, so the section stays.
      expect(section(fixture)).not.toBeNull();
    });

    it('holds the submit while the parts cannot stand', () => {
      const fixture = build();
      validForm(fixture);
      fixture.detectChanges();
      expect(submitButton(fixture).disabled).withContext('a plain purchase saves').toBeFalse();

      fixture.componentInstance.splitParts.set([{ categoryId: 'food', amount: 100 }]);
      fixture.detectChanges();
      expect(submitButton(fixture).disabled).toBeTrue();

      fixture.componentInstance.splitParts.set([{ categoryId: 'food', amount: 40 }]);
      fixture.detectChanges();
      expect(submitButton(fixture).disabled).toBeFalse();
    });

    it('holds the submit while a row has no category, even with a valid amount', () => {
      const fixture = build();
      validForm(fixture);
      fixture.detectChanges();

      fixture.componentInstance.splitParts.set([{ categoryId: '', amount: 40 }]);
      fixture.detectChanges();

      expect(submitButton(fixture).disabled).toBeTrue();
    });

    it('warns that a split needs a connection', () => {
      const fixture = build();
      const hint = (): Element | null => fixture.nativeElement.querySelector('.split-offline-hint');

      fixture.componentInstance.splitParts.set([{ categoryId: 'food', amount: 30 }]);
      fixture.detectChanges();
      expect(hint()).withContext('nothing to warn about while online').toBeNull();

      isOnline.set(false);
      fixture.detectChanges();

      expect(hint()!.textContent).toContain('transactions.splitOfflineHint');
      expect(hint()!.getAttribute('role')).toBe('alert');
    });
  });
});
