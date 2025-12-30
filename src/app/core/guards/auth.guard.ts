import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

const LOADING_CHECK_INTERVAL_MS = 50;

/**
 * Waits for auth loading state to complete, then executes callback
 */
function waitForAuthLoading(
  authService: AuthService,
  onComplete: () => boolean
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const checkAuth = setInterval(() => {
      if (!authService.isLoading()) {
        clearInterval(checkAuth);
        resolve(onComplete());
      }
    }, LOADING_CHECK_INTERVAL_MS);
  });
}

/**
 * Guard that protects routes requiring authentication.
 * Redirects unauthenticated users to /login.
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const checkAuthentication = (): boolean => {
    if (authService.isAuthenticated()) {
      return true;
    }
    router.navigate(['/login']);
    return false;
  };

  if (authService.isLoading()) {
    return waitForAuthLoading(authService, checkAuthentication);
  }

  return checkAuthentication();
};

/**
 * Guard that protects public-only routes (e.g., login page).
 * Redirects authenticated users to home.
 */
export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const checkNotAuthenticated = (): boolean => {
    if (authService.isAuthenticated()) {
      router.navigate(['/']);
      return false;
    }
    return true;
  };

  if (authService.isLoading()) {
    return waitForAuthLoading(authService, checkNotAuthenticated);
  }

  return checkNotAuthenticated();
};
