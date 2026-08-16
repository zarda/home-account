import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { CATEGORIZE_CHUNK_SIZE, CloudLLMProviderBase, ProviderResponse } from './cloud-llm-provider.base';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { ProviderCapabilities } from './llm-provider.interface';
import { PromptId, RenderedPrompt } from '../prompts';
import { Category } from '../../models';
import { FALLBACK_CATEGORY_ID } from '../utils/categorization.utils';
import { createCategory } from './testing';

/**
 * What the shared base guarantees, independently of any provider.
 *
 * The three provider specs each exercise these paths through their own SDK
 * fake, which means each of them proves it for one transport. This suite
 * proves it for the class itself, over a transport that does nothing but
 * record what it was asked for — so a change to `run()`'s bookkeeping fails
 * here, once, with a message about the bookkeeping rather than three times
 * with messages about Gemini, OpenAI and Claude.
 */
class StubProvider extends CloudLLMProviderBase {
  protected readonly providerLabel = 'Stub';

  /** Every prompt id the transports were asked for, in order. */
  readonly sent: PromptId[] = [];
  readonly imagesSent: string[][] = [];
  /** Every rendered prompt sendText was handed, in order. */
  readonly renderedSent: RenderedPrompt[] = [];

  clientPresent = true;
  response: ProviderResponse = { text: '', truncated: false };
  failWith: unknown = null;
  /** FIFO answers for multi-request operations; an Error entry throws. */
  responseQueue: (ProviderResponse | Error)[] = [];

  override get capabilities(): ProviderCapabilities {
    return { vision: true };
  }

  isAvailable(): boolean {
    return this.clientPresent;
  }

  reinitialize(): Promise<void> {
    return Promise.resolve();
  }

  protected assertTextTransport(): void {
    if (!this.clientPresent) {
      throw new Error('Stub client not available');
    }
  }

  protected assertVisionTransport(): void {
    this.assertTextTransport();
  }

  protected async sendText(promptId: PromptId, rendered: RenderedPrompt): Promise<ProviderResponse> {
    this.sent.push(promptId);
    this.renderedSent.push(rendered);
    if (this.responseQueue.length > 0) {
      const next = this.responseQueue.shift()!;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
    if (this.failWith) {
      throw this.failWith;
    }
    return this.response;
  }

  protected async sendVision(
    promptId: PromptId,
    rendered: RenderedPrompt,
    imagesBase64: string[]
  ): Promise<ProviderResponse> {
    this.sent.push(promptId);
    this.imagesSent.push(imagesBase64);
    if (this.failWith) {
      throw this.failWith;
    }
    return this.response;
  }

  /** The protected members this suite asserts, reachable from the test. */
  callExtractJson(text: string): string {
    return this.extractJson(text);
  }

  callPostProcessProse(promptId: PromptId, response: ProviderResponse): string {
    return this.postProcessProse(promptId, response);
  }
}

describe('CloudLLMProviderBase', () => {
  let provider: StubProvider;

  const categories: Category[] = [
    createCategory({ id: 'food_groceries', name: 'Groceries', type: 'expense' }),
    createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    createCategory({ id: 'other_expense', name: 'Other', type: 'expense' }),
  ];

  beforeEach(() => {
    const categoryService = jasmine.createSpyObj<CategoryService>('CategoryService', [
      'categories',
    ]);
    categoryService.categories.and.returnValue(categories);

    const currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', [
      'convert',
      'formatAmount',
    ]);
    currencyService.convert.and.callFake((amount: number) => amount);
    currencyService.formatAmount.and.callFake((amount: number) => amount.toFixed(2));

    const translationService = jasmine.createSpyObj<TranslationService>('TranslationService', [
      't',
      'currentLocale',
    ]);
    translationService.t.and.callFake((key: string) => key);
    translationService.currentLocale.and.returnValue('en');

    TestBed.configureTestingModule({
      providers: [
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
      ],
    });

    // Constructed by hand rather than injected: the base reads its
    // collaborators in field initializers, so this is also the assertion that
    // an injection context is all a subclass needs.
    provider = runInInjectionContext(
      TestBed.inject(EnvironmentInjector),
      () => new StubProvider()
    );
  });

  describe('run', () => {
    it('records the message, rethrows, and stops processing', async () => {
      spyOn(console, 'error');
      provider.failWith = new Error('401 invalid key');

      await expectAsync(provider.parseReceipt('img')).toBeRejectedWithError('401 invalid key');

      expect(provider.lastError()).toBe('401 invalid key');
      expect(provider.isProcessing()).toBeFalse();
    });

    it('records a generic message for a rejection that is not an Error', async () => {
      spyOn(console, 'error');
      provider.failWith = 'a string nobody threw on purpose';

      await expectAsync(provider.parseReceipt('img')).toBeRejected();

      expect(provider.lastError()).toBe('Unknown error');
    });

    it('clears a previous failure when the next attempt succeeds', async () => {
      spyOn(console, 'error');
      provider.failWith = new Error('transient');
      await expectAsync(provider.parseReceipt('img')).toBeRejected();
      expect(provider.lastError()).toBe('transient');

      provider.failWith = null;
      provider.response = {
        text: '{"merchant":"Cafe","amount":4,"suggestedCategory":"Groceries"}',
        truncated: false,
      };
      await provider.parseReceipt('img');

      expect(provider.lastError()).toBeNull();
      expect(provider.isProcessing()).toBeFalse();
    });

    it('refuses before any request when the transport is unavailable', async () => {
      provider.clientPresent = false;

      await expectAsync(provider.parseReceipt('img')).toBeRejectedWithError(
        'Stub client not available'
      );

      expect(provider.sent).toEqual([]);
      expect(provider.isProcessing()).toBeFalse();
    });
  });

  describe('runOrDefault', () => {
    it('answers with the default and leaves lastError alone', async () => {
      spyOn(console, 'error');
      provider.failWith = new Error('categorization exploded');

      const rows = await provider.categorizeTransactions([
        { description: 'Milk', amount: 3, date: new Date() },
      ]);

      expect(rows[0].suggestedCategoryId).toBe('other_expense');
      expect(rows[0].confidence).toBe(0.1);
      // Nothing is shown to the user on this path, so nothing is left behind
      // to be reported later against an unrelated request.
      expect(provider.lastError()).toBeNull();
      expect(provider.isProcessing()).toBeFalse();
    });
  });

  describe('categorizeTransactions chunking', () => {
    const row = (i: number) => ({ description: `Row ${i}`, amount: -5, date: new Date() });
    const answer = (
      entries: { index: number; categoryId: string; confidence: number }[]
    ): ProviderResponse => ({ text: JSON.stringify(entries), truncated: false });

    it('sends one request for a batch at the chunk size', async () => {
      const rows = Array.from({ length: CATEGORIZE_CHUNK_SIZE }, (_, i) => row(i));
      provider.response = answer(
        rows.map((_, i) => ({ index: i, categoryId: 'food_groceries', confidence: 0.9 }))
      );

      const result = await provider.categorizeTransactions(rows);

      expect(provider.sent).toEqual(['categorizeTransactions']);
      expect(provider.renderedSent[0].user).toContain(
        `${CATEGORIZE_CHUNK_SIZE - 1}: "Row ${CATEGORIZE_CHUNK_SIZE - 1}"`
      );
      expect(result.length).toBe(CATEGORIZE_CHUNK_SIZE);
      expect(result.every(r => r.suggestedCategoryId === 'food_groceries')).toBeTrue();
    });

    it('splits past the chunk size and re-bases the second request from zero', async () => {
      const rows = Array.from({ length: CATEGORIZE_CHUNK_SIZE + 1 }, (_, i) => row(i));
      provider.responseQueue = [
        answer(
          Array.from({ length: CATEGORIZE_CHUNK_SIZE }, (_, i) => ({
            index: i,
            categoryId: 'food_groceries',
            confidence: 0.9,
          }))
        ),
        answer([{ index: 0, categoryId: 'transport', confidence: 0.7 }]),
      ];

      const result = await provider.categorizeTransactions(rows);

      expect(provider.sent).toEqual(['categorizeTransactions', 'categorizeTransactions']);
      // The overflow row is the second request's index 0, not 25:
      // applyCategorizations matches answers by position within its chunk.
      expect(provider.renderedSent[1].user).toContain(`0: "Row ${CATEGORIZE_CHUNK_SIZE}"`);
      expect(provider.renderedSent[1].user).not.toContain(
        `${CATEGORIZE_CHUNK_SIZE}: "Row ${CATEGORIZE_CHUNK_SIZE}"`
      );
      // Merge-by-position preserves input order across the chunks.
      expect(result.length).toBe(CATEGORIZE_CHUNK_SIZE + 1);
      expect(result[0].suggestedCategoryId).toBe('food_groceries');
      expect(result[CATEGORIZE_CHUNK_SIZE].suggestedCategoryId).toBe('transport');
      expect(result[CATEGORIZE_CHUNK_SIZE].confidence).toBe(0.7);
    });

    it('defaults only the failed chunk rows and keeps the other answers', async () => {
      spyOn(console, 'error');
      const rows = Array.from({ length: CATEGORIZE_CHUNK_SIZE + 1 }, (_, i) => row(i));
      provider.responseQueue = [
        new Error('first chunk truncated'),
        answer([{ index: 0, categoryId: 'transport', confidence: 0.7 }]),
      ];

      const result = await provider.categorizeTransactions(rows);

      const firstChunk = result.slice(0, CATEGORIZE_CHUNK_SIZE);
      expect(firstChunk.every(r => r.suggestedCategoryId === FALLBACK_CATEGORY_ID)).toBeTrue();
      expect(firstChunk.every(r => r.confidence === 0.1)).toBeTrue();
      expect(result[CATEGORIZE_CHUNK_SIZE].suggestedCategoryId).toBe('transport');
      expect(result[CATEGORIZE_CHUNK_SIZE].confidence).toBe(0.7);
    });
  });

  describe('extraction category resolution', () => {
    const statementJson = (category: string) =>
      JSON.stringify([
        { date: '2024-06-01', description: 'Row', amount: 5, type: 'expense', currency: 'USD', category },
      ]);

    it('keeps the catalog id when the answered name resolves', async () => {
      provider.response = { text: statementJson('Groceries'), truncated: false };

      const rows = await provider.extractStatementTransactions('img');

      expect(rows[0].category).toBe('food_groceries');
    });

    it('keeps a deliberate Other as the catch-all id', async () => {
      provider.response = { text: statementJson('Other'), truncated: false };

      const rows = await provider.extractStatementTransactions('img');

      expect(rows[0].category).toBe('other_expense');
    });

    it('leaves the category undefined when nothing matches', async () => {
      // An unrecognized answer must stay distinguishable from a deliberate
      // "Other": a truthy other_expense would wear the extraction-named grade
      // downstream and override the categorization ladder's answer.
      provider.response = { text: statementJson('Zeugs'), truncated: false };

      const rows = await provider.extractStatementTransactions('img');

      expect(rows[0].category).toBeUndefined();
    });

    it('resolves multi-image rows the same way', async () => {
      provider.response = {
        text: JSON.stringify([
          { date: '2024-06-01', description: 'A', amount: 5, type: 'expense', currency: 'USD',
            category: 'Zeugs', imageIndex: 0, positionInImage: 'top', confidence: 0.9, receiptId: 1 },
          { date: '2024-06-01', description: 'B', amount: 6, type: 'expense', currency: 'USD',
            category: 'Transport', imageIndex: 0, positionInImage: 'bottom', confidence: 0.9, receiptId: 1 },
        ]),
        truncated: false,
      };

      const rows = await provider.extractTransactionsFromMultipleImages(['img']);

      expect(rows[0].category).toBeUndefined();
      expect(rows[1].category).toBe('transport');
    });
  });

  describe('extractJson', () => {
    it('strips markdown fences', () => {
      expect(provider.callExtractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('finds the payload inside surrounding prose', () => {
      expect(provider.callExtractJson('Here you go: [{"a":1}] — hope that helps')).toBe(
        '[{"a":1}]'
      );
    });

    it('returns the trimmed text when there is no JSON at all', () => {
      // Deliberately not a throw: the caller's JSON.parse is what fails, and
      // it fails with the model's own words in the message.
      expect(provider.callExtractJson('  I cannot help with that  ')).toBe(
        'I cannot help with that'
      );
    });
  });

  describe('postProcessProse', () => {
    it('trims and otherwise returns the answer as given', () => {
      const response = { text: '  ## Spending\nBody.  ', truncated: true };
      for (const promptId of ['spendingSummary', 'financialAdvice', 'patternNarrative'] as const) {
        expect(provider.callPostProcessProse(promptId, response)).toBe('## Spending\nBody.');
      }
    });
  });

  describe('parseReceipt', () => {
    // The receiptParse prompt asks for suggestedCategory but its "use
    // defaults" line names only merchant, currency, date, items and amount —
    // so a receipt whose category the model cannot judge legitimately comes
    // back without the field. It lands on the catalog fallback, which is a
    // real category the form will pre-select rather than a "no suggestion"
    // sentinel; the point of these is that the rest of the receipt survives
    // instead of the whole scan failing over its least consequential field.
    it('falls back to the catalog default when the model names no category', async () => {
      provider.response = {
        text: '{"merchant":"Cafe","amount":4}',
        truncated: false,
      };

      const receipt = await provider.parseReceipt('img');

      expect(receipt.suggestedCategory).toBe(FALLBACK_CATEGORY_ID);
      expect(receipt.merchant).toBe('Cafe');
      expect(provider.lastError()).toBeNull();
    });

    it('falls back when the model answers the category with a list', async () => {
      // Not the same case as an absent field: this one is truthy, so a guard
      // that only tested for a missing value would pass it straight through
      // to suggestedCategory, where the import flow reads it as a category id.
      provider.response = {
        text: '{"merchant":"Cafe","amount":4,"suggestedCategory":["Groceries","Food"]}',
        truncated: false,
      };

      const receipt = await provider.parseReceipt('img');

      expect(receipt.suggestedCategory).toBe(FALLBACK_CATEGORY_ID);
    });

    /**
     * The model answers with a date-only string — the receiptParse prompt pins
     * the format — and `new Date('2026-08-01')` is UTC midnight by language
     * specification. West of UTC that instant is 31 July, so the scan filed
     * into the previous month's budget, comparison and snapshot.
     *
     * Every assertion here reads local parts. Comparing against a Date built
     * the same broken way, as the provider specs used to, holds in every zone
     * and proves nothing.
     */
    describe('dates', () => {
      const today = new Date(2026, 7, 20, 9, 30);

      beforeEach(() => {
        jasmine.clock().install();
        jasmine.clock().mockDate(today);
      });

      afterEach(() => jasmine.clock().uninstall());

      const dateFrom = async (json: string): Promise<Date> => {
        provider.response = { text: json, truncated: false };
        return (await provider.parseReceipt('img')).date;
      };

      it('reads a date-only reply as local midnight, not UTC midnight', async () => {
        const date = await dateFrom('{"merchant":"Cafe","amount":4,"date":"2026-08-01"}');

        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(7);
        expect(date.getDate()).toBe(1);
        expect(date.getHours()).toBe(0);
      });

      it('falls back to today for a well-shaped date that does not exist', async () => {
        // new Date('2026-02-31') is 3 March in V8. A date the receipt never
        // named is better reported than quietly moved.
        const date = await dateFrom('{"merchant":"Cafe","amount":4,"date":"2026-02-31"}');

        expect(date.getMonth()).toBe(today.getMonth());
        expect(date.getDate()).toBe(today.getDate());
      });

      it('falls back to today for a shape it cannot read at all', async () => {
        // An Invalid Date is truthy, so the form's `|| new Date()` guard never
        // replaced it and the datepicker rendered blank with no error.
        const date = await dateFrom('{"merchant":"Cafe","amount":4,"date":"31/12/2024"}');

        expect(isNaN(date.getTime())).toBeFalse();
        expect(date.getDate()).toBe(today.getDate());
      });

      it('falls back to today when the model names no date', async () => {
        const date = await dateFrom('{"merchant":"Cafe","amount":4}');

        expect(date.getDate()).toBe(today.getDate());
      });
    });
  });

  describe('extractTransactionsFromImage', () => {
    it('reads one image as a one-row statement by default', async () => {
      provider.response = {
        text: JSON.stringify([
          { date: '2026-07-01', description: 'CAFE', amount: 4.5, type: 'expense', currency: 'USD' },
        ]),
        truncated: false,
      };

      const rows = await provider.extractTransactionsFromImage('img');

      expect(rows.length).toBe(1);
      // The statement prompt, not a receipt-specific one: Gemini is the only
      // provider that answers this with something else, and it overrides.
      expect(provider.sent).toEqual(['statementTransactions']);
      expect(provider.imagesSent).toEqual([['img']]);
    });

    it('resolves the category a row names against the catalog', async () => {
      provider.response = {
        text: JSON.stringify([
          {
            date: '2026-07-01',
            description: 'SUPERMARKET',
            amount: 20,
            type: 'expense',
            currency: 'USD',
            category: 'Groceries',
          },
        ]),
        truncated: false,
      };

      const rows = await provider.extractStatementTransactions('img');

      // The import flow reads this field as a category id, so the model's own
      // wording must not reach it.
      expect(rows[0].category).toBe('food_groceries');
    });
  });
});
