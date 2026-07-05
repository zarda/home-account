import { Component, Input, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { Category } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * Category color chip in two appearances:
 *  - 'pill' (default): icon + optional translated label in a rounded pill.
 *  - 'tile': square icon tile — replaces the local `.category-icon` div
 *    re-implementations that had drifted in alpha, size, radius, and
 *    dark-mode handling across lists, budgets, reports, and settings.
 *
 * Accepts either a Category object or explicit icon/color/label inputs.
 */
@Component({
  selector: 'app-category-chip',
  standalone: true,
  imports: [MatIconModule, MatChipsModule, TranslatePipe],
  template: `
    @if (resolvedColor(); as color) {
      @if (appearance === 'tile') {
        <span
          class="tile"
          [class.tile-sm]="size === 'sm'"
          [class.tile-lg]="size === 'lg'"
          [style.background-color]="getBackgroundColor(color)"
        >
          <mat-icon [style.color]="getTextColor(color)">{{ resolvedIcon() }}</mat-icon>
        </span>
      } @else {
        <span
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
          [style.background-color]="getBackgroundColor(color)"
          [style.color]="getTextColor(color)"
        >
          <mat-icon class="!text-base !w-4 !h-4">{{ resolvedIcon() }}</mat-icon>
          @if (showLabel && resolvedLabel(); as chipLabel) {
            <span class="font-medium">{{ chipLabel | translate }}</span>
          }
        </span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      flex-shrink: 0;

      mat-icon {
        font-size: var(--text-xl);
        width: 20px;
        height: 20px;
        line-height: 20px;
      }
    }

    .tile-sm {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);

      mat-icon {
        font-size: var(--text-lg);
        width: 18px;
        height: 18px;
        line-height: 18px;
      }
    }

    .tile-lg {
      width: 48px;
      height: 48px;

      mat-icon {
        font-size: var(--text-2xl);
        width: 24px;
        height: 24px;
        line-height: 24px;
      }
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
  @Input() appearance: 'pill' | 'tile' = 'pill';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';

  resolvedIcon(): string {
    return this.category?.icon ?? this.icon ?? 'category';
  }

  resolvedColor(): string | undefined {
    return this.category?.color ?? this.color;
  }

  resolvedLabel(): string | undefined {
    return this.category?.name ?? this.label;
  }

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
