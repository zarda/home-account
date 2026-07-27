import { reflectComponentType, Type } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';

/**
 * Screen identity for a screen_view event.
 *
 * @angular/fire ships a ScreenTrackingService that does this, and it cannot be
 * used here: its factory declares ComponentFactoryResolver as a non-optional
 * dependency (angular-fire-analytics.mjs), and that symbol was removed from
 * @angular/core in v22, so injecting the service throws. @angular/fire 20 is
 * the newest release and still declares it. The service also has no start/stop
 * hook, which an opt-in toggle needs.
 *
 * The derivation below reproduces the library's screen_name so the two are
 * interchangeable if a later @angular/fire restores compatibility, with one
 * deliberate difference noted on screenClass.
 */
export interface ScreenView {
  screenName: string;
  screenClass: string;
}

/**
 * screen_name is the chain of route *paths* — 'dashboard', 'import/file' —
 * never a class name. Paths survive minification and are a closed set that
 * docs/analytics.md can enumerate and the registry check can verify against
 * app.routes.ts. The empty path of the layout route drops out of the join, and
 * a root-only URL reports '/'.
 */
function screenNameOf(snapshot: ActivatedRouteSnapshot): string {
  return (
    snapshot.pathFromRoot
      .map(route => route.routeConfig?.path)
      .filter((path): path is string => !!path)
      .join('/') || '/'
  );
}

/**
 * screen_class is the component's element selector.
 *
 * This is where the derivation deliberately differs from @angular/fire, which
 * reads the *top-level* activated route and only descends past an empty outlet
 * component. Every page in this app is a child of MainLayoutComponent, so the
 * library would report 'app-main-layout' for dashboard, transactions, budgets,
 * reports, settings, about and both import screens alike — one value for eight
 * screens. Reading the deepest activated route instead makes the field carry
 * something, at the cost of not matching the library byte for byte.
 *
 * reflectComponentType replaces the removed ComponentFactoryResolver; it is
 * the supported way to read a component's selector in v22.
 */
function screenClassOf(snapshot: ActivatedRouteSnapshot): string {
  const component = snapshot.component;
  if (typeof component === 'string') {
    return component;
  }
  if (!component) {
    return 'unknown';
  }
  return reflectComponentType(component as Type<unknown>)?.selector ?? 'unknown';
}

/**
 * The screen currently on display, or null when nothing is activated yet.
 *
 * Null is a real case, not defensive padding. Consent resolves at the moment
 * the auth guard releases the first navigation, so a subscription primed the
 * instant consent arrives can run while the router still has no activated
 * child — reporting a phantom '/' screen at the top of most sessions if that
 * is not caught here.
 */
export function currentScreenView(router: Router): ScreenView | null {
  if (!router.navigated) {
    return null;
  }

  let snapshot = router.routerState.snapshot.root;
  if (!snapshot.firstChild) {
    return null;
  }
  while (snapshot.firstChild) {
    snapshot = snapshot.firstChild;
  }

  return { screenName: screenNameOf(snapshot), screenClass: screenClassOf(snapshot) };
}
