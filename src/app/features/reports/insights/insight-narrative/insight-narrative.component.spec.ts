import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { InsightNarrativeComponent } from './insight-narrative.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CategoryService } from '../../../../core/services/category.service';
import { CloudLLMProviderService } from '../../../../core/services/cloud-llm-provider.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { InsightFacts, User } from '../../../../models';
import { createUser } from '../../../../core/services/testing/test-data';

describe('InsightNarrativeComponent', () => {
  let component: InsightNarrativeComponent;
  let fixture: ComponentFixture<InsightNarrativeComponent>;
  let cloudLLM: jasmine.SpyObj<CloudLLMProviderService>;
  let hasProvider: ReturnType<typeof signal<boolean>>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  function facts(overrides: Partial<InsightFacts> = {}): InsightFacts {
    return {
      detectorVersion: 1,
      window: { start: '2026-01-01', end: '2026-06-30', months: ['2026-05', '2026-06'] },
      baseCurrency: 'USD',
      timeZone: 'Asia/Taipei',
      totals: { income: 4000, expense: 1200, balance: 2800, count: 20 },
      byCategory: [],
      recurring: {
        groups: [], groupCount: 2, declaredGroupCount: 1, detectedGroupCount: 1,
        totalMonthlyEquivalent: 50, declaredMonthlyEquivalent: 30,
        detectedMonthlyEquivalent: 20, newGroupCount: 0, increasedGroupCount: 0,
      },
      trends: [{
        categoryId: 'food_groceries',
        series: [100, 118],
        slopePerMonth: 18, meanMonthly: 109, relativeSlope: 0.16,
        firstHalfMean: 100, secondHalfMean: 118, changeRatio: 0.18,
        direction: 'rising', activeMonths: 2, windowShare: 0.4, transactionCount: 12,
      }],
      rhythms: {
        hasEnoughData: true, transactionCount: 20,
        weekdayWeekend: {
          weekdayTotal: 800, weekendTotal: 400, weekdayCount: 14, weekendCount: 6,
          weekdayDays: 22, weekendDays: 9,
          weekdayDailyAverage: 36.36, weekendDailyAverage: 44.44,
          ratio: 1.22, lean: 'weekend',
        },
        monthEnd: {
          tailDays: 5, tailTotal: 300, restTotal: 900, tailCount: 6, restCount: 14,
          tailDailyAverage: 60, restDailyAverage: 34.6, ratio: 1.73, isSpike: true,
        },
        payday: {
          basis: 'recurringIncome', paydayDayOfMonth: 25, windowDays: 3,
          postPaydayTotal: 400, otherTotal: 800, postPaydayCount: 6, otherCount: 14,
          postPaydayDailyAverage: 66, otherDailyAverage: 32, ratio: 2.06, isPresent: true,
        },
      },
      drip: {
        threshold: 4, count: 30, total: 105, monthlyAverage: 52.5,
        shareOfSpending: 0.0875, medianAmount: 3.5, byCategory: [],
        filterSafe: true, isNotable: true,
      },
      ...overrides,
    };
  }

  function build(input: InsightFacts | null, previous: InsightFacts | null = null): void {
    fixture = TestBed.createComponent(InsightNarrativeComponent);
    fixture.componentRef.setInput('facts', input);
    fixture.componentRef.setInput('previousFacts', previous);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const settled = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(async () => {
    sessionStorage.clear();
    hasProvider = signal(true);
    currentUser = signal<User | null>(createUser({
      preferences: { ...createUser().preferences, ragInsightsLevel: 'standard' },
    }));

    cloudLLM = jasmine.createSpyObj<CloudLLMProviderService>(
      'CloudLLMProviderService',
      ['generatePatternNarrative', 'getPreferredProvider'],
      { hasAnyCloudProvider: hasProvider });
    cloudLLM.generatePatternNarrative.and.returnValue(
      Promise.resolve('Your **groceries** rose 18%.'));
    cloudLLM.getPreferredProvider.and.returnValue('gemini');

    await TestBed.configureTestingModule({
      imports: [InsightNarrativeComponent],
      providers: [
        { provide: CloudLLMProviderService, useValue: cloudLLM },
        { provide: AuthService, useValue: { currentUser } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        {
          provide: TranslationService,
          useValue: { t: (key: string) => key, currentLocale: signal('en') },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(InsightNarrativeComponent, { set: { template: '<div></div>' } })
      .compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  describe('gating', () => {
    it('renders nothing with no provider configured', async () => {
      // The rule-based cards are the feature; this only ever sits on top.
      hasProvider.set(false);
      build(facts());
      await settled();

      expect(component.isAvailable()).toBeFalse();
      expect(cloudLLM.generatePatternNarrative).not.toHaveBeenCalled();
    });

    it('renders nothing when grounding is switched off', async () => {
      // ragInsightsLevel is the user's existing control over how much of their
      // data reaches a provider; detector output is grounding data.
      currentUser.set(createUser({
        preferences: { ...createUser().preferences, ragInsightsLevel: 'off' },
      }));
      build(facts());
      await settled();

      expect(component.isAvailable()).toBeFalse();
      expect(cloudLLM.generatePatternNarrative).not.toHaveBeenCalled();
    });

    it('generates when a provider is configured and grounding is on', async () => {
      build(facts());
      await settled();

      expect(component.isAvailable()).toBeTrue();
      expect(cloudLLM.generatePatternNarrative).toHaveBeenCalled();
      expect(component.narrative()).toContain('groceries');
    });

    it('does nothing without facts', async () => {
      build(null);
      await settled();
      expect(cloudLLM.generatePatternNarrative).not.toHaveBeenCalled();
    });
  });

  describe('what is sent', () => {
    it('sends aggregates and category names only', async () => {
      build(facts());
      await settled();

      const context = cloudLLM.generatePatternNarrative.calls.mostRecent().args[0];
      expect(context).toContain('Total spending: 1200');
      expect(context).toContain('food_groceries');
      expect(context).toContain('Recurring payments: 2');
    });

    it('never sends anything a person typed', async () => {
      build(facts());
      await settled();

      const context = cloudLLM.generatePatternNarrative.calls.mostRecent().args[0];
      for (const forbidden of ['txn', 'description', 'note', 'receipt', 'http']) {
        expect(context.toLowerCase()).not.toContain(forbidden);
      }
    });

    it('sends the per-month series only at the deep tier', async () => {
      build(facts());
      await settled();
      expect(cloudLLM.generatePatternNarrative.calls.mostRecent().args[0])
        .not.toContain('Monthly series');

      sessionStorage.clear();
      currentUser.set(createUser({
        preferences: { ...createUser().preferences, ragInsightsLevel: 'deep' },
      }));
      build(facts());
      await settled();
      expect(cloudLLM.generatePatternNarrative.calls.mostRecent().args[0])
        .toContain('Monthly series');
    });
  });

  describe('the diff short-circuit', () => {
    it('skips the request when nothing moved materially', async () => {
      const unchanged = facts();
      build(unchanged, facts());
      await settled();

      expect(cloudLLM.generatePatternNarrative).not.toHaveBeenCalled();
      expect(component.isUnchanged()).toBeTrue();
    });

    it('generates when something did move', async () => {
      const previous = facts({
        totals: { income: 4000, expense: 600, balance: 3400, count: 20 },
      });
      build(facts(), previous);
      await settled();

      expect(cloudLLM.generatePatternNarrative).toHaveBeenCalled();
      expect(component.isUnchanged()).toBeFalse();
    });
  });

  describe('caching', () => {
    it('serves a second identical render from the cache', async () => {
      build(facts());
      await settled();
      expect(cloudLLM.generatePatternNarrative).toHaveBeenCalledTimes(1);

      build(facts());
      await settled();
      expect(cloudLLM.generatePatternNarrative).toHaveBeenCalledTimes(1);
    });

    it('regenerates after the cache is discarded', async () => {
      build(facts());
      await settled();
      component.regenerate();
      await settled();
      expect(cloudLLM.generatePatternNarrative).toHaveBeenCalledTimes(2);
    });

    it('never caches a failure', async () => {
      cloudLLM.generatePatternNarrative.and.returnValue(
        Promise.reject(new Error('429 rate limit exceeded')));
      build(facts());
      await settled();
      expect(component.errorKey()).toBe('ai.rateLimited');

      cloudLLM.generatePatternNarrative.and.returnValue(Promise.resolve('Recovered.'));
      build(facts());
      await settled();
      expect(component.narrative()).toBe('Recovered.');
    });
  });

  describe('failures', () => {
    it('maps an invalid key', async () => {
      cloudLLM.generatePatternNarrative.and.returnValue(
        Promise.reject(new Error('API key not valid')));
      build(facts());
      await settled();
      expect(component.errorKey()).toBe('ai.invalidApiKey');
    });

    it('falls back to a generic message', async () => {
      cloudLLM.generatePatternNarrative.and.returnValue(
        Promise.reject(new Error('socket hang up')));
      build(facts());
      await settled();
      expect(component.errorKey()).toBe('ai.summaryUnavailable');
      expect(component.isLoading()).toBeFalse();
    });
  });

  describe('rendering', () => {
    it('renders the markdown subset', async () => {
      build(facts());
      await settled();
      expect(String(component.formatted())).toContain('<strong>groceries</strong>');
    });

    it('sanitises rather than trusting suspicious output', async () => {
      cloudLLM.generatePatternNarrative.and.returnValue(
        Promise.resolve('<script>alert(1)</script>'));
      build(facts());
      await settled();
      expect(String(component.formatted())).not.toContain('<script');
    });
  });
});
