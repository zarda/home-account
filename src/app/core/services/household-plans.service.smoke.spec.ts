// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, ErrorHandler, Provider, ProviderToken, createEnvironmentInjector } from '@angular/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { HouseholdPlansService } from './household-plans.service';
import { HouseholdLedgerService } from './household-ledger.service';
import { HouseholdError, HouseholdService, householdSelectionKey } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { BatchOp, FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { BudgetService } from './budget.service';
import { CurrencyService } from './currency.service';
import { LedgerShareService } from './ledger-share.service';
import { ledgerJournalKey } from './ledger-journal';
import { PwaService } from './pwa.service';
import { ReceiptQuotaService } from './receipt-quota.service';
import { StorageService } from './storage.service';
import { TransactionService } from './transaction.service';
import { TranslationService } from './translation.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  EmulatorField,
  deleteDocumentAsOwner,
  getDocumentAsOwner,
  listDocumentIdsAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { CreateTransactionDTO, HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK, User, ledgerCopyPath, shareKey } from '../../models';
import { householdBudgetWindow } from '../utils/household-plans.utils';
import { DateWindow, defaultBudgetStart, monthWindow } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * HouseholdPlansService against the emulators, with firestore.rules live:
 * two members of one household making the household's own budgets and
 * goals through the real service, sharing rows through the app's own write
 * path (TransactionService with sharedWith), and reading the plans' figures
 * through the real services, the ledger's generation-filtered listeners
 * included. Each passing case proves the service's commits are the ones the
 * rules admit and its listeners the queries the rules can prove.
 *
 * Two full service stacks, one per account: the owner's through the TestBed,
 * the peer's through a child EnvironmentInjector (the
 * household-ledger.service.smoke.spec.ts pattern, which says why two is the
 * most one file holds).
 *
 * The owner views in dollars and the peer in euros, from one cached rates
 * table; a plan's figures are in the plan's own currency, the same for both.
 * The page's period is a past month while each budget counts the month
 * running now, so the ledger reads the budget's window through a listener
 * of its own. That window is judged in the runtime's zone, and shared rows
 * sit on either side of its first and last milliseconds, so this file runs
 * in the zoned smoke:dates pass too.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('HouseholdPlansService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const DAY_MS = 24 * 60 * 60 * 1000;

  interface Account {
    name: string;
    app: FirebaseApp;
    firestore: Firestore;
    uid: string;
    user: User;
  }

  /** One account's services, as its app would hold them with the household page open. */
  interface Stack {
    account: Account;
    household: HouseholdService;
    ledger: HouseholdLedgerService;
    plans: HouseholdPlansService;
    transactions: TransactionService;
    firestore: FirestoreService;
  }

  let owner: Account;
  let peer: Account;
  let ownerStack: Stack;
  let peerStack: Stack;
  let peerInjector: EnvironmentInjector;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;
  /** The moment every budget window in a case is judged at. */
  let now: Date;
  /**
   * What the household page shows: a month already over, three before the
   * one running now, so neither side of the budgets' window falls in it.
   */
  let period: DateWindow;

  const profile = (name: string, baseCurrency: string) => ({
    email: `${name}@example.test`,
    displayName: name,
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
    preferences: { baseCurrency, language: 'en' }
  });

  async function signIn(name: string, baseCurrency: string): Promise<Account> {
    const app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `household-plans-${name}-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
    const credential = await signInAnonymously(auth);
    const uid = credential.user.uid;
    return { name, app, firestore, uid, user: { id: uid, ...profile(name, baseCurrency) } as User };
  }

  /**
   * Every service that holds an account of its own, bound to this one. The
   * rates are the file's one CurrencyService, from the root.
   */
  function stack(account: Account): Provider[] {
    return [
      HouseholdService,
      HouseholdLedgerService,
      HouseholdPlansService,
      TransactionService,
      LedgerShareService,
      FirestoreService,
      { provide: Firestore, useValue: account.firestore },
      { provide: AuthService, useValue: { userId: () => account.uid, currentUser: () => account.user } },
      {
        provide: HOUSEHOLD_INVITE_CALLABLE,
        useValue: () => Promise.reject(new Error('the functions emulator is not part of the smoke run'))
      },
      // What TransactionService needs besides: no receipt or budget work,
      // none of which a copy reveals.
      { provide: StorageService, useValue: {} },
      { provide: ReceiptQuotaService, useValue: { invalidateCount: () => undefined } },
      { provide: BudgetService, useValue: { recalculateBudgetsForCategory: async () => undefined } }
    ];
  }

  function stackOf(account: Account, get: <T>(token: ProviderToken<T>) => T): Stack {
    return {
      account,
      household: get(HouseholdService),
      ledger: get(HouseholdLedgerService),
      plans: get(HouseholdPlansService),
      transactions: get(TransactionService),
      firestore: get(FirestoreService)
    };
  }

  /**
   * What the household page does with effects: hands the ledger and the
   * plans the household, and the ledger its members, as HouseholdService
   * last heard them.
   */
  function syncPage(view: Stack): void {
    view.ledger.setHousehold(view.household.household());
    view.ledger.setMembers(view.household.members());
    view.plans.setHousehold(view.household.household());
  }

  async function waitFor(predicate: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    for (;;) {
      for (const view of [ownerStack, peerStack]) syncPage(view);
      if (predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  async function eventually(check: () => Promise<boolean>, what: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * The invite the callable writes, past the rules that refuse every client
   * create, with the generation read back over REST so it keeps its
   * microseconds.
   */
  async function seedInvite(householdId: string): Promise<void> {
    const stored = await getDocumentAsOwner(`households/${householdId}`);
    const createdAt = stored?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${householdId} has no stored createdAt`);
    await setDocumentAsOwner(`householdInvites/${householdId}_${peer.uid}`, {
      householdId: stringField(householdId),
      householdCreatedAt: { timestampValue: createdAt } as EmulatorField,
      householdName: stringField('Home'),
      inviterUid: stringField(owner.uid),
      inviterName: stringField('owner'),
      inviterEmail: stringField('owner@example.test'),
      inviteeUid: stringField(peer.uid),
      inviteeEmail: stringField('peer@example.test'),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent')
    });
  }

  /** The owner forms a household and the peer joins it, both through the service; both pages open on it. */
  async function formWithPeer(): Promise<string> {
    const householdId = await ownerStack.household.create('Home');
    await seedInvite(householdId);
    await peerStack.household.accept(householdId);
    for (const view of [ownerStack, peerStack]) {
      view.household.select(householdId);
      view.household.connect();
      view.ledger.setPeriod(period);
      view.plans.setNow(now);
    }
    await waitFor(
      () => [ownerStack, peerStack].every(view =>
        view.household.status() === 'member' && view.household.members().length === 2 && !view.plans.loading()),
      "both members to list both members and the household's plans"
    );
    return householdId;
  }

  /** One expense as the app's own form adds it: shared into `householdId` unless null. */
  async function add(
    view: Stack,
    description: string,
    date: Date,
    householdId: string | null,
    overrides: Partial<CreateTransactionDTO> = {}
  ): Promise<string> {
    return view.transactions.addTransaction({
      type: 'expense',
      amount: 1,
      currency: 'USD',
      categoryId: 'food_groceries',
      description,
      date,
      note: `${description}: a note no copy reveals`,
      ...(householdId ? { sharedWith: [shareKey(householdId)] } : {}),
      ...overrides
    });
  }

  const copyIds = (householdId: string) => listDocumentIdsAsOwner(`households/${householdId}/ledger`);

  /**
   * Accounts are signed in once for the file, so the memberships an earlier
   * case formed are still live. Their index entries are deleted past the
   * rules, so each case starts with none listed, well inside the limit.
   */
  async function forgetMemberships(account: Account): Promise<void> {
    for (const householdId of await listDocumentIdsAsOwner(`users/${account.uid}/households`)) {
      await deleteDocumentAsOwner(`users/${account.uid}/households/${householdId}`);
    }
    localStorage.removeItem(householdSelectionKey(account.uid));
    localStorage.removeItem(ledgerJournalKey(account.uid));
  }

  /**
   * Every plan commit the account's FirestoreService makes lands, and is
   * then sent again, as the transaction runner sends an attempt again when
   * its answer was lost (ADR 0156): the resend of a create is judged as a
   * change to what the first made.
   */
  function deliverTwice(firestore: FirestoreService): void {
    const commit = firestore.commitOnline.bind(firestore);
    spyOn(firestore, 'commitOnline').and.callFake(async (ops: readonly BatchOp[]) => {
      await commit(ops);
      return commit(ops);
    });
  }

  /**
   * Nothing reached the error handler and no service logged: a plans
   * listener's failure is a `[HouseholdPlans]` warning, the ledger's a
   * `[HouseholdLedger]` one, a membership listener's a `[HouseholdService]`
   * one, a copy write's a `[LedgerShareService]` one, and sharing code that
   * did not load a `[Transactions]` one. The SDK's own transport lines are
   * not faults (unexpectedConsoleErrors).
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => /^\[(HouseholdPlans|HouseholdLedger|HouseholdService|LedgerShareService|Transactions)\]/.test(String(args[0])))
      .map(args => args.map(String));
    expect(warnings).withContext(`console.warn: ${JSON.stringify(warnings)}`).toEqual([]);
  }

  beforeAll(async () => {
    // A fresh cache is the table CurrencyService loads, with no live fetch:
    // rates unlike the compiled-in ones (JPY 149.5, EUR 0.92), so a figure
    // converted at a constant, or not converted at all, shows.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, JPY: 150, EUR: 0.8 }, lastUpdatedMs: Date.now() })
    );
    owner = await signIn('owner', 'USD');
    peer = await signIn('peer', 'EUR');
  }, 30000);

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    for (const account of [owner, peer]) {
      await deleteApp(account.app).catch(() => undefined);
    }
  });

  beforeEach(async () => {
    for (const account of [owner, peer]) await forgetMemberships(account);
    now = new Date();
    period = monthWindow({ year: now.getFullYear(), month: now.getMonth() - 3 });

    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    const shared: Provider[] = [
      { provide: PwaService, useValue: { isOnline: () => true } },
      { provide: TranslationService, useValue: createTranslationStub() },
      { provide: ErrorHandler, useValue: errorHandler }
    ];
    TestBed.configureTestingModule({ providers: [...stack(owner), ...shared] });
    ownerStack = stackOf(owner, token => TestBed.inject(token));
    peerInjector = createEnvironmentInjector(stack(peer), TestBed.inject(EnvironmentInjector));
    peerStack = stackOf(peer, token => peerInjector.get(token));
    await TestBed.inject(CurrencyService).ensureRatesLoaded();

    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  }, 30000);

  afterEach(() => {
    peerInjector.destroy();
  });

  it('runs as accounts whose ids hold no underscore, which a copy id is split on', () => {
    expect(owner.uid).not.toContain('_');
    expect(peer.uid).not.toContain('_');
  });

  it("counts the members' shared expenses in a budget's categories over its own window, in its currency, and never a private row", async () => {
    const householdId = await formWithPeer();

    // A member who does not own the household makes the budget.
    const budgetId = await peerStack.plans.createBudget({
      name: 'Food',
      categoryIds: ['food'],
      amount: 100,
      currency: 'USD',
      period: 'monthly',
      startDate: defaultBudgetStart('monthly', now)
    });
    const window: DateWindow = householdBudgetWindow(
      { period: 'monthly', startDate: Timestamp.fromDate(defaultBudgetStart('monthly', now)) },
      now
    )!;
    const middle = new Date((window.start.getTime() + window.end.getTime()) / 2);

    // The peer's 16 euros of groceries, in the group the budget counts.
    await add(peerStack, 'market', middle, householdId, { amount: 16, currency: 'EUR' });
    // The owner's restaurant bills on the window's first and last
    // milliseconds, and a millisecond outside each.
    await add(ownerStack, 'first-ms', window.start, householdId, { amount: 5, categoryId: 'food_restaurants' });
    await add(ownerStack, 'last-ms', window.end, householdId, { amount: 7, categoryId: 'food_restaurants' });
    await add(ownerStack, 'before', new Date(window.start.getTime() - 1), householdId, { amount: 1000 });
    await add(ownerStack, 'after', new Date(window.end.getTime() + 1), householdId, { amount: 3000 });
    // Shared, but in a category the budget does not count.
    await add(ownerStack, 'fuel', middle, householdId, { amount: 50, categoryId: 'transport_fuelAndGas' });
    // In the budget's category and window, but never shared.
    const privateRow = await add(ownerStack, 'owner-private', middle, null, { amount: 999 });

    const spentBy = (view: Stack) => view.plans.budgets().find(line => line.budget.id === budgetId);
    await waitFor(
      () => [ownerStack, peerStack].every(view => spentBy(view)?.spent === 32),
      "both views of the budget's spending"
    );
    // 16 euros as 20 dollars, and the owner's 5 + 7.
    for (const view of [ownerStack, peerStack]) {
      expect(spentBy(view)).toEqual(jasmine.objectContaining({ spent: 32, atTodaysRate: true, window, incomplete: false }));
      expect(spentBy(view)!.budget).toEqual(jasmine.objectContaining({ name: 'Food', currency: 'USD', createdBy: peer.uid }));
      // The overview keeps to its own month, which none of these rows is in.
      expect(view.ledger.rows()).toEqual([]);
      expect(view.ledger.windowCopies().map(copy => copy.description)).not.toContain('owner-private');
    }

    // The private row has no copy to count.
    const ids = await copyIds(householdId);
    expect(ids).not.toContain(`${owner.uid}_${privateRow}`);
    expect(ids.length).toBe(6);
    expectQuiet();
  }, 60000);

  it("sums a goal's linked copies and contributions in its currency, and deleting it takes every contribution with it", async () => {
    const householdId = await formWithPeer();

    const goalId = await peerStack.plans.createGoal({ name: 'Trip', targetAmount: 500, currency: 'EUR' });
    await waitFor(() => ownerStack.plans.goals().some(line => line.goal.id === goalId), 'the owner to list the goal');

    // The owner shares a 50 dollar row and counts it toward the goal.
    const flight = await add(ownerStack, 'flight', now, householdId, { amount: 50, categoryId: 'transport_publicTransit' });
    await eventually(
      async () => (await getDocumentAsOwner(ledgerCopyPath(householdId, owner.uid, flight))) !== null,
      "the flight's copy"
    );
    await ownerStack.plans.linkCopy(flight, goalId);
    await peerStack.plans.addContribution(goalId, 100, now);
    await ownerStack.plans.addContribution(goalId, 10, now);

    const progressOf = (view: Stack) => view.plans.goals().find(line => line.goal.id === goalId);
    await waitFor(
      () => [ownerStack, peerStack].every(view => progressOf(view)?.saved === 150),
      "both views of the goal's progress"
    );
    // 50 dollars as 40 euros, and 110 contributed.
    for (const view of [ownerStack, peerStack]) {
      expect(progressOf(view)).toEqual(jasmine.objectContaining({
        saved: 150, linked: 40, contributed: 110, fraction: 0.3, atTodaysRate: true, incomplete: false
      }));
      expect(progressOf(view)!.contributions.map(line => [line.memberUid, line.amount]).sort())
        .toEqual([[owner.uid, 10], [peer.uid, 100]].sort());
    }
    const linked = await getDocumentAsOwner(ledgerCopyPath(householdId, owner.uid, flight));
    expect(linked?.['goalId']?.['stringValue']).toBe(goalId);

    // Its maker, who does not own the household, deletes it: the owner's
    // contribution goes too, which only the goal's absence allows.
    await peerStack.plans.deleteGoal(goalId);

    expect(await getDocumentAsOwner(`households/${householdId}/goals/${goalId}`)).toBeNull();
    expect(await listDocumentIdsAsOwner(`households/${householdId}/goals/${goalId}/contributions`)).toEqual([]);
    await waitFor(
      () => [ownerStack, peerStack].every(view => view.plans.goals().length === 0),
      'both views to drop the goal'
    );
    expectQuiet();
  }, 60000);

  it('deletes a goal holding more contributions than one commit takes, every one of them', async () => {
    const householdId = await formWithPeer();
    const goalId = await peerStack.plans.createGoal({ name: 'Car', targetAmount: 5000, currency: 'USD' });
    const contributions = `households/${householdId}/goals/${goalId}/contributions`;
    // The goal's commit, a full chunk after it, and one more.
    const count = 2 * HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK + 1;
    for (let i = 0; i < count; i++) await ownerStack.plans.addContribution(goalId, 1, now);
    expect((await listDocumentIdsAsOwner(contributions)).length).toBe(count);

    // Its maker, who does not own the household, deletes it with every one
    // of the owner's contributions.
    await peerStack.plans.deleteGoal(goalId);

    expect(await getDocumentAsOwner(`households/${householdId}/goals/${goalId}`)).toBeNull();
    expect(await listDocumentIdsAsOwner(contributions)).toEqual([]);
    expectQuiet();
  }, 60000);

  it("says a link to a copy that is gone is refused for the copy's sake, the runner not retrying it", async () => {
    const householdId = await formWithPeer();
    const goalId = await ownerStack.plans.createGoal({ name: 'Trip', targetAmount: 500, currency: 'USD' });
    await waitFor(() => ownerStack.plans.goals().some(line => line.goal.id === goalId), 'the owner to list the goal');
    const flight = await add(ownerStack, 'flight', now, householdId, { amount: 50 });
    const path = ledgerCopyPath(householdId, owner.uid, flight);
    await eventually(async () => (await getDocumentAsOwner(path)) !== null, "the flight's copy");
    // Gone past the service, as a removal or an unshare elsewhere takes it.
    await deleteDocumentAsOwner(path);

    const refused = await ownerStack.plans.linkCopy(flight, goalId).then(() => null, (error: unknown) => error);

    // The transaction's update of a missing document fails as not-found or
    // permission-denied, which the runner never retries and the service
    // reads as the copy being gone. A failed-precondition would be retried,
    // then reach the page as the generic message.
    expect(refused).toEqual(jasmine.any(HouseholdError));
    expect((refused as HouseholdError).message).toBe('household.errors.copyGone');
    expect(await getDocumentAsOwner(path)).withContext('an update makes no document').toBeNull();
    expectQuiet();
  }, 60000);

  it('resolves a budget, a goal and a contribution each delivered twice', async () => {
    const householdId = await formWithPeer();
    deliverTwice(ownerStack.firestore);

    const budgetId = await ownerStack.plans.createBudget({
      name: 'Food', categoryIds: ['food'], amount: 100, currency: 'USD', period: 'monthly', startDate: defaultBudgetStart('monthly', now)
    });
    const goalId = await ownerStack.plans.createGoal({ name: 'Trip', targetAmount: 500, currency: 'USD' });
    const contributionId = await ownerStack.plans.addContribution(goalId, 25, now);

    expect(await listDocumentIdsAsOwner(`households/${householdId}/budgets`)).toEqual([budgetId]);
    expect(await listDocumentIdsAsOwner(`households/${householdId}/goals`)).toEqual([goalId]);
    expect(await listDocumentIdsAsOwner(`households/${householdId}/goals/${goalId}/contributions`)).toEqual([contributionId]);
    await waitFor(
      () => peerStack.plans.goals().find(line => line.goal.id === goalId)?.contributed === 25,
      "the peer's view of the contribution"
    );
    expectQuiet();
  }, 60000);
});
