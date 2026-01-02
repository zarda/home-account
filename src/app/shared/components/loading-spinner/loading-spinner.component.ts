import { Component, Input } from '@angular/core';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  template: `
    <div
      class="flex flex-col items-center justify-center"
      [class.py-8]="size === 'md'"
      [class.py-4]="size === 'sm'"
      [class.py-16]="size === 'lg'"
    >
      <mat-spinner [diameter]="diameter" [strokeWidth]="strokeWidth"></mat-spinner>
      @if (message) {
        <p class="mt-4 text-gray-500 dark:text-gray-400 text-sm">{{ message }}</p>
      }
    </div>
  `,
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
