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
  getAdditionalUserInfo,
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
import { TranslationService, SupportedLocale, mapLocaleTag } from './translation.service';
import { ThemeService, ThemePreference } from './theme.service';
import { AccessibilityService } from './accessibility.service';
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
 *
 * `language` is passed in rather than taken from DEFAULT_USER_PREFERENCES: the
 * app has already resolved the browser's language by the time anyone signs in,
 * and creating every account in English made a first login speak English no
 * matter what the device asked for. The constant stays the resolver-neutral
 * fallback for everything else, and is spread rather than mutated.
 */
export function buildNewUserProfile(
  firebaseUser: FirebaseUser,
  language: SupportedLocale
): Omit<User, 'id'> {
  const profile: Omit<User, 'id'> = {
    email: firebaseUser.email ?? '',
    displayName: firebaseUser.displayName ?? 'User',
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
    preferences: { ...DEFAULT_USER_PREFERENCES, language }
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
  private accessibilityService = inject(AccessibilityService);
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
   * Sync language, theme, and accessibility preferences from database when
   * user data changes. Database is the source of truth for authenticated
   * users.
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
        // Sync accessibility preferences unconditionally — an account
        // switch whose preferences carry none of these keys must reset a
        // previous account's font scale / high contrast / reduced motion,
        // which is exactly what AccessibilityService.init's resolvers do.
        this.accessibilityService.init(user.preferences);
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

      // The signal that armed this effect is written from the listener, so it
      // can still name a session the SDK has already ended. Reading it is
      // worth a denied round trip and a lastLoginAt bump aimed at an account
      // nobody is signed into; the guard below would only discard the answer
      // afterwards.
      const startedFor = firebaseUser.uid;
      if (!this.stillSignedInAs(startedFor)) return;

      this.profileRetryInFlight = true;
      void runInInjectionContext(this.injector, () => this.getOrCreateUser(firebaseUser))
        .then(user => {
          // A profile read outlives the session that asked for it — served
          // from the local cache it resolves happily after a sign-out.
          // Writing it back left the app believing someone was signed in with
          // no Firebase session behind it: the shell rendered the previous
          // user's name, publicGuard refused to let them reach /login, and
          // every Firestore call was denied by the rules. profileDegraded is
          // deliberately left as it stands — clearing it on behalf of a
          // session that has ended hands the next one a not-degraded flag
          // over a fallback profile, with nothing left to trigger a re-read.
          if (!this.stillSignedInAs(startedFor)) return;
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
            // This callback can be overtaken: the session may have ended, or
            // moved to another account, while its own read was in flight.
            // Guarded with an `if` rather than an early return so the loading
            // flag below still settles for whoever is here now.
            if (this.stillSignedInAs(firebaseUser.uid)) {
              this.currentUser.set(user);
              this.profileDegraded.set(false);
            }
          } catch (error) {
            // A transient read failure is not "not signed in": nulling the
            // user here bounced a valid Firebase session to the login page
            // with no message, no log and no retry. Continue on an in-memory
            // fallback (never written — the create path only runs after a
            // successful read says the document is absent) and let the retry
            // effect swap the real profile in.
            console.error('[Auth] Profile load failed; continuing with a fallback profile:', error);
            // The failure is worth logging whatever happened to the session,
            // but nothing may be written on behalf of one that has ended: a
            // fallback profile would be the same ghost the success path was
            // guarded against, and the toast would tell someone who has just
            // signed out that their profile could not be loaded. Degraded is
            // only ever raised together with a fallback profile for the live
            // session, because a null firebaseUser is an absorbing state for
            // the retry effect — nothing would clear the flag again.
            if (this.stillSignedInAs(firebaseUser.uid)) {
              // Seeded with the locale the app is already speaking, like the
              // real create path: a fallback profile that named 'en' flipped
              // the whole UI out of the browser's language for as long as the
              // degraded session lasted.
              this.currentUser.set({
                id: firebaseUser.uid,
                ...buildNewUserProfile(firebaseUser, this.translationService.currentLocale())
              });
              this.profileDegraded.set(true);
              this.notifications.error(this.translationService.t('auth.profileLoadDegraded'));
            }
          }
        } else {
          this.currentUser.set(null);
          this.profileDegraded.set(false);
        }

        this.isLoading.set(false);
      });
    });
  }

  /**
   * Is the Firebase session still the one `uid` names?
   *
   * Asked of the SDK rather than of the `firebaseUser` signal. That signal is
   * written from the auth-state listener, which runs after the session has
   * already changed, so in the window this exists to catch it still names the
   * user who has just left — it would agree with exactly the case that must
   * be refused. `firebaseSignOut` clears `auth.currentUser` before its own
   * promise resolves, so the SDK is the only thing that knows in time.
   *
   * Compared by uid rather than by object identity, because a token refresh
   * hands the listener a fresh FirebaseUser for the same person, and that is
   * the session continuing rather than a switch away from it.
   */
  private stillSignedInAs(uid: string): boolean {
    return this.auth.currentUser?.uid === uid;
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

    // Create new user document. Guarded because the read above crossed an
    // await: account deletion removes users/{uid} first and deletes the
    // Firebase user second, so a retry landing between the two finds nothing
    // here and would recreate the profile it was in the middle of erasing.
    // The signal guards upstream would then hide it — an orphan document
    // surviving account deletion is worse than the ghost session they catch,
    // because nothing on screen says it happened.
    const newUser = buildNewUserProfile(firebaseUser, this.translationService.currentLocale());
    if (!this.stillSignedInAs(firebaseUser.uid)) {
      return { id: firebaseUser.uid, ...newUser };
    }

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
    return this.healLanguageFromGoogleProfile(user, getAdditionalUserInfo(result));
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
    // The plugin's own result, not getAdditionalUserInfo(result): the native
    // layer has already signed into Firebase by the time signInWithCredential
    // runs here, so the web SDK sees an existing account and reports
    // isNewUser: false for what is genuinely a first sign-in.
    return this.healLanguageFromGoogleProfile(user, nativeResult.additionalUserInfo);
  }

  /**
   * Second link of the first-sign-in language chain: adopt the Google
   * account's language when the device named one we do not ship.
   *
   * A heal applied after the profile exists rather than a branch of the
   * creation path, because the popup result and the auth-state listener race
   * to create the document — whichever of them wins, this patch lands after
   * it, so the outcome does not depend on the ordering. All four conditions
   * have to hold: the account was just created, the browser detected nothing
   * (a device language we ship outranks the account's), the provider named a
   * language we have a catalog for, and it differs from what was written.
   *
   * The write goes through updateUserPreferences, so the preferences-sync
   * effect sees the new `currentUser` and switches the UI; calling
   * syncFromDatabase here as well would load the same catalog twice.
   *
   * Failures are logged and swallowed: the account exists and the session is
   * real, and not adopting a language must not turn a completed sign-in into a
   * rejected one — the user can still pick the language in settings.
   */
  private async healLanguageFromGoogleProfile(
    user: User,
    additional: { isNewUser: boolean; profile?: Record<string, unknown> | null } | null
  ): Promise<User> {
    if (!additional?.isNewUser) return user;
    if (this.translationService.detectedBrowserLocale !== null) return user;

    const tag = additional.profile?.['locale'];
    if (typeof tag !== 'string') return user;

    const language = mapLocaleTag(tag);
    if (!language || language === user.preferences?.language) return user;

    try {
      await this.updateUserPreferences({ language });
    } catch (error) {
      console.error('[Auth] Could not adopt the Google account language:', error);
      return user;
    }
    return { ...user, preferences: { ...user.preferences, language } };
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
