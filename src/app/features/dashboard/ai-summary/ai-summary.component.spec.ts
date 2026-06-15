import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AiSummaryComponent } from './ai-summary.component';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AuthService } from '../../../core/services/auth.service';
import { RagContextService } from '../../../core/services/rag-context.service';
import { Transaction, User } from '../../../models';
import { createTransaction, createUser } from '../../../core/services/testing';

describe('AiSummaryComponent', () => {
  let cloudLLM: jasmine.SpyObj<CloudLLMProviderService>;
  let ragContext: jasmine.SpyObj<RagContextService>;
  let currentUser: ReturnType<typeof signal<User | null>>;

  function build() {
    const fixture = TestBed.createComponent(AiSummaryComponent);
    return fixture;
  }

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

    const currency = jasmine.createSpyObj('CurrencyService', ['convert']);
    currency.convert.and.callFake((a: number) => a);
    const translation = jasmine.createSpyObj('TranslationService', ['t', 'currentLocale']);
    translation.t.and.callFake((k: string) => k);
    translation.currentLocale.and.returnValue('en');
    ragContext = jasmine.createSpyObj('RagContextService', ['buildSummaryGrounding']);
    ragContext.buildSummaryGrounding.and.returnValue('GROUNDING');
    currentUser = signal<User | null>(createUser());
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
        { provide: RagContextService, useValue: ragContext },
        { provide: DomSanitizer, useValue: sanitizer },
      ],
    })
      .overrideComponent(AiSummaryComponent, { set: { imports: [], template: '' } })
      .compileComponents();
  });

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

    async function generate(component: AiSummaryComponent) {
      await (component as unknown as {
        generateInsights: (t: Transaction[], p: string) => Promise<void>;
      }).generateInsights(txns, 'thisMonth');
    }

    it('populates summary and advice and caches successful results', async () => {
      const component = build().componentInstance;
      await generate(component);
      expect(component.summary()).toBe('Summary text');
      expect(component.advice()).toBe('Advice text');
      expect(component.isLoading()).toBeFalse();
      // Second run should hit the session cache instead of regenerating.
      cloudLLM.generateSpendingSummary.calls.reset();
      await (component as unknown as {
        loadInsights: (t: Transaction[], p: string) => Promise<void>;
      }).loadInsights(txns, 'thisMonth');
      expect(cloudLLM.generateSpendingSummary).not.toHaveBeenCalled();
    });

    it('includes RAG grounding when the user opted in', async () => {
      currentUser.set(createUser({ preferences: { enableRagInsights: true } as User['preferences'] }));
      await generate(build().componentInstance);
      expect(ragContext.buildSummaryGrounding).toHaveBeenCalled();
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
  });
});
