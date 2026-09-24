import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { Category } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { EffectiveTheme, ThemeService } from '../../../core/services/theme.service';
import {
  WCAG_AA_TEXT,
  compositeOver,
  ensureContrast,
  parseHexColor,
  toHexColor,
} from '../../../core/utils/color-contrast.utils';

/**
 * The surface a chip's tint is composited over: the stylesheet's
 * --surface-card in each theme (the spec reads the stylesheet to hold the two
 * together).
 *
 * A chip is rendered on more than one surface — the transaction list's card,
 * Material cards on the dashboard, budgets and reports, the settings category
 * list's --surface-subtle, and whatever hover or highlight tone the row under
 * it takes (#3d3d3d in dark) — and a translucent tint takes on whichever is
 * underneath, so no one foreground could be shown to clear AA on all of them.
 * Composited once and painted opaque, the tint is the only background the
 * glyph and label ever sit on. The card is the surface chosen because most
 * chips sit on it, and every resting surface above is within 13 levels a
 * channel of it in either theme.
 */
export const CHIP_SURFACE: Readonly<Record<EffectiveTheme, string>> = {
  light: '#ffffff',
  dark: '#1e1e1e',
};

/** The tint's strength, heavier in dark so the tile still reads as coloured. */
const TINT_ALPHA: Readonly<Record<EffectiveTheme, number>> = {
  light: 0x20 / 0xff,
  dark: 0x40 / 0xff,
};

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
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
          <!-- Box sizing comes from the global mat-icon 1em rule, so the
               glyph stays contained at any browser font size -->
          <mat-icon class="!text-base">{{ resolvedIcon() }}</mat-icon>
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
        width: 1em;
        height: 1em;
        line-height: 1;
      }
    }

    .tile-sm {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-sm);

      mat-icon {
        font-size: var(--text-lg);
        width: 1em;
        height: 1em;
        line-height: 1;
      }
    }

    .tile-lg {
      width: 48px;
      height: 48px;

      mat-icon {
        font-size: var(--text-2xl);
        width: 1em;
        height: 1em;
        line-height: 1;
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

  /**
   * The category's colour, tinted over the card surface and painted opaque.
   * A colour that is not opaque hex cannot be tinted, so the chip keeps the
   * plain surface and the colour is left to the glyph.
   */
  getBackgroundColor(color: string): string {
    const theme = this.themeService.effectiveTheme();
    const rgb = parseHexColor(color);
    const surface = parseHexColor(CHIP_SURFACE[theme])!;
    return rgb ? toHexColor(compositeOver(rgb, TINT_ALPHA[theme], surface)) : CHIP_SURFACE[theme];
  }

  /**
   * The category's colour, moved only as far as it must be to reach AA on
   * its own tint: darker in light, lighter in dark, same hue. Both the tile's
   * icon and the pill's icon and label are painted with it.
   */
  getTextColor(color: string): string {
    const theme = this.themeService.effectiveTheme();
    return ensureContrast(
      color,
      this.getBackgroundColor(color),
      WCAG_AA_TEXT,
      theme === 'dark' ? 'lighten' : 'darken'
    );
  }
}
