import { tabIndexFromParam } from './tab-query-param.utils';

describe('tabIndexFromParam', () => {
  const TABS = ['budgets', 'recurring', 'goals'];

  it('resolves a named section to its position', () => {
    expect(tabIndexFromParam('recurring', TABS)).toBe(1);
    expect(tabIndexFromParam('goals', TABS)).toBe(2);
  });

  it('opens the first section when no value was given', () => {
    expect(tabIndexFromParam(null, TABS)).toBe(0);
    expect(tabIndexFromParam(undefined, TABS)).toBe(0);
    expect(tabIndexFromParam('', TABS)).toBe(0);
  });

  // -1 would leave a MatTabGroup showing no tab at all, so a stale bookmark
  // has to land on the first section rather than on an empty page.
  it('opens the first section when the value names no section', () => {
    expect(tabIndexFromParam('nope', TABS)).toBe(0);
  });

  it('matches exactly rather than loosely', () => {
    expect(tabIndexFromParam('Recurring', TABS)).toBe(0);
    expect(tabIndexFromParam('recur', TABS)).toBe(0);
  });
});
