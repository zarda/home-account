import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * One dialog title bar: an optional leading icon, the title, and a
 * trailing close-X. Sits on `mat-dialog-title` so Material still wires
 * `aria-labelledby` for the dialog. Replaces the mix of hand-rolled
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
    <h2 mat-dialog-title class="dialog-header">
      <span class="dialog-header-text">
        @if (icon()) {
          <mat-icon class="dialog-header-icon">{{ icon() }}</mat-icon>
        }
        {{ titleKey() | translate }}
      </span>
      <button
        mat-icon-button
        type="button"
        class="dialog-header-close"
        (click)="closed.emit()"
        [attr.aria-label]="'common.close' | translate"
      >
        <mat-icon>close</mat-icon>
      </button>
    </h2>
  `,
  styles: `
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0;
      padding: 16px 24px;
      border-bottom: 1px solid var(--border-primary);
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
