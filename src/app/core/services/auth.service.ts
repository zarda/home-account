import { Injectable, inject, signal, computed, EnvironmentInjector, runInInjectionContext, effect } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
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
import { Observable } from 'rxjs';
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

  // Signals for reactive state
  currentUser = signal<User | null>(null);
  firebaseUser = signal<FirebaseUser | null>(null);
  isLoading = signal<boolean>(true);

  // Computed signals
  isAuthenticated = computed(() => !!this.currentUser());
  userId = computed(() => this.currentUser()?.id ?? null);

  constructor() {
    this.setupAuthStateListener();
    this.setupPreferencesSyncEffect();
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
          } catch {
            this.currentUser.set(null);
          }
        } else {
          this.currentUser.set(null);
        }

        this.isLoading.set(false);
      });
    });
  }

  private async getOrCreateUser(firebaseUser: FirebaseUser): Promise<User> {
    const userRef = doc(this.firestore, 'users', firebaseUser.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      // Update last login
      await updateDoc(userRef, {
        lastLoginAt: Timestamp.now()
      });
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

  getCurrentUser(): Observable<User | null> {
    return new Observable<User | null>((subscriber) => {
      // Run within injection context to prevent AngularFire warnings
      return runInInjectionContext(this.injector, () => {
        const unsubscribe = onAuthStateChanged(this.auth, async (firebaseUser) => {
          if (firebaseUser) {
            try {
              const user = await runInInjectionContext(this.injector, () =>
                this.getOrCreateUser(firebaseUser)
              );
              subscriber.next(user);
            } catch {
              subscriber.next(null);
            }
          } else {
            subscriber.next(null);
          }
        });

        return () => unsubscribe();
      });
    });
  }

  async updateUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
    const user = this.currentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }

    const userRef = doc(this.firestore, 'users', user.id);
    const updatedPreferences = { ...user.preferences, ...prefs };

    await updateDoc(userRef, {
      preferences: updatedPreferences
    });

    // Update local state
    this.currentUser.set({
      ...user,
      preferences: updatedPreferences
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

    const preferences = { ...user.preferences } as UserPreferences & LegacyProviderApiKeys;
    delete preferences.geminiApiKey;
    delete preferences.openaiApiKey;
    delete preferences.claudeApiKey;
    this.currentUser.set({ ...user, preferences });
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
