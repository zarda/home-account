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
import { HouseholdLedgerService } from './household-ledger.service';
import { HouseholdService, householdSelectionKey } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { FirestoreService } from './firestore.service';
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
import { CreateTransactionDTO, User, shareKey } from '../../models';
import { monthWindow } from '../utils/transaction-date.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * HouseholdLedgerService against the emulators, with firestore.rules live:
 * two members of one household, each sharing rows through the app's own
 * write paths (TransactionService with sharedWith, and LedgerShareService's
 * share), and each reading the household's ledger through the real service,
 * with the one generation-filtered query the rules admit for a member.
 *
 * Two full service stacks, one per account: the owner's through the TestBed,
 * the peer's through a child EnvironmentInjector that provides every service
 * holding an account of its own. Two full clients is the most one file
 * holds: each keeps a listen stream and a write stream open, and Chrome
 * allows six connections per host, the admin REST calls included. The
 * household is formed and joined through HouseholdService; the invite, which
 * the callable writes, goes past the rules.
 *
 * The owner views in dollars and the peer in euros, from one cached rates
 * table, so each sees the other's rows in their own base at today's rate.
 * The period is a whole local month, and shared rows sit on either side of
 * each of its bounds, so this file runs in the zoned smoke:dates pass too.
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
  const at = (day: number, hour = 12) => new Date(2026, 7, day, hour);

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
    transactions: TransactionService;
    sharing: LedgerShareService;
  }

  let owner: Account;
  let peer: Account;
  let ownerStack: Stack;
  let peerStack: Stack;
  let peerInjector: EnvironmentInjector;
  let errorHandler: jasmine.SpyObj<ErrorHandler>;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;

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
      `household-ledger-${name}-${Date.now()}`
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
      transactions: get(TransactionService),
      sharing: get(LedgerShareService)
    };
  }

  /**
   * What the household page does with effects: hands the ledger the
   * household and its members as HouseholdService last heard them.
   */
  function syncPage(view: Stack): void {
    view.ledger.setHousehold(view.household.household());
    view.ledger.setMembers(view.household.members());
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
      view.ledger.setPeriod(AUGUST);
    }
    await waitFor(
      () => [ownerStack, peerStack].every(view => view.household.status() === 'member' && view.household.members().length === 2),
      'both members to list both members'
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

  const shown = (view: Stack) => view.ledger.rows().map(row => row.description);
  const lineOf = (view: Stack, account: Account) =>
    view.ledger.totalsByMember().find(line => line.member.uid === account.uid)?.totals;
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
   * Nothing reached the error handler and no service logged: a failure of
   * the ledger's own is a `[HouseholdLedger]` warning, a membership listener's
   * a `[HouseholdService]` one, a copy write's a `[LedgerShareService]` one,
   * and sharing code that did not load a `[Transactions]` one. The SDK's own
   * transport lines are not faults (unexpectedConsoleErrors).
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => /^\[(HouseholdLedger|HouseholdService|LedgerShareService|Transactions)\]/.test(String(args[0])))
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

  it("shows each member the rows the other shared, in the viewer's own base, and never a private row", async () => {
    const householdId = await formWithPeer();

    // The owner shares as its form does, with the row. Around August's
    // bounds, both inside by a millisecond and both outside by one.
    await add(ownerStack, 'first-ms', AUGUST.start, householdId);
    await add(ownerStack, 'last-ms', AUGUST.end, householdId);
    await add(ownerStack, 'before', new Date(AUGUST.start.getTime() - 1), householdId);
    await add(ownerStack, 'after', new Date(AUGUST.end.getTime() + 1), householdId);
    await add(ownerStack, 'lunch', at(15), householdId, { amount: 50 });
    await add(ownerStack, 'ramen', at(20), householdId, { amount: 1500, currency: 'JPY' });
    const ownerPrivate = await add(ownerStack, 'owner-private', at(16), null, { amount: 999 });
    // The peer adds privately, then shares one row from its menu.
    const rent = await add(peerStack, 'rent', at(18), null, { amount: 16, currency: 'EUR' });
    await peerStack.sharing.share([rent], householdId);
    const peerPrivate = await add(peerStack, 'peer-private', at(17), null, { amount: 777 });

    const august = ['last-ms', 'ramen', 'rent', 'lunch', 'first-ms'];
    await waitFor(() => shown(ownerStack).length === 5 && shown(peerStack).length === 5, "both views of August's rows");
    // Each of the period's bounds is inside it, and a millisecond past
    // either is not.
    expect(shown(ownerStack)).toEqual(august);
    expect(shown(peerStack)).toEqual(august);

    // The owner, in dollars: 50 + 10 for the 1500 yen at the cached 150
    // + 1 + 1, and the peer's 16 euros as 20.
    expect(lineOf(ownerStack, owner)).toEqual({ income: 0, expense: 62, balance: -62, count: 4, atTodaysRate: true });
    expect(lineOf(ownerStack, peer)).toEqual({ income: 0, expense: 20, balance: -20, count: 1, atTodaysRate: true });
    expect(ownerStack.ledger.combined()).toEqual({ income: 0, expense: 82, balance: -82, count: 5, atTodaysRate: true });
    // The peer, in euros: its own 16 exactly, and the owner's 62 dollars as 49.60.
    expect(lineOf(peerStack, peer)).toEqual({ income: 0, expense: 16, balance: -16, count: 1, atTodaysRate: false });
    expect(lineOf(peerStack, owner)).toEqual({ income: 0, expense: 49.6, balance: -49.6, count: 4, atTodaysRate: true });
    expect(TestBed.inject(CurrencyService).rateSource()).toBe('cached');

    // Each row keeps what its member entered.
    const ramen = peerStack.ledger.rows().find(row => row.description === 'ramen')!;
    expect([ramen.amount, ramen.currency, ramen.memberUid]).toEqual([1500, 'JPY', owner.uid]);
    expect(ramen.category.name).toBe('categoryNames.groceries');

    // No private row reached the household, not even as a copy the view
    // would hide.
    const ids = await copyIds(householdId);
    expect(ids.length).toBe(7);
    expect(ids).not.toContain(`${owner.uid}_${ownerPrivate}`);
    expect(ids).not.toContain(`${peer.uid}_${peerPrivate}`);
    for (const view of [ownerStack, peerStack]) {
      expect(shown(view)).not.toContain('owner-private');
      expect(shown(view)).not.toContain('peer-private');
      expect(view.ledger.truncated()).toBeFalse();
      expect(view.ledger.fromCache()).toBeFalse();
    }
    expectQuiet();
  }, 60000);

  it("hides a removed member's copies at once, and the removal purges them", async () => {
    const householdId = await formWithPeer();
    await add(ownerStack, 'owner-row', at(10), householdId);
    const first = await add(peerStack, 'peer-row-1', at(11), null);
    const second = await add(peerStack, 'peer-row-2', at(12), null);
    await peerStack.sharing.share([first, second], householdId);
    await waitFor(() => shown(ownerStack).length === 3, "the owner's view of both members' rows");
    expect(await copyIds(householdId)).toContain(`${peer.uid}_${first}`);

    await ownerStack.household.remove(peer.uid);

    await waitFor(() => ownerStack.household.members().length === 1, 'the owner to list itself alone');
    await waitFor(() => shown(ownerStack).length === 1, "the removed peer's rows hidden");
    expect(shown(ownerStack)).toEqual(['owner-row']);
    expect(ownerStack.ledger.totalsByMember().map(line => line.member.uid)).toEqual([owner.uid]);

    await eventually(
      async () => (await copyIds(householdId)).every(id => !id.startsWith(`${peer.uid}_`)),
      "the removed peer's copies purged"
    );
    expect(await copyIds(householdId)).toEqual([jasmine.stringMatching(new RegExp(`^${owner.uid}_`))]);
    // The peer's rows are its own, untouched.
    expect(await getDocumentAsOwner(`users/${peer.uid}/transactions/${first}`)).not.toBeNull();
    await waitFor(() => peerStack.household.lostAccess(), 'the peer to hear it lost access');
    expectQuiet();
  }, 60000);

  it("purges, as the owner's ledger, the copies of a member whose removal was cut off before its purge", async () => {
    const householdId = await formWithPeer();
    await add(ownerStack, 'owner-row', at(10), householdId);
    const first = await add(peerStack, 'peer-row-1', at(11), null);
    const second = await add(peerStack, 'peer-row-2', at(12), null);
    await peerStack.sharing.share([first, second], householdId);
    await waitFor(() => shown(ownerStack).length === 3, "the owner's view of both members' rows");
    const purge = spyOn(ownerStack.sharing, 'purgeMember').and.callThrough();

    // The member document goes past the service, as a removal cut off
    // before its purge leaves it: nothing but the owner's ledger purges.
    await deleteDocumentAsOwner(`households/${householdId}/members/${peer.uid}`);

    await waitFor(
      () => ownerStack.household.members().length === 1 && shown(ownerStack).join() === 'owner-row',
      "the owner to list itself alone and hide the peer's rows"
    );
    await eventually(
      async () => (await copyIds(householdId)).every(id => !id.startsWith(`${peer.uid}_`)),
      "the peer's copies purged by the owner's ledger"
    );
    expect(purge).toHaveBeenCalledOnceWith(householdId, peer.uid);
    expect(await copyIds(householdId)).toEqual([jasmine.stringMatching(new RegExp(`^${owner.uid}_`))]);
    await waitFor(() => peerStack.household.lostAccess(), 'the peer to hear it lost access');
    expectQuiet();
  }, 60000);
});
