import { Signal, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { APP_BREAKPOINTS } from './breakpoints';

/**
 * True while the viewport is in the mobile range (<600px) — the one way to ask
 * "am I in the mobile layout?".
 *
 * The question is about the viewport, never the user agent. `DeviceService`
 * answers a different question — can this device capture from a camera — and
 * its answer is yes for a tablet and for a phone in landscape, both of which
 * are laid out as desktop. The transactions page gated its add FAB on that
 * service while the bottom-nav "+" meant to replace it bound to this query, so
 * at 600px and wider on a phone the app had no add affordance at all: turning
 * the phone sideways took the bottom bar away and put nothing back.
 *
 * Call from an injection context (a field initializer or a constructor), like
 * `inject` itself. MainLayoutComponent observes the same query inside its
 * three-query array because it needs the whole split in one subscription;
 * add-affordance.spec.ts drives both from one fake and proves they still agree.
 */
export function injectIsMobileViewport(): Signal<boolean> {
  return toSignal(
    inject(BreakpointObserver)
      .observe(APP_BREAKPOINTS.mobile)
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
}
