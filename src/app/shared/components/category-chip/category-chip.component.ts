import { Component, Input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { Category } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-category-chip',
  standalone: true,
  imports: [MatIconModule, MatChipsModule, TranslatePipe],
  template: `
    @if (category) {
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
        [style.background-color]="category.color + '20'"
        [style.color]="category.color"
      >
        <mat-icon class="!text-base !w-4 !h-4">{{ category.icon }}</mat-icon>
        @if (showLabel) {
          <span class="font-medium">{{ category.name | translate }}</span>
        }
      </span>
    } @else if (icon && color) {
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
        [style.background-color]="color + '20'"
        [style.color]="color"
      >
        <mat-icon class="!text-base !w-4 !h-4">{{ icon }}</mat-icon>
        @if (showLabel && label) {
          <span class="font-medium">{{ label | translate }}</span>
        }
      </span>
    }
  `,
})
export class CategoryChipComponent {
  @Input() category?: Category;
  @Input() icon?: string;
  @Input() color?: string;
  @Input() label?: string;
  @Input() showLabel = true;
}
