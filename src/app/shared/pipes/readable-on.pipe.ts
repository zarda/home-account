import { Pipe, PipeTransform } from '@angular/core';
import { readableOn } from '../../core/utils/color-contrast.utils';

/**
 * Black or white, whichever reads better on a fill of the category's own
 * colour: `cat.color | readableOn` on a tile or swatch painted in it. Never
 * under 4.58:1, whatever the fill and in either theme, so the theme is not
 * an input and the pipe stays pure. A fill it cannot read, or none, gets
 * white.
 */
@Pipe({
  name: 'readableOn',
  standalone: true,
})
export class ReadableOnPipe implements PipeTransform {
  transform(fill: string | null | undefined): string {
    return readableOn(fill ?? '');
  }
}
