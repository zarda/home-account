import { Injectable, inject, signal, computed, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
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
  Timestamp
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { User, UserPreferences, DEFAULT_USER_PREFERENCES } from '../../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);

  // Signals for reactive state
  currentUser = signal<User | null>(null);
  firebaseUser = signal<FirebaseUser | null>(null);
  isLoading = signal<boolean>(true);

  // Computed signals
  isAuthenticated = computed(() => !!this.currentUser());
  userId = computed(() => this.currentUser()?.id ?? null);

  constructor() {
    this.setupAuthStateListener();
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
    const newUser: Omit<User, 'id'> = {
      email: firebaseUser.email ?? '',
      displayName: firebaseUser.displayName ?? 'User',
      photoURL: firebaseUser.photoURL ?? undefined,
      createdAt: Timestamp.now(),
      lastLoginAt: Timestamp.now(),
      preferences: DEFAULT_USER_PREFERENCES
    };

    await setDoc(userRef, newUser);
    return { id: firebaseUser.uid, ...newUser };
  }

  /**
   * Initiates Google sign-in using popup flow.
   * Returns the authenticated user on success.
   */
  async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    const result = await signInWithPopup(this.auth, provider);

    // Get or create user document
    const user = await this.getOrCreateUser(result.user);
    this.currentUser.set(user);

    return user;
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
