import { TestBed } from '@angular/core/testing';
import { Auth, User as FirebaseUser } from '@angular/fire/auth';
import { Firestore, Timestamp } from '@angular/fire/firestore';
import { AuthService, buildNewUserProfile } from './auth.service';
import { TranslationService } from './translation.service';
import { ThemeService } from './theme.service';

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
    const profile = buildNewUserProfile(firebaseUser({}));

    expect(profile.email).toBe('someone@example.com');
    expect(profile.displayName).toBe('Someone');
    expect(profile.photoURL).toBe('https://example.com/avatar.png');
    expect(profile.preferences).toBeDefined();
  });

  it('omits photoURL entirely for a photo-less account', () => {
    // Firestore rejects undefined field values, so the key must be absent —
    // not present with an undefined value.
    const profile = buildNewUserProfile(firebaseUser({ photoURL: null }));

    expect('photoURL' in profile).toBeFalse();
  });

  it('defaults null email and display name', () => {
    const profile = buildNewUserProfile(firebaseUser({ email: null, displayName: null }));

    expect(profile.email).toBe('');
    expect(profile.displayName).toBe('User');
  });
});

describe('AuthService', () => {
  let service: AuthService;
  let mockAuth: jasmine.SpyObj<Auth>;
  let mockFirestore: jasmine.SpyObj<Firestore>;

  beforeEach(() => {
    mockAuth = jasmine.createSpyObj('Auth', ['onAuthStateChanged'], {
      currentUser: null
    });
    mockFirestore = jasmine.createSpyObj('Firestore', ['doc']);

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Auth, useValue: mockAuth },
        { provide: Firestore, useValue: mockFirestore },
        {
          provide: TranslationService,
          useValue: { syncFromDatabase: jasmine.createSpy('syncFromDatabase') }
        },
        {
          provide: ThemeService,
          useValue: { init: jasmine.createSpy('init') }
        }
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
});
