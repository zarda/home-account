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
import { Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import { HouseholdPlansService } from './household-plans.service';
import { HouseholdLedgerService, LedgerHousehold } from './household-ledger.service';
import { HouseholdError } from './household.service';
import { BatchOp, CollectionWithMetadata, FirestoreService, QueryOptions } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { LedgerShareService } from './ledger-share.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK,
  HouseholdBudget,
  HouseholdContribution,
  HouseholdGoal,
  HouseholdMemberIdentity,
  LEDGER_QUERY_SHAPES,
  LEDGER_VIEW_CAP,
  LedgerCopy,
  User,
  ledgerCopyPath
} from '../../models';
import { DateWindow, endOfDay, monthWindow } from '../utils/transaction-date.utils';

interface Listener {
  path: string;
  options: QueryOptions | undefined;
  subject: Subject<CollectionWithMetadata<unknown>>;
}

describe('HouseholdPlansService', () => {
  const ME = 'me';
  const KAI = 'kai';
  const GONE = 'gone';
  const me: HouseholdMemberIdentity = { uid: ME, displayName: 'Me' };
  const kai: HouseholdMemberIdentity = { uid: KAI, displayName: 'Kai' };

  // Microseconds in it, as the server stamps a generation.
  const GEN = new Timestamp(1_767_605_400, 123_456_000);
  const HOME: LedgerHousehold = { id: 'h1', ownerId: KAI, createdAt: GEN };
  const BUDGETS = 'households/h1/budgets';
  const GOALS = 'households/h1/goals';
  const LEDGER = 'households/h1/ledger';
  const contributionsOf = (goalId: string) => `households/h1/goals/${goalId}/contributions`;

  const AUGUST: DateWindow = monthWindow({ year: 2026, month: 7 });
  const NOW = new Date(2026, 8, 15, 10);
  const stamp = (date: Date) => Timestamp.fromDate(date);
  const on = (day: number, month = 8) => stamp(new Date(2026, month, day, 12));

  let user: WritableSignal<User | null>;
  let online: WritableSignal<boolean>;
  let firestore: MockFirestoreService;
  let currency: CurrencyService;
  let injector: EnvironmentInjector;
  let destroyed: boolean;
  let ledger: HouseholdLedgerService;
  let plans: HouseholdPlansService;
  let opened: Listener[];
  let ids: number;
  let consoleWarn: jasmine.Spy;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;

  const firebaseError = (code: string) => Object.assign(new Error(code), { name: 'FirebaseError', code });

  const listenersAt = (path: string) => opened.filter(listener => listener.path === path);
  const openAt = (path: string) => listenersAt(path).filter(listener => listener.subject.observed);
  const byField = (field: string) => (listener: Listener) => listener.options?.where?.[1]?.field === field;
  const dateListeners = () => listenersAt(LEDGER).filter(byField('date'));
  const linkListeners = () => listenersAt(LEDGER).filter(byField('goalId'));
  const openLinkListeners = () => linkListeners().filter(listener => listener.subject.observed);

  function latest(listeners: Listener[]): Listener {
    if (listeners.length === 0) throw new Error('no such listener');
    return listeners[listeners.length - 1];
  }

  function answer(listener: Listener, docs: unknown[], fromCache = false): void {
    listener.subject.next({ docs, fromCache, hasPendingWrites: false });
  }

  const answerBudgets = (docs: HouseholdBudget[], fromCache = false) => answer(latest(listenersAt(BUDGETS)), docs, fromCache);
  const answerGoals = (docs: HouseholdGoal[], fromCache = false) => answer(latest(listenersAt(GOALS)), docs, fromCache);
  const answerLedger = (docs: StoredCopy[]) => answer(latest(dateListeners()), docs);
  const answerContributions = (goalId: string, docs: HouseholdContribution[]) =>
    answer(latest(listenersAt(contributionsOf(goalId))), docs);

  type StoredCopy = LedgerCopy & { id: string };

  let made = 0;
  function budget(id: string, overrides: Partial<HouseholdBudget> = {}): HouseholdBudget {
    made += 1;
    return {
      id,
      gen: GEN,
      name: `Budget ${id}`,
      categoryIds: ['food'],
      amount: 100,
      currency: 'USD',
      period: 'monthly',
      startDate: stamp(new Date(2026, 8, 1)),
      isActive: true,
      createdBy: KAI,
      createdAt: new Timestamp(GEN.seconds + made, 0),
      updatedAt: new Timestamp(GEN.seconds + made, 0),
      ...overrides
    };
  }

  function goal(id: string, overrides: Partial<HouseholdGoal> = {}): HouseholdGoal {
    made += 1;
    return {
      id,
      gen: GEN,
      name: `Goal ${id}`,
      targetAmount: 200,
      currency: 'EUR',
      isActive: true,
      createdBy: KAI,
      createdAt: new Timestamp(GEN.seconds + made, 0),
      updatedAt: new Timestamp(GEN.seconds + made, 0),
      ...overrides
    };
  }

  const contribution = (id: string, memberUid: string, amount: number): HouseholdContribution => ({
    id,
    gen: GEN,
    memberUid,
    amount,
    date: on(10),
    createdAt: GEN
  });

  /** A copy of the live generation: one dollar of groceries on 10 September unless told otherwise. */
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
      date: on(10),
      description: sourceId,
      categoryId: 'food_groceries',
      category: { name: 'categoryNames.groceries', icon: 'shopping_cart', color: '#FF5722' },
      bucket: 'food_groceries',
      bucketGroup: 'food',
      updatedAt: on(10),
      ...overrides
    };
  }

  /** What the household page does: hands both services the household, and the ledger its members and period. */
  function follow(household: LedgerHousehold = HOME, members: HouseholdMemberIdentity[] = [me, kai]): void {
    ledger.setHousehold(household);
    ledger.setMembers(members);
    ledger.setPeriod(AUGUST);
    plans.setHousehold(household);
    plans.setNow(NOW);
  }

  const planLogs = () => consoleWarn.calls.allArgs().filter(args => String(args[0]).startsWith('[HouseholdPlans]'));

  /** Lets a chain of reads and commits the service started on its own run out. */
  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const landed = () => firestore.batches;

  async function refusal(work: Promise<unknown>): Promise<HouseholdError> {
    try {
      await work;
    } catch (error) {
      expect(error).toEqual(jasmine.any(HouseholdError));
      return error as HouseholdError;
    }
    throw new Error('expected a refusal');
  }

  beforeEach(async () => {
    localStorage.removeItem('home-account.exchangeRates');
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    user = signal<User | null>({
      id: ME,
      email: 'me@example.test',
      displayName: 'Me',
      preferences: { baseCurrency: 'USD', language: 'en' }
    } as User);
    online = signal(true);
    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useValue: { userId: computed(() => user()?.id ?? null), currentUser: user } },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LedgerShareService, useValue: { purgeMember: jasmine.createSpy('purgeMember').and.resolveTo(0) } },
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    });
    firestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;

    // The real conversion, pinned to rates unlike the compiled-in ones.
    currency = TestBed.inject(CurrencyService);
    await currency.ensureRatesLoaded();
    currency.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.8], ['JPY', 150]]));

    opened = [];
    spyOn(firestore, 'subscribeToCollectionWithMetadata').and.callFake(((path: string, options?: QueryOptions) => {
      const subject = new Subject<CollectionWithMetadata<unknown>>();
      opened.push({ path, options, subject });
      return subject.asObservable();
    }) as never);
    ids = 0;
    spyOn(firestore, 'generateId').and.callFake(() => `new-${++ids}`);
    consoleWarn = spyOn(console, 'warn').and.callThrough();

    // Provided below the root, as the household page provides both.
    injector = createEnvironmentInjector(
      [HouseholdLedgerService, HouseholdPlansService],
      TestBed.inject(EnvironmentInjector)
    );
    destroyed = false;
    ledger = injector.get(HouseholdLedgerService);
    plans = injector.get(HouseholdPlansService);
  });

  afterEach(() => {
    if (!destroyed) injector.destroy();
  });

  describe('its listeners', () => {
    it("reads the household's active budgets and goals, each by its composite's shape, once a household is set", () => {
      expect(opened.length).toBe(0);

      plans.setHousehold(HOME);

      const byActive: QueryOptions = { where: [{ field: 'gen', op: '==', value: GEN }, { field: 'isActive', op: '==', value: true }] };
      expect(listenersAt(BUDGETS).map(listener => listener.options)).toEqual([byActive]);
      expect(listenersAt(GOALS).map(listener => listener.options)).toEqual([byActive]);
      expect(LEDGER_QUERY_SHAPES.activeBudgets.fields).toEqual([['gen', 'ASCENDING'], ['isActive', 'ASCENDING']]);
      expect(LEDGER_QUERY_SHAPES.activeGoals.fields).toEqual([['gen', 'ASCENDING'], ['isActive', 'ASCENDING']]);
      // No date listener of its own: the budgets fold the ledger's copies.
      expect(dateListeners()).toEqual([]);
      expect(firestore.getCollectionSpy.calls.length).toBe(0);
    });

    it("reads each active goal's contributions newest first, and the copies linked to the goals thirty ids at a time", () => {
      plans.setHousehold(HOME);
      const many = Array.from({ length: 31 }, (_, i) => goal(`g${String(i).padStart(2, '0')}`));

      answerGoals(many);

      for (const each of many) {
        expect(listenersAt(contributionsOf(each.id)).map(listener => listener.options)).toEqual([{
          where: [{ field: 'gen', op: '==', value: GEN }],
          orderBy: [{ field: 'date', direction: 'desc' }],
          limit: LEDGER_VIEW_CAP + 1
        }]);
      }
      expect(LEDGER_QUERY_SHAPES.contributionsByDate.fields).toEqual([['gen', 'ASCENDING'], ['date', 'DESCENDING']]);
      const sorted = many.map(each => each.id);
      expect(linkListeners().map(listener => listener.options)).toEqual([
        { where: [{ field: 'gen', op: '==', value: GEN }, { field: 'goalId', op: 'in', value: sorted.slice(0, 30) }], limit: LEDGER_VIEW_CAP + 1 },
        { where: [{ field: 'gen', op: '==', value: GEN }, { field: 'goalId', op: 'in', value: sorted.slice(30) }], limit: LEDGER_VIEW_CAP + 1 }
      ]);
      expect(LEDGER_QUERY_SHAPES.ledgerByGoal.fields).toEqual([['gen', 'ASCENDING'], ['goalId', 'ASCENDING']]);
    });

    it('follows the goals: a goal gone closes its contributions listener, a new one opens its own, and the links are read afresh', () => {
      plans.setHousehold(HOME);
      answerGoals([goal('a'), goal('b')]);
      const [aListener] = listenersAt(contributionsOf('a'));
      const firstLinks = latest(linkListeners());

      answerGoals([goal('b'), goal('c')]);

      expect(aListener.subject.observed).toBeFalse();
      expect(openAt(contributionsOf('b')).length).withContext('kept, not reopened').toBe(1);
      expect(listenersAt(contributionsOf('b')).length).toBe(1);
      expect(openAt(contributionsOf('c')).length).toBe(1);
      expect(firstLinks.subject.observed).toBeFalse();
      expect(openLinkListeners().map(listener => listener.options!.where![1].value)).toEqual([['b', 'c']]);

      // The same goals again: nothing reopened.
      answerGoals([goal('c'), goal('b')]);
      expect(linkListeners().length).toBe(2);

      answerGoals([]);
      expect(openLinkListeners()).toEqual([]);
      expect(openAt(contributionsOf('b'))).toEqual([]);
    });

    it('closes every listener for another household, and when destroyed', () => {
      plans.setHousehold(HOME);
      answerGoals([goal('a')]);
      const first = opened.filter(listener => listener.subject.observed);
      expect(first.length).toBe(4);

      plans.setHousehold({ ...HOME, createdAt: new Timestamp(GEN.seconds + 60, 0) });
      expect(first.every(listener => !listener.subject.observed)).toBeTrue();
      expect(latest(listenersAt(BUDGETS)).options!.where![0].value).toEqual(new Timestamp(GEN.seconds + 60, 0));

      plans.setHousehold({ ...HOME });
      plans.setHousehold({ ...HOME });
      expect(listenersAt(BUDGETS).length).withContext('the same household, read once').toBe(3);

      plans.setHousehold(null);
      expect(opened.some(listener => listener.subject.observed)).toBeFalse();
      expect(plans.budgets()).toEqual([]);
      expect(plans.loading()).toBeFalse();

      plans.setHousehold(HOME);
      answerGoals([goal('a')]);
      injector.destroy();
      destroyed = true;
      expect(opened.some(listener => listener.subject.observed)).toBeFalse();
      plans.setHousehold({ ...HOME, id: 'h2' });
      expect(listenersAt('households/h2/budgets')).toEqual([]);
    });
  });

  describe('its budgets', () => {
    it("folds each from the ledger's copies over its own window, which it hands the ledger to read", () => {
      follow();
      const period = latest(dateListeners());
      expect(period.options!.where!.slice(1)).withContext('the period alone').toEqual([
        { field: 'date', op: '>=', value: stamp(AUGUST.start) },
        { field: 'date', op: '<=', value: stamp(endOfDay(AUGUST.end)) }
      ]);

      answerBudgets([
        budget('food', { categoryIds: ['food'], currency: 'USD' }),
        budget('eat-out', { categoryIds: ['food_restaurants'], currency: 'EUR', createdBy: ME })
      ]);

      // September's budget window, which August does not hold, on a listener of its own.
      expect(dateListeners().length).toBe(2);
      expect(period.subject.observed).withContext("the period's listener is kept").toBeTrue();
      expect(latest(dateListeners()).options!.where!.slice(1)).toEqual([
        { field: 'date', op: '>=', value: stamp(new Date(2026, 8, 1)) },
        { field: 'date', op: '<=', value: stamp(new Date(2026, 8, 30, 23, 59, 59, 999)) }
      ]);

      answerLedger([
        copy(ME, 'dinner', { date: on(12), amount: 5, bucket: 'food_restaurants' }),
        copy(GONE, 'stranger', { date: on(11), amount: 500 }),
        copy(KAI, 'market', { date: on(10), amount: 8, currency: 'EUR' }),
        copy(ME, 'fuel', { date: on(9), amount: 50, bucket: 'transport_fuelAndGas', bucketGroup: 'transport' }),
        copy(KAI, 'refund', { date: on(8), type: 'income', amount: 30 })
      ]);
      answer(period, [copy(ME, 'august', { date: on(20, 7), amount: 7 })]);

      const [food, eatOut] = plans.budgets();
      // 5 + 8 / 0.8; the removed member's and the income copies count nothing.
      expect(food).toEqual({
        budget: jasmine.objectContaining({ id: 'food' }),
        spent: 15,
        atTodaysRate: true,
        window: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) },
        incomplete: false
      });
      // 5 dollars in euros.
      expect([eatOut.budget.id, eatOut.spent, eatOut.atTodaysRate]).toEqual(['eat-out', 4, true]);
      // The overview still reads August alone.
      expect(ledger.rows().map(row => row.sourceId)).toEqual(['august']);
      expect(plans.loading()).withContext('the goals not heard').toBeTrue();
      answerGoals([]);
      expect(plans.loading()).toBeFalse();
    });

    it("refolds for today's rates and for another day, and reads that day's window", () => {
      follow();
      answerBudgets([budget('food')]);
      answerLedger([copy(KAI, 'market', { amount: 8, currency: 'EUR' })]);
      expect(plans.budgets()[0].spent).toBe(10);

      currency.exchangeRates.set(new Map([['USD', 1], ['EUR', 0.5], ['JPY', 150]]));
      expect(plans.budgets()[0].spent).toBe(16);

      plans.setNow(new Date(2026, 9, 2, 9));
      expect(latest(dateListeners()).options!.where!.slice(1)).toEqual([
        { field: 'date', op: '>=', value: stamp(new Date(2026, 9, 1)) },
        { field: 'date', op: '<=', value: stamp(new Date(2026, 9, 31, 23, 59, 59, 999)) }
      ]);
      answerLedger([copy(KAI, 'market', { amount: 8, currency: 'EUR' })]);
      expect(plans.budgets()[0].spent).withContext("September's row is not October's").toBe(0);
      expect(plans.budgets()[0].window!.start).toEqual(new Date(2026, 9, 1));
    });

    it('says a budget may be incomplete when the copies kept stop short of its window, or the ledger failed before answering', () => {
      follow();
      answerBudgets([budget('food')]);
      answerLedger(Array.from({ length: LEDGER_VIEW_CAP + 1 }, (_, i) =>
        copy(KAI, `r${String(i).padStart(5, '0')}`, { date: Timestamp.fromMillis(on(20).toMillis() - i * 1000) })));
      expect(plans.budgets()[0].incomplete).toBeTrue();

      answerLedger([copy(KAI, 'one')]);
      expect(plans.budgets()[0].incomplete).toBeFalse();

      plans.setNow(new Date(2026, 9, 2));
      latest(dateListeners()).subject.error(firebaseError('unavailable'));
      expect(plans.budgets()[0].incomplete).toBeTrue();
    });

    it("neither waits for the period's listener nor reads its cut, when the budgets' window has a listener of its own", () => {
      follow();
      const period = latest(dateListeners());
      answerBudgets([budget('food')]);
      answerGoals([]);
      answerLedger([copy(KAI, 'market', { amount: 3 })]);

      expect(plans.loading()).withContext("the period's rows are the overview's").toBeFalse();
      expect(plans.budgets()[0].spent).toBe(3);

      answer(period, Array.from({ length: LEDGER_VIEW_CAP + 1 }, (_, i) =>
        copy(KAI, `a${String(i).padStart(5, '0')}`, { date: Timestamp.fromMillis(on(30, 7).toMillis() - i * 1000) })), true);
      expect(ledger.truncated()).toBeTrue();
      expect(plans.budgets()[0].incomplete).toBeFalse();
      expect(plans.fromCache()).withContext("the period's cache is the overview's").toBeFalse();
    });

    it('lists the budgets in the order they were made, a pending one last', () => {
      follow();
      answerBudgets([
        budget('pending', { createdAt: null as unknown as Timestamp }),
        budget('second', { createdAt: new Timestamp(GEN.seconds + 500, 0) }),
        budget('first', { createdAt: new Timestamp(GEN.seconds + 100, 0) })
      ]);

      expect(plans.budgets().map(line => line.budget.id)).toEqual(['first', 'second', 'pending']);
    });
  });

  describe('its goals', () => {
    it("adds the live members' linked copies and contributions, in the goal's currency", () => {
      follow();
      answerBudgets([]);
      answerLedger([]);
      answerGoals([goal('trip', { currency: 'EUR', targetAmount: 200 })]);
      expect(plans.loading()).withContext('its contributions and links not heard').toBeTrue();

      answer(latest(linkListeners()), [
        copy(ME, 'flight', { goalId: 'trip', amount: 50, currency: 'USD', date: on(3, 1) }),
        copy(KAI, 'hotel', { goalId: 'trip', amount: 30, currency: 'EUR' }),
        copy(GONE, 'stranger', { goalId: 'trip', amount: 999, currency: 'EUR' })
      ]);
      answerContributions('trip', [
        contribution('c2', KAI, 10),
        contribution('c1', ME, 100),
        contribution('c0', GONE, 500)
      ]);

      const [trip] = plans.goals();
      // 50 dollars as 40 euros + 30, and 110 contributed.
      expect(trip).toEqual({
        goal: jasmine.objectContaining({ id: 'trip' }),
        saved: 180,
        linked: 70,
        contributed: 110,
        fraction: 0.9,
        atTodaysRate: true,
        contributions: [jasmine.objectContaining({ id: 'c2' }), jasmine.objectContaining({ id: 'c1' })],
        incomplete: false
      });
      expect(plans.loading()).toBeFalse();
    });

    it('says a goal may be incomplete when its contributions or links ran past the cap', () => {
      follow();
      answerGoals([goal('trip')]);
      answer(latest(linkListeners()), []);
      answerContributions('trip', Array.from({ length: LEDGER_VIEW_CAP + 1 }, (_, i) => contribution(`c${i}`, ME, 1)));

      expect(plans.goals()[0].incomplete).toBeTrue();
      expect(plans.goals()[0].contributed).toBe(LEDGER_VIEW_CAP);
    });
  });

  describe('when a listener fails', () => {
    it('stops quietly on a refusal, leaving the ended membership to the household service', () => {
      follow();
      latest(listenersAt(BUDGETS)).subject.error(firebaseError('permission-denied'));

      expect(planLogs()).toEqual([]);
      expect(plans.incomplete()).toBeFalse();
      expect(errorHandler.handleError).not.toHaveBeenCalled();
    });

    it('logs any other failure, and says the plans may be incomplete when it had not answered', () => {
      follow();
      answerBudgets([budget('food')]);
      const failure = firebaseError('unavailable');

      latest(listenersAt(GOALS)).subject.error(failure);
      latest(listenersAt(BUDGETS)).subject.error(firebaseError('internal'));

      expect(planLogs().map(args => args[0])).toEqual([
        '[HouseholdPlans] The goals listener stopped:',
        '[HouseholdPlans] The budgets listener stopped:'
      ]);
      expect(planLogs()[0][1]).toBe(failure);
      expect(plans.incomplete()).withContext('the goals were never heard').toBeTrue();
      expect(plans.budgets().map(line => line.budget.id)).withContext('what was shown stays').toEqual(['food']);
    });

    it('says the lists are from the cache while any of them is', () => {
      follow();
      answerBudgets([], true);
      answerGoals([]);
      answerLedger([]);
      expect(plans.fromCache()).toBeTrue();

      answerBudgets([]);
      expect(plans.fromCache()).toBeFalse();
    });
  });

  describe('its writes', () => {
    beforeEach(() => follow());

    it('makes a budget in one commit: its fields, the generation, its maker, and both stamps the server sets', async () => {
      const id = await plans.createBudget({
        name: '  Groceries ',
        categoryIds: ['food', 'transport', 'food'],
        amount: 400,
        currency: 'EUR',
        period: 'monthly',
        startDate: new Date(2026, 8, 1)
      });

      expect(id).toBe('new-1');
      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([[{
        op: 'set',
        path: `${BUDGETS}/new-1`,
        data: {
          gen: GEN,
          name: 'Groceries',
          categoryIds: ['food', 'transport'],
          amount: 400,
          currency: 'EUR',
          period: 'monthly',
          startDate: stamp(new Date(2026, 8, 1)),
          isActive: true,
          createdBy: ME,
          createdAt: serverTimestamp()
        },
        stamp: 'server'
      }]]);
    });

    it("keeps a budget's end date and alert threshold when given", async () => {
      await plans.createBudget({
        name: 'Food',
        categoryIds: ['food'],
        amount: 400,
        currency: 'USD',
        period: 'weekly',
        startDate: new Date(2026, 8, 2),
        endDate: new Date(2026, 11, 31),
        alertThreshold: 80
      });

      expect(landed()[0][0]).toEqual(jasmine.objectContaining({
        data: jasmine.objectContaining({ endDate: stamp(new Date(2026, 11, 31)), alertThreshold: 80, period: 'weekly' })
      }));
    });

    it('edits only the fields changed, never its currency, maker, generation or creation, and clears an end date', async () => {
      firestore.setMockDocument(`${BUDGETS}/food`, budget('food'));

      await plans.updateBudget('food', { name: 'Food and drink', amount: 450, endDate: null, alertThreshold: null, isActive: false });

      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([[{
        op: 'update',
        path: `${BUDGETS}/food`,
        data: { name: 'Food and drink', amount: 450, endDate: deleteField(), alertThreshold: deleteField(), isActive: false },
        stamp: 'server'
      }]]);

      await plans.updateBudget('food', {});
      expect(firestore.commitBatchSpy.calls.length).withContext('nothing to change').toBe(1);
    });

    it('deletes a budget in one commit', async () => {
      await plans.deleteBudget('food');

      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([[{ op: 'delete', path: `${BUDGETS}/food` }]]);
    });

    it("refuses before writing to delete another member's budget, unless the viewer owns the household", async () => {
      answerBudgets([budget('theirs', { createdBy: KAI })]);

      const error = await refusal(plans.deleteBudget('theirs'));
      expect(error.message).toBe('household.errors.planNotYours');
      expect(firestore.commitBatchSpy.calls.length).toBe(0);

      follow({ ...HOME, ownerId: ME });
      answerBudgets([budget('theirs', { createdBy: KAI })]);
      await plans.deleteBudget('theirs');
      expect(landed()).toEqual([[{ op: 'delete', path: `${BUDGETS}/theirs` }]]);
    });

    it('makes and edits a goal as a budget', async () => {
      const id = await plans.createGoal({ name: 'Trip', targetAmount: 1200, currency: 'JPY', targetDate: new Date(2027, 2, 1) });
      await plans.updateGoal(id, { targetAmount: 1500, targetDate: null });

      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([
        [{
          op: 'set',
          path: `${GOALS}/new-1`,
          data: {
            gen: GEN,
            name: 'Trip',
            targetAmount: 1200,
            currency: 'JPY',
            targetDate: stamp(new Date(2027, 2, 1)),
            isActive: true,
            createdBy: ME,
            createdAt: serverTimestamp()
          },
          stamp: 'server'
        }],
        [{ op: 'update', path: `${GOALS}/new-1`, data: { targetAmount: 1500, targetDate: deleteField() }, stamp: 'server' }]
      ]);
    });

    it("deletes a goal with its contributions: the goal's delete lands with the first chunk, and the rest follow once it is gone", async () => {
      answerGoals([goal('trip', { createdBy: ME })]);
      const first = Array.from({ length: 14 }, (_, i) => contribution(`c${String(i).padStart(2, '0')}`, i % 2 ? KAI : ME, 1));
      // Listed again once the goal is gone: what the first commit left, and
      // one a member added before the goal went.
      const left = [...first.slice(HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK), contribution('late', KAI, 1)];
      const listings = [first, left];
      const commitsBeforeListing: number[] = [];
      const listed = spyOn(firestore, 'getCollectionFromServer').and.callFake((async () => {
        commitsBeforeListing.push(landed().length);
        return listings.shift() ?? [];
      }) as never);

      await plans.deleteGoal('trip');

      const byGen = { where: [{ field: 'gen', op: '==', value: GEN }] };
      expect(listed.calls.allArgs()).toEqual([[contributionsOf('trip'), byGen], [contributionsOf('trip'), byGen]]);
      const del = (id: string): BatchOp => ({ op: 'delete', path: `${contributionsOf('trip')}/${id}` });
      expect(landed()).toEqual([
        [{ op: 'delete', path: `${GOALS}/trip` }, ...first.slice(0, 6).map(each => del(each.id))],
        left.slice(0, 6).map(each => del(each.id)),
        left.slice(6).map(each => del(each.id))
      ]);
      // The rules admit the heaviest of these commits: firestore-rules.smoke.spec.ts
      // deletes a goal with a full chunk of another member's contributions
      // in one. The chunk's size is the lookup arithmetic in its own doc.
      // Listed once before anything is deleted, and again once the goal is gone.
      expect(commitsBeforeListing).toEqual([0, 1]);
    });

    it('resolves once the goal is gone, and removes what its contributions left when the device is back online', async () => {
      answerGoals([goal('trip', { createdBy: ME })]);
      const all = Array.from({ length: 9 }, (_, i) => contribution(`c${i}`, KAI, 1));
      const failure = firebaseError('unavailable');
      const listings: (() => Promise<HouseholdContribution[]>)[] = [
        async () => all,
        async () => { throw failure; },
        async () => all.slice(HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK)
      ];
      const listed = spyOn(firestore, 'getCollectionFromServer')
        .and.callFake((async () => (listings.shift() ?? (async () => []))()) as never);
      const del = (each: HouseholdContribution): BatchOp => ({ op: 'delete', path: `${contributionsOf('trip')}/${each.id}` });

      await plans.deleteGoal('trip');

      expect(landed()).toEqual([[{ op: 'delete', path: `${GOALS}/trip` }, ...all.slice(0, 6).map(del)]]);
      expect(planLogs()).toEqual([
        ["[HouseholdPlans] A deleted goal's contributions were not all removed; the rest go when the device is back online:", failure]
      ]);

      online.set(false);
      TestBed.tick();
      online.set(true);
      TestBed.tick();
      await settle();

      expect(listed).toHaveBeenCalledTimes(3);
      expect(landed()).toEqual([
        [{ op: 'delete', path: `${GOALS}/trip` }, ...all.slice(0, 6).map(del)],
        all.slice(6).map(del)
      ]);

      // Nothing is left to remove: back online again, nothing is listed.
      online.set(false);
      TestBed.tick();
      online.set(true);
      TestBed.tick();
      await settle();
      expect(listed).toHaveBeenCalledTimes(3);
    });

    it('gives up on what a gone goal left when the rules refuse its removal', async () => {
      answerGoals([goal('trip', { createdBy: ME })]);
      const refused = firebaseError('permission-denied');
      const listings: (() => Promise<HouseholdContribution[]>)[] = [async () => [], async () => { throw refused; }];
      const listed = spyOn(firestore, 'getCollectionFromServer')
        .and.callFake((async () => (listings.shift() ?? (async () => []))()) as never);

      await plans.deleteGoal('trip');

      expect(planLogs()).toEqual([["[HouseholdPlans] A deleted goal's contributions were not all removed, and the rules refused the rest:", refused]]);
      online.set(false);
      TestBed.tick();
      online.set(true);
      TestBed.tick();
      await settle();
      expect(listed).toHaveBeenCalledTimes(2);
    });

    it("refuses before writing to delete another member's goal, unless the viewer owns the household", async () => {
      answerGoals([goal('theirs', { createdBy: KAI })]);

      const error = await refusal(plans.deleteGoal('theirs'));

      expect(error.message).toBe('household.errors.planNotYours');
      expect(firestore.commitBatchSpy.calls.length).toBe(0);
    });

    it("records a contribution in one commit: the member's own, in the goal's currency, stamped by the server", async () => {
      const id = await plans.addContribution('trip', 25.5, new Date(2026, 8, 14, 18));

      expect(id).toBe('new-1');
      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([[{
        op: 'set',
        path: `${contributionsOf('trip')}/new-1`,
        data: { gen: GEN, memberUid: ME, amount: 25.5, date: stamp(new Date(2026, 8, 14, 18)), createdAt: serverTimestamp() },
        stamp: false
      }]]);
    });

    it("deletes a contribution, refusing before writing to delete another member's unless the viewer owns the household", async () => {
      answerGoals([goal('trip')]);
      answerContributions('trip', [contribution('mine', ME, 5), contribution('theirs', KAI, 5)]);

      await plans.deleteContribution('trip', 'mine');
      const error = await refusal(plans.deleteContribution('trip', 'theirs'));

      expect(error.message).toBe('household.errors.contributionNotYours');
      expect(landed()).toEqual([[{ op: 'delete', path: `${contributionsOf('trip')}/mine` }]]);
    });

    it("links the viewer's own copy to a goal, and unlinks it, changing nothing else", async () => {
      answerGoals([goal('trip')]);
      firestore.setMockDocument(ledgerCopyPath('h1', ME, 'tx1'), copy(ME, 'tx1'));

      await plans.linkCopy('tx1', 'trip');
      await plans.linkCopy('tx1', null);

      expect(firestore.commitBatchSpy.calls.map(call => call.args[0])).toEqual([
        [{ op: 'update', path: `${LEDGER}/${ME}_tx1`, data: { goalId: 'trip' }, stamp: 'server' }],
        [{ op: 'update', path: `${LEDGER}/${ME}_tx1`, data: { goalId: deleteField() }, stamp: 'server' }]
      ]);
    });

    it('refuses before writing to link to a goal the household does not hold', async () => {
      answerGoals([goal('trip')]);

      const error = await refusal(plans.linkCopy('tx1', 'gone-goal'));

      expect(error.message).toBe('household.errors.planGone');
      expect(firestore.commitBatchSpy.calls.length).toBe(0);
    });

    it('refuses every write offline, before anything is sent', async () => {
      online.set(false);
      answerGoals([goal('trip', { createdBy: ME })]);

      const writes: Promise<unknown>[] = [
        plans.createBudget({ name: 'Food', categoryIds: ['food'], amount: 1, currency: 'USD', period: 'monthly', startDate: new Date(2026, 8, 1) }),
        plans.updateBudget('b', { amount: 2 }),
        plans.deleteBudget('b'),
        plans.createGoal({ name: 'Trip', targetAmount: 1, currency: 'USD' }),
        plans.updateGoal('trip', { name: 'Trips' }),
        plans.deleteGoal('trip'),
        plans.addContribution('trip', 1, new Date(2026, 8, 1)),
        plans.deleteContribution('trip', 'c'),
        plans.linkCopy('tx1', 'trip')
      ];
      for (const write of writes) {
        expect((await refusal(write)).message).toBe('household.errors.offline');
      }
      expect(firestore.callLog).toEqual([]);
    });

    it('refuses a name, an amount or a set of categories the rules would, before writing', async () => {
      const valid = { name: 'Food', categoryIds: ['food'], amount: 10, currency: 'USD', period: 'monthly' as const, startDate: new Date(2026, 8, 1) };

      const messages = [
        (await refusal(plans.createBudget({ ...valid, name: '   ' }))).message,
        (await refusal(plans.createBudget({ ...valid, name: 'x'.repeat(101) }))).message,
        (await refusal(plans.createBudget({ ...valid, amount: 0 }))).message,
        (await refusal(plans.createBudget({ ...valid, amount: Number.NaN }))).message,
        (await refusal(plans.createBudget({ ...valid, categoryIds: [] }))).message,
        (await refusal(plans.createBudget({ ...valid, categoryIds: Array.from({ length: 11 }, (_, i) => `c${i}`) }))).message,
        (await refusal(plans.createGoal({ name: 'Trip', targetAmount: -5, currency: 'USD' }))).message,
        (await refusal(plans.addContribution('trip', 0, new Date(2026, 8, 1)))).message,
        (await refusal(plans.updateBudget('b', { categoryIds: [] }))).message
      ];

      expect(messages).toEqual([
        'household.errors.planName:{"max":100}',
        'household.errors.planName:{"max":100}',
        'household.errors.planAmount',
        'household.errors.planAmount',
        'household.errors.planCategories:{"max":10}',
        'household.errors.planCategories:{"max":10}',
        'household.errors.planAmount',
        'household.errors.planAmount',
        'household.errors.planCategories:{"max":10}'
      ]);
      expect(firestore.commitBatchSpy.calls.length).toBe(0);
    });

    it('refuses a category a budget could never count, before writing: a custom one, a misspelled one or an income one', async () => {
      const valid = { name: 'Food', categoryIds: ['food'], amount: 10, currency: 'USD', period: 'monthly' as const, startDate: new Date(2026, 8, 1) };

      const messages = [
        (await refusal(plans.createBudget({ ...valid, categoryIds: ['food', 'kai-climbing-gym'] }))).message,
        (await refusal(plans.createBudget({ ...valid, categoryIds: ['fod'] }))).message,
        (await refusal(plans.createBudget({ ...valid, categoryIds: ['employment'] }))).message,
        (await refusal(plans.updateBudget('b', { categoryIds: ['other_income'] }))).message
      ];

      expect(messages).toEqual(Array(4).fill('household.errors.planCategories:{"max":10}'));
      expect(firestore.commitBatchSpy.calls.length).toBe(0);

      await plans.createBudget({ ...valid, categoryIds: ['food_restaurants', 'transport', 'other_expense'] });
      expect(firestore.commitBatchSpy.calls.length).withContext('expense built-ins, groups and subcategories').toBe(1);
    });

    describe('sent twice', () => {
      /** Each commit lands, and its answer is lost: the resend is refused, as the rules refuse a create sent again. */
      function answerLostAfterLanding(): void {
        const commit = firestore.commitBatch.bind(firestore);
        spyOn(firestore, 'commitBatch').and.callFake(async (ops: readonly BatchOp[]) => {
          await commit(ops);
          throw firebaseError('permission-denied');
        });
      }

      it('resolves a budget, a goal and a contribution whose first delivery the server holds as this member made them', async () => {
        answerLostAfterLanding();

        const budgetId = await plans.createBudget({
          name: 'Food', categoryIds: ['food'], amount: 10, currency: 'USD', period: 'monthly', startDate: new Date(2026, 8, 1)
        });
        const goalId = await plans.createGoal({ name: 'Trip', targetAmount: 10, currency: 'EUR' });
        const contributionId = await plans.addContribution(goalId, 4, new Date(2026, 8, 1));

        expect([budgetId, goalId, contributionId]).toEqual(['new-1', 'new-2', 'new-3']);
        expect(firestore.getDocumentFromServerSpy.calls.map(call => call.args[0])).toEqual([
          `${BUDGETS}/new-1`, `${GOALS}/new-2`, `${contributionsOf('new-2')}/new-3`
        ]);
      });

      it('passes the refusal on when the server holds no such document, or one another member made', async () => {
        firestore.refuseBatch = () => firebaseError('permission-denied');
        const input = { name: 'Food', categoryIds: ['food'], amount: 10, currency: 'USD', period: 'monthly' as const, startDate: new Date(2026, 8, 1) };

        expect((await refusal(plans.createBudget(input))).message).toBe('household.errors.refused');

        firestore.setMockDocument(`${BUDGETS}/new-2`, budget('new-2', { createdBy: KAI }));
        expect((await refusal(plans.createBudget(input))).message).toBe('household.errors.refused');
      });

      it('says a contribution was refused because its goal is gone', async () => {
        firestore.refuseBatch = () => firebaseError('permission-denied');

        const error = await refusal(plans.addContribution('trip', 4, new Date(2026, 8, 1)));

        expect(error.message).toBe('household.errors.planGone');
        expect(firestore.getDocumentFromServerSpy.calls.map(call => call.args[0]))
          .toEqual([`${contributionsOf('trip')}/new-1`, `${GOALS}/trip`]);
      });
    });

    describe('refused', () => {
      it('says an edit was refused because the plan is gone, or refused outright', async () => {
        firestore.refuseBatch = () => firebaseError('permission-denied');

        expect((await refusal(plans.updateBudget('gone', { amount: 3 }))).message).toBe('household.errors.planGone');
        expect((await refusal(plans.updateGoal('gone', { name: 'x' }))).message).toBe('household.errors.planGone');

        firestore.setMockDocument(`${BUDGETS}/held`, budget('held'));
        expect((await refusal(plans.updateBudget('held', { amount: 3 }))).message).toBe('household.errors.refused');
      });

      it('says a link was refused because the copy is gone, or the goal', async () => {
        answerGoals([goal('trip')]);
        firestore.refuseBatch = () => firebaseError('permission-denied');

        expect((await refusal(plans.linkCopy('tx1', 'trip'))).message).toBe('household.errors.copyGone');

        firestore.setMockDocument(ledgerCopyPath('h1', ME, 'tx1'), copy(ME, 'tx1'));
        expect((await refusal(plans.linkCopy('tx1', 'trip'))).message).toBe('household.errors.planGone');

        firestore.setMockDocument(`${GOALS}/trip`, goal('trip'));
        expect((await refusal(plans.linkCopy('tx1', 'trip'))).message).toBe('household.errors.refused');
      });

      it('maps a lost connection to the offline message, and anything else to the generic one', async () => {
        firestore.refuseBatch = () => firebaseError('unavailable');
        expect((await refusal(plans.deleteBudget('b'))).message).toBe('household.errors.offline');

        firestore.refuseBatch = () => firebaseError('internal');
        expect((await refusal(plans.deleteBudget('b'))).message).toBe('errors.generic');
      });
    });
  });
});
