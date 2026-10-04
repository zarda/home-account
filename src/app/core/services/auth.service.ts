import { Injectable, inject, signal, computed, DestroyRef, EnvironmentInjector, runInInjectionContext, effect } from '@angular/core';
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
import { PAGE_RELOAD } from './page-reload';

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

/** One nested field's write: replace its value, or delete the field. */
export type PreferenceFieldWrite<T> = { set: T } | { delete: true };

/** The preference keys whose value is a map, so a field inside it can be written on its own. */
export type MapPreferenceKey = {
  [K in keyof UserPreferences]-?: NonNullable<UserPreferences[K]> extends readonly unknown[]
    ? never
    : NonNullable<UserPreferences[K]> extends object
      ? K
      : never;
}[keyof UserPreferences];

/** Per field of the map at `K`: a write, or nothing. */
export type PreferenceFieldWrites<K extends MapPreferenceKey> = {
  [F in keyof NonNullable<UserPreferences[K]>]?: PreferenceFieldWrite<
    NonNullable<NonNullable<UserPreferences[K]>[F]>
  >;
};

function isPlainMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fieldWrites(fields: object): [string, PreferenceFieldWrite<unknown>][] {
  return (Object.entries(fields) as [string, PreferenceFieldWrite<unknown> | undefined][]).filter(
    (entry): entry is [string, PreferenceFieldWrite<unknown>] => entry[1] !== undefined
  );
}

/**
 * `preferences` with `fields` applied to the map at `key`, one level deep.
 * A value there that is not a map is replaced, since a nested write has
 * nothing to merge into. Exported so the test double applies the same rule.
 */
export function withPreferenceFields<K extends MapPreferenceKey>(
  preferences: UserPreferences,
  key: K,
  fields: PreferenceFieldWrites<K>
): UserPreferences {
  const current: unknown = preferences[key];
  const merged: Record<string, unknown> = isPlainMap(current) ? { ...current } : {};
  for (const [field, write] of fieldWrites(fields)) {
    if ('delete' in write) {
      delete merged[field];
    } else {
      merged[field] = write.set;
    }
  }
  return { ...preferences, [key]: merged };
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
  private reloadPage = inject(PAGE_RELOAD);

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
  /**
   * Bumped only when a retry's own read is abandoned for a session that
   * replaced the one it started for, so the retry effect re-runs and gives
   * the new session its own read without waiting on a connectivity flip.
   */
  private retryArm = signal(0);

  /**
   * The uid the auth-state listener was last handed, null for a signed-out
   * state; undefined until its first delivery. A private baseline rather than
   * the firebaseUser signal, which stops moving once a reload has been asked
   * for and which specs write by hand.
   */
  private deliveredUid: string | null | undefined = undefined;
  /** Set once the page has asked to reload; it asks at most once. */
  private reloadRequested = false;
  /**
   * This page's own account changes still in flight (ownAccountChange). A
   * change the listener is handed while one is out is the page's own.
   */
  private ownChangesInFlight = 0;

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
   * never overwritten. `retryArm` re-runs this effect when a read was
   * abandoned for a session that replaced the one it was started for, so the
   * new session gets its own read without waiting on a connectivity flip. A
   * failed read never bumps it — a persistent failure would otherwise loop
   * this effect with nothing to stop it.
   */
  private setupProfileRetryEffect(): void {
    effect(() => {
      this.retryArm();
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
      let abandoned = false;
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
          if (!this.stillSignedInAs(startedFor)) {
            abandoned = true;
            return;
          }
          this.currentUser.set(user);
          this.profileDegraded.set(false);
        })
        .catch(error => {
          console.error('[Auth] Profile retry failed; staying on the fallback profile:', error);
        })
        .finally(() => {
          this.profileRetryInFlight = false;
          // Only a read abandoned for a replaced session re-arms: that
          // session's own listener callback already lost its answer, and
          // nothing else asks again until the next connectivity flip. A
          // failed read leaves `abandoned` false, on purpose — bumping the
          // arm here would loop this effect against a persistent failure.
          if (abandoned) this.retryArm.update(n => n + 1);
        });
    });
  }

  private setupAuthStateListener(): void {
    // Run within injection context to prevent AngularFire warnings
    runInInjectionContext(this.injector, () => {
      const unsubscribe = onAuthStateChanged(this.auth, async (firebaseUser) => {
        // The one early return in this callback (ADR 0163 amends ADR 0052's
        // "ifs, not early returns"). A first delivery never takes it, and the
        // first delivery's own callback is the one that settles isLoading, on
        // its if-guarded tail below, even when a change overtakes its profile
        // read.
        if (this.reloadsForForeignChange(firebaseUser)) return;

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
              // Seeded with the locale the app is already speaking —
              // deliberately currentLocale() and not the create path's
              // detectedBrowserLocale: this profile is never written, and its
              // whole job is to leave the UI where it already is. A fallback
              // profile that named 'en' flipped the whole UI out of the
              // browser's language for as long as the degraded session lasted.
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

      // The listener dies with the injector that registered it. @angular/fire
      // binds the callback above to whatever injector was active at the call —
      // this one — so a transition delivered after that injector is destroyed
      // re-enters a dead one and throws NG0205 inside the SDK's own observer,
      // which catches and logs it: errors printed, nothing failing. The app
      // builds a single root-scoped service and would never notice; a suite
      // builds one per spec, and one that outlived its injector spent a whole
      // run printing into the log a real warning could have hidden behind.
      // DestroyRef comes from `inject` rather than `injector.get` because this
      // already runs inside that injector's context (ADR 0083 needed the
      // try/catch shape only because its constructor does not).
      inject(DestroyRef).onDestroy(() => unsubscribe());
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

  /**
   * Reload the page for an account change it did not start, and say whether
   * it did (ADR 0163).
   *
   * Another tab on the origin moves the shared session straight from one
   * account to another, or signs it out or in, and the SDK hands that change
   * to this listener like any other. The per-account services reset only on
   * the signed-out edge, and the listeners a page holds itself never reset at
   * all, so the page would keep serving the account it was opened for under
   * the next one's session. A sign-out or sign-in from elsewhere leaves the
   * page where it stands too, because the guards only run on a navigation.
   * A reload rebuilds every service and listener for whoever is signed in
   * now, and lets the guards place the page.
   *
   * Nothing reloads for the page's own sign-in, sign-out or deletion (each
   * runs inside ownAccountChange), for the first state the listener is
   * handed, for the same uid arriving again, or on a device, where the token
   * is null (page-reload.ts). Compared by uid against the last delivered one,
   * so a fresh FirebaseUser for the same person is the session continuing.
   * Once the reload has been asked for, every later delivery is refused too:
   * nothing of the incoming account is written on a page about to be
   * replaced, not the signal, not a profile read, not a lastLoginAt bump.
   */
  private reloadsForForeignChange(next: FirebaseUser | null): boolean {
    if (this.reloadRequested) return true;
    const uid = next?.uid ?? null;
    const previous = this.deliveredUid;
    this.deliveredUid = uid;
    if (
      !this.reloadPage ||
      previous === undefined ||
      previous === uid ||
      this.ownChangesInFlight > 0
    ) {
      return false;
    }
    this.reloadRequested = true;
    this.reloadPage();
    return true;
  }

  /**
   * Run one of this page's own SDK calls that moves its account: a sign-in, a
   * sign-out, the account's deletion. Marked around the SDK call alone.
   *
   * Every one of those calls hands the change to the auth-state listener
   * before its own promise settles, so the marker is always up when the
   * listener asks. A sign-in or sign-out that fails never reaches the
   * listener. A deletion the SDK refuses because the session is no longer
   * valid (a disabled account, a revoked token) signs the session out first
   * and only then rejects, and that sign-out is still under the marker. The
   * marker comes down either way. A count rather than a flag, so two
   * sign-outs in flight at once (the header's and the settings page's)
   * cannot lower it for each other.
   */
  private async ownAccountChange<T>(change: () => Promise<T>): Promise<T> {
    this.ownChangesInFlight++;
    try {
      return await change();
    } finally {
      this.ownChangesInFlight--;
    }
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
    // Seeded from the device's own detection, not from currentLocale(): the
    // two agree only until something moves the locale, and nothing resets it
    // between accounts — sign-out is an SPA navigation, so the departing
    // user's chosen language would otherwise be written into the next
    // person's brand-new account. It is also the source the heal's second
    // guard reads, and a seed the heal disagrees with is a seed it may
    // immediately overwrite.
    const newUser = buildNewUserProfile(
      firebaseUser,
      this.translationService.detectedBrowserLocale ??
        (DEFAULT_USER_PREFERENCES.language as SupportedLocale)
    );
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

    const result = await this.ownAccountChange(() => signInWithPopup(this.auth, provider));
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
    const result = await this.ownAccountChange(() => signInWithCredential(this.auth, credential));

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
   * Not awaited, like the lastLoginAt bump and recordSignIn above: this sits
   * on the sign-in critical path — LoginComponent navigates only once
   * signInWithGoogle resolves — and offline a Firestore write settles only on
   * reconnect, so awaiting it would leave a real, signed-in session on the
   * login spinner. Nothing here needs the acknowledgement: the UI switch is
   * driven by the signal write inside updateUserPreferences, not by this
   * caller, and the returned profile is the optimistic one.
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

    void this.updateUserPreferences({ language }).catch(error =>
      console.error('[Auth] Could not adopt the Google account language:', error)
    );
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
      await this.ownAccountChange(() => firebaseSignOut(this.auth));
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
   *
   * Not run inside ownAccountChange: a reauthentication cannot move the
   * session to another account. When the SDK finds the session itself no
   * longer valid (a disabled account, a revoked token) it ends it, and on the
   * web that sign-out reloads the page like any other it did not start —
   * still before anything is deleted, because this runs first.
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

    await this.ownAccountChange(() => deleteUser(firebaseUser));
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
   * Delete stored preference keys rather than write a value over them, so a
   * reset account picks up whatever a later build defaults it to instead of
   * freezing today's default in the document. Field-level deletes for the
   * same racing-write reason as clearStoredProviderApiKeys below; the
   * empty-list check runs before the doc reference is built so a no-op call
   * never touches Firestore.
   */
  async clearUserPreferences(keys: readonly (keyof UserPreferences)[]): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }
    if (keys.length === 0) return;

    const userRef = doc(this.firestore, 'users', user.id);
    const fieldUpdates: Record<string, unknown> = {};
    for (const key of keys) {
      fieldUpdates[`preferences.${key}`] = deleteField();
    }
    await updateDoc(userRef, fieldUpdates);

    // A dynamic-key view over the copy, the same shape
    // ai-model-migrations.ts uses: the keys removed here are not all
    // individually optional on UserPreferences.
    const preferences = { ...user.preferences } as Record<string, unknown>;
    for (const key of keys) {
      delete preferences[key];
    }
    this.currentUser.set({ ...user, preferences: preferences as unknown as UserPreferences });
  }

  /**
   * Write or delete single fields of the map at `preferences.<key>`, one
   * nested path each, so a field another device changed is not sent back
   * over it. The SDK creates the map when it is absent; no rules change is
   * needed, since `preferences` stays a map. An empty set writes nothing.
   *
   * The signal is re-read after the write and the fields merged into the map
   * as it then stands: a preference saved while this write was out (a theme
   * switch) would otherwise be reverted. Nothing is merged if the session
   * ended or moved to another account meanwhile.
   */
  async updatePreferenceFields<K extends MapPreferenceKey>(
    key: K,
    fields: PreferenceFieldWrites<K>
  ): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }
    const writes = fieldWrites(fields);
    if (writes.length === 0) return;

    const fieldUpdates: Record<string, unknown> = {};
    for (const [field, write] of writes) {
      fieldUpdates[`preferences.${key}.${field}`] = 'delete' in write ? deleteField() : write.set;
    }
    await this.writeUserFields(user.id, fieldUpdates);

    const latest = this.currentUser();
    if (latest?.id !== user.id) return;
    this.currentUser.set({
      ...latest,
      preferences: withPreferenceFields(latest.preferences, key, fields)
    });
  }

  /**
   * updatePreferenceFields' write, apart so the unit spec can hold it open:
   * the module-level @angular/fire calls cannot be spied on.
   */
  private writeUserFields(uid: string, fieldUpdates: Record<string, unknown>): Promise<void> {
    return updateDoc(doc(this.firestore, 'users', uid), fieldUpdates);
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
