import { TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, Subject, map, merge } from 'rxjs';
import { Timestamp, deleteField, serverTimestamp } from '@angular/fire/firestore';
import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdCleanupError,
  HouseholdError,
  HouseholdPurgeError,
  HouseholdService,
  householdNameValid,
  householdNameValidator,
  householdSelectionKey,
  inviteEmailValid
} from './household.service';
import { HOUSEHOLD_INVITE_CALLABLE } from './household-invite-callable';
import { DocumentWithMetadata, FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { PwaService } from './pwa.service';
import { TranslationService } from './translation.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { createTranslationStub } from './testing/translation-stub';
import { journalRows, ledgerJournalKey, ledgerSweepKey, readLedgerJournal, stampSweep } from './ledger-journal';
import { LedgerShareProgress, LedgerShareService } from './ledger-share.service';
import {
  Household,
  HouseholdIndexEntry,
  HouseholdInvite,
  HouseholdMember,
  HouseholdRole,
  LEDGER_PURGE_CHUNK,
  MAX_HOUSEHOLDS_PER_ACCOUNT,
  User
} from '../../models';

type OwnMember = DocumentWithMetadata<HouseholdMember>;
interface Write { op: 'set' | 'update' | 'delete'; path: string; data?: unknown }
type Where = { field: string; op: string; value: unknown }[] | undefined;
/** An index entry as a listener or a read hands it over: a pending stamp reads as null. */
type EntryData = Omit<HouseholdIndexEntry, 'since' | 'joinedAt' | 'endedAt'> & {
  since: Timestamp | null;
  joinedAt: Timestamp | null;
  endedAt?: Timestamp | null;
};

/** The own member document as the server confirmed it. */
const confirmed = (data: HouseholdMember | null): OwnMember => ({ data, fromCache: false, hasPendingWrites: false });
/** The own member document as the local cache answered it. */
const cached = (data: HouseholdMember | null): OwnMember => ({ data, fromCache: true, hasPendingWrites: false });
/** Any document as the server confirmed it. */
const fromServer = <T>(data: T | null): DocumentWithMetadata<T> => ({ data, fromCache: false, hasPendingWrites: false });

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
  const HID2 = 'h2';
  // Microseconds on purpose: a generation compared by the rules keeps them.
  const CREATED = new Timestamp(1_788_000_000, 123_456_000);
  const CREATED2 = new Timestamp(1_788_050_000, 654_321_000);
  const LATER = new Timestamp(1_788_100_000, 0);
  const FUTURE = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  // Minutes left by this device's clock: a clock running slow still sees
  // time left on an invite the server has already expired.
  const SOON = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  const PAST = Timestamp.fromMillis(Date.now() - 60 * 1000);
  // The translation stub echoes the key with its params.
  const NAME_ERROR = `household.errors.name:${JSON.stringify({ max: HOUSEHOLD_NAME_MAX_LENGTH })}`;
  const TOO_MANY = `household.errors.tooMany:${JSON.stringify({ max: MAX_HOUSEHOLDS_PER_ACCOUNT })}`;
  const INDEX = `users/${ME}/households`;
  const INDEX_PATH = `${INDEX}/${HID}`;

  let service: HouseholdService;
  let firestore: MockFirestoreService;
  let online: WritableSignal<boolean>;
  let user: WritableSignal<User | null>;
  let invite: jasmine.Spy;
  let consoleError: jasmine.Spy;
  let consoleWarn: jasmine.Spy;
  /** The copies and share keys a membership leaves (LedgerShareService), as a stub. */
  let ledger: { cleanupMembership: jasmine.Spy; purgeMember: jasmine.Spy };
  /**
   * Every commit recordCommits records and every call to the ledger stub,
   * in the order made: how a spec says one came after another.
   */
  let timeline: string[];

  let index$: Subject<EntryData[]>;
  /** The household document as the server answers it. */
  let household$: Subject<Household | null>;
  /** The household document as the local cache answers it. */
  let householdCache$: Subject<DocumentWithMetadata<Household>>;
  let own$: Subject<OwnMember>;
  let members$: Subject<HouseholdMember[]>;
  let household2$: Subject<Household | null>;
  let own2$: Subject<OwnMember>;
  let members2$: Subject<HouseholdMember[]>;
  let received$: Subject<HouseholdInvite[]>;
  let sent$: Subject<HouseholdInvite[]>;
  let otherIndex$: Subject<EntryData[]>;
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

  /** The account's index entry, named as the household is, so nothing asks to refresh it. */
  const entry = (overrides: Partial<EntryData> = {}): EntryData => ({
    id: HID,
    since: CREATED,
    role: 'member',
    name: 'Home',
    joinedAt: CREATED,
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
    timeline = [];
    ledger = {
      cleanupMembership: jasmine.createSpy('cleanupMembership').and.callFake(async (householdId: string) => {
        timeline.push(`cleanup ${householdId}`);
        return true;
      }),
      purgeMember: jasmine.createSpy('purgeMember').and.callFake(async (
        householdId: string,
        memberUid: string,
        progress?: LedgerShareProgress
      ) => {
        timeline.push(`purgeMember ${householdId} ${memberUid}`);
        progress?.(0, 0);
        return 0;
      })
    };

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
        { provide: HOUSEHOLD_INVITE_CALLABLE, useValue: invite },
        { provide: LedgerShareService, useValue: ledger }
      ]
    });
    firestore = TestBed.inject(FirestoreService) as unknown as MockFirestoreService;
    service = TestBed.inject(HouseholdService);

    index$ = new Subject();
    household$ = new Subject();
    householdCache$ = new Subject();
    own$ = new Subject();
    members$ = new Subject();
    household2$ = new Subject();
    own2$ = new Subject();
    members2$ = new Subject();
    received$ = new Subject();
    sent$ = new Subject();
    otherIndex$ = new Subject();
    otherReceived$ = new Subject();
    membersWhere = [];

    spyOn(firestore, 'subscribeToDocument').and.callFake(((path: string) => {
      if (path === `households/${HID}`) return household$;
      if (path === `households/${HID2}`) return household2$;
      throw new Error(`unexpected document listener: ${path}`);
    }) as never);
    const metadataListener = (path: string): Observable<DocumentWithMetadata<unknown>> => {
      if (path === `households/${HID}/members/${ME}`) return own$;
      if (path === `households/${HID2}/members/${ME}`) return own2$;
      // Read when the listener opens: a case may replace household$ first.
      if (path === `households/${HID}`) return merge(household$.pipe(map(fromServer)), householdCache$);
      if (path === `households/${HID2}`) return household2$.pipe(map(fromServer));
      throw new Error(`unexpected metadata listener: ${path}`);
    };
    spyOn(firestore, 'subscribeToDocumentWithMetadata')
      .and.callFake(metadataListener as MockFirestoreService['subscribeToDocumentWithMetadata']);
    spyOn(firestore, 'subscribeToCollection').and.callFake(((path: string, options?: { where?: Where }) => {
      const where = options?.where;
      if (path === INDEX && !where) return index$;
      if (path === `users/${OTHER}/households` && !where) return otherIndex$;
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
      if (path === `households/${HID2}/members`) return members2$;
      throw new Error(`unexpected collection listener: ${path}`);
    }) as never);

    consoleError = spyOn(console, 'error').and.callThrough();
    consoleWarn = spyOn(console, 'warn').and.callThrough();
  });

  afterEach(() => {
    for (const uid of [ME, OTHER]) {
      localStorage.removeItem(householdSelectionKey(uid));
      localStorage.removeItem(ledgerJournalKey(uid));
      localStorage.removeItem(ledgerSweepKey(uid, HID));
    }
  });

  /** Connects and drives the listeners to a live membership. */
  function goLive(role: HouseholdRole = 'member'): void {
    service.connect();
    index$.next([entry({ role })]);
    own$.next(confirmed(member({ role })));
    household$.next(householdDoc({ ownerId: role === 'owner' ? ME : 'alex' }));
    members$.next(role === 'owner'
      ? [member({ role: 'owner' }), member({ uid: 'sam', displayName: 'Sam', joinedAt: LATER })]
      : [member({ joinedAt: LATER }), member({ uid: 'alex', displayName: 'Alex', role: 'owner' })]);
  }

  /** Two live memberships, the first joined first: HID as a member, HID2 as its owner. */
  const twoEntries = (): EntryData[] => [
    entry(),
    entry({ id: HID2, role: 'owner', name: 'Flat', since: CREATED2, joinedAt: LATER })
  ];

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
      if (writes.length > 0) timeline.push(`commit ${writes.map(w => `${w.op} ${w.path}`).join(', ')}`);
      return result;
    }) as never);
    return commits;
  }

  const shape = (commits: Write[][]) => commits.map(writes => writes.map(w => `${w.op} ${w.path}`));

  /** How many times a document listener with metadata was opened on this path. */
  const listenedTo = (path: string) =>
    (firestore.subscribeToDocumentWithMetadata as jasmine.Spy).calls.allArgs().filter(([listened]) => listened === path).length;

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

  /** readsFor for the reads the server must answer, never a listener. */
  function serverReadsFor(docs: Record<string, unknown>, refused: string[] = []): jasmine.Spy {
    return spyOn(firestore, 'getDocumentFromServer').and.callFake((async (path: string) => {
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

      expect(firestore.subscribeToCollection).toHaveBeenCalledWith(INDEX);
      expect((firestore.subscribeToCollection as jasmine.Spy).calls.allArgs()
        .filter(([path]) => path === INDEX).length).toBe(1);
      expect(service.status()).toBe('member');

      service.disconnect();
      expect(index$.observed).toBeTrue();
      expect(service.status()).toBe('member');

      service.disconnect();
      for (const subject of [index$, household$, own$, members$, received$, sent$]) {
        expect(subject.observed).toBeFalse();
      }
      expect(service.status()).toBe('idle');
      expect(service.household()).toBeNull();
      expect(service.memberships()).toEqual([]);
    });

    it('attaches the household and members listeners only once its own member document is live', () => {
      service.connect();
      expect(service.status()).toBe('loading');

      index$.next([entry()]);
      expect(firestore.subscribeToDocumentWithMetadata).toHaveBeenCalledOnceWith(`households/${HID}/members/${ME}`);
      expect(listenedTo(`households/${HID}`)).toBe(0);
      expect(service.status()).toBe('loading');

      // A member document whose since is not a Timestamp attaches nothing.
      own$.next(cached(member({ since: null as unknown as Timestamp })));
      expect(listenedTo(`households/${HID}`)).toBe(0);

      own$.next(confirmed(member()));
      expect(listenedTo(`households/${HID}`)).toBe(1);
      expect(firestore.subscribeToDocument).not.toHaveBeenCalled();
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

      // A metadata-only emission of the same membership re-attaches nothing,
      // and neither does the index answering again.
      own$.next(cached(member()));
      index$.next([entry()]);
      expect(membersWhere.length).toBe(1);
      expect(listenedTo(`households/${HID}/members/${ME}`)).toBe(1);
      expect(listenedTo(`households/${HID}`)).toBe(1);
      expectNoConsoleNoise();
    });

    it('reads as member once the household and its members have answered, in either order', () => {
      service.connect();
      index$.next([entry()]);
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
      index$.next([]);

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
      index$.next([entry()]);
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
      index$.next([entry()]);
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

    it('reads as none, quietly, when the index listener fails', () => {
      goLive();
      const failure = firebaseError('internal');
      index$.error(failure);

      expect(service.status()).toBe('none');
      expect(service.memberships()).toEqual([]);
      expect(own$.observed).toBeFalse();
      expect(household$.observed).toBeFalse();
      expect(service.lostAccess()).toBeFalse();
      expect(serviceWarnings()).toEqual([[jasmine.stringMatching(/^\[HouseholdService\]/), failure]]);
    });

    it('boots silently with an index entry whose membership is gone, and reports no lost access', () => {
      service.connect();
      index$.next([entry()]);
      own$.next(confirmed(null));

      expect(service.status()).toBe('none');
      expect(service.lostAccess()).toBeFalse();
      expect(listenedTo(`households/${HID}`)).toBe(0);
      expectNoConsoleNoise();
    });

    it('never sets lostAccess on a cache null, and sets it on a server-confirmed absence', () => {
      goLive();

      own$.next(cached(null));
      expect(service.lostAccess()).toBeFalse();
      expect(service.status()).toBe('member');

      own$.next(confirmed(null));
      expect(service.lostAccess()).toBeTrue();
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
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

    it('reads an offline boot with nothing cached as not loaded on this device, not as no membership, deciding nothing lost', () => {
      online.set(false);
      service.connect();
      index$.next([entry()]);
      own$.next(cached(null));

      expect(service.status()).toBe('notLoaded');
      expect(service.selectedHouseholdId()).toBe(HID);
      expect(service.household()).toBeNull();
      expect(service.lostAccess()).toBeFalse();
    });

    it('waits online for the server when the cache has nothing, and reads as none only once the server confirms it', () => {
      service.connect();
      index$.next([entry()]);
      own$.next(cached(null));
      expect(service.status()).toBe('loading');

      online.set(false);
      expect(service.status()).withContext('the connection lost before the server answered').toBe('notLoaded');
      online.set(true);

      own$.next(confirmed(null));
      expect(service.status()).toBe('none');
      online.set(false);
      expect(service.status()).withContext('the server has said').toBe('none');
      expect(service.lostAccess()).toBeFalse();
    });

    it('reads a membership never viewed on this device as not loaded once switched to offline, and shows it once connected', () => {
      goLive();
      index$.next(twoEntries());
      online.set(false);

      service.select(HID2);
      own2$.next(cached(null));

      expect(service.status()).toBe('notLoaded');
      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(service.lostAccess()).toBeFalse();

      online.set(true);
      expect(service.status()).toBe('loading');
      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      household2$.next(householdDoc({ id: HID2, name: 'Flat', ownerId: ME, createdAt: CREATED2 }));
      members2$.next([member({ role: 'owner', since: CREATED2 })]);
      expect(service.status()).toBe('member');
      expect(service.household()?.name).toBe('Flat');
    });

    it('reads a household document the cache does not hold as not loaded offline, and loading online until the server answers', () => {
      online.set(false);
      service.connect();
      index$.next([entry()]);
      own$.next(cached(member()));
      householdCache$.next({ data: null, fromCache: true, hasPendingWrites: false });
      members$.next([member()]);

      expect(service.status()).toBe('notLoaded');
      expect(service.household()).toBeNull();

      online.set(true);
      expect(service.status()).toBe('loading');

      household$.next(householdDoc());
      expect(service.status()).toBe('member');

      // Only the server says the household is gone.
      householdCache$.next({ data: null, fromCache: true, hasPendingWrites: false });
      expect(service.status()).withContext('a later cache answer decides nothing').toBe('member');
      household$.next(null);
      expect(service.status()).toBe('none');
    });

    it('closes the old membership when its index entry goes away, without calling it lost', () => {
      goLive();
      index$.next([]);

      expect(own$.observed).toBeFalse();
      expect(household$.observed).toBeFalse();
      expect(service.status()).toBe('none');
      expect(service.selectedHouseholdId()).toBeNull();
      expect(service.lostAccess()).toBeFalse();
    });

    it('leaves the owner\'s own listeners quiet through a dissolve', async () => {
      goLive('owner');
      serveServerReads({
        [`households/${HID}/members?since`]: [[member({ role: 'owner' }), member({ uid: 'sam' })]]
      });
      recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve();
      household$.error(firebaseError('permission-denied'));
      members$.error(firebaseError('permission-denied'));
      own$.next(confirmed(null));
      index$.next([]);

      expect(service.lostAccess()).toBeFalse();
      expect(service.status()).toBe('none');
      expectNoConsoleNoise();
    });

    it('does not report its own leaving as lost access, whichever listener hears first', async () => {
      goLive('member');
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave();
      own$.next(confirmed(null));
      index$.next([]);

      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('follows the account while connected: a sign-out closes the old account\'s listeners, the next account gets its own', () => {
      goLive('member');
      service.connect();

      user.set(null);
      TestBed.tick();

      for (const subject of [index$, household$, own$, members$, received$]) {
        expect(subject.observed).withContext('the signed-out account\'s listeners').toBeFalse();
      }
      expect(service.status()).toBe('none');
      expect(service.household()).toBeNull();
      expect(service.receivedInvites()).toEqual([]);
      expect(service.memberships()).toEqual([]);
      expect(service.lostAccess()).toBeFalse();

      user.set(userFixture({ id: OTHER }));
      TestBed.tick();

      expect(firestore.subscribeToCollection).toHaveBeenCalledWith(`users/${OTHER}/households`);
      expect(firestore.subscribeToCollection).toHaveBeenCalledWith('householdInvites', {
        where: [{ field: 'inviteeUid', op: '==', value: OTHER }]
      });
      expect(service.status()).toBe('loading');
      otherIndex$.next([]);
      expect(service.status()).toBe('none');
      expect(index$.observed).toBeFalse();

      // Both connections survived the switch: only the second disconnect closes.
      service.disconnect();
      expect(otherIndex$.observed).toBeTrue();
      service.disconnect();
      expect(otherIndex$.observed).toBeFalse();
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

  // Up to MAX_HOUSEHOLDS_PER_ACCOUNT memberships, listed from the account's
  // own index; the page shows one of them at a time.
  describe('memberships and the selected household', () => {
    it('lists the index earliest joined first, one still being stamped last, and marks an ended one', () => {
      service.connect();
      index$.next([
        entry({ id: 'pending', name: 'New', since: null, joinedAt: null }),
        entry({ id: HID2, name: 'Flat', joinedAt: LATER, endedAt: LATER }),
        entry({ id: HID, name: 'Home', role: 'owner' })
      ]);

      expect(service.memberships()).toEqual([
        { householdId: HID, name: 'Home', role: 'owner', since: CREATED, joinedAt: CREATED, ended: false },
        { householdId: HID2, name: 'Flat', role: 'member', since: CREATED, joinedAt: LATER, ended: true },
        { householdId: 'pending', name: 'New', role: 'member', since: null, joinedAt: null, ended: false }
      ]);
    });

    it('marks an entry ended while the stamp of its end is still on its way', () => {
      service.connect();
      index$.next([entry({ endedAt: null })]);

      expect(service.memberships()[0].ended).toBeTrue();
      expect(service.selectedHouseholdId()).toBeNull();
    });

    it('selects the earliest live membership by default, passing over an ended one', () => {
      service.connect();
      index$.next([entry({ endedAt: LATER }), entry({ id: HID2, since: CREATED2, joinedAt: LATER })]);

      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(firestore.subscribeToDocumentWithMetadata).toHaveBeenCalledOnceWith(`households/${HID2}/members/${ME}`);
    });

    it('selects the household last used on this device while it is live, and falls back when it is not', () => {
      localStorage.setItem(householdSelectionKey(ME), HID2);
      service.connect();
      index$.next(twoEntries());
      expect(service.selectedHouseholdId()).toBe(HID2);

      index$.next([entry()]);
      expect(service.selectedHouseholdId()).toBe(HID);
      expect(own2$.observed).toBeFalse();
      expect(own$.observed).toBeTrue();
    });

    it('switches the listeners to the household selected and remembers the choice on this device', () => {
      goLive();
      index$.next(twoEntries());
      expect(service.selectedHouseholdId()).toBe(HID);

      service.select(HID2);

      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(localStorage.getItem(householdSelectionKey(ME))).toBe(HID2);
      for (const subject of [own$, household$, members$]) expect(subject.observed).toBeFalse();
      expect(own2$.observed).toBeTrue();
      expect(service.status()).toBe('loading');
      expect(service.household()).toBeNull();

      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      household2$.next(householdDoc({ id: HID2, name: 'Flat', ownerId: ME, createdAt: CREATED2 }));
      members2$.next([member({ role: 'owner', since: CREATED2 })]);
      expect(service.status()).toBe('member');
      expect(service.household()?.name).toBe('Flat');
      expect(service.isOwner()).toBeTrue();
    });

    it('keeps the default selection when device storage is out of reach', () => {
      spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
      spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
      service.connect();
      index$.next(twoEntries());

      expect(service.selectedHouseholdId()).toBe(HID);
      expect(() => service.select(HID2)).not.toThrow();
      expect(service.selectedHouseholdId()).toBe(HID2);
    });

    it('keeps each loss to its own household: another seen live does not lift it, the same one seen live again does', () => {
      goLive();
      index$.next(twoEntries());
      own$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set([HID]));

      service.select(HID2);
      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
      expect(service.lostAccess()).toBeTrue();

      service.select(HID);
      own$.next(confirmed(member()));
      expect(service.lostHouseholds()).toEqual(new Set());
      expect(service.lostAccess()).toBeFalse();
    });

    it('lifts a loss once its entry is tidied away and another membership is seen live', () => {
      goLive();
      index$.next(twoEntries());
      own$.next(confirmed(null));
      expect(service.lostAccess()).toBeTrue();

      // The tidy's delete of the lost entry reaches the index listener.
      index$.next([twoEntries()[1]]);
      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(service.lostAccess()).toBeTrue();

      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      expect(service.lostHouseholds()).toEqual(new Set());
      expect(service.lostAccess()).toBeFalse();
    });

    // The usual order: the page moves on, and its tidy lands a few round
    // trips later. Lifting the notice at the tidy would only flash it.
    it('keeps a loss shown while another membership is seen live through its tidy, until a membership is seen live again', () => {
      goLive();
      index$.next(twoEntries());
      own$.next(confirmed(null));
      service.select(HID2);
      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      expect(service.lostHouseholds()).toEqual(new Set([HID]));

      index$.next([entry({ endedAt: LATER }), twoEntries()[1]]);
      expect(service.lostHouseholds()).withContext('once the tidy marks it ended').toEqual(new Set([HID]));
      index$.next([twoEntries()[1]]);
      expect(service.lostHouseholds()).withContext('once the tidy deletes it').toEqual(new Set([HID]));
      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(service.lostAccess()).toBeTrue();

      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      expect(service.lostHouseholds()).toEqual(new Set());
      expect(service.lostAccess()).toBeFalse();
    });

    it('keeps a loss whose entry is gone while no other membership is seen live', () => {
      goLive();
      own$.next(confirmed(null));

      index$.next([]);

      expect(service.status()).toBe('none');
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });

    it('does not let leaving one household hide the loss of another', async () => {
      goLive();
      index$.next(twoEntries());
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave();
      own$.next(confirmed(null));
      index$.next([twoEntries()[1]]);
      expect(service.selectedHouseholdId()).toBe(HID2);
      expect(service.lostAccess()).toBeFalse();

      own2$.next(confirmed(member({ role: 'owner', since: CREATED2 })));
      own2$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set([HID2]));
    });

    it('keeps a loss the tidy ends while no other membership is seen live', async () => {
      goLive();
      own$.next(confirmed(null));
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({});
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      expect(await service.tidyEndedMemberships()).toBeTrue();
      index$.next([entry({ endedAt: LATER })]);
      index$.next([]);

      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });

    /**
     * HID confirmed lost while shown, then HID2, held with `role`, shown in
     * its place with the notice up. A leave or a dissolve of HID2 reads and
     * commits as stubbed here.
     */
    function loseHomeAndShowFlat(role: HouseholdRole): EntryData {
      const flat = entry({ id: HID2, role, name: 'Flat', since: CREATED2, joinedAt: LATER });
      goLive();
      index$.next([entry(), flat]);
      own$.next(confirmed(null));
      service.select(HID2);
      own2$.next(confirmed(member({ role, since: CREATED2 })));
      household2$.next(householdDoc({ id: HID2, name: 'Flat', ownerId: role === 'owner' ? ME : 'alex', createdAt: CREATED2 }));
      members2$.next([member({ role, since: CREATED2 })]);
      serveServerReads({ [`households/${HID2}/members?since`]: [[member({ role, since: CREATED2 })]] });
      recordCommits(undefined, { [`${INDEX}/${HID2}`]: flat });
      expect(service.status()).toBe('member');
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
      return flat;
    }

    // The account's own ending moves the view on, often to the setup, where
    // no membership is seen live; the notice is not to stay up there.
    const OWN_ENDINGS: [string, HouseholdRole, () => Promise<void>][] = [
      ['leave', 'member', () => service.leave()],
      ['dissolve', 'owner', () => service.dissolve()],
      ['dissolve done bar its shared rows', 'owner', async () => {
        ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));
        await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdCleanupError);
      }]
    ];
    for (const [ending, role, end] of OWN_ENDINGS) {
      it(`lifts a loss shown before the account's own ${ending} once the tidy then marks it ended`, async () => {
        const flat = loseHomeAndShowFlat(role);

        await end();
        index$.next([entry(), { ...flat, endedAt: LATER }]);
        expect(service.lostHouseholds()).withContext('while its entry is listed live').toEqual(new Set([HID]));

        index$.next([entry({ endedAt: LATER }), { ...flat, endedAt: LATER }]);
        expect(service.selectedHouseholdId()).toBeNull();
        expect(service.lostHouseholds()).toEqual(new Set());
        expect(service.lostAccess()).toBeFalse();
      });
    }

    it("lifts a loss shown before the account's own dissolve when one answer heard while it runs marks both entries ended", async () => {
      const flat = loseHomeAndShowFlat('owner');
      ledger.cleanupMembership.and.callFake(async () => {
        index$.next([entry({ endedAt: LATER }), { ...flat, endedAt: LATER }]);
        return true;
      });

      await service.dissolve();

      expect(service.selectedHouseholdId()).toBeNull();
      expect(service.lostHouseholds()).toEqual(new Set());
      expect(service.lostAccess()).toBeFalse();
    });

    it("keeps a loss reported after the account's own dissolve once its tidy marks it ended", async () => {
      const flat = loseHomeAndShowFlat('owner');
      await service.dissolve();
      index$.next([entry(), { ...flat, endedAt: LATER }]);
      // Seen live again, then lost again: news the dissolve did not answer.
      own$.next(confirmed(member()));
      own$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set([HID]));

      index$.next([entry({ endedAt: LATER }), { ...flat, endedAt: LATER }]);

      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });
  });

  // The member document holds how the others see the account, copied from
  // its profile at joining; the profile can be renamed at any time after.
  describe('how the account is shown to the others', () => {
    const OWN_PATH = `households/${HID}/members/${ME}`;

    function attach(stored: OwnMember): void {
      service.connect();
      index$.next([entry()]);
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

    it("brings every other live membership's member document into line too, read once from the server", async () => {
      const commits = recordCommits();
      const reads = serverReadsFor({
        [`households/${HID2}/members/${ME}`]: member({ role: 'owner', since: CREATED2, displayName: 'Old name' })
      });
      service.connect();
      index$.next([...twoEntries(), entry({ id: 'ended', endedAt: LATER })]);
      own$.next(confirmed(member()));
      TestBed.tick();
      await fixtureSettled();
      TestBed.tick();
      await fixtureSettled();

      expect(reads.calls.allArgs()).toEqual([[`households/${HID2}/members/${ME}`]]);
      expect(commits).toEqual([[{
        op: 'update',
        path: `households/${HID2}/members/${ME}`,
        data: { displayName: 'Me', photoURL: 'https://lh3.googleusercontent.com/a/me' }
      }]]);
    });

    it('leaves a member document of another generation alone', async () => {
      const commits = recordCommits();
      serverReadsFor({
        [`households/${HID2}/members/${ME}`]: member({ role: 'owner', since: LATER, displayName: 'Old name' })
      });
      service.connect();
      index$.next(twoEntries());
      own$.next(confirmed(member()));
      TestBed.tick();
      await fixtureSettled();

      expect(commits).toEqual([]);
    });
  });

  describe("the index entry's cached name", () => {
    it('is brought into line with the household it lists, once per name', async () => {
      const commits = recordCommits();
      service.connect();
      index$.next([entry({ name: 'Old name' })]);
      own$.next(confirmed(member()));
      household$.next(householdDoc({ name: 'Home' }));
      household$.next(householdDoc({ name: 'Home' }));
      await fixtureSettled();

      expect(commits).toEqual([[{ op: 'update', path: INDEX_PATH, data: { name: 'Home' } }]]);
    });

    it('is left alone offline, and when it already matches', async () => {
      const commits = recordCommits();
      goLive();
      await fixtureSettled();
      expect(commits).toEqual([]);

      online.set(false);
      household$.next(householdDoc({ name: 'Renamed' }));
      await fixtureSettled();
      expect(commits).toEqual([]);
    });
  });

  describe('forming and joining', () => {
    it('forms a household, its owner document and its index document in one commit, stamped with the server time', async () => {
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
        }],
        [`${INDEX}/${householdId}`, {
          since: serverTimestamp(),
          role: 'owner',
          name: 'Home',
          joinedAt: serverTimestamp()
        }]
      ]);
      expect(firestore.txUpdateSpy.calls.length).toBe(0);
      expect(firestore.txDeleteSpy.calls.length).toBe(0);
    });

    it('selects the household it forms', async () => {
      const householdId = await service.create('Home');

      expect(localStorage.getItem(householdSelectionKey(ME))).toBe(householdId);
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

    // Counted by two aggregations: every entry, and those marked ended. At
    // the limit, each unended entry is judged on the server.
    describe(`the limit of ${MAX_HOUSEHOLDS_PER_ACCOUNT}`, () => {
      const ENDED_FILTER = [{ field: 'endedAt', op: '>', value: new Timestamp(0, 0) }];

      /**
       * Answers the two counts: every index entry, and those marked ended.
       * Only the ended filter itself is answered: any other filter fails the
       * case rather than be counted as ended.
       */
      function countIndex(total: number, ended = 0): jasmine.Spy {
        return spyOn(firestore, 'aggregateFromServer').and.callFake((async (
          path: string,
          options?: { where?: Where }
        ) => {
          if (path !== INDEX) throw new Error(`unexpected aggregation over ${path}`);
          if (!options?.where) return { count: total };
          if (JSON.stringify(options.where) !== JSON.stringify(ENDED_FILTER)) {
            throw new Error(`unexpected filter ${JSON.stringify(options.where)}`);
          }
          return { count: ended };
        }) as never);
      }

      /**
       * `count` unended index entries, each a live membership as the server
       * holds it (its member document and its household), keyed by path for
       * serverReadsFor.
       */
      function liveEntries(count: number): { entries: EntryData[]; docs: Record<string, unknown> } {
        const entries: EntryData[] = [];
        const docs: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const householdId = `live${i}`;
          entries.push(entry({ id: householdId, name: `Home ${i}` }));
          docs[`households/${householdId}/members/${ME}`] = member();
          docs[`households/${householdId}`] = householdDoc({ id: householdId });
        }
        return { entries, docs };
      }

      it(`refuses a create at ${MAX_HOUSEHOLDS_PER_ACCOUNT} live memberships, counted and judged on the server, before any commit`, async () => {
        const counts = countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const listings = serveServerReads({ [`${INDEX}?`]: [entries] });
        const reads = serverReadsFor(docs);

        await expectAsync(service.create('Home')).toBeRejectedWithError(HouseholdError, TOO_MANY);
        expect(counts.calls.allArgs()).toEqual([
          [INDEX, undefined, { count: true }],
          [INDEX, { where: ENDED_FILTER }, { count: true }]
        ]);
        expect(listings.calls.allArgs()).toEqual([[INDEX]]);
        expect(reads).toHaveBeenCalledWith(`households/live0/members/${ME}`);
        expect(firestore.runTransactionSpy.calls.length).toBe(0);
      });

      it('does not count an ended membership', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT, 1);

        await expectAsync(service.create('Home')).toBeResolved();
        expect(firestore.runTransactionSpy.calls.length).toBe(1);
        expect(firestore.getCollectionFromServerSpy.calls.length).toBe(0);
      });

      it('does not count an entry whose member document the server says is gone, and ends it on the way', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT - 1);
        const stale = entry({ id: 'removed', name: 'Removed' });
        serveServerReads({ [`${INDEX}?`]: [[...entries, stale]] });
        serverReadsFor(docs);
        const commits = recordCommits(undefined, { [`${INDEX}/removed`]: stale });

        const householdId = await service.create('Home');

        expect(shape(commits)).toEqual([
          [`update ${INDEX}/removed`],
          [`delete ${INDEX}/removed`],
          [`set households/${householdId}`, `set households/${householdId}/members/${ME}`, `set ${INDEX}/${householdId}`]
        ]);
      });

      it('does not count an entry whose household the server says is gone, and a join goes ahead', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT - 1);
        const orphan = entry({ id: 'dissolved', name: 'Dissolved' });
        serveServerReads({ [`${INDEX}?`]: [[...entries, orphan]] });
        serverReadsFor({ ...docs, [`households/dissolved/members/${ME}`]: member() }, ['households/dissolved']);
        const commits = recordCommits(undefined, {
          [`${INDEX}/dissolved`]: orphan,
          [`householdInvites/${HID}_${ME}`]: inviteDoc()
        });
        readsFor({});

        await expectAsync(service.accept(HID)).toBeResolved();

        expect(shape(commits)).toEqual([
          [`delete households/dissolved/members/${ME}`, `update ${INDEX}/dissolved`],
          [`delete ${INDEX}/dissolved`],
          [`set households/${HID}/members/${ME}`, `delete householdInvites/${HID}_${ME}`, `set ${INDEX_PATH}`]
        ]);
      });

      it('still goes ahead when ending a stale entry on the way fails', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT - 1);
        const stale = entry({ id: 'removed', name: 'Removed' });
        serveServerReads({ [`${INDEX}?`]: [[...entries, stale]] });
        serverReadsFor(docs);
        const commits = recordCommits(
          writes => writes.some(w => w.path === `${INDEX}/removed`) ? firebaseError('permission-denied') : null,
          { [`${INDEX}/removed`]: stale }
        );

        await expectAsync(service.create('Home')).toBeResolved();
        expect(commits.length).toBe(1);
      });

      it(`refuses a join at ${MAX_HOUSEHOLDS_PER_ACCOUNT} live memberships before any commit`, async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT);
        serveServerReads({ [`${INDEX}?`]: [entries] });
        serverReadsFor(docs);
        firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc());

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, TOO_MANY);
        expect(firestore.runTransactionSpy.calls.length).toBe(0);
      });

      it('does not count the household being joined as one more when its entry is already listed unended', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT);
        const { entries, docs } = liveEntries(MAX_HOUSEHOLDS_PER_ACCOUNT - 1);
        serveServerReads({ [`${INDEX}?`]: [[...entries, entry()]] });
        const reads = serverReadsFor(docs);
        firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc());

        await expectAsync(service.accept(HID)).toBeResolved();
        // Written again whole by the join, the entry is not judged.
        expect(reads).not.toHaveBeenCalledWith(`households/${HID}/members/${ME}`);
      });

      it('lists and judges the entries only at the limit', async () => {
        countIndex(MAX_HOUSEHOLDS_PER_ACCOUNT - 1);
        firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc());

        await service.accept(HID);

        expect(firestore.getCollectionFromServerSpy.calls.length).toBe(0);
        expect(firestore.getDocumentFromServerSpy.calls.length).toBe(0);
      });
    });

    it('accepts by reading only the invite, copying its generation into since on the member and index documents', async () => {
      const stored = inviteDoc({ householdName: 'Our home' });
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, stored);

      await service.accept(HID);

      expect(firestore.txGetSpy.calls.map(c => c.args[0])).toEqual([`householdInvites/${HID}_${ME}`]);
      expect(firestore.txSetSpy.calls.map(c => c.args)).toEqual([
        [`households/${HID}/members/${ME}`, {
          uid: ME,
          displayName: 'Me',
          photoURL: 'https://lh3.googleusercontent.com/a/me',
          role: 'member',
          since: CREATED,
          joinedAt: serverTimestamp(),
          inviteId: `${HID}_${ME}`
        }],
        [INDEX_PATH, { since: CREATED, role: 'member', name: 'Our home', joinedAt: serverTimestamp() }]
      ]);
      const sets = firestore.txSetSpy.calls.map(c => c.args[1] as Record<string, unknown>);
      expect(sets.every(data => data['since'] === stored.householdCreatedAt)).toBeTrue();
      expect(firestore.txDeleteSpy.calls.map(c => c.args[0])).toEqual([`householdInvites/${HID}_${ME}`]);
      expect(firestore.txUpdateSpy.calls.length).toBe(0);
      expect(localStorage.getItem(householdSelectionKey(ME))).toBe(HID);
    });

    it("answers the household's name as the new member now reads it, not the invite's copy", async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ householdName: 'Home' }));
      const reads = readsFor({ [`households/${HID}`]: householdDoc({ name: 'Renamed home' }) });

      expect(await service.accept(HID)).toBe('Renamed home');
      expect(reads).toHaveBeenCalledOnceWith(`households/${HID}`);
    });

    it("answers the invite's copy of the name when the household cannot be read after joining", async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ householdName: 'Home' }));
      spyOn(firestore, 'getDocument').and.rejectWith(firebaseError('unavailable'));

      expect(await service.accept(HID)).toBe('Home');
    });

    it('leaves expiry to the rules: an invite this device\'s clock calls expired still joins when the server admits it', async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc({ expiresAt: PAST }));

      await service.accept(HID);

      expect(firestore.txSetSpy.calls.map(c => c.args[0])).toEqual([`households/${HID}/members/${ME}`, INDEX_PATH]);
    });

    describe('a refused join', () => {
      const INVITE_PATH = `householdInvites/${HID}_${ME}`;
      const refused = () => firebaseError('permission-denied');

      it('says expired when the invite is past its expiry by this device\'s clock', async () => {
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: PAST }) });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('says expired when the invite is minutes from expiry, as a clock running slow would see it', async () => {
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: SOON }) });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('says the invite is gone when its expiry is well ahead', async () => {
        recordCommits(refused, { [INVITE_PATH]: inviteDoc() });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');
      });

      it('asks the server whether the join landed before blaming the invite', async () => {
        const reads = serverReadsFor({});
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: PAST }) });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
        expect(reads).toHaveBeenCalledOnceWith(`households/${HID}/members/${ME}`);
      });

      it('keeps the refusal when the server cannot say whether the join landed', async () => {
        spyOn(firestore, 'getDocumentFromServer').and.rejectWith(firebaseError('unavailable'));
        recordCommits(refused, { [INVITE_PATH]: inviteDoc({ expiresAt: PAST }) });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.expired');
      });

      it('passes a failure that is not a refusal through the usual mapping, asking nothing', async () => {
        const reads = serverReadsFor({});
        recordCommits(() => firebaseError('unavailable'), { [INVITE_PATH]: inviteDoc({ expiresAt: PAST }) });

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
        expect(reads).not.toHaveBeenCalled();
      });
    });

    it('calls an invite that is no longer there withdrawn, refused read or missing', async () => {
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

    // A commit that lands and loses its answer is sent again, and the second
    // delivery is judged against what the first left (ADR 0156).
    describe('sent twice', () => {
      const FRESH = 'fresh';
      const MEMBER_PATH = `households/${HID}/members/${ME}`;

      it('resolves a create whose second delivery is refused, once the server shows the first landed', async () => {
        spyOn(firestore, 'generateId').and.returnValue(FRESH);
        const commits = recordCommits(() => firebaseError('permission-denied'));
        const reads = serverReadsFor({
          [`households/${FRESH}`]: householdDoc({ id: FRESH, ownerId: ME, createdAt: CREATED }),
          [`households/${FRESH}/members/${ME}`]: member({ role: 'owner', since: CREATED })
        });
        const getDocument = spyOn(firestore, 'getDocument').and.callThrough();

        expect(await service.create('Home')).toBe(FRESH);
        expect(commits).toEqual([]);
        expect(reads.calls.allArgs()).toEqual([[`households/${FRESH}`], [`households/${FRESH}/members/${ME}`]]);
        expect(getDocument).not.toHaveBeenCalled();
        expect(localStorage.getItem(householdSelectionKey(ME))).toBe(FRESH);
      });

      it('still fails a refused create the server shows never landed', async () => {
        spyOn(firestore, 'generateId').and.returnValue(FRESH);
        recordCommits(() => firebaseError('permission-denied'));
        serverReadsFor({}, [`households/${FRESH}`]);

        await expectAsync(service.create('Home')).toBeRejectedWithError(HouseholdError, 'errors.generic');
      });

      it('still fails a refused create whose owner document is of another generation', async () => {
        spyOn(firestore, 'generateId').and.returnValue(FRESH);
        recordCommits(() => firebaseError('permission-denied'));
        serverReadsFor({
          [`households/${FRESH}`]: householdDoc({ id: FRESH, ownerId: ME, createdAt: LATER }),
          [`households/${FRESH}/members/${ME}`]: member({ role: 'owner', since: CREATED })
        });

        await expectAsync(service.create('Home')).toBeRejectedWithError(HouseholdError, 'errors.generic');
      });

      it('does not read back a create cut off by the connection', async () => {
        recordCommits(() => firebaseError('unavailable'));
        const reads = serverReadsFor({});

        await expectAsync(service.create('Home')).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
        expect(reads).not.toHaveBeenCalled();
      });

      it('resolves an accept whose second delivery finds its invite consumed', async () => {
        const invited = inviteDoc();
        spyOn(firestore, 'runTransaction').and.callFake((async (update: (tx: unknown) => Promise<unknown>) => {
          // The first delivery lands; its answer is lost, and the same work runs again.
          await update({
            get: () => Promise.resolve({ exists: () => true, data: () => invited }),
            set: () => undefined,
            delete: () => undefined
          });
          firestore.setMockDocument(MEMBER_PATH, member({ since: CREATED }));
          return update({ get: () => Promise.reject(firebaseError('permission-denied')) });
        }) as never);
        readsFor({ [`households/${HID}`]: householdDoc() });

        expect(await service.accept(HID)).toBe('Home');
        expect(firestore.getDocumentFromServerSpy.calls.map(c => c.args[0])).toEqual([MEMBER_PATH]);
      });

      it('resolves an accept another press completed first, judged by the live generation', async () => {
        firestore.setMockDocument(MEMBER_PATH, member({ since: CREATED }));
        firestore.setMockDocument(`households/${HID}`, householdDoc());

        await expectAsync(service.accept(HID)).toBeResolved();
        expect(firestore.getDocumentFromServerSpy.calls.map(c => c.args[0])).toEqual([MEMBER_PATH, `households/${HID}`]);
      });

      it('still says the invite is gone when the member document found is of another generation', async () => {
        firestore.setMockDocument(MEMBER_PATH, member({ since: CREATED }));
        firestore.setMockDocument(`households/${HID}`, householdDoc({ createdAt: LATER }));

        await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.inviteGone');
      });
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

    it('leaves: its member document goes and its index entry is marked ended in one commit, then the entry goes', async () => {
      goLive('member');
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave();

      expect(commits).toEqual([
        [
          { op: 'delete', path: `households/${HID}/members/${ME}` },
          { op: 'update', path: INDEX_PATH, data: { endedAt: serverTimestamp() } }
        ],
        [{ op: 'delete', path: INDEX_PATH }]
      ]);
    });

    it('does not mark an entry that is already marked', async () => {
      goLive('member');
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ endedAt: LATER }) });

      await service.leave();

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`], [`delete ${INDEX_PATH}`]]);
    });

    it('does not mark an entry that is already gone', async () => {
      goLive('member');
      const commits = recordCommits(undefined, { [INDEX_PATH]: null });

      await service.leave();

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`], [`delete ${INDEX_PATH}`]]);
    });

    it('leaves the one household selected, and no other', async () => {
      goLive('member');
      index$.next(twoEntries());
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave();

      expect(commits.flat().map(w => w.path).filter(path => path.includes(HID2))).toEqual([]);
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
      index$.next([]);

      await expectAsync(service.leave()).toBeRejectedWithError(HouseholdError, 'errors.generic');
      await expectAsync(service.invite('sam@example.test')).toBeRejectedWithError(HouseholdError, 'errors.generic');
      expect(firestore.runTransactionSpy.calls.length).toBe(0);
    });

    it('dissolves: the sent invites first, the other members in chunks of four, then the household, its owner document and the end on its entry, then the entry', async () => {
      goLive('owner');
      const others = ['a', 'b', 'c', 'd', 'e', 'f'];
      const reads = serveServerReads({
        'householdInvites?inviterUid': [[inviteDoc({ id: `${HID}_kai` }), inviteDoc({ id: `${HID}_lee` })]],
        [`households/${HID}/members?since`]: [[
          member({ role: 'owner' }),
          ...others.map(uid => member({ uid }))
        ]]
      });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve();

      expect(reads.calls.allArgs()).toEqual([
        ['householdInvites', { where: [{ field: 'inviterUid', op: '==', value: ME }] }],
        [`households/${HID}/members`, { where: [{ field: 'since', op: '==', value: CREATED }] }],
        // The household's plans, none here.
        [`households/${HID}/budgets`, { where: [{ field: 'gen', op: '==', value: CREATED }] }],
        [`households/${HID}/goals`, { where: [{ field: 'gen', op: '==', value: CREATED }] }]
      ]);
      expect(shape(commits)).toEqual([
        [`delete householdInvites/${HID}_kai`, `delete householdInvites/${HID}_lee`],
        ['a', 'b', 'c', 'd'].map(uid => `delete households/${HID}/members/${uid}`),
        ['e', 'f'].map(uid => `delete households/${HID}/members/${uid}`),
        [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`],
        [`delete ${INDEX_PATH}`]
      ]);
      expect(commits[3][2].data).toEqual({ endedAt: serverTimestamp() });
    });

    it('withdraws only the invites into the household it dissolves, not those into another it owns', async () => {
      goLive('owner');
      index$.next([entry({ role: 'owner' }), entry({ id: HID2, role: 'owner', since: CREATED2, joinedAt: LATER })]);
      serveServerReads({
        'householdInvites?inviterUid': [[
          inviteDoc({ id: `${HID}_kai` }),
          inviteDoc({ id: `${HID2}_sam`, householdId: HID2, householdCreatedAt: CREATED2 })
        ]],
        [`households/${HID}/members?since`]: [[member({ role: 'owner' })]]
      });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve();

      const deleted = commits.flat().filter(w => w.path.startsWith('householdInvites/')).map(w => w.path);
      expect(deleted).toEqual([`householdInvites/${HID}_kai`]);
    });

    it('deletes a chunk of invites one by one when one of them is already gone', async () => {
      goLive('owner');
      serveServerReads({
        'householdInvites?inviterUid': [[inviteDoc({ id: `${HID}_kai` }), inviteDoc({ id: `${HID}_lee` })]]
      });
      // The kai invite was consumed meanwhile: any commit deleting it is refused.
      const commits = recordCommits(writes =>
        writes.some(w => w.path === `householdInvites/${HID}_kai`) ? firebaseError('permission-denied') : null,
      { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve();

      expect(shape(commits)).toEqual([
        [`delete householdInvites/${HID}_lee`],
        [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`],
        [`delete ${INDEX_PATH}`]
      ]);
    });

    const GONE = {
      [`households/${HID}`]: firebaseError('permission-denied'),
      [INDEX_PATH]: entry({ role: 'owner' })
    };
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
      expect(shape(commits)).toEqual([
        [`delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`],
        [`delete ${INDEX_PATH}`]
      ]);
      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('finishes a dissolve another tab completed first, when the members read is the step refused', async () => {
      goLive('owner');
      spyOn(firestore, 'getCollectionFromServer').and.callFake((async (path: string) => {
        if (path === 'householdInvites') return [];
        throw firebaseError('permission-denied');
      }) as never);
      // The other tab's index delete landed too: nothing is left to mark.
      const commits = recordCommits(undefined, { ...GONE, [INDEX_PATH]: null });

      await service.dissolve();
      own$.next(confirmed(null));

      expect(shape(commits)).toEqual([[`delete households/${HID}/members/${ME}`], [`delete ${INDEX_PATH}`]]);
      expect(service.lostAccess()).toBeFalse();
      expectNoConsoleNoise();
    });

    it('still fails a dissolve refused while its household is live, and leaves a later loss to be reported', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(refusesTheHousehold, {
        [`households/${HID}`]: householdDoc(),
        [INDEX_PATH]: entry({ role: 'owner' })
      });

      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdError, 'errors.generic');
      own$.next(confirmed(null));

      expect(commits).toEqual([]);
      expect(service.lostAccess()).toBeTrue();
    });

    it('keeps the refusal when whether the household is gone goes unanswered', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(refusesTheHousehold, {
        [`households/${HID}`]: firebaseError('unavailable'),
        [INDEX_PATH]: entry({ role: 'owner' })
      });

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

  describe('the shared rows a membership leaves', () => {
    const OWN_PATH = `households/${HID}/members/${ME}`;
    const GEN_FILTER = { where: [{ field: 'gen', op: '==', value: CREATED }] };

    it('leaves in order: the member document goes and the entry is marked ended, then the shared rows are taken out, then the entry goes', async () => {
      goLive('member');
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave();

      expect(timeline).toEqual([
        `commit delete ${OWN_PATH}, update ${INDEX_PATH}`,
        `cleanup ${HID}`,
        `commit delete ${INDEX_PATH}`
      ]);
    });

    it('deletes the index entry only after the shared rows are out: a failure keeps it for the next tidy, and says the leave itself is done', async () => {
      goLive('member');
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });
      ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));

      await expectAsync(service.leave()).toBeRejectedWithError(HouseholdCleanupError, 'household.errors.cleanup');

      expect(shape(commits)).toEqual([[`delete ${OWN_PATH}`, `update ${INDEX_PATH}`]]);
      // The member document's delete is this account's own leave, not a loss.
      own$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set());
    });

    it('reports a failure before the member document went as the leave failing, and a later loss as a loss', async () => {
      goLive('member');
      recordCommits(() => firebaseError('unavailable'), { [INDEX_PATH]: entry() });

      const leaving = service.leave();

      await expectAsync(leaving).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      await expectAsync(leaving).not.toBeRejectedWithError(HouseholdCleanupError);
      expect(ledger.cleanupMembership).not.toHaveBeenCalled();
      own$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });

    it('says a dissolve whose final commit landed, but whose shared rows are not all out, is done bar those rows', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });
      ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));

      await expectAsync(service.dissolve()).toBeRejectedWithError(HouseholdCleanupError, 'household.errors.cleanup');

      expect(shape(commits).at(-1)).toEqual([`delete households/${HID}`, `delete ${OWN_PATH}`, `update ${INDEX_PATH}`]);
      own$.next(confirmed(null));
      expect(service.lostHouseholds()).toEqual(new Set());
    });

    it('keeps an erasure failing when a membership it ended still has shared rows in the household, and its entry for the retry', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({
        [OWN_PATH]: member(),
        [`households/${HID}`]: householdDoc()
      });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });
      ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));

      await expectAsync(service.deleteAll()).toBeRejectedWithError(HouseholdCleanupError, 'household.errors.cleanup');

      expect(shape(commits)).toEqual([[`delete ${OWN_PATH}`, `update ${INDEX_PATH}`]]);
    });

    it('removes a member, then purges the rows they shared into the household, reporting how far it got', async () => {
      goLive('owner');
      recordCommits();
      const progress = jasmine.createSpy('progress');

      await service.remove('sam', undefined, progress);

      expect(timeline).toEqual([`commit delete households/${HID}/members/sam`, `purgeMember ${HID} sam`]);
      expect(progress).toHaveBeenCalledOnceWith(0, 0);
    });

    it('says a removal whose member is out, but whose shared rows were not all purged, is half done', async () => {
      goLive('owner');
      const commits = recordCommits();
      ledger.purgeMember.and.rejectWith(firebaseError('unavailable'));

      const removal = service.remove('sam');

      await expectAsync(removal).toBeRejectedWithError(HouseholdPurgeError, 'household.errors.purge');
      expect(shape(commits)).toEqual([[`delete households/${HID}/members/sam`]]);
    });

    it("purges a removed member's shared rows again, touching no member document", async () => {
      goLive('owner');
      const commits = recordCommits();

      await service.purgeRemoved('sam');

      expect(commits).toEqual([]);
      expect(ledger.purgeMember).toHaveBeenCalledOnceWith(HID, 'sam', undefined);
    });

    it("refuses a member's purge of another member's rows before asking for it", async () => {
      goLive('member');

      await expectAsync(service.purgeRemoved('alex')).toBeRejectedWithError(HouseholdError, 'household.errors.notOwner');
      expect(ledger.purgeMember).not.toHaveBeenCalled();
    });

    it("dissolves the household's own budgets and goals, each goal's contributions before it, between the members and the final commit", async () => {
      goLive('owner');
      const contributions = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }));
      const reads = serveServerReads({
        [`households/${HID}/members?since`]: [[member({ role: 'owner' }), member({ uid: 'sam' })]],
        [`households/${HID}/budgets?gen`]: [[{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }]],
        [`households/${HID}/goals?gen`]: [[{ id: 'g1' }, { id: 'g2' }]],
        [`households/${HID}/goals/g1/contributions?gen`]: [contributions]
      });
      recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve();

      const plans = [
        ...['b1', 'b2', 'b3'].map(id => `delete households/${HID}/budgets/${id}`),
        ...contributions.map(({ id }) => `delete households/${HID}/goals/g1/contributions/${id}`),
        `delete households/${HID}/goals/g1`,
        `delete households/${HID}/goals/g2`
      ];
      expect(timeline).toEqual([
        `commit delete households/${HID}/members/sam`,
        `commit ${plans.slice(0, LEDGER_PURGE_CHUNK).join(', ')}`,
        `commit ${plans.slice(LEDGER_PURGE_CHUNK).join(', ')}`,
        `commit delete households/${HID}, delete ${OWN_PATH}, update ${INDEX_PATH}`,
        `cleanup ${HID}`,
        `commit delete ${INDEX_PATH}`
      ]);
      const listed = reads.calls.allArgs();
      for (const path of ['budgets', 'goals', 'goals/g1/contributions', 'goals/g2/contributions']) {
        expect(listed).withContext(path).toContain([`households/${HID}/${path}`, GEN_FILTER]);
      }
    });

    it('takes its own shared rows out after a dissolve whose final commit finds the household gone, then the entry', async () => {
      goLive('owner');
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      recordCommits(writes => (writes.some(w => w.path === `households/${HID}`) ? firebaseError('permission-denied') : null), {
        [`households/${HID}`]: firebaseError('permission-denied'),
        [INDEX_PATH]: entry({ role: 'owner' })
      });

      await service.dissolve();

      expect(timeline).toEqual([
        `commit delete ${OWN_PATH}, update ${INDEX_PATH}`,
        `cleanup ${HID}`,
        `commit delete ${INDEX_PATH}`
      ]);
    });

    it("takes an earlier membership's shared rows out of the household before joining it again", async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc());
      let joinWritesAtCleanup = -1;
      ledger.cleanupMembership.and.callFake(async () => {
        joinWritesAtCleanup = firestore.txSetSpy.calls.length;
        return true;
      });

      await service.accept(HID);

      expect(ledger.cleanupMembership).toHaveBeenCalledOnceWith(HID);
      expect(joinWritesAtCleanup).toBe(0);
      expect(firestore.txSetSpy.calls.length).toBe(2);
    });

    it('does not join while the earlier rows could not be taken out', async () => {
      firestore.setMockDocument(`householdInvites/${HID}_${ME}`, inviteDoc());
      ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));

      await expectAsync(service.accept(HID)).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      expect(firestore.txSetSpy.calls.length).toBe(0);
    });

    it('tidies each ended membership in order: marked ended, its shared rows taken out, then its entry deleted', async () => {
      const ended = entry({ id: HID2, since: CREATED2, endedAt: LATER });
      serveServerReads({ [`${INDEX}?`]: [[entry(), ended]] });
      serverReadsFor({});
      recordCommits(undefined, { [INDEX_PATH]: entry(), [`${INDEX}/${HID2}`]: ended });

      expect(await service.tidyEndedMemberships()).toBeTrue();

      expect(timeline).toEqual([
        `commit update ${INDEX_PATH}`,
        `cleanup ${HID}`,
        `commit delete ${INDEX_PATH}`,
        `cleanup ${HID2}`,
        `commit delete ${INDEX}/${HID2}`
      ]);
    });

    it('keeps the entry of a household joined again since the tidy judged it, and reports a later loss of it', async () => {
      goLive();
      serveServerReads({ [`${INDEX}?`]: [[entry({ endedAt: LATER })]] });
      serverReadsFor({});
      recordCommits(undefined, { [INDEX_PATH]: entry({ endedAt: LATER }) });
      // What cleanupMembership answers when the server says, just before the
      // strip, that the account is a member again.
      ledger.cleanupMembership.and.resolveTo(false);

      expect(await service.tidyEndedMemberships()).toBeFalse();
      own$.next(confirmed(null));

      expect(timeline).toEqual([]);
      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });
  });

  describe('an action on the household it was opened for', () => {
    const AS_OPENED = { id: HID, createdAt: CREATED };

    /** Two live memberships, HID2 selected and shown by the time the action starts. */
    function selectSecond(role: HouseholdRole): void {
      goLive(role);
      index$.next([entry({ role }), entry({ id: HID2, role: 'owner', name: 'Flat', since: CREATED2, joinedAt: LATER })]);
      service.select(HID2);
      own2$.next(confirmed(member({ role: 'owner', since: CREATED2, joinedAt: LATER })));
      household2$.next(householdDoc({ id: HID2, name: 'Flat', ownerId: ME, createdAt: CREATED2 }));
      members2$.next([member({ role: 'owner', since: CREATED2, joinedAt: LATER })]);
      expect(service.household()?.id).toBe(HID2);
    }

    it('leaves the household it was asked for, whichever is selected by then', async () => {
      selectSecond('member');
      serverReadsFor({ [`households/${HID}/members/${ME}`]: member() });
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.leave(AS_OPENED);

      expect(timeline).toEqual([
        `commit delete households/${HID}/members/${ME}, update ${INDEX_PATH}`,
        `cleanup ${HID}`,
        `commit delete ${INDEX_PATH}`
      ]);
    });

    it('dissolves only the household it was asked for, never the one selected by then', async () => {
      selectSecond('owner');
      serverReadsFor({ [`households/${HID}/members/${ME}`]: member({ role: 'owner' }) });
      serveServerReads({ [`households/${HID}/members?since`]: [[member({ role: 'owner' })]] });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.dissolve(AS_OPENED);

      expect(commits.flat().map(w => w.path).filter(path => path.includes(HID2))).toEqual([]);
      expect(shape(commits)).toContain([`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`]);
      expect(ledger.cleanupMembership).toHaveBeenCalledOnceWith(HID);
    });

    it('removes, renames and revokes in the household it was asked for', async () => {
      selectSecond('owner');
      serverReadsFor({ [`households/${HID}/members/${ME}`]: member({ role: 'owner' }) });
      const commits = recordCommits();

      await service.remove('sam', AS_OPENED);
      await service.rename('Home again', AS_OPENED);
      await service.revoke(`${HID}_lee`, AS_OPENED);

      expect(shape(commits)).toEqual([
        [`delete households/${HID}/members/sam`],
        [`update households/${HID}`],
        [`delete householdInvites/${HID}_lee`]
      ]);
      expect(ledger.purgeMember).toHaveBeenCalledOnceWith(HID, 'sam', undefined);
    });

    it('reads nothing when the household asked for is the one shown', async () => {
      goLive('owner');
      const reads = serverReadsFor({});
      const commits = recordCommits();

      await service.remove('sam', AS_OPENED);

      expect(reads).not.toHaveBeenCalled();
      expect(shape(commits)).toEqual([[`delete households/${HID}/members/sam`]]);
    });

    it('refuses, before writing anything, a household the account is no longer a member of, or of another generation', async () => {
      selectSecond('owner');
      serverReadsFor({ [`households/${HID}/members/${ME}`]: member({ role: 'owner', since: LATER }) });
      const commits = recordCommits();
      const gone = { id: 'gone', createdAt: CREATED };

      for (const target of [AS_OPENED, gone]) {
        const attempts: [string, () => Promise<unknown>][] = [
          ['leave', () => service.leave(target)],
          ['dissolve', () => service.dissolve(target)],
          ['remove', () => service.remove('sam', target)],
          ['purgeRemoved', () => service.purgeRemoved('sam', target)],
          ['rename', () => service.rename('Flat', target)],
          ['revoke', () => service.revoke(`${target.id}_lee`, target)]
        ];
        for (const [name, attempt] of attempts) {
          await expectAsync(attempt()).withContext(`${name} ${target.id}`)
            .toBeRejectedWithError(HouseholdError, 'household.errors.refused');
        }
      }
      expect(commits).toEqual([]);
      expect(ledger.cleanupMembership).not.toHaveBeenCalled();
      expect(ledger.purgeMember).not.toHaveBeenCalled();
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
      [
        'failed-precondition',
        'too-many',
        `household.errors.inviteeTooMany:${JSON.stringify({ max: MAX_HOUSEHOLDS_PER_ACCOUNT })}`
      ]
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
      // Only the callable's own reasons map to business copy; any other ('elsewhere', an unknown one)
      // gets the generic line.
      for (const reason of ['something-new', 'elsewhere']) {
        invite.and.rejectWith(firebaseError('functions/failed-precondition', { reason }));
        await expectAsync(service.invite('sam@example.test'))
          .withContext(reason)
          .toBeRejectedWithError(HouseholdError, 'errors.generic');
      }
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
      const serverDocuments = spyOn(firestore, 'getDocumentFromServer').and.callThrough();
      const aggregations = spyOn(firestore, 'aggregateFromServer').and.callThrough();

      const attempts: [string, () => Promise<unknown>][] = [
        ['create', () => service.create('Home')],
        ['accept', () => service.accept(HID)],
        ['decline', () => service.decline(HID)],
        ['invite', () => service.invite('sam@example.test')],
        ['revoke', () => service.revoke(`${HID}_sam`)],
        ['rename', () => service.rename('Flat')],
        ['remove', () => service.remove('sam')],
        ['purgeRemoved', () => service.purgeRemoved('sam')],
        ['leave', () => service.leave()],
        ['dissolve', () => service.dissolve()],
        ['tidyEndedMemberships', () => service.tidyEndedMemberships()],
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
      expect(serverDocuments).not.toHaveBeenCalled();
      expect(aggregations).not.toHaveBeenCalled();
      expect(ledger.cleanupMembership).not.toHaveBeenCalled();
      expect(ledger.purgeMember).not.toHaveBeenCalled();
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

  // A membership that ended without this account's own hand (a removal, a
  // dissolve, an ending cut off part-way) leaves its index entry behind, and
  // only the account may delete it.
  describe('tidyEndedMemberships', () => {
    const OWN_PATH = `households/${HID}/members/${ME}`;

    it('ends an entry whose member document the server says is gone: marked ended, then deleted', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      const reads = serverReadsFor({});
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });

      expect(await service.tidyEndedMemberships()).toBeTrue();
      expect(commits).toEqual([
        [{ op: 'update', path: INDEX_PATH, data: { endedAt: serverTimestamp() } }],
        [{ op: 'delete', path: INDEX_PATH }]
      ]);
      expect(reads).toHaveBeenCalledWith(OWN_PATH);
    });

    it('deletes an orphaned member document with its entry once the household is gone', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({ [OWN_PATH]: member() }, [`households/${HID}`]);
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });

      expect(await service.tidyEndedMemberships()).toBeTrue();
      expect(shape(commits)).toEqual([[`delete ${OWN_PATH}`, `update ${INDEX_PATH}`], [`delete ${INDEX_PATH}`]]);
    });

    it('leaves a member document of another generation where it is, and ends the entry', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({ [OWN_PATH]: member({ since: LATER }) });
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.tidyEndedMemberships();

      expect(shape(commits)).toEqual([[`update ${INDEX_PATH}`], [`delete ${INDEX_PATH}`]]);
    });

    // A join of the same household between the judgement and the commit
    // writes the entry again, joinedAt re-stamped, beside a live member
    // document of the same generation.
    it('writes nothing to an entry a rejoin wrote again after it was judged gone', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({});
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ joinedAt: LATER }) });

      expect(await service.tidyEndedMemberships()).toBeFalse();
      expect(commits).toEqual([]);
    });

    it('keeps the member document of a rejoin made after its orphan was judged', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({ [OWN_PATH]: member() }, [`households/${HID}`]);
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ joinedAt: LATER }) });

      await service.tidyEndedMemberships();

      expect(commits).toEqual([]);
    });

    it('writes nothing for an entry another tab ended after it was judged', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({ [OWN_PATH]: member() }, [`households/${HID}`]);
      const commits = recordCommits(undefined, { [INDEX_PATH]: null });

      await service.tidyEndedMemberships();

      expect(commits).toEqual([]);
    });

    it('reports a later loss of a membership whose ending it gave up for a rejoin', async () => {
      goLive();
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({});
      recordCommits(undefined, { [INDEX_PATH]: entry({ joinedAt: LATER }) });

      await service.tidyEndedMemberships();
      own$.next(confirmed(null));

      expect(service.lostHouseholds()).toEqual(new Set([HID]));
    });

    it('only deletes an entry already marked ended', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry({ endedAt: LATER })]] });
      serverReadsFor({});
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ endedAt: LATER }) });

      await service.tidyEndedMemberships();

      expect(shape(commits)).toEqual([[`delete ${INDEX_PATH}`]]);
    });

    it('leaves a live membership alone', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({ [OWN_PATH]: member(), [`households/${HID}`]: householdDoc() });
      const commits = recordCommits();

      expect(await service.tidyEndedMemberships()).toBeFalse();
      expect(commits).toEqual([]);
    });

    // A leave cut off after its member document went: the entry is marked
    // ended, and its shared rows and the entry itself are still to go.
    it('leaves an entry this client is ending, until the next connection', async () => {
      goLive('member');
      serveServerReads({ [`${INDEX}?`]: [[entry({ endedAt: LATER })], [entry({ endedAt: LATER })]] });
      serverReadsFor({});
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry() });
      ledger.cleanupMembership.and.rejectWith(firebaseError('unavailable'));
      await expectAsync(service.leave()).toBeRejectedWithError(HouseholdCleanupError);
      ledger.cleanupMembership.and.resolveTo(true);
      const cutOff = shape(commits);

      expect(await service.tidyEndedMemberships()).withContext('while the leave is its own').toBeFalse();
      expect(shape(commits)).toEqual(cutOff);
      expect(ledger.cleanupMembership).toHaveBeenCalledTimes(1);

      service.disconnect();
      service.connect();

      expect(await service.tidyEndedMemberships()).withContext('on the next connection').toBeTrue();
      expect(shape(commits).slice(cutOff.length)).toEqual([[`delete ${INDEX_PATH}`]]);
      expect(ledger.cleanupMembership).toHaveBeenCalledTimes(2);
    });

    it('ends a membership the page is not showing, which leaves the switcher, the one shown still selected', async () => {
      const flat = entry({ id: HID2, name: 'Flat', since: CREATED2, joinedAt: LATER });
      goLive('member');
      index$.next([entry(), flat]);
      serveServerReads({ [`${INDEX}?`]: [[entry(), flat]] });
      serverReadsFor({
        [`households/${HID}/members/${ME}`]: member(),
        [`households/${HID}`]: householdDoc()
      });
      const commits = recordCommits(undefined, { [`${INDEX}/${HID2}`]: flat });

      expect(await service.tidyEndedMemberships()).toBeTrue();

      expect(shape(commits)).toEqual([[`update ${INDEX}/${HID2}`], [`delete ${INDEX}/${HID2}`]]);
      expect(ledger.cleanupMembership).toHaveBeenCalledOnceWith(HID2);
      // The index listener hears each commit in turn.
      index$.next([entry(), { ...flat, endedAt: LATER }]);
      expect(service.liveMemberships().map(m => m.householdId)).toEqual([HID]);
      index$.next([entry()]);
      expect(service.selectedHouseholdId()).toBe(HID);
      expect(service.status()).toBe('member');
      expect(service.lostAccess()).toBeFalse();
    });

    it("does not report its own tidying as lost access on the page's listener", async () => {
      goLive();
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      serverReadsFor({});
      recordCommits(undefined, { [INDEX_PATH]: entry() });

      await service.tidyEndedMemberships();
      own$.next(confirmed(null));

      expect(service.lostAccess()).toBeFalse();
    });

    it('removes a profile pointer left from before the index, once', async () => {
      serveServerReads({});
      const reads = serverReadsFor({ [`users/${ME}`]: { ...userFixture(), householdId: 'old' } });
      const commits = recordCommits();

      expect(await service.tidyEndedMemberships()).toBeTrue();
      expect(commits).toEqual([[{ op: 'update', path: `users/${ME}`, data: { householdId: deleteField() } }]]);

      expect(await service.tidyEndedMemberships()).toBeFalse();
      expect(reads.calls.allArgs()).toEqual([[`users/${ME}`]]);
      expect(commits.length).toBe(1);
    });

    it('writes nothing with no entry and no pointer', async () => {
      serveServerReads({});
      serverReadsFor({ [`users/${ME}`]: userFixture() });
      const commits = recordCommits();

      expect(await service.tidyEndedMemberships()).toBeFalse();
      expect(commits).toEqual([]);
    });

    it('decides nothing on a read the server did not answer', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry()]] });
      spyOn(firestore, 'getDocumentFromServer').and.rejectWith(firebaseError('unavailable'));
      const commits = recordCommits();

      await expectAsync(service.tidyEndedMemberships()).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      expect(commits).toEqual([]);
    });
  });

  describe('deleteAll', () => {
    const OWNED = HID;
    const JOINED = HID2;
    const ENDED = 'h3';

    it('dissolves an owned household, leaves a joined one and clears an ended one, then deletes the invites to and from the account', async () => {
      const reads = serveServerReads({
        [`${INDEX}?`]: [[
          entry({ id: OWNED, role: 'owner' }),
          entry({ id: JOINED, since: CREATED2 }),
          entry({ id: ENDED, endedAt: LATER })
        ]],
        'householdInvites?inviterUid': [[inviteDoc({ id: `${OWNED}_kai` })]],
        [`households/${OWNED}/members?since`]: [[member({ role: 'owner' }), member({ uid: 'sam' })]],
        'householdInvites?inviteeUid': [[inviteDoc({ id: `other_${ME}`, householdId: 'other' })]]
      });
      serverReadsFor({
        [`households/${OWNED}/members/${ME}`]: member({ role: 'owner' }),
        [`households/${OWNED}`]: householdDoc({ ownerId: ME }),
        [`households/${JOINED}/members/${ME}`]: member({ since: CREATED2 }),
        [`households/${JOINED}`]: householdDoc({ id: JOINED, createdAt: CREATED2 })
      });
      const commits = recordCommits(undefined, {
        [`${INDEX}/${OWNED}`]: entry({ id: OWNED, role: 'owner' }),
        [`${INDEX}/${JOINED}`]: entry({ id: JOINED, since: CREATED2 })
      });

      await service.deleteAll();

      expect(shape(commits)).toEqual([
        [`delete householdInvites/${OWNED}_kai`],
        [`delete households/${OWNED}/members/sam`],
        [`delete households/${OWNED}`, `delete households/${OWNED}/members/${ME}`, `update ${INDEX}/${OWNED}`],
        [`delete ${INDEX}/${OWNED}`],
        [`delete households/${JOINED}/members/${ME}`, `update ${INDEX}/${JOINED}`],
        [`delete ${INDEX}/${JOINED}`],
        [`delete ${INDEX}/${ENDED}`],
        [`delete householdInvites/other_${ME}`]
      ]);
      expect(reads.calls.allArgs()).toContain(
        ['householdInvites', { where: [{ field: 'inviteeUid', op: '==', value: ME }] }]);
      // Each membership's shared rows go after it ends and before its entry.
      expect(timeline.filter(line => line.startsWith('cleanup'))).toEqual([
        `cleanup ${OWNED}`,
        `cleanup ${JOINED}`,
        `cleanup ${ENDED}`
      ]);
      for (const id of [OWNED, JOINED, ENDED]) {
        const entryGone = timeline.indexOf(`commit delete ${INDEX}/${id}`);
        expect(timeline.indexOf(`cleanup ${id}`)).withContext(id).toBe(entryGone - 1);
      }
    });

    describe("the account's contributions to a household's goals", () => {
      const JOINED_OWN = `households/${JOINED}/members/${ME}`;
      const JOINED_ENTRY = `${INDEX}/${JOINED}`;
      const goals = `households/${JOINED}/goals`;
      const GEN2_FILTER = { where: [{ field: 'gen', op: '==', value: CREATED2 }] };
      const joined = () => entry({ id: JOINED, since: CREATED2 });

      function liveJoined(): void {
        serverReadsFor({
          [JOINED_OWN]: member({ since: CREATED2 }),
          [`households/${JOINED}`]: householdDoc({ id: JOINED, createdAt: CREATED2 })
        });
      }

      it('are deleted from a household it only joined, and nobody else\'s, before its member document goes', async () => {
        const mine = Array.from({ length: LEDGER_PURGE_CHUNK }, (_, i) => ({ id: `m${i}`, memberUid: ME }));
        const reads = serveServerReads({
          [`${INDEX}?`]: [[joined()]],
          [`${goals}?gen`]: [[{ id: 'g1' }, { id: 'g2' }]],
          [`${goals}/g1/contributions?gen`]: [[...mine, { id: 'sams', memberUid: 'sam' }]],
          [`${goals}/g2/contributions?gen`]: [[{ id: 'last', memberUid: ME }]]
        });
        liveJoined();
        recordCommits(undefined, { [JOINED_ENTRY]: joined() });

        await service.deleteAll();

        const own = [
          ...mine.map(({ id }) => `delete ${goals}/g1/contributions/${id}`),
          `delete ${goals}/g2/contributions/last`
        ];
        expect(timeline).toEqual([
          `commit ${own.slice(0, LEDGER_PURGE_CHUNK).join(', ')}`,
          `commit ${own.slice(LEDGER_PURGE_CHUNK).join(', ')}`,
          `commit delete ${JOINED_OWN}, update ${JOINED_ENTRY}`,
          `cleanup ${JOINED}`,
          `commit delete ${JOINED_ENTRY}`
        ]);
        const listed = reads.calls.allArgs();
        for (const path of [goals, `${goals}/g1/contributions`, `${goals}/g2/contributions`]) {
          expect(listed).withContext(path).toContain([path, GEN2_FILTER]);
        }
      });

      it('go with the plans when the account owns the household: every member\'s', async () => {
        const owned = entry({ role: 'owner' });
        serveServerReads({
          [`${INDEX}?`]: [[owned]],
          [`households/${HID}/members?since`]: [[member({ role: 'owner' })]],
          [`households/${HID}/goals?gen`]: [[{ id: 'g1' }]],
          [`households/${HID}/goals/g1/contributions?gen`]: [[
            { id: 'mine', memberUid: ME },
            { id: 'sams', memberUid: 'sam' }
          ]]
        });
        serverReadsFor({
          [`households/${HID}/members/${ME}`]: member({ role: 'owner' }),
          [`households/${HID}`]: householdDoc({ ownerId: ME })
        });
        const commits = recordCommits(undefined, { [INDEX_PATH]: owned });

        await service.deleteAll();

        expect(shape(commits)).toEqual([
          [
            `delete households/${HID}/goals/g1/contributions/mine`,
            `delete households/${HID}/goals/g1/contributions/sams`,
            `delete households/${HID}/goals/g1`
          ],
          [`delete households/${HID}`, `delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`],
          [`delete ${INDEX_PATH}`]
        ]);
      });

      it('fail the erasure before the membership ends when they cannot be listed, for the retry', async () => {
        spyOn(firestore, 'getCollectionFromServer').and.callFake((async (path: string) => {
          if (path === INDEX) return [joined()];
          if (path === goals) throw firebaseError('unavailable');
          return [];
        }) as never);
        liveJoined();
        const commits = recordCommits(undefined, { [JOINED_ENTRY]: joined() });

        await expectAsync(service.deleteAll()).toBeRejectedWithError(HouseholdError, 'household.errors.offline');

        expect(commits).toEqual([]);
        expect(ledger.cleanupMembership).not.toHaveBeenCalled();
      });
    });

    it('withdraws each owned household\'s invites with it, and every other sent invite at the end', async () => {
      const kai = inviteDoc({ id: `${OWNED}_kai` });
      const sam = inviteDoc({ id: `${HID2}_sam`, householdId: HID2, householdCreatedAt: CREATED2 });
      // Into a household the index no longer lists: only the sweep at the end finds it.
      const lee = inviteDoc({ id: 'gone_lee', householdId: 'gone' });
      serveServerReads({
        [`${INDEX}?`]: [[
          entry({ id: OWNED, role: 'owner' }),
          entry({ id: HID2, role: 'owner', since: CREATED2, joinedAt: LATER })
        ]],
        'householdInvites?inviterUid': [[kai, sam, lee], [sam, lee], [lee]],
        [`households/${OWNED}/members?since`]: [[member({ role: 'owner' })]],
        [`households/${HID2}/members?since`]: [[member({ role: 'owner', since: CREATED2 })]]
      });
      serverReadsFor({
        [`households/${OWNED}/members/${ME}`]: member({ role: 'owner' }),
        [`households/${OWNED}`]: householdDoc({ ownerId: ME }),
        [`households/${HID2}/members/${ME}`]: member({ role: 'owner', since: CREATED2 }),
        [`households/${HID2}`]: householdDoc({ id: HID2, ownerId: ME, createdAt: CREATED2 })
      });
      const commits = recordCommits(undefined, {
        [`${INDEX}/${OWNED}`]: entry({ id: OWNED, role: 'owner' }),
        [`${INDEX}/${HID2}`]: entry({ id: HID2, role: 'owner', since: CREATED2, joinedAt: LATER })
      });

      await service.deleteAll();

      const invitesDeleted = shape(commits).map(paths => paths.filter(path => path.includes('householdInvites/')))
        .filter(paths => paths.length > 0);
      expect(invitesDeleted).toEqual([
        [`delete householdInvites/${OWNED}_kai`],
        [`delete householdInvites/${HID2}_sam`],
        ['delete householdInvites/gone_lee']
      ]);
    });

    it('forgets the household this device last selected for the account, and only for it', async () => {
      localStorage.setItem(householdSelectionKey(ME), HID);
      localStorage.setItem(householdSelectionKey(OTHER), HID2);
      serveServerReads({});
      recordCommits();

      await service.deleteAll();

      expect(localStorage.getItem(householdSelectionKey(ME))).toBeNull();
      expect(localStorage.getItem(householdSelectionKey(OTHER))).toBe(HID2);
    });

    it('erases this device\'s record of the account\'s shared copies, and only the account\'s', async () => {
      for (const uid of [ME, OTHER]) {
        journalRows(uid, [{ hid: HID, txId: 't1' }]);
        stampSweep(uid, HID, 'full', 1000);
      }
      serveServerReads({});
      recordCommits();

      await service.deleteAll();

      expect(localStorage.getItem(ledgerJournalKey(ME))).toBeNull();
      expect(localStorage.getItem(ledgerSweepKey(ME, HID))).toBeNull();
      expect(readLedgerJournal(OTHER).rows).toEqual([{ hid: HID, txId: 't1' }]);
      expect(localStorage.getItem(ledgerSweepKey(OTHER, HID))).not.toBeNull();
    });

    it('keeps the selection when the erasure fails, for the retry', async () => {
      localStorage.setItem(householdSelectionKey(ME), HID);
      spyOn(firestore, 'getCollectionFromServer').and.rejectWith(firebaseError('unavailable'));

      await expectAsync(service.deleteAll()).toBeRejectedWithError(HouseholdError, 'household.errors.offline');
      expect(localStorage.getItem(householdSelectionKey(ME))).toBe(HID);
    });

    it('erases with device storage out of reach', async () => {
      serveServerReads({});
      recordCommits();
      const removeItem = spyOn(Storage.prototype, 'removeItem').and.throwError('blocked');

      await expectAsync(service.deleteAll()).toBeResolved();
      expect(removeItem).toHaveBeenCalled();
      // The clean-up after each case removes keys through the same call.
      removeItem.and.callThrough();
    });

    it('deletes an owner document whose household is already gone, with its entry', async () => {
      serveServerReads({ [`${INDEX}?`]: [[entry({ role: 'owner' })]] });
      serverReadsFor({ [`households/${HID}/members/${ME}`]: member({ role: 'owner' }) }, [`households/${HID}`]);
      const commits = recordCommits(undefined, { [INDEX_PATH]: entry({ role: 'owner' }) });

      await service.deleteAll();

      expect(shape(commits)).toEqual([
        [`delete households/${HID}/members/${ME}`, `update ${INDEX_PATH}`],
        [`delete ${INDEX_PATH}`]
      ]);
    });

    it('writes nothing with no membership and no invites', async () => {
      const reads = serveServerReads({});
      const commits = recordCommits();

      await service.deleteAll();

      expect(commits).toEqual([]);
      expect(reads.calls.allArgs()).toEqual([
        [INDEX],
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
        ['purgeRemoved', () => service.purgeRemoved('sam')],
        ['leave', () => service.leave()],
        ['dissolve', () => service.dissolve()],
        ['tidyEndedMemberships', () => service.tidyEndedMemberships()],
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
