import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { WeeklyRecapService } from './weekly-recap.service';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CategoryService } from './category.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { CurrencyService } from './currency.service';
import { TransactionService } from './transaction.service';
import { SupportedLocale, TranslationService } from './translation.service';
import { createMockUser } from './testing/mock-auth.service';
import { ANALYTICS_EVENTS } from '../config/analytics-events';
import { fnv1a32 } from '../utils/transaction-aggregation.utils';
import { dayKey } from '../utils/transaction-date.utils';
import { weeklyRecapStorageKeys } from '../utils/weekly-recap.utils';
import {
  Category,
  DEFAULT_USER_PREFERENCES,
  LLMProvider,
  Transaction,
  User,
  UserPreferences,
} from '../../models';

const USER_ID = 'user-1';

/**
 * A Wednesday, 10:00 local — clear of both midnight boundaries in either
 * zone the dated suite runs under. The week it recaps is Mon 24 to Sun 30
 * August, and the one before that opens on Mon 17 August.
 */
const NOW = new Date(2026, 8, 2, 10, 0, 0);
const RECAP_WEEK = '2026-08-24';
const NEXT_RECAP_WEEK = '2026-08-31';

/**
 * Turn the microtask queue until the composition and the narrative have
 * settled. jasmine.clock() replaces setTimeout, so a timer-based flush would
 * never resolve; every await on these paths is on an already-settled promise.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('WeeklyRecapService', () => {
  let service: WeeklyRecapService;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let categories: ReturnType<typeof signal<Category[]>>;
  let locale: ReturnType<typeof signal<SupportedLocale>>;
  let hasProvider: ReturnType<typeof signal<boolean>>;
  let provider: ReturnType<typeof signal<LLMProvider | null>>;
  let transactions: jasmine.SpyObj<TransactionService>;
  let amountInBase: jasmine.Spy;
  let generateNarrative: jasmine.Spy;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  /** Rows each window query answers with, keyed by the window's first day. */
  let rowsByWeek: Map<string, Transaction[]>;

  const storage = weeklyRecapStorageKeys(USER_ID);

  function setPreferences(prefs: Partial<UserPreferences>): void {
    currentUser.set(
      createMockUser(USER_ID, {
        preferences: { ...DEFAULT_USER_PREFERENCES, baseCurrency: 'EUR', ...prefs },
      })
    );
  }

  function transaction(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: 'tx-1',
      userId: USER_ID,
      type: 'expense',
      amount: 20,
      currency: 'EUR',
      amountInBaseCurrency: 20,
      exchangeRate: 1,
      categoryId: 'cat-food',
      description: 'Lunch',
      isRecurring: false,
      date: Timestamp.fromDate(new Date(2026, 7, 25)),
      createdAt: Timestamp.fromDate(new Date(2026, 7, 25)),
      updatedAt: Timestamp.fromDate(new Date(2026, 7, 25)),
      ...overrides,
    };
  }

  function category(overrides: Partial<Category> = {}): Category {
    return {
      id: 'cat-food',
      userId: null,
      name: 'categoryNames.food',
      icon: 'restaurant',
      color: '#000000',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: true,
      ...overrides,
    };
  }

  /** The windows the service actually queried, as `start..end` day keys. */
  function queriedWindows(): string[] {
    return transactions.getTransactionsInRangeOnce.calls
      .allArgs()
      .map(([start, end]) => `${dayKey(start as Date)}..${dayKey(end as Date)}`);
  }

  function readNarrativeCache(): { key?: string; text?: string } | null {
    const raw = localStorage.getItem(storage.narrative);
    return raw ? JSON.parse(raw) : null;
  }

  /** Run the constructor effects, then let the narrative finish. */
  async function tick(): Promise<void> {
    TestBed.tick();
    await settle();
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(NOW);
    localStorage.removeItem(storage.dismissed);
    localStorage.removeItem(storage.narrative);

    rowsByWeek = new Map([
      ['2026-08-24', [transaction()]],
      ['2026-08-17', [transaction({ id: 'tx-0', amount: 10, amountInBaseCurrency: 10 })]],
    ]);

    currentUser = signal<User | null>(null);
    categories = signal<Category[]>([category()]);
    locale = signal<SupportedLocale>('en');
    hasProvider = signal(true);
    provider = signal<LLMProvider | null>('gemini');

    transactions = jasmine.createSpyObj<TransactionService>('TransactionService', [
      'getTransactionsInRangeOnce',
      'getByDateRange',
    ]);
    transactions.getTransactionsInRangeOnce.and.callFake((start: Date) =>
      Promise.resolve(rowsByWeek.get(dayKey(start)) ?? [])
    );

    // Answers from the row's own amount, so a spent figure is the sum of what
    // was seeded; the base currency it was asked for is asserted separately.
    amountInBase = jasmine.createSpy('amountInBase').and.callFake((tx: Transaction) => tx.amount);

    generateNarrative = jasmine.createSpy('generatePatternNarrative').and.resolveTo('A quiet week.');

    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['trackAiAssistUsed']);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser,
            // Derived the way the real computed is, so a test that signs an
            // account in cannot leave the two disagreeing.
            userId: computed(() => currentUser()?.id ?? null),
          },
        },
        { provide: TransactionService, useValue: transactions },
        { provide: CurrencyService, useValue: { amountInBase } },
        { provide: CategoryService, useValue: { categories } },
        { provide: TranslationService, useValue: { currentLocale: locale, t: (key: string) => `EN:${key}` } },
        {
          provide: CloudLLMProviderService,
          useValue: {
            // Signals rather than spies: availability is read through a
            // computed, which a double answering from a captured boolean
            // would never invalidate.
            hasAnyCloudProvider: hasProvider,
            resolveProvider: (feature: string) => (feature === 'insights' ? provider() : null),
            generatePatternNarrative: generateNarrative,
          },
        },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });

    setPreferences({ enableWeeklyRecap: true, ragInsightsLevel: 'standard' });
  });

  afterEach(() => {
    localStorage.removeItem(storage.dismissed);
    localStorage.removeItem(storage.narrative);
    jasmine.clock().uninstall();
  });

  /**
   * A fresh instance rather than the root singleton, so a test can stand a
   * second one up beside it and watch what a new session reads from storage.
   */
  function createService(): WeeklyRecapService {
    service = TestBed.runInInjectionContext(() => new WeeklyRecapService());
    return service;
  }

  describe('load', () => {
    it('reads the recapped week and the one before it, one shot each', async () => {
      await createService().load();

      expect(queriedWindows()).toEqual([
        '2026-08-24..2026-08-30',
        '2026-08-17..2026-08-23',
      ]);
      // The live listener publishes the dashboard's shared signal; a recap
      // that used it would rewrite what the page is already showing.
      expect(transactions.getByDateRange).not.toHaveBeenCalled();
    });

    it('folds both weeks in the account base currency', async () => {
      await createService().load();

      expect(service.figures()).toEqual(
        jasmine.objectContaining({ spend: 20, count: 1, previousSpend: 10, spendDelta: 1 })
      );
      expect(service.status()).toBe('ready');
      expect(amountInBase).toHaveBeenCalledWith(jasmine.anything(), 'EUR');
    });

    it('composes nothing while the preference is off', async () => {
      setPreferences({});

      await createService().load();

      expect(transactions.getTransactionsInRangeOnce).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
      expect(service.visible()).toBeFalse();
    });

    it('composes nothing while nobody is signed in', async () => {
      currentUser.set(null);

      await createService().load();

      expect(transactions.getTransactionsInRangeOnce).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
    });

    it('composes nothing for a week already dismissed on this device', async () => {
      localStorage.setItem(storage.dismissed, RECAP_WEEK);

      await createService().load();

      expect(transactions.getTransactionsInRangeOnce).not.toHaveBeenCalled();
      expect(service.dismissedWeek()).toBe(RECAP_WEEK);
      expect(service.visible()).toBeFalse();
    });

    it('reads nothing on a second load in the same week', async () => {
      const recap = createService();
      await recap.load();
      await recap.load();

      expect(transactions.getTransactionsInRangeOnce).toHaveBeenCalledTimes(2);
    });

    it('shares one pair of reads between concurrent loads', async () => {
      const recap = createService();
      await Promise.all([recap.load(), recap.load(), recap.load()]);

      expect(transactions.getTransactionsInRangeOnce).toHaveBeenCalledTimes(2);
      expect(recap.status()).toBe('ready');
    });

    it('reads again once a new week has begun', async () => {
      const recap = createService();
      await recap.load();
      expect(recap.weekKey()).toBe(RECAP_WEEK);

      jasmine.clock().mockDate(new Date(2026, 8, 9, 10, 0, 0));
      await recap.load();

      expect(recap.weekKey()).toBe(NEXT_RECAP_WEEK);
      expect(queriedWindows().slice(2)).toEqual([
        '2026-08-31..2026-09-06',
        '2026-08-24..2026-08-30',
      ]);
    });

    it('reports a failed read rather than an empty week', async () => {
      transactions.getTransactionsInRangeOnce.and.rejectWith(new Error('offline'));

      await createService().load();

      expect(service.status()).toBe('failed');
      expect(service.figures()).toBeNull();
      expect(service.visible()).toBeFalse();
    });

    it('treats an unreadable store as not dismissed', async () => {
      spyOn(localStorage, 'getItem').and.throwError('SecurityError');

      await createService().load();

      expect(service.dismissedWeek()).toBeNull();
      expect(service.visible()).toBeTrue();
    });
  });

  describe('visibility', () => {
    it('stays hidden when neither week had anything to say', async () => {
      rowsByWeek.clear();

      await createService().load();

      expect(service.status()).toBe('ready');
      expect(service.visible()).toBeFalse();
    });

    it('shows an empty week that follows one with spending', async () => {
      rowsByWeek.delete('2026-08-24');

      await createService().load();

      expect(service.figures()?.count).toBe(0);
      expect(service.visible()).toBeTrue();
    });

    it('hides the card for the dismissed week and stores it', async () => {
      const recap = createService();
      await recap.load();
      expect(recap.visible()).toBeTrue();

      recap.dismiss();

      expect(recap.visible()).toBeFalse();
      expect(localStorage.getItem(storage.dismissed)).toBe(RECAP_WEEK);
    });

    it('shows again once the next week is being recapped', async () => {
      const recap = createService();
      await recap.load();
      recap.dismiss();

      jasmine.clock().mockDate(new Date(2026, 8, 9, 10, 0, 0));
      rowsByWeek.set('2026-08-31', [transaction({ id: 'tx-2' })]);
      await recap.load();

      expect(recap.visible()).toBeTrue();
    });
  });

  describe('the narrative', () => {
    it('waits for the categories before building the context', async () => {
      categories.set([]);
      const recap = createService();
      await recap.load();
      await tick();

      expect(generateNarrative).not.toHaveBeenCalled();

      categories.set([category()]);
      await tick();

      expect(generateNarrative).toHaveBeenCalledTimes(1);
      const [context, sentLocale] = generateNarrative.calls.mostRecent().args;
      expect(context).toContain('Period: 2026-08-24 to 2026-08-30');
      expect(context).toContain('Currency: EUR');
      expect(context).toContain('Category "EN:categoryNames.food"');
      expect(sentLocale).toBe('en');
      expect(recap.narrative()).toBe('A quiet week.');
      expect(recap.narrativeStatus()).toBe('ready');
    });

    it('is skipped when no cloud provider could answer', async () => {
      hasProvider.set(false);

      await createService().load();
      await tick();

      expect(generateNarrative).not.toHaveBeenCalled();
      expect(service.narrative()).toBe('');
    });

    it('is skipped while RAG grounding is off', async () => {
      setPreferences({ enableWeeklyRecap: true, ragInsightsLevel: 'off' });

      await createService().load();
      await tick();

      expect(generateNarrative).not.toHaveBeenCalled();
    });

    it('is skipped when the week has nothing to say', async () => {
      rowsByWeek.clear();

      await createService().load();
      await tick();

      expect(generateNarrative).not.toHaveBeenCalled();
      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
    });

    it('caches what came back under the week, the figures, the locale and the provider', async () => {
      await createService().load();
      await tick();

      const [context] = generateNarrative.calls.mostRecent().args;
      expect(readNarrativeCache()).toEqual({
        key: `${RECAP_WEEK}:${fnv1a32(context as string)}:en:gemini`,
        text: 'A quiet week.',
      });
    });

    it('answers a cached week without calling a provider', async () => {
      await createService().load();
      await tick();
      expect(generateNarrative).toHaveBeenCalledTimes(1);

      analytics.trackAiAssistUsed.calls.reset();
      const cached = createService();
      await cached.load();
      await tick();

      expect(generateNarrative).toHaveBeenCalledTimes(1);
      expect(cached.narrative()).toBe('A quiet week.');
      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
    });

    it('generates again once the figures have moved', async () => {
      const recap = createService();
      await recap.load();
      await tick();

      recap.figures.set({ ...recap.figures()!, spend: 99 });
      await tick();

      expect(generateNarrative).toHaveBeenCalledTimes(2);
    });

    it('asks once while a generation is already in flight', async () => {
      let release: (text: string) => void = () => undefined;
      generateNarrative.and.returnValue(new Promise<string>(resolve => (release = resolve)));

      const recap = createService();
      await recap.load();
      await tick();
      expect(generateNarrative).toHaveBeenCalledTimes(1);

      // The rest of the category list landing re-runs the effect. Nothing the
      // context says has changed, so the request already out is the answer.
      categories.set([category(), category({ id: 'cat-rent', name: 'categoryNames.rent' })]);
      await tick();

      expect(generateNarrative).toHaveBeenCalledTimes(1);
      release('A quiet week.');
      await settle();
      expect(recap.narrative()).toBe('A quiet week.');
    });

    it('caches nothing when the provider fails', async () => {
      generateNarrative.and.rejectWith(new Error('rate limited'));

      await createService().load();
      await tick();

      expect(service.narrative()).toBe('');
      expect(service.narrativeStatus()).toBe('failed');
      expect(readNarrativeCache()).toBeNull();
    });

    it('counts one assist for the request it actually issued', async () => {
      await createService().load();
      await tick();

      expect(analytics.trackAiAssistUsed).toHaveBeenCalledOnceWith({ feature: 'recap' });
    });

    it('clears a generated narrative once grounding turns off', async () => {
      const recap = createService();
      await recap.load();
      await tick();
      expect(recap.narrative()).toBe('A quiet week.');

      setPreferences({ enableWeeklyRecap: true, ragInsightsLevel: 'off' });
      await tick();

      expect(recap.narrative()).toBe('');
      expect(recap.narrativeStatus()).toBe('idle');
    });

    it('clears a generated narrative once no provider remains', async () => {
      const recap = createService();
      await recap.load();
      await tick();
      expect(recap.narrative()).toBe('A quiet week.');

      hasProvider.set(false);
      await tick();

      expect(recap.narrative()).toBe('');
      expect(recap.narrativeStatus()).toBe('idle');
    });

    it('keeps a cached narrative when the category list only empties', async () => {
      const recap = createService();
      await recap.load();
      await tick();
      expect(recap.narrative()).toBe('A quiet week.');

      categories.set([]);
      await tick();

      expect(recap.narrative()).toBe('A quiet week.');
    });

    it('reports a feature value the taxonomy allows', () => {
      expect(ANALYTICS_EVENTS.ai_assist_used.params.feature).toContain('recap');
    });
  });

  describe('a change of account', () => {
    it('drops the figures and the narrative of the account that left', async () => {
      const recap = createService();
      await recap.load();
      await tick();
      expect(recap.visible()).toBeTrue();

      currentUser.set(
        createMockUser('user-2', {
          preferences: { ...DEFAULT_USER_PREFERENCES, enableWeeklyRecap: true },
        })
      );
      await tick();

      expect(recap.figures()).toBeNull();
      expect(recap.status()).toBe('idle');
      expect(recap.narrative()).toBe('');
      expect(recap.visible()).toBeFalse();
    });

    it('never publishes a composition that landed after the account left', async () => {
      let release: (rows: Transaction[]) => void = () => undefined;
      transactions.getTransactionsInRangeOnce.and.returnValue(
        new Promise<Transaction[]>(resolve => (release = resolve))
      );

      const recap = createService();
      const pending = recap.load();
      currentUser.set(
        createMockUser('user-2', {
          preferences: { ...DEFAULT_USER_PREFERENCES, enableWeeklyRecap: true },
        })
      );
      await tick();

      release([transaction()]);
      await pending;

      expect(recap.figures()).toBeNull();
      expect(recap.status()).toBe('idle');
    });
  });
});
