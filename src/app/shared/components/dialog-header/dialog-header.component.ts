import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * One dialog title bar: an optional leading icon, the title, and a
 * trailing close-X. The title alone sits on `mat-dialog-title`, so the name
 * Material gives the dialog through `aria-labelledby` is the title's words;
 * the close-X stands beside it in the row, never inside it, where its
 * *Close* ended every dialog's name. Replaces the mix of hand-rolled
 * bordered headers (budget/transaction forms) and bare
 * `<h2 mat-dialog-title>` rows (category/recurring/export/camera) that
 * had no close affordance.
 *
 * The close button emits `(closed)`; the host binds it to its own cancel
 * handler so each dialog keeps its own close result semantics.
 */
@Component({
  selector: 'app-dialog-header',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog-header">
      <h2 mat-dialog-title class="dialog-header-title">
        <span class="dialog-header-text">
          @if (icon()) {
            <mat-icon class="dialog-header-icon">{{ icon() }}</mat-icon>
          }
          {{ titleKey() | translate }}
        </span>
      </h2>
      <button
        mat-icon-button
        type="button"
        class="dialog-header-close"
        (click)="closed.emit()"
        [attr.aria-label]="'common.close' | translate"
      >
        <mat-icon>close</mat-icon>
      </button>
    </div>
  `,
  styles: `
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-primary);
    }

    /* Material sets every dialog title on a 0-wide, 40px strut, its
       ::before, and this row was laid out around it while the title was the
       row: it gives the row its 40px line, and as the row's first item it
       sets a short title midway between the start padding and the close-X,
       a long one 8px in. The title is the row's child now, so the row draws
       the strut and the title draws none. */
    .dialog-header::before {
      content: '';
      width: 0;
      height: 40px;
    }

    /* Material's title is a padded block on its own line height that keeps
       its width. Here it is a bare flex box, as the row was, so the words sit
       where they sat when the title was the row; and an item of the row that
       may give width up, so a long title wraps instead of pushing the close-X
       out of the row. */
    .dialog-header-title {
      display: flex;
      flex-shrink: 1;
      min-width: 0;
      margin: 0;
      padding: 0;
    }

    .dialog-header-title::before {
      content: none;
    }

    .dialog-header-text {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-xl);
      font-weight: 600;
      color: var(--text-primary);
      min-width: 0;
    }

    .dialog-header-icon {
      color: var(--color-primary);
      flex-shrink: 0;
    }

    .dialog-header-close {
      flex-shrink: 0;
      margin: -8px -8px -8px 0;
    }
  `,
})
export class DialogHeaderComponent {
  /** Translation key for the dialog title. */
  titleKey = input.required<string>();
  /** Optional leading Material icon. */
  icon = input('');

  /** Emitted when the close-X is pressed. */
  closed = output<void>();
}
