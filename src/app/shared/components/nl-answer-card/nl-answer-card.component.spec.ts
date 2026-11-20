import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NlAnswerCardComponent } from './nl-answer-card.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AggregateAnswer, TransactionFilters } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';
import { createCategory, createTransaction } from '../../../core/services/testing/test-data';
import {
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
} from '../../../core/services/testing/painted-contrast';
import { accessibleName, holdsShownWords } from '../../../core/services/testing/axe';
import { catalogTranslator } from '../../../core/services/testing/catalog-translator';

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

  // A cold category signal, a deleted custom category and an id from another
  // device all reach the card as an id the catalog cannot name. The stub echoes
  // keys, so the fallback is the transaction list's Unknown key, never a
  // literal English word and never the catch-all's own name (ADR 0036).
  it('names a group the catalog lacks by the Unknown key, beside one it resolves', () => {
    render(sumAnswer({
      operation: 'topCategories',
      groups: [
        { categoryId: 'food', total: 80 },
        { categoryId: 'deleted-custom', total: 15 },
      ],
    }));
    const names = Array.from(
      fixture.nativeElement.querySelectorAll('.answer-groups li > span:first-child'),
      (el) => (el as HTMLElement).textContent?.trim());
    expect(names).toEqual(['Food & Drinks', 'common.unknownCategory']);
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

  /**
   * The saved answers stamp one card per expanded answer, and the search
   * dialog shows one live, so View matching transactions names the answer it
   * opens by what the card shows: what was asked for and over which period.
   * A count answer's label says what the button already says (Matching
   * transactions), so its name gives the period alone rather than the same
   * words twice. The name holds the words the button shows (WCAG 2.5.3), read
   * without regard to case in the reader's own locale.
   */
  const viewNames = {
    en: [
      'View matching transactions (Total spent, 2026-06-01 – 2026-06-30)',
      'View matching transactions (2026-07-01 – 2026-07-31)',
    ],
    ja: [
      '該当する取引を表示（支出合計、2026-06-01 – 2026-06-30）',
      '該当する取引を表示（2026-07-01 – 2026-07-31）',
    ],
    tc: [
      '查看符合的交易（支出總額，2026-06-01 – 2026-06-30）',
      '查看符合的交易（2026-07-01 – 2026-07-31）',
    ],
  } as const;
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`names View matching transactions by its answer and period, a count by its period, in ${locale}`, () => {
      const t = catalogTranslator(locale, { strict: true });
      const translation = TestBed.inject(TranslationService) as jasmine.SpyObj<TranslationService>;
      translation.t.and.callFake(catalogTranslator(locale));
      const shown = t('aiSearch.viewTransactions');
      const times = (text: string, words: string) =>
        text.toLocaleLowerCase().split(words.toLocaleLowerCase()).length - 1;
      const sum = sumAnswer();
      const count = sumAnswer({
        operation: 'count',
        value: 4,
        currency: undefined,
        transactionCount: 4,
        scope: { startDate: new Date(2026, 6, 1), endDate: new Date(2026, 6, 31) },
      });

      const nameOf = (answer: AggregateAnswer, period: string): string => {
        render(answer);
        const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        const name = accessibleName(button);
        expect(button.textContent).withContext('the button shows its words').toContain(shown);
        expect(name).withContext(`"${name}" names the period`).toContain(period);
        expect(holdsShownWords(name, shown, locale)).withContext(`"${name}" holds "${shown}" whole`).toBeTrue();
        return name;
      };
      const names = [nameOf(sum, '2026-06-01 – 2026-06-30'), nameOf(count, '2026-07-01 – 2026-07-31')];

      expect(names[0]).withContext(`"${names[0]}" names the answer`).toContain(t('aiSearch.answerSum'));
      const countLabel = t('aiSearch.answerCount');
      expect(times(names[1], countLabel))
        .withContext(`"${names[1]}" says "${countLabel}" no more often than the button does`)
        .toBe(times(shown, countLabel));
      expect(names).withContext('pinned').toEqual([...viewNames[locale]]);
      expect(names).toEqual([
        t('aiSearch.viewTransactionsFor', { answer: t('aiSearch.answerSum'), period: '2026-06-01 – 2026-06-30' }),
        t('aiSearch.viewTransactionsIn', { period: '2026-07-01 – 2026-07-31' }),
      ]);
    });
  }

  it('paints every secondary line at AA or better on the answer block, in both themes', () => {
    render(sumAnswer({
      operation: 'max',
      extremeTransaction: createTransaction({ description: 'Flight home' }),
    }), new Date(2026, 7, 6));
    const host = fixture.nativeElement as HTMLElement;
    const block = host.querySelector('.result-block') as HTMLElement;
    const lines = Array.from(
      host.querySelectorAll<HTMLElement>('.result-label, .answer-detail, .answer-scope, .answer-computed-at'));
    expect(lines.length).withContext('label, two details, scope and computed-at').toBe(5);

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        for (const line of lines) {
          expect(ratio(paintedColor(line), paintedBackground(block)))
            .withContext(`${theme} .${line.className} on the answer block`)
            .toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  });

  it('paints the empty answer at AA or better on the answer block, in both themes', () => {
    render(sumAnswer({ transactionCount: 0 }));
    const host = fixture.nativeElement as HTMLElement;
    const block = host.querySelector('.result-block') as HTMLElement;
    const empty = host.querySelector('.answer-empty') as HTMLElement;

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        expect(ratio(paintedColor(empty), paintedBackground(block)))
          .withContext(`${theme} empty answer on the answer block`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
