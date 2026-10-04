import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  WritableSignal,
  createEnvironmentInjector,
  signal
} from '@angular/core';
import { Auth, User as FirebaseUser } from '@angular/fire/auth';
import { FieldValue, Firestore, Timestamp, deleteField } from '@angular/fire/firestore';
import { AuthService, buildNewUserProfile } from './auth.service';
import { User, UserPreferences, DEFAULT_USER_PREFERENCES } from '../../models';
import { TranslationService, SupportedLocale } from './translation.service';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';
import { PAGE_RELOAD } from './page-reload';

describe('buildNewUserProfile', () => {
  const firebaseUser = (overrides: Partial<FirebaseUser>): FirebaseUser =>
    ({
      uid: 'user-1',
      email: 'someone@example.com',
      displayName: 'Someone',
      photoURL: 'https://example.com/avatar.png',
      ...overrides
    }) as FirebaseUser;

  it('copies the full profile when every field is present', () => {
    const profile = buildNewUserProfile(firebaseUser({}), 'en');

    expect(profile.email).toBe('someone@example.com');
    expect(profile.displayName).toBe('Someone');
    expect(profile.photoURL).toBe('https://example.com/avatar.png');
    expect(profile.preferences).toBeDefined();
  });

  it('omits photoURL entirely for a photo-less account', () => {
    // Firestore rejects undefined field values, so the key must be absent —
    // not present with an undefined value.
    const profile = buildNewUserProfile(firebaseUser({ photoURL: null }), 'en');

    expect('photoURL' in profile).toBeFalse();
  });

  it('defaults null email and display name', () => {
    const profile = buildNewUserProfile(firebaseUser({ email: null, displayName: null }), 'en');

    expect(profile.email).toBe('');
    expect(profile.displayName).toBe('User');
  });

  it('seeds the language it is handed, leaving the other defaults alone', () => {
    // The account is created in the language its device asked for, so a first
    // login does not land in English and stay there. Which language that is
    // belongs to the call sites — the create path hands over the device's own
    // detection, the degraded fallback the locale already on screen.
    const profile = buildNewUserProfile(firebaseUser({}), 'ja');

    expect(profile.preferences.language).toBe('ja');
    expect(profile.preferences).toEqual({ ...DEFAULT_USER_PREFERENCES, language: 'ja' });
  });

  it('leaves DEFAULT_USER_PREFERENCES itself untouched', () => {
    buildNewUserProfile(firebaseUser({}), 'tc');

    // The seed is a copy: the shared constant is the resolver-neutral fallback
    // several other call sites spread, and one sign-in must not rewrite it.
    expect(DEFAULT_USER_PREFERENCES.language).toBe('en');
  });
});

describe('AuthService', () => {
  let service: AuthService;
  let mockAuth: jasmine.SpyObj<Auth>;
  let mockFirestore: jasmine.SpyObj<Firestore>;
  let translation: {
    syncFromDatabase: jasmine.Spy;
    t: jasmine.Spy;
    currentLocale: WritableSignal<SupportedLocale>;
    detectedBrowserLocale: SupportedLocale | null;
  };
  let reload: jasmine.Spy;

  beforeEach(() => {
    mockAuth = jasmine.createSpyObj('Auth', ['onAuthStateChanged', 'signOut'], {
      currentUser: null
    });
    // The real SDK hands back the unsubscribe function, and the service holds
    // on to it to release the listener with its injector; a spy left returning
    // undefined would stand for an Auth that cannot be unsubscribed at all.
    mockAuth.onAuthStateChanged.and.returnValue(() => undefined);
    mockFirestore = jasmine.createSpyObj('Firestore', ['doc']);
    translation = {
      syncFromDatabase: jasmine.createSpy('syncFromDatabase'),
      t: jasmine.createSpy('t').and.callFake((k: string) => k),
      currentLocale: signal<SupportedLocale>('en'),
      // Detected by default; the heal specs below turn it off deliberately.
      detectedBrowserLocale: 'en' as SupportedLocale | null
    };
    reload = jasmine.createSpy('reload');

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Auth, useValue: mockAuth },
        { provide: Firestore, useValue: mockFirestore },
        { provide: TranslationService, useValue: translation },
        {
          provide: ThemeService,
          useValue: { init: jasmine.createSpy('init') }
        },
        {
          provide: AccessibilityService,
          useValue: { init: jasmine.createSpy('init') }
        },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info'])
        },
        // Offline by default so the profile-retry effect stays dormant.
        { provide: PwaService, useValue: { isOnline: signal(false) } },
        // A real reload would abort the whole Karma run. The disposal case's
        // child injector resolves the token from here as well.
        { provide: PAGE_RELOAD, useValue: reload }
      ]
    });

    service = TestBed.inject(AuthService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start with null currentUser', () => {
      expect(service.currentUser()).toBeNull();
    });

    it('should start with isLoading true', () => {
      expect(service.isLoading()).toBeTrue();
    });

    it('should start with isAuthenticated false', () => {
      expect(service.isAuthenticated()).toBeFalse();
    });

    it('should start with null userId', () => {
      expect(service.userId()).toBeNull();
    });
  });

  describe('computed signals', () => {
    it('should update isAuthenticated when currentUser changes', () => {
      expect(service.isAuthenticated()).toBeFalse();

      // Simulate user login by directly setting the signal (for testing)
      service.currentUser.set({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: {
          baseCurrency: 'USD',
          language: 'en',
          dateFormat: 'MM/DD/YYYY',
          theme: 'system',
          defaultCategories: []
        }
      });

      expect(service.isAuthenticated()).toBeTrue();
    });

    it('should update userId when currentUser changes', () => {
      expect(service.userId()).toBeNull();

      service.currentUser.set({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: {
          baseCurrency: 'USD',
          language: 'en',
          dateFormat: 'MM/DD/YYYY',
          theme: 'system',
          defaultCategories: []
        }
      });

      expect(service.userId()).toBe('test-user-123');
    });
  });

  describe('signOut', () => {
    it('should set currentUser to null after signOut', async () => {
      // First set a user
      service.currentUser.set({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: {
          baseCurrency: 'USD',
          language: 'en',
          dateFormat: 'MM/DD/YYYY',
          theme: 'system',
          defaultCategories: []
        }
      });

      expect(service.isAuthenticated()).toBeTrue();

      // Simulate signOut
      service.currentUser.set(null);

      expect(service.isAuthenticated()).toBeFalse();
      expect(service.currentUser()).toBeNull();
    });
  });

  describe('isLoading state', () => {
    it('should be able to toggle loading state', () => {
      service.isLoading.set(true);
      expect(service.isLoading()).toBeTrue();

      service.isLoading.set(false);
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('updateUserPreferences', () => {
    it('should throw when no authenticated user', async () => {
      await expectAsync(
        service.updateUserPreferences({ theme: 'dark' })
      ).toBeRejectedWithError('No authenticated user');
    });
  });

  describe('clearUserPreferences', () => {
    it('rejects when no user is signed in', async () => {
      await expectAsync(
        service.clearUserPreferences(['dashboardLayout'])
      ).toBeRejectedWithError('No authenticated user');
    });

    it('resolves without touching Firestore for an empty key list', async () => {
      service.currentUser.set({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: {
          baseCurrency: 'USD',
          language: 'en',
          dateFormat: 'MM/DD/YYYY',
          theme: 'system',
          defaultCategories: []
        }
      });
      const before = service.currentUser();

      await expectAsync(service.clearUserPreferences([])).toBeResolved();

      expect(service.currentUser()).toEqual(before);
    });
  });

  /**
   * The write crosses an await, and the signal can move underneath it. The
   * module-level @angular/fire write cannot be spied on, so the one write the
   * method makes is held open through its private seam and released by hand;
   * the emulator suite checks the same paths against a real document.
   */
  describe('updatePreferenceFields', () => {
    const UID = 'test-user-123';
    const ORDER = ['budgets', 'chart', 'recent', 'upcoming', 'insights'];
    let write: jasmine.Spy;
    let land: () => void;

    const signIn = (preferences: Record<string, unknown> = {}, id = UID) =>
      service.currentUser.set({
        id,
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: { ...DEFAULT_USER_PREFERENCES, ...preferences } as UserPreferences
      });

    const layout = () =>
      service.currentUser()!.preferences.dashboardLayout as unknown as Record<string, unknown>;

    beforeEach(() => {
      write = spyOn(
        service as unknown as {
          writeUserFields: (uid: string, fields: Record<string, unknown>) => Promise<void>;
        },
        'writeUserFields'
      ).and.callFake(() => new Promise<void>(resolve => (land = resolve)));
    });

    it('rejects when no user is signed in', async () => {
      await expectAsync(
        service.updatePreferenceFields('dashboardLayout', { hidden: { set: ['insights'] } })
      ).toBeRejectedWithError('No authenticated user');

      expect(write).not.toHaveBeenCalled();
    });

    it('makes no write for an empty field set', async () => {
      signIn();
      const before = service.currentUser();

      await expectAsync(service.updatePreferenceFields('dashboardLayout', {})).toBeResolved();

      expect(write).not.toHaveBeenCalled();
      expect(service.currentUser()).toBe(before);
    });

    it('writes each field on its own nested path, and a delete as a field delete', async () => {
      signIn();

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] },
        order: { delete: true }
      });

      expect(write).toHaveBeenCalledOnceWith(UID, {
        'preferences.dashboardLayout.hidden': ['insights'],
        'preferences.dashboardLayout.order': jasmine.anything()
      });
      const sent = write.calls.mostRecent().args[1] as Record<string, FieldValue>;
      // Made in an injector, as the zone wrapper otherwise warns.
      const fieldDelete = TestBed.runInInjectionContext(() => deleteField());
      expect(sent['preferences.dashboardLayout.order'].isEqual(fieldDelete)).toBeTrue();
      land();
      await pending;
    });

    it('re-reads the signal after the write, so a theme changed meanwhile survives', async () => {
      signIn({ theme: 'system', dashboardLayout: { order: ORDER, hidden: ['chart'] } });

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      // The theme switch saved while this write was still out.
      service.currentUser.update(user => user && {
        ...user,
        preferences: { ...user.preferences, theme: 'dark' }
      });
      land();
      await pending;

      expect(service.currentUser()!.preferences.theme).toBe('dark');
      expect(layout()).toEqual({ order: ORDER, hidden: ['insights'] });
    });

    it('merges into the map as it stands after the write, keeping a sibling field changed meanwhile', async () => {
      signIn({ dashboardLayout: { hidden: ['chart'] } });

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      service.currentUser.update(user => user && {
        ...user,
        preferences: { ...user.preferences, dashboardLayout: { order: ORDER, hidden: ['chart'] } }
      });
      land();
      await pending;

      expect(layout()).toEqual({ order: ORDER, hidden: ['insights'] });
    });

    it('drops only the deleted field from the signal', async () => {
      signIn({ dashboardLayout: { order: ORDER, hidden: ['chart'] } });

      const pending = service.updatePreferenceFields('dashboardLayout', { hidden: { delete: true } });
      land();
      await pending;

      expect(layout()).toEqual({ order: ORDER });
    });

    it('replaces a local value that is not a map', async () => {
      signIn({ dashboardLayout: 'not-a-map' });

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      land();
      await pending;

      expect(layout()).toEqual({ hidden: ['insights'] });
    });

    it('leaves the signal alone when the session ended during the write', async () => {
      signIn();

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      service.currentUser.set(null);
      land();
      await pending;

      expect(service.currentUser()).toBeNull();
    });

    it('leaves the signal alone when another account signed in during the write', async () => {
      signIn();

      const pending = service.updatePreferenceFields('dashboardLayout', {
        hidden: { set: ['insights'] }
      });
      signIn({}, 'user-2');
      const next = service.currentUser();
      land();
      await pending;

      expect(service.currentUser()).toBe(next);
    });
  });

  /**
   * Every profile and preference write crosses an await, and another write
   * can land while it is out: a card hidden while a theme switch is saving.
   * Each write here is held open through the private seam and released in
   * the order the case names.
   */
  describe('a write that lands after the signal moved', () => {
    const UID = 'test-user-123';
    let seam: jasmine.Spy;
    let writes: (() => void)[];

    const signIn = (preferences: Record<string, unknown>, id = UID) =>
      service.currentUser.set({
        id,
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: Timestamp.now(),
        lastLoginAt: Timestamp.now(),
        preferences: { ...DEFAULT_USER_PREFERENCES, ...preferences } as UserPreferences
      });

    const prefs = () => service.currentUser()!.preferences as unknown as Record<string, unknown>;

    const hideChart = () =>
      service.updatePreferenceFields('dashboardLayout', { hidden: { set: ['chart'] } });

    interface Writer {
      name: string;
      seed: Record<string, unknown>;
      write: () => Promise<void>;
      sends: Record<string, unknown>;
      /** Another write sent after this one, which lands first. */
      meanwhile: () => Promise<void>;
      applied: () => void;
      kept: () => void;
    }

    const writers: Writer[] = [
      {
        name: 'updateUserPreferences',
        seed: { theme: 'light' },
        write: () => service.updateUserPreferences({ theme: 'dark' }),
        sends: { 'preferences.theme': 'dark' },
        meanwhile: hideChart,
        applied: () => expect(prefs()['theme']).toBe('dark'),
        kept: () => expect(prefs()['dashboardLayout']).toEqual({ hidden: ['chart'] })
      },
      {
        name: 'clearUserPreferences',
        seed: { theme: 'light', dashboardLayout: { hidden: ['insights'] } },
        write: () => service.clearUserPreferences(['dashboardLayout']),
        sends: { 'preferences.dashboardLayout': jasmine.anything() },
        meanwhile: () => service.updateUserPreferences({ theme: 'dark' }),
        applied: () => expect('dashboardLayout' in prefs()).toBeFalse(),
        kept: () => expect(prefs()['theme']).toBe('dark')
      },
      {
        name: 'updateUserProfile',
        seed: {},
        write: () => service.updateUserProfile({ displayName: 'Renamed' }),
        sends: { displayName: 'Renamed' },
        meanwhile: hideChart,
        applied: () => expect(service.currentUser()!.displayName).toBe('Renamed'),
        kept: () => expect(prefs()['dashboardLayout']).toEqual({ hidden: ['chart'] })
      },
      {
        name: 'clearStoredProviderApiKeys',
        seed: { geminiApiKey: 'g', openaiApiKey: 'o', claudeApiKey: 'c' },
        write: () => service.clearStoredProviderApiKeys(),
        sends: {
          'preferences.geminiApiKey': jasmine.anything(),
          'preferences.openaiApiKey': jasmine.anything(),
          'preferences.claudeApiKey': jasmine.anything()
        },
        meanwhile: hideChart,
        applied: () =>
          expect(Object.keys(prefs()).filter(key => key.endsWith('ApiKey'))).toEqual([]),
        kept: () => expect(prefs()['dashboardLayout']).toEqual({ hidden: ['chart'] })
      }
    ];

    beforeEach(() => {
      writes = [];
      seam = spyOn(
        service as unknown as {
          writeUserFields: (uid: string, fields: Record<string, unknown>) => Promise<void>;
        },
        'writeUserFields'
      ).and.callFake(() => new Promise<void>(resolve => writes.push(resolve)));
    });

    for (const writer of writers) {
      describe(writer.name, () => {
        it('keeps what another write changed meanwhile, and applies its own change', async () => {
          signIn(writer.seed);

          const pending = writer.write();
          const other = writer.meanwhile();
          writes[1]();
          await other;
          writes[0]();
          await pending;

          expect(seam.calls.first().args).toEqual([UID, writer.sends]);
          writer.applied();
          writer.kept();
        });

        it('leaves the signal alone when the session ended during the write', async () => {
          signIn(writer.seed);

          const pending = writer.write();
          service.currentUser.set(null);
          writes[0]();
          await pending;

          expect(service.currentUser()).toBeNull();
        });

        it('leaves the signal alone when another account signed in during the write', async () => {
          signIn(writer.seed);

          const pending = writer.write();
          signIn(writer.seed, 'user-2');
          const next = service.currentUser();
          writes[0]();
          await pending;

          expect(service.currentUser()).toBe(next);
        });
      });
    }
  });

  describe('signed-out guards', () => {
    it('updateUserProfile rejects when no user is signed in', async () => {
      await expectAsync(
        service.updateUserProfile({ displayName: 'X' })
      ).toBeRejectedWithError('No authenticated user');
    });

    it('clearStoredProviderApiKeys rejects when no user is signed in', async () => {
      await expectAsync(
        service.clearStoredProviderApiKeys()
      ).toBeRejectedWithError('No authenticated user');
    });
  });

  /**
   * The Google account's language is the second link of the chain: OS/browser
   * language first, the provider profile only when the browser named a
   * language we do not ship, and 'en' when neither answers.
   *
   * It is applied as a heal after the profile exists rather than as a branch
   * of the creation path, because the popup result and the auth-state listener
   * race to create the document — whichever wins, the patch lands afterwards.
   * Driven through the private seam directly: the sign-in methods it sits in
   * call module-level @angular/fire functions that cannot be spied on, and the
   * emulator smoke suite covers those.
   */
  describe('adopting the Google account language on a first sign-in', () => {
    let updatePreferences: jasmine.Spy;

    const created = (language: string): User =>
      ({
        id: 'user-1',
        preferences: { ...DEFAULT_USER_PREFERENCES, language }
      }) as User;

    const heal = (
      user: User,
      additional: { isNewUser: boolean; profile?: Record<string, unknown> | null } | null
    ): Promise<User> =>
      (
        service as unknown as {
          healLanguageFromGoogleProfile: (
            user: User,
            additional: { isNewUser: boolean; profile?: Record<string, unknown> | null } | null
          ) => Promise<User>;
        }
      ).healLanguageFromGoogleProfile(user, additional);

    const googleSays = (locale: unknown, isNewUser = true) => ({
      isNewUser,
      profile: { locale } as Record<string, unknown>
    });

    beforeEach(() => {
      updatePreferences = spyOn(service, 'updateUserPreferences').and.resolveTo();
      translation.detectedBrowserLocale = null;
    });

    it('patches the profile to the Google language when nothing was detected', async () => {
      const healed = await heal(created('en'), googleSays('ja-JP'));

      expect(updatePreferences).toHaveBeenCalledWith({ language: 'ja' });
      // Returned as well as written: the caller hands this profile back to
      // whoever asked for the sign-in.
      expect(healed.preferences.language).toBe('ja');
    });

    it('leaves a browser-detected language alone', async () => {
      translation.detectedBrowserLocale = 'en';

      const healed = await heal(created('en'), googleSays('ja-JP'));

      // The device's own language outranks the account's; only an undetectable
      // one hands the turn over.
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(healed.preferences.language).toBe('en');
    });

    it('leaves the default alone when the Google language has no catalog', async () => {
      await heal(created('en'), googleSays('fr-FR'));

      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('ignores a returning user', async () => {
      await heal(created('en'), googleSays('ja-JP', false));

      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('writes nothing when the Google language is already the profile language', async () => {
      await heal(created('ja'), googleSays('ja'));

      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('ignores a sign-in that carries no provider information at all', async () => {
      await heal(created('en'), null);

      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('ignores a provider profile with no locale key', async () => {
      await heal(created('en'), { isNewUser: true, profile: {} });

      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('does not wait for the write, so a stalled one cannot hang the sign-in', async () => {
      // Offline, a Firestore write settles only on reconnect. LoginComponent
      // navigates on the sign-in promise this heal is the tail of, so awaiting
      // the write would leave a real, signed-in session on the login spinner
      // for as long as the network is gone. This case times out if the await
      // ever comes back.
      updatePreferences.and.returnValue(new Promise<void>(() => undefined));

      const healed = await heal(created('en'), googleSays('ja-JP'));

      expect(updatePreferences).toHaveBeenCalledWith({ language: 'ja' });
      // Optimistic: the caller is handed the language that is on its way to
      // the document, not the one that was there before.
      expect(healed.preferences.language).toBe('ja');
    });

    it('keeps the sign-in whole when the patch cannot be written', async () => {
      spyOn(console, 'error');
      updatePreferences.and.rejectWith(new Error('offline'));

      const healed = await heal(created('en'), googleSays('ja-JP'));
      // The rejection lands on the fired promise's own handler, after the
      // caller already has its answer.
      await new Promise(resolve => setTimeout(resolve, 0));

      // The account exists and the session is real; failing to adopt a
      // language must not turn a completed sign-in into a rejected one — and
      // an unhandled rejection here would fail the suite.
      expect(healed.preferences.language).toBe('ja');
      expect(console.error).toHaveBeenCalledWith(
        '[Auth] Could not adopt the Google account language:',
        jasmine.any(Error)
      );
    });
  });

  /**
   * A profile read crosses an await, and the session can end underneath it.
   * Served from the local cache the read resolves happily after a sign-out,
   * and writing the answer back left the app holding a signed-in identity
   * with no Firebase session behind it.
   *
   * These drive the interleaving by hand rather than racing for it: the
   * profile read is replaced with a promise this spec resolves itself, so
   * where the sign-out lands relative to the answer is decided here and not
   * by timing. The emulator-backed spec covers the same invariant with a real
   * Firestore read; the exact orderings only exist here.
   */
  describe('session identity across a profile read', () => {
    const UID = 'user-1';
    const OTHER_UID = 'user-2';

    let liveSession: jasmine.Spy;
    let notifications: jasmine.SpyObj<NotificationService>;
    let pwa: { isOnline: ReturnType<typeof signal<boolean>> };
    let resolveRead: (user: unknown) => void;
    let rejectRead: (error: unknown) => void;
    let readStarted: jasmine.Spy;

    /** The uid the SDK reports as signed in right now; null once signed out. */
    const signedInAs = (uid: string | null) =>
      liveSession.and.returnValue(uid ? ({ uid } as FirebaseUser) : null);

    /** The auth-state callback the listener registered, whatever slot it took. */
    const listenerCallback = () =>
      mockAuth.onAuthStateChanged.calls.mostRecent().args
        .find(arg => typeof arg === 'function') as (user: FirebaseUser | null) => Promise<void>;

    /** Let every .then/.catch/.finally in the chain run. */
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    const storedProfile = (uid: string) => ({ id: uid, displayName: 'Stored Name' });

    beforeEach(() => {
      spyOn(console, 'error');
      liveSession = Object.getOwnPropertyDescriptor(mockAuth, 'currentUser')!.get as jasmine.Spy;
      notifications = TestBed.inject(NotificationService) as jasmine.SpyObj<NotificationService>;
      pwa = TestBed.inject(PwaService) as unknown as {
        isOnline: ReturnType<typeof signal<boolean>>;
      };

      readStarted = spyOn(
        service as unknown as { getOrCreateUser: (u: FirebaseUser) => Promise<unknown> },
        'getOrCreateUser'
      ).and.returnValue(new Promise((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      }));
    });

    /** Put the session on the fallback profile with a retry armed and running. */
    const startRetryFor = (uid: string) => {
      signedInAs(uid);
      service.firebaseUser.set({ uid } as FirebaseUser);
      service.currentUser.set({ id: uid } as never);
      service.profileDegraded.set(true);
      pwa.isOnline.set(true);
      TestBed.tick();
      // Anti-vacuity: the mock reports nobody signed in by default, so a
      // misplaced guard would keep every retry from starting and leave the
      // negative cases below passing for the wrong reason.
      expect(readStarted).toHaveBeenCalled();
    };

    it('does not install a profile read for a session that has ended', async () => {
      startRetryFor(UID);

      signedInAs(null);
      service.currentUser.set(null);
      resolveRead(storedProfile(UID));
      await settle();

      expect(service.currentUser()).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
    });

    it('leaves the degraded flag alone when it abandons a stale read', async () => {
      startRetryFor(UID);

      signedInAs(null);
      service.currentUser.set(null);
      resolveRead(storedProfile(UID));
      await settle();

      // Clearing it here would hand the next sign-in to this account a
      // not-degraded flag over a fallback profile, with nothing left to
      // trigger a re-read.
      expect(service.profileDegraded()).toBeTrue();
    });

    it('does not install a profile read for the account that has just been replaced', async () => {
      startRetryFor(UID);

      signedInAs(OTHER_UID);
      resolveRead(storedProfile(UID));
      await settle();

      // The answer belonged to the previous account and is discarded; what
      // the new session sees is installed by its own listener callback, not
      // by a read the departed session started.
      expect(service.currentUser()?.displayName).toBeUndefined();
      expect(service.profileDegraded()).toBeTrue();
    });

    it('still swaps in the real profile when the session has not changed', async () => {
      startRetryFor(UID);

      resolveRead(storedProfile(UID));
      await settle();

      expect(service.currentUser()?.displayName).toBe('Stored Name');
      expect(service.profileDegraded()).toBeFalse();
    });

    it('treats a refreshed token for the same account as the same session', async () => {
      startRetryFor(UID);

      // A refresh hands over a different object for the same person; keying
      // the check on identity rather than uid would abandon a good read.
      signedInAs(UID);
      resolveRead(storedProfile(UID));
      await settle();

      expect(service.currentUser()?.displayName).toBe('Stored Name');
      expect(service.profileDegraded()).toBeFalse();
    });

    it('signs back in to the same account without a reload after a sign-out mid-retry', async () => {
      startRetryFor(UID);

      signedInAs(null);
      service.currentUser.set(null);
      resolveRead(storedProfile(UID));
      await settle();
      expect(service.isAuthenticated()).toBeFalse();

      // Signing back in: the listener fires for the same account and its own
      // read succeeds. Nothing inherited from the abandoned session may make
      // this one degraded or leave it on a fallback profile.
      signedInAs(UID);
      readStarted.and.resolveTo(storedProfile(UID));
      await listenerCallback()({ uid: UID } as FirebaseUser);

      expect(service.currentUser()?.displayName).toBe('Stored Name');
      expect(service.profileDegraded()).toBeFalse();
      expect(service.isLoading()).toBeFalse();
    });

    it('does not write a listener read that resolved after the session ended', async () => {
      const pending = listenerCallback()({ uid: UID } as FirebaseUser);
      expect(readStarted).toHaveBeenCalled();

      signedInAs(null);
      resolveRead(storedProfile(UID));
      await pending;

      expect(service.currentUser()).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
      // The early-return shape would have stranded this, and publicGuard
      // waits on it for ten seconds before deciding anything.
      expect(service.isLoading()).toBeFalse();
    });

    it('raises no degraded profile for a session that has already ended', async () => {
      const pending = listenerCallback()({ uid: UID } as FirebaseUser);
      expect(readStarted).toHaveBeenCalled();

      signedInAs(null);
      rejectRead(new Error('offline'));
      await pending;

      expect(service.currentUser()).toBeNull();
      expect(service.profileDegraded()).toBeFalse();
      // Telling someone who has just signed out that their profile could not
      // be loaded is the second, smaller defect on this path.
      expect(notifications.error).not.toHaveBeenCalled();
      expect(service.isLoading()).toBeFalse();
    });

    it('seeds the degraded fallback profile from the locale already on screen', async () => {
      // The other buildNewUserProfile call site, and deliberately the other
      // source: this profile is never written, and its whole job is to leave
      // the UI in the language it is already showing — so it reads
      // currentLocale() even where the device detected nothing. The create
      // path reads detectedBrowserLocale instead; that half is pinned in the
      // emulator smoke suite, the only place getOrCreateUser really runs.
      translation.currentLocale.set('ja');
      translation.detectedBrowserLocale = null;
      signedInAs(UID);

      const pending = listenerCallback()({ uid: UID } as FirebaseUser);
      rejectRead(new Error('offline'));
      await pending;

      expect(service.profileDegraded()).toBeTrue();
      expect(service.currentUser()!.preferences.language).toBe('ja');
    });

    it('re-arms for the account that replaced the one whose read it abandoned', async () => {
      startRetryFor(UID);

      signedInAs(OTHER_UID);
      service.firebaseUser.set({ uid: OTHER_UID } as FirebaseUser);
      TestBed.tick();
      expect(readStarted).toHaveBeenCalledTimes(1);

      readStarted.and.returnValue(new Promise(() => undefined));
      resolveRead(storedProfile(UID));
      await settle();
      TestBed.tick();

      expect(readStarted).toHaveBeenCalledTimes(2);
      expect(readStarted.calls.mostRecent().args[0].uid).toBe(OTHER_UID);
      expect(pwa.isOnline()).toBeTrue();
    });

    it('does not re-arm after a failed read', async () => {
      startRetryFor(UID);

      rejectRead(new Error('x'));
      await settle();
      TestBed.tick();

      expect(readStarted).toHaveBeenCalledTimes(1);

      pwa.isOnline.set(false);
      pwa.isOnline.set(true);
      TestBed.tick();

      expect(readStarted).toHaveBeenCalledTimes(2);

      // The flip's own read rejects too, and its handler is three turns down
      // the chain: without this the rejection is reported after the case has
      // ended and the console spy has been restored, so the failure surfaces
      // in whichever case runs next.
      await settle();
    });
  });

  /**
   * Another tab on the origin can move the session straight from one account
   * to another, sign it out or sign it in, and the SDK hands every one of
   * those to this page's listener like a change of its own. Once its first
   * state has been delivered, a page reloads on any account change it did not
   * start (ADR 0163), writing nothing of the incoming account first.
   *
   * Driven through the captured listener, a delivery at a time; the reload is
   * the PAGE_RELOAD spy this suite provides, so nothing really reloads. The
   * baseline is the uid the listener was last handed, never the firebaseUser
   * signal, which other cases in this suite write by hand.
   */
  describe('an account change this page did not start', () => {
    let liveSession: jasmine.Spy;
    let readStarted: jasmine.Spy;

    /** The uid the SDK reports as signed in right now; null once signed out. */
    const signedInAs = (uid: string | null) =>
      liveSession.and.returnValue(uid ? ({ uid } as FirebaseUser) : null);

    /** The auth-state callback the listener registered, whatever slot it took. */
    const listenerCallback = () =>
      mockAuth.onAuthStateChanged.calls.mostRecent().args
        .find(arg => typeof arg === 'function') as (user: FirebaseUser | null) => Promise<void>;

    /** The SDK moves to `uid` (null: signed out) and hands that to the listener. */
    const deliver = (uid: string | null) => {
      signedInAs(uid);
      return listenerCallback()(uid ? ({ uid } as FirebaseUser) : null);
    };

    /**
     * One of the page's own SDK calls, run inside the marker the service runs
     * them in. The SDK hands the change to the listener before the call
     * resolves, which is what `deliver` inside it stands for.
     */
    const own = <T>(change: () => Promise<T>): Promise<T> =>
      (
        service as unknown as { ownAccountChange: (change: () => Promise<T>) => Promise<T> }
      ).ownAccountChange(change);

    beforeEach(() => {
      liveSession = Object.getOwnPropertyDescriptor(mockAuth, 'currentUser')!.get as jasmine.Spy;
      readStarted = spyOn(
        service as unknown as { getOrCreateUser: (u: FirebaseUser) => Promise<unknown> },
        'getOrCreateUser'
      ).and.callFake((u: FirebaseUser) => Promise.resolve({ id: u.uid }));
      // An @angular/fire call made from a spec body is outside any injection
      // context, which the library warns about once per run.
      spyOn(console, 'warn');
    });

    it('reloads nothing for the first state it is handed, signed out', async () => {
      await deliver(null);

      expect(reload).not.toHaveBeenCalled();
      // A pin: the callback ran to its end; a first delivery never returns early.
      expect(service.isLoading()).toBeFalse();
    });

    it('reloads nothing for the first state it is handed, signed in', async () => {
      await deliver('alex');

      // A pin: the first state, signed in, is installed as it always was.
      expect(reload).not.toHaveBeenCalled();
      expect(service.currentUser()?.id).toBe('alex');
    });

    it('reloads once when the account moves to another with no sign-out between', async () => {
      await deliver('alex');
      await deliver('sam');

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('installs nothing of the incoming account on a page it is about to replace', async () => {
      await deliver('alex');
      await deliver('sam');

      // No profile read for sam, so no lastLoginAt bump for an account this
      // page never showed, and every signal stays on the account being left.
      expect(readStarted).toHaveBeenCalledTimes(1);
      expect(readStarted.calls.mostRecent().args[0].uid).toBe('alex');
      expect(service.firebaseUser()?.uid).toBe('alex');
      expect(service.currentUser()?.id).toBe('alex');
    });

    it('reloads once when another tab signs the account out', async () => {
      await deliver('alex');
      await deliver(null);

      expect(reload).toHaveBeenCalledTimes(1);
      expect(service.currentUser()?.id).toBe('alex');
    });

    it('reloads once when another tab signs in on a page that started signed out', async () => {
      await deliver(null);
      await deliver('sam');

      expect(reload).toHaveBeenCalledTimes(1);
      expect(readStarted).not.toHaveBeenCalled();
    });

    it("reloads at most once in a page's life", async () => {
      await deliver('alex');
      await deliver('sam');
      await deliver('kai');

      expect(reload).toHaveBeenCalledTimes(1);
      expect(service.firebaseUser()?.uid).toBe('alex');
    });

    it('does not reload when the same account is handed over again', async () => {
      // A pin: the SDK's registration emit reads its current user a
      // microtask late, so a change landing just after start-up can hand the
      // listener the same account twice.
      await deliver('alex');
      await deliver('alex');

      expect(reload).not.toHaveBeenCalled();
      expect(readStarted).toHaveBeenCalledTimes(2);
    });

    it('where the platform has no reload, a foreign sign-out still runs the null branch', async () => {
      // A pin: on a device, where the token is null (page-reload.ts), a
      // session the SDK ends itself must still reach the signed-out edge the
      // per-account services reset on. A child injector, so the null seam is
      // this instance's alone; its listener is the one registered most
      // recently.
      const injector = createEnvironmentInjector(
        [AuthService, { provide: PAGE_RELOAD, useValue: null }],
        TestBed.inject(EnvironmentInjector)
      );
      try {
        const device = injector.get(AuthService);
        // The child's own read: the mock Firestore would otherwise throw into
        // the listener's catch and log a degraded profile.
        spyOn(
          device as unknown as { getOrCreateUser: (u: FirebaseUser) => Promise<unknown> },
          'getOrCreateUser'
        ).and.callFake((u: FirebaseUser) => Promise.resolve({ id: u.uid }));

        await deliver('alex');
        expect(device.currentUser()?.id)
          .withContext("the child's listener was handed the first state")
          .toBe('alex');
        await deliver(null);

        expect(device.firebaseUser()).toBeNull();
        expect(device.currentUser()).toBeNull();
        expect(reload).not.toHaveBeenCalled();
      } finally {
        injector.destroy();
      }
    });

    it("settles isLoading when the account changes while the first state's profile read is still out", async () => {
      let resolveRead!: (user: unknown) => void;
      readStarted.and.returnValue(new Promise(resolve => (resolveRead = resolve)));

      const first = deliver('alex');
      const second = deliver('sam');
      expect(reload).toHaveBeenCalledTimes(1);

      resolveRead({ id: 'alex' });
      await Promise.all([first, second]);

      // The change returned before writing anything, so the flag publicGuard
      // waits on is settled by the first delivery's own tail; the
      // session-identity guard there refuses alex's answer, the SDK being on
      // sam by then.
      expect(service.isLoading()).toBeFalse();
      expect(service.currentUser()).toBeNull();
      expect(readStarted).toHaveBeenCalledTimes(1);
    });

    it('does not reload for its own sign-out', async () => {
      await deliver('alex');
      mockAuth.signOut.and.callFake(() => deliver(null));

      await service.signOut();

      expect(reload).not.toHaveBeenCalled();
      expect(service.firebaseUser()).toBeNull();
    });

    it('does not reload for its own account deletion', async () => {
      await deliver('alex');
      // The SDK's delete ends in its own sign-out, handed to the listener
      // before the delete resolves.
      const remove = jasmine.createSpy('delete').and.callFake(() => deliver(null));
      liveSession.and.returnValue({ uid: 'alex', delete: remove } as unknown as FirebaseUser);

      await service.deleteFirebaseUser();

      expect(remove).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
      expect(service.firebaseUser()).toBeNull();
    });

    it('does not reload for the sign-out a refused deletion ends in', async () => {
      // A pin: a deletion the SDK refuses because the session is no longer
      // valid signs the session out first and only then rejects, and that
      // sign-out is still under the marker.
      await deliver('alex');
      const remove = jasmine.createSpy('delete').and.callFake(async () => {
        await deliver(null);
        throw new Error('auth/user-token-expired');
      });
      liveSession.and.returnValue({ uid: 'alex', delete: remove } as unknown as FirebaseUser);

      await expectAsync(service.deleteFirebaseUser()).toBeRejectedWithError(
        'auth/user-token-expired'
      );

      expect(reload).not.toHaveBeenCalled();
      expect(service.firebaseUser()).toBeNull();
    });

    it('does not reload for its own sign-in', async () => {
      await deliver(null);

      await own(() => deliver('sam'));

      expect(reload).not.toHaveBeenCalled();
      expect(service.currentUser()?.id).toBe('sam');
    });

    it('leaves nothing armed after its own sign-in fails', async () => {
      await deliver(null);

      await expectAsync(own(() => Promise.reject(new Error('auth/popup-closed-by-user'))))
        .toBeRejectedWithError('auth/popup-closed-by-user');
      await deliver('sam');

      // Anti-vacuity, the partner of 'does not reload for its own sign-in': a
      // sign-in that never happened is no cover for one from elsewhere.
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('hands the popup sign-in to the same marker', async () => {
      // A pin: the marker's stand-in runs the change it is handed, as the
      // marker does. Against this Auth double the real popup call rejects
      // before any window opens, and the failure has to arrive inside the
      // change: a popup call made after the marker came down would leave the
      // change resolved and fail outside it. Nothing is read when the sign-in
      // fails.
      let failedInside: unknown;
      const marker = spyOn(
        service as unknown as {
          ownAccountChange: (change: () => Promise<unknown>) => Promise<unknown>;
        },
        'ownAccountChange'
      ).and.callFake(async change => {
        try {
          return await change();
        } catch (error) {
          failedInside = error;
          throw error;
        }
      });

      await expectAsync(service.signInWithGoogle()).toBeRejected();

      expect(marker).toHaveBeenCalledOnceWith(jasmine.any(Function));
      expect(failedInside).withContext('the popup call failed inside the marker').toBeDefined();
      expect(readStarted).not.toHaveBeenCalled();
    });

    it('leaves nothing armed after its own sign-out fails', async () => {
      spyOn(console, 'error');
      await deliver('alex');
      mockAuth.signOut.and.rejectWith(new Error('network'));

      await expectAsync(service.signOut()).toBeRejectedWithError('network');
      await deliver(null);

      // Anti-vacuity, the partner of 'does not reload for its own sign-out': a
      // sign-out that never happened is no cover for one from elsewhere.
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('its own sign-out and sign-in to another account reload nothing', async () => {
      // The switch a person makes in one tab: out of one account, then into
      // another, both started here.
      await deliver('alex');
      mockAuth.signOut.and.callFake(() => deliver(null));

      await service.signOut();
      await own(() => deliver('sam'));

      expect(reload).not.toHaveBeenCalled();
      expect(service.currentUser()?.id).toBe('sam');
    });
  });

  /**
   * The listener outliving its own injector is what a whole smoke block had to
   * work around: @angular/fire binds the callback to the injector active at the
   * call, so an auth transition arriving after that injector is destroyed is
   * delivered into a dead one — NG0205, thrown inside the SDK's own observer,
   * which catches and logs it. The app builds a single long-lived service and
   * never notices; tests build one per spec.
   */
  describe('auth-state listener disposal', () => {
    // A child of the TestBed injector, so destroying it for one spec cannot
    // reach the root injector the rest of the suite depends on. Same pattern
    // as analytics-transport.spec.ts, for the same reason.
    const childInjector = () =>
      createEnvironmentInjector([AuthService], TestBed.inject(EnvironmentInjector));

    it('releases the listener when the injector that registered it is destroyed', () => {
      const unsubscribe = jasmine.createSpy('unsubscribe');
      mockAuth.onAuthStateChanged.and.returnValue(unsubscribe);
      const registrations = mockAuth.onAuthStateChanged.calls.count();
      const injector = childInjector();

      injector.get(AuthService);

      // Exactly one listener for the instance, and it is still live: an
      // unsubscribe called at construction would satisfy the assertion below
      // while leaving the service deaf.
      expect(mockAuth.onAuthStateChanged.calls.count()).toBe(registrations + 1);
      expect(unsubscribe).not.toHaveBeenCalled();

      injector.destroy();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
