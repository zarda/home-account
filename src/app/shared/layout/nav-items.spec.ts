import { Routes } from '@angular/router';
import { routes } from '../../app.routes';
import { NAV_ITEMS, PALETTE_ONLY_ITEMS, navItemFor } from './nav-items';

describe('navItemFor', () => {
  it('finds a route among the sidebar items', () => {
    expect(navItemFor('/budgets')).toEqual({
      labelKey: 'nav.budgets',
      icon: 'savings',
      route: '/budgets',
    });
  });

  it('finds a route among the palette-only items', () => {
    expect(navItemFor('/import/history')).toEqual({
      labelKey: 'nav.importHistory',
      icon: 'history',
      route: '/import/history',
    });
  });

  it('throws on an unregistered route rather than returning nothing', () => {
    expect(() => navItemFor('/no-such-route')).toThrowError(/no-such-route/);
  });

  it('places the household page right after reports, under its own key and icon', () => {
    const routes = NAV_ITEMS.map((item) => item.route);

    expect(routes.indexOf('/household')).toBe(routes.indexOf('/reports') + 1);
    expect(navItemFor('/household')).toEqual({
      labelKey: 'nav.household',
      icon: 'groups',
      route: '/household',
    });
  });

  it('keeps the two lists free of duplicate routes', () => {
    const routes = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].map((item) => item.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

/**
 * The two lists above are hand-maintained, and `app.routes.ts` is not. A
 * route added without an entry is reachable only by typing its URL — the
 * command palette exists so that nothing is — and an entry whose route was
 * renamed or removed is a destination that navigates nowhere. Neither shows
 * up anywhere else: the router accepts any path, `navItemFor` only throws for
 * a route nobody registered (the opposite direction), and
 * `command-palette.component.spec.ts` counts the entries against the lists
 * rather than against the router.
 *
 * A script would have to parse `app.routes.ts` as text. A spec imports the
 * real config, so it reads what the router actually gets.
 */
describe('the palette and the router agree', () => {
  /**
   * Routes that exist and deliberately carry no entry. Both are guarded away
   * from the state the palette is open in: `publicGuard` bounces a signed-in
   * session off `/login`, and `/lock` is reachable only while the app is
   * locked, which is exactly when no palette can be opened. An entry for
   * either would be a destination that never works.
   */
  const UNLISTED_ROUTES = ['/login', '/lock'];

  /**
   * Every path the router can actually render, absolute and slash-prefixed.
   * A pathless or empty-path entry contributes nothing itself but passes its
   * prefix to its children, which is how the `MainLayoutComponent` shell's
   * twelve children resolve; a `redirectTo` entry is an alias for a path
   * already counted, and `**` is the catch-all.
   */
  function renderableRoutes(config: Routes, prefix = ''): string[] {
    const found: string[] = [];
    for (const route of config) {
      if (route.redirectTo !== undefined) continue;
      if (!route.path || route.path === '**') {
        if (route.children) found.push(...renderableRoutes(route.children, prefix));
        continue;
      }
      const full = `${prefix}/${route.path}`;
      if (route.component || route.loadComponent) found.push(full);
      if (route.children) found.push(...renderableRoutes(route.children, full));
    }
    return found;
  }

  const entryRoutes = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].map((item) => item.route);

  it('reads every renderable route out of the real router config', () => {
    // A guard against the walk itself going quiet: if `renderableRoutes`
    // stopped descending, every assertion below would pass vacuously.
    expect(renderableRoutes(routes).length).toBeGreaterThan(NAV_ITEMS.length);
  });

  it('gives every renderable route a nav or palette entry', () => {
    const missing = renderableRoutes(routes)
      .filter((route) => !UNLISTED_ROUTES.includes(route))
      .filter((route) => !entryRoutes.includes(route));

    expect(missing)
      .withContext('routes reachable only by typing their URL — add a NAV_ITEMS or PALETTE_ONLY_ITEMS entry')
      .toEqual([]);
  });

  it('gives every entry a route that exists', () => {
    const renderable = renderableRoutes(routes);
    const dangling = entryRoutes.filter((route) => !renderable.includes(route));

    expect(dangling)
      .withContext('nav or palette entries whose route the router cannot render')
      .toEqual([]);
  });

  it('keeps the unlisted exemptions pointing at routes that are still there', () => {
    const renderable = renderableRoutes(routes);
    const stale = UNLISTED_ROUTES.filter((route) => !renderable.includes(route));

    expect(stale)
      .withContext('an exemption for a route that no longer exists hides the next one')
      .toEqual([]);
  });
});
