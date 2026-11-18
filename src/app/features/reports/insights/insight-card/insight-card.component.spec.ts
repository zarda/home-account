import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Router } from '@angular/router';
import { InsightCardComponent } from './insight-card.component';
import { CategoryService } from '../../../../core/services/category.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { PendingFiltersService } from '../../../../core/services/pending-filters.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightCard, Transaction } from '../../../../models';
import { createCategory, createTransaction } from '../../../../core/services/testing/test-data';
import {
  TranslationStub,
  accessibleName,
  catalogTranslationStub,
  catalogTranslator,
  createTranslationStub,
  holdsShownWords,
  provideNoMotion,
} from '../../../../core/services/testing';

describe('InsightCardComponent', () => {
  let component: InsightCardComponent;
  let fixture: ComponentFixture<InsightCardComponent>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;

  function card(overrides: Partial<InsightCard> = {}): InsightCard {
    return {
      id: 'categoryTrend:food_groceries',
      kind: 'categoryTrend',
      titleKey: 'insights.trendRisingTitle',
      bodyKey: 'insights.trendRisingBody',
      params: { months: 6, percent: 18, share: 40 },
      metrics: { secondHalfMean: 118, firstHalfMean: 100 },
      categoryIds: ['food_groceries'],
      transactionCount: 24,
      drillDown: {
        mode: 'filters',
        filters: {
          type: 'expense',
          categoryId: 'food_groceries',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
        },
      },
      weight: 70,
      ...overrides,
    };
  }

  function build(input: InsightCard, lookup = new Map<string, Transaction>()): void {
    fixture = TestBed.createComponent(InsightCardComponent);
    fixture.componentRef.setInput('card', input);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('lookup', lookup);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    pendingFilters = jasmine.createSpyObj<PendingFiltersService>(
      'PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [InsightCardComponent],
      providers: [
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        {
          provide: CategoryService,
          useValue: {
            categories: signal([
              createCategory({ id: 'food_groceries', name: 'categoryNames.groceries' }),
            ]),
          },
        },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (a: number, c: string) => `${c} ${a.toFixed(2)}` },
        },
        {
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, unknown>) =>
              params ? `${key}|${JSON.stringify(params)}` : key,
          },
        },
        provideNoMotion(),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(InsightCardComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  describe('rendering', () => {
    it('resolves the category name into the body params', () => {
      build(card());
      // The card stores an id; the renderer injects the localised name, so the
      // stored form stays locale-free.
      expect(component.body()).toContain('categoryNames.groceries');
    });

    it('names a category the catalog lacks in the reader\'s language, not by its id', () => {
      // A deleted category, or an id written on another device, must not print
      // its raw id in the card's sentence.
      build(card({ categoryIds: ['gone'] }));
      expect(component.body()).toContain('"category":"common.unknownCategory"');
      expect(component.body()).not.toContain('"category":"gone"');
    });

    it('resolves a cadence into a localised word', () => {
      build(card({
        kind: 'recurringItem',
        titleKey: 'insights.recurringIncreasedTitle',
        bodyKey: 'insights.recurringIncreasedBody',
        params: { cadence: 'monthly', occurrences: 6 },
        metrics: { monthlyEquivalent: 15.99 },
        drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: false },
      }));
      expect(component.body()).toContain('insights.cadenceMonthly');
      expect(component.body()).not.toContain('"cadence":"monthly"');
    });

    it('features the metric the kind calls for', () => {
      build(card());
      expect(component.headline()).toEqual({
        label: 'insights.recentMonthlyAverage',
        value: 118,
      });
    });

    it('picks an icon per kind', () => {
      build(card());
      expect(component.icon()).toBe('show_chart');
    });
  });

  describe('unknown kinds', () => {
    it('falls back to a generic rendering rather than a blank card', () => {
      // A snapshot written by a newer build can name a kind this version has
      // never heard of; it must still render.
      build(card({
        kind: 'somethingNew' as InsightCard['kind'],
        titleKey: 'insights.futureTitle',
        bodyKey: 'insights.futureBody',
        metrics: { total: 42, ignored: null },
      }));
      expect(component.isUnknownKind()).toBeTrue();
      expect(component.icon()).toBe('lightbulb');
      expect(component.metricEntries()).toEqual([['total', 42]]);
    });

    it('treats a known kind as known', () => {
      build(card());
      expect(component.isUnknownKind()).toBeFalse();
    });
  });

  describe('filters drill-down', () => {
    it('hands the filters over and navigates', () => {
      build(card());
      component.openFilters();

      expect(pendingFilters.apply).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
    });

    it('converts the stored ISO dates back into Dates', () => {
      build(card());
      component.openFilters();

      const filters = pendingFilters.apply.calls.mostRecent().args[0];
      expect(filters.startDate instanceof Date).toBeTrue();
      expect(filters.startDate?.getFullYear()).toBe(2026);
      expect(filters.categoryId).toBe('food_groceries');
    });

    // Day keys mean local calendar days. Revived as UTC midnight they skew
    // by the zone offset: west of UTC the window loses its whole last day,
    // east of UTC it swallows the previous evening. Green only at offset 0,
    // which is why this file runs under both offsets in CI (test:dates).
    it('revives day-key bounds as local dates covering the whole window', () => {
      build(card());
      component.openFilters();

      const filters = pendingFilters.apply.calls.mostRecent().args[0];
      expect(filters.startDate).toEqual(new Date(2026, 0, 1));
      expect(filters.endDate).toEqual(new Date(2026, 5, 30));
    });

    it('omits filter keys the card did not carry', () => {
      build(card());
      component.openFilters();

      const filters = pendingFilters.apply.calls.mostRecent().args[0];
      expect('minAmount' in filters).toBeFalse();
      expect('currency' in filters).toBeFalse();
    });

    it('does nothing for a card with no filters', () => {
      build(card({ drillDown: { mode: 'none' } }));
      component.openFilters();
      expect(pendingFilters.apply).not.toHaveBeenCalled();
      expect(component.canOpenFilters()).toBeFalse();
    });
  });

  describe('inline drill-down', () => {
    const rows = new Map<string, Transaction>([
      ['t1', createTransaction({ id: 't1' })],
    ]);

    it('toggles the row list', () => {
      build(card({
        drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: false },
      }), rows);

      expect(component.canShowRows()).toBeTrue();
      expect(component.showRows()).toBeFalse();
      component.toggleRows();
      expect(component.showRows()).toBeTrue();
    });

    it('exposes the truncation flag', () => {
      build(card({
        drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: true },
      }), rows);
      expect(component.inlineTruncated()).toBeTrue();
    });

    it('cannot expand an archived card, whose ids were never stored', () => {
      fixture = TestBed.createComponent(InsightCardComponent);
      fixture.componentRef.setInput('card', card({ drillDown: { mode: 'none' } }));
      fixture.componentRef.setInput('currency', 'USD');
      fixture.componentRef.setInput('archived', true);
      component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component.canShowRows()).toBeFalse();
    });
  });
});

/**
 * The cases above override the template to `<div></div>`, so they prove the
 * computeds and leave the card's five gates unproven: the unknown-kind
 * fallback that stops old history rendering blank, the headline stat card,
 * the category line, the inline row list, and the actions bar that only
 * exists when at least one of its two buttons does.
 */
describe('InsightCardComponent, through its own template', () => {
  let fixture: ComponentFixture<InsightCardComponent>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;
  let translation: TranslationStub;

  function render(
    input: InsightCard,
    lookup = new Map<string, Transaction>(),
    archived = false,
  ): void {
    fixture.componentRef.setInput('card', input);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('lookup', lookup);
    fixture.componentRef.setInput('archived', archived);
    fixture.detectChanges();
  }

  function insight(overrides: Partial<InsightCard> = {}): InsightCard {
    return {
      id: 'categoryTrend:food_groceries',
      kind: 'categoryTrend',
      titleKey: 'insights.trendRisingTitle',
      bodyKey: 'insights.trendRisingBody',
      params: { months: 6, percent: 18, share: 40 },
      metrics: { secondHalfMean: 118, firstHalfMean: 100 },
      categoryIds: ['food_groceries'],
      transactionCount: 24,
      drillDown: {
        mode: 'filters',
        filters: { type: 'expense', categoryId: 'food_groceries', startDate: '2026-01-01', endDate: '2026-06-30' },
      },
      weight: 70,
      ...overrides,
    };
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const action = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('.card-actions button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  beforeEach(async () => {
    pendingFilters = jasmine.createSpyObj<PendingFiltersService>('PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    translation = createTranslationStub();

    await TestBed.configureTestingModule({
      imports: [InsightCardComponent],
      providers: [
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        {
          provide: CategoryService,
          useValue: {
            categories: signal([
              createCategory({ id: 'food_groceries', name: 'categoryNames.groceries' }),
              createCategory({ id: 'restaurants', name: 'categoryNames.restaurants' }),
              createCategory({ id: 'subscriptions', name: 'categoryNames.subscriptions' }),
            ]),
          },
        },
        {
          provide: CurrencyService,
          useValue: { formatCurrency: (a: number, c: string) => `${c} ${a.toFixed(2)}` },
        },
        { provide: TranslationService, useValue: translation },
        provideNoMotion(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InsightCardComponent);
  });

  it('heads the card with the kind\'s icon and its translated title', () => {
    render(insight());

    expect(text('.card-icon')).toBe('show_chart');
    expect(text('mat-card-title')).toBe('insights.trendRisingTitle');
    expect(text('.card-body')).toContain('insights.trendRisingBody');
  });

  it('always says how many transactions the card stands on', () => {
    render(insight({ transactionCount: 24 }));

    expect(text('.card-basis')).toBe('insights.basedOnCount:{"count":24}');
  });

  it('renders the headline figure as a stat card in the card\'s currency', () => {
    render(insight());

    const headline = el().querySelector('app-stat-card.card-headline') as HTMLElement;
    expect(headline).not.toBeNull();
    expect(headline.textContent).toContain('USD 118.00');
  });

  it('falls back to the raw metrics rather than blank for a kind it does not know', () => {
    render(insight({ kind: 'somethingNewer' as InsightCard['kind'] }));

    expect(text('.card-body')).toBe('insights.unknownKind');
    expect(text('.card-icon')).toBe('lightbulb');
    const rows = Array.from(el().querySelectorAll('.metric-row')).map(r => r.textContent?.trim());
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('secondHalfMean');
    expect(rows[0]).toContain('USD 118.00');
    expect(el().querySelector('app-stat-card')).toBeNull();
  });

  // No body sentence names its category, and up to three trend cards share a
  // title, so the card names the category it is about, one or several.
  it('names the category the card is about, and each of several', () => {
    render(insight());
    expect(text('.card-categories')).toBe('categoryNames.groceries');

    render(insight({ categoryIds: ['food_groceries', 'transport'] }));
    expect(text('.card-categories')).toBe('categoryNames.groceries, common.unknownCategory');

    render(insight({ categoryIds: [] }));
    expect(el().querySelector('.card-categories')).toBeNull();
  });

  it('offers the filters button for a filters card and hands them over on click', () => {
    render(insight());

    expect(action('insights.viewTransactions')).toBeDefined();
    expect(action('insights.showTransactions')).toBeUndefined();

    action('insights.viewTransactions')?.click();

    expect(pendingFilters.apply).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
  });

  it('expands and collapses the inline rows from its own toggle', () => {
    render(insight({ drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: false } }));

    expect(action('insights.viewTransactions')).toBeUndefined();
    expect(el().querySelector('app-insight-transaction-list')).toBeNull();

    const toggle = action('insights.showTransactions') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();

    expect(el().querySelector('app-insight-transaction-list')).not.toBeNull();
    const collapse = action('insights.hideTransactions') as HTMLButtonElement;
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    collapse.click();
    fixture.detectChanges();

    expect(el().querySelector('app-insight-transaction-list')).toBeNull();
  });

  it('drops the actions bar entirely when an archived card can offer neither', () => {
    render(insight({ drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: false } }), new Map(), true);

    expect(el().querySelector('.card-actions')).toBeNull();
  });

  /**
   * The insights tab stamps one card per insight, and the cards of one kind
   * share a few titles: up to three category trends read Rising, Falling or
   * Newly active, and up to three recurring payments read A new recurring
   * payment or A recurring payment went up. So a card's View transactions and
   * its show and hide toggle name the insight by its title and by what tells
   * it from the others of its kind: the category it is about, and for a
   * recurring payment its figure per month as well, since two can share a
   * category. A card the tab shows once, a habit's, is named by its title.
   * Each name holds the words its button shows at that moment (WCAG 2.5.3),
   * read without regard to case in the reader's own locale: the toggle's name
   * follows its words from Show to Hide, and aria-expanded says which. The
   * catalog stub goes in before the first render, so the pipe never caches an
   * echoed key.
   */
  const actionNames = {
    en: ['View transactions: Rising (Groceries)', 'Show transactions: Month-end spike', 'Hide transactions: Month-end spike'],
    ja: ['「増加傾向」（食料品）の取引を表示', '「月末に増える傾向」の取引を表示', '「月末に増える傾向」の取引を隠す'],
    tc: ['查看交易：「上升中」（雜貨）', '顯示交易：「月底出現高峰」', '隱藏交易：「月底出現高峰」'],
  } as const;
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`names its View transactions and its toggle by the insight's title and category in ${locale}`, () => {
      const t = catalogTranslator(locale, { strict: true });
      Object.assign(translation, catalogTranslationStub(locale));
      const actions = () => Array.from(el().querySelectorAll<HTMLButtonElement>('.card-actions button'));
      const read: string[] = [];
      const expectNamed = (shownKey: string, titleKey: string) => {
        const buttons = actions();
        expect(buttons.length).withContext(`one action for ${shownKey}`).toBe(1);
        const shown = t(shownKey);
        const name = accessibleName(buttons[0]);
        expect(buttons[0].textContent).withContext(`${shownKey} shows its words`).toContain(shown);
        expect(name).withContext(`"${name}" names the insight`).toContain(t(titleKey));
        expect(holdsShownWords(name, shown, locale)).withContext(`"${name}" holds "${shown}" whole`).toBeTrue();
        read.push(name);
      };

      render(insight());
      expectNamed('insights.viewTransactions', 'insights.trendRisingTitle');

      render(insight({
        id: 'habitMonthEnd',
        kind: 'habitMonthEnd',
        titleKey: 'insights.monthEndTitle',
        bodyKey: 'insights.monthEndBody',
        categoryIds: [],
        drillDown: { mode: 'inline', transactionIds: ['t1'], truncated: false },
      }));
      expectNamed('insights.showTransactions', 'insights.monthEndTitle');
      actions()[0].click();
      fixture.detectChanges();
      expect(actions()[0].getAttribute('aria-expanded')).toBe('true');
      expectNamed('insights.hideTransactions', 'insights.monthEndTitle');

      expect(read).withContext('pinned').toEqual([...actionNames[locale]]);
      expect(read).toEqual([
        t('insights.viewTransactionsNamedWith', {
          name: t('insights.trendRisingTitle'),
          detail: t('categoryNames.groceries'),
        }),
        t('insights.showTransactionsNamed', { name: t('insights.monthEndTitle') }),
        t('insights.hideTransactionsNamed', { name: t('insights.monthEndTitle') }),
      ]);
    });
  }

  /**
   * The tab's own repeats, one card after another: two Rising trends, one per
   * category, and two new recurring payments in one category at different
   * figures. No two of them may share a name.
   */
  const twinNames = {
    en: [
      'View transactions: Rising (Groceries)',
      'View transactions: Rising (Restaurants)',
      'Show transactions: A new recurring payment (Subscriptions, USD 15.99 per month)',
      'Show transactions: A new recurring payment (Subscriptions, USD 9.99 per month)',
      'Hide transactions: A new recurring payment (Subscriptions, USD 9.99 per month)',
    ],
    ja: [
      '「増加傾向」（食料品）の取引を表示',
      '「増加傾向」（レストラン）の取引を表示',
      '「新しい定期的な支払い」（サブスクリプション、1か月あたりUSD 15.99）の取引を表示',
      '「新しい定期的な支払い」（サブスクリプション、1か月あたりUSD 9.99）の取引を表示',
      '「新しい定期的な支払い」（サブスクリプション、1か月あたりUSD 9.99）の取引を隠す',
    ],
    tc: [
      '查看交易：「上升中」（雜貨）',
      '查看交易：「上升中」（餐廳）',
      '顯示交易：「新的定期支出」（訂閱服務，每月 USD 15.99）',
      '顯示交易：「新的定期支出」（訂閱服務，每月 USD 9.99）',
      '隱藏交易：「新的定期支出」（訂閱服務，每月 USD 9.99）',
    ],
  } as const;
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`tells two cards of one kind and title apart in ${locale}`, () => {
      const t = catalogTranslator(locale, { strict: true });
      Object.assign(translation, catalogTranslationStub(locale));
      const stamp = (input: InsightCard): ComponentFixture<InsightCardComponent> => {
        const copy = TestBed.createComponent(InsightCardComponent);
        copy.componentRef.setInput('card', input);
        copy.componentRef.setInput('currency', 'USD');
        copy.detectChanges();
        return copy;
      };
      const trend = (categoryId: string) =>
        insight({
          id: `categoryTrend:${categoryId}`,
          categoryIds: [categoryId],
          drillDown: {
            mode: 'filters',
            filters: { type: 'expense', categoryId, startDate: '2026-01-01', endDate: '2026-06-30' },
          },
        });
      const recurring = (key: string, monthlyEquivalent: number) =>
        insight({
          id: `recurringItem:${key}`,
          kind: 'recurringItem',
          titleKey: 'insights.recurringNewTitle',
          bodyKey: 'insights.recurringNewBody',
          params: { cadence: 'monthly', occurrences: 3 },
          metrics: { medianAmount: monthlyEquivalent, monthlyEquivalent },
          categoryIds: ['subscriptions'],
          transactionCount: 3,
          drillDown: { mode: 'inline', transactionIds: [`${key}-1`], truncated: false },
        });
      const actionOf = (card: ComponentFixture<InsightCardComponent>) => {
        const buttons = (card.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.card-actions button');
        expect(buttons.length).withContext('one action per card').toBe(1);
        return buttons[0];
      };
      const expectHolds = (button: HTMLButtonElement, shownKey: string): string => {
        const shown = t(shownKey);
        const name = accessibleName(button);
        expect(button.textContent).withContext(`${shownKey} shows its words`).toContain(shown);
        expect(holdsShownWords(name, shown, locale)).withContext(`"${name}" holds "${shown}" whole`).toBeTrue();
        return name;
      };
      // A new fixture takes the previous one out of the document, so each
      // card is read while it is the one on the page.
      const read: string[] = [];
      const readCard = (input: InsightCard, shownKey: string) => {
        const card = stamp(input);
        read.push(expectHolds(actionOf(card), shownKey));
        return card;
      };
      readCard(trend('food_groceries'), 'insights.viewTransactions');
      readCard(trend('restaurants'), 'insights.viewTransactions');
      readCard(recurring('music', 15.99), 'insights.showTransactions');
      const video = readCard(recurring('video', 9.99), 'insights.showTransactions');

      expect(new Set(read).size).withContext(`no two of ${JSON.stringify(read)} alike`).toBe(4);
      expect(read[0]).withContext('the first trend names its category').toContain(t('categoryNames.groceries'));
      expect(read[1]).withContext('the second trend names its category').toContain(t('categoryNames.restaurants'));
      expect(read[2]).withContext('the first payment names its figure').toContain('USD 15.99');
      expect(read[3]).withContext('the second payment names its figure').toContain('USD 9.99');

      actionOf(video).click();
      video.detectChanges();
      read.push(expectHolds(actionOf(video), 'insights.hideTransactions'));

      expect(read).withContext('pinned').toEqual([...twinNames[locale]]);
      const payment = (amount: string) =>
        t('insights.recurringItemDetail', { category: t('categoryNames.subscriptions'), amount });
      expect(read).toEqual([
        t('insights.viewTransactionsNamedWith', { name: t('insights.trendRisingTitle'), detail: t('categoryNames.groceries') }),
        t('insights.viewTransactionsNamedWith', { name: t('insights.trendRisingTitle'), detail: t('categoryNames.restaurants') }),
        t('insights.showTransactionsNamedWith', { name: t('insights.recurringNewTitle'), detail: payment('USD 15.99') }),
        t('insights.showTransactionsNamedWith', { name: t('insights.recurringNewTitle'), detail: payment('USD 9.99') }),
        t('insights.hideTransactionsNamedWith', { name: t('insights.recurringNewTitle'), detail: payment('USD 9.99') }),
      ]);
    });
  }
});
