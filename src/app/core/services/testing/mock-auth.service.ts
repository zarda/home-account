/// <reference types="jasmine" />
import { Injectable, signal, computed } from '@angular/core';
import { User, UserPreferences, DEFAULT_USER_PREFERENCES } from '../../../models';
import { Timestamp } from '@angular/fire/firestore';

/**
 * Mock AuthService for unit testing
 */
@Injectable()
export class MockAuthService {
  // Signals matching the real AuthService
  currentUser = signal<User | null>(null);
  firebaseUser = signal<unknown | null>(null);
  isLoading = signal<boolean>(false);
  profileDegraded = signal<boolean>(false);

  // Computed signals
  isAuthenticated = computed(() => !!this.currentUser());
  userId = computed(() => this.currentUser()?.id ?? null);

  // Spies for verifying calls
  signInWithGoogleSpy = jasmine.createSpy('signInWithGoogle');
  signOutSpy = jasmine.createSpy('signOut');
  updateUserPreferencesSpy = jasmine.createSpy('updateUserPreferences');
  updateUserProfileSpy = jasmine.createSpy('updateUserProfile');

  // Set a mock user for testing
  setMockUser(user: User | null): void {
    this.currentUser.set(user);
  }

  // Set authenticated state with default test user
  setAuthenticated(authenticated: boolean, userId = 'test-user-123'): void {
    if (authenticated) {
      this.currentUser.set(createMockUser(userId));
    } else {
      this.currentUser.set(null);
    }
  }

  // Clear mocks
  clearMocks(): void {
    this.currentUser.set(null);
    this.firebaseUser.set(null);
    this.isLoading.set(false);
    this.profileDegraded.set(false);
    this.signInWithGoogleSpy.calls.reset();
    this.signOutSpy.calls.reset();
    this.updateUserPreferencesSpy.calls.reset();
    this.updateUserProfileSpy.calls.reset();
  }

  async signInWithGoogle(): Promise<unknown> {
    this.signInWithGoogleSpy();
    const user = createMockUser('test-user-123');
    this.currentUser.set(user);
    return { user: { uid: user.id } };
  }

  async signOut(): Promise<void> {
    this.signOutSpy();
    this.currentUser.set(null);
  }

  async updateUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
    this.updateUserPreferencesSpy(prefs);
    const user = this.currentUser();
    if (user) {
      this.currentUser.set({
        ...user,
        preferences: { ...user.preferences, ...prefs }
      });
    }
  }

  async updateUserProfile(data: { displayName?: string; photoURL?: string }): Promise<void> {
    this.updateUserProfileSpy(data);
    const user = this.currentUser();
    if (user) {
      this.currentUser.set({ ...user, ...data });
    }
  }
}

/**
 * Factory function to create a mock user
 *
 * An established account, not a brand-new one: `onboardingCompleted` is set so
 * that a spec mounting the authed shell does not have the first-run welcome
 * open over its assertions. The onboarding specs pass their own preferences.
 */
export function createMockUser(id = 'test-user-123', overrides: Partial<User> = {}): User {
  return {
    id,
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://example.com/photo.jpg',
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
    preferences: { ...DEFAULT_USER_PREFERENCES, onboardingCompleted: true },
    ...overrides
  };
}
