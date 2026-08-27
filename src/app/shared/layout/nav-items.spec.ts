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

  it('keeps the two lists free of duplicate routes', () => {
    const routes = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].map((item) => item.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
