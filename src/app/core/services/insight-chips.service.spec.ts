import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { InsightChipsService } from './insight-chips.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { Category, CategoryTotal, Transaction, User } from '../../models';
import { createCategory, createTimestamp, createTransaction, createUser } from './testing/test-data';
import { TranslationStub, createTranslationStub } from './testing/translation-stub';

describe('InsightChipsService', () => {
  let service: InsightChipsService;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let categories: WritableSignal<Category[]>;
  let currencyService: jasmine.SpyObj<CurrencyService>;
  let translation: TranslationStub;
  // What every key reads through: '' is the echo catalog the cases assert on;
  // `switchCatalog` moves to another one the way a language change does.
  let catalog: string;

  /** Reads every key through `prefix` from now on and bumps the catalog version. */
  function switchCatalog(prefix: string): void {
    catalog = prefix;
    translation.translationsVersion.update(version => version + 1);
  }

  const now = new Date();
  const currentDate = new Date(now.getFullYear(), now.getMonth(), 15);
  const pastDate = (monthsAgo: number) =>
    new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5);

  function expense(
    amount: number,
    categoryId: string,
    date: Date,
    overrides: Partial<Transaction> = {},
  ): Transaction {
    return createTransaction({
      type: 'expense',
      amount,
      categoryId,
      amountInBaseCurrency: amount,
      date: createTimestamp(date),
      ...overrides,
    });
  }

  /**
   * Varied past baseline for one category: alternating 10/20 across the
   * trailing window, enough samples that a 100 outlier lands above
   * mean + 2*stddev even with itself included in the baseline.
   */
  function baselineFor(categoryId: string): Transaction[] {
    return [10, 20, 10, 20, 10, 20].map((amount, i) =>
      expense(amount, categoryId, pastDate((i % 3) + 1)));
  }

  function setup(
    expenses: Transaction[],
    previousByCategory: CategoryTotal[] = [],
  ): void {
    transactionService.getExpensesInRange.and.returnValue(of(expenses));
    transactionService.getPeriodCategoryTotals.and.returnValue(
      of({ income: 0, expense: 0, byCategory: previousByCategory })
    );
    service.load();
  }

  beforeEach(() => {
    transactionService = jasmine.createSpyObj('TransactionService', [
      'getExpensesInRange',
      'getPeriodCategoryTotals',
    ]);
    categories = signal([
      createCategory({ id: 'food', name: 'Food', type: 'expense' }),
      createCategory({ id: 'pets', name: 'Pets', type: 'expense' }),
      createCategory({ id: 'transport', name: 'Transport', type: 'expense' }),
    ]);
    currencyService = jasmine.createSpyObj('CurrencyService', ['amountInBase']);
    currencyService.amountInBase.and.callFake(
      (t: Transaction) => t.amountInBaseCurrency ?? t.amount);
    catalog = '';
    translation = createTranslationStub({
      t: jasmine.createSpy('t').and.callFake((key: string) => `${catalog}${key}`),
    });
    const authService = {
      currentUser: () => createUser({
        preferences: { baseCurrency: 'USD' } as User['preferences'],
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        InsightChipsService,
        { provide: TransactionService, useValue: transactionService },
        { provide: CategoryService, useValue: { categories } },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translation },
        { provide: AuthService, useValue: authService },
      ],
    });

    service = TestBed.inject(InsightChipsService);
  });

  it('builds an anomaly chip scoped to the category and current month', () => {
    const outlier = expense(100, 'food', currentDate);
    setup([...baselineFor('food'), outlier]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    const chip = chips[0];
    expect(chip.kind).toBe('anomaly');
    expect(chip.id).toBe('anomaly:food');
    expect(chip.labelKey).toBe('transactions.chipUnusual');
    expect(chip.labelParams['category']).toBe('Food');
    expect(chip.filters.type).toBe('expense');
    expect(chip.filters.categoryId).toBe('food');
    expect(chip.filters.startDate?.getDate()).toBe(1);
    expect(chip.filters.endDate?.getMonth()).toBe(now.getMonth());
  });

  it('narrows the anomaly chip by amount when the category is single-currency', () => {
    const outlier = expense(100, 'food', currentDate);
    setup([...baselineFor('food'), outlier]);

    const chip = service.chips()[0];
    expect(chip.filters.minAmount).toBeDefined();
    expect(chip.filters.minAmount!).toBeLessThan(100);
    expect(chip.filters.minAmount!).toBeGreaterThan(20);
  });

  it('omits minAmount when the category mixes currencies this month', () => {
    const outlier = expense(100, 'food', currentDate);
    const foreignRow = expense(1000, 'food', currentDate, {
      currency: 'JPY',
      amountInBaseCurrency: 7,
    });
    setup([...baselineFor('food'), outlier, foreignRow]);

    const chip = service.chips().find(c => c.kind === 'anomaly');
    expect(chip).toBeDefined();
    expect(chip!.filters.minAmount).toBeUndefined();
  });

  it('builds a chip for a category that is new this month', () => {
    setup(
      [expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );

    const chip = service.chips().find(c => c.kind === 'newCategory');
    expect(chip).toBeDefined();
    expect(chip!.id).toBe('new:pets');
    expect(chip!.labelParams['category']).toBe('Pets');
    expect(chip!.filters.categoryId).toBe('pets');
  });

  // #488: two categories new this month with the same change name the lower
  // id on every load, not whichever the expense rows listed first.
  it('names the lower category id when two new categories tie', () => {
    setup(
      [expense(30, 'transport', currentDate), expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );

    const chips = service.chips();
    expect(chips.length).toBe(1);
    expect(chips[0].kind).toBe('newCategory');
    expect(chips[0].id).toBe('new:pets');
    expect(chips[0].labelParams['category']).toBe('Pets');
    expect(chips[0].filters.categoryId).toBe('pets');
  });

  it('builds a top-category chip only with at least 3 transactions', () => {
    setup([
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
      expense(50, 'transport', currentDate),
    ]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    expect(chips[0].kind).toBe('topCategory');
    expect(chips[0].filters.categoryId).toBe('food');
  });

  // #438 P4: the top category comes from the shared fold, so an exact tie
  // names the same category on every load instead of whichever arrived first.
  it('names the lower category id when two categories tie for the top', () => {
    setup([
      expense(30, 'transport', currentDate),
      expense(30, 'transport', currentDate),
      expense(30, 'transport', currentDate),
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
      expense(30, 'food', currentDate),
    ]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    expect(chips[0].id).toBe('top:food');
    expect(chips[0].labelParams['category']).toBe('Food');
  });

  // A category the catalog cannot name (deleted, or from another device) is
  // shown, so the chip reads the transaction list's Unknown key (the stub
  // echoes keys), never a literal English word and never the catch-all's own
  // name.
  it('names a chip for a category the catalog lacks by the Unknown key', () => {
    setup([
      expense(30, 'deleted-custom', currentDate),
      expense(30, 'deleted-custom', currentDate),
      expense(30, 'deleted-custom', currentDate),
    ]);

    const chips = service.chips();
    expect(chips.length).toBe(1);
    expect(chips[0].id).toBe('top:deleted-custom');
    expect(chips[0].labelParams['category']).toBe('common.unknownCategory');
  });

  it('skips the top-category chip below 3 transactions', () => {
    setup([expense(30, 'food', currentDate), expense(20, 'food', currentDate)]);
    expect(service.chips().length).toBe(0);
  });

  // #488: three categories flag an outlier of the same amount and the cap is
  // two chips, so the row id decides which category goes without. The rows
  // arrive in descending id order, so the arrival order would name food.
  it('names the categories of the lowest row ids when anomalies tie at the cap', () => {
    setup([
      ...baselineFor('food'),
      ...baselineFor('pets'),
      ...baselineFor('transport'),
      expense(100, 'food', currentDate, { id: 'row-c' }),
      expense(100, 'pets', currentDate, { id: 'row-b' }),
      expense(100, 'transport', currentDate, { id: 'row-a' }),
    ]);

    expect(service.chips().map(c => c.id)).toEqual(['anomaly:transport', 'anomaly:pets']);
  });

  it('orders anomaly chips before the others', () => {
    const outlier = expense(100, 'food', currentDate);
    setup(
      [...baselineFor('food'), outlier, expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );

    const kinds = service.chips().map(c => c.kind);
    expect(kinds[0]).toBe('anomaly');
    expect(kinds).toContain('newCategory');
  });

  it('returns no chips when the current month has no expenses', () => {
    setup(baselineFor('food'));
    expect(service.chips()).toEqual([]);
  });

  // ADR 0182: a language switched while the page is open renamed the sentence
  // around the category but not the category inside it, which was translated
  // once, when the chips were found.
  it("names a chip's category in the language now showing", () => {
    setup(
      [expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );
    const named = () => service.chips().find(c => c.kind === 'newCategory')?.labelParams['category'];
    expect(named()).toBe('Pets');

    switchCatalog('ja:');

    expect(named()).toBe('ja:Pets');
  });

  // The same freeze: chips found before the categories arrived kept the name
  // for an id the catalog lacks until the next Firestore emission.
  it("names a chip's category once the catalog of categories arrives", () => {
    const loaded = categories();
    categories.set([]);
    setup(
      [expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );
    const named = () => service.chips().find(c => c.kind === 'newCategory')?.labelParams['category'];
    expect(named()).toBe('common.unknownCategory');

    categories.set(loaded);

    expect(named()).toBe('Pets');
  });

  // A switch renames; it does not analyse again or read Firestore again.
  it('keeps the chips, their filters and their order across a catalog switch', () => {
    setup(
      [...baselineFor('food'), expense(100, 'food', currentDate), expense(30, 'pets', currentDate)],
      [{ categoryId: 'food', total: 40 }]
    );
    const shape = () => service.chips().map(({ id, kind, labelKey, icon, filters }) =>
      ({ id, kind, labelKey, icon, filters }));
    const before = shape();
    expect(before.map(c => c.id)).toEqual(['anomaly:food', 'new:pets']);

    switchCatalog('ja:');

    expect(shape()).toEqual(before);
    expect(transactionService.getExpensesInRange).toHaveBeenCalledTimes(1);
    expect(transactionService.getPeriodCategoryTotals).toHaveBeenCalledTimes(1);
  });

  it('returns no chips when loading fails', () => {
    transactionService.getExpensesInRange.and.returnValue(
      throwError(() => new Error('offline')));
    transactionService.getPeriodCategoryTotals.and.returnValue(
      of({ income: 0, expense: 0, byCategory: [] }));
    service.load();
    expect(service.chips()).toEqual([]);
    expect(service.isLoading()).toBeFalse();
  });
});
