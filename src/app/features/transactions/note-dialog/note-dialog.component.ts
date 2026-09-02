import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

import { NoteTranslationComponent } from '../../../shared/components/note-translation/note-translation.component';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

export interface NoteDialogData {
  note: string;
  /** The transaction the note belongs to, so the note is not read out of context. */
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
  readonly data: NoteDialogData = inject(MAT_DIALOG_DATA);

  /** Owned here, written by the lens: what tells the note to step aside. */
  readonly showingTranslation = signal(false);

  close(): void {
    this.dialogRef.close();
  }
}
