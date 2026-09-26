import { TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, Subject } from 'rxjs';
import { Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService,
  householdNameValid,
  householdNameValidator,
  inviteEmailValid
} from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { DocumentWithMetadata, FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { createTranslationStub } from './testing/translation-stub';
import {
  Household,
  HouseholdInvite,
  HouseholdMember,
  HouseholdRole,
  User
} from '../../models';

type OwnMember = DocumentWithMetadata<HouseholdMember>;
interface Write { op: 'set' | 'update' | 'delete'; path: string; data?: unknown }
type Where = { field: string; op: string; value: unknown }[] | undefined;

/** The own member document as the server confirmed it. */
const confirmed = (data: HouseholdMember | null): OwnMember => ({ data, fromCache: false, hasPendingWrites: false });
/** The own member document as the local cache answered it. */
const cached = (data: HouseholdMember | null): OwnMember => ({ data, fromCache: true, hasPendingWrites: false });

/**
 * The one name rule the setup's create form, the owner's rename field and the
 * service itself all judge by: the rules' 1–60 characters, after trimming.
 */
describe('householdNameValid', () => {
  it('accepts one character, and sixty', () => {
    expect(householdNameValid('A')).toBeTrue();
    expect(householdNameValid('n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH))).toBeTrue();
  });

  it('judges the name as it will be stored, trimmed', () => {
    expect(householdNameValid(`  ${'n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH)}  `)).toBeTrue();
    expect(householdNameValid('   ')).toBeFalse();
  });

  it('refuses an empty name, and one over sixty characters', () => {
    expect(householdNameValid('')).toBeFalse();
    expect(householdNameValid('n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1))).toBeFalse();
  });

  it('judges a form control by the same rule', () => {
    expect(householdNameValidator(new FormControl(' The Lins ', { nonNullable: true }))).toBeNull();
    expect(householdNameValidator(new FormControl('  ', { nonNullable: true }))).toEqual({ householdName: true });
    expect(
      householdNameValidator(new FormControl('n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1), { nonNullable: true }))
    ).toEqual({ householdName: true });
  });
});

/**
 * The invite form's shape check: normalizeInviteEmail's in
 * functions/src/household-invite.ts, whose test lists the same cases.
 */
describe('inviteEmailValid', () => {
  it('accepts an address, judged trimmed as invite() sends it', () => {
    expect(inviteEmailValid('sam@example.com')).toBeTrue();
    expect(inviteEmailValid('  Sam@Example.COM ')).toBeTrue();
  });

  it('refuses what cannot be an address', () => {
    for (const value of [
      '',
      '   ',
      'no-at-sign',
      '@example.com',
      'sam@',
      'a@b@example.com',
      'sam @example.com',
      'sam\t@example.com',
      'sam\u0000@example.com',
      'sam\u007f@example.com'
    ]) {
      expect(inviteEmailValid(value)).withContext(JSON.stringify(value)).toBeFalse();
    }
  });

  it('admits 254 characters and refuses 255', () => {
    const at254 = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;
    expect(at254.length).toBe(254);
    expect(inviteEmailValid(at254)).toBeTrue();
    expect(inviteEmailValid(`  ${at254}  `)).toBeTrue();
    expect(inviteEmailValid(`a${at254}`)).toBeFalse();
  });
});

describe('HouseholdService', () => {
  const ME = 'me';
  const OTHER = 'kai';
  const HID = 'h1';
  // Microseconds on purpose: a generation compared by the rules keeps them.
  const CREATED = new Timestamp(1_788_000_000, 123_456_000);
  const LATER = new Timestamp(1_788_100_000, 0);
  const FUTURE = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  // Minutes left by this device's clock: a clock running slow still sees
  // time left on an invite the server has already expired.
  const SOON = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  const PAST = Timestamp.fromMillis(Date.now() - 60 * 1000);
  // The translation stub echoes the key with its params.
  const NAME_ERROR = `household.errors.name:${JSON.stringify({ max: HOUSEHOLD_NAME_MAX_LENGTH })}`;

  let service: HouseholdService;
  let firestore: MockFirestoreService;
  let online: WritableSignal<boolean>;
  let user: WritableSignal<User | null>;
  let invite: jasmine.Spy;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;

  let profile$: Subject<Partial<User> | null>;
  let household$: Subject<Household | null>;
  let own$: Subject<OwnMember>;
  let members$: Subject<HouseholdMember[]>;
  let received$: Subject<HouseholdInvite[]>;
  let sent$: Subject<HouseholdInvite[]>;
  let otherProfile$: Subject<Partial<User> | null>;
  let otherReceived$: Subject<HouseholdInvite[]>;
  let membersWhere: Where[];

  const userFixture = (overrides: Partial<User> = {}): User => ({
    id: ME,
    email: 'me@example.test',
    displayName: 'Me',
    photoURL: 'https://lh3.googleusercontent.com/a/me',
    createdAt: CREATED,
    lastLoginAt: CREATED,
    preferences: { baseCurrency: 'USD', language: 'en' },
    ...overrides
  }) as User;

  // Shown as the profile shows the account, so a live member document here
  // has nothing for the service to bring into line.
  const member = (overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
    uid: ME,
    displayName: 'Me',
    photoURL: 'https://lh3.googleusercontent.com/a/me',
    role: 'member',
    since: CREATED,
    joinedAt: CREATED,
    ...overrides
  });

  const householdDoc = (overrides: Partial<Household> = {}): Household => ({
    id: HID,
    name: 'Home',
    ownerId: 'alex',
    createdAt: CREATED,
    ...overrides
  });

  const inviteDoc = (overrides: Partial<HouseholdInvite> = {}): HouseholdInvite => ({
    id: `${HID}_${ME}`,
    householdId: HID,
    householdCreatedAt: CREATED,
    householdName: 'Home',
    inviterUid: 'alex',
    inviterName: 'Alex',
    inviteeUid: ME,
    inviteeEmail: 'me@example.test',
    locale: 'en',
    createdAt: CREATED,
    expiresAt: FUTURE,
    mail: 'sent',
    ...overrides
  });

  const firebaseError = (code: string, details?: unknown) =>
    Object.assign(new Error(code), { name: 'FirebaseError', code, details });

  beforeEach(() => {
    online = signal(true);
    user = signal<User | null>(userFixture());
    invite = jasmine.createSpy('inviteToHousehold').and.resolveTo({ inviteId: `${HID}_sam`, mail: 'sent' });

    TestBed.configureTestingModule({
      providers: [
        HouseholdService,
        { provide: FirestoreService, useClass: MockFirestoreService },
        {
          provide: AuthService,
          useValue: { userId: computed(() => user()?.id ?? null), currentUser: user }
        },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: HOUSEHOLD_INVITE_CALLABLE, useValue: invite }
      ]
    });
    firestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    service = TestBed.inject(HouseholdService);

    profile$ = new Subject();
    household$ = new Subject();
    own$ = new Subject();
    members$ = new Subject();
    received$ = new Subject();
    sent$ = new Subject();
    otherProfile$ = new Subject();
    otherReceived$ = new Subject();
    membersWhere = [];

    spyOn(firestore, 'subscribeToDocument').and.callFake(((path: string) => {
      if (path === `users/${ME}`) return profile$;
      if (path === `users/${OTHER}`) return otherProfile$;
      if (path === `households/${HID}`) return household$;
      throw new Error(`unexpected document listener: ${path}`);
    }) as never);
    const ownListener = (path: string): Observable<OwnMember> => {
      if (path === `households/${HID}/members/${ME}`) return own$;
      throw new Error(`unexpected metadata listener: ${path}`);
    };
    spyOn(firestore, 'subscribeToDocumentWithMetadata')
      .and.callFake(ownListener as MockFirestoreService['subscribeToDocumentWithMetadata']);
    spyOn(firestore, 'subscribeToCollection').and.callFake(((path: string, options?: { where?: Where }) => {
      const where = options?.where;
      if (path === 'householdInvites' && where?.[0]?.field === 'inviteeUid' && where[0].value === ME) {
        return received$;
      }
      if (path === 'householdInvites' && where?.[0]?.field === 'inviteeUid' && where[0].value === OTHER) {
        return otherReceived$;
      }
      if (path === 'householdInvites' && where?.[0]?.field === 'inviterUid' && where[0].value === ME) {
        return sent$;
      }
      if (path === `households/${HID}/members`) {
        membersWhere.push(where);
        return members$;
      }
      throw new Error(`unexpected collection listener: ${path}`);
    }) as never);

    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  });

  /** Connects and drives the listeners to a live membership. */
  function goLive(role: HouseholdRole = 'member'): void {
    service.connect();
    profile$.next({ id: ME, householdId: HID });
    own$.next(confirmed(member({ role })));
    household$.next(householdDoc({ ownerId: role === 'owner' ? ME : 'alex' }));
    members$.next(role === 'owner'
      ? [member({ role: 'owner' }), member({ uid: 'sam', displayName: 'Sam', joinedAt: LATER })]
      : [member({ joinedAt: LATER }), member({ uid: 'alex', displayName: 'Alex', role: 'owner' })]);
  }

  /**
   * Replaces runTransaction with a recorder: each call is one commit, its
   * writes in order. `refuse` may reject a commit by its writes, which then
   * applies nothing, as a refused commit does. A transaction read answers
   * from `docs` by path, and an Error there rejects the read with it; any
   * other read fails the case.
   */
  function recordCommits(refuse?: (writes: Write[]) => unknown, docs: Record<string, unknown> = {}): Write[][] {
    const commits: Write[][] = [];
    spyOn(firestore, 'runTransaction').and.callFake((async (
      update: (tx: unknown) => Promise<unknown>
    ) => {
      const writes: Write[] = [];
      const result = await update({
        get: (ref: { path: string }) => {
          if (!(ref.path in docs)) return Promise.reject(new Error(`unexpected read of ${ref.path}`));
          const doc = docs[ref.path];
          return doc instanceof Error
            ? Promise.reject(doc)
            : Promise.resolve({ exists: () => doc !== null, data: () => doc });
        },
        set: (ref: { path: string }, data: unknown) => writes.push({ op: 'set', path: ref.path, data }),
        update: (ref: { path: string }, data: unknown) => writes.push({ op: 'update', path: ref.path, data }),
        delete: (ref: { path: string }) => writes.push({ op: 'delete', path: ref.path })
      });
      const refusal = refuse?.(writes);
      if (refusal) throw refusal;
      commits.push(writes);
      return result;
    }) as never);
    return commits;
  }

  const shape = (commits: Write[][]) => commits.map(writes => writes.map(w => `${w.op} ${w.path}`));

  /** Lets a write the service did not await settle. */
  const fixtureSettled = () => new Promise<void>(resolve => setTimeout(resolve));

  /**
   * Answers server reads from a queue per query: the collection path plus
   * the first where field. Each call takes the next answer; an exhausted
   * queue answers empty.
   */
  function serveServerReads(answers: Record<string, unknown[][]>): jasmine.Spy {
    return spyOn(firestore, 'getCollectionFromServer').and.callFake((async (
      path: string,
      options?: { where?: Where }
    ) => {
      const key = `${path}?${options?.where?.[0]?.field ?? ''}`;
      return answers[key]?.shift() ?? [];
    }) as never);
  }

  /**
   * Answers one-shot document reads by path. A `refused` path rejects with
   * permission-denied, as the rules answer a household the caller cannot
   * read; any other path reads as absent.
   */
  function readsFor(docs: Record<string, unknown>, refused: string[] = []): jasmine.Spy {
    return spyOn(firestore, 'getDocument').and.callFake((async (path: string) => {
      if (refused.includes(path)) throw firebaseError('permission-denied');
      return docs[path] ?? null;
    }) as never);
  }

  const serviceWarnings = () =>
    consoleWarn.calls.allArgs().filter(args => String(args[0]).startsWith('[HouseholdService]'));

  /**
   * The service logs only through `[HouseholdService]` lines. Other warnings
   * are not its own: @angular/fire prints a one-time advisory to whichever
   * case first calls a wrapped Firebase function outside an injection
   * context, so a bare "never warned" would depend on the order cases run in.
   */
  function expectNoConsoleNoise(): void {
    expect(consoleError).not.toHaveBeenCalled();
    expect(serviceWarnings()).toEqual([]);
  }

  describe('listeners', () => {
    it('opens nothing until connect(), and only the last disconnect() closes everything', () => {
      expect(firestore.subscribeToDocument).not.toHaveBeenCalled();
      expect(firestore.subscribeToCollection).not.toHaveBeenCalled();
      expect(firestore.subscribeToDocumentWithMetadata).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');

      goLive('owner');
      service.connect();

      expect(firestore.subscribeToDocument).toHaveBeenCalledWith(`users/${ME}`);
      expect((firestore.subscribeToDocument as jasmine.Spy).calls.allArgs()
        .filter(([path]) => path === `users/${ME}`).length).toBe(1);
      expect(service.status()).toBe('member');

      service.disconnect();
      expect(profile$.observed).toBeTrue();
      expect(service.status()).toBe('member');

      service.disconnect();
      for (const subject of [profile$, household$, own$, members$, received$, sent$]) {
        expect(subject.observed).toBeFalse();
      }
      expect(service.status()).toBe('idle');
      expect(service.household()).toBeNull();
    });

    it('attaches the household and members listeners only once its own member document is live', () => {
      service.connect();
      expect(service.status()).toBe('loading');

      profile$.next({ id: ME, householdId: HID });
      expect(firestore.subscribeToDocumentWithMetadata).toHaveBeenCalledOnceWith(`households/${HID}/members/${ME}`);
      expect(firestore.subscribeToDocument).not.toHaveBeenCalledWith(`households/${HID}`);
      expect(service.status()).toBe('loading');

      // A member document whose since is not a Timestamp attaches nothing.
      own$.next(cached(member({ since: null as unknown as Timestamp })));
      expect(firestore.subscribeToDocument).not.toHaveBeenCalledWith(`households/${HID}`);

      own$.next(confirmed(member()));
      expect(firestore.subscribeToDocument).toHaveBeenCalledWith(`households/${HID}`);
      expect(membersWhere).toEqual([[{ field: 'since', op: '==', value: CREATED }]]);
      expect(service.status()).toBe('loading');

      household$.next(householdDoc());
      // The household alone is not the member view: its members are part of it.
      expect(service.status()).toBe('loading');
      expect(service.household()).toBeNull();

      members$.next([member({ joinedAt: LATER }), member({ uid: 'alex', displayName: 'Alex', role: 'owner' })]);
      expect(service.status()).toBe('member');
      expect(service.household()?.name).toBe('Home');
      expect(service.ownMember()?.role).toBe('member');
      expect(service.isOwner()).toBeFalse();
      expect(service.members().map(m => m.uid)).toEqual(['alex', ME]);

      // A metadata-only emission of the same membership re-attaches nothing.
      own$.next(cached(member()));
      expect(membersWhere.length).toBe(1);
      expectNoConsoleNoise();
    });

    it('reads as member once the household and its members have answered, in either order', () => {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(confirmed(member()));

      members$.next([member(), member({ uid: 'alex', role: 'owner' })]);
      expect(service.status()).toBe('loading');
      expect(service.members()).toEqual([]);

      household$.next(householdDoc());
      expect(service.status()).toBe('member');
      expect(service.members().length).toBe(2);
    });

    it('lists the invites addressed to the account newest first, member or not', () => {
      service.connect();
      received$.next([
        inviteDoc({ id: 'old_me', createdAt: CREATED }),
        inviteDoc({ id: 'new_me', createdAt: LATER })
      ]);
      profile$.next({ id: ME });

      expect(service.status()).toBe('none');
      expect(service.receivedInvites().map(i => i.id)).toEqual(['new_me', 'old_me']);
    });

    it('opens the sent-invites listener for an owner only, showing this household\'s newest first', () => {
      goLive('owner');
      expect(firestore.subscribeToCollection).toHaveBeenCalledWith('householdInvites', {
        where: [{ field: 'inviterUid', op: '==', value: ME }]
      });

      sent$.next([
        inviteDoc({ id: `${HID}_kai`, inviterUid: ME, inviteeUid: 'kai', createdAt: CREATED }),
        inviteDoc({ id: 'gone_sam', householdId: 'gone', inviterUid: ME, inviteeUid: 'sam', createdAt: LATER }),
        inviteDoc({ id: `${HID}_sam`, inviterUid: ME, inviteeUid: 'sam', createdAt: LATER })
      ]);
      expect(service.isOwner()).toBeTrue();
      expect(service.sentInvites().map(i => i.id)).toEqual([`${HID}_sam`, `${HID}_kai`]);
    });

    it('opens no sent-invites listener for a member', () => {
      goLive('member');
      expect(firestore.subscribeToCollection).not.toHaveBeenCalledWith('householdInvites', {
        where: [{ field: 'inviterUid', op: '==', value: ME }]
      });
      expect(service.sentInvites()).toEqual([]);
    });

    it('tears the membership listeners down silently when the household listener is refused', () => {
      goLive();
      household$.error(firebaseError('permission-denied'));

      expect(service.status()).toBe('none');
      expect(service.household()).toBeNull();
      expect(service.members()).toEqual([]);
      expect(members$.observed).toBeFalse();
      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('tears the membership listeners down silently when the members listener is refused', () => {
      goLive();
      members$.error(firebaseError('permission-denied'));

      expect(service.status()).toBe('none');
      expect(household$.observed).toBeFalse();
      expectNoConsoleNoise();
    });

    it('reads as none, not loading, when the members listener is refused before it answered', () => {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(confirmed(member()));
      household$.next(householdDoc());

      members$.error(firebaseError('permission-denied'));

      expect(service.status()).toBe('none');
      expectNoConsoleNoise();
    });

    it('keeps the last view through a household listener failure that is not a refusal, and attaches again on the next own emission', () => {
      goLive();
      const failure = firebaseError('internal');
      household$.error(failure);

      expect(service.status()).toBe('member');
      expect(service.household()?.name).toBe('Home');
      expect(service.members().length).toBe(2);
      expect(members$.observed).toBeFalse();
      expect(service.lostAccess()).toBeFalse();
      expect(serviceWarnings()).toEqual([[jasmine.stringMatching(/^\[HouseholdService\]/), failure]]);

      household$ = new Subject();
      members$ = new Subject();
      own$.next(cached(member()));

      expect(household$.observed).toBeTrue();
      expect(members$.observed).toBeTrue();
      expect(membersWhere.length).toBe(2);
      household$.next(householdDoc({ name: 'Flat' }));
      members$.next([member()]);
      expect(service.status()).toBe('member');
      expect(service.household()?.name).toBe('Flat');
    });

    it('keeps the last view through a members listener failure that is not a refusal', () => {
      goLive();
      members$.error(firebaseError('resource-exhausted'));

      expect(service.status()).toBe('member');
      expect(service.members().length).toBe(2);
      expect(household$.observed).toBeFalse();
      expect(serviceWarnings().length).toBe(1);
    });

    it('reads as unavailable, not none, when a listener fails before the member view was ever heard', () => {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(confirmed(member()));
      household$.next(householdDoc());

      members$.error(firebaseError('internal'));

      expect(service.status()).toBe('unavailable');
      expect(service.household()).toBeNull();
      expect(service.members()).toEqual([]);
      expect(household$.observed).toBeFalse();
      expect(service.lostAccess()).toBeFalse();

      // The next own emission attaches afresh and the view recovers.
      household$ = new Subject();
      members$ = new Subject();
      own$.next(cached(member()));
      expect(service.status()).toBe('loading');
      household$.next(householdDoc());
      members$.next([member()]);
      expect(service.status()).toBe('member');
    });

    it('boots silently with a stale pointer and reports no lost access', () => {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(confirmed(null));

      expect(service.status()).toBe('none');
      expect(service.lostAccess()).toBeFalse();
      expect(firestore.subscribeToDocument).not.toHaveBeenCalledWith(`households/${HID}`);
      expectNoConsoleNoise();
    });

    it('never sets lostAccess on a cache null, and sets it on a server-confirmed absence', () => {
      goLive();

      own$.next(cached(null));
      expect(service.lostAccess()).toBeFalse();
      expect(service.status()).toBe('member');

      own$.next(confirmed(null));
      expect(service.lostAccess()).toBeTrue();
      expect(service.status()).toBe('none');
      expect(household$.observed).toBeFalse();
      expect(members$.observed).toBeFalse();
      expectNoConsoleNoise();

      // Seen live again (re-invited and accepted), the notice lifts.
      own$.next(confirmed(member()));
      expect(service.lostAccess()).toBeFalse();
    });

    it('does not take a pending local delete for a server-confirmed absence', () => {
      goLive();

      own$.next({ data: null, fromCache: false, hasPendingWrites: true });
      expect(service.lostAccess()).toBeFalse();
      expect(service.status()).toBe('member');
      expect(household$.observed).toBeTrue();

      own$.next(confirmed(null));
      expect(service.lostAccess()).toBeTrue();
    });

    it('treats an offline boot with nothing cached as no membership, without deciding it was lost', () => {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(cached(null));

      expect(service.status()).toBe('none');
      expect(service.lostAccess()).toBeFalse();
    });

    it('closes the old membership when the pointer goes away, without calling it lost', () => {
      goLive();
      profile$.next({ id: ME });

      expect(own$.observed).toBeFalse();
      expect(household$.observed).toBeFalse();
      expect(service.status()).toBe('none');
      expect(service.lostAccess()).toBeFalse();
    });

    it('leaves the owner\'s own listeners quiet through a dissolve', async () => {
      goLive('owner');
      serveServerReads({
        [`households/${HID}/members?since`]: [[member({ role: 'owner' }), member({ uid: 'sam' })]]
      });
      recordCommits();

      await service.dissolve();
      household$.error(firebaseError('permission-denied'));
      members$.error(firebaseError('permission-denied'));
      own$.next(confirmed(null));
      profile$.next({ id: ME });

      expect(service.lostAccess()).toBeFalse();
      expect(service.status()).toBe('none');
      expectNoConsoleNoise();
    });

    it('does not report its own leaving as lost access, whichever listener hears first', async () => {
      goLive('member');
      recordCommits();

      await service.leave();
      own$.next(confirmed(null));
      profile$.next({ id: ME });

      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('follows the account while connected: a sign-out closes the old account\'s listeners, the next account gets its own', () => {
      goLive('member');
      service.connect();

      user.set(null);
      TestBed.tick();

      for (const subject of [profile$, household$, own$, members$, received$]) {
        expect(subject.observed).withContext('the signed-out account\'s listeners').toBeFalse();
      }
      expect(service.status()).toBe('none');
      expect(service.household()).toBeNull();
      expect(service.receivedInvites()).toEqual([]);
      expect(service.lostAccess()).toBeFalse();

      user.set(userFixture({ id: OTHER }));
      TestBed.tick();

      expect(firestore.subscribeToDocument).toHaveBeenCalledWith(`users/${OTHER}`);
      expect(firestore.subscribeToCollection).toHaveBeenCalledWith('householdInvites', {
        where: [{ field: 'inviteeUid', op: '==', value: OTHER }]
      });
      expect(service.status()).toBe('loading');
      otherProfile$.next({ id: OTHER });
      expect(service.status()).toBe('none');
      expect(profile$.observed).toBeFalse();

      // Both connections survived the switch: only the second disconnect closes.
      service.disconnect();
      expect(otherProfile$.observed).toBeTrue();
      service.disconnect();
      expect(otherProfile$.observed).toBeFalse();
      expect(otherReceived$.observed).toBeFalse();
      expect(service.status()).toBe('idle');
    });

    it('opens nothing on an account change while no page is connected', () => {
      user.set(null);
      TestBed.tick();
      user.set(userFixture({ id: OTHER }));
      TestBed.tick();

      expect(firestore.subscribeToDocument).not.toHaveBeenCalled();
      expect(firestore.subscribeToCollection).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
    });
  });

  // The member document holds how the others see the account, copied from
  // its profile at joining; the profile can be renamed at any time after.
  describe('how the account is shown to the others', () => {
    const OWN_PATH = `households/${HID}/members/${ME}`;

    function attach(stored: OwnMember): void {
      service.connect();
      profile$.next({ id: ME, householdId: HID });
      own$.next(stored);
    }

    it('brings its member document into line with the profile once the server confirms the document', async () => {
      const commits = recordCommits();

      attach(confirmed(member({ displayName: 'Old name' })));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([[{
        op: 'update',
        path: OWN_PATH,
        data: { displayName: 'Me', photoURL: 'https://lh3.googleusercontent.com/a/me' }
      }]]);
    });

    it('writes nothing when the document already shows the profile', async () => {
      const commits = recordCommits();

      attach(confirmed(member()));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([]);
    });

    it('follows a rename made while the page is open', async () => {
      const commits = recordCommits();
      attach(confirmed(member()));
      TestBed.tick();

      user.set(userFixture({ displayName: 'Samuel' }));
      TestBed.tick();
      await fixtureSettled();

      expect(commits.map(writes => writes.map(w => w.data))).toEqual([[
        { displayName: 'Samuel', photoURL: 'https://lh3.googleusercontent.com/a/me' }
      ]]);
    });

    it('removes a picture the rules would refuse rather than keeping the old one', async () => {
      user.set(userFixture({ photoURL: 'https://example.test/me.png' }));
      const commits = recordCommits();

      attach(confirmed(member()));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([[{ op: 'update', path: OWN_PATH, data: { displayName: 'Me', photoURL: deleteField() } }]]);
    });

    it('compares the clipped name the rules take, so a long one is written once, not at every answer', async () => {
      user.set(userFixture({ displayName: 'n'.repeat(150) }));
      const commits = recordCommits();

      attach(confirmed(member({ displayName: 'n'.repeat(100) })));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([]);
    });

    it('waits for the server: a document the cache answered writes nothing', async () => {
      const commits = recordCommits();

      attach(cached(member({ displayName: 'Old name' })));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([]);
    });

    it('writes nothing offline, and catches up once the connection returns', async () => {
      online.set(false);
      const commits = recordCommits();
      attach(confirmed(member({ displayName: 'Old name' })));
      TestBed.tick();
      await fixtureSettled();
      expect(commits).toEqual([]);

      online.set(true);
      TestBed.tick();
      await fixtureSettled();

      expect(commits.length).toBe(1);
    });

    it('asks once: a refused write is not tried again at every answer, and says nothing', async () => {
      const commits = recordCommits(() => firebaseError('permission-denied'));
      const transactions = firestore.runTransaction as jasmine.Spy;

      attach(confirmed(member({ displayName: 'Old name' })));
      TestBed.tick();
      await Promise.resolve();
      own$.next(confirmed(member({ displayName: 'Old name' })));
      TestBed.tick();
      await fixtureSettled();

      expect(transactions).toHaveBeenCalledTimes(1);
      expect(commits).toEqual([]);
      expectNoConsoleNoise();
    });

    it('writes nothing for a membership the page no longer holds', async () => {
      const commits = recordCommits();
      attach(confirmed(member({ displayName: 'Old name' })));
      service.disconnect();

      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([]);
    });
  });

  describe('forming and joining', () => {
    it('forms a household, its owner document and the pointer in one commit, stamped with the server time', async () => {
      const householdId = await service.create('  Home  ');

      expect(householdId).toBeTruthy();
      expect(firestore.runTransactionSpy.calls.length).toBe(1);
      expect(firestore.txGetSpy.calls.length).toBe(0);
      expect(firestore.txSetSpy.calls.map(c => c.args)).toEqual([
        [`households/${householdId}`, { name: 'Home', ownerId: ME, createdAt: serverTimestamp() }],
        [`households/${householdId}/members/${ME}`, {
          uid: ME,
          displayName: 'Me',
          photoURL: 'https://lh3.googleusercontent.com/a/me',
          role: 'owner',
          since: serverTimestamp(),
          joinedAt: serverTimestamp()
        }]
      ]);
      expect(firestore.txUpdateSpy.calls.map(c => c.args)).toEqual([[`users/${ME}`, { householdId }]]);
      expect(firestore.txDeleteSpy.calls.length).toBe(0);
    });

    it('clips a long display name and leaves out a picture that is not https', async () => {
      user.set(userFixture({ displayName: 'n'.repeat(150), photoURL: 'http://lh3.googleusercontent.com/a/me' }));

      const householdId = await service.create('Home');

      const memberData = firestore.txSetSpy.calls
        .find(c => c.args[0] === `households/${householdId}/members/${ME}`)!.args[1] as Record<string, unknown>;
      expect(memberData['displayName']).toBe('n'.repeat(100));
      expect('photoURL' in memberData).toBeFalse();
    });

    it("leaves out a picture served from anywhere but Google's account-picture hosts, which the rules refuse", async () => {
      user.set(userFixture({ photoURL: 'https://example.test/me.png' }));

      const householdId = await service.create('Home');

      const memberData = firestore.txSetSpy.calls
        .find(c => c.args[0] === `households/${householdId}/members/${ME}`)!.args[1] as Record<string, unknown>;
      expect('photoURL' in memberData).toBeFalse();
    });

    it('refuses an empty or over-long name before any write, and accepts sixty characters', async () => {
      await expectAsync(service.create('   ')).toBeRejectedWithError(HouseholdError, NAME_ERROR);
      await expectAsync(service.create('n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1)))
        .toBeRejectedWithError(HouseholdError, NAME_ERROR);
      expect(firestore.runTransactionSpy.calls.length).toBe(0);

      await expectAsync(service.create('n'.repeat(HOUSEHOLD_NAME_MAX_LENGTH))).toBeResolved();
    });

    it('accepts by reading only the invite and the profile, copying the invite generation into since', async () => {
      const stored = inviteDoc();
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, stored);
      firestore.setMockDocument(`users/${ME}`, userFixture());

      await service.accept(HID);

      expect(firestore.txGetSpy.calls.map(c => c.args[0])).toEqual([
        `householdInvites/${HID}_${ME}`,
        `users/${ME}`
      ]);
      const [path, data] = firestore.txSetSpy.calls[0].args as [string, Record<string, unknown>];
      expect(path).toBe(`households/${HID}/members/${ME}`);
      expect(data).toEqual({
        uid: ME,
        displayName: 'Me',
        photoURL: 'https://lh3.googleusercontent.com/a/me',
        role: 'member',
        since: CREATED,
        joinedAt: serverTimestamp(),
        inviteId: `${HID}_${ME}`
      });
      expect(data['since']).toBe(stored.householdCreatedAt);
      expect(firestore.txDeleteSpy.calls.map(c => c.args[0])).toEqual([`householdInvites/${HID}_${ME}`]);
      expect(firestore.txUpdateSpy.calls.map(c => c.args)).toEqual([[`users/${ME}`, { householdId: HID }]]);
    });

    it("answers the household's name as the new member now reads it, not the invite's copy", async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ householdName: 'Home' }));
      firestore.setMockDocument(`users/${ME}`, userFixture());
      const reads = readsFor({ [`households/${HID}`]: householdDoc({ name: 'Renamed home' }) });

      expect(await service.accept(HID)).toBe('Renamed home');
      expect(reads).toHaveBeenCalledOnceWith(`households/${HID}`);
    });

    it("answers the invite's copy of the name when the household cannot be read after joining", async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ householdName: 'Home' }));
      firestore.setMockDocument(`users/${ME}`, userFixture());
      spyOn(firestore, 'getDocument').and.rejectWith(firebaseError('unavailable'));

      expect(await service.accept(HID)).toBe('Home');
    });

    it('leaves expiry to the rules: an invite this device\'s clock calls expired still joins when the server admits it', async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ expiresAt: PAST }));
      firestore.setMockDocument(`users/${ME}`, userFixture());

      await service.accept(HID);

      expect(firestore.txSetSpy.calls.map(c => c.args[0])).toEqual([`households/${HID}/members/${ME}`]);
    });

    describe('a refused join', () => {
      const INVITE_PATH = `householdInvites/${HID}_${ME}`;
      const refused = () => firebaseError('permission-denied');

      it('says expired when the invite is past its expiry by this device\'s clock', async () => {
        readsFor({});
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: PAST }), [`users/${ME}`]: userFixture() });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('says expired when the invite is minutes from expiry, as a clock running slow would see it', async () => {
        readsFor({});
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: SOON }), [`users/${ME}`]: userFixture() });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('says the invite is gone when its expiry is well ahead', async () => {
        readsFor({});
        recordCommits(refused, { [INVITE_PATH]: inviteDoc(), [`users/${ME}`]: userFixture() });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');
      });

      it('says the account already belongs to a household when its pointer names a live one', async () => {
        const reads = readsFor({
          [`households/other/members/${ME}`]: member({ role: 'owner' }),
          ['households/other']: householdDoc({ id: 'other', ownerId: ME })
        });
        recordCommits(refused, {
          [INVITE_PATH]: inviteDoc({ expiresAt: PAST }),
          [`users/${ME}`]: userFixture({ householdId: 'other' })
        });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.alreadyMember');
        expect(reads.calls.allArgs()).toEqual([[`households/other/members/${ME}`], ['households/other']]);
      });

      it('does not blame a stale pointer: a membership whose household is gone falls back to the invite', async () => {
        readsFor({ [`households/other/members/${ME}`]: member() }, ['households/other']);
        recordCommits(refused, {
          [INVITE_PATH]: inviteDoc(),
          [`users/${ME}`]: userFixture({ householdId: 'other' })
        });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');
      });

      it('falls back to the invite when the follow-up reads fail', async () => {
        spyOn(firestore, 'getDocument').and.rejectWith(firebaseError('unavailable'));
        recordCommits(refused, {
          [INVITE_PATH]: inviteDoc({ expiresAt: PAST }),
          [`users/${ME}`]: userFixture({ householdId: 'other' })
        });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('passes a failure that is not a refusal through the usual mapping', async () => {
        const reads = readsFor({});
        recordCommits(() => firebaseError('unavailable'), {
          [INVITE_PATH]: inviteDoc({ expiresAt: PAST }),
          [`users/${ME}`]: userFixture()
        });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
        expect(reads).not.toHaveBeenCalled();
      });
    });

    it('refuses to join while connected to a live membership, before any transaction', async () => {
      goLive('member');

      await expectAsync(service.accept('other')).toBeRejectedWithError(HouseholdError, 'household.errors.alreadyMember');
      expect(firestore.runTransactionSpy.calls.length).toBe(0);
    });

    it('calls an invite that is no longer there withdrawn, refused read or missing', async () => {
      firestore.setMockDocument(`users/${ME}`, userFixture());
      await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');

      // A get of a missing invite is refused by the rules rather than empty.
      spyOn(firestore, 'runTransaction').and.callFake((async (update: (tx: unknown) => Promise<unknown>) =>
        update({ get: () => Promise.reject(firebaseError('permission-denied')) })) as never);
      await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');
      expect(firestore.txSetSpy.calls.length).toBe(0);
    });

    it('declines by deleting the invite addressed to the account', async () => {
      const commits = recordCommits();

      await service.decline(HID);

      expect(shape(commits)).toEqual([[`delete householdInvites/${HID}_${ME}`]]);
    });
  });

  describe('managing', () => {
    it('revokes a sent invite', async () => {
      goLive('owner');
      const commits = recordCommits();

      await service.revoke(`${HID}_sam`);

      expect(shape(commits)).toEqual([[`delete householdInvites/${HID}_sam`]]);
    });

    it('treats a refused revoke or decline as an invite already consumed or withdrawn', async () => {
      goLive('owner');
      recordCommits(() => firebaseError('permission-denied'));

      await expectAsync(service.revoke(`${HID}_sam`)).toBeResolved();
      await expectAsync(service.decline('elsewhere')).toBeResolved();
    });

    it('renames with the name and updatedAt only', async () => {
      goLive('owner');
      const commits = recordCommits();

      await service.rename(' Flat ');

      expect(commits).toEqual([[{
        op: 'update',
        path: `households/${HID}`,
        data: { name: 'Flat', updatedAt: serverTimestamp() }
      }]]);
      await expectAsync(service.rename('')).toBeRejectedWithError(HouseholdError, NAME_ERROR);
    });

    it('removes one member in a commit of its own', async () => {
      goLive('owner');
      const commits = recordCommits();

      await service.remove('sam');

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/sam`]]);
    });

    it('leaves by deleting its own member document and clearing the pointer in one commit', async () => {
      goLive('member');
      const commits = recordCommits();

      await service.leave();

      expect(commits).toEqual([[
        { op: 'delete', path: `households/${HID}/members/${ME}` },
        { op: 'update', path: `users/${ME}`, data: { householdId: deleteField() } }
      ]]);
    });

    it('keeps the owner from leaving or removing itself, and a member from managing', async () => {
      goLive('owner');
      await expectAsync(service.leave()).toBeRejectedWithError(HouseholdError, 'household.errors.ownerLeaves');
      await expectAsync(service.remove(ME)).toBeRejectedWithError(HouseholdError, 'household.errors.ownerLeaves');
      service.disconnect();

      goLive('member');
      await expectAsync(service.remove('alex')).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');
      await expectAsync(service.revoke(`${HID}_sam`)).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');
      await expectAsync(service.rename('Flat')).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');
      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');
      await expectAsync(service.invite('sam@example.test')).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');

      expect(firestore.runTransactionSpy.calls.length).toBe(0);
      expect(invite).not.toHaveBeenCalled();
    });

    it('refuses a household action with no live membership', async () => {
      service.connect();
      profile$.next({ id: ME });

      await expectAsync(service.leave()).toBeRejectedWithError(HouseholdError, 'errors.generic');
      await expectAsync(service.invite('sam@example.test')).toBeRejectedWithError(HouseholdError, 'errors.generic');
      expect(firestore.runTransactionSpy.calls.length).toBe(0);
    });

    it('dissolves: the sent invites first, the other members in chunks of four, then the household, its owner document and the pointer', async () => {
      goLive('owner');
      const others = ['a', 'b', 'c', 'd', 'e', 'f'];
      const reads = serveServerReads({
        'householdInvites?inviterUid': [[inviteDoc({ id: `${HID}_kai` }), inviteDoc({ id: `${HID}_lee` })]],
        [`households/${HID}/members?since`]: [[
          member({ role: 'owner' }),
          ...others.map(uid => member({ uid }))
        ]]
      });
      const commits = recordCommits();

      await service.dissolve();

      expect(reads.calls.allArgs()).toEqual([
        ['householdInvites', { where: [{ field: 'inviterUid', op: '==', value: ME }] }],
        [`households/${HID}/members`, { where: [{ field: 'since', op: '==', value: CREATED }] }]
      ]);
      expect(shape(commits)).toEqual([
        [`delete householdInvites/${HID}_kai`, `delete householdInvites/${HID}_lee`],
        ['a', 'b', 'c', 'd'].map(uid => `delete households/${HID}/members/${uid}`),
        ['e', 'f'].map(uid => `delete households/${HID}/members/${uid}`),
        [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update users/${ME}`]
      ]);
      expect(commits[3][2].data).toEqual({ householdId: deleteField() });
    });

    it('deletes a chunk of invites one by one when one of them is already gone', async () => {
      goLive('owner');
      serveServerReads({
        'householdInvites?inviterUid': [[inviteDoc({ id: `${HID}_kai` }), inviteDoc({ id: `${HID}_lee` })]]
      });
      // The kai invite was consumed meanwhile: any commit deleting it is refused.
      const commits = recordCommits(writes =>
        writes.some(w => w.path === `householdInvites/${HID}_kai`) ? firebaseError('permission-denied') : null);

      await service.dissolve();

      expect(shape(commits)).toEqual([
        [`delete householdInvites/${HID}_lee`],
        [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update users/${ME}`]
      ]);
    });

    const GONE = { [`households/${HID}`]: firebaseError('permission-denied') };
    const refusesTheHousehold = (writes: Write[]) =>
      writes.some(w => w.path === `households/${HID}`) ? firebaseError('permission-denied') : null;

    it('finishes a dissolve whose final commit finds the household gone, as a commit sent again after its answer was lost does', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(writes => {
        const refusal = refusesTheHousehold(writes);
        // The first delivery's deletions reach the listener as the resend
        // is refused.
        if (refusal) own$.next(confirmed(null));
        return refusal;
      }, GONE);
      // What a listener still attached to the household last heard.
      const getDocument = spyOn(firestore, 'getDocument').and.resolveTo(householdDoc() as never);

      await service.dissolve();

      expect(getDocument).not.toHaveBeenCalled();
      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`, `update users/${ME}`]]);
      expect(commits[0][1].data).toEqual({ householdId: deleteField() });
      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('finishes a dissolve another tab completed first, when the members read is the step refused', async () => {
      goLive('owner');
      spyOn(firestore, 'getCollectionFromServer').and.callFake((async (path: string) => {
        if (path === 'householdInvites') return [];
        throw firebaseError('permission-denied');
      }) as never);
      const commits = recordCommits(undefined, GONE);

      await service.dissolve();
      own$.next(confirmed(null));

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`, `update users/${ME}`]]);
      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('still fails a dissolve refused while its household is live, and leaves a later loss to be reported', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(refusesTheHousehold, { [`households/${HID}`]: householdDoc() });

      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdError, 'errors.generic');
      own$.next(confirmed(null));

      expect(commits).toEqual([]);
      expect(service.lostAccess()).toBeTrue();
    });

    it('keeps the refusal when whether the household is gone goes unanswered', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(refusesTheHousehold, { [`households/${HID}`]: firebaseError('unavailable') });

      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdError, 'errors.generic');
      expect(commits).toEqual([]);
    });

    it('does not take a dissolve cut off mid-way for one already done', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      recordCommits(writes =>
        writes.some(w => w.path === `households/${HID}`) ? firebaseError('unavailable') : null, GONE);

      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      // The final commit alone: nothing asked whether the household is gone.
      expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('invite', () => {
    const REASONS: [string, string, string][] = [
      ['unauthenticated', 'signed-out', 'household.errors.signedOut'],
      ['invalid-argument', 'email', 'household.errors.email'],
      ['invalid-argument', 'locale', 'household.errors.locale'],
      ['invalid-argument', 'household', 'household.errors.household'],
      ['permission-denied', 'not-owner', 'household.errors.notOwner'],
      ['failed-precondition', 'self', 'household.errors.self'],
      ['resource-exhausted', 'quota', 'household.errors.quota'],
      ['not-found', 'no-account', 'household.errors.noAccount'],
      ['already-exists', 'member', 'household.errors.member'],
      ['failed-precondition', 'full', 'household.errors.full'],
      ['failed-precondition', 'elsewhere', 'household.errors.elsewhere']
    ];

    it('sends the live household, the trimmed address and the app language to the callable', async () => {
      goLive('owner');

      const response = await service.invite('  sam@example.test ');

      expect(invite).toHaveBeenCalledOnceWith({ householdId: HID, email: 'sam@example.test', locale: 'en' });
      expect(response).toEqual({ inviteId: `${HID}_sam`, mail: 'sent' });
    });

    for (const [code, reason, key] of REASONS) {
      it(`says ${key} for the ${reason} refusal`, async () => {
        goLive('owner');
        invite.and.rejectWith(firebaseError(`functions/${code}`, { reason }));

        await expectAsync(service.invite('sam@example.test')).toBeRejectedWithError(HouseholdError, key);
      });
    }

    it('gives the generic copy to a code without a reason, a bare not-found included', async () => {
      goLive('owner');
      for (const code of ['not-found', 'permission-denied', 'internal', 'unavailable', 'deadline-exceeded']) {
        invite.and.rejectWith(firebaseError(`functions/${code}`));
        await expectAsync(service.invite('sam@example.test'))
          .withContext(code)
          .toBeRejectedWithError(HouseholdError, 'errors.generic');
      }
      invite.and.rejectWith(firebaseError('functions/failed-precondition', { reason: 'something-new' }));
      await expectAsync(service.invite('sam@example.test'))
        .toBeRejectedWithError(HouseholdError, 'errors.generic');
    });

    it('says offline when the connection dropped during the call', async () => {
      goLive('owner');
      invite.and.callFake(async () => {
        online.set(false);
        throw firebaseError('functions/internal');
      });

      await expectAsync(service.invite('sam@example.test'))
        .toBeRejectedWithError(HouseholdError, 'household.errors.offline');
    });
  });

  describe('offline', () => {
    it('refuses every write before a transaction, a read or the callable is touched', async () => {
      goLive('owner');
      online.set(false);
      const getDocument = spyOn(firestore, 'getDocument').and.callThrough();
      const serverReads = spyOn(firestore, 'getCollectionFromServer').and.callThrough();

      const attempts: [string, () => Promise<unknown>][] = [
        ['create', () => service.create('Home')],
        ['accept', () => service.accept(HID)],
        ['decline', () => service.decline(HID)],
        ['invite', () => service.invite('sam@example.test')],
        ['revoke', () => service.revoke(`${HID}_sam`)],
        ['rename', () => service.rename('Flat')],
        ['remove', () => service.remove('sam')],
        ['leave', () => service.leave()],
        ['dissolve', () => service.dissolve()],
        ['clearStalePointer', () => service.clearStalePointer()],
        ['deleteAll', () => service.deleteAll()]
      ];
      for (const [name, attempt] of attempts) {
        await expectAsync(attempt()).withContext(name)
          .toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      }

      expect(firestore.runTransactionSpy.calls.length).toBe(0);
      expect(invite).not.toHaveBeenCalled();
      expect(getDocument).not.toHaveBeenCalled();
      expect(serverReads).not.toHaveBeenCalled();
    });

    it('says offline for a Firestore unavailable or deadline-exceeded, and generic for a refusal', async () => {
      let failure = firebaseError('unavailable');
      spyOn(firestore, 'runTransaction').and.callFake((() => Promise.reject(failure)) as never);

      for (const [code, key] of [
        ['unavailable', 'household.errors.offline'],
        ['deadline-exceeded', 'household.errors.offline'],
        ['permission-denied', 'errors.generic']
      ]) {
        failure = firebaseError(code);
        await expectAsync(service.create('Home')).withContext(code).toBeRejectedWithError(HouseholdError, key);
      }
    });
  });

  describe('stale pointer', () => {
    it('clears a pointer whose member document is gone', async () => {
      readsFor({ [`users/${ME}`]: userFixture({ householdId: HID }) });
      const commits = recordCommits();

      expect(await service.clearStalePointer()).toBeTrue();
      expect(commits).toEqual([[{ op: 'update', path: `users/${ME}`, data: { householdId: deleteField() } }]]);
    });

    it('deletes an orphaned member document along with the pointer', async () => {
      readsFor({
        [`users/${ME}`]: userFixture({ householdId: HID }),
        [`households/${HID}/members/${ME}`]: member()
      }, [`households/${HID}`]);
      const commits = recordCommits();

      expect(await service.clearStalePointer()).toBeTrue();
      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`, `update users/${ME}`]]);
    });

    it('leaves a live membership alone', async () => {
      readsFor({
        [`users/${ME}`]: userFixture({ householdId: HID }),
        [`households/${HID}/members/${ME}`]: member(),
        [`households/${HID}`]: householdDoc()
      });
      const commits = recordCommits();

      expect(await service.clearStalePointer()).toBeFalse();
      expect(commits).toEqual([]);
    });

    it('does nothing without a pointer', async () => {
      readsFor({ [`users/${ME}`]: userFixture() });
      const commits = recordCommits();

      expect(await service.clearStalePointer()).toBeFalse();
      expect(commits).toEqual([]);
    });
  });

  describe('deleteAll', () => {
    it('dissolves an owner\'s household, then deletes the invites to and from the account', async () => {
      readsFor({
        [`users/${ME}`]: userFixture({ householdId: HID }),
        [`households/${HID}/members/${ME}`]: member({ role: 'owner' }),
        [`households/${HID}`]: householdDoc({ ownerId: ME })
      });
      const reads = serveServerReads({
        'householdInvites?inviterUid': [[inviteDoc({ id: `${HID}_kai` })]],
        [`households/${HID}/members?since`]: [[member({ role: 'owner' }), member({ uid: 'sam' })]],
        'householdInvites?inviteeUid': [[inviteDoc({ id: `other_${ME}`, householdId: 'other' })]]
      });
      const commits = recordCommits();

      await service.deleteAll();

      expect(shape(commits)).toEqual([
        [`delete householdInvites/${HID}_kai`],
        [`delete households/${HID}/members/sam`],
        [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update users/${ME}`],
        [`delete householdInvites/other_${ME}`]
      ]);
      expect(reads.calls.allArgs()).toContain(
        ['householdInvites', { where: [{ field: 'inviteeUid', op: '==', value: ME }] }]);
    });

    it('leaves a member\'s household, then deletes the invites addressed to it', async () => {
      const reads = readsFor({
        [`users/${ME}`]: userFixture({ householdId: HID }),
        [`households/${HID}/members/${ME}`]: member()
      });
      serveServerReads({
        'householdInvites?inviteeUid': [[inviteDoc({ id: `other_${ME}`, householdId: 'other' })]]
      });
      const commits = recordCommits();

      await service.deleteAll();

      expect(shape(commits)).toEqual([
        [`delete households/${HID}/members/${ME}`, `update users/${ME}`],
        [`delete householdInvites/other_${ME}`]
      ]);
      expect(reads).not.toHaveBeenCalledWith(`households/${HID}`);
    });

    it('clears a stale pointer', async () => {
      readsFor({ [`users/${ME}`]: userFixture({ householdId: HID }) });
      serveServerReads({});
      const commits = recordCommits();

      await service.deleteAll();

      expect(shape(commits)).toEqual([[`update users/${ME}`]]);
    });

    it('deletes an owner document whose household is already gone, with the pointer', async () => {
      readsFor({
        [`users/${ME}`]: userFixture({ householdId: HID }),
        [`households/${HID}/members/${ME}`]: member({ role: 'owner' })
      }, [`households/${HID}`]);
      serveServerReads({});
      const commits = recordCommits();

      await service.deleteAll();

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`, `update users/${ME}`]]);
    });

    it('writes nothing with no household and no invites', async () => {
      readsFor({ [`users/${ME}`]: userFixture() });
      const reads = serveServerReads({});
      const commits = recordCommits();

      await service.deleteAll();

      expect(commits).toEqual([]);
      expect(reads.calls.allArgs()).toEqual([
        ['householdInvites', { where: [{ field: 'inviteeUid', op: '==', value: ME }] }],
        ['householdInvites', { where: [{ field: 'inviterUid', op: '==', value: ME }] }]
      ]);
    });
  });

  describe('signed out', () => {
    it('throws User not authenticated from every method', async () => {
      user.set(null);
      const attempts: [string, () => Promise<unknown>][] = [
        ['create', () => service.create('Home')],
        ['accept', () => service.accept(HID)],
        ['decline', () => service.decline(HID)],
        ['invite', () => service.invite('sam@example.test')],
        ['revoke', () => service.revoke(`${HID}_sam`)],
        ['rename', () => service.rename('Flat')],
        ['remove', () => service.remove('sam')],
        ['leave', () => service.leave()],
        ['dissolve', () => service.dissolve()],
        ['clearStalePointer', () => service.clearStalePointer()],
        ['deleteAll', () => service.deleteAll()]
      ];
      for (const [name, attempt] of attempts) {
        await expectAsync(attempt()).withContext(name).toBeRejectedWithError('User not authenticated');
      }
      expect(firestore.runTransactionSpy.calls.length).toBe(0);
    });

    it('connects to nothing without a user', () => {
      user.set(null);
      service.connect();

      expect(firestore.subscribeToDocument).not.toHaveBeenCalled();
      expect(firestore.subscribeToCollection).not.toHaveBeenCalled();
      expect(service.status()).toBe('none');
    });
  });
});
