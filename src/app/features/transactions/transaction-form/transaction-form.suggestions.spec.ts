import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { TransactionFormComponent } from './transaction-form.component';
import { TransactionService } from '../../../core/services/transaction.service';
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
import { NotificationService } from '../../../core/services/notification.service';
import { Category, User } from '../../../models';
import { createCategory, createUser } from '../../../core/services/testing';

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

  function build() {
    const fixture = TestBed.createComponent(TransactionFormComponent);
    fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
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

    const currency = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies', 'getCurrencyInfo']);
    currency.getSupportedCurrencies.and.returnValue([{ code: 'USD', name: 'US Dollar', symbol: '$' }]);
    currency.getCurrencyInfo.and.callFake((code: string) => ({ code, nameKey: code, symbol: code }));

    // Echoes the key and its params, so a test can tell an accessible name
    // built from the right key apart from one that merely has text in it.
    const translation = jasmine.createSpyObj('TranslationService', ['t', 'currentLocale']);
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key);

    const dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'afterClosed']);
    dialogRef.afterClosed.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports: [TransactionFormComponent, ReactiveFormsModule],
      providers: [
        provideNoopAnimations(),
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal<User | null>(createUser()) } },
        { provide: TranslationService, useValue: translation },
        { provide: AIStrategyService, useValue: strategy },
        { provide: AIImportService, useValue: jasmine.createSpyObj('AIImportService', ['importFromMultipleImages']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: ReceiptQuotaService, useValue: jasmine.createSpyObj('ReceiptQuotaService', ['canAddImages']) },
        { provide: ReceiptToNoteService, useValue: jasmine.createSpyObj('ReceiptToNoteService', ['convertReceiptToNote']) },
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['trackTransactionAdd', 'trackAiAssistUsed']) },
        { provide: MAT_DIALOG_DATA, useValue: { mode: 'add' } },
      ],
    }).compileComponents();
  });

  describe('the currency suggestion', () => {
    it('renders as a button, so a keyboard can reach the accept', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH' });
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
    });

    it('says what accepting does', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH' });
      fixture.detectChanges();

      const chip: HTMLElement = fixture.nativeElement.querySelector('.suggestion-chip');

      // Its own text is the name — it already reads as an offer to accept.
      expect(chip.getAttribute('aria-label')).toBeNull();
      expect(chip.textContent).toContain('transactions.currencyFromLocation:THB');
    });

    it('applies the currency when activated', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH' });
      fixture.detectChanges();

      fixture.nativeElement.querySelector('.suggestion-chip').click();
      fixture.detectChanges();

      expect(fixture.componentInstance.form.get('currency')?.value).toBe('THB');
      expect(fixture.componentInstance.suggestedCurrency()).toBeNull();
    });

    it('gives accept and dismiss the same keyboard affordance', () => {
      const fixture = build();
      fixture.componentInstance.suggestedCurrency.set({ code: 'THB', country: 'TH' });
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
});
