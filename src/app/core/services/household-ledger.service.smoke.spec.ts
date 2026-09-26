// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import { ErrorHandler, Provider } from '@angular/core';
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
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { User } from '../../models';
import {
  budgetPeriodWindow,
  dayKey,
  monthWindow,
  startOfMonth
} from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * HouseholdLedgerService against the emulators, with firestore.rules live,
 * for a household of one: the member's own transactions, categories, active
 * budgets and active goals, each through a query the rules admit for the
 * account's own records. Every other member's records are readable by
 * their own account alone, so a household of one is the whole of what these
 * reads can show.
 *
 * One full service stack, through the TestBed. The household is formed
 * through the real HouseholdService; every record is seeded past the rules,
 * as the account would have written it. The period is a whole local month,
 * and rows sit on either side of each of its bounds, so this file runs in
 * the zoned smoke:dates pass too.
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

  const AUGUST = monthWindow({ year: 2026, month: 7 });
  const at = (day: number, hour = 12) => new Date(2026, 7, day, hour);

  interface Account {
    name: string;
    app: FirebaseApp;
    firestore: Firestore;
    uid: string;
    user: User;
  }

  let owner: Account;
  let household: HouseholdService;
  let ledger: HouseholdLedgerService;
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

  /** One dollar expense as its account writes it, in its dollar base; `extra` replaces or adds fields. */
  function seedTransaction(id: string, date: Date, extra: Record<string, EmulatorField> = {}) {
    return setDocumentAsOwner(`users/${owner.uid}/transactions/${id}`, {
      userId: stringField(owner.uid),
      type: stringField('expense'),
      amount: integerField(1),
      currency: stringField('USD'),
      amountInBaseCurrency: integerField(1),
      exchangeRate: integerField(1),
      baseCurrency: stringField('USD'),
      categoryId: stringField('food_groceries'),
      description: stringField(id),
      date: timestampField(date),
      createdAt: timestampField(date),
      updatedAt: timestampField(date),
      isRecurring: booleanField(false),
      ...extra
    });
  }

  function seedBudget(id: string, name: string, extra: Record<string, EmulatorField>) {
    const now = new Date();
    return setDocumentAsOwner(`users/${owner.uid}/budgets/${id}`, {
      userId: stringField(owner.uid),
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

  function seedGoal(id: string, name: string, isActive: boolean) {
    const now = new Date();
    return setDocumentAsOwner(`users/${owner.uid}/goals/${id}`, {
      userId: stringField(owner.uid),
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
    await setDoc(doc(owner.firestore, `users/${owner.uid}`), profile(owner));

    await seedTransaction('own', at(15), { amount: integerField(50), amountInBaseCurrency: integerField(50) });
    // Around August's bounds.
    await seedTransaction('first-ms', AUGUST.start);
    await seedTransaction('last-ms', AUGUST.end);
    await seedTransaction('before', new Date(AUGUST.start.getTime() - 1));
    await seedTransaction('after', new Date(AUGUST.end.getTime() + 1));
    // 1500 yen, converted live into the dollar base at the cached rate.
    await seedTransaction('in-yen', at(20), {
      amount: integerField(1500),
      currency: stringField('JPY'),
      amountInBaseCurrency: integerField(10),
      exchangeRate: integerField(150)
    });
    // In the account's own category, with its receipt: its own row keeps both.
    await setDocumentAsOwner(`users/${owner.uid}/categories/own-pets`, {
      userId: stringField(owner.uid),
      name: stringField('Pets'),
      icon: stringField('pets'),
      color: stringField('#336699'),
      type: stringField('expense'),
      order: integerField(999),
      isActive: booleanField(true),
      isDefault: booleanField(false)
    });
    await seedTransaction('receipted', at(10), {
      amount: integerField(20),
      amountInBaseCurrency: integerField(20),
      categoryId: stringField('own-pets'),
      receiptUrl: stringField('https://example.test/receipt.jpg'),
      receiptCount: integerField(1)
    });

    const now = new Date();
    await seedBudget('current', 'Groceries', {
      spent: integerField(12000),
      spentPeriod: stringField(dayKey(budgetPeriodWindow('monthly', startOfMonth(now), now).start))
    });
    await seedBudget('stale', 'Dining', {
      spent: integerField(30000),
      spentPeriod: stringField('1999-01-01')
    });
    await seedBudget('inactive', 'Old', { isActive: booleanField(false) });
    await seedGoal('trip', 'Trip', true);
    await seedGoal('car', 'Car', false);
  }, 30000);

  afterAll(async () => {
    localStorage.removeItem(RATES_CACHE_KEY);
    await deleteApp(owner.app).catch(() => undefined);
  });

  beforeEach(() => {
    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [
        ...stack(owner),
        HouseholdLedgerService,
        { provide: ErrorHandler, useValue: errorHandler }
      ]
    });
    household = TestBed.inject(HouseholdService);
    ledger = TestBed.inject(HouseholdLedgerService);

    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  });

  it('reads the member\'s own rows, categories, active budgets and active goals through the rules', async () => {
    await household.create('Home');
    household.connect();
    await waitFor(() => household.members().length === 1, 'the household of one');
    ledger.setPeriod(AUGUST);
    ledger.setMembers(household.members());
    await waitFor(() => !ledger.loading() && ledger.rows().length === 5, 'the August rows');

    // Both of the period's bounds are inside it, and a millisecond past
    // either is not.
    expect(ledger.rows().map(r => [r.id, r.memberUid])).toEqual([
      ['last-ms', owner.uid],
      ['in-yen', owner.uid],
      ['own', owner.uid],
      ['receipted', owner.uid],
      ['first-ms', owner.uid]
    ]);

    const receipted = ledger.rows().find(r => r.id === 'receipted')!;
    expect(receipted.receiptCount).toBe(1);
    expect(ledger.categoriesByMember().get(owner.uid)!.get('own-pets')!.name).toBe('Pets');

    // In dollars: 50 + 20 + 1 + 1, and 10 for the 1500 yen at the cached 150
    // (10.03 at the compiled-in 149.5).
    expect(ledger.totalsByMember().map(entry => [entry.member.uid, entry.totals.expense]))
      .toEqual([[owner.uid, 82]]);
    expect(ledger.combined().expense).toBe(82);
    expect(TestBed.inject(CurrencyService).rateSource()).toBe('cached');

    const budgets = ledger.budgetsByMember().find(entry => entry.member.uid === owner.uid)!.budgets;
    expect(budgets.map(b => [b.id, b.spent, b.stale])).toEqual([
      ['stale', 0, true],
      ['current', 12000, false]
    ]);
    expect(ledger.goalsByMember().map(entry => [entry.member.uid, entry.goals.map(g => g.id)]))
      .toEqual([[owner.uid, ['trip']]]);
    expect(ledger.unavailable()).toEqual([]);
    expect(ledger.truncated()).toEqual([]);

    // The stale figure was shown as 0, not recalculated.
    const stored = await getDocumentAsOwner(`users/${owner.uid}/budgets/stale`);
    expect(stored?.['spent']).toEqual(integerField(30000));
    expectQuiet();
  }, 30000);
});
