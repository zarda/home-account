import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore, Timestamp } from '@angular/fire/firestore';
import { AuthService } from './auth.service';

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
        { provide: Firestore, useValue: mockFirestore }
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
});
