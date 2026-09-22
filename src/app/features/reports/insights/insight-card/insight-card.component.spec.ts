import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InsightCardComponent } from './insight-card.component';
import { CategoryService } from '../../../../core/services/category.service';
import { PendingFiltersService } from '../../../../core/services/pending-filters.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightCard, Transaction } from '../../../../models';
import { createCategory, createTransaction } from '../../../../core/services/testing/test-data';
import { createTranslationStub } from '../../../../core/services/testing';

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
      imports: [InsightCardComponent, NoopAnimationsModule],
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
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, unknown>) =>
              params ? `${key}|${JSON.stringify(params)}` : key,
          },
        },
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
 * the multi-category line, the inline row list, and the actions bar that only
 * exists when at least one of its two buttons does.
 */
describe('InsightCardComponent, through its own template', () => {
  let fixture: ComponentFixture<InsightCardComponent>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;

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

    await TestBed.configureTestingModule({
      imports: [InsightCardComponent, NoopAnimationsModule],
      providers: [
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        {
          provide: CategoryService,
          useValue: {
            categories: signal([createCategory({ id: 'food_groceries', name: 'categoryNames.groceries' })]),
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
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
    expect(headline.textContent).toContain('$118.00');
  });

  it('falls back to the raw metrics rather than blank for a kind it does not know', () => {
    render(insight({ kind: 'somethingNewer' as InsightCard['kind'] }));

    expect(text('.card-body')).toBe('insights.unknownKind');
    expect(text('.card-icon')).toBe('lightbulb');
    const rows = Array.from(el().querySelectorAll('.metric-row')).map(r => r.textContent?.trim());
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('secondHalfMean');
    expect(rows[0]).toContain('$118.00');
    expect(el().querySelector('app-stat-card')).toBeNull();
  });

  it('names the categories only when there is more than one', () => {
    render(insight());
    expect(el().querySelector('.card-categories')).toBeNull();

    render(insight({ categoryIds: ['food_groceries', 'transport'] }));
    expect(text('.card-categories')).toBe('categoryNames.groceries, transport');
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
});
