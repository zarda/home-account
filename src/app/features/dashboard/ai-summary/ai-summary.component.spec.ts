import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AiSummaryComponent } from './ai-summary.component';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryService } from '../../../core/services/category.service';
import { RagContextService } from '../../../core/services/rag-context.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { Category, Goal, RAG_TIER_CONFIGS, Transaction, User } from '../../../models';
import { createCategory, createTransaction, createUser } from '../../../core/services/testing';

describe('AiSummaryComponent', () => {
  let cloudLLM: jasmine.SpyObj<CloudLLMProviderService>;
  let ragContext: jasmine.SpyObj<RagContextService>;
  let currency: jasmine.SpyObj<CurrencyService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let categories: ReturnType<typeof signal<Category[]>>;

  function build() {
    const fixture = TestBed.createComponent(AiSummaryComponent);
    return fixture;
  }

  /**
   * Typed view of the private surface these tests drive.
   *
   * Declared rather than cast inline per call site: an inline `as unknown as`
   * compiles against any shape, so when loadInsights gained its key parameter
   * every one of them would have gone on passing undefined silently.
   */
  interface Internals {
    cacheKey(): string;
    loadInsights(transactions: Transaction[], period: string, key: string): Promise<void>;
    generation: number;
  }

  const internals = (component: AiSummaryComponent): Internals =>
    component as unknown as Internals;

  beforeEach(async () => {
    sessionStorage.clear();
    cloudLLM = jasmine.createSpyObj('CloudLLMProviderService', [
      'hasAnyCloudProvider',
      'generateSpendingSummary',
      'getFinancialAdvice',
    ]);
    cloudLLM.hasAnyCloudProvider.and.returnValue(true);
    cloudLLM.generateSpendingSummary.and.resolveTo('Summary text');
    cloudLLM.getFinancialAdvice.and.resolveTo('Advice text');

    currency = jasmine.createSpyObj('CurrencyService', ['convert', 'ensureRatesLoaded']);
    currency.convert.and.callFake((a: number) => a);
    currency.ensureRatesLoaded.and.resolveTo(undefined);
    const translation = jasmine.createSpyObj('TranslationService', ['t', 'currentLocale']);
    translation.t.and.callFake((k: string) => k);
    translation.currentLocale.and.returnValue('en');
    ragContext = jasmine.createSpyObj('RagContextService', ['buildSummaryGrounding']);
    ragContext.buildSummaryGrounding.and.returnValue('GROUNDING');
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackAiAssistUsed']);
    currentUser = signal<User | null>(createUser());
    categories = signal<Category[]>([createCategory()]);
    const sanitizer = jasmine.createSpyObj('DomSanitizer', ['sanitize', 'bypassSecurityTrustHtml']);
    sanitizer.sanitize.and.callFake((_ctx: number, val: string) => `sanitized:${val}`);
    sanitizer.bypassSecurityTrustHtml.and.callFake((val: string) => val);

    await TestBed.configureTestingModule({
      imports: [AiSummaryComponent],
      providers: [
        { provide: CloudLLMProviderService, useValue: cloudLLM },
        { provide: CurrencyService, useValue: currency },
        { provide: TranslationService, useValue: translation },
        { provide: AuthService, useValue: { currentUser } },
        { provide: CategoryService, useValue: { categories } },
        { provide: RagContextService, useValue: ragContext },
        { provide: DomSanitizer, useValue: sanitizer },
        { provide: AnalyticsService, useValue: analytics },
      ],
    })
      .overrideComponent(AiSummaryComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

  // beforeEach clears; without this the last test's keys survive into whatever
  // spec file Karma runs next.
  afterEach(() => sessionStorage.clear());

  it('should create', () => {
    expect(build().componentInstance).toBeTruthy();
  });

  it('exposes availability and data-sufficiency signals', () => {
    const fixture = build();
    const component = fixture.componentInstance;
    expect(component.isAvailable()).toBeTrue();
    expect(component.hasEnoughData()).toBeFalse();
    fixture.componentRef.setInput('transactions', [
      createTransaction(), createTransaction(), createTransaction(),
    ]);
    expect(component.hasEnoughData()).toBeTrue();
  });

  describe('formatMarkdown', () => {
    it('converts headers, emphasis and lists to HTML', () => {
      const html = build().componentInstance.formatMarkdown(
        '## Heading\n**bold** and *italic*\n- one\n- two\nplain',
      ) as string;
      expect(html).toContain('<h2 class="markdown-h2">Heading</h2>');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
      expect(html).toContain('<ul class="markdown-list">');
      expect(html).toContain('<li>one</li>');
      expect(html).toContain('<p>plain</p>');
    });

    it('sanitizes content with potential XSS instead of trusting it', () => {
      const result = build().componentInstance.formatMarkdown('<script>alert(1)</script>') as string;
      expect(result).toBe('sanitized:<script>alert(1)</script>');
    });
  });

  describe('private helpers', () => {
    it('formatPeriod maps known keys and passes through custom labels', () => {
      const c = build().componentInstance as unknown as { formatPeriod: (p: string) => string };
      expect(c.formatPeriod('thisMonth')).toBe('this month');
      expect(c.formatPeriod('last3Months')).toBe('the last 3 months');
      expect(c.formatPeriod('Jan 2024')).toBe('Jan 2024');
    });

    it('calculatePeriodTotal aggregates income, expense and categories', () => {
      const fixture = build();
      fixture.componentRef.setInput('baseCurrency', 'USD');
      const c = fixture.componentInstance as unknown as {
        calculatePeriodTotal: (t: Transaction[]) => { income: number; expense: number; balance: number };
      };
      const total = c.calculatePeriodTotal([
        createTransaction({ type: 'income', amount: 100 }),
        createTransaction({ type: 'expense', amount: 40, categoryId: 'a' }),
        createTransaction({ type: 'expense', amount: 10, categoryId: 'a' }),
      ]);
      expect(total.income).toBe(100);
      expect(total.expense).toBe(50);
      expect(total.balance).toBe(50);
    });

    it('describeFailure maps known error causes to localized keys', () => {
      const c = build().componentInstance as unknown as {
        describeFailure: (e: unknown, k?: string) => string;
      };
      expect(c.describeFailure(new Error('API key not valid'))).toBe('ai.invalidApiKey');
      expect(c.describeFailure(new Error('429 rate limit exceeded'))).toBe('ai.rateLimited');
      expect(c.describeFailure(new Error('other'), 'ai.adviceFallback')).toBe('ai.adviceFallback');
    });
  });

  describe('insight generation', () => {
    const txns = [createTransaction(), createTransaction(), createTransaction()];

    /** One full load, keyed the way the effect keys it. */
    async function generate(component: AiSummaryComponent) {
      const it = internals(component);
      await it.loadInsights(txns, 'thisMonth', it.cacheKey());
    }

    it('populates summary and advice and caches successful results', async () => {
      const component = build().componentInstance;
      await generate(component);
      expect(component.summary()).toBe('Summary text');
      expect(component.advice()).toBe('Advice text');
      expect(component.isLoading()).toBeFalse();
      // Second run should hit the session cache instead of regenerating.
      cloudLLM.generateSpendingSummary.calls.reset();
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).not.toHaveBeenCalled();
    });

    it('migrates the legacy boolean to the standard tier config', async () => {
      currentUser.set(createUser({ preferences: { enableRagInsights: true } as User['preferences'] }));
      await generate(build().componentInstance);
      expect(ragContext.buildSummaryGrounding).toHaveBeenCalledWith(
        jasmine.objectContaining({ config: RAG_TIER_CONFIGS.standard }));
    });

    it('threads the explicit tier config into the grounding build', async () => {
      currentUser.set(createUser({ preferences: { ragInsightsLevel: 'deep' } as User['preferences'] }));
      await generate(build().componentInstance);
      expect(ragContext.buildSummaryGrounding).toHaveBeenCalledWith(
        jasmine.objectContaining({ config: RAG_TIER_CONFIGS.deep }));
    });

    it('never builds grounding at level off, even with the legacy boolean on', async () => {
      currentUser.set(createUser({
        preferences: { ragInsightsLevel: 'off', enableRagInsights: true } as User['preferences'],
      }));
      await generate(build().componentInstance);
      expect(ragContext.buildSummaryGrounding).not.toHaveBeenCalled();
      const args = cloudLLM.generateSpendingSummary.calls.mostRecent().args;
      expect(args[6]).toBeUndefined();
    });

    it('waits for exchange rates before building the grounding', async () => {
      currentUser.set(createUser({ preferences: { ragInsightsLevel: 'standard' } as User['preferences'] }));
      await generate(build().componentInstance);
      expect(currency.ensureRatesLoaded).toHaveBeenCalledBefore(ragContext.buildSummaryGrounding);
    });

    it('regenerates instead of serving the cache when the tier changes', async () => {
      currentUser.set(createUser({ preferences: { ragInsightsLevel: 'light' } as User['preferences'] }));
      const component = build().componentInstance;
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalledTimes(1);

      currentUser.set(createUser({ preferences: { ragInsightsLevel: 'deep' } as User['preferences'] }));
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalledTimes(2);
    });

    it('regenerates instead of serving the cache when a goal changes', async () => {
      const fixture = build();
      const component = fixture.componentInstance;
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalledTimes(1);

      // A contribution moves the goal fingerprint, so the cached summary
      // must not survive it.
      fixture.componentRef.setInput('goals', [
        { id: 'g1', contributedAmount: 500, targetAmount: 2000 } as Goal
      ]);
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalledTimes(2);
    });

    it('shows a fallback message when summary generation fails', async () => {
      cloudLLM.generateSpendingSummary.and.rejectWith(new Error('API key not valid'));
      const component = build().componentInstance;
      await generate(component);
      expect(component.summary()).toBe('ai.invalidApiKey');
    });

    it('does not generate without a provider or enough data', async () => {
      cloudLLM.hasAnyCloudProvider.and.returnValue(false);
      const component = build().componentInstance;
      await generate(component);
      expect(cloudLLM.generateSpendingSummary).not.toHaveBeenCalled();
    });

    it('refresh clears the cache and regenerates', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      const component = fixture.componentInstance;
      await component.refresh();
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalled();
    });

    it('does not generate while categories are still loading', async () => {
      // Prompt category names resolve through the categories signal; running
      // before it loads would label everything "Other" and cache that for 1h.
      categories.set([]);
      await generate(build().componentInstance);
      expect(cloudLLM.generateSpendingSummary).not.toHaveBeenCalled();
    });

    it('emits one usage event per load, after the rates are in', async () => {
      await generate(build().componentInstance);
      expect(analytics.trackAiAssistUsed).toHaveBeenCalledTimes(1);
      expect(analytics.trackAiAssistUsed)
        .toHaveBeenCalledWith({ feature: 'summary' });
    });

    it('does not count a cache hit as a request', async () => {
      const component = build().componentInstance;
      await generate(component);
      analytics.trackAiAssistUsed.calls.reset();

      await generate(component);
      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
    });

    it('generates once categories arrive after the transactions', async () => {
      categories.set([]);
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(cloudLLM.generateSpendingSummary).not.toHaveBeenCalled();

      categories.set([createCategory()]);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalled();
    });
  });

  // #259: two provider round trips separate a request from its result, and the
  // period selector can move inside that gap.
  describe('superseding an in-flight generation', () => {
    const txns = [createTransaction(), createTransaction(), createTransaction()];

    /** Holds a generation open until the returned resolver is called. */
    function heldSummary(): (text: string) => void {
      let release!: (text: string) => void;
      cloudLLM.generateSpendingSummary.and.returnValue(
        new Promise<string>(resolve => { release = resolve; }));
      return release;
    }

    it('keys the cached summary on the period the request was built with', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      fixture.componentRef.setInput('period', 'thisMonth');
      const it = internals(fixture.componentInstance);

      await it.loadInsights(txns, 'thisMonth', it.cacheKey());

      const keys = Object.keys(sessionStorage).filter(key => key.startsWith('ai-summary-'));
      expect(keys.length).toBe(1);
      expect(keys[0]).toContain('thisMonth');
      expect(keys[0]).not.toContain('lastMonth');
    });

    it('drops a superseded run instead of overwriting the newer summary', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      const component = fixture.componentInstance;
      const it = internals(component);

      const releaseA = heldSummary();
      const keyA = it.cacheKey();
      const runA = it.loadInsights(txns, 'lastMonth', keyA);

      // The selector moves, and the new period's rows land.
      cloudLLM.generateSpendingSummary.and.resolveTo('August summary');
      fixture.componentRef.setInput('period', 'thisMonth');
      await it.loadInsights(txns, 'thisMonth', it.cacheKey());
      expect(component.summary()).toBe('August summary');

      releaseA('July summary');
      await runA;

      expect(component.summary()).toBe('August summary');
      expect(sessionStorage.getItem(keyA)).toBeNull();
    });

    it('leaves the loading flag up while a newer run is still in flight', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      const component = fixture.componentInstance;
      const it = internals(component);

      const releaseA = heldSummary();
      const runA = it.loadInsights(txns, 'lastMonth', it.cacheKey());

      const releaseB = heldSummary();
      fixture.componentRef.setInput('period', 'thisMonth');
      const runB = it.loadInsights(txns, 'thisMonth', it.cacheKey());

      releaseA('July summary');
      await runA;
      // A finished to completion, but B is still waiting on its providers.
      expect(component.isLoading()).toBeTrue();

      releaseB('August summary');
      await runB;
      expect(component.isLoading()).toBeFalse();
    });

    it('lets a cache hit supersede an in-flight generation', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      const component = fixture.componentInstance;
      const it = internals(component);

      fixture.componentRef.setInput('period', 'thisMonth');
      const keyB = it.cacheKey();
      sessionStorage.setItem(keyB, JSON.stringify({
        summary: 'Cached August', advice: 'Cached advice', timestamp: Date.now(),
      }));

      fixture.componentRef.setInput('period', 'lastMonth');
      const releaseA = heldSummary();
      const runA = it.loadInsights(txns, 'lastMonth', it.cacheKey());

      fixture.componentRef.setInput('period', 'thisMonth');
      await it.loadInsights(txns, 'thisMonth', keyB);
      expect(component.summary()).toBe('Cached August');

      // The cache hit bumped the generation, so A's late answer is stale even
      // though it never raced another live request.
      releaseA('July summary');
      await runA;
      expect(component.summary()).toBe('Cached August');
    });

    it('counts no usage event for a run that is superseded before its providers', async () => {
      const fixture = build();
      fixture.componentRef.setInput('transactions', txns);
      const component = fixture.componentInstance;
      const it = internals(component);

      let releaseRates!: () => void;
      currency.ensureRatesLoaded.and.returnValue(
        new Promise<void>(resolve => { releaseRates = resolve; }));
      const runA = it.loadInsights(txns, 'lastMonth', it.cacheKey());

      currency.ensureRatesLoaded.and.resolveTo(undefined);
      fixture.componentRef.setInput('period', 'thisMonth');
      await it.loadInsights(txns, 'thisMonth', it.cacheKey());
      analytics.trackAiAssistUsed.calls.reset();

      releaseRates();
      await runA;

      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
      expect(cloudLLM.generateSpendingSummary).toHaveBeenCalledTimes(1);
    });
  });
});
