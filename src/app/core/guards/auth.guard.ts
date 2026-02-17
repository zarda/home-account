import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

const LOADING_CHECK_INTERVAL_MS = 50;
const AUTH_LOADING_TIMEOUT_MS = 10000;

/**
 * Waits for auth loading state to complete, then executes callback.
 * Times out after AUTH_LOADING_TIMEOUT_MS to prevent infinite white screen.
 */
function waitForAuthLoading(
  authService: AuthService,
  onComplete: () => boolean
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const startTime = Date.now();
    const checkAuth = setInterval(() => {
      if (!authService.isLoading()) {
        clearInterval(checkAuth);
        resolve(onComplete());
      } else if (Date.now() - startTime > AUTH_LOADING_TIMEOUT_MS) {
        clearInterval(checkAuth);
        console.warn('[AuthGuard] Auth loading timed out after', AUTH_LOADING_TIMEOUT_MS, 'ms');
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
