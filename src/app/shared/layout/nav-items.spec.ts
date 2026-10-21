import { Routes } from '@angular/router';
import { routes } from '../../app.routes';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';
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

  it('gives only the dashboard a name for the bottom bar', () => {
    const short = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS]
      .filter((item) => item.shortLabelKey !== undefined)
      .map((item) => [item.route, item.shortLabelKey]);
    expect(short).toEqual([['/dashboard', 'nav.dashboardShort']]);
    // The item keeps its full name too: the sidebar and the palette read it.
    expect(navItemFor('/dashboard').labelKey).toBe('nav.dashboard');
  });
});

/**
 * `check-i18n.mjs` counts `t(item.labelKey)` as a dynamic lookup and skips it,
 * so a key misspelled in either list, or a `shortLabelKey` missing from one
 * catalog, reaches the screen as the raw key (`nav.dashboardShort`) and no
 * other gate says so. This walks the lists the surfaces actually read.
 */
describe('every nav label key resolves in every catalog', () => {
  const CATALOGS: Record<string, unknown> = { en, ja, tc };

  /** The leaf at a dotted path, or undefined when any step of the walk misses. */
  function leafAt(tree: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>(
      (node, step) =>
        node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[step] : undefined,
      tree,
    );
  }

  const keys = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].flatMap((item) =>
    item.shortLabelKey === undefined ? [item.labelKey] : [item.labelKey, item.shortLabelKey],
  );

  it('walks a real list of keys, the short one included', () => {
    // A guard against the walk going quiet: an empty list would pass every
    // case below vacuously.
    expect(keys.length).toBeGreaterThan(NAV_ITEMS.length);
    expect(keys).toContain('nav.dashboardShort');
  });

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    it(`reads a non-empty string for each key in ${locale}`, () => {
      const unresolved = keys.filter((key) => {
        const leaf = leafAt(catalog, key);
        return typeof leaf !== 'string' || leaf.trim() === '';
      });

      expect(unresolved)
        .withContext(`nav keys with no text in the ${locale} catalog`)
        .toEqual([]);
    });
  }
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
