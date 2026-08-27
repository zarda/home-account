/**
 * The single list of navigation destinations, shared by the sidebar, the
 * bottom nav, and the command palette. Before this, the sidebar and the
 * bottom nav each kept their own copy — and drifted: the sidebar labelled
 * `/budgets` with `nav.budget` while the bottom nav labelled the same route
 * `nav.budgets`, so one destination carried two names and two catalog keys
 * until this file retired the mismatch (`nav.budget` is gone from all three
 * catalogs). Consuming one list makes that class of drift impossible; a
 * surface still decides which items it shows (the bottom nav's five slots,
 * the palette's extra entries), but never what an item is called or which
 * icon it wears.
 */
export interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
}

/** The sidebar's full set, in display order. */
export const NAV_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.dashboard', icon: 'dashboard', route: '/dashboard' },
  { labelKey: 'nav.transactions', icon: 'receipt_long', route: '/transactions' },
  { labelKey: 'nav.budgets', icon: 'savings', route: '/budgets' },
  { labelKey: 'nav.reports', icon: 'bar_chart', route: '/reports' },
  { labelKey: 'nav.ai', icon: 'psychology', route: '/ai' },
  { labelKey: 'nav.data', icon: 'storage', route: '/data' },
  { labelKey: 'nav.settings', icon: 'settings', route: '/settings' },
  { labelKey: 'nav.about', icon: 'info', route: '/about' },
];

/**
 * Destinations no navigation *slot* carries — not the sidebar's list, not
 * the bottom nav's five. Each is still reachable today, from inside a
 * feature: `/search-history` from the Smart Search dialog and the Data hub,
 * `/import/file` from the bottom nav's Add menu and the Data page,
 * `/import/history` from the Data page. What the palette adds is a way to
 * reach all three by name, from anywhere.
 */
export const PALETTE_ONLY_ITEMS: readonly NavItem[] = [
  { labelKey: 'nav.searchHistory', icon: 'travel_explore', route: '/search-history' },
  { labelKey: 'nav.importFile', icon: 'cloud_upload', route: '/import/file' },
  { labelKey: 'nav.importHistory', icon: 'history', route: '/import/history' },
];

/**
 * Looks up a nav item by route across both lists. Throws on an unknown
 * route rather than returning undefined: a typo'd route in a caller like
 * the bottom nav must fail its spec, not silently render a blank slot.
 */
export function navItemFor(route: string): NavItem {
  const item = [...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].find(candidate => candidate.route === route);
  if (!item) {
    throw new Error(`navItemFor: no nav item is registered for route "${route}"`);
  }
  return item;
}
