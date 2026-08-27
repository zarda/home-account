import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TransactionFormComponent } from '../../features/transactions/transaction-form/transaction-form.component';
import { CameraCaptureComponent } from '../../features/transactions/camera-capture/camera-capture.component';

/**
 * The app's one quick-add seam. Every entry point that starts an add-transaction
 * flow — the bottom nav, the transactions page, and upcoming callers (onboarding,
 * empty-state CTAs, a keyboard hotkey, a command palette) — opens the same
 * dialogs with the same configuration through this service, so the config
 * lives in exactly one place.
 */
@Injectable({ providedIn: 'root' })
export class QuickAddService {
  private dialog = inject(MatDialog);
  private router = inject(Router);

  openAddTransaction(): void {
    // Open dialog directly - works from any page
    this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });
  }

  openScanReceipt(): void {
    // Same dialog config as the transactions page camera entry
    this.dialog.open(CameraCaptureComponent, {
      width: '500px',
      maxWidth: '95vw',
    });
  }

  openImportPhotos(): void {
    this.router.navigate(['/import/file']);
  }
}
