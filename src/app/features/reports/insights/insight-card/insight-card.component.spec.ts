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
