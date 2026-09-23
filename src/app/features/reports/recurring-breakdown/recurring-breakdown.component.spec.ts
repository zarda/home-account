import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { RecurringBreakdownComponent } from './recurring-breakdown.component';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { createTranslationStub, createLocaleFormatStub } from '../../../core/services/testing';

function expenseTxn(overrides: Partial<Transaction> = {}): Transaction {
  // The snapshot tracks an overridden `amount` by default — a fixture that
  // set only `amount` used to leave a stale `amountInBaseCurrency: 100`
  // behind it, invisible while every mock read `amount` directly through
  // `convert`, and wrong the moment a mock reads the snapshot field instead.
  const amount = overrides.amount ?? 100;
  return {
    id: 't1',
    userId: 'user1',
    type: 'expense',
    amount,
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'Test transaction',
    date: Timestamp.fromDate(new Date(2024, 5, 15)),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false,
    ...overrides,
  };
}

describe('RecurringBreakdownComponent', () => {
  let component: RecurringBreakdownComponent;
  let fixture: ComponentFixture<RecurringBreakdownComponent>;
  let convertSpy: jasmine.Spy;
  let amountInBaseSpy: jasmine.Spy;

  function txn(overrides: Partial<Transaction> = {}): Transaction {
    // See expenseTxn's comment above: the snapshot must track an overridden
    // `amount` by default.
    const amount = overrides.amount ?? 100;
    return {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount,
      amountInBaseCurrency: amount,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Test transaction',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    convertSpy = jasmine.createSpy('convert').and.callFake((amount: number) => amount);
    amountInBaseSpy = jasmine.createSpy('amountInBase')
      .and.callFake((t: Transaction) => t.amountInBaseCurrency);
    const mockCurrencyService = {
      convert: convertSpy,
      amountInBase: amountInBaseSpy,
    };

    await TestBed.configureTestingModule({
      imports: [RecurringBreakdownComponent, NoopAnimationsModule],
      providers: [{ provide: CurrencyService, useValue: mockCurrencyService }],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(RecurringBreakdownComponent, {
        set: { template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('recurring predicate', () => {
    it('counts a row with only recurringId set as recurring', () => {
      component.transactions = [txn({ id: 't1', recurringId: 'rt1', isRecurring: false })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(1);
      expect(component.oneOffCount()).toBe(0);
    });

    it('counts a row with only isRecurring: true as recurring', () => {
      component.transactions = [txn({ id: 't1', isRecurring: true })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(1);
      expect(component.oneOffCount()).toBe(0);
    });

    it('counts a row with neither flag as one-off', () => {
      component.transactions = [txn({ id: 't1', isRecurring: false })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(0);
      expect(component.oneOffCount()).toBe(1);
    });

    it('excludes income rows from both buckets', () => {
      component.transactions = [
        txn({ id: 't1', type: 'income', isRecurring: true }),
        txn({ id: 't2', type: 'income', recurringId: 'rt1' }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(0);
      expect(component.oneOffCount()).toBe(0);
      expect(component.hasExpenses()).toBeFalse();
    });
  });

  describe('shares', () => {
    it('splits shares 30% / 70% for recurring 30 + one-off 70', () => {
      component.transactions = [
        txn({ id: 't1', amount: 30, isRecurring: true }),
        txn({ id: 't2', amount: 70, isRecurring: false }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringTotal()).toBe(30);
      expect(component.oneOffTotal()).toBe(70);
      expect(component.recurringShare()).toBe(30);
      expect(component.oneOffShare()).toBe(70);
    });
  });

  describe('empty states', () => {
    it('is hasRecurring() false with oneOffTotal intact when no recurring expenses exist', () => {
      component.transactions = [
        txn({ id: 't1', amount: 40, isRecurring: false }),
        txn({ id: 't2', amount: 60, isRecurring: false }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.hasRecurring()).toBeFalse();
      expect(component.oneOffTotal()).toBe(100);
      expect(component.hasExpenses()).toBeTrue();
    });

    it('is hasExpenses() false when there are no expenses at all', () => {
      component.transactions = [];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.hasExpenses()).toBeFalse();
    });
  });

  // #429 P1: this card used to convert every past transaction at whatever
  // rate was loaded, so its totals could disagree with the same period's
  // report totals.
  describe('currency conversion', () => {
    it('reads the base-currency snapshot through CurrencyService.amountInBase', () => {
      amountInBaseSpy.and.callFake((t: Transaction) => t.amountInBaseCurrency * 2);
      const transaction = txn({ id: 't1', amount: 50, currency: 'EUR', isRecurring: true });
      component.transactions = [transaction];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringTotal()).toBe(100);
      expect(amountInBaseSpy).toHaveBeenCalledWith(transaction, 'USD');
      expect(convertSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * The cases above override the template to `<div></div>`, so the card's three
 * gates are unproven by them: `hasExpenses()` hides the whole card, and
 * `hasRecurring()` swaps the share bar and the recurring row for an empty
 * state. The share bar is also the one place the two percentages are used —
 * as inline widths — and nothing checks they add up on screen.
 */
describe('RecurringBreakdownComponent, through its own template', () => {
  let fixture: ComponentFixture<RecurringBreakdownComponent>;

  function render(transactions: Transaction[], currency = 'USD'): void {
    fixture.componentInstance.transactions = transactions;
    fixture.componentInstance.currency = currency;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const rows = () => Array.from(el().querySelectorAll('.breakdown-row')) as HTMLElement[];
  const cell = (row: HTMLElement, selector: string) =>
    row.querySelector(selector)?.textContent?.trim() ?? null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecurringBreakdownComponent, NoopAnimationsModule],
      providers: [
        {
          provide: CurrencyService,
          useValue: {
            convert: (amount: number) => amount,
            amountInBase: (t: Transaction) => t.amountInBaseCurrency,
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringBreakdownComponent);
  });

  it('renders nothing at all when there are no expenses', () => {
    render([expenseTxn({ type: 'income' })]);

    expect(el().querySelector('.recurring-breakdown')).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  it('splits the two rows with their counts, amounts and shares', () => {
    render([
      expenseTxn({ id: 'a', amount: 300, recurringId: 'r1' }),
      expenseTxn({ id: 'b', amount: 100 }),
    ]);

    expect(text('mat-card-title')).toBe('reports.recurringVsOneOff');
    const [recurring, oneOff] = rows();
    expect(cell(recurring, '.row-count')).toBe('(1)');
    expect(cell(recurring, '.row-amount')).toBe('$300.00');
    expect(cell(recurring, '.row-percentage')).toBe('75%');
    expect(cell(oneOff, '.row-count')).toBe('(1)');
    expect(cell(oneOff, '.row-amount')).toBe('$100.00');
    expect(cell(oneOff, '.row-percentage')).toBe('25%');
  });

  it('draws the share bar as two widths that fill it', () => {
    render([
      expenseTxn({ id: 'a', amount: 300, isRecurring: true }),
      expenseTxn({ id: 'b', amount: 100 }),
    ]);

    const recurringBar = el().querySelector('.share-bar-recurring') as HTMLElement;
    const oneOffBar = el().querySelector('.share-bar-oneoff') as HTMLElement;
    expect(recurringBar.style.width).toBe('75%');
    expect(oneOffBar.style.width).toBe('25%');
    // Decorative: the figures beside it are what a screen reader reads.
    expect(el().querySelector('.share-bar')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('swaps the recurring row for an empty state when nothing recurs', () => {
    render([expenseTxn({ id: 'b', amount: 100 })]);

    expect(el().querySelector('.share-bar')).toBeNull();
    expect(rows().length).toBe(1);
    const empty = el().querySelector('app-empty-state') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('reports.noRecurringExpenses');
    expect(empty.textContent).toContain('reports.noRecurringExpensesHint');
    expect(cell(rows()[0], '.row-amount')).toBe('$100.00');
  });

  it('formats the amounts in the currency it was given', () => {
    render([expenseTxn({ id: 'b', amount: 100 })], 'JPY');

    expect(cell(rows()[0], '.row-amount')).toBe('¥100.00');
  });
});
