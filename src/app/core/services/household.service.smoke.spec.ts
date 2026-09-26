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
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { HouseholdError, HouseholdService } from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  EmulatorField,
  getDocumentAsOwner,
  patchFieldsAsOwner,
  setDocumentAsOwner,
  stringField,
  timestampField
} from './testing/emulator-admin';
import { User } from '../../models';
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
 * transaction-receipts.smoke.spec.ts pattern). Two full clients is the most
 * one file holds: each keeps a listen stream open, Chrome allows six
 * connections per host, and the admin REST reads and writes need the rest.
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
   * passed through as the same string: rebuilt from a Date it would lose the
   * microseconds the join rule compares.
   */
  async function seedInvite(
    householdId: string,
    inviterUid: string,
    inviteeUid: string,
    extra: Record<string, EmulatorField> = {}
  ): Promise<string> {
    const household = await getDocumentAsOwner(`households/${householdId}`);
    const createdAt = household?.['createdAt']?.['timestampValue'];
    if (typeof createdAt !== 'string') throw new Error(`households/${householdId} has no stored createdAt`);
    const inviteId = `${householdId}_${inviteeUid}`;
    await setDocumentAsOwner(`householdInvites/${inviteId}`, {
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

  const pointerOf = async (account: Account) =>
    (await getDocumentAsOwner(`users/${account.uid}`))?.['householdId'] ?? null;

  /**
   * Neither service logged, and nothing reached the error handler: an
   * unexpected listener failure is a `[HouseholdService]` warning, and a
   * fault anywhere else an error. The SDK's own transport lines are neither
   * (unexpectedConsoleErrors), nor are its other warnings. Each check names
   * what it caught, so a failure that happens once says what it was.
   */
  function expectQuiet(): void {
    expect(errorHandler.handleError.calls.allArgs().map(args => args.map(String)))
      .withContext('the error handler').toEqual([]);
    const errors = unexpectedConsoleErrors(consoleError.calls.allArgs());
    expect(errors).withContext(`console.error: ${JSON.stringify(errors)}`).toEqual([]);
    const warnings = consoleWarn.calls.allArgs()
      .filter(args => String(args[0]).startsWith('[HouseholdService]'))
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
    expect(await pointerOf(owner)).toEqual(stringField(householdId));
    expect(await pointerOf(peer)).toEqual(stringField(householdId));

    ownerService.connect();
    peerService.connect();
    await waitFor(() => ownerService.members().length === 2, 'the owner to list both members');
    await waitFor(() => peerService.members().length === 2, 'the peer to list both members');
    expect(peerService.household()?.name).toBe('Home');
    expect(peerService.isOwner()).toBeFalse();
    expect(ownerService.isOwner()).toBeTrue();
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

  it('tells a removed peer it lost access, quietly, and clears its pointer after', async () => {
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

    expect(await peerService.clearStalePointer()).toBeTrue();
    expect(await pointerOf(peer)).toBeNull();
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
    expect(await pointerOf(peer)).toBeNull();
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
    expect(await pointerOf(owner)).toBeNull();

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
    const firestore = TestBed.inject(FirestoreService);
    const commit = firestore.runTransaction.bind(firestore);
    spyOn(firestore, 'runTransaction').and.callFake((async (update: Parameters<typeof commit>[0]) => {
      await commit(update);
      return commit(update);
    }) as never);

    await ownerService.dissolve();

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${pending}`)).toBeNull();
    expect(await pointerOf(owner)).toBeNull();
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
    expect(await pointerOf(owner)).toBeNull();
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

  it('refuses a join through an expired invite as expired, and one while a member elsewhere as already a member', async () => {
    const householdId = await ownerService.create('Home');
    await seedInvite(householdId, owner.uid, peer.uid, {
      expiresAt: timestampField(new Date(Date.now() - 60 * 1000))
    });

    await expectAsync(peerService.accept(householdId))
      .toBeRejectedWithError(HouseholdError, 'household.errors.expired');
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await pointerOf(peer)).toBeNull();

    const own = await peerService.create('Elsewhere');
    await seedInvite(householdId, owner.uid, peer.uid);

    await expectAsync(peerService.accept(householdId))
      .toBeRejectedWithError(HouseholdError, 'household.errors.alreadyMember');
    expect(await getDocumentAsOwner(`households/${householdId}/members/${peer.uid}`)).toBeNull();
    expect(await pointerOf(peer)).toEqual(stringField(own));
    expectQuiet();
  }, 30000);

  it('erases a member\'s and then an owner\'s household state for account deletion', async () => {
    const householdId = await formWithPeer();
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
    expect(await pointerOf(peer)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}`)).not.toBeNull();

    await ownerService.deleteAll();

    expect(await getDocumentAsOwner(`households/${householdId}`)).toBeNull();
    expect(await getDocumentAsOwner(`households/${householdId}/members/${owner.uid}`)).toBeNull();
    expect(await getDocumentAsOwner(`householdInvites/${sent}`)).toBeNull();
    expect(await pointerOf(owner)).toBeNull();
  }, 30000);
});
