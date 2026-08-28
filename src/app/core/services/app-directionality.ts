import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Directionality, type Direction } from '@angular/cdk/bidi';

/**
 * The application's layout direction, provided in place of CDK's own
 * Directionality (app.config.ts aliases the CDK token to this class, so every
 * `inject(Directionality)` inside Material and the CDK resolves to it).
 *
 * Why a subclass rather than just writing the attribute: CDK's Directionality
 * reads `body.dir || documentElement.dir` exactly once, in its constructor,
 * and never observes the attribute again. Setting `<html dir>` alone therefore
 * reaches the CSS and nothing else — every menu, tooltip, drawer, slider and
 * overlay already constructed keeps positioning itself with the direction it
 * was born with. setDirection() moves the attribute, the signal components
 * read, and the change stream they subscribe to, in one motion.
 *
 * This relies on `valueSignal` being writable public API on Directionality
 * (CDK 22). If a future major hides it, the fallback is to stop subclassing
 * and implement the Directionality contract wholesale — `value`, `valueSignal`,
 * `change`, `ngOnDestroy` — behind the same alias provider, which is the only
 * part of this that Material and the CDK actually depend on. See ADR 0071.
 */
@Injectable({ providedIn: 'root' })
export class AppDirectionality extends Directionality {
  private readonly document = inject(DOCUMENT);

  /**
   * Point the whole application at `dir`. Asking for the direction already in
   * force is a complete no-op — no attribute write, no emission — so
   * subscribers only ever see real flips, and the repeated `setDirection` on
   * every locale switch between two same-direction languages costs nothing.
   */
  setDirection(dir: Direction): void {
    if (this.value === dir) {
      return;
    }

    this.document.documentElement.dir = dir;
    this.valueSignal.set(dir);
    this.change.emit(dir);
  }
}
