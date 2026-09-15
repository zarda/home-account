import { DASHBOARD_CARD_IDS, DashboardCardId, DashboardLayout } from '../../models';
import {
  DASHBOARD_MAIN_COLUMN,
  dashboardGridAreas,
  moveCard,
  sameLayout,
  setCardHidden
} from './dashboard-layout.utils';

describe('DASHBOARD_MAIN_COLUMN', () => {
  it('is chart then insights', () => {
    expect(DASHBOARD_MAIN_COLUMN).toEqual(['chart', 'insights']);
  });
});

describe('dashboardGridAreas', () => {
  it('reproduces today\'s desktop areas for the full default order', () => {
    expect(dashboardGridAreas(DASHBOARD_CARD_IDS)).toBe(
      "'chart recent' 'insights upcoming' 'insights budgets'"
    );
  });

  it('drops a row when a card leaves the arrangement', () => {
    const cards: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'insights'];
    expect(dashboardGridAreas(cards)).toBe("'chart recent' 'insights upcoming'");
  });

  it('repeats the shorter rail column\'s last card for the remaining row', () => {
    const cards: DashboardCardId[] = ['chart', 'insights', 'recent'];
    expect(dashboardGridAreas(cards)).toBe("'chart recent' 'insights recent'");
  });

  it('fills both cells from the rail when the main column is empty', () => {
    const cards: DashboardCardId[] = ['recent', 'upcoming'];
    expect(dashboardGridAreas(cards)).toBe("'recent recent' 'upcoming upcoming'");
  });

  it('fills both cells from the main column when the rail is empty', () => {
    const cards: DashboardCardId[] = ['chart', 'insights'];
    expect(dashboardGridAreas(cards)).toBe("'chart chart' 'insights insights'");
  });

  it('keeps each column in the account\'s own order', () => {
    const cards: DashboardCardId[] = ['insights', 'budgets', 'chart', 'recent'];
    expect(dashboardGridAreas(cards)).toBe("'insights budgets' 'chart recent'");
  });

  it('is empty for no cards', () => {
    expect(dashboardGridAreas([])).toBe('');
  });
});

describe('moveCard', () => {
  const layout: DashboardLayout = {
    order: ['recent', 'upcoming', 'chart', 'insights', 'budgets'],
    hidden: []
  };

  it('swaps a card up with its predecessor', () => {
    expect(moveCard(layout, 'upcoming', -1).order).toEqual([
      'upcoming', 'recent', 'chart', 'insights', 'budgets'
    ]);
  });

  it('swaps a card down with its successor', () => {
    expect(moveCard(layout, 'upcoming', 1).order).toEqual([
      'recent', 'chart', 'upcoming', 'insights', 'budgets'
    ]);
  });

  it('is a no-op at the top', () => {
    expect(moveCard(layout, 'recent', -1)).toEqual(layout);
  });

  it('is a no-op at the bottom', () => {
    expect(moveCard(layout, 'budgets', 1)).toEqual(layout);
  });

  it('never mutates the input layout', () => {
    const before = { order: [...layout.order], hidden: [...layout.hidden] };
    moveCard(layout, 'upcoming', -1);
    expect(layout).toEqual(before);
  });
});

describe('setCardHidden', () => {
  const layout: DashboardLayout = {
    order: ['recent', 'upcoming', 'chart', 'insights', 'budgets'],
    hidden: []
  };

  it('adds a card to hidden', () => {
    expect(setCardHidden(layout, 'chart', true).hidden).toEqual(['chart']);
  });

  it('is idempotent when hiding an already-hidden card', () => {
    const once = setCardHidden(layout, 'chart', true);
    const twice = setCardHidden(once, 'chart', true);
    expect(twice.hidden).toEqual(['chart']);
  });

  it('is idempotent when showing an already-visible card', () => {
    expect(setCardHidden(layout, 'chart', false).hidden).toEqual([]);
  });

  it('removes a card from hidden', () => {
    const hidden = setCardHidden(layout, 'chart', true);
    expect(setCardHidden(hidden, 'chart', false).hidden).toEqual([]);
  });

  it('never touches order', () => {
    const result = setCardHidden(layout, 'chart', true);
    expect(result.order).toEqual(layout.order);
  });
});

describe('sameLayout', () => {
  it('is true for equal content in different array instances', () => {
    const a: DashboardLayout = { order: ['recent', 'chart'], hidden: ['budgets'] };
    const b: DashboardLayout = { order: ['recent', 'chart'], hidden: ['budgets'] };
    expect(sameLayout(a, b)).toBeTrue();
  });

  it('is false when the order differs', () => {
    const a: DashboardLayout = { order: ['recent', 'chart'], hidden: [] };
    const b: DashboardLayout = { order: ['chart', 'recent'], hidden: [] };
    expect(sameLayout(a, b)).toBeFalse();
  });

  it('is false when hidden differs', () => {
    const a: DashboardLayout = { order: ['recent', 'chart'], hidden: ['budgets'] };
    const b: DashboardLayout = { order: ['recent', 'chart'], hidden: [] };
    expect(sameLayout(a, b)).toBeFalse();
  });
});
