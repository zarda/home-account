import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NlSearchService } from './nl-search.service';
import { AIStrategyService } from './ai-strategy.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { SearchHistoryService } from './search-history.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { SearchIntent, Transaction, User } from '../../models';
import { createCategory, createTransaction, createUser } from './testing/test-data';

describe('NlSearchService', () => {
  let service: NlSearchService;
  let aiStrategy: { canUseCloud: jasmine.Spy };
  let pwaService: { isOnline: jasmine.Spy };
  let cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService>;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let searchHistory: jasmine.SpyObj<SearchHistoryService>;

  function expense(amount: number, categoryId: string, overrides: Partial<Transaction> = {}): Transaction {
    return createTransaction({
      type: 'expense', amount, categoryId, amountInBaseCurrency: amount, ...overrides,
    });
  }

  function mockIntent(intent: SearchIntent): void {
    cloudLLMProvider.interpretSearchQuery.and.resolveTo(intent);
  }

  beforeEach(() => {
    aiStrategy = { canUseCloud: jasmine.createSpy('canUseCloud').and.returnValue(true) };
    pwaService = { isOnline: jasmine.createSpy('isOnline').and.returnValue(true) };
    cloudLLMProvider = jasmine.createSpyObj('CloudLLMProviderService', ['interpretSearchQuery']);
    transactionService = jasmine.createSpyObj('TransactionService', ['getTransactionsInRange']);
    transactionService.getTransactionsInRange.and.returnValue(of([]));
    searchHistory = jasmine.createSpyObj('SearchHistoryService', ['recordRecent']);
    searchHistory.recordRecent.and.resolveTo();

    const categoryService = jasmine.createSpyObj('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([
      createCategory({ id: 'food', name: 'Food & Drinks', type: 'expense' }),
      createCategory({ id: 'food_groceries', name: 'Groceries', type: 'expense', parentId: 'food' }),
      createCategory({ id: 'food_restaurants', name: 'Restaurants', type: 'expense', parentId: 'food' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
      createCategory({ id: 'pets', name: 'Pets', type: 'expense' }),
      createCategory({ id: 'employment', name: 'Employment', type: 'income' }),
      createCategory({ id: 'dormant', name: 'Dormant', type: 'expense', isActive: false }),
    ]);

    const currencyService = jasmine.createSpyObj('CurrencyService', ['amountInBase']);
    currencyService.amountInBase.and.callFake(
      (t: Transaction) => t.amountInBaseCurrency ?? t.amount);

    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => key);

    const authService = {
      currentUser: () => createUser({
        preferences: { baseCurrency: 'USD' } as User['preferences'],
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        NlSearchService,
        { provide: AIStrategyService, useValue: aiStrategy },
        { provide: PwaService, useValue: pwaService },
        { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
        { provide: AuthService, useValue: authService },
        { provide: SearchHistoryService, useValue: searchHistory },
      ],
    });

    service = TestBed.inject(NlSearchService);
  });

  describe('context sent to the model', () => {
    it('contains today, the base currency and the active catalog with parent-prefixed children', async () => {
      mockIntent({ kind: 'filter', filters: {} });
      await service.search('anything');

      const context = cloudLLMProvider.interpretSearchQuery.calls.mostRecent().args[1];
      expect(context.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(context.baseCurrency).toBe('USD');
      const groceries = context.categories.find(c => c.id === 'food_groceries');
      expect(groceries?.name).toBe('Food & Drinks / Groceries');
      expect(context.categories.some(c => c.id === 'dormant')).toBeFalse();
    });
  });

  describe('filter-shaped queries', () => {
    it('"show coffee purchases last month" returns the interpreted filters unchanged', async () => {
      const filters = {
        categoryId: 'food',
        startDate: new Date(2026, 5, 1),
        endDate: new Date(2026, 5, 30),
      };
      mockIntent({ kind: 'filter', filters });

      const result = await service.search('show coffee purchases last month');

      expect(result).toEqual({ kind: 'filter', filters });
      expect(searchHistory.recordRecent).not.toHaveBeenCalled();
    });

    it('"groceries over $50 this month" keeps the amount bound', async () => {
      mockIntent({ kind: 'filter', filters: { categoryId: 'food_groceries', minAmount: 50 } });
      const result = await service.search('groceries over $50 this month');
      expect(result.kind).toBe('filter');
      if (result.kind === 'filter') {
        expect(result.filters.minAmount).toBe(50);
      }
    });

    it('"salary income this year" carries the income type', async () => {
      mockIntent({ kind: 'filter', filters: { type: 'income', startDate: new Date(2026, 0, 1) } });
      const result = await service.search('salary income this year');
      if (result.kind === 'filter') {
        expect(result.filters.type).toBe('income');
      }
    });

    it('「先月のコンビニ」 keeps the untranslated keyword', async () => {
      mockIntent({
        kind: 'filter',
        filters: {
          searchQuery: 'コンビニ',
          startDate: new Date(2026, 5, 1),
          endDate: new Date(2026, 5, 30),
        },
      });
      const result = await service.search('先月のコンビニ');
      if (result.kind === 'filter') {
        expect(result.filters.searchQuery).toBe('コンビニ');
      }
    });
  });

  describe('aggregate questions', () => {
    it('"how much did I spend on food in June" sums the parent category including child rows', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(50, 'food_groceries'),
        expense(30, 'food_restaurants'),
        expense(20, 'food'),
        expense(40, 'transport'),
        createTransaction({ type: 'income', amount: 1000, categoryId: 'employment', amountInBaseCurrency: 1000 }),
      ]));
      mockIntent({
        kind: 'aggregate',
        operation: 'sum',
        filters: { categoryId: 'food', startDate: new Date(2026, 5, 1), endDate: new Date(2026, 5, 30) },
        limit: 3,
      });

      const result = await service.search('how much did I spend on food in June');

      expect(result.kind).toBe('answer');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(100);
        expect(result.answer.currency).toBe('USD');
        expect(result.answer.transactionCount).toBe(3);
      }
    });

    it('sums across currencies in base-currency terms', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(50, 'food'),
        expense(1000, 'food', { currency: 'JPY', amountInBaseCurrency: 7 }),
      ]));
      mockIntent({ kind: 'aggregate', operation: 'sum', filters: { categoryId: 'food' }, limit: 3 });

      const result = await service.search('total food spending');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(57);
      }
    });

    it('"how many transactions last week" counts without a currency', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(5, 'food'), expense(6, 'transport'), expense(7, 'pets'),
        createTransaction({ type: 'income', amount: 10, categoryId: 'employment' }),
      ]));
      mockIntent({
        kind: 'aggregate',
        operation: 'count',
        filters: { startDate: new Date(2026, 6, 13), endDate: new Date(2026, 6, 19) },
        limit: 3,
      });

      const result = await service.search('how many transactions last week');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(4);
        expect(result.answer.currency).toBeUndefined();
      }
    });

    it('"average restaurant bill this year" divides sum by count', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(30, 'food_restaurants'),
        expense(50, 'food_restaurants'),
        expense(999, 'transport'),
      ]));
      mockIntent({
        kind: 'aggregate',
        operation: 'average',
        filters: { categoryId: 'food_restaurants' },
        limit: 3,
      });

      const result = await service.search('average restaurant bill this year');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(40);
        expect(result.answer.transactionCount).toBe(2);
      }
    });

    it('"biggest expense in May" returns the actual extreme transaction', async () => {
      const biggest = expense(90, 'transport', { description: 'Flight home' });
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(20, 'food'), biggest, expense(40, 'pets'),
      ]));
      mockIntent({
        kind: 'aggregate',
        operation: 'max',
        filters: { type: 'expense', startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 31) },
        limit: 3,
      });

      const result = await service.search('biggest expense in May');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(90);
        expect(result.answer.extremeTransaction?.description).toBe('Flight home');
      }
    });

    it('"top 3 spending categories" rolls children up to their parent', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([
        expense(50, 'food_groceries'),
        expense(30, 'food_restaurants'),
        expense(40, 'transport'),
        expense(10, 'pets'),
      ]));
      mockIntent({ kind: 'aggregate', operation: 'topCategories', filters: {}, limit: 2 });

      const result = await service.search('top 3 spending categories this month');
      if (result.kind === 'answer') {
        expect(result.answer.groups).toEqual([
          { categoryId: 'food', total: 80 },
          { categoryId: 'transport', total: 40 },
        ]);
        expect(result.answer.value).toBe(80);
      }
    });

    it('defaults a date-less aggregate to the current month and echoes it in the scope', async () => {
      mockIntent({ kind: 'aggregate', operation: 'sum', filters: {}, limit: 3 });

      const result = await service.search('how much did I spend');

      const now = new Date();
      const expectedStart = new Date(now.getFullYear(), now.getMonth(), 1);
      if (result.kind === 'answer') {
        expect(result.answer.scope.startDate).toEqual(expectedStart);
        expect(result.answer.scope.endDate?.getMonth()).toBe(now.getMonth());
      }
      const [fetchStart] = transactionService.getTransactionsInRange.calls.mostRecent().args;
      expect(fetchStart).toEqual(expectedStart);
    });

    it('reports zero matches without inventing a value', async () => {
      transactionService.getTransactionsInRange.and.returnValue(of([]));
      mockIntent({ kind: 'aggregate', operation: 'average', filters: {}, limit: 3 });

      const result = await service.search('average of nothing');
      if (result.kind === 'answer') {
        expect(result.answer.value).toBe(0);
        expect(result.answer.transactionCount).toBe(0);
      }
    });
  });

  describe('fallbacks', () => {
    it('falls back to keyword search when offline, without calling the provider', async () => {
      aiStrategy.canUseCloud.and.returnValue(false);
      pwaService.isOnline.and.returnValue(false);

      const result = await service.search('coffee');

      expect(result).toEqual({
        kind: 'keywordFallback',
        filters: { searchQuery: 'coffee' },
        reason: 'offline',
      });
      expect(cloudLLMProvider.interpretSearchQuery).not.toHaveBeenCalled();
      expect(searchHistory.recordRecent).toHaveBeenCalledWith('coffee');
    });

    it('reports noProvider when online but unconfigured', async () => {
      aiStrategy.canUseCloud.and.returnValue(false);
      pwaService.isOnline.and.returnValue(true);

      const result = await service.search('coffee');
      expect(result.kind).toBe('keywordFallback');
      if (result.kind === 'keywordFallback') {
        expect(result.reason).toBe('noProvider');
      }
    });

    it('falls back to keyword search when interpretation throws', async () => {
      cloudLLMProvider.interpretSearchQuery.and.rejectWith(new Error('malformed JSON'));

      const result = await service.search('what is my biggest bill');

      expect(result.kind).toBe('keywordFallback');
      if (result.kind === 'keywordFallback') {
        expect(result.reason).toBe('error');
        expect(result.filters.searchQuery).toBe('what is my biggest bill');
      }
      expect(searchHistory.recordRecent).toHaveBeenCalled();
    });

    it('falls back when the aggregate fetch fails', async () => {
      transactionService.getTransactionsInRange.and.returnValue(
        throwError(() => new Error('firestore down')));
      mockIntent({ kind: 'aggregate', operation: 'sum', filters: {}, limit: 3 });

      const result = await service.search('total spend');
      expect(result.kind).toBe('keywordFallback');
    });
  });
});
