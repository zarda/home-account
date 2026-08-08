/**
 * Resolve a `?tab=` (or `?panel=`) value against a page's ordered sections.
 *
 * The hub links straight at a tab rather than at the page containing it, so
 * the value arrives from a URL and can be anything. An unrecognized one falls
 * back to the first section: `indexOf` returns -1 for a miss, and a
 * MatTabGroup handed -1 renders no tab at all, so a stale bookmark would
 * otherwise show an empty page rather than the wrong one.
 */
export function tabIndexFromParam(param: string | null | undefined, tabs: readonly string[]): number {
  if (!param) return 0;

  const index = tabs.indexOf(param);
  return index === -1 ? 0 : index;
}
