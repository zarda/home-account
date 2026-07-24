import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { RagContextService } from './rag-context.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { Category, RAG_TIER_CONFIGS, Transaction, ZERO_DECIMAL_CURRENCIES } from '../../models';

describe('RagContextService', () => {
  let service: RagContextService;

  const categories = [
    { id: 'food_groceries', name: 'categoryNames.groceries' },
    { id: 'entertainment', name: 'Entertainment' },
  ] as Category[];

  const translations: Record<string, string> = {
    'categoryNames.groceries': 'Groceries',
  };

  let nextId = 0;
  const expense = (overrides: Partial<Transaction>): Transaction => ({
    id: `t${nextId++}`,
    description: 'Expense',
    amount: 10,
    currency: 'TWD',
    type: 'expense',
    categoryId: 'food_groceries',
    date: new Date('2026-06-01'),
    ...overrides,
  } as Transaction);

  beforeEach(() => {
    const currencyMock = jasmine.createSpyObj('CurrencyService', ['amountInBase', 'formatAmount']);
    currencyMock.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount);
    currencyMock.formatAmount.and.callFake(
      (amount: number, code: string) => amount.toFixed(ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2));

    const translationMock = jasmine.createSpyObj('TranslationService', ['t']);
    translationMock.t.and.callFake((key: string) => translations[key] ?? key);

    TestBed.configureTestingModule({
      providers: [
        RagContextService,
        {
          provide: CategoryService,
          useValue: jasmine.createSpyObj('CategoryService', ['loadCategories'], {
            categories: signal(categories),
          }),
        },
        { provide: CurrencyService, useValue: currencyMock },
        { provide: TranslationService, useValue: translationMock },
      ],
    });

    service = TestBed.inject(RagContextService);
  });

  it('should return an empty string when there are no expenses', () => {
    const income = expense({ type: 'income' });
    expect(service.buildSummaryGrounding({
      transactions: [income],
      previousByCategory: null,
      baseCurrency: 'TWD',
    })).toBe('');
  });

  it('should list top expenses with translated category and date', () => {
    const context = service.buildSummaryGrounding({
      transactions: [
        expense({ description: 'Lamb', amount: 959 }),
        expense({ description: 'Grapes', amount: 849 }),
      ],
      previousByCategory: null,
      baseCurrency: 'TWD',
    });

    expect(context).toContain('Top expenses:');
    expect(context).toContain('- Lamb — 959 TWD (Groceries, 2026-06-01)');
    const lambIndex = context.indexOf('Lamb');
    const grapesIndex = context.indexOf('Grapes');
    expect(lambIndex).toBeLessThan(grapesIndex);
  });

  it('should cap top expenses at 10', () => {
    const transactions = Array.from({ length: 15 }, (_, i) =>
      expense({ description: `Item ${i}`, amount: 100 + i }));
    const context = service.buildSummaryGrounding({
      transactions, previousByCategory: null, baseCurrency: 'TWD',
    });

    expect((context.match(/^- Item /gm) ?? []).length).toBe(10);
  });

  it('should flag amounts far above the category mean', () => {
    const transactions = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
      expense({ description: 'Caviar', amount: 2000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions, previousByCategory: null, baseCurrency: 'TWD',
    });

    expect(context).toContain('Unusual amounts:');
    expect(context).toContain('Caviar');
    expect(context).not.toMatch(/Unusual amounts:[\s\S]*- Milk/);
  });

  it('should not flag anomalies in categories with fewer than 4 transactions', () => {
    const transactions = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Caviar', amount: 2000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions, previousByCategory: null, baseCurrency: 'TWD',
    });

    expect(context).not.toContain('Unusual amounts:');
  });

  it('should flag using the historical baseline even with a single current transaction', () => {
    // Only one grocery this period — too few for a current-period baseline —
    // but the trailing window provides enough history to flag it.
    const historicalExpenses = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions: [expense({ description: 'Caviar', amount: 2000 })],
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses,
    });

    expect(context).toContain('Unusual amounts:');
    expect(context).toContain('Caviar');
    // "typical" reflects the historical mean (100), proving the baseline came
    // from history rather than the lone current transaction.
    expect(context).toContain('typical: 100 TWD');
  });

  it('should draw the anomaly baseline from history, not the current period', () => {
    const historicalExpenses = [
      expense({ description: 'H1', amount: 900 }),
      expense({ description: 'H2', amount: 1000 }),
      expense({ description: 'H3', amount: 1100 }),
      expense({ description: 'H4', amount: 1000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions: [
        expense({ description: 'Normal', amount: 300 }),
        expense({ description: 'Splurge', amount: 5000 }),
      ],
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses,
    });

    // 5000 is far above the ~1000 historical mean; 300 is below it.
    expect(context).toMatch(/Unusual amounts:[\s\S]*Splurge/);
    expect(context).not.toMatch(/Unusual amounts:[\s\S]*Normal/);
  });

  it('should only flag current-period transactions, never history-only ones', () => {
    const historicalExpenses = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
      // A huge spend in a category with no current activity — must never surface.
      expense({ categoryId: 'entertainment', description: 'OldSplurge', amount: 9000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions: [expense({ description: 'Caviar', amount: 2000 })],
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses,
    });

    expect(context).toContain('Caviar');
    expect(context).not.toContain('OldSplurge');
  });

  it('should ignore income transactions in the historical baseline', () => {
    const historicalExpenses = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
      // If these income rows leaked into the baseline they would inflate the
      // mean enough to suppress the 2000 flag below.
      expense({ type: 'income', amount: 5000 }),
      expense({ type: 'income', amount: 5000 }),
      expense({ type: 'income', amount: 5000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions: [expense({ description: 'Caviar', amount: 2000 })],
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses,
    });

    expect(context).toContain('Caviar');
  });

  it('should fall back to the current period when history is empty', () => {
    const transactions = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
      expense({ description: 'Caviar', amount: 2000 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions,
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses: [],
    });

    expect(context).toContain('Unusual amounts:');
    expect(context).toContain('Caviar');
  });

  it('should report the largest category changes vs. the previous period', () => {
    const transactions = [
      expense({ categoryId: 'food_groceries', amount: 6000 }),
      expense({ categoryId: 'entertainment', amount: 500 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions,
      previousByCategory: [
        { categoryId: 'food_groceries', total: 3000 },
        { categoryId: 'entertainment', total: 500 },
      ],
      baseCurrency: 'TWD',
    });

    expect(context).toContain('Category changes vs. previous period:');
    expect(context).toContain('- Groceries: 3000 → 6000 TWD (up 100%)');
    // Unchanged categories are not listed
    expect(context).not.toMatch(/Entertainment: 500 → 500/);
  });

  it('should mark categories with no previous spending as new', () => {
    const context = service.buildSummaryGrounding({
      transactions: [expense({ categoryId: 'entertainment', amount: 800 })],
      previousByCategory: [{ categoryId: 'food_groceries', total: 100 }],
      baseCurrency: 'TWD',
    });

    expect(context).toContain('Entertainment: 0 → 800 TWD (new this period)');
  });

  it('should omit the deltas section without previous-period data', () => {
    const context = service.buildSummaryGrounding({
      transactions: [expense({ amount: 500 })],
      previousByCategory: null,
      baseCurrency: 'TWD',
    });

    expect(context).not.toContain('Category changes');
  });

  it('should keep sub-digits for decimal base currencies', () => {
    const context = service.buildSummaryGrounding({
      transactions: [expense({ description: 'Coffee', amount: 12.34, currency: 'USD' })],
      previousByCategory: null,
      baseCurrency: 'USD',
    });

    expect(context).toContain('- Coffee — 12.34 USD');
  });

  it('should prefer the stored base-currency snapshot over the raw amount', () => {
    const context = service.buildSummaryGrounding({
      transactions: [
        expense({ description: 'Tokyo Lunch', amount: 3800, currency: 'JPY', amountInBaseCurrency: 850 }),
      ],
      previousByCategory: null,
      baseCurrency: 'TWD',
    });

    expect(context).toContain('- Tokyo Lunch — 850 TWD');
    expect(context).not.toContain('3800 TWD');
  });

  describe('tier configs', () => {
    // Data that produces an anomaly under the standard config.
    const anomalousSet = () => [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
      expense({ description: 'Caviar', amount: 2000 }),
    ];

    it('light caps top expenses at 3 and skips the anomaly scan entirely', () => {
      const context = service.buildSummaryGrounding({
        transactions: anomalousSet(),
        previousByCategory: null,
        baseCurrency: 'TWD',
        config: RAG_TIER_CONFIGS.light,
      });

      expect((context.match(/^- /gm) ?? []).length).toBe(3);
      expect(context).not.toContain('Unusual amounts:');
    });

    it('light still reports category deltas', () => {
      const context = service.buildSummaryGrounding({
        transactions: [expense({ amount: 800 })],
        previousByCategory: [{ categoryId: 'food_groceries', total: 100 }],
        baseCurrency: 'TWD',
        config: RAG_TIER_CONFIGS.light,
      });

      expect(context).toContain('Category changes vs. previous period:');
    });

    it('deep caps top expenses at 20', () => {
      const transactions = Array.from({ length: 25 }, (_, i) =>
        expense({ description: `Item ${i}`, amount: 100 + i }));
      const context = service.buildSummaryGrounding({
        transactions, previousByCategory: null, baseCurrency: 'TWD',
        config: RAG_TIER_CONFIGS.deep,
      });

      expect((context.match(/^- Item /gm) ?? []).length).toBe(20);
    });

    it('deep caps anomalies at 10', () => {
      // Disjoint history gives each category a tight baseline of 100s; every
      // current 5000 is anomalous — 12 candidates, capped at 10.
      const historicalExpenses = ['food_groceries', 'entertainment'].flatMap(categoryId =>
        Array.from({ length: 4 }, () => expense({ categoryId, amount: 100 })));
      const transactions = ['food_groceries', 'entertainment'].flatMap(categoryId =>
        Array.from({ length: 6 }, (_, i) =>
          expense({ categoryId, description: `Splurge ${categoryId} ${i}`, amount: 5000 })));

      const context = service.buildSummaryGrounding({
        transactions, previousByCategory: null, baseCurrency: 'TWD',
        historicalExpenses,
        config: RAG_TIER_CONFIGS.deep,
      });

      const unusualSection = context.split('Unusual amounts:')[1] ?? '';
      expect((unusualSection.match(/^- Splurge /gm) ?? []).length).toBe(10);
    });

    it('deep caps category deltas at 10', () => {
      const transactions = Array.from({ length: 12 }, (_, i) =>
        expense({ categoryId: `cat_${i}`, amount: 1000 + i }));
      const context = service.buildSummaryGrounding({
        transactions,
        // Small previous-period entry so the section renders; its 50-TWD delta
        // sorts below every 1000+ new-category delta and falls out of the cap.
        previousByCategory: [{ categoryId: 'cat_prior', total: 50 }],
        baseCurrency: 'TWD',
        config: RAG_TIER_CONFIGS.deep,
      });

      const deltaSection = context.split('Category changes vs. previous period:')[1] ?? '';
      expect((deltaSection.match(/new this period/g) ?? []).length).toBe(10);
    });
  });

  it('should flag an overlapping anomaly exactly once, counting each row once in the baseline', () => {
    // Reproduces production wiring: the trailing window INCLUDES the
    // current-period rows (same ids), plus older history.
    const current = [
      expense({ description: 'Milk', amount: 100 }),
      expense({ description: 'Caviar', amount: 2000 }),
    ];
    const olderHistory = [
      expense({ description: 'Bread', amount: 110 }),
      expense({ description: 'Eggs', amount: 90 }),
      expense({ description: 'Butter', amount: 105 }),
      expense({ description: 'Cheese', amount: 95 }),
    ];
    const context = service.buildSummaryGrounding({
      transactions: current,
      previousByCategory: null,
      baseCurrency: 'TWD',
      historicalExpenses: [...current, ...olderHistory],
    });

    const unusualSection = context.split('Unusual amounts:')[1] ?? '';
    expect((unusualSection.match(/Caviar/g) ?? []).length).toBe(1);
    // Mean over the six distinct rows (each counted once): (100+2000+110+90+105+95)/6 = 416.67
    expect(unusualSection).toContain('typical: 417 TWD');
  });
});
