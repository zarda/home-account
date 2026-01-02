import { Component, Input, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { Category } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
  selector: 'app-category-chip',
  standalone: true,
  imports: [MatIconModule, MatChipsModule, TranslatePipe],
  template: `
    @if (category) {
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
        [style.background-color]="getBackgroundColor(category.color)"
        [style.color]="getTextColor(category.color)"
      >
        <mat-icon class="!text-base !w-4 !h-4">{{ category.icon }}</mat-icon>
        @if (showLabel) {
          <span class="font-medium">{{ category.name | translate }}</span>
        }
      </span>
    } @else if (icon && color) {
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
        [style.background-color]="getBackgroundColor(color)"
        [style.color]="getTextColor(color)"
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
  private themeService = inject(ThemeService);

  @Input() category?: Category;
  @Input() icon?: string;
  @Input() color?: string;
  @Input() label?: string;
  @Input() showLabel = true;

  getBackgroundColor(color: string): string {
    // Use higher opacity in dark mode for better visibility
    const opacity = this.themeService.effectiveTheme() === 'dark' ? '40' : '20';
    return color + opacity;
  }

  getTextColor(color: string): string {
    // In dark mode, use a lighter shade of the color for better contrast
    if (this.themeService.effectiveTheme() === 'dark') {
      return this.lightenColor(color, 30);
    }
    return color;
  }

  private lightenColor(hex: string, percent: number): string {
    // Remove # if present
    const cleanHex = hex.replace('#', '');

    // Parse RGB values
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);

    // Lighten each channel
    const newR = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
    const newG = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
    const newB = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));

    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }
}
