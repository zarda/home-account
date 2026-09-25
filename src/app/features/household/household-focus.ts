import { DestroyRef, Injectable, Injector, afterNextRender, signal } from '@angular/core';

import type { HouseholdStatus } from '../../core/services/household.service';

/** What a section needs to move focus within its own markup. */
export interface FocusContext {
  host: HTMLElement;
  injector: Injector;
  destroyRef: DestroyRef;
}

/**
 * Moves focus to the first of `selectors` found under the host once the next
 * render has settled, and only when focus was left on the document itself,
 * which is where it goes when the element holding it is removed: wherever else
 * the viewer has put it by then, it stays. The target exists only once it has
 * rendered, which is what afterNextRender waits for; registering on a
 * destroyed injector throws NG0911, hence the guard.
 */
export function focusWhenRendered({ host, injector, destroyRef }: FocusContext, selectors: readonly string[]): void {
  if (destroyRef.destroyed) return;
  afterNextRender(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    for (const selector of selectors) {
      const target = host.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        return;
      }
    }
  }, { injector });
}

/**
 * Where focus goes when an action replaces the section it was taken in.
 * Creating or joining swaps the setup for the member view, leaving or
 * dissolving swaps it back, and a retry replaces the notice that holds its
 * button; each takes the focused element with it. The acting section names the
 * status it waits for, and the page, which renders every section, moves focus
 * once that status is on screen.
 *
 * Only an action, or the page's own notice that access was lost, sets it: a
 * first load, or a change made on another device, moves nothing.
 */
@Injectable()
export class HouseholdPageFocus {
  private readonly awaitedStatuses = signal<readonly HouseholdStatus[] | null>(null);

  /** The statuses a swap is waited on for; null when none is. */
  readonly awaited = this.awaitedStatuses.asReadonly();

  /** Focus moves on the next time the page shows one of these. */
  afterSwapTo(...statuses: HouseholdStatus[]): void {
    this.awaitedStatuses.set(statuses);
  }

  clear(): void {
    this.awaitedStatuses.set(null);
  }
}
