import { Injectable, inject, signal, computed, EnvironmentInjector, runInInjectionContext, effect } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  deleteUser,
  User as FirebaseUser
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  Timestamp
} from '@angular/fire/firestore';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  User,
  UserPreferences,
  LegacyProviderApiKeys,
  DEFAULT_USER_PREFERENCES
} from '../../models';
import { TranslationService, SupportedLocale } from './translation.service';
import { ThemeService, ThemePreference } from './theme.service';
import { SecurityLogService } from './security-log.service';
import { NotificationService } from './notification.service';
import { PwaService } from './pwa.service';

/**
 * First-sign-in user document built from the Firebase auth profile.
 *
 * Optional profile fields are omitted rather than copied as-is: Firestore
 * rejects undefined field values, and a provider account without a profile
 * photo (photoURL null) would otherwise make the very first setDoc — and so
 * the whole sign-in — fail. Exported as a pure seam for the spec.
 */
export function buildNewUserProfile(firebaseUser: FirebaseUser): Omit<User, 'id'> {
  const profile: Omit<User, 'id'> = {
    email: firebaseUser.email ?? '',
    displayName: firebaseUser.displayName ?? 'User',
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
    preferences: DEFAULT_USER_PREFERENCES
  };
  if (firebaseUser.photoURL) {
    profile.photoURL = firebaseUser.photoURL;
  }
  return profile;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);
  private translationService = inject(TranslationService);
  private themeService = inject(ThemeService);
  private securityLog = inject(SecurityLogService);
  private notifications = inject(NotificationService);
  private pwa = inject(PwaService);

  // Signals for reactive state
  currentUser = signal<User | null>(null);
  firebaseUser = signal<FirebaseUser | null>(null);
  isLoading = signal<boolean>(true);

  /**
   * True while the session is running on the in-memory fallback profile: the
   * Firebase session is valid but the profile document could not be read
   * (offline at launch, a rules error, a quota error). The retry effect
   * clears it once a re-read succeeds.
   */
  profileDegraded = signal<boolean>(false);
  private profileRetryInFlight = false;

  // Computed signals
  isAuthenticated = computed(() => !!this.currentUser());
  userId = computed(() => this.currentUser()?.id ?? null);

  constructor() {
    this.setupAuthStateListener();
    this.setupPreferencesSyncEffect();
    this.setupProfileRetryEffect();
  }

  /**
   * Sync language and theme preferences from database when user data changes.
   * Database is the source of truth for authenticated users.
   */
  private setupPreferencesSyncEffect(): void {
    effect(() => {
      const user = this.currentUser();
      if (user?.preferences) {
        // Sync language
        if (user.preferences.language) {
          const locale = user.preferences.language as SupportedLocale;
          this.translationService.syncFromDatabase(locale);
        }
        // Sync theme
        if (user.preferences.theme) {
          const theme = user.preferences.theme as ThemePreference;
          this.themeService.init(theme);
        }
      }
    });
  }

  /**
   * Re-read a degraded profile when connectivity returns. Event-driven rather
   * than counted retries: PwaService already probes reachability, and a
   * failed re-read is harmless — the session simply stays on the fallback
   * until the next flip. A successful re-read never runs the create path
   * (setDoc only follows a successful getDoc that found nothing), so a
   * legitimate first sign-in is created and an existing profile is loaded,
   * never overwritten.
   */
  private setupProfileRetryEffect(): void {
    effect(() => {
      const online = this.pwa.isOnline();
      const degraded = this.profileDegraded();
      const firebaseUser = this.firebaseUser();
      if (!online || !degraded || !firebaseUser || this.profileRetryInFlight) return;

      this.profileRetryInFlight = true;
      void runInInjectionContext(this.injector, () => this.getOrCreateUser(firebaseUser))
        .then(user => {
          this.currentUser.set(user);
          this.profileDegraded.set(false);
        })
        .catch(error => {
          console.error('[Auth] Profile retry failed; staying on the fallback profile:', error);
        })
        .finally(() => {
          this.profileRetryInFlight = false;
        });
    });
  }

  private setupAuthStateListener(): void {
    // Run within injection context to prevent AngularFire warnings
    runInInjectionContext(this.injector, () => {
      onAuthStateChanged(this.auth, async (firebaseUser) => {
        this.firebaseUser.set(firebaseUser);

        if (firebaseUser) {
          try {
            const user = await runInInjectionContext(this.injector, () =>
              this.getOrCreateUser(firebaseUser)
            );
            this.currentUser.set(user);
            this.profileDegraded.set(false);
          } catch (error) {
            // A transient read failure is not "not signed in": nulling the
            // user here bounced a valid Firebase session to the login page
            // with no message, no log and no retry. Continue on an in-memory
            // fallback (never written — the create path only runs after a
            // successful read says the document is absent) and let the retry
            // effect swap the real profile in.
            console.error('[Auth] Profile load failed; continuing with a fallback profile:', error);
            this.currentUser.set({ id: firebaseUser.uid, ...buildNewUserProfile(firebaseUser) });
            this.profileDegraded.set(true);
            this.notifications.error(this.translationService.t('auth.profileLoadDegraded'));
          }
        } else {
          this.currentUser.set(null);
          this.profileDegraded.set(false);
        }

        this.isLoading.set(false);
      });
    });
  }

  private async getOrCreateUser(firebaseUser: FirebaseUser): Promise<User> {
    const userRef = doc(this.firestore, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      // Update last login. Not awaited: offline, this write only settles on
      // reconnect, and blocking session restore on it hung the app at launch
      // even when the profile itself was served from the local cache.
      updateDoc(userRef, {
        lastLoginAt: Timestamp.now()
      }).catch(() => undefined);
      return { id: firebaseUser.uid, ...userSnap.data() } as User;
    }

    // Create new user document
    const newUser = buildNewUserProfile(firebaseUser);

    await setDoc(userRef, newUser);
    return { id: firebaseUser.uid, ...newUser };
  }

  /**
   * Initiates Google sign-in.
   * Uses native sign-in on iOS/Android, popup on web.
   */
  async signInWithGoogle(): Promise<User> {
    if (Capacitor.isNativePlatform()) {
      return this.signInWithGoogleNative();
    }
    return this.signInWithGoogleWeb();
  }

  private async signInWithGoogleWeb(): Promise<User> {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    const result = await signInWithPopup(this.auth, provider);
    const user = await this.getOrCreateUser(result.user);
    this.currentUser.set(user);
    this.recordSignIn(user.id);
    return user;
  }

  private async signInWithGoogleNative(): Promise<User> {
    // Use Capacitor Firebase Auth plugin for native Google Sign-In
    const nativeResult = await FirebaseAuthentication.signInWithGoogle();

    // Get the ID token from the native sign-in result
    const idToken = nativeResult.credential?.idToken;
    if (!idToken) {
      throw new Error('No ID token received from Google Sign-In');
    }

    // Create Firebase credential and sign in
    const credential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(this.auth, credential);

    const user = await this.getOrCreateUser(result.user);
    this.currentUser.set(user);
    this.recordSignIn(user.id);
    return user;
  }

  /**
   * Recorded from the two interactive sign-in paths only. getOrCreateUser and
   * the auth-state listener both also run on every session restore, so logging
   * there would record an entry for each ordinary app open and double-log a
   * real sign-in.
   *
   * Not awaited: record() swallows its own errors, and while offline the write
   * sits in the persistent cache until reconnect, which would stall sign-in.
   */
  private recordSignIn(userId: string): void {
    void this.securityLog.record(userId, 'signIn');
  }

  async signOut(): Promise<void> {
    try {
      await firebaseSignOut(this.auth);
      this.currentUser.set(null);
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }

  /**
   * Fresh proof of identity, which Firebase demands immediately before
   * credential-sensitive operations — deleteUser rejects with
   * auth/requires-recent-login without it. Callers run this BEFORE anything
   * destructive, so a failure leaves the account untouched. Reauthenticating
   * with a different Google account than the session's rejects with
   * auth/user-mismatch, again before anything is deleted.
   */
  async reauthenticate(): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('No authenticated user');

    if (Capacitor.isNativePlatform()) {
      // The signInWithGoogleNative plugin flow, but the fresh token feeds a
      // reauthentication credential instead of opening a new session.
      const nativeResult = await FirebaseAuthentication.signInWithGoogle();
      const idToken = nativeResult.credential?.idToken;
      if (!idToken) {
        throw new Error('No ID token received from Google Sign-In');
      }
      await reauthenticateWithCredential(firebaseUser, GoogleAuthProvider.credential(idToken));
      return;
    }

    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    await reauthenticateWithPopup(firebaseUser, provider);
  }

  /**
   * Delete the Firebase Auth account itself — the last step of account
   * deletion, once every Firestore document and Storage object is gone.
   * deleteUser only removes the web SDK's account and session; on native the
   * plugin session is signed out as well (the same asymmetry signOut has).
   */
  async deleteFirebaseUser(): Promise<void> {
    const firebaseUser = this.auth.currentUser;
    if (!firebaseUser) throw new Error('No authenticated user');

    await deleteUser(firebaseUser);
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut();
    }
    this.currentUser.set(null);
  }

  async updateUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }

    const userRef = doc(this.firestore, 'users', user.id);

    // Dotted field paths so only the touched keys are sent — rewriting the
    // whole map from this session's snapshot reverted anything another
    // device changed since it was read (change the theme on a phone and the
    // language on a laptop, and whichever saved second undid the other).
    // Same approach as clearStoredProviderApiKeys below, and it needs no
    // rules change: to userUpdateValid the post-merge document still
    // presents `preferences` as a map.
    const fieldUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(prefs)) {
      fieldUpdates[`preferences.${key}`] = value;
    }
    if (Object.keys(fieldUpdates).length === 0) return;

    await updateDoc(userRef, fieldUpdates);

    // Update local state
    this.currentUser.set({
      ...user,
      preferences: { ...user.preferences, ...prefs }
    });
  }

  /**
   * Drop the provider API keys older builds stored on the preferences map.
   *
   * Field-level deletes rather than a whole-map rewrite, so a preference edit
   * racing in from another device is not clobbered. The local signal is
   * stripped too: updateUserPreferences rewrites the whole map from the
   * in-memory copy, which would otherwise put the keys straight back.
   */
  async clearStoredProviderApiKeys(): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }

    const userRef = doc(this.firestore, 'users', user.id);
    await updateDoc(userRef, {
      'preferences.geminiApiKey': deleteField(),
      'preferences.openaiApiKey': deleteField(),
      'preferences.claudeApiKey': deleteField()
    });

    // Re-read rather than reusing the snapshot taken before the await: a
    // preference the user changed while the delete was in flight would
    // otherwise be reverted in the signal.
    const latest = this.currentUser();
    if (!latest) return;

    const preferences = { ...latest.preferences } as UserPreferences & LegacyProviderApiKeys;
    delete preferences.geminiApiKey;
    delete preferences.openaiApiKey;
    delete preferences.claudeApiKey;
    this.currentUser.set({ ...latest, preferences });
  }

  async updateUserProfile(data: { displayName?: string; photoURL?: string }): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }

    const userRef = doc(this.firestore, 'users', user.id);
    await updateDoc(userRef, data);

    // Update local state
    this.currentUser.set({
      ...user,
      ...data
    });
  }
}
