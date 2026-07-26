import {
  INSIGHT_CARD_KEYS,
  buildInsightCards,
  sortInsightCards,
  toStorableCards,
} from './insight-card.utils';
import { computeInsightFacts } from './insight-facts.utils';
import { findSerializationIssues } from './firestore-value.utils';
import { DetectorWindow } from './spending-pattern.types';
import { InsightCard, InsightFacts, Transaction } from '../../models';
import { createTimestamp, createTransaction } from '../services/testing/test-data';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

describe('insight-card.utils', () => {
  const toBase = (t: Transaction) => t.amount;
  const window: DetectorWindow = {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 5, 30, 23, 59, 59, 999),
  };
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

  function expense(
    date: Date,
    amount: number,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense', amount, date: createTimestamp(date), ...overrides,
    });
  }

  function richHistory(): Transaction[] {
    const transactions: Transaction[] = [];
    for (let month = 0; month < 6; month += 1) {
      transactions.push(expense(new Date(2026, month, 5), 15.99, {
        description: 'Netflix', categoryId: 'subscriptions_streaming_services',
      }));
      for (let i = 0; i < 4; i += 1) {
        transactions.push(expense(new Date(2026, month, 3 + i * 6), 40 + month * 12, {
          description: 'Supermarket', categoryId: 'food_groceries',
        }));
      }
      for (let day = 1; day <= 10; day += 1) {
        transactions.push(expense(new Date(2026, month, day * 2), 3.5, {
          description: 'Coffee', categoryId: 'food_restaurants',
        }));
      }
      transactions.push(createTransaction({
        type: 'income', amount: 4000, recurringId: 'salary',
        date: createTimestamp(new Date(2026, month, 25)),
      }));
    }
    return transactions;
  }

  function cardsFor(transactions: Transaction[]): InsightCard[] {
    const { facts, drillDownIds, dripTruncated } = computeInsightFacts({
      transactions, toBase, window, months,
      baseCurrency: 'USD', timeZone: 'Asia/Taipei',
    });
    return buildInsightCards(facts, drillDownIds, dripTruncated);
  }

  describe('i18n key coverage', () => {
    // check-i18n.mjs skips dynamic pipes, and these keys are consumed through
    // `card.titleKey | translate`, so this is the only guard against a typo. A
    // missing key renders as its own text — there is no English fallback.
    const locales: [string, Record<string, unknown>][] = [
      ['en', en as Record<string, unknown>],
      ['ja', ja as Record<string, unknown>],
      ['tc', tc as Record<string, unknown>],
    ];

    function leafAt(dictionary: Record<string, unknown>, key: string): unknown {
      return key.split('.').reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part], dictionary);
    }

    for (const [name, dictionary] of locales) {
      it(`resolves every insight card key in ${name}`, () => {
        const missing = INSIGHT_CARD_KEYS.filter(key => {
          const value = leafAt(dictionary, key);
          return typeof value !== 'string' || value.length === 0;
        });
        expect(missing).toEqual([]);
      });
    }

    it('lists every key the builder can emit', () => {
      const emitted = new Set<string>();
      for (const card of cardsFor(richHistory())) {
        emitted.add(card.titleKey);
        emitted.add(card.bodyKey);
      }
      const unlisted = [...emitted].filter(key => !INSIGHT_CARD_KEYS.includes(key));
      expect(unlisted).toEqual([]);
    });
  });

  describe('card contract', () => {
    it('never puts a formatted amount or a category name in params', () => {
      for (const card of cardsFor(richHistory())) {
        for (const value of Object.values(card.params)) {
          if (typeof value === 'string') {
            expect(value).not.toMatch(/[$¥€£]/);
          }
        }
        // Categories travel as ids in their own field.
        expect(Object.keys(card.params)).not.toContain('category');
      }
    });

    it('carries money in metrics as raw numbers', () => {
      const portfolio = cardsFor(richHistory()).find(c => c.kind === 'recurringPortfolio')!;
      expect(typeof portfolio.metrics['totalMonthlyEquivalent']).toBe('number');
    });

    it('uses category ids, never names', () => {
      const trend = cardsFor(richHistory()).find(c => c.kind === 'categoryTrend')!;
      expect(trend.categoryIds).toEqual(['food_groceries']);
    });

    it('produces cards Firestore will accept', () => {
      expect(findSerializationIssues(cardsFor(richHistory()))).toEqual([]);
    });

    it('omits the optional series key rather than setting it undefined', () => {
      const portfolio = cardsFor(richHistory()).find(c => c.kind === 'recurringPortfolio')!;
      expect('series' in portfolio).toBeFalse();
    });

    it('attaches a series to trend cards for the sparkline', () => {
      const trend = cardsFor(richHistory()).find(c => c.kind === 'categoryTrend')!;
      expect(trend.series?.length).toBe(6);
      expect(trend.seriesMonths).toEqual(months);
    });

    it('gives every card a stable id', () => {
      const first = cardsFor(richHistory()).map(c => c.id);
      const second = cardsFor(richHistory()).map(c => c.id);
      expect(second).toEqual(first);
      expect(new Set(first).size).toBe(first.length);
    });

    it('is order-independent', () => {
      const transactions = richHistory();
      expect(cardsFor([...transactions].reverse())).toEqual(cardsFor(transactions));
    });
  });

  describe('drill-down mode per kind', () => {
    it('gives a trend card an exact category filter', () => {
      const trend = cardsFor(richHistory()).find(c => c.kind === 'categoryTrend')!;
      expect(trend.drillDown).toEqual({
        mode: 'filters',
        filters: {
          type: 'expense',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
          categoryId: 'food_groceries',
        },
      });
    });

    it('gives the recurring portfolio no drill-down, since each row differs', () => {
      const portfolio = cardsFor(richHistory()).find(c => c.kind === 'recurringPortfolio')!;
      expect(portfolio.drillDown).toEqual({ mode: 'none' });
    });

    it('narrows the drip by amount when every expense shares the base currency', () => {
      const drip = cardsFor(richHistory()).find(c => c.kind === 'smallDrip');
      expect(drip?.drillDown.mode).toBe('filters');
      if (drip?.drillDown.mode === 'filters') {
        expect(drip.drillDown.filters.maxAmount).toBeGreaterThan(0);
      }
    });

    it('falls back to an inline list when currencies are mixed', () => {
      const mixed = [
        ...richHistory(),
        expense(new Date(2026, 2, 9), 500, { currency: 'JPY' }),
      ];
      const drip = cardsFor(mixed).find(c => c.kind === 'smallDrip');
      expect(drip?.drillDown.mode).toBe('inline');
      if (drip?.drillDown.mode === 'inline') {
        expect(drip.drillDown.transactionIds.length).toBeGreaterThan(0);
      }
    });

    it('omits absent filter keys rather than setting them undefined', () => {
      const trend = cardsFor(richHistory()).find(c => c.kind === 'categoryTrend')!;
      if (trend.drillDown.mode === 'filters') {
        expect('minAmount' in trend.drillDown.filters).toBeFalse();
        expect('currency' in trend.drillDown.filters).toBeFalse();
      }
    });
  });

  describe('gates', () => {
    it('emits no cards for an empty history', () => {
      expect(cardsFor([])).toEqual([]);
    });

    it('emits no habit cards below the transaction gate', () => {
      const sparse = Array.from({ length: 5 }, (_, i) =>
        expense(new Date(2026, 0, i + 1), 10));
      const kinds = cardsFor(sparse).map(c => c.kind);
      expect(kinds).not.toContain('habitWeekdayWeekend');
      expect(kinds).not.toContain('habitMonthEnd');
      expect(kinds).not.toContain('habitPayday');
    });

    it('caps the number of trend cards independently of the detector', () => {
      const { facts, drillDownIds } = computeInsightFacts({
        transactions: richHistory(), toBase, window, months,
        baseCurrency: 'USD', timeZone: 'Asia/Taipei',
      });
      const cards = buildInsightCards(facts, drillDownIds, false, { trendCap: 1 });
      expect(cards.filter(c => c.kind === 'categoryTrend').length).toBeLessThanOrEqual(1);
    });
  });

  describe('ordering', () => {
    it('puts the recurring portfolio first', () => {
      expect(cardsFor(richHistory())[0].kind).toBe('recurringPortfolio');
    });

    it('orders by weight then id, so ties are not incidental', () => {
      const cards = cardsFor(richHistory());
      for (let i = 1; i < cards.length; i += 1) {
        const previous = cards[i - 1];
        const current = cards[i];
        expect(previous.weight >= current.weight).toBeTrue();
        if (previous.weight === current.weight) {
          expect(previous.id <= current.id).toBeTrue();
        }
      }
    });

    it('sortInsightCards reproduces the builder order', () => {
      const cards = cardsFor(richHistory());
      expect(sortInsightCards([...cards].reverse())).toEqual(cards);
    });
  });

  describe('toStorableCards', () => {
    it('drops inline id lists, which snapshots deliberately do not keep', () => {
      const mixed = [
        ...richHistory(),
        expense(new Date(2026, 2, 9), 500, { currency: 'JPY' }),
      ];
      const cards = cardsFor(mixed);
      expect(cards.some(c => c.drillDown.mode === 'inline')).toBeTrue();

      const stored = toStorableCards(cards);
      expect(stored.some(c => c.drillDown.mode === 'inline')).toBeFalse();
      expect(JSON.stringify(stored)).not.toContain('transactionIds');
    });

    it('keeps filter drill-downs, which stay meaningful on an old snapshot', () => {
      const stored = toStorableCards(cardsFor(richHistory()));
      const trend = stored.find(c => c.kind === 'categoryTrend')!;
      expect(trend.drillDown.mode).toBe('filters');
    });

    it('leaves everything else on the card untouched', () => {
      const cards = cardsFor(richHistory());
      const stored = toStorableCards(cards);
      expect(stored.map(c => c.id)).toEqual(cards.map(c => c.id));
      expect(stored.map(c => c.metrics)).toEqual(cards.map(c => c.metrics));
    });

    it('produces cards Firestore will accept', () => {
      expect(findSerializationIssues(toStorableCards(cardsFor(richHistory())))).toEqual([]);
    });
  });

  describe('buildInsightCards on a frozen fact bundle', () => {
    it('works with no drill-down ids, as when re-rendering a snapshot', () => {
      const { facts } = computeInsightFacts({
        transactions: richHistory(), toBase, window, months,
        baseCurrency: 'USD', timeZone: 'Asia/Taipei',
      });
      const cards = buildInsightCards(facts as InsightFacts);
      expect(cards.length).toBeGreaterThan(0);
      // Inline drill-downs degrade to none rather than to an empty list.
      expect(cards.every(c => c.drillDown.mode !== 'inline')).toBeTrue();
    });
  });
});
