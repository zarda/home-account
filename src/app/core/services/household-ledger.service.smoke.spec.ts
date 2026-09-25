// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { createEnvironmentInjector, EnvironmentInjector, ErrorHandler, Provider } from '@angular/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { HouseholdLedgerService } from './household-ledger.service';
import { HouseholdService } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { CurrencyService } from './currency.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  EmulatorField,
  booleanField,
  getDocumentAsOwner,
  integerField,
  patchFieldsAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { User } from '../../models';
import {
  budgetPeriodWindow,
  dayKey,
  monthWindow,
  startOfMonth,
  yearWindow
} from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * HouseholdLedgerService against the emulators, with firestore.rules live:
 * the owner's ledger reads a household peer's transactions, categories,
 * active budgets and active goals only because the rules admit a live member
 * of the same household, and each query is one the rules can prove.
 *
 * Two full service stacks, one per account: the owner's through the TestBed,
 * the peer's through a child EnvironmentInjector (the
 * transaction-receipts.smoke.spec.ts pattern), used only to join. Two full
 * clients is the most one file holds: each keeps a listen stream open, Chrome
 * allows six connections per host, and the admin REST reads and writes need
 * the rest.
 *
 * Every record is seeded past the rules, as its account would have written
 * it; the household is formed and joined through the real HouseholdService.
 * The period is a whole local month, and rows sit on either side of each of
 * its bounds, so this file runs in the zoned smoke:dates pass too.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('HouseholdLedgerService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const RATES_CACHE_KEY = 'home-account.exchangeRates';
  const DAY_MS = 24 * 60 * 60 * 1000;

  const AUGUST = monthWindow({ year: 2026, month: 7 });
  const YEAR = yearWindow(2026);
  const at = (day: number, hour = 12) => new Date(2026, 7, day, hour);

  interface Account {
    name: string;
    app: FirebaseApp;
    firestore: Firestore;
    uid: string;
    user: User;
  }

  let owner: Account;
  let peer: Account;
  let ownerHousehold: HouseholdService;
  let peerHousehold: HouseholdService;
  let ledger: HouseholdLedgerService;
  let peerInjector: EnvironmentInjector;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;

  const profile = (account: Pick<Account, 'name'>) => ({
    email: `${account.name}@example.test`,
    displayName: account.name,
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
    preferences: { baseCurrency: 'USD', language: 'en' }
  });

  async function signIn(name: string): Promise<Account> {
    const app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `household-ledger-${name}-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
    const credential = await signInAnonymously(auth);
    const uid = credential.user.uid;
    return { name, app, firestore, uid, user: { id: uid, ...profile({ name }) } as User };
  }

  function stack(account: Account): Provider[] {
    return [
      HouseholdService,
      FirestoreService,
      { provide: Firestore, useValue: account.firestore },
      { provide: AuthService, useValue: { userId: () => account.uid, currentUser: () => account.user } },
      { provide: PwaService, useValue: { isOnline: () => true } },
      { provide: TranslationService, useValue: createTranslationStub() },
      {
        provide: HOUSEHOLD_INVITE_CALLABLE,
        useValue: () => Promise.reject(new Error('the functions emulator is not part of the smoke run'))
      }
    ];
  }

  async function waitFor(predicate: () => boolean, what: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  /**
   * One expense as its account writes it: 1 dollar whose snapshot is 150 in a
   * yen base, with no stamp saying so. `extra` replaces or adds fields.
   */
  function seedTransaction(account: Account, id: string, date: Date, extra: Record<string, EmulatorField> = {}) {
    return setDocumentAsOwner(`users/${account.uid}/transactions/${id}`, {
      userId: stringField(account.uid),
      type: stringField('expense'),
      amount: integerField(1),
      currency: stringField('USD'),
      amountInBaseCurrency: integerField(150),
      exchangeRate: integerField(150),
      categoryId: stringField('food_groceries'),
      description: stringField(id),
      date: timestampField(date),
      createdAt: timestampField(date),
      updatedAt: timestampField(date),
      isRecurring: booleanField(false),
      ...extra
    });
  }

  function seedBudget(account: Account, id: string, name: string, extra: Record<string, EmulatorField>) {
    const now = new Date();
    return setDocumentAsOwner(`users/${account.uid}/budgets/${id}`, {
      userId: stringField(account.uid),
      categoryId: stringField('food'),
      name: stringField(name),
      amount: integerField(40000),
      currency: stringField('JPY'),
      period: stringField('monthly'),
      startDate: timestampField(startOfMonth(now)),
      spent: integerField(0),
      isActive: booleanField(true),
      alertThreshold: integerField(80),
      createdAt: timestampField(now),
      updatedAt: timestampField(now),
      ...extra
    });
  }

  function seedGoal(account: Account, id: string, name: string, isActive: boolean) {
    const now = new Date();
    return setDocumentAsOwner(`users/${account.uid}/goals/${id}`, {
      userId: stringField(account.uid),
      kind: stringField('saving'),
      name: stringField(name),
      targetAmount: integerField(300000),
      contributedAmount: integerField(1000),
      currency: stringField('JPY'),
      isActive: booleanField(isActive),
      createdAt: timestampField(now),
      updatedAt: timestampField(now)
    });
  }

  /** The invite the callable writes, with the generation read back from the stored household. */
  async function seedInvite(householdId: string, inviterUid: string, inviteeUid: string): Promise<void> {
    const household = await getDocumentAsOwner(`households/${householdId}`);
    const createdAt = household?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${householdId} has no stored createdAt`);
    await setDocumentAsOwner(`householdInvites/${householdId}_${inviteeUid}`, {
      householdId: stringField(householdId),
      householdCreatedAt: { timestampValue: createdAt },
      householdName: stringField('Home'),
      inviterUid: stringField(inviterUid),
      inviterName: stringField('Owner'),
      inviterEmail: stringField('owner@example.test'),
      inviteeUid: stringField(inviteeUid),
      inviteeEmail: stringField(`${inviteeUid}@example.test`),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent')
    });
  }

  /** The owner forms a household, the peer joins it, and the owner's page is connected. */
  async function formWithPeer(): Promise<void> {
    const householdId = await ownerHousehold.create('Home');
    await seedInvite(householdId, owner.uid, peer.uid);
    await peerHousehold.accept(householdId);
    ownerHousehold.connect();
    await waitFor(() => ownerHousehold.members().length === 2, 'the owner to list both members');
  }

  /** The owner's ledger over August, fed the members the household page would feed it. */
  async function followAugust(): Promise<void> {
    ledger.setPeriod(AUGUST);
    ledger.setMembers(ownerHousehold.members());
    await waitFor(() => !ledger.loading() && ledger.rows().length === 5, 'the merged August rows');
  }

  /**
   * Nothing reached the error handler and neither service logged. The SDK's
   * own transport lines are left out (unexpectedConsoleErrors); each check
   * names what it caught, so a failure that happens once says what it was.
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => /^\[Household(Ledger)?Service\]/.test(String(args[0])))
      .map(args => args.map(String));
    expect(warnings).withContext(`console.warn: ${JSON.stringify(warnings)}`).toEqual([]);
  }

  beforeAll(async () => {
    // A fresh cache is the table CurrencyService loads, with no live fetch:
    // a yen rate unlike the compiled-in 149.5, so a yen figure converted at a
    // constant, or counted at its stored snapshot, shows.
    localStorage.setItem(
      RATES_CACHE_KEY,
      JSON.stringify({ rates: { USD: 1, JPY: 150 }, lastUpdatedMs: Date.now() })
    );

    owner = await signIn('owner');
    peer = await signIn('peer');

    // The owner's own row, in its own base.
    await seedTransaction(owner, 'own', at(15), {
      amount: integerField(50),
      amountInBaseCurrency: integerField(50),
      exchangeRate: integerField(1),
      baseCurrency: stringField('USD')
    });

    // The peer's rows around August's bounds, each 1 dollar stamped JPY.
    const yen = { baseCurrency: stringField('JPY') };
    await seedTransaction(peer, 'first-ms', AUGUST.start, yen);
    await seedTransaction(peer, 'last-ms', AUGUST.end, yen);
    await seedTransaction(peer, 'before', new Date(AUGUST.start.getTime() - 1), yen);
    await seedTransaction(peer, 'after', new Date(AUGUST.end.getTime() + 1), yen);
    // 1500 yen in the peer's yen base, stamped: converted live into the
    // owner's dollars at the cached rate.
    await seedTransaction(peer, 'in-yen', at(20), {
      amount: integerField(1500),
      currency: stringField('JPY'),
      amountInBaseCurrency: integerField(1500),
      exchangeRate: integerField(1),
      baseCurrency: stringField('JPY')
    });
    // Written before stamping in the peer's yen base: 20 dollars stored as
    // 3000, which amountInBase alone would count as 3000 dollars. It carries
    // a receipt and the peer's own category.
    await setDocumentAsOwner(`users/${peer.uid}/categories/peer-pets`, {
      userId: stringField(peer.uid),
      name: stringField('Pets'),
      icon: stringField('pets'),
      color: stringField('#336699'),
      type: stringField('expense'),
      order: integerField(999),
      isActive: booleanField(true),
      isDefault: booleanField(false)
    });
    await seedTransaction(peer, 'receipted', at(10), {
      amount: integerField(20),
      amountInBaseCurrency: integerField(3000),
      categoryId: stringField('peer-pets'),
      receiptUrl: stringField('https://example.test/receipt.jpg'),
      receiptCount: integerField(1)
    });

    const now = new Date();
    await seedBudget(peer, 'current', 'Groceries', {
      spent: integerField(12000),
      spentPeriod: stringField(dayKey(budgetPeriodWindow('monthly', startOfMonth(now), now).start))
    });
    await seedBudget(peer, 'stale', 'Dining', {
      spent: integerField(30000),
      spentPeriod: stringField('1999-01-01')
    });
    await seedBudget(peer, 'inactive', 'Old', { isActive: booleanField(false) });
    await seedGoal(peer, 'trip', 'Trip', true);
    await seedGoal(peer, 'car', 'Car', false);
  }, 30000);

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    for (const account of [owner, peer]) {
      await deleteApp(account.app).catch(() => undefined);
    }
  });

  // A pointer is only clearable through the rules once its membership is
  // gone, so the reset goes around them; the profile is then rewritten
  // through the client. Households are keyed by fresh ids, so nothing an
  // earlier case left behind is in the way.
  beforeEach(async () => {
    for (const account of [owner, peer]) {
      await patchFieldsAsOwner(`users/${account.uid}`, { householdId: null });
      await setDoc(doc(account.firestore, `users/${account.uid}`), profile(account));
    }

    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [
        ...stack(owner),
        HouseholdLedgerService,
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    });
    ownerHousehold = TestBed.inject(HouseholdService);
    ledger = TestBed.inject(HouseholdLedgerService);
    peerInjector = createEnvironmentInjector(stack(peer), TestBed.inject(EnvironmentInjector));
    peerHousehold = peerInjector.get(HouseholdService);

    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  });

  afterEach(() => {
    peerInjector.destroy();
  });

  it('reads the peer\'s rows, categories, active budgets and active goals through the rules, merged with the owner\'s', async () => {
    await formWithPeer();
    await followAugust();

    // Both of the period's bounds are inside it, and a millisecond past
    // either is not.
    expect(ledger.rows().map(r => [r.id, r.memberUid])).toEqual([
      ['last-ms', peer.uid],
      ['in-yen', peer.uid],
      ['own', owner.uid],
      ['receipted', peer.uid],
      ['first-ms', peer.uid]
    ]);

    const receipted = ledger.rows().find(r => r.id === 'receipted')!;
    expect('receiptUrl' in receipted).toBeFalse();
    expect('receiptCount' in receipted).toBeFalse();
    expect(ledger.categoriesByMember().get(peer.uid)!.get(receipted.categoryId)!.name).toBe('Pets');
    expect(ledger.categoriesByMember().get(owner.uid)!.has('peer-pets')).toBeFalse();

    // In the owner's dollars: 20 for the unstamped row (its snapshot says
    // 3000), 10 for the 1500 yen at the cached 150 (10.03 at the compiled-in
    // 149.5, 1500 at its snapshot), and 1 for each stamped dollar.
    expect(ledger.totalsByMember().map(entry => [entry.member.uid, entry.totals.expense]))
      .toEqual([[owner.uid, 50], [peer.uid, 32]]);
    expect(ledger.combined().expense).toBe(82);
    expect(TestBed.inject(CurrencyService).rateSource()).toBe('cached');

    const peerBudgets = ledger.budgetsByMember().find(entry => entry.member.uid === peer.uid)!.budgets;
    expect(peerBudgets.map(b => [b.id, b.spent, b.stale])).toEqual([
      ['stale', 0, true],
      ['current', 12000, false]
    ]);
    expect(ledger.goalsByMember().map(entry => [entry.member.uid, entry.goals.map(g => g.id)]))
      .toEqual([[owner.uid, []], [peer.uid, ['trip']]]);
    expect(ledger.unavailable()).toEqual([]);
    expect(ledger.truncated()).toEqual([]);

    // The stale figure was shown as 0, not recalculated.
    const stored = await getDocumentAsOwner(`users/${peer.uid}/budgets/stale`);
    expect(stored?.['spent']).toEqual(integerField(30000));
    expectQuiet();
  }, 30000);

  it('drops a removed peer: the rules refuse its rows quietly, and it leaves with the members list', async () => {
    await formWithPeer();
    await followAugust();

    await ownerHousehold.remove(peer.uid);

    // Before the list catches up, a new period re-reads the peer's rows,
    // which the rules now refuse.
    ledger.setPeriod(YEAR);
    await waitFor(() => ledger.unavailable().some(member => member.uid === peer.uid),
      'the peer\'s refused rows');
    await waitFor(() => !ledger.loading(), 'the owner\'s rows for the year');
    expect(ledger.rows().map(r => [r.id, r.memberUid])).toEqual([['own', owner.uid]]);
    expect(ledger.budgetsByMember().map(entry => entry.member.uid)).toEqual([owner.uid]);
    expect(ledger.goalsByMember().map(entry => entry.member.uid)).toEqual([owner.uid]);

    await waitFor(() => ownerHousehold.members().length === 1, 'the owner to list itself alone');
    ledger.setMembers(ownerHousehold.members());

    expect(ledger.unavailable()).toEqual([]);
    expect(ledger.totalsByMember().map(entry => entry.member.uid)).toEqual([owner.uid]);
    expect(ledger.categoriesByMember().has(peer.uid)).toBeFalse();
    expect(ledger.rows().map(r => r.id)).toEqual(['own']);
    expectQuiet();
  }, 30000);
});
