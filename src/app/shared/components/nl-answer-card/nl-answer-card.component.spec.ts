import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NlAnswerCardComponent } from './nl-answer-card.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AggregateAnswer, TransactionFilters } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';
import { createCategory, createTransaction } from '../../../core/services/testing/test-data';

describe('NlAnswerCardComponent', () => {
  let fixture: ComponentFixture<NlAnswerCardComponent>;

  const sumAnswer = (overrides: Partial<AggregateAnswer> = {}): AggregateAnswer => ({
    operation: 'sum',
    value: 123.4,
    currency: 'USD',
    transactionCount: 7,
    scope: { startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) },
    ...overrides,
  });

  function render(answer: AggregateAnswer, computedAt: Date | null = null): void {
    fixture.componentRef.setInput('answer', answer);
    fixture.componentRef.setInput('computedAt', computedAt);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    const categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    ]);
    const currencyService = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currencyService.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount.toFixed(2)}`);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);
    // Local parts, not toISOString(): the assertion names the local calendar
    // date and must not shift a day depending on the runner's timezone.
    const dateFormatService = jasmine.createSpyObj('DateFormatService', ['formatDate']);
    dateFormatService.formatDate.and.callFake((d: Date) => dayKey(d));

    await TestBed.configureTestingModule({
      imports: [NlAnswerCardComponent],
      providers: [
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: DateFormatService, useValue: dateFormatService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NlAnswerCardComponent);
  });

  it('renders a money answer with its label, value, match count and period', () => {
    render(sumAnswer());
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('aiSearch.answerSum');
    expect(text).toContain('USD 123.40');
    expect(text).toContain('aiSearch.matchCount');
    expect(text).toContain('2026-06-01');
  });

  it('renders a count as a bare number', () => {
    render(sumAnswer({ operation: 'count', value: 4, currency: undefined, transactionCount: 4 }));
    const value = fixture.nativeElement.querySelector('.answer-value');
    expect(value.textContent.trim()).toBe('4');
  });

  it('renders top-category groups with resolved names', () => {
    render(sumAnswer({
      operation: 'topCategories',
      groups: [
        { categoryId: 'food', total: 80 },
        { categoryId: 'transport', total: 40 },
      ],
    }));
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.answer-groups li'),
      (el) => (el as HTMLElement).textContent);
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Food & Drinks');
    expect(rows[0]).toContain('USD 80.00');
  });

  it('shows the empty state instead of a number when nothing matched', () => {
    render(sumAnswer({ transactionCount: 0 }));
    expect(fixture.nativeElement.querySelector('.answer-empty')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.answer-value')).toBeNull();
  });

  it('shows the extreme row only when the answer carries one', () => {
    render(sumAnswer({
      operation: 'max',
      extremeTransaction: createTransaction({ description: 'Flight home' }),
    }));
    expect(fixture.nativeElement.textContent).toContain('Flight home');

    // A reopened snapshot holds only the row's id; the detail line must
    // simply be absent rather than rendering a blank.
    render(sumAnswer({ operation: 'max' }));
    expect(fixture.nativeElement.textContent).not.toContain('Flight home');
  });

  it('labels a snapshot with its computed-at date and hides the label live', () => {
    render(sumAnswer(), new Date(2026, 7, 6));
    expect(fixture.nativeElement.textContent).toContain('aiSearch.historyComputedAt');

    render(sumAnswer(), null);
    expect(fixture.nativeElement.textContent).not.toContain('aiSearch.historyComputedAt');
  });

  it('emits the answer scope when view-transactions is clicked', () => {
    const answer = sumAnswer();
    render(answer);
    let emitted: TransactionFilters | undefined;
    fixture.componentInstance.viewTransactions.subscribe((scope: TransactionFilters) => {
      emitted = scope;
    });

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();

    expect(emitted).toBe(answer.scope);
  });
});
