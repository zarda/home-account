import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { MatSelect } from '@angular/material/select';

/** Keys a closed mat-select takes as a choice of another option outright. */
const PICKING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

function picksWhileClosed(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;
  if (PICKING_KEYS.has(event.key)) return true;
  // A typed character: the select's typeahead picks the first option it starts.
  return event.key.length === 1 && event.key !== ' ';
}

/**
 * A closed mat-select takes an arrow key, Home, End, a page key or a typed
 * character as a choice of another option, and in the household switcher
 * every choice swaps the page for another household and moves focus to it.
 * Arrowing through the closed switcher would swap household after household
 * and take focus away at the first press. On the closed switcher those keys
 * open its list instead, as a native select does on macOS, so a household is
 * switched to only by choosing it there.
 *
 * The listener is on the select itself, in the capture phase, so it runs
 * before the select's own keydown handler and can keep the key from it.
 */
@Directive({
  selector: 'mat-select[appSwitchOnChoice]',
  standalone: true
})
export class SwitchOnChoiceDirective {
  constructor() {
    const select = inject(MatSelect);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const onKeydown = (event: KeyboardEvent): void => {
      if (select.panelOpen || select.disabled || !picksWhileClosed(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      select.open();
    };
    host.addEventListener('keydown', onKeydown, { capture: true });
    inject(DestroyRef).onDestroy(() => host.removeEventListener('keydown', onKeydown, { capture: true }));
  }
}
