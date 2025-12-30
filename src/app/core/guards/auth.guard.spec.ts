import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard, publicGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('Auth Guards', () => {
  let mockAuthService: {
    isLoading: ReturnType<typeof signal<boolean>>;
    isAuthenticated: ReturnType<typeof signal<boolean>>;
  };
  let mockRouter: { navigate: jasmine.Spy };
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    mockAuthService = {
      isLoading: signal(false),
      isAuthenticated: signal(false)
    };

    mockRouter = {
      navigate: jasmine.createSpy('navigate')
    };

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = {} as RouterStateSnapshot;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter }
      ]
    });
  });

  describe('authGuard', () => {
    it('should allow access when user is authenticated', () => {
      mockAuthService.isAuthenticated.set(true);

      const result = TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to login when user is not authenticated', () => {
      mockAuthService.isAuthenticated.set(false);

      const result = TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));

      expect(result).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should wait for loading state before checking authentication', async () => {
      mockAuthService.isLoading.set(true);
      mockAuthService.isAuthenticated.set(false);

      const resultPromise = TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Promise<boolean>;

      // Simulate loading complete
      setTimeout(() => {
        mockAuthService.isLoading.set(false);
        mockAuthService.isAuthenticated.set(true);
      }, 60);

      const result = await resultPromise;

      expect(result).toBe(true);
    });

    it('should redirect to login after loading completes if not authenticated', async () => {
      mockAuthService.isLoading.set(true);
      mockAuthService.isAuthenticated.set(false);

      const resultPromise = TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Promise<boolean>;

      // Simulate loading complete but not authenticated
      setTimeout(() => {
        mockAuthService.isLoading.set(false);
      }, 60);

      const result = await resultPromise;

      expect(result).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('publicGuard', () => {
    it('should allow access when user is not authenticated', () => {
      mockAuthService.isAuthenticated.set(false);

      const result = TestBed.runInInjectionContext(() => publicGuard(mockRoute, mockState));

      expect(result).toBe(true);
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to home when user is authenticated', () => {
      mockAuthService.isAuthenticated.set(true);

      const result = TestBed.runInInjectionContext(() => publicGuard(mockRoute, mockState));

      expect(result).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should wait for loading state before checking authentication', async () => {
      mockAuthService.isLoading.set(true);
      mockAuthService.isAuthenticated.set(false);

      const resultPromise = TestBed.runInInjectionContext(() =>
        publicGuard(mockRoute, mockState)
      ) as Promise<boolean>;

      // Simulate loading complete, user not authenticated
      setTimeout(() => {
        mockAuthService.isLoading.set(false);
      }, 60);

      const result = await resultPromise;

      expect(result).toBe(true);
    });

    it('should redirect to home after loading completes if authenticated', async () => {
      mockAuthService.isLoading.set(true);

      const resultPromise = TestBed.runInInjectionContext(() =>
        publicGuard(mockRoute, mockState)
      ) as Promise<boolean>;

      // Simulate loading complete with authenticated user
      setTimeout(() => {
        mockAuthService.isLoading.set(false);
        mockAuthService.isAuthenticated.set(true);
      }, 60);

      const result = await resultPromise;

      expect(result).toBe(false);
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });
  });
});
