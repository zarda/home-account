import { Component, inject } from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT } from '../../../models';

/**
 * Shown when storing another receipt image would exceed the free-tier
 * limit. Explains the cap, points at the upcoming paid upgrade, and
 * offers the image manager so the user can free up space by removing an
 * image or converting one into note text.
 */
@Component({
  selector: 'app-receipt-limit-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe, DialogHeaderComponent],
  template: `
    <app-dialog-header
      titleKey="receiptImages.limitTitle"
      icon="photo_library"
      (closed)="close()"
    />
    <mat-dialog-content class="limit-content">
      <p>{{ 'receiptImages.limitMessage' | translate: { limit: limit } }}</p>
      <p>{{ 'receiptImages.freeUpSpace' | translate }}</p>
      <p class="upgrade-note">
        <mat-icon class="upgrade-icon">workspace_premium</mat-icon>
        <span>{{ 'receiptImages.upgradeComingSoon' | translate }}</span>
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="close()">
        {{ 'common.close' | translate }}
      </button>
      <button mat-flat-button color="primary" type="button" (click)="manageImages()">
        <mat-icon>collections</mat-icon>
        {{ 'receiptImages.manage' | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .limit-content {
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .upgrade-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 12px;
      border-radius: var(--radius-sm, 8px);
      background: color-mix(in srgb, var(--color-primary) 8%, transparent);
      color: var(--text-secondary);
    }

    .upgrade-icon {
      color: var(--color-primary);
      flex-shrink: 0;
    }
  `,
})
export class ReceiptLimitDialogComponent {
  private dialogRef = inject(MatDialogRef<ReceiptLimitDialogComponent>);
  private dialog = inject(MatDialog);
  private quota = inject(ReceiptQuotaService);

  readonly limit = Number.isFinite(this.quota.imageLimit())
    ? this.quota.imageLimit()
    : FREE_TIER_RECEIPT_IMAGE_LIMIT;

  close(): void {
    this.dialogRef.close();
  }

  async manageImages(): Promise<void> {
    this.dialogRef.close();
    const { ReceiptImageManagerComponent } = await import('./receipt-image-manager.component');
    this.dialog.open(ReceiptImageManagerComponent, {
      width: '560px',
      maxWidth: '95vw',
      autoFocus: false,
    });
  }
}
