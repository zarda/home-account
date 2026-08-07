import { Injectable } from '@angular/core';

/**
 * A row the registry can close. Implemented by `SwipeRevealDirective`; split
 * out so the registry never depends on the directive and the two can be
 * tested apart — the same shape as `FitTextTarget`.
 */
export interface SwipeRevealHandle {
  close(): void;
}

/**
 * At most one row's swipe drawer is open at a time, app-wide.
 *
 * Two open drawers is never what a reader meant: the second gesture is a
 * statement that attention moved, and the first drawer left open is a stale
 * Delete button parked next to content it no longer refers to. Every platform
 * list behaves this way, so a second-opens-while-first-stays would also read
 * as a bug.
 *
 * The registry is the whole coordination surface: a directive announces the
 * moment a gesture starts, and whoever else was open closes. Nothing here
 * touches the DOM.
 */
@Injectable({ providedIn: 'root' })
export class SwipeRevealRegistry {
  private open: SwipeRevealHandle | null = null;

  /**
   * A row's gesture is starting: close whichever other row is open. Called on
   * pointerdown rather than on open, so tapping a third row anywhere retires
   * the stale drawer even when the tap never becomes a swipe.
   */
  interact(handle: SwipeRevealHandle): void {
    if (this.open && this.open !== handle) {
      this.open.close();
    }
  }

  /** The handle's drawer is now open; it becomes the one the next interact closes. */
  opened(handle: SwipeRevealHandle): void {
    this.open = handle;
  }

  /** The handle's drawer closed (or its row was destroyed). */
  closed(handle: SwipeRevealHandle): void {
    if (this.open === handle) {
      this.open = null;
    }
  }
}
