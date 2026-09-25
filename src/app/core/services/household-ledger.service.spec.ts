import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  ErrorHandler,
  WritableSignal,
  computed,
  createEnvironmentInjector,
  signal
} from '@angular/core';
import { Subject } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import {
  HOUSEHOLD_LEDGER_ROW_CAP,
  HouseholdLedgerService,
  LedgerKind
} from './household-ledger.service';
import { FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { createTranslationStub } from './testing/translation-stub';
import { createBudget, createCategory, createTransaction } from './testing/test-data';
import { Category, Goal, HouseholdMemberIdentity, Transaction, User } from '../../models';
import { defaultCategories } from '../utils/category-merge.utils';
import {
  DateWindow,
  budgetPeriodWindow,
  dayKey,
  endOfDay,
  monthWindow,
  startOfMonth
} from '../utils/transaction-date.utils';

type Kind = LedgerKind;
const KINDS: readonly Kind[] = ['transactions', 'categories', 'budgets', 'goals'];

/** What `incomplete` holds with nothing failed; a case spreads its own kinds over it. */
const NOTHING_FAILED: Record<Kind, HouseholdMemberIdentity[]> =
  { transactions: [], categories: [], budgets: [], goals: [] };

interface Listener {
  path: string;
  options: QueryOptions | undefined;
  subject: Subject<unknown[]>;
}

describe('HouseholdLedgerService', () => {
  const ME = 'me';
  const KAI = 'kai';
  const SAM = 'sam';
  const me: HouseholdMemberIdentity = { uid: ME, displayName: 'Me' };
  const kai: HouseholdMemberIdentity = {
    uid: KAI,
    displayName: 'Kai',
    photoURL: 'https://lh3.googleusercontent.com/a/kai'
  };
  const sam: HouseholdMemberIdentity = { uid: SAM, displayName: 'Sam' };

  // Closes mid-morning on its last day: the listener must still ask through
  // the last millisecond of that day, in the runtime's own zone.
  const AUGUST: DateWindow = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 9, 30) };
  const SEPTEMBER: DateWindow = monthWindow({ year: 2026, month: 8 });

  let user: WritableSignal<User | null>;
  let firestore: MockFirestoreService;
  let currency: CurrencyService;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let injector: EnvironmentInjector;
  let destroyed: boolean;
  let ledger: HouseholdLedgerService;
  let opened: Listener[];
  let consoleWarn: jasmine.Spy;
  let consoleError: jasmine.Spy;
  let seq: number;

  const viewer = (baseCurrency: string): User => ({
    id: ME,
    email: 'me@example.test',
    displayName: 'Me',
    preferences: { baseCurrency, language: 'en' }
  }) as User;

  const at = (day: number, hour = 12) => Timestamp.fromDate(new Date(2026, 7, day, hour));

  function row(uid: string, overrides: Partial<Transaction> = {}): Transaction {
    seq++;
    return createTransaction({
      id: `${uid}-row-${seq}`,
      userId: uid,
      date: at(15),
      createdAt: at(15),
      ...overrides
    });
  }

  function goal(uid: string, overrides: Partial<Goal> = {}): Goal {
    return {
      id: `${uid}-goal`,
      userId: uid,
      kind: 'saving',
      name: 'Trip',
      targetAmount: 1000,
      contributedAmount: 100,
      currency: 'USD',
      isActive: true,
      createdAt: at(1),
      updatedAt: at(1),
      ...overrides
    };
  }

  const firebaseError = (code: string) =>
    Object.assign(new Error(code), { name: 'FirebaseError', code });

  const listenersOn = (path: string) => opened.filter(listener => listener.path === path);

  function latest(uid: string, kind: Kind): Listener {
    const all = listenersOn(`users/${uid}/${kind}`);
    if (all.length === 0) throw new Error(`no ${kind} listener for ${uid}`);
    return all[all.length - 1];
  }

  /** Answers every open listener of a member; a kind left out answers empty. */
  function answer(uid: string, docs: Partial<Record<Kind, unknown[]>> = {}): void {
    for (const kind of KINDS) latest(uid, kind).subject.next(docs[kind] ?? []);
  }

  function follow(members: HouseholdMemberIdentity[], period: DateWindow = AUGUST): void {
    ledger.setPeriod(period);
    ledger.setMembers(members);
  }

  /**
   * Only the calls the ledger itself logged (its "[HouseholdLedgerService]"
   * prefix), so other services' warnings cannot fail a case.
   */
  const ledgerLogs = (spy: jasmine.Spy) =>
    spy.calls.allArgs().filter(args => String(args[0]).startsWith('[HouseholdLedgerService]'));

  beforeEach(async () => {
    // A rates cache leaked from another spec file would outrank the table
    // pinned below, and a live fetch could replace it mid-case.
    localStorage.removeItem('home-account.exchangeRates');
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    user = signal<User | null>(viewer('USD'));
    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useClass: MockFirestoreService },
        {
          provide: AuthService,
          useValue: { userId: computed(() => user()?.id ?? null), currentUser: user }
        },
        { provide: PwaService, useValue: { isOnline: signal(true) } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    });
    firestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;

    // The real conversion, settled first so the fallback ladder cannot land
    // on top of the table a microtask later, then pinned to rates unlike the
    // compiled-in ones (EUR 0.92, TWD 31.5, JPY 149.5): a figure that skipped
    // conversion, or converted at a constant, shows.
    currency = TestBed.inject(CurrencyService);
    await currency.ensureRatesLoaded();
    currency.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.8], ['TWD', 32], ['JPY', 150]]));

    opened = [];
    seq = 0;
    spyOn(firestore, 'subscribeToCollection').and.callFake(((path: string, options?: QueryOptions) => {
      const subject = new Subject<unknown[]>();
      opened.push({ path, options, subject });
      return subject.asObservable();
    }) as never);
    consoleWarn = spyOn(console, 'warn').and.callThrough();
    consoleError = spyOn(console, 'error').and.callThrough();

    // Provided below the root, as the household page provides it, so its
    // DestroyRef is one a case can end.
    injector = createEnvironmentInjector([HouseholdLedgerService], TestBed.inject(EnvironmentInjector));
    destroyed = false;
    ledger = injector.get(HouseholdLedgerService);
  });

  afterEach(() => {
    if (!destroyed) injector.destroy();
  });

  describe('listeners', () => {
    it('follows each member through four single-field queries, the period through the last millisecond of its final day', () => {
      follow([me, kai]);

      for (const uid of [ME, KAI]) {
        for (const kind of KINDS) {
          expect(listenersOn(`users/${uid}/${kind}`).length).withContext(`${uid} ${kind}`).toBe(1);
        }
        expect(latest(uid, 'transactions').options).toEqual({
          where: [
            { field: 'date', op: '>=', value: Timestamp.fromDate(AUGUST.start) },
            { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(AUGUST.end)) }
          ],
          orderBy: [{ field: 'date', direction: 'desc' }],
          limit: HOUSEHOLD_LEDGER_ROW_CAP + 1
        });
        expect(latest(uid, 'categories').options).toBeUndefined();
        expect(latest(uid, 'budgets').options).toEqual({ where: [{ field: 'isActive', op: '==', value: true }] });
        expect(latest(uid, 'goals').options).toEqual({ where: [{ field: 'isActive', op: '==', value: true }] });
      }
      expect(opened.length).toBe(8);

      const upper = (latest(ME, 'transactions').options!.where![1].value as Timestamp).toDate();
      expect([upper.getMonth(), upper.getDate(), upper.getHours(), upper.getMinutes(), upper.getSeconds(), upper.getMilliseconds()])
        .toEqual([7, 31, 23, 59, 59, 999]);
      const lower = (latest(ME, 'transactions').options!.where![0].value as Timestamp).toDate();
      expect([lower.getMonth(), lower.getDate(), lower.getHours(), lower.getMinutes()]).toEqual([7, 1, 0, 0]);
    });

    it('waits for a period before it listens to anyone\'s transactions', () => {
      ledger.setMembers([me]);

      expect(listenersOn(`users/${ME}/transactions`).length).toBe(0);
      expect(opened.map(listener => listener.path).sort())
        .toEqual([`users/${ME}/budgets`, `users/${ME}/categories`, `users/${ME}/goals`]);

      ledger.setPeriod(AUGUST);
      expect(listenersOn(`users/${ME}/transactions`).length).toBe(1);
      expect(opened.length).toBe(4);
    });
  });

  describe('merging', () => {
    it('merges every member\'s rows newest first, a tied date going to the newer createdAt, each marked with its member', () => {
      follow([me, kai]);
      const mine = row(ME, { date: at(20), createdAt: at(20, 9) });
      const newest = row(KAI, { date: at(25) });
      const tiedLater = row(KAI, { date: at(20), createdAt: at(20, 18) });
      const tiedEarlier = row(KAI, { date: at(20), createdAt: at(20, 7) });
      const oldest = row(ME, { date: at(3) });

      answer(ME, { transactions: [mine, oldest] });
      answer(KAI, { transactions: [tiedEarlier, newest, tiedLater] });

      expect(ledger.rows().map(r => [r.id, r.memberUid])).toEqual([
        [newest.id, KAI],
        [tiedLater.id, KAI],
        [mine.id, ME],
        [tiedEarlier.id, KAI],
        [oldest.id, ME]
      ]);
    });
  });

  describe('totals', () => {
    it('counts a stamped EUR member in the viewer\'s base at the loaded rate', () => {
      follow([me, kai]);
      answer(ME, { transactions: [row(ME, { amount: 50, amountInBaseCurrency: 50, baseCurrency: 'USD' })] });
      // Kai's base is EUR: its snapshot is 10 euros, not 10 dollars.
      answer(KAI, {
        transactions: [row(KAI, { amount: 10, currency: 'EUR', amountInBaseCurrency: 10, baseCurrency: 'EUR' })]
      });

      const [mine, kais] = ledger.totalsByMember();
      expect(mine.member).toEqual(me);
      expect(mine.totals.expense).toBe(50);
      expect(kais.member).toEqual(kai);
      // 10 / 0.8. The compiled-in 0.92 would give 10.87, the stored snapshot 10.
      expect(kais.totals.expense).toBe(12.5);
      expect(ledger.combined()).toEqual({ income: 0, expense: 62.5, balance: -62.5, count: 2 });
    });

    it('converts an unstamped row of another member live, where the snapshot is in that member\'s base', () => {
      follow([me, sam]);
      // Sam's base is JPY and these rows predate the stamp: 20 dollars stored
      // as 3000 yen, 10 euros as 1875 yen.
      const dollars = row(SAM, { amount: 20, currency: 'USD', amountInBaseCurrency: 3000, exchangeRate: 150 });
      const euros = row(SAM, { amount: 10, currency: 'EUR', amountInBaseCurrency: 1875, exchangeRate: 187.5 });
      // None of amountInBase's own conditions catches either row.
      expect(currency.amountInBase(dollars, 'USD')).toBe(3000);
      expect(currency.amountInBase(euros, 'USD')).toBe(1875);
      // The viewer's own unstamped row is in the viewer's base, and its
      // snapshot (not the live 11.25) is what it counts as.
      const own = row(ME, { amount: 9, currency: 'EUR', amountInBaseCurrency: 10, exchangeRate: 1.1111 });

      answer(ME, { transactions: [own] });
      answer(SAM, { transactions: [dollars, euros] });

      const [mine, sams] = ledger.totalsByMember();
      expect(mine.totals.expense).toBe(10);
      // 20 + 10 / 0.8
      expect(sams.totals.expense).toBe(32.5);
      expect(ledger.combined().expense).toBe(42.5);
    });

    it('refolds every member for a TWD viewer', () => {
      follow([me, kai, sam]);
      answer(ME, {
        transactions: [
          row(ME, { amount: 50, amountInBaseCurrency: 50, baseCurrency: 'USD' }),
          row(ME, { type: 'income', amount: 100, amountInBaseCurrency: 100, baseCurrency: 'USD' })
        ]
      });
      answer(KAI, {
        transactions: [row(KAI, { amount: 10, currency: 'EUR', amountInBaseCurrency: 10, baseCurrency: 'EUR' })]
      });
      answer(SAM, {
        transactions: [row(SAM, { amount: 20, currency: 'USD', amountInBaseCurrency: 3000, exchangeRate: 150 })]
      });

      user.set(viewer('TWD'));

      expect(ledger.totalsByMember().map(entry => [entry.member.uid, entry.totals.expense, entry.totals.income]))
        .toEqual([
          // 50 × 32 and 100 × 32
          [ME, 1600, 3200],
          // 10 × 32 / 0.8
          [KAI, 400, 0],
          // 20 × 32
          [SAM, 640, 0]
        ]);
      expect(ledger.combined()).toEqual({ income: 3200, expense: 2640, balance: 560, count: 4 });
    });
  });

  describe('peer rows', () => {
    it('strips the receipt fields from another member\'s rows and keeps the viewer\'s own', () => {
      follow([me, kai]);
      const receipts: Partial<Transaction> = {
        receiptUrl: 'https://example.test/receipt-0.jpg',
        receiptUrls: ['https://example.test/receipt-0.jpg', 'https://example.test/receipt-1.jpg'],
        receiptCount: 2
      };
      const mine = row(ME, receipts);
      const theirs = row(KAI, { ...receipts, baseCurrency: 'USD' });

      answer(ME, { transactions: [mine] });
      answer(KAI, { transactions: [theirs] });

      const shown = new Map(ledger.rows().map(r => [r.id, r]));
      const peer = shown.get(theirs.id)!;
      expect('receiptUrl' in peer).toBeFalse();
      expect('receiptUrls' in peer).toBeFalse();
      expect('receiptCount' in peer).toBeFalse();
      expect(peer.description).toBe(theirs.description);
      expect(peer.baseCurrency).toBe('USD');
      const own = shown.get(mine.id)!;
      expect(own.receiptUrl).toBe(receipts.receiptUrl!);
      expect(own.receiptUrls).toEqual(receipts.receiptUrls!);
      expect(own.receiptCount).toBe(2);
      // What the listener handed over is left as it was.
      expect(theirs.receiptCount).toBe(2);
    });
  });

  describe('categories', () => {
    it('resolves each member\'s row through that member\'s own merged categories', () => {
      follow([me, kai]);
      const builtIn = defaultCategories()[0];
      const pets = createCategory({ id: 'kai-pets', name: 'Pets', userId: KAI, isDefault: false, order: 999 });
      const renamed: Category = { ...builtIn, name: 'Kai\'s groceries', userId: KAI, isDefault: false };
      const petFood = row(KAI, { categoryId: 'kai-pets' });

      answer(ME, { categories: [] });
      answer(KAI, { categories: [pets, renamed], transactions: [petFood] });

      const maps = ledger.categoriesByMember();
      const shown = ledger.rows().find(r => r.id === petFood.id)!;
      expect(maps.get(shown.memberUid)!.get(shown.categoryId)!.name).toBe('Pets');
      expect(maps.get(ME)!.has('kai-pets')).toBeFalse();
      expect(maps.get(KAI)!.get(builtIn.id)!.name).toBe('Kai\'s groceries');
      expect(maps.get(ME)!.get(builtIn.id)!.name).toBe(builtIn.name);
      expect(maps.get(KAI)!.size).toBe(defaultCategories().length + 1);
    });

    it('leaves the category maps, budgets and goals as they were when only rows arrive', () => {
      follow([me, kai]);
      answer(ME, {});
      answer(KAI, { categories: [createCategory({ id: 'kai-pets', userId: KAI })], goals: [goal(KAI)] });
      const maps = ledger.categoriesByMember();
      const budgets = ledger.budgetsByMember();
      const goals = ledger.goalsByMember();

      latest(KAI, 'transactions').subject.next([row(KAI)]);

      expect(ledger.rows().length).toBe(1);
      expect(ledger.categoriesByMember()).toBe(maps);
      expect(ledger.budgetsByMember()).toBe(budgets);
      expect(ledger.goalsByMember()).toBe(goals);

      latest(KAI, 'categories').subject.next([]);
      expect(ledger.categoriesByMember()).not.toBe(maps);
      expect(ledger.categoriesByMember().get(KAI)!.has('kai-pets')).toBeFalse();
    });
  });

  describe('budgets and goals', () => {
    it('shows a budget summed for another period as 0 and stale, and writes nothing', () => {
      follow([me, kai]);
      const now = new Date();
      const anchor = startOfMonth(now);
      const currentKey = dayKey(budgetPeriodWindow('monthly', anchor, now).start);
      const current = createBudget({
        id: 'current', userId: KAI, name: 'Groceries', startDate: Timestamp.fromDate(anchor),
        spent: 120, spentPeriod: currentKey
      });
      const stale = createBudget({
        id: 'stale', userId: KAI, name: 'Dining', startDate: Timestamp.fromDate(anchor),
        spent: 300, spentPeriod: '1999-01-01'
      });
      const unstamped = createBudget({
        id: 'unstamped', userId: KAI, name: 'Transport', startDate: Timestamp.fromDate(anchor), spent: 40
      });

      answer(ME, {});
      answer(KAI, { budgets: [current, stale, unstamped], goals: [goal(KAI)] });

      const kais = ledger.budgetsByMember().find(entry => entry.member.uid === KAI)!;
      expect(kais.budgets.map(b => [b.id, b.spent, b.stale])).toEqual([
        ['stale', 0, true],
        ['current', 120, false],
        ['unstamped', 0, true]
      ]);
      expect(stale.spent).toBe(300);
      expect(ledger.budgetsByMember().find(entry => entry.member.uid === ME)!.budgets).toEqual([]);
      expect(ledger.goalsByMember().map(entry => [entry.member.uid, entry.goals.map(g => g.id)]))
        .toEqual([[ME, []], [KAI, [`${KAI}-goal`]]]);

      expect(firestore.addDocumentSpy.calls.length).toBe(0);
      expect(firestore.setDocumentSpy.calls.length).toBe(0);
      expect(firestore.updateDocumentSpy.calls.length).toBe(0);
      expect(firestore.deleteDocumentSpy.calls.length).toBe(0);
      expect(firestore.runTransactionSpy.calls.length).toBe(0);
    });
  });

  describe('limits', () => {
    it('states the cap only for the member whose period passes it, keeping its newest rows', () => {
      follow([me, kai]);
      // Newest first, as the query delivers them: the one past the cap is
      // the oldest.
      const many = Array.from({ length: HOUSEHOLD_LEDGER_ROW_CAP + 1 }, (_, i) =>
        row(KAI, { date: at(31), createdAt: Timestamp.fromMillis(at(31).toMillis() - i) })
      );

      answer(ME, { transactions: [row(ME), row(ME)] });
      answer(KAI, { transactions: many });

      expect(ledger.truncated()).toEqual([kai]);
      const kais = ledger.rows().filter(r => r.memberUid === KAI);
      expect(kais.length).toBe(HOUSEHOLD_LEDGER_ROW_CAP);
      expect(kais.some(r => r.id === many[HOUSEHOLD_LEDGER_ROW_CAP].id)).toBeFalse();
      expect(ledger.totalsByMember().map(entry => entry.totals.count)).toEqual([2, HOUSEHOLD_LEDGER_ROW_CAP]);
    });

    it('puts only the member whose listener is refused in unavailable, drops what it showed, and raises nothing', () => {
      follow([me, kai, sam]);
      answer(ME, { transactions: [row(ME)] });
      answer(KAI, { transactions: [row(KAI)], budgets: [createBudget({ userId: KAI })], goals: [goal(KAI)] });
      answer(SAM, { transactions: [row(SAM)] });

      latest(KAI, 'budgets').subject.error(firebaseError('permission-denied'));

      expect(ledger.unavailable()).toEqual([kai]);
      expect(ledger.rows().map(r => r.memberUid).sort()).toEqual([ME, SAM]);
      expect(ledger.totalsByMember().map(entry => entry.member.uid)).toEqual([ME, SAM]);
      expect(ledger.budgetsByMember().map(entry => entry.member.uid)).toEqual([ME, SAM]);
      expect(ledger.goalsByMember().map(entry => entry.member.uid)).toEqual([ME, SAM]);
      expect(ledger.categoriesByMember().has(KAI)).toBeFalse();
      for (const kind of KINDS) {
        expect(latest(KAI, kind).subject.observed).withContext(`${KAI} ${kind}`).toBeFalse();
        expect(latest(ME, kind).subject.observed).withContext(`${ME} ${kind}`).toBeTrue();
        expect(latest(SAM, kind).subject.observed).withContext(`${SAM} ${kind}`).toBeTrue();
      }
      expect(ledger.loading()).toBeFalse();
      expect(errorHandler.handleError).not.toHaveBeenCalled();
      expect(ledgerLogs(consoleWarn)).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('logs any other listener failure and keeps what the member last showed', () => {
      follow([me, kai]);
      const kept = row(KAI);
      answer(ME, {});
      answer(KAI, { transactions: [kept], goals: [goal(KAI)] });
      const failure = firebaseError('internal');

      latest(KAI, 'goals').subject.error(failure);

      expect(ledgerLogs(consoleWarn)).toEqual([['[HouseholdLedgerService] The goals listener stopped:', failure]]);
      expect(ledger.unavailable()).toEqual([]);
      expect(ledger.incomplete()).toEqual(NOTHING_FAILED);
      expect(ledger.rows().map(r => r.id)).toEqual([kept.id]);
      expect(ledger.goalsByMember().find(entry => entry.member.uid === KAI)!.goals.length).toBe(1);
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });

    it('lists a member whose listener failed before it ever answered as incomplete, not unavailable', () => {
      follow([me, kai]);
      answer(ME, { transactions: [row(ME)] });
      const failure = firebaseError('internal');

      latest(KAI, 'transactions').subject.error(failure);
      for (const kind of ['categories', 'budgets', 'goals'] as const) latest(KAI, kind).subject.next([]);

      expect(ledger.incomplete()).toEqual({ ...NOTHING_FAILED, transactions: [kai] });
      expect(ledger.unavailable()).toEqual([]);
      expect(ledger.loading()).toBeFalse();
      expect(ledger.totalsByMember().map(entry => [entry.member.uid, entry.totals.count])).toEqual([[ME, 1], [KAI, 0]]);
      expect(ledgerLogs(consoleWarn)).toEqual([['[HouseholdLedgerService] The transactions listener stopped:', failure]]);
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });

    it('clears a failed transactions listener on a period change, and keeps any other kind that failed unheard', () => {
      follow([me, kai]);
      answer(ME, {});
      latest(KAI, 'transactions').subject.error(firebaseError('internal'));
      latest(KAI, 'goals').subject.error(firebaseError('internal'));
      latest(KAI, 'categories').subject.next([]);
      latest(KAI, 'budgets').subject.next([]);
      expect(ledger.incomplete()).toEqual({ ...NOTHING_FAILED, transactions: [kai], goals: [kai] });

      ledger.setPeriod(SEPTEMBER);
      latest(KAI, 'transactions').subject.next([row(KAI, { date: Timestamp.fromDate(new Date(2026, 8, 2)) })]);
      latest(ME, 'transactions').subject.next([]);

      // Its goals listener is still the one that failed, so its plans may be partial.
      expect(ledger.incomplete()).toEqual({ ...NOTHING_FAILED, goals: [kai] });
      expect(ledger.loading()).toBeFalse();

      ledger.setMembers([me]);
      ledger.setMembers([me, kai]);
      answer(KAI, {});
      expect(ledger.incomplete()).toEqual(NOTHING_FAILED);
    });

    it('clears a failure that only the transactions listener had once it is reopened', () => {
      follow([me, kai]);
      answer(ME, {});
      latest(KAI, 'transactions').subject.error(firebaseError('unavailable'));
      for (const kind of ['categories', 'budgets', 'goals'] as const) latest(KAI, kind).subject.next([]);
      expect(ledger.incomplete()).toEqual({ ...NOTHING_FAILED, transactions: [kai] });

      ledger.setPeriod(SEPTEMBER);

      expect(ledger.incomplete()).toEqual(NOTHING_FAILED);
      expect(ledger.loading()).toBeTrue();
    });

    it('files each unheard failure under its own kind, so a page can say what may be partial', () => {
      follow([me, kai, sam]);
      answer(ME, {});
      latest(KAI, 'categories').subject.error(firebaseError('internal'));
      latest(SAM, 'budgets').subject.error(firebaseError('internal'));
      latest(KAI, 'goals').subject.error(firebaseError('internal'));
      answer(KAI, { transactions: [], budgets: [] });
      answer(SAM, { transactions: [], categories: [], goals: [] });

      expect(ledger.incomplete()).toEqual({
        transactions: [],
        categories: [kai],
        budgets: [sam],
        goals: [kai]
      });
    });
  });

  describe('lifecycle', () => {
    it('gives a joining member four listeners and merges its rows, reopening nobody else\'s', () => {
      follow([me]);
      answer(ME, { transactions: [row(ME)] });
      expect(ledger.loading()).toBeFalse();

      ledger.setMembers([me, kai]);

      expect(opened.length).toBe(8);
      for (const kind of KINDS) {
        expect(listenersOn(`users/${KAI}/${kind}`).length).withContext(kind).toBe(1);
        expect(listenersOn(`users/${ME}/${kind}`).length).withContext(kind).toBe(1);
        expect(latest(ME, kind).subject.observed).withContext(kind).toBeTrue();
      }
      expect(ledger.loading()).toBeTrue();
      expect(ledger.totalsByMember().map(entry => [entry.member.uid, entry.totals.count])).toEqual([[ME, 1], [KAI, 0]]);

      const joined = row(KAI);
      answer(KAI, { transactions: [joined] });

      expect(ledger.loading()).toBeFalse();
      expect(ledger.rows().some(r => r.id === joined.id && r.memberUid === KAI)).toBeTrue();
    });

    it('drops a member who leaves the list, closing its listeners and whatever it was listed under', () => {
      follow([me, kai, sam]);
      answer(ME, { transactions: [row(ME)] });
      answer(KAI, { transactions: [row(KAI)], budgets: [createBudget({ userId: KAI })], goals: [goal(KAI)] });
      answer(SAM, {});
      latest(SAM, 'goals').subject.error(firebaseError('permission-denied'));
      expect(ledger.unavailable()).toEqual([sam]);

      ledger.setMembers([me]);

      for (const kind of KINDS) {
        expect(latest(KAI, kind).subject.observed).withContext(kind).toBeFalse();
        expect(latest(ME, kind).subject.observed).withContext(kind).toBeTrue();
      }
      expect(ledger.rows().map(r => r.memberUid)).toEqual([ME]);
      expect(ledger.totalsByMember().map(entry => entry.member.uid)).toEqual([ME]);
      expect(ledger.budgetsByMember().map(entry => entry.member.uid)).toEqual([ME]);
      expect(ledger.goalsByMember().map(entry => entry.member.uid)).toEqual([ME]);
      expect(ledger.categoriesByMember().has(KAI)).toBeFalse();
      expect(ledger.unavailable()).toEqual([]);
      expect(opened.length).toBe(12);
    });

    it('reopens only the transactions listeners on a period change, with the new bounds', () => {
      follow([me, kai]);
      answer(ME, { transactions: [row(ME)] });
      answer(KAI, { transactions: [row(KAI)] });
      const before = [latest(ME, 'transactions'), latest(KAI, 'transactions')];

      ledger.setPeriod(SEPTEMBER);

      for (const listener of before) expect(listener.subject.observed).toBeFalse();
      for (const uid of [ME, KAI]) {
        expect(listenersOn(`users/${uid}/transactions`).length).toBe(2);
        expect(latest(uid, 'transactions').options!.where).toEqual([
          { field: 'date', op: '>=', value: Timestamp.fromDate(SEPTEMBER.start) },
          { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(SEPTEMBER.end)) }
        ]);
        for (const kind of ['categories', 'budgets', 'goals'] as const) {
          expect(listenersOn(`users/${uid}/${kind}`).length).withContext(`${uid} ${kind}`).toBe(1);
          expect(latest(uid, kind).subject.observed).withContext(`${uid} ${kind}`).toBeTrue();
        }
      }
      // August's rows are not shown under September while it loads.
      expect(ledger.rows()).toEqual([]);
      expect(ledger.loading()).toBeTrue();

      const september = row(KAI, { date: Timestamp.fromDate(new Date(2026, 8, 2)) });
      latest(ME, 'transactions').subject.next([]);
      latest(KAI, 'transactions').subject.next([september]);
      expect(ledger.rows().map(r => r.id)).toEqual([september.id]);

      ledger.setPeriod({ start: new Date(SEPTEMBER.start), end: new Date(SEPTEMBER.end) });
      expect(opened.length).toBe(10);
    });

    it('closes every listener when destroyed, and opens none after', () => {
      follow([me, kai]);
      answer(ME, {});

      injector.destroy();
      destroyed = true;

      expect(opened.every(listener => !listener.subject.observed)).toBeTrue();
      ledger.setMembers([me, kai, sam]);
      ledger.setPeriod(SEPTEMBER);
      expect(opened.length).toBe(8);
    });
  });
});
