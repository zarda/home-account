import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [MatProgressSpinnerModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col items-center justify-center"
      [class.py-8]="size === 'md'"
      [class.py-4]="size === 'sm'"
      [class.py-16]="size === 'lg'"
    >
      <!-- role="progressbar" (Material's own host role) carries no name of
           its own; the caller's message is already the right sentence for a
           screen reader, so it doubles as the label rather than duplicating
           it in a second, silent copy. -->
      <mat-spinner
        [diameter]="diameter"
        [strokeWidth]="strokeWidth"
        [attr.aria-label]="message || ('common.loading' | translate)"
      ></mat-spinner>
      @if (message) {
        <p class="mt-4 text-sm spinner-message">{{ message }}</p>
      }
    </div>
  `,
  styles: [
    `
      .spinner-message {
        color: var(--text-muted);
      }
    `,
  ],
})
export class LoadingSpinnerComponent {
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() message?: string;

  get diameter(): number {
    switch (this.size) {
      case 'sm':
        return 24;
      case 'lg':
        return 64;
      default:
        return 40;
    }
  }

  get strokeWidth(): number {
    switch (this.size) {
      case 'sm':
        return 2;
      case 'lg':
        return 5;
      default:
        return 4;
    }
  }
}
