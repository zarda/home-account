import { Component, EventEmitter, Input, Output } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  template: `
    <div
      class="flex flex-col items-center justify-center text-center"
      [class.py-12]="size === 'md'"
      [class.px-4]="size === 'md'"
      [class.py-6]="size === 'sm'"
      [class.px-3]="size === 'sm'"
      role="status"
      aria-live="polite"
    >
      <div
        class="rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center"
        [class.w-16]="size === 'md'"
        [class.h-16]="size === 'md'"
        [class.mb-4]="size === 'md'"
        [class.w-12]="size === 'sm'"
        [class.h-12]="size === 'sm'"
        [class.mb-3]="size === 'sm'"
      >
        <mat-icon
          class="text-gray-400 dark:text-gray-500"
          [class.!text-4xl]="size === 'md'"
          [class.!w-10]="size === 'md'"
          [class.!h-10]="size === 'md'"
          [class.!text-2xl]="size === 'sm'"
          [class.!w-8]="size === 'sm'"
          [class.!h-8]="size === 'sm'"
          >{{ icon }}</mat-icon
        >
      </div>

      <h3
        class="font-medium text-gray-900 dark:text-gray-100 mb-1"
        [class.text-lg]="size === 'md'"
        [class.text-base]="size === 'sm'"
      >
        {{ title }}
      </h3>

      @if (description) {
        <p
          class="text-gray-500 dark:text-gray-400 max-w-sm"
          [class.text-sm]="size === 'md'"
          [class.text-xs]="size === 'sm'"
          [class.mb-6]="size === 'md' && actionLabel"
          [class.mb-3]="size === 'sm' && actionLabel"
        >
          {{ description }}
        </p>
      }

      @if (actionLabel) {
        <button mat-flat-button color="primary" (click)="action.emit()" [class.mt-2]="!description">
          @if (actionIcon) {
            <mat-icon>{{ actionIcon }}</mat-icon>
          }
          {{ actionLabel }}
        </button>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  @Input() icon = 'inbox';
  @Input({ required: true }) title!: string;
  @Input() description?: string;
  @Input() actionLabel?: string;
  @Input() actionIcon?: string;
  /** 'sm' shrinks the icon circle, type, and padding for in-card use. */
  @Input() size: 'sm' | 'md' = 'md';
  @Output() action = new EventEmitter<void>();
}
