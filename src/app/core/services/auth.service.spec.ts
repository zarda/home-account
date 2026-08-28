import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { Auth, User as FirebaseUser } from '@angular/fire/auth';
import { Firestore, Timestamp } from '@angular/fire/firestore';
import { AuthService, buildNewUserProfile } from './auth.service';
import { User, DEFAULT_USER_PREFERENCES } from '../../models';
import { TranslationService, SupportedLocale } from './translation.service';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';

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
    // The account is created in whatever language the app is already speaking,
    // so a first login does not land in English and stay there.
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

  beforeEach(() => {
    mockAuth = jasmine.createSpyObj('Auth', ['onAuthStateChanged'], {
      currentUser: null
    });
    mockFirestore = jasmine.createSpyObj('Firestore', ['doc']);
    translation = {
      syncFromDatabase: jasmine.createSpy('syncFromDatabase'),
      t: jasmine.createSpy('t').and.callFake((k: string) => k),
      currentLocale: signal<SupportedLocale>('en'),
      // Detected by default; the heal specs below turn it off deliberately.
      detectedBrowserLocale: 'en' as SupportedLocale | null
    };

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
        { provide: PwaService, useValue: { isOnline: signal(false) } }
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

    it('keeps the sign-in whole when the patch cannot be written', async () => {
      spyOn(console, 'error');
      updatePreferences.and.rejectWith(new Error('offline'));

      const healed = await heal(created('en'), googleSays('ja-JP'));

      // The account exists and the session is real; failing to adopt a
      // language must not turn a completed sign-in into a rejected one.
      expect(healed.preferences.language).toBe('en');
      expect(console.error).toHaveBeenCalled();
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
  });
});
