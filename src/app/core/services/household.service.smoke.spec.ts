// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, and mixing
// the two produces instances that do not interoperate.
import { TestBed } from '@angular/core/testing';
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  ErrorHandler,
  Provider,
  signal,
  WritableSignal
} from '@angular/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { HouseholdError, HouseholdService, householdSelectionKey } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { LedgerShareService } from './ledger-share.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  EmulatorField,
  booleanField,
  deleteDocumentAsOwner,
  getDocumentAsOwner,
  integerField,
  listDocumentIdsAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { MAX_HOUSEHOLDS_PER_ACCOUNT, User, ledgerCopyPath, shareKey } from '../../models';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
import { unexpectedConsoleErrors } from './testing/firestore-transport-noise';
silenceFirebaseWarnings();

/**
 * HouseholdService against the emulators: every membership write goes
 * through the real service and FirestoreService with firestore.rules live, so
 * each passing case proves the service's commits are the ones the rules
 * admit, and its listeners the queries the rules can prove.
 *
 * Two full service stacks, one per account: the owner's through the TestBed,
 * the peer's through a child EnvironmentInjector (the
 * transaction-receipts.smoke.spec.ts pattern), each with the LedgerShareService
 * an ending takes its shared rows out through. Two full clients is the most
 * one file holds: each keeps a listen stream open, and a write stream once
 * it shares a row or takes one out, Chrome allows six connections per host,
 * and the admin REST reads and writes need the rest. So the set-up writes
 * nothing through a client but the shares a case is about: the rows and the
 * household's plans go past the rules over REST. No household rule reads
 * the profile, so none is written.
 *
 * The invite callable is faked: the functions emulator is not part of the
 * smoke run. Invites are written the way the callable writes them, past the
 * rules, with the generation copied from the stored household.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('HouseholdService (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';
  const DAY_MS = 24 * 60 * 60 * 1000;

  interface Account {
    name: string;
    app: FirebaseApp;
    firestore: Firestore;
    uid: string;
    user: User;
    /** What AuthService.currentUser() answers for the account, as the app's signal does. */
    current: WritableSignal<User>;
  }

  let owner: Account;
  let peer: Account;
  let ownerService: HouseholdService;
  let peerService: HouseholdService;
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
      `household-service-${name}-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    const firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);
    const credential = await signInAnonymously(auth);
    const uid = credential.user.uid;
    const user = { id: uid, ...profile({ name }) } as User;
    return { name, app, firestore, uid, user, current: signal(user) };
  }

  function stack(account: Account): Provider[] {
    return [
      HouseholdService,
      LedgerShareService,
      FirestoreService,
      { provide: Firestore, useValue: account.firestore },
      { provide: AuthService, useValue: { userId: () => account.uid, currentUser: account.current } },
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
   * The invite the callable writes, past the rules that refuse every client
   * create. The generation is the stored `createdAt` read back over REST and
   * passed through as the same string (generationOf): rebuilt from a Date it
   * would lose the microseconds the join rule compares.
   */
  async function seedInvite(
    householdId: string,
    inviterUid: string,
    inviteeUid: string,
    extra: Record<string, EmulatorField> = {}
  ): Promise<string> {
    const inviteId = `${householdId}_${inviteeUid}`;
    await setDocumentAsOwner(`householdInvites/${inviteId}`, {
      householdId: stringField(householdId),
      householdCreatedAt: await generationOf(householdId),
      householdName: stringField('Home'),
      inviterUid: stringField(inviterUid),
      inviterName: stringField('Owner'),
      inviterEmail: stringField('owner@example.test'),
      inviteeUid: stringField(inviteeUid),
      inviteeEmail: stringField(`${inviteeUid}@example.test`),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent'),
      ...extra
    });
    return inviteId;
  }

  /** The owner forms a household and the peer joins it, both through the service. */
  async function formWithPeer(): Promise<string> {
    const householdId = await ownerService.create('Home');
    await seedInvite(householdId, owner.uid, peer.uid);
    await peerService.accept(householdId);
    return householdId;
  }

  /** A row of the account's, as the app writes one, past the rules; private until shared. */
  function seedRow(account: Account, txId: string): Promise<void> {
    return setDocumentAsOwner(`users/${account.uid}/transactions/${txId}`, {
      userId: stringField(account.uid),
      type: stringField('expense'),
      amount: integerField(12),
      currency: stringField('USD'),
      amountInBaseCurrency: integerField(12),
      exchangeRate: integerField(1),
      categoryId: stringField('food_groceries'),
      description: stringField(`Shared ${txId}`),
      date: timestampField(),
      createdAt: timestampField(),
      updatedAt: timestampField(),
      isRecurring: booleanField(false)
    });
  }

  /** The keys a row's sharedWith holds, as stored. */
  async function sharedWithOf(account: Account, txId: string): Promise<string[]> {
    const row = await getDocumentAsOwner(`users/${account.uid}/transactions/${txId}`);
    const list = row?.['sharedWith'] as { arrayValue?: { values?: { stringValue: string }[] } } | undefined;
    return (list?.arrayValue?.values ?? []).map(value => value.stringValue);
  }

  /** The account's copy of a row in a household's ledger, as stored; null when there is none. */
  const copyOf = (account: Account, householdId: string, txId: string) =>
    getDocumentAsOwner(ledgerCopyPath(householdId, account.uid, txId));

  /** A household's generation as stored, the REST string read back with its microseconds. */
  async function generationOf(householdId: string): Promise<EmulatorField> {
    const createdAt = (await getDocumentAsOwner(`households/${householdId}`))?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${householdId} has no stored createdAt`);
    return { timestampValue: createdAt };
  }

  /** The account's index entry for a household, as stored; null when there is none. */
  const indexOf = (account: Account, householdId: string) =>
    getDocumentAsOwner(`users/${account.uid}/households/${householdId}`);

  /**
   * Every commit the service makes through runTransaction lands, and is then
   * sent again with the same work, as the SDK resends a commit whose answer
   * was lost (ADR 0156). A read-only transaction abandons itself on its
   * first run, so a server read goes through once.
   */
  function deliverTwice(firestore: FirestoreService): void {
    const commit = firestore.runTransaction.bind(firestore);
    spyOn(firestore, 'runTransaction').and.callFake((async (
      update: Parameters<typeof commit>[0],
      options?: Parameters<typeof commit>[1]
    ) => {
      await commit(update, options);
      return commit(update, options);
    }) as never);
  }

  /** The ids the account's index lists, read past the rules over REST. */
  const indexIds = (account: Account) => listDocumentIdsAsOwner(`users/${account.uid}/households`);

  /**
   * Accounts are signed in once for the file, so the memberships an earlier
   * case formed are still live. Their index entries are deleted past the
   * rules, which refuse that while a membership lives, so each case starts
   * with none listed, well inside the limit.
   */
  async function forgetMemberships(account: Account): Promise<void> {
    for (const householdId of await indexIds(account)) {
      await deleteDocumentAsOwner(`users/${account.uid}/households/${householdId}`);
    }
    localStorage.removeItem(householdSelectionKey(account.uid));
  }

  /**
   * Neither service logged, and nothing reached the error handler: an
   * unexpected listener failure is a `[HouseholdService]` warning, a
   * failure in the sharing code, logged and swallowed, a
   * `[LedgerShareService]` one, and a fault anywhere else an error. The SDK's own transport lines are neither
   * (unexpectedConsoleErrors), nor are its other warnings. Each check names
   * what it caught, so a failure that happens once says what it was.
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => /^\[(HouseholdService|LedgerShareService)\]/.test(String(args[0])))
      .map(args => args.map(String));
    expect(warnings).withContext(`console.warn: ${JSON.stringify(warnings)}`).toEqual([]);
  }

  beforeAll(async () => {
    owner = await signIn('owner');
    peer = await signIn('peer');
  }, 30000);

  afterAll(async () => {
    for (const account of [owner, peer]) {
      await deleteApp(account.app).catch(() => undefined);
    }
  });

  // Households are keyed by fresh ids, so nothing an earlier case left
  // behind is in the way once no index lists it.
  beforeEach(async () => {
    for (const account of [owner, peer]) {
      await forgetMemberships(account);
    }

    errorHandler = jasmine.createSpyObj<ErrorHandler>('ErrorHandler', ['handleError']);
    TestBed.configureTestingModule({
      providers: [...stack(owner), { provide: ErrorHandler, useValue: errorHandler }]
    });
    ownerService = TestBed.inject(HouseholdService);
    peerInjector = createEnvironmentInjector(stack(peer), TestBed.inject(EnvironmentInjector));
    peerService = peerInjector.get(HouseholdService);
    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  });

  afterEach(() => {
    peerInjector.destroy();
  });

  it('forms a household and joins it through the real service, and both see the two members', async () => {
    const householdId = await formWithPeer();

    const household = await getDocumentAsOwner(`households/${householdId}`);
    const joined = await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`);
    const founder = await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`);
    expect(joined?.['role']).toEqual(stringField('member'));
    expect(joined?.['since']).toEqual(household?.['createdAt']);
    expect(joined?.['inviteId']).toEqual(stringField(`${householdId}_${peer.uid}`));
    expect(founder?.['role']).toEqual(stringField('owner'));
    expect(founder?.['since']).toEqual(household?.['createdAt']);
    expect(founder?.['inviteId']).toBeUndefined();
    expect(await getDocumentAsOwner(`householdInvites/${householdId}_${peer.uid}`)).toBeNull();
    const ownerEntry = await indexOf(owner, householdId);
    const peerEntry = await indexOf(peer, householdId);
    expect(ownerEntry?.['since']).toEqual(household?.['createdAt']);
    expect(ownerEntry?.['role']).toEqual(stringField('owner'));
    expect(peerEntry?.['since']).toEqual(household?.['createdAt']);
    expect(peerEntry?.['role']).toEqual(stringField('member'));
    expect(peerEntry?.['name']).toEqual(stringField('Home'));

    ownerService.connect();
    peerService.connect();
    await waitFor(() => ownerService.members().length === 2, 'the owner to list both members');
    await waitFor(() => peerService.members().length === 2, 'the peer to list both members');
    expect(peerService.household()?.name).toBe('Home');
    expect(peerService.isOwner()).toBeFalse();
    expect(ownerService.isOwner()).toBeTrue();
    expect(peerService.memberships().map(m => [m.householdId, m.role, m.ended]))
      .toEqual([[householdId, 'member', false]]);
    expectQuiet();
  }, 30000);

  it('hears the owner\'s sent invites and the invitee\'s received invites under the real rules', async () => {
    const householdId = await ownerService.create('Home');
    await seedInvite(householdId, owner.uid, peer.uid);

    ownerService.connect();
    peerService.connect();
    await waitFor(() => ownerService.sentInvites().length === 1, 'the owner\'s sent invite');
    await waitFor(() => peerService.receivedInvites().some(i => i.householdId === householdId),
      'the peer\'s received invite');
    expect(ownerService.sentInvites()[0].inviteeUid).toBe(peer.uid);
    expect(peerService.status()).toBe('none');
    expectQuiet();
  }, 30000);

  it('tells a removed peer it lost access, quietly, and tidies its index entry after', async () => {
    const householdId = await formWithPeer();
    ownerService.connect();
    peerService.connect();
    await waitFor(() => peerService.status() === 'member' && peerService.members().length === 2,
      'the peer\'s live membership');
    await waitFor(() => ownerService.status() === 'member', 'the owner\'s live membership');

    await ownerService.remove(peer.uid);

    await waitFor(() => peerService.lostAccess(), 'the peer to hear it lost access');
    expect(peerService.status()).toBe('none');
    await waitFor(() => ownerService.members().length === 1, 'the owner to list itself alone');
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();

    expect(await indexOf(peer, householdId)).not.toBeNull();
    expect(await peerService.tidyEndedMemberships()).toBeTrue();
    expect(await indexOf(peer, householdId)).toBeNull();
    await waitFor(() => peerService.memberships().length === 0, 'the peer to list no membership');
    expectQuiet();
  }, 30000);

  it('lets the peer leave, and does not call its own leaving lost access', async () => {
    const householdId = await formWithPeer();
    ownerService.connect();
    peerService.connect();
    await waitFor(() => peerService.status() === 'member', 'the peer\'s live membership');

    await peerService.leave();

    await waitFor(() => peerService.status() === 'none', 'the peer to see no membership');
    expect(peerService.lostAccess()).toBeFalse();
    await waitFor(() => ownerService.members().length === 1, 'the owner to list itself alone');
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await indexOf(peer, householdId)).toBeNull();
    await waitFor(() => peerService.memberships().length === 0, 'the peer to list no membership');
    expectQuiet();
  }, 30000);

  it('dissolves without leaving a household, member or invite document behind', async () => {
    const householdId = await formWithPeer();
    const pending = await seedInvite(householdId, owner.uid, `ghost-${Date.now()}`);
    ownerService.connect();
    peerService.connect();
    await waitFor(() => ownerService.status() === 'member' && ownerService.sentInvites().length === 1,
      'the owner\'s live membership and its pending invite');
    await waitFor(() => peerService.status() === 'member', 'the peer\'s live membership');

    await ownerService.dissolve();

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${pending}`)).toBeNull();
    expect(await indexOf(owner, householdId)).toBeNull();

    await waitFor(() => ownerService.status() === 'none', 'the owner to see no membership');
    await waitFor(() => peerService.lostAccess(), 'the peer to hear it lost access');
    expect(ownerService.lostAccess()).toBeFalse();
    expectQuiet();
    // Above the four ten-second waits and the round trips between them, so a
    // slow run fails naming the wait it was stuck on.
  }, 60000);

  // A commit that lands and loses its answer is sent again, and the second
  // delivery meets a household the first already removed. Here every commit
  // the dissolve makes lands once and is then sent again.
  it('finishes a dissolve whose every commit is delivered twice', async () => {
    const householdId = await formWithPeer();
    const pending = await seedInvite(householdId, owner.uid, `ghost-${Date.now()}`);
    ownerService.connect();
    await waitFor(() => ownerService.status() === 'member' && ownerService.sentInvites().length === 1,
      'the owner\'s live membership and its pending invite');
    deliverTwice(TestBed.inject(FirestoreService));

    await ownerService.dissolve();

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${pending}`)).toBeNull();
    expect(await indexOf(owner, householdId)).toBeNull();
    await waitFor(() => ownerService.status() === 'none', 'the owner to see no membership');
    expect(ownerService.lostAccess()).toBeFalse();
    expectQuiet();
  }, 60000);

  // Two tabs of one owner, or a second press: whichever dissolve comes
  // second finds the household gone, at whatever step it has reached.
  it('finishes both of two dissolves sent at once', async () => {
    const householdId = await formWithPeer();
    ownerService.connect();
    await waitFor(() => ownerService.status() === 'member', 'the owner\'s live membership');

    await Promise.all([ownerService.dissolve(), ownerService.dissolve()]);

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await indexOf(owner, householdId)).toBeNull();
    await waitFor(() => ownerService.status() === 'none', 'the owner to see no membership');
    expect(ownerService.lostAccess()).toBeFalse();
    expectQuiet();
  }, 60000);

  it("brings a member's name and picture into line with its renamed profile, as the rules allow", async () => {
    const householdId = await formWithPeer();
    peer.current.set({
      ...peer.user,
      displayName: 'Peer Renamed',
      photoURL: 'https://lh3.googleusercontent.com/a/peer'
    });
    try {
      peerService.connect();
      const memberPath = `households/${householdId}/members/${peer.uid}`;
      // The rename is followed by a root effect, which runs on the app's tick.
      await waitFor(() => {
        TestBed.tick();
        return peerService.members().some(each => each.uid === peer.uid && each.displayName === 'Peer Renamed');
      }, "the peer's own view to show the new name");
      const stored = await getDocumentAsOwner(memberPath);
      expect(stored?.['displayName']).toEqual(stringField('Peer Renamed'));
      expect(stored?.['photoURL']).toEqual(stringField('https://lh3.googleusercontent.com/a/peer'));

      // A picture the rules would refuse is removed rather than kept stale.
      peer.current.update(user => ({ ...user, photoURL: 'https://example.test/peer.png' }));
      await waitFor(() => {
        TestBed.tick();
        return peerService.members().some(each => each.uid === peer.uid && each.photoURL === undefined);
      }, 'the picture to go');
      expect((await getDocumentAsOwner(memberPath))?.['photoURL']).toBeUndefined();
      expectQuiet();
    } finally {
      peer.current.set(peer.user);
    }
  }, 30000);

  it('refuses a join through an expired invite as expired, leaving nothing behind', async () => {
    const householdId = await ownerService.create('Home');
    await seedInvite(householdId, owner.uid, peer.uid, {
      expiresAt: timestampField(new Date(Date.now() - 60 * 1000))
    });

    await expectAsync(peerService.accept(householdId))
      .toBeRejectedWithError(HouseholdError, 'household.errors.expired');
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await indexOf(peer, householdId)).toBeNull();
    expectQuiet();
  }, 30000);

  it('lets one account belong to two households, and shows whichever is selected', async () => {
    const own = await peerService.create('Elsewhere');
    const joined = await formWithPeer();

    expect(await indexOf(peer, own)).not.toBeNull();
    expect(await indexOf(peer, joined)).not.toBeNull();

    peerService.connect();
    await waitFor(() => peerService.memberships().length === 2, 'the peer to list both memberships');
    // The one joined last was selected as it was joined.
    await waitFor(() => peerService.status() === 'member' && peerService.household()?.id === joined,
      'the joined household');
    expect(peerService.isOwner()).toBeFalse();
    // A first answer from the cache can hold only what this client has seen.
    await waitFor(() => peerService.members().length === 2, 'both members of the joined household');

    peerService.select(own);
    await waitFor(() => peerService.status() === 'member' && peerService.household()?.id === own,
      'the peer\'s own household');
    expect(peerService.household()?.name).toBe('Elsewhere');
    expect(peerService.isOwner()).toBeTrue();
    expect(peerService.members().map(m => m.uid)).toEqual([peer.uid]);
    expect(peerService.lostAccess()).toBeFalse();
    expectQuiet();
  }, 30000);

  it('keeps the other membership when the account leaves one of two', async () => {
    const own = await peerService.create('Elsewhere');
    const joined = await formWithPeer();
    peerService.connect();
    peerService.select(joined);
    await waitFor(() => peerService.status() === 'member' && peerService.household()?.id === joined,
      'the joined household');

    await peerService.leave();

    expect(await getDocumentAsOwner(`households/${joined}/members/${peer.uid}`)).toBeNull();
    expect(await indexOf(peer, joined)).toBeNull();
    expect(await indexOf(peer, own)).not.toBeNull();
    expect(await getDocumentAsOwner(`households/${own}/members/${peer.uid}`)).not.toBeNull();
    await waitFor(() => peerService.status() === 'member' && peerService.household()?.id === own,
      'the peer\'s own household to be the one shown');
    expect(peerService.memberships().map(m => m.householdId)).toEqual([own]);
    expect(peerService.lostAccess()).toBeFalse();
    expectQuiet();
  }, 30000);

  // A commit that lands and loses its answer is sent again, and the second
  // delivery is judged against what the first left (ADR 0156).
  it('resolves a create and an accept each delivered twice', async () => {
    deliverTwice(TestBed.inject(FirestoreService));
    deliverTwice(peerInjector.get(FirestoreService));

    const householdId = await ownerService.create('Home');
    const household = await getDocumentAsOwner(`households/${householdId}`);
    expect(household?.['ownerId']).toEqual(stringField(owner.uid));
    expect((await indexOf(owner, householdId))?.['since']).toEqual(household?.['createdAt']);

    await seedInvite(householdId, owner.uid, peer.uid);
    expect(await peerService.accept(householdId)).toBe('Home');
    const joined = await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`);
    expect(joined?.['since']).toEqual(household?.['createdAt']);
    expect((await indexOf(peer, householdId))?.['since']).toEqual(household?.['createdAt']);
    expect(await getDocumentAsOwner(`householdInvites/${householdId}_${peer.uid}`)).toBeNull();
    expectQuiet();
  }, 30000);

  it(`refuses a household past the limit of ${MAX_HOUSEHOLDS_PER_ACCOUNT} before writing anything`, async () => {
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_ACCOUNT; i++) {
      await ownerService.create(`Home ${i + 1}`);
    }
    expect((await indexIds(owner)).length).toBe(MAX_HOUSEHOLDS_PER_ACCOUNT);

    await expectAsync(ownerService.create('One too many')).toBeRejectedWithError(
      HouseholdError,
      `household.errors.tooMany:${JSON.stringify({ max: MAX_HOUSEHOLDS_PER_ACCOUNT })}`
    );
    expect((await indexIds(owner)).length).toBe(MAX_HOUSEHOLDS_PER_ACCOUNT);
    expectQuiet();
  }, 60000);

  it(`counts toward the limit of ${MAX_HOUSEHOLDS_PER_ACCOUNT} neither an ended entry nor one whose membership is gone, ending the latter on the way`, async () => {
    // Written past the rules, as an ending cut off after its mark leaves
    // one, and as a removal made while no page listened leaves the other.
    const stamp = timestampField(new Date(Date.now() - 60 * 1000));
    const seedEntry = (householdId: string, extra: Record<string, EmulatorField> = {}) =>
      setDocumentAsOwner(`users/${owner.uid}/households/${householdId}`, {
        since: stamp,
        role: stringField('member'),
        name: stringField('Gone'),
        joinedAt: stamp,
        ...extra
      });
    const ended = `ended${Date.now()}`;
    const stale = `stale${Date.now()}`;
    await seedEntry(ended, { endedAt: stamp });
    await seedEntry(stale);
    for (let i = 0; i < MAX_HOUSEHOLDS_PER_ACCOUNT - 1; i++) {
      await ownerService.create(`Home ${i + 1}`);
    }

    const last = await ownerService.create('One more');

    expect(await indexOf(owner, last)).not.toBeNull();
    expect(await indexOf(owner, stale)).toBeNull();
    expect(await indexOf(owner, ended)).not.toBeNull();
    await expectAsync(ownerService.create('One too many')).toBeRejectedWithError(
      HouseholdError,
      `household.errors.tooMany:${JSON.stringify({ max: MAX_HOUSEHOLDS_PER_ACCOUNT })}`
    );
    expect((await indexIds(owner)).length).toBe(MAX_HOUSEHOLDS_PER_ACCOUNT + 1);
    expectQuiet();
  }, 60000);

  it('erases a member\'s and then an owner\'s household state for account deletion, across every membership', async () => {
    const householdId = await formWithPeer();
    // The peer also owns a household of its own.
    const peerOwn = await peerService.create('Elsewhere');
    const sent = await seedInvite(householdId, owner.uid, `ghost-${Date.now()}`);
    // An invite to the peer from a household it never joined.
    const elsewhere = `elsewhere${Date.now()}`;
    await setDocumentAsOwner(`householdInvites/${elsewhere}_${peer.uid}`, {
      householdId: stringField(elsewhere),
      householdCreatedAt: timestampField(),
      householdName: stringField('Elsewhere'),
      inviterUid: stringField('someone-else'),
      inviterName: stringField('Someone'),
      inviteeUid: stringField(peer.uid),
      inviteeEmail: stringField('peer@example.test'),
      locale: stringField('en'),
      createdAt: timestampField(),
      expiresAt: timestampField(new Date(Date.now() + 7 * DAY_MS)),
      mail: stringField('sent')
    });

    await peerService.deleteAll();

    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${elsewhere}_${peer.uid}`)).toBeNull();
    expect(await indexOf(peer, householdId)).toBeNull();
    expect(await getDocumentAsOwner(`households/${peerOwn}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${peerOwn}/members/${peer.uid}`)).toBeNull();
    expect(await indexOf(peer, peerOwn)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}`)).not.toBeNull();

    await ownerService.deleteAll();

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${sent}`)).toBeNull();
    expect(await indexOf(owner, householdId)).toBeNull();
  }, 30000);

  it("erases a member's own contributions to the household's goals for account deletion, and leaves the owner's", async () => {
    const householdId = await formWithPeer();
    // The goal and its contributions, past the rules, as the members'
    // writes leave them.
    const gen = await generationOf(householdId);
    const goal = `households/${householdId}/goals/trip`;
    await setDocumentAsOwner(goal, {
      gen,
      name: stringField('Trip'),
      targetAmount: integerField(2000),
      currency: stringField('USD'),
      isActive: booleanField(true),
      createdBy: stringField(owner.uid),
      createdAt: timestampField(),
      updatedAt: timestampField()
    });
    const contribution = (memberUid: string, amount: number) => ({
      gen,
      memberUid: stringField(memberUid),
      amount: integerField(amount),
      date: timestampField(),
      createdAt: timestampField()
    });
    await setDocumentAsOwner(`${goal}/contributions/peer1`, contribution(peer.uid, 500));
    await setDocumentAsOwner(`${goal}/contributions/peer2`, contribution(peer.uid, 300));
    await setDocumentAsOwner(`${goal}/contributions/owner1`, contribution(owner.uid, 200));

    await peerService.deleteAll();

    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    // What the owner's client, a live member, lists of the goal from the server.
    const ownerFirestore = TestBed.inject(FirestoreService);
    const household = await ownerFirestore.getDocumentFromServer<{ createdAt: Timestamp }>(`households/${householdId}`);
    const left = await ownerFirestore.getCollectionFromServer<{ id: string }>(`${goal}/contributions`, {
      where: [{ field: 'gen', op: '==', value: household?.createdAt }]
    });
    expect(left.map(doc => doc.id)).toEqual(['owner1']);
    expectQuiet();
  }, 30000);

  describe('the rows a membership shared', () => {
    let ownerSharing: LedgerShareService;
    let peerSharing: LedgerShareService;

    beforeEach(() => {
      ownerSharing = TestBed.inject(LedgerShareService);
      peerSharing = peerInjector.get(LedgerShareService);
    });

    it("takes a leaving member's rows out of the household, and the household's key off them", async () => {
      const householdId = await formWithPeer();
      await seedRow(peer, 'left1');
      await peerSharing.share(['left1'], householdId);
      expect(await copyOf(peer, householdId, 'left1')).not.toBeNull();
      peerService.connect();
      await waitFor(() => peerService.status() === 'member', 'the peer\'s live membership');

      await peerService.leave();

      expect(await copyOf(peer, householdId, 'left1')).toBeNull();
      expect(await sharedWithOf(peer, 'left1')).toEqual([]);
      expect(await indexOf(peer, householdId)).toBeNull();
      expectQuiet();
    }, 30000);

    it("purges a removed member's rows as the owner, and the member's own tidy takes the key off them", async () => {
      const householdId = await formWithPeer();
      await seedRow(peer, 'gone1');
      await seedRow(peer, 'gone2');
      await peerSharing.share(['gone1', 'gone2'], householdId);
      ownerService.connect();
      await waitFor(() => ownerService.status() === 'member' && ownerService.members().length === 2,
        'the owner to list both members');
      const reports: [number, number][] = [];

      await ownerService.remove(peer.uid, undefined, (done, total) => reports.push([done, total]));

      expect(await copyOf(peer, householdId, 'gone1')).toBeNull();
      expect(await copyOf(peer, householdId, 'gone2')).toBeNull();
      expect(reports.at(-1)).toEqual([2, 2]);
      // Only the account itself writes its rows.
      expect(await sharedWithOf(peer, 'gone1')).toEqual([shareKey(householdId)]);

      expect(await peerService.tidyEndedMemberships()).toBeTrue();

      expect(await sharedWithOf(peer, 'gone1')).toEqual([]);
      expect(await sharedWithOf(peer, 'gone2')).toEqual([]);
      expect(await indexOf(peer, householdId)).toBeNull();
      expectQuiet();
    }, 30000);

    it("dissolves the household's plans and the owner's own rows, and leaves the peer's to the peer, readable to no one else", async () => {
      const householdId = await formWithPeer();
      await seedRow(owner, 'mine1');
      await ownerSharing.share(['mine1'], householdId);
      await seedRow(peer, 'theirs1');
      await peerSharing.share(['theirs1'], householdId);
      // The household's own plans, past the rules: every one of the live
      // generation, as a member's writes leave them.
      const gen = await generationOf(householdId);
      const plans = [
        `households/${householdId}/budgets/food`,
        `households/${householdId}/goals/trip`,
        ...['c1', 'c2', 'c3'].map(id => `households/${householdId}/goals/trip/contributions/${id}`)
      ];
      for (const path of plans) {
        await setDocumentAsOwner(path, { gen, memberUid: stringField(peer.uid), name: stringField('Plan') });
      }
      ownerService.connect();
      await waitFor(() => ownerService.status() === 'member', 'the owner\'s live membership');

      await ownerService.dissolve();

      for (const path of plans) {
        expect(await getDocumentAsOwner(path)).withContext(path).toBeNull();
      }
      expect(await copyOf(owner, householdId, 'mine1')).toBeNull();
      expect(await sharedWithOf(owner, 'mine1')).toEqual([]);
      // The peer's copy is still stored, and only the peer reads it now.
      expect(await copyOf(peer, householdId, 'theirs1')).not.toBeNull();
      await expectAsync(
        TestBed.inject(FirestoreService).getDocumentFromServer(ledgerCopyPath(householdId, peer.uid, 'theirs1'))
      ).toBeRejectedWith(jasmine.objectContaining({ code: 'permission-denied' }));

      expect(await peerService.tidyEndedMemberships()).toBeTrue();

      expect(await copyOf(peer, householdId, 'theirs1')).toBeNull();
      expect(await sharedWithOf(peer, 'theirs1')).toEqual([]);
      expect(await indexOf(peer, householdId)).toBeNull();
      expectQuiet();
    }, 60000);

    it("erases for account deletion the rows the account shared into each of its memberships, owned and joined, and each household's key off them", async () => {
      const householdId = await formWithPeer();
      // Formed before anything is shared, so the peer's sharing code lists
      // both memberships at its first read of the index.
      const peerOwn = await peerService.create('Elsewhere');
      await seedRow(peer, 'erase1');
      await seedRow(peer, 'erase2');
      await peerSharing.share(['erase1'], householdId);
      await peerSharing.share(['erase2'], peerOwn);
      await seedRow(owner, 'erase3');
      await ownerSharing.share(['erase3'], householdId);
      expect(await copyOf(peer, householdId, 'erase1')).not.toBeNull();
      expect(await copyOf(peer, peerOwn, 'erase2')).not.toBeNull();

      await peerService.deleteAll();

      expect(await copyOf(peer, householdId, 'erase1')).toBeNull();
      expect(await copyOf(peer, peerOwn, 'erase2')).toBeNull();
      expect(await sharedWithOf(peer, 'erase1')).toEqual([]);
      expect(await sharedWithOf(peer, 'erase2')).toEqual([]);
      expect(await indexOf(peer, householdId)).toBeNull();
      expect(await indexOf(peer, peerOwn)).toBeNull();
      expect(await copyOf(owner, householdId, 'erase3')).not.toBeNull();

      await ownerService.deleteAll();

      expect(await copyOf(owner, householdId, 'erase3')).toBeNull();
      expect(await sharedWithOf(owner, 'erase3')).toEqual([]);
      expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
      expect(await indexOf(owner, householdId)).toBeNull();
      expectQuiet();
    }, 60000);

    it('rejoins a household without sharing again what an earlier membership of it left shared', async () => {
      const householdId = await formWithPeer();
      await seedRow(peer, 'old1');
      await peerSharing.share(['old1'], householdId);
      // A removal whose purge never ran, and which the peer never tidied.
      await deleteDocumentAsOwner(`households/${householdId}/members/${peer.uid}`);
      expect(await copyOf(peer, householdId, 'old1')).not.toBeNull();
      expect(await sharedWithOf(peer, 'old1')).toEqual([shareKey(householdId)]);

      await seedInvite(householdId, owner.uid, peer.uid);
      await peerService.accept(householdId);

      expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).not.toBeNull();
      expect(await copyOf(peer, householdId, 'old1')).toBeNull();
      expect(await sharedWithOf(peer, 'old1')).toEqual([]);
      expect(await indexOf(peer, householdId)).not.toBeNull();
      expectQuiet();
    }, 30000);
  });
});
