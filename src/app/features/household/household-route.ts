import type { Router } from '@angular/router';

/**
 * The household /household/{hid} names; null at /household. Read from the
 * deepest route the router has activated, where app.routes.ts puts the
 * `:hid` child of the household page.
 */
export function routedHouseholdId(router: Router): string | null {
  let route = router.routerState.snapshot.root;
  while (route.firstChild) route = route.firstChild;
  return route.paramMap.get('hid');
}
