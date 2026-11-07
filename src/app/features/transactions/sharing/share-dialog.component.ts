import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { ShareTarget, shareChange } from '../../../core/utils/share-change.utils';
import { transactionDisplayName } from '../../../core/utils/transaction-display.utils';

/**
 * - `row`: who one row is shared with.
 * - `share`: the households many selected rows are to be shared into.
 * - `unshare`: the households many selected rows are to be taken out of.
 */
export type ShareDialogMode = 'row' | 'share' | 'unshare';

export interface ShareDialogData {
  /**
   * For one row, its description as stored, which the dialog names as the
   * row's controls do (an untitled one by the catalog's words for one), so
   * it says which row it shares; for many rows, how many are selected, in
   * the caller's words.
   */
  description: string;
  /** The account's live memberships, one checkbox each. */
  targets: ShareTarget[];
  /**
   * The households checked when the dialog opens: for one row, those it is
   * shared with now; for many, a suggestion the reader may change.
   */
  shared: string[];
  /** `row` when left out. */
  mode?: ShareDialogMode;
}

/**
 * Who one row is shared with, chosen from the transaction list's row menu:
 * a checkbox per live membership, set from the row. Closes with every
 * household the row is to name, or with nothing when dismissed; the caller
 * turns the difference into shares and unshares.
 *
 * For many rows, from the list's select mode, it asks instead which
 * households to share them into or to take them out of, and closes with just
 * those. It cannot close with none: a choice of nothing is a dismissal.
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
  private readonly translationService = inject(TranslationService);

  readonly mode: ShareDialogMode = this.data.mode ?? 'row';

  readonly chosen = signal<string[]>([...this.data.shared]);

  /**
   * A household unchecked stops seeing the row, and its goals stop counting
   * it; for many rows, a household checked to be taken out of does. The
   * dialog says so before it is saved.
   */
  readonly pendingUnshare = computed(() => {
    if (this.mode === 'share') return false;
    if (this.mode === 'unshare') return this.chosen().length > 0;
    return shareChange(this.data.shared, this.chosen(), this.data.targets.map(target => target.householdId)).unshare.length > 0;
  });

  /**
   * An unshare made offline is queued, and the household keeps seeing the
   * row until the device reconnects and the unshare lands; the dialog says
   * that too.
   */
  readonly offlineUnshare = computed(() => !this.pwa.isOnline() && this.pendingUnshare());

  /**
   * Offline, many rows' keys are queued and their copies wait for the
   * device to come back, so the households see nothing until then.
   */
  readonly offlineShare = computed(() => this.mode === 'share' && !this.pwa.isOnline());

  /** For many rows there is nothing to do until a household is checked. */
  readonly canSave = computed(() => this.mode === 'row' || this.chosen().length > 0);

  /**
   * One row as the line above the households names it: its description, or
   * the catalog's words for an untitled one, through the rule the list's
   * rows name it by. The template calls it, and the service's t reads its
   * catalog signal, so it follows a language switch made while the dialog
   * is open. Many rows are named by the caller's words instead, a count that
   * is no description, so never by this rule.
   */
  protected transactionName(): string {
    return transactionDisplayName(this.data.description, key => this.translationService.t(key));
  }

  isChosen(householdId: string): boolean {
    return this.chosen().includes(householdId);
  }

  toggle(householdId: string, checked: boolean): void {
    this.chosen.update(chosen => checked
      ? (chosen.includes(householdId) ? chosen : [...chosen, householdId])
      : chosen.filter(id => id !== householdId));
  }

  save(): void {
    if (!this.canSave()) return;
    this.dialogRef.close(this.chosen());
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
