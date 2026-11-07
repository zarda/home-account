import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

import { NoteTranslationComponent } from '../../../shared/components/note-translation/note-translation.component';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { TranslationService } from '../../../core/services/translation.service';
import { transactionDisplayName } from '../../../core/utils/transaction-display.utils';

export interface NoteDialogData {
  note: string;
  /**
   * The description of the transaction the note belongs to, as stored, so
   * the note is not read out of context. The dialog names the transaction
   * from it as its row's controls do (an untitled one by the catalog's words
   * for one).
   */
  description: string;
}

/**
 * One transaction's note, read at full length.
 *
 * The list can only ever show that a note exists — a tooltip is not a place
 * to read three lines off a receipt, and it is unreachable from a phone. This
 * is where the note is actually read, and the only surface where reading it
 * and translating it happen in the same place: the lens stands its answer in
 * for the original rather than stacking two copies of the same text.
 *
 * Read-only by design. Editing a note stays in the transaction form, which
 * owns validation and saving; a second editable copy of one field would be a
 * second way for the two to disagree.
 */
@Component({
  selector: 'app-note-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    DialogHeaderComponent,
    NoteTranslationComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './note-dialog.component.html',
  styleUrl: './note-dialog.component.scss',
})
export class NoteDialogComponent {
  private dialogRef = inject(MatDialogRef<NoteDialogComponent>);
  private translationService = inject(TranslationService);
  readonly data: NoteDialogData = inject(MAT_DIALOG_DATA);

  /** Owned here, written by the lens: what tells the note to step aside. */
  readonly showingTranslation = signal(false);

  /**
   * The transaction the subtitle names: its description, or the catalog's
   * words for an untitled one, through the rule the list's rows name it by.
   * The template calls it, and the service's t reads its catalog signal, so
   * it follows a language switch made while the note is open; a name handed
   * in already translated would keep the language the note opened in.
   */
  protected transactionName(): string {
    return transactionDisplayName(this.data.description, key => this.translationService.t(key));
  }

  close(): void {
    this.dialogRef.close();
  }
}
