import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { currentScreenView } from './analytics-screen-view';

@Component({ selector: 'app-dashboard-stub', template: '' })
class DashboardStubComponent {}

/**
 * Builds the snapshot chain the router exposes: a root with no path, the
 * layout route with an empty path, then the page. Mirrors the real shape of
 * app.routes.ts, where every page is a child of the '' MainLayoutComponent
 * route.
 */
function routerWith(
  paths: (string | undefined)[],
  component: unknown = DashboardStubComponent,
  navigated = true
): Router {
  const chain = paths.map(path => ({ routeConfig: path === undefined ? null : { path } }));
  const deepest = {
    ...chain[chain.length - 1],
    component,
    pathFromRoot: chain,
    firstChild: null,
  };
  // Only the root needs a firstChild for the walk; the intermediate links are
  // reached through pathFromRoot.
  const root = { firstChild: chain.length > 1 ? deepest : null, pathFromRoot: [chain[0]] };

  return {
    navigated,
    routerState: { snapshot: { root } },
  } as unknown as Router;
}

describe('currentScreenView', () => {
  it('should name the screen after the route path chain', () => {
    const screen = currentScreenView(routerWith([undefined, '', 'dashboard']));

    // Paths, not class names: they survive minification and are the closed set
    // docs/analytics.md enumerates and the registry check verifies.
    expect(screen?.screenName).toBe('dashboard');
  });

  it('should join nested paths', () => {
    const screen = currentScreenView(routerWith([undefined, '', 'import/file']));

    expect(screen?.screenName).toBe('import/file');
  });

  it('should drop the empty layout path from the name', () => {
    // The '' MainLayoutComponent route wraps every page; if it survived the
    // join every screen name would start with a slash.
    const screen = currentScreenView(routerWith([undefined, '', 'settings']));

    expect(screen?.screenName).toBe('settings');
  });

  it('should report the deepest component selector as the screen class', () => {
    const screen = currentScreenView(routerWith([undefined, '', 'dashboard']));

    // @angular/fire reads the *top-level* activated route here, which in this
    // app is always MainLayoutComponent — one value for eight screens. Reading
    // the deepest route instead is the one deliberate divergence.
    expect(screen?.screenClass).toBe('app-dashboard-stub');
  });

  it('should fall back to a placeholder when the route has no component', () => {
    const screen = currentScreenView(routerWith([undefined, '', 'dashboard'], null));

    expect(screen?.screenClass).toBe('unknown');
  });

  it('should report nothing before the first navigation completes', () => {
    // Consent resolves at the moment the auth guard releases the first
    // navigation, so a subscription primed right then can run with nothing
    // activated. Returning a screen here would put a phantom '/' at the top of
    // most sessions.
    expect(currentScreenView(routerWith([undefined], null, false))).toBeNull();
  });

  it('should report nothing when no child route is activated', () => {
    const router = {
      navigated: true,
      routerState: { snapshot: { root: { firstChild: null, pathFromRoot: [] } } },
    } as unknown as Router;

    expect(currentScreenView(router)).toBeNull();
  });
});
