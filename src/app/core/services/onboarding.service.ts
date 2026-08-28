import { Injectable, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { AuthService } from './auth.service';
import { QuickAddService } from './quick-add.service';
import {
  OnboardingDialogComponent,
  OnboardingResult,
} from '../../shared/components/onboarding-dialog/onboarding-dialog.component';

/**
 * Decides whether this launch is a first run, and runs the welcome once.
 *
 * The interesting condition is `!profileDegraded()`. When the profile read
 * fails — an offline launch, a rules or quota error — AuthService keeps the
 * session alive on an in-memory fallback built by buildNewUserProfile():
 * DEFAULT_USER_PREFERENCES, so no `onboardingCompleted`, and a createdAt of
 * now whatever the account's real age. Onboarding read against that profile
 * would greet a two-year-old account as a stranger, and the write that
 * follows would target a document this session never read. So a degraded
 * session shows nothing at all and waits: the retry effect clears the flag
 * when the real profile arrives, and `shouldShow` — a computed, watched by an
 * effect in MainLayoutComponent — becomes true then, or stays false because
 * the real preferences already carry the flag. See ADR 0072.
 *
 * `attemptedFor` is keyed by uid rather than being a bare boolean: an account
 * switch inside one session is a different first run and re-arms, while a
 * degraded→recovered transition for a uid already welcomed does not re-open
 * the dialog.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private auth = inject(AuthService);
  private dialog = inject(MatDialog);
  private quickAdd = inject(QuickAddService);

  /** uid the welcome has already been opened for in this session. */
  private attemptedFor = signal<string | null>(null);

  /** Whether this launch should open the first-run welcome. */
  shouldShow = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (this.auth.profileDegraded()) return false;
    if (user.preferences?.onboardingCompleted === true) return false;
    return this.attemptedFor() !== user.id;
  });

  show(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    // Marked before the open, not after: opening is what makes a second
    // read of shouldShow re-entrant, and the guard has to be standing by
    // then or two welcomes stack.
    this.attemptedFor.set(user.id);

    const ref = this.dialog.open(OnboardingDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
    });

    ref.afterClosed().subscribe((result?: OnboardingResult) => {
      // Every close reason completes the first run — Done, Skip, the
      // close-X, the backdrop, Escape. A first-run dialog that can come
      // back is a nag.
      void this.persistCompletion();

      // After the close, never over it: the quick-add dialogs are the same
      // MatDialog surface and would stack on a welcome still animating out.
      if (result === 'add') {
        this.quickAdd.openAddTransaction();
      } else if (result === 'scan') {
        this.quickAdd.openScanReceipt();
      }
    });
  }

  private async persistCompletion(): Promise<void> {
    try {
      await this.auth.updateUserPreferences({ onboardingCompleted: true });
    } catch {
      // Swallowed on purpose, with no toast: the flag simply stays absent,
      // so the next launch offers the welcome again. The retry is the
      // construction, and a failed write is not the user's problem.
    }
  }
}
