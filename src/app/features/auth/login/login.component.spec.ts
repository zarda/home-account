import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/services/auth.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockAuthService: {
    signInWithGoogle: jasmine.Spy;
  };
  let mockRouter: {
    navigate: jasmine.Spy;
  };

  beforeEach(async () => {
    mockAuthService = {
      signInWithGoogle: jasmine.createSpy('signInWithGoogle').and.returnValue(Promise.resolve())
    };

    mockRouter = {
      navigate: jasmine.createSpy('navigate')
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display app title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Home Account');
  });

  it('should display sign in button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Sign in with Google');
  });

  it('should have loading state initially false', () => {
    expect(component.isLoading()).toBe(false);
  });

  it('should have no error initially', () => {
    expect(component.error()).toBeNull();
  });

  
  describe('signInWithGoogle', () => {
    it('should set loading state when signing in', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      );

      const signInPromise = component.signInWithGoogle();

      expect(component.isLoading()).toBe(true);

      await signInPromise;
    });

    it('should call AuthService.signInWithGoogle', async () => {
      await component.signInWithGoogle();

      expect(mockAuthService.signInWithGoogle).toHaveBeenCalled();
    });

    it('should navigate to dashboard on successful sign-in', async () => {
      await component.signInWithGoogle();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should set error when sign-in is cancelled', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Sign-in was cancelled. Please try again.');
    });

    it('should set error on network failure', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/network-request-failed' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Network error. Please check your connection.');
    });

    it('should set generic error for unknown errors', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/unknown-error' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Failed to sign in. Please try again.');
    });

    it('should clear previous error on new sign in attempt', async () => {
      // First, set an error
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );
      await component.signInWithGoogle();
      expect(component.error()).not.toBeNull();

      // Then try again successfully
      mockAuthService.signInWithGoogle.and.returnValue(Promise.resolve());
      await component.signInWithGoogle();

      expect(component.error()).toBeNull();
    });

    it('should reset loading state on error', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();

      expect(component.isLoading()).toBe(false);
    });
  });

  describe('UI interactions', () => {
    it('should disable button while loading', fakeAsync(() => {
      mockAuthService.signInWithGoogle.and.returnValue(
        new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      );

      component.signInWithGoogle();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button[mat-raised-button]');
      expect(button.disabled).toBe(true);

      tick(100);
      fixture.detectChanges();

      // Button stays disabled because redirect doesn't reset loading in normal flow
      // Only errors reset the loading state
    }));

    it('should display error message when error exists', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();
      fixture.detectChanges();

      const errorDiv = fixture.nativeElement.querySelector('.error-message');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv.textContent).toContain('Sign-in was cancelled');
    });
  });
});
