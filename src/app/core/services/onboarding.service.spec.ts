import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';

import { OnboardingService } from './onboarding.service';
import { AuthService } from './auth.service';
import { QuickAddService } from './quick-add.service';
import { OnboardingDialogComponent } from '../../shared/components/onboarding-dialog/onboarding-dialog.component';
import { DEFAULT_USER_PREFERENCES, User, UserPreferences } from '../../models';
import { createMockUser } from './testing/mock-auth.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let auth: jasmine.SpyObj<AuthService>;
  let quickAdd: jasmine.SpyObj<QuickAddService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let currentUser: ReturnType<typeof signal<User | null>>;
  let profileDegraded: ReturnType<typeof signal<boolean>>;
  let afterClosed$: Subject<string | undefined>;

  function userWith(prefs: Partial<UserPreferences> = {}, id = 'user-1'): User {
    return createMockUser(id, { preferences: { ...DEFAULT_USER_PREFERENCES, ...prefs } });
  }

  /** Let the swallowed persist promise settle before asserting. */
  async function settle(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    currentUser = signal<User | null>(userWith());
    profileDegraded = signal(false);
    afterClosed$ = new Subject<string | undefined>();

    auth = jasmine.createSpyObj<AuthService>('AuthService', ['updateUserPreferences'], {
      currentUser,
      profileDegraded,
    });
    auth.updateUserPreferences.and.resolveTo();

    quickAdd = jasmine.createSpyObj<QuickAddService>('QuickAddService', [
      'openAddTransaction',
      'openScanReceipt',
    ]);

    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue({
      afterClosed: () => afterClosed$.asObservable(),
    } as MatDialogRef<OnboardingDialogComponent>);

    TestBed.configureTestingModule({
      providers: [
        OnboardingService,
        { provide: AuthService, useValue: auth },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: MatDialog, useValue: dialog },
      ],
    });

    service = TestBed.inject(OnboardingService);
  });

  describe('shouldShow', () => {
    it('is false with no signed-in user', () => {
      currentUser.set(null);
      expect(service.shouldShow()).toBeFalse();
    });

    // The whole reason this gate is ADR material: a degraded session is
    // running on the synthesized fallback profile, which carries no flag and
    // a fresh createdAt whatever the account's real age.
    it('is false while the session runs on a degraded fallback profile', () => {
      profileDegraded.set(true);
      expect(service.shouldShow()).toBeFalse();
    });

    it('is false once the account has completed onboarding', () => {
      currentUser.set(userWith({ onboardingCompleted: true }));
      expect(service.shouldShow()).toBeFalse();
    });

    it('is false once it has already been attempted for this uid', () => {
      expect(service.shouldShow()).toBeTrue();
      service.show();
      expect(service.shouldShow()).toBeFalse();
    });

    it('is true for a signed-in, undegraded account with no flag', () => {
      expect(service.shouldShow()).toBeTrue();
    });

    it('re-arms when a different account signs in during the same session', () => {
      service.show();
      expect(service.shouldShow()).toBeFalse();

      currentUser.set(userWith({}, 'user-2'));
      expect(service.shouldShow()).toBeTrue();
    });

    it('does not re-open for the same uid when a degraded profile recovers', () => {
      service.show();
      profileDegraded.set(true);
      profileDegraded.set(false);
      expect(service.shouldShow()).toBeFalse();
    });
  });

  describe('show', () => {
    it('opens the welcome at the house dialog size', () => {
      service.show();
      expect(dialog.open).toHaveBeenCalledWith(OnboardingDialogComponent, {
        width: '520px',
        maxWidth: '95vw',
      });
    });

    it('does nothing without a signed-in user', () => {
      currentUser.set(null);
      service.show();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('marks the attempt before the dialog is opened, so a re-entrant read is false', () => {
      dialog.open.and.callFake(() => {
        // Whatever re-enters while the dialog is opening must see the guard.
        expect(service.shouldShow()).toBeFalse();
        return { afterClosed: () => afterClosed$.asObservable() } as MatDialogRef<
          OnboardingDialogComponent
        >;
      });

      service.show();
      expect(dialog.open).toHaveBeenCalled();
    });

    // A first-run dialog that can come back is a nag: every close reason is a
    // completed first run.
    for (const closeResult of [undefined, 'add', 'scan'] as const) {
      it(`persists the flag when the dialog closes with ${closeResult ?? 'no result'}`, async () => {
        service.show();
        afterClosed$.next(closeResult);
        await settle();

        expect(auth.updateUserPreferences).toHaveBeenCalledWith({ onboardingCompleted: true });
      });
    }

    it('swallows a failed write, leaving the flag absent for the next launch', async () => {
      auth.updateUserPreferences.and.rejectWith(new Error('offline'));

      service.show();
      afterClosed$.next(undefined);
      await settle();

      expect(auth.updateUserPreferences).toHaveBeenCalledTimes(1);
    });

    it('starts an add-transaction flow after the welcome has closed', async () => {
      service.show();
      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();

      afterClosed$.next('add');
      await settle();

      expect(quickAdd.openAddTransaction).toHaveBeenCalledTimes(1);
      expect(quickAdd.openScanReceipt).not.toHaveBeenCalled();
    });

    it('starts a receipt scan after the welcome has closed', async () => {
      service.show();
      afterClosed$.next('scan');
      await settle();

      expect(quickAdd.openScanReceipt).toHaveBeenCalledTimes(1);
      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
    });

    it('starts nothing when the welcome is dismissed', async () => {
      service.show();
      afterClosed$.next(undefined);
      await settle();

      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
      expect(quickAdd.openScanReceipt).not.toHaveBeenCalled();
    });
  });
});
