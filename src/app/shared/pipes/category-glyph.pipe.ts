import { Pipe, PipeTransform, inject } from '@angular/core';
import { EffectiveTheme, ThemeService } from '../../core/services/theme.service';
import { CategorySurface, categoryGlyphColor } from '../../core/utils/color-contrast.utils';

/**
 * A category's colour for a glyph painted outside the chip, corrected to
 * clear AA on every tone of the surface it sits on:
 * `cat.color | categoryGlyph:'panel'`. A colour it cannot read, an empty one
 * included, comes back as given; an absent one comes back empty, which a
 * style binding renders as no colour at all.
 *
 * Impure and memoized for the same reason as LocationLabelPipe: the theme is
 * not a pipe input, so a pure pipe would keep the first theme's colour after
 * a switch. Reading `effectiveTheme()` inside the transform is also what
 * repaints an OnPush view on a switch. The memo key is the colour, the
 * surface and the theme.
 */
@Pipe({
  name: 'categoryGlyph',
  standalone: true,
  pure: false,
})
export class CategoryGlyphPipe implements PipeTransform {
  private themeService = inject(ThemeService);

  private lastColor: string | null | undefined;
  private lastSurface: CategorySurface | undefined;
  private lastTheme: EffectiveTheme | undefined;
  private lastResult = '';

  transform(color: string | null | undefined, surface: CategorySurface): string {
    const theme = this.themeService.effectiveTheme();

    if (color === this.lastColor && surface === this.lastSurface && theme === this.lastTheme) {
      return this.lastResult;
    }

    this.lastColor = color;
    this.lastSurface = surface;
    this.lastTheme = theme;
    this.lastResult = color == null ? '' : categoryGlyphColor(color, surface, theme);
    return this.lastResult;
  }
}
