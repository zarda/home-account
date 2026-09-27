import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { PwaService } from '../../../core/services/pwa.service';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { ShareTarget, shareChange } from '../../../core/utils/share-change.utils';

export interface ShareDialogData {
  /** The row's description, so the dialog says which row it shares. */
  description: string;
  /** The account's live memberships, one checkbox each. */
  targets: ShareTarget[];
  /** The households the row is shared with now. */
  shared: string[];
}

/**
 * Who one row is shared with, chosen from the transaction list's row menu:
 * a checkbox per live membership, set from the row. Closes with every
 * household the row is to name, or with nothing when dismissed; the caller
 * turns the difference into shares and unshares.
 */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  imports: [DialogHeaderComponent, MatDialogModule, MatButtonModule, MatCheckboxModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './share-dialog.component.html',
  styleUrl: './share-dialog.component.scss',
})
export class ShareDialogComponent {
  readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ShareDialogComponent, string[]>>(MatDialogRef);
  private readonly pwa = inject(PwaService);

  readonly chosen = signal<string[]>([...this.data.shared]);

  /**
   * A household unchecked stops seeing the row, and its goals stop counting
   * it; the dialog says so before it is saved.
   */
  readonly pendingUnshare = computed(() =>
    shareChange(this.data.shared, this.chosen(), this.data.targets.map(target => target.householdId)).unshare.length > 0
  );

  /**
   * An unshare made offline is queued, and the household keeps seeing the
   * row until the device reconnects and the unshare lands; the dialog says
   * that too.
   */
  readonly offlineUnshare = computed(() => !this.pwa.isOnline() && this.pendingUnshare());

  isChosen(householdId: string): boolean {
    return this.chosen().includes(householdId);
  }

  toggle(householdId: string, checked: boolean): void {
    this.chosen.update(chosen => checked
      ? (chosen.includes(householdId) ? chosen : [...chosen, householdId])
      : chosen.filter(id => id !== householdId));
  }

  save(): void {
    this.dialogRef.close(this.chosen());
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
