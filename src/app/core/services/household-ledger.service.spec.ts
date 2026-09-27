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
import { HouseholdLedgerService, LedgerHousehold } from './household-ledger.service';
import { CollectionWithMetadata, FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { LedgerShareService } from './ledger-share.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  HouseholdMember,
  HouseholdMemberIdentity,
  LEDGER_QUERY_SHAPES,
  LEDGER_VIEW_CAP,
  LedgerCopy,
  User
} from '../../models';
import { DateWindow, endOfDay, monthWindow } from '../utils/transaction-date.utils';

/** A copy as the listener hands it over: the document with its id. */
type StoredCopy = LedgerCopy & { id: string };

interface Listener {
  path: string;
  options: QueryOptions | undefined;
  subject: Subject<CollectionWithMetadata<StoredCopy>>;
}

/** The service's one way to the sharing code, a dynamic import. */
interface SharingLoader {
  ledgerShare: () => Promise<LedgerShareService>;
}

describe('HouseholdLedgerService', () => {
  const ME = 'me';
  const KAI = 'kai';
  const SAM = 'sam';
  const GONE = 'gone';
  const me: HouseholdMemberIdentity = { uid: ME, displayName: 'Me' };
  const kai: HouseholdMemberIdentity = {
    uid: KAI,
    displayName: 'Kai',
    photoURL: 'https://lh3.googleusercontent.com/a/kai'
  };
  const sam: HouseholdMemberIdentity = { uid: SAM, displayName: 'Sam' };

  // Microseconds in it, as the server stamps a generation: an equality on a
  // copy of it rounded to milliseconds would match nothing.
  const GEN = new Timestamp(1_767_605_400, 123_456_000);
  const HOME: LedgerHousehold = { id: 'h1', ownerId: ME, createdAt: GEN };
  const LEDGER = `households/${HOME.id}/ledger`;

  // Closes mid-morning on its last day: the listener must still ask through
  // the last millisecond of that day, in the runtime's own zone.
  const AUGUST: DateWindow = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 9, 30) };
  const SEPTEMBER: DateWindow = monthWindow({ year: 2026, month: 8 });

  let user: WritableSignal<User | null>;
  let firestore: MockFirestoreService;
  let currency: CurrencyService;
  let sharing: { purgeMember: jasmine.Spy };
  let loader: jasmine.Spy;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let injector: EnvironmentInjector;
  let destroyed: boolean;
  let ledger: HouseholdLedgerService;
  let opened: Listener[];
  let consoleWarn: jasmine.Spy;
  let consoleError: jasmine.Spy;

  const viewer = (baseCurrency: string): User => ({
    id: ME,
    email: 'me@example.test',
    displayName: 'Me',
    preferences: { baseCurrency, language: 'en' }
  }) as User;

  const at = (day: number, hour = 12) => Timestamp.fromDate(new Date(2026, 7, day, hour));

  /** A copy of the live generation, one dollar of groceries on 15 August unless told otherwise. */
  function copy(memberUid: string, sourceId: string, overrides: Partial<LedgerCopy> = {}): StoredCopy {
    return {
      id: `${memberUid}_${sourceId}`,
      memberUid,
      sourceId,
      gen: GEN,
      pv: 1,
      type: 'expense',
      amount: 1,
      currency: 'USD',
      date: at(15),
      description: `${memberUid} ${sourceId}`,
      categoryId: 'food_groceries',
      category: { name: 'categoryNames.groceries', icon: 'local_grocery_store', color: '#4CAF50' },
      bucket: 'food_groceries',
      bucketGroup: 'food',
      updatedAt: at(15),
      ...overrides
    };
  }

  const firebaseError = (code: string) =>
    Object.assign(new Error(code), { name: 'FirebaseError', code });

  function latest(): Listener {
    if (opened.length === 0) throw new Error('no ledger listener');
    return opened[opened.length - 1];
  }

  /** A listener's answer: from the server unless `fromCache` says otherwise. */
  function answerTo(listener: Listener, docs: StoredCopy[], fromCache = false): void {
    listener.subject.next({ docs, fromCache, hasPendingWrites: false });
  }

  /** The latest listener's answer. */
  function answer(docs: StoredCopy[], fromCache = false): void {
    answerTo(latest(), docs, fromCache);
  }

  function follow(
    members: HouseholdMemberIdentity[] = [me, kai],
    period: DateWindow = AUGUST,
    household: LedgerHousehold = HOME
  ): void {
    ledger.setHousehold(household);
    ledger.setPeriod(period);
    ledger.setMembers(members);
  }

  /** A member document of the live generation, as the server holds it. */
  function liveMember(uid: string): void {
    const member: HouseholdMember = { uid, displayName: uid, role: 'member', since: GEN, joinedAt: GEN };
    firestore.setMockDocument(`households/${HOME.id}/members/${uid}`, member);
  }

  /** Lets the chain behind a purge (a server read, the sharing code, the purge) run out. */
  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  const memberReads = () => firestore.getDocumentFromServerSpy.calls.map(call => call.args[0]);

  /**
   * Only the calls the ledger itself logged (its "[HouseholdLedger]" prefix),
   * so other services' warnings cannot fail a case.
   */
  const ledgerLogs = (spy: jasmine.Spy) =>
    spy.calls.allArgs().filter(args => String(args[0]).startsWith('[HouseholdLedger]'));

  beforeEach(async () => {
    // A rates cache leaked from another spec file would outrank the table
    // pinned below, and a live fetch could replace it mid-case.
    localStorage.removeItem('home-account.exchangeRates');
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    user = signal<User | null>(viewer('USD'));
    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    sharing = { purgeMember: jasmine.createSpy('purgeMember').and.resolveTo(0) };
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useClass: MockFirestoreService },
        {
          provide: AuthService,
          useValue: { userId: computed(() => user()?.id ?? null), currentUser: user }
        },
        { provide: PwaService, useValue: { isOnline: signal(true) } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LedgerShareService, useValue: sharing },
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
    spyOn(firestore, 'subscribeToCollection').and.callThrough();
    spyOn(firestore, 'subscribeToCollectionWithMetadata').and.callFake(((path: string, options?: QueryOptions) => {
      const subject = new Subject<CollectionWithMetadata<StoredCopy>>();
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
    // Straight to the fake: the case that needs the dynamic import itself
    // lets it through.
    loader = spyOn(ledger as unknown as SharingLoader, 'ledgerShare')
      .and.callFake(async () => sharing as unknown as LedgerShareService);
  });

  afterEach(() => {
    if (!destroyed) injector.destroy();
  });

  describe('its listener', () => {
    it("reads one query for the household: the live generation's copies in the period, newest first, one past the cap", () => {
      follow([me, kai, sam]);

      expect(opened.length).withContext('one listener, whatever the number of members').toBe(1);
      expect(latest().path).toBe(LEDGER);
      expect(latest().options).toEqual({
        where: [
          { field: 'gen', op: '==', value: GEN },
          { field: 'date', op: '>=', value: Timestamp.fromDate(AUGUST.start) },
          { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(AUGUST.end)) }
        ],
        orderBy: [{ field: 'date', direction: 'desc' }],
        limit: LEDGER_VIEW_CAP + 1
      });
      // The composite that serves it: the equality on its first field, the
      // range and the order on its second.
      expect(LEDGER_QUERY_SHAPES.ledgerByDate.fields).toEqual([['gen', 'ASCENDING'], ['date', 'DESCENDING']]);
      // Nothing under any member's own records, their categories included.
      expect(firestore.subscribeToCollection).not.toHaveBeenCalled();

      const upper = (latest().options!.where![2].value as Timestamp).toDate();
      expect([upper.getMonth(), upper.getDate(), upper.getHours(), upper.getMinutes(), upper.getSeconds(), upper.getMilliseconds()])
        .toEqual([7, 31, 23, 59, 59, 999]);
      const lower = (latest().options!.where![1].value as Timestamp).toDate();
      expect([lower.getMonth(), lower.getDate(), lower.getHours(), lower.getMinutes()]).toEqual([7, 1, 0, 0]);
    });

    it('waits for both a household and a period before it listens', () => {
      ledger.setMembers([me]);
      ledger.setPeriod(AUGUST);
      expect(opened.length).toBe(0);
      expect(ledger.loading()).withContext('nothing to wait for').toBeFalse();

      ledger.setHousehold(HOME);
      expect(opened.length).toBe(1);
      expect(ledger.loading()).toBeTrue();

      answer([]);
      expect(ledger.loading()).toBeFalse();
    });

    it('listens afresh for another household or generation, and not for the same one again', () => {
      follow();
      const first = latest();

      ledger.setHousehold({ ...HOME });
      expect(opened.length).withContext('the same household, read again').toBe(1);

      const reformed: LedgerHousehold = { ...HOME, createdAt: new Timestamp(GEN.seconds + 60, 0) };
      ledger.setHousehold(reformed);
      expect(first.subject.observed).toBeFalse();
      expect(opened.length).toBe(2);
      expect(latest().options!.where![0]).toEqual({ field: 'gen', op: '==', value: reformed.createdAt });

      ledger.setHousehold({ id: 'h2', ownerId: KAI, createdAt: GEN });
      expect(opened.length).toBe(3);
      expect(latest().path).toBe('households/h2/ledger');

      ledger.setHousehold(null);
      expect(latest().subject.observed).toBeFalse();
      expect(ledger.rows()).toEqual([]);
      expect(ledger.loading()).toBeFalse();
    });

    it("listens afresh for another period, clearing the last one's rows, and not for the same dates again", () => {
      follow();
      answer([copy(KAI, 'aug')]);
      const before = latest();

      ledger.setPeriod(SEPTEMBER);

      expect(before.subject.observed).toBeFalse();
      expect(opened.length).toBe(2);
      expect(latest().options!.where).toEqual([
        { field: 'gen', op: '==', value: GEN },
        { field: 'date', op: '>=', value: Timestamp.fromDate(SEPTEMBER.start) },
        { field: 'date', op: '<=', value: Timestamp.fromDate(endOfDay(SEPTEMBER.end)) }
      ]);
      // August's rows are not shown under September while it loads.
      expect(ledger.rows()).toEqual([]);
      expect(ledger.loading()).toBeTrue();

      answer([copy(KAI, 'sep', { date: Timestamp.fromDate(new Date(2026, 8, 2)) })]);
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['sep']);

      ledger.setPeriod({ start: new Date(SEPTEMBER.start), end: new Date(SEPTEMBER.end) });
      expect(opened.length).toBe(2);
    });

    it('closes its listener when destroyed, and opens none after', () => {
      follow();
      answer([]);

      injector.destroy();
      destroyed = true;

      expect(latest().subject.observed).toBeFalse();
      ledger.setPeriod(SEPTEMBER);
      ledger.setHousehold({ ...HOME, id: 'h2' });
      expect(opened.length).toBe(1);
    });
  });

  describe('its rows', () => {
    it("lists every member's copies newest first, each in its own amount and currency with its category as written", () => {
      follow();
      const custom = { name: 'Climbing gym', icon: 'fitness_center', color: '#336699' };
      answer([
        copy(KAI, 'newest', { date: at(25), amount: 12, currency: 'EUR' }),
        copy(ME, 'tied-b', { date: at(20) }),
        copy(KAI, 'tied-a', { date: at(20), categoryId: 'kai-gym', category: custom }),
        copy(ME, 'oldest', { date: at(3), type: 'income', amount: 40 })
      ]);

      const rows = ledger.rows();
      expect(rows.map(row => [row.id, row.memberUid, row.sourceId])).toEqual([
        [`${KAI}_newest`, KAI, 'newest'],
        [`${KAI}_tied-a`, KAI, 'tied-a'],
        [`${ME}_tied-b`, ME, 'tied-b'],
        [`${ME}_oldest`, ME, 'oldest']
      ]);
      expect(rows[0]).toEqual(jasmine.objectContaining({ amount: 12, currency: 'EUR', type: 'expense' }));
      expect(rows[3]).toEqual(jasmine.objectContaining({ amount: 40, currency: 'USD', type: 'income' }));
      // The snapshot as its author's app wrote it: a built-in's key, or the
      // author's own text. The page renders it through the translation.
      expect(rows[1].categoryId).toBe('kai-gym');
      expect(rows[1].category).toEqual(custom);
      expect(rows[2].category).toEqual({ name: 'categoryNames.groceries', icon: 'local_grocery_store', color: '#4CAF50' });
      expect(rows[2].description).toBe(`${ME} tied-b`);

      expect(firestore.getCollectionSpy.calls.length).toBe(0);
      expect(firestore.addDocumentSpy.calls.length).toBe(0);
      expect(firestore.setDocumentSpy.calls.length).toBe(0);
      expect(firestore.updateDocumentSpy.calls.length).toBe(0);
      expect(firestore.deleteDocumentSpy.calls.length).toBe(0);
      expect(firestore.commitBatchSpy.calls.length).toBe(0);
    });

    it('carries the household goal a copy counts toward, and none for a copy that counts toward none', () => {
      follow();
      answer([copy(ME, 'linked', { date: at(20), goalId: 'g1' }), copy(ME, 'unlinked', { date: at(10) })]);

      const [linked, unlinked] = ledger.rows();
      expect(linked.goalId).toBe('g1');
      expect('goalId' in unlinked).toBeFalse();
    });

    it('hides the copies of an account the members list does not hold, from the rows and every figure', async () => {
      follow([me, kai]);
      answer([copy(ME, 'mine'), copy(KAI, 'theirs'), copy(GONE, 'left-behind', { amount: 500 })]);

      expect(ledger.rows().map(row => row.memberUid).sort()).toEqual([KAI, ME]);
      expect(ledger.totalsByMember().map(line => line.member.uid)).toEqual([ME, KAI]);
      expect(ledger.combined().expense).toBe(2);
      expect(ledger.combined().count).toBe(2);

      // A member joining the list shows what they had shared.
      ledger.setMembers([me, kai, { uid: GONE, displayName: 'Back' }]);
      expect(ledger.rows().length).toBe(3);
      expect(ledger.combined().expense).toBe(502);

      // The owner's server-read answer started a purge of the stranger's
      // copies; it runs out here, while the case's fakes and injector stand.
      await settle();
      expect(sharing.purgeMember.calls.allArgs()).toEqual([[HOME.id, GONE]]);
      expect(ledgerLogs(consoleWarn)).toEqual([]);
    });

    it('gives every listed member a line in list order, one with nothing shared at zero', () => {
      follow([kai, me, sam]);
      answer([copy(ME, 'mine', { amount: 3 })]);

      expect(ledger.totalsByMember().map(line => [line.member, line.totals.expense, line.totals.count])).toEqual([
        [kai, 0, 0],
        [me, 3, 1],
        [sam, 0, 0]
      ]);
    });
  });

  describe('its figures', () => {
    it("folds each member and the household in the viewer's base: that currency exactly, any other at today's rate, and says so", () => {
      follow([me, kai, sam]);
      answer([
        copy(ME, 'rent', { amount: 50.25 }),
        copy(ME, 'pay', { type: 'income', amount: 100 }),
        copy(KAI, 'cafe', { amount: 10, currency: 'EUR' }),
        copy(KAI, 'refund', { type: 'income', amount: 4, currency: 'USD' })
      ]);

      const [mine, kais, sams] = ledger.totalsByMember();
      expect(mine.totals).toEqual({ income: 100, expense: 50.25, balance: 49.75, count: 2, atTodaysRate: false });
      // 10 / 0.8. The compiled-in 0.92 would give 10.87.
      expect(kais.totals).toEqual({ income: 4, expense: 12.5, balance: -8.5, count: 2, atTodaysRate: true });
      expect(sams.totals).toEqual({ income: 0, expense: 0, balance: 0, count: 0, atTodaysRate: false });
      expect(ledger.combined()).toEqual({ income: 104, expense: 62.75, balance: 41.25, count: 4, atTodaysRate: true });

      const cafe = ledger.rows().find(row => row.sourceId === 'cafe')!;
      expect(cafe.amount).withContext('the row keeps what was entered').toBe(10);
      expect(cafe.inBase).toBe(12.5);
      expect(cafe.atTodaysRate).toBeTrue();
      const rent = ledger.rows().find(row => row.sourceId === 'rent')!;
      expect(rent.inBase).toBe(50.25);
      expect(rent.atTodaysRate).toBeFalse();
    });

    it('keeps the household figure exact while every copy is in the base', () => {
      follow([me, kai]);
      answer([copy(ME, 'a', { amount: 0.1 }), copy(KAI, 'b', { amount: 0.2 })]);

      expect(ledger.combined()).toEqual({ income: 0, expense: 0.3, balance: -0.3, count: 2, atTodaysRate: false });
    });

    it("refolds every figure for another base, and for today's rates", () => {
      follow([me, kai]);
      answer([
        copy(ME, 'rent', { amount: 50 }),
        copy(KAI, 'cafe', { amount: 10, currency: 'EUR' }),
        copy(KAI, 'dinner', { amount: 3200, currency: 'TWD' })
      ]);

      user.set(viewer('TWD'));

      expect(ledger.totalsByMember().map(line => [line.member.uid, line.totals.expense, line.totals.atTodaysRate]))
        .toEqual([
          // 50 × 32
          [ME, 1600, true],
          // 10 × 32 / 0.8, and 3200 as it is
          [KAI, 3600, true]
        ]);
      const dinner = ledger.rows().find(row => row.sourceId === 'dinner')!;
      expect([dinner.inBase, dinner.atTodaysRate]).toEqual([3200, false]);

      currency.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.5], ['TWD', 30], ['JPY', 150]]));

      // 50 × 30; 10 × 30 / 0.5 + 3200
      expect(ledger.totalsByMember().map(line => line.totals.expense)).toEqual([1500, 3800]);
      expect(ledger.combined().expense).toBe(5300);
    });

    describe("before today's rates have loaded", () => {
      // Until the rate table settles on a source it is a placeholder, and
      // any conversion through it reads 1:1.
      beforeEach(() => {
        currency.rateSource.set(null);
        user.set(viewer('EUR'));
      });

      const mixed = () => [
        copy(ME, 'rent', { amount: 50, currency: 'EUR', date: at(20) }),
        copy(KAI, 'ramen', { amount: 15000, currency: 'JPY', date: at(10) })
      ];

      it('holds a copy in another currency out of the rows and every figure, and says the rates are pending', () => {
        follow([me, kai]);
        answer(mixed());

        expect(ledger.ratesPending()).toBeTrue();
        expect(ledger.rows().map(row => [row.sourceId, row.atTodaysRate])).toEqual([['rent', false]]);
        expect(ledger.totalsByMember().map(line => [line.member.uid, line.totals.expense, line.totals.count, line.totals.atTodaysRate]))
          .toEqual([[ME, 50, 1, false], [KAI, 0, 0, false]]);
        expect(ledger.combined()).toEqual({ income: 0, expense: 50, balance: -50, count: 1, atTodaysRate: false });
      });

      it("shows a household whose copies are all in the viewer's currency at once", () => {
        follow([me, kai]);
        answer([copy(ME, 'rent', { amount: 50, currency: 'EUR' }), copy(KAI, 'cafe', { amount: 4, currency: 'EUR' })]);

        expect(ledger.ratesPending()).toBeFalse();
        expect(ledger.rows().length).toBe(2);
        expect(ledger.combined()).toEqual({ income: 0, expense: 54, balance: -54, count: 2, atTodaysRate: false });
      });

      for (const source of ['live', 'cached', 'expired', 'fallback'] as const) {
        it(`releases the converted figures once the rates settle, from the ${source} table as from any`, () => {
          follow([me, kai]);
          answer(mixed());

          currency.rateSource.set(source);

          expect(ledger.ratesPending()).toBeFalse();
          const [rent, ramen] = ledger.rows();
          expect([rent.sourceId, rent.inBase, rent.atTodaysRate]).toEqual(['rent', 50, false]);
          expect([ramen.sourceId, ramen.atTodaysRate]).toEqual(['ramen', true]);
          // 15000 × 0.8 / 150, where the placeholder's 1:1 would give 15000.
          expect(ramen.inBase).toBeCloseTo(80, 9);
          expect(ledger.combined().expense).toBeCloseTo(130, 9);
          expect(ledger.combined()).toEqual(jasmine.objectContaining({ count: 2, atTodaysRate: true }));
        });
      }
    });
  });

  describe('its cap', () => {
    it('keeps the newest copies up to the cap and says there were more', () => {
      follow([me, kai]);
      // Newest first, as the query delivers them: the one past the cap is
      // the oldest.
      const many = Array.from({ length: LEDGER_VIEW_CAP + 1 }, (_, i) =>
        copy(i % 2 ? ME : KAI, `row-${String(i).padStart(5, '0')}`, {
          date: Timestamp.fromMillis(at(31).toMillis() - i * 1000)
        })
      );

      answer(many);

      expect(ledger.truncated()).toBeTrue();
      expect(ledger.rows().length).toBe(LEDGER_VIEW_CAP);
      expect(ledger.rows().some(row => row.id === many[LEDGER_VIEW_CAP].id)).toBeFalse();
      expect(ledger.combined().count).toBe(LEDGER_VIEW_CAP);

      answer(many.slice(0, LEDGER_VIEW_CAP));
      expect(ledger.truncated()).withContext('exactly the cap is all of them').toBeFalse();
      expect(ledger.rows().length).toBe(LEDGER_VIEW_CAP);
    });

    it('starts a new period uncapped', () => {
      follow();
      answer(Array.from({ length: LEDGER_VIEW_CAP + 1 }, (_, i) => copy(KAI, `r${i}`)));
      expect(ledger.truncated()).toBeTrue();

      ledger.setPeriod(SEPTEMBER);

      expect(ledger.truncated()).toBeFalse();
    });
  });

  describe("the household's plans' window", () => {
    // September's budgets, as planWindow hands them over: through the last
    // millisecond of the month. August, the period, is a month already over.
    const SEPTEMBER_BUDGETS: DateWindow = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const JULY: DateWindow = monthWindow({ year: 2026, month: 6 });
    const open = () => opened.filter(listener => listener.subject.observed);
    const boundsOf = (listener: Listener) => listener.options!.where!.slice(1);
    const reading = (window: DateWindow) => [
      { field: 'date', op: '>=' as const, value: Timestamp.fromDate(window.start) },
      { field: 'date', op: '<=' as const, value: Timestamp.fromDate(endOfDay(window.end)) }
    ];
    /** `count` copies a second apart, newest first as the query delivers them. */
    const newestFirst = (count: number, from: Date, prefix: string) => Array.from({ length: count }, (_, i) =>
      copy(KAI, `${prefix}${String(i).padStart(5, '0')}`, { date: Timestamp.fromMillis(from.getTime() - i * 1000) }));

    it("reads a plan window the period does not hold through a capped listener of its own, which never crowds out the period's rows", () => {
      follow([me, kai]);
      const period = latest();

      ledger.setPlanWindow(SEPTEMBER_BUDGETS);

      expect(period.subject.observed).withContext("the period's listener is kept").toBeTrue();
      expect(open().length).toBe(2);
      const plans = latest();
      expect(plans.path).toBe(LEDGER);
      expect(plans.options).toEqual({
        where: [{ field: 'gen', op: '==', value: GEN }, ...reading(SEPTEMBER_BUDGETS)],
        orderBy: [{ field: 'date', direction: 'desc' }],
        limit: LEDGER_VIEW_CAP + 1
      });
      // No query spans the weeks between the two.
      expect(opened.map(boundsOf)).toEqual([reading(AUGUST), reading(SEPTEMBER_BUDGETS)]);

      // September holds more copies than the cap; August far fewer.
      const september = newestFirst(LEDGER_VIEW_CAP + 1, new Date(2026, 8, 29), 'sep');
      answerTo(plans, september);
      answerTo(period, [
        copy(KAI, 'aug-last', { date: Timestamp.fromDate(endOfDay(AUGUST.end)), amount: 2 }),
        copy(ME, 'aug', { amount: 4 }),
        copy(ME, 'aug-first', { date: Timestamp.fromDate(AUGUST.start), amount: 1 })
      ]);

      expect(ledger.rows().map(row => row.sourceId)).toEqual(['aug-last', 'aug', 'aug-first']);
      expect(ledger.combined()).toEqual({ income: 0, expense: 7, balance: -7, count: 3, atTodaysRate: false });
      expect(ledger.truncated()).toBeFalse();
      // The plans read their own listener's copies, and where it was cut.
      expect(ledger.windowCopies().length).toBe(LEDGER_VIEW_CAP);
      expect(ledger.windowCopies().every(held => held.sourceId.startsWith('sep'))).toBeTrue();
      expect(ledger.windowKeptFrom()).toBe(september[LEDGER_VIEW_CAP - 1].date.toMillis());
    });

    it('keeps a period whole when the plan window reaching past it holds more than the cap, and says only the plans were cut', () => {
      const JANUARY: DateWindow = monthWindow({ year: 2026, month: 0 });
      const YEAR: DateWindow = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31, 23, 59, 59, 999) };
      follow([me, kai], JANUARY);
      const period = latest();

      ledger.setPlanWindow(YEAR);

      expect(open().length).toBe(2);
      const plans = latest();
      expect(boundsOf(plans)).toEqual(reading(YEAR));
      // The year's copies from December back, none of them January's, past the cap.
      answerTo(plans, newestFirst(LEDGER_VIEW_CAP + 1, new Date(2026, 11, 30), 'dec'));
      answerTo(period, [
        copy(KAI, 'jan-late', { date: Timestamp.fromDate(new Date(2026, 0, 30)) }),
        copy(ME, 'jan-early', { date: Timestamp.fromDate(new Date(2026, 0, 2)) })
      ]);

      expect(ledger.rows().map(row => row.sourceId)).toEqual(['jan-late', 'jan-early']);
      expect(ledger.truncated()).toBeFalse();
      // A budget over the year may be missing copies: those kept stop short of its start.
      expect(ledger.windowKeptFrom()!).toBeGreaterThanOrEqual(YEAR.start.getTime());
    });

    it('reads the period alone when it holds the plan window, and lends the plans its copies and its cut', () => {
      follow();

      ledger.setPlanWindow({ start: new Date(2026, 7, 10), end: new Date(2026, 7, 20, 23, 59, 59, 999) });
      ledger.setPlanWindow({ start: AUGUST.start, end: endOfDay(AUGUST.end) });

      expect(opened.length).withContext('one listener').toBe(1);
      expect(boundsOf(latest())).toEqual(reading(AUGUST));
      expect(ledger.windowLoading()).toBeTrue();

      answer([copy(KAI, 'aug'), copy(ME, 'aug-2', { date: at(3) })]);
      expect(ledger.windowLoading()).toBeFalse();
      expect(ledger.windowCopies().map(held => held.sourceId)).toEqual(['aug', 'aug-2']);
      expect(ledger.windowKeptFrom()).toBeNull();

      const many = newestFirst(LEDGER_VIEW_CAP + 1, at(31).toDate(), 'aug');
      answer(many);
      expect(ledger.truncated()).toBeTrue();
      expect(ledger.windowKeptFrom()).toBe(many[LEDGER_VIEW_CAP - 1].date.toMillis());
    });

    it("opens, keeps and closes the plans' listener as the dates change, and opens nothing for the same dates again", () => {
      follow();
      ledger.setPlanWindow(SEPTEMBER_BUDGETS);
      expect(opened.length).toBe(2);
      const plans = latest();

      ledger.setPlanWindow({ start: new Date(SEPTEMBER_BUDGETS.start), end: new Date(SEPTEMBER_BUDGETS.end) });
      expect(opened.length).withContext('the same plan window again').toBe(2);

      // Another period that does not hold it either: only the period is read afresh.
      ledger.setPeriod(JULY);
      expect(opened.length).toBe(3);
      expect(boundsOf(latest())).toEqual(reading(JULY));
      expect(plans.subject.observed).withContext("the plans' listener is kept").toBeTrue();

      // A period that holds it: the period's listener serves the plans too.
      ledger.setPeriod(SEPTEMBER);
      expect(plans.subject.observed).toBeFalse();
      expect(open().map(boundsOf)).toEqual([reading(SEPTEMBER)]);
      expect(ledger.windowLoading()).withContext("September's period has not answered").toBeTrue();
      answer([copy(KAI, 'sep', { date: Timestamp.fromDate(new Date(2026, 8, 2)) })]);
      expect(ledger.windowCopies().map(held => held.sourceId)).toEqual(['sep']);

      // No budget window left: the plans read nothing, and the period is read as it was.
      ledger.setPlanWindow(null);
      expect(opened.length).toBe(4);
      expect(ledger.windowCopies()).toEqual([]);
      expect(ledger.windowLoading()).toBeFalse();
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['sep']);
    });

    it('listens for a plan window with no period set, showing no rows', () => {
      ledger.setMembers([me]);
      ledger.setHousehold(HOME);
      expect(opened.length).toBe(0);

      ledger.setPlanWindow(SEPTEMBER_BUDGETS);
      expect(opened.length).toBe(1);
      expect(ledger.windowLoading()).toBeTrue();
      expect(ledger.loading()).withContext('no period to wait for').toBeFalse();

      answer([copy(ME, 'sep', { date: Timestamp.fromDate(new Date(2026, 8, 2)) })]);
      expect(ledger.windowLoading()).toBeFalse();
      expect(ledger.rows()).toEqual([]);
      expect(ledger.windowCopies().map(held => held.sourceId)).toEqual(['sep']);
    });

    it("says where the plans' copies came from, and that their listener failed, apart from the period's", () => {
      follow();
      ledger.setPlanWindow(SEPTEMBER_BUDGETS);
      const [period, plans] = open();
      answerTo(plans, [copy(KAI, 'sep', { date: Timestamp.fromDate(new Date(2026, 8, 2)) })], true);
      answerTo(period, [copy(KAI, 'aug')]);

      expect(ledger.windowFromCache()).toBeTrue();
      expect(ledger.fromCache()).withContext("the period's own answer").toBeFalse();

      const failure = firebaseError('unavailable');
      plans.subject.error(failure);

      expect(ledger.windowIncomplete()).toBeTrue();
      expect(ledger.incomplete()).withContext("the overview's figures are whole").toBeFalse();
      expect(ledgerLogs(consoleWarn)).toEqual([["[HouseholdLedger] The budgets' ledger listener stopped:", failure]]);
    });

    it('reads a listener that stopped afresh at the next change of dates', () => {
      follow();
      const augustToSeptember: DateWindow = { start: AUGUST.start, end: SEPTEMBER.end };
      ledger.setPlanWindow(augustToSeptember);
      const [period, plans] = open();

      period.subject.error(firebaseError('unavailable'));
      plans.subject.error(firebaseError('unavailable'));
      expect(ledger.incomplete()).toBeTrue();
      expect(ledger.windowIncomplete()).toBeTrue();

      ledger.setPeriod(SEPTEMBER);

      expect(opened.length).toBe(4);
      expect(open().map(boundsOf)).toEqual([reading(SEPTEMBER), reading(augustToSeptember)]);
      expect(ledger.incomplete()).toBeFalse();
      expect(ledger.windowIncomplete()).toBeFalse();
    });

    it('counts every date as cut when the oldest copy kept has a date it cannot read', () => {
      follow();
      ledger.setPlanWindow(SEPTEMBER_BUDGETS);
      const september = newestFirst(LEDGER_VIEW_CAP + 1, new Date(2026, 8, 29), 'sep');
      september[LEDGER_VIEW_CAP - 1] = { ...september[LEDGER_VIEW_CAP - 1], date: 'yesterday' as unknown as Timestamp };

      answer(september);

      expect(ledger.windowKeptFrom()).toBe(Number.POSITIVE_INFINITY);
    });

    it("judges an account whose copies only the plans' listener shows", async () => {
      follow([me]);
      ledger.setPlanWindow(SEPTEMBER_BUDGETS);

      answer([copy(GONE, 'g-sep', { date: Timestamp.fromDate(new Date(2026, 8, 2)) })]);
      await settle();

      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
    });
  });

  describe('where its answer came from', () => {
    it("says when what it shows is this device's cache, until the server answers", () => {
      follow();
      expect(ledger.fromCache()).toBeFalse();

      answer([copy(KAI, 'cached')], true);
      expect(ledger.fromCache()).toBeTrue();
      expect(ledger.loading()).withContext('the cache is an answer').toBeFalse();
      expect(ledger.rows().length).toBe(1);

      // Only the metadata moves: the same copies, now confirmed.
      answer([copy(KAI, 'cached')]);
      expect(ledger.fromCache()).toBeFalse();

      ledger.setPeriod(SEPTEMBER);
      expect(ledger.fromCache()).withContext('another period starts unknown').toBeFalse();
      expect(ledger.loading()).toBeTrue();
    });
  });

  describe('when its listener fails', () => {
    it('stops quietly on a refusal, leaving the ended membership to the household service', () => {
      follow();
      answer([copy(KAI, 'shown')]);

      latest().subject.error(firebaseError('permission-denied'));

      expect(latest().subject.observed).toBeFalse();
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['shown']);
      expect(ledger.incomplete()).toBeFalse();
      expect(ledgerLogs(consoleWarn)).toEqual([]);
      expect(errorHandler.handleError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(opened.length).withContext('not asked again').toBe(1);
    });

    it('logs any other failure and keeps what it showed', () => {
      follow();
      answer([copy(KAI, 'shown')]);
      const failure = firebaseError('internal');

      latest().subject.error(failure);

      expect(ledgerLogs(consoleWarn)).toEqual([['[HouseholdLedger] The ledger listener stopped:', failure]]);
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['shown']);
      expect(ledger.incomplete()).toBeFalse();
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });

    it('says the figures may be incomplete when it failed before it answered, and stops waiting', () => {
      follow();

      latest().subject.error(firebaseError('unavailable'));

      expect(ledger.loading()).toBeFalse();
      expect(ledger.incomplete()).toBeTrue();
      expect(ledger.rows()).toEqual([]);

      ledger.setPeriod(SEPTEMBER);
      expect(ledger.incomplete()).withContext('a period read afresh').toBeFalse();
    });

    it("says the figures may be incomplete when it failed after only the cache answered, keeping the cache's rows", async () => {
      follow([me, kai]);
      answer([copy(KAI, 'cached'), copy(GONE, 'stranger')], true);
      const failure = firebaseError('failed-precondition');

      latest().subject.error(failure);
      await settle();

      expect(ledger.incomplete()).toBeTrue();
      expect(ledger.loading()).toBeFalse();
      expect(ledger.fromCache()).withContext('still only what this device held').toBeTrue();
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['cached']);
      expect(ledgerLogs(consoleWarn)).toEqual([['[HouseholdLedger] The ledger listener stopped:', failure]]);
      // A failure is no server answer: nobody is judged from the cache.
      expect(memberReads()).toEqual([]);
      expect(sharing.purgeMember).not.toHaveBeenCalled();
    });

    it('says the same when the cache answered with nothing before it failed', () => {
      follow();
      answer([], true);

      latest().subject.error(firebaseError('failed-precondition'));

      expect(ledger.incomplete()).toBeTrue();
      expect(ledger.loading()).toBeFalse();
      expect(ledger.rows()).toEqual([]);
    });

    it('stays quiet on a refusal after only the cache answered', () => {
      follow();
      answer([copy(KAI, 'cached')], true);

      latest().subject.error(firebaseError('permission-denied'));

      expect(ledger.incomplete()).toBeFalse();
      expect(ledgerLogs(consoleWarn)).toEqual([]);
    });
  });

  describe("an owner's purge of a removed member's copies", () => {
    it('purges the copies of an account the server confirms is no member, once per account', async () => {
      follow([me, kai]);
      liveMember(KAI);

      answer([copy(KAI, 'k1'), copy(GONE, 'g1'), copy('left', 'l1')]);
      await settle();

      expect(memberReads().sort()).toEqual([`households/h1/members/${GONE}`, 'households/h1/members/left']);
      expect([...sharing.purgeMember.calls.allArgs()].sort()).toEqual([['h1', GONE], ['h1', 'left']]);

      answer([copy(KAI, 'k1'), copy(GONE, 'g1'), copy(GONE, 'g2'), copy('left', 'l1')]);
      ledger.setMembers([me, kai]);
      await settle();

      expect(sharing.purgeMember).toHaveBeenCalledTimes(2);
      expect(memberReads().length).toBe(2);
      expect(ledger.rows().map(row => row.memberUid)).toEqual([KAI]);
    });

    it('reaches the sharing code through its dynamic import', async () => {
      loader.and.callThrough();
      follow([me]);

      answer([copy(GONE, 'g1')]);
      const start = Date.now();
      while (sharing.purgeMember.calls.count() === 0 && Date.now() - start < 5000) await settle();

      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
    });

    it('leaves a member the server still lists alone: the list reached this page late', async () => {
      follow([me]);
      liveMember(KAI);

      answer([copy(KAI, 'k1')]);
      await settle();

      expect(memberReads()).toEqual([`households/h1/members/${KAI}`]);
      expect(sharing.purgeMember).not.toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
    });

    it('purges for a member document of an earlier generation', async () => {
      follow([me]);
      const stale: HouseholdMember = {
        uid: GONE, displayName: 'Old', role: 'member', since: new Timestamp(GEN.seconds - 3600, 0), joinedAt: GEN
      };
      firestore.setMockDocument(`households/h1/members/${GONE}`, stale);

      answer([copy(GONE, 'g1')]);
      await settle();

      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
    });

    it('purges when the rules refuse the member document, as they refuse one of another generation', async () => {
      spyOn(firestore, 'getDocumentFromServer').and.rejectWith(firebaseError('permission-denied'));
      follow([me]);

      answer([copy(GONE, 'g1')]);
      await settle();

      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
      expect(ledgerLogs(consoleWarn)).toEqual([]);
    });

    it("judges nothing from the cache: only the server's answer can say an account is gone", async () => {
      follow([me]);

      answer([copy(GONE, 'g1')], true);
      await settle();
      expect(memberReads()).toEqual([]);

      answer([copy(GONE, 'g1')]);
      await settle();
      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
    });

    it('judges nothing before it knows the members', async () => {
      ledger.setHousehold(HOME);
      ledger.setPeriod(AUGUST);

      answer([copy(KAI, 'k1')]);
      await settle();

      expect(memberReads()).toEqual([]);
      expect(ledger.rows()).toEqual([]);
    });

    it("is the owner's alone: a member purges nobody", async () => {
      follow([me], AUGUST, { ...HOME, ownerId: KAI });

      answer([copy(GONE, 'g1')]);
      await settle();

      expect(memberReads()).toEqual([]);
      expect(sharing.purgeMember).not.toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
      expect(ledger.rows()).toEqual([]);
    });

    it('warns of a failed purge, raises nothing and does not ask again', async () => {
      const failure = firebaseError('permission-denied');
      sharing.purgeMember.and.rejectWith(failure);
      follow([me]);

      answer([copy(GONE, 'g1')]);
      await settle();
      answer([copy(GONE, 'g1'), copy(GONE, 'g2')]);
      await settle();

      expect(sharing.purgeMember).toHaveBeenCalledTimes(1);
      expect(ledgerLogs(consoleWarn)).toEqual([["[HouseholdLedger] A removed member's copies were not purged:", failure]]);
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });

    it('warns when the server cannot say, and asks again at its next answer', async () => {
      const failure = firebaseError('unavailable');
      const read = spyOn(firestore, 'getDocumentFromServer').and.rejectWith(failure);
      follow([me]);

      answer([copy(GONE, 'g1')]);
      await settle();
      expect(ledgerLogs(consoleWarn)).toEqual([["[HouseholdLedger] A removed member's copies were not judged; the next answer asks again:", failure]]);
      expect(sharing.purgeMember).not.toHaveBeenCalled();

      read.and.resolveTo(null);
      answer([copy(GONE, 'g1')]);
      await settle();
      expect(sharing.purgeMember).toHaveBeenCalledOnceWith('h1', GONE);
    });

    it('warns when the sharing code does not load, raising nothing', async () => {
      const failure = new Error('chunk failed');
      loader.and.rejectWith(failure);
      follow([me]);

      answer([copy(GONE, 'g1')]);
      await settle();

      expect(ledgerLogs(consoleWarn)).toEqual([["[HouseholdLedger] A removed member's copies were not purged:", failure]]);
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });
  });
});
