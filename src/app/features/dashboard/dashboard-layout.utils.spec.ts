import { DASHBOARD_CARD_IDS, DashboardCardId, DashboardLayout, StoredDashboardLayout } from '../../models';
import {
  CARD_ICONS,
  CARD_TITLE_KEYS,
  DASHBOARD_MAIN_COLUMN,
  LayoutField,
  dashboardGridAreas,
  layoutWrite,
  moveCard,
  moveVisible,
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

describe('CARD_TITLE_KEYS and CARD_ICONS', () => {
  it('name and draw every card, and nothing else', () => {
    expect(Object.keys(CARD_TITLE_KEYS).sort()).toEqual([...DASHBOARD_CARD_IDS].sort());
    expect(Object.keys(CARD_ICONS).sort()).toEqual([...DASHBOARD_CARD_IDS].sort());
  });
});

describe('moveVisible', () => {
  const defaultLayout: DashboardLayout = { order: [...DASHBOARD_CARD_IDS], hidden: [] };

  it('swaps a card with an adjacent rendered neighbour, as moveCard does', () => {
    const visible = [...DASHBOARD_CARD_IDS];
    expect(moveVisible(defaultLayout, 'upcoming', -1, visible).order).toEqual(
      moveCard(defaultLayout, 'upcoming', -1).order
    );
  });

  // Budgets sits in the order but renders nothing while no budget is active,
  // so a step taken over it would change nothing the menu's user can see.
  describe('with budgets in the order but not rendered', () => {
    const layout: DashboardLayout = {
      order: ['recent', 'upcoming', 'chart', 'budgets', 'insights'],
      hidden: []
    };
    const visible: DashboardCardId[] = ['recent', 'upcoming', 'chart', 'insights'];

    it('passes the rendered card above in one press', () => {
      expect(moveVisible(layout, 'insights', -1, visible).order).toEqual([
        'recent', 'upcoming', 'insights', 'chart', 'budgets'
      ]);
    });

    it('passes the rendered card below in one press', () => {
      expect(moveVisible(layout, 'chart', 1, visible).order).toEqual([
        'recent', 'upcoming', 'budgets', 'insights', 'chart'
      ]);
    });

    it('is a no-op for the last rendered card, though the order continues', () => {
      const trailing: DashboardLayout = { order: [...DASHBOARD_CARD_IDS], hidden: [] };
      expect(moveVisible(trailing, 'insights', 1, visible)).toBe(trailing);
    });
  });

  it('steps over a hidden card and leaves it where it was', () => {
    const layout: DashboardLayout = { order: [...DASHBOARD_CARD_IDS], hidden: ['upcoming'] };
    const visible: DashboardCardId[] = ['recent', 'chart', 'insights', 'budgets'];
    expect(moveVisible(layout, 'chart', -1, visible)).toEqual({
      order: ['chart', 'recent', 'upcoming', 'insights', 'budgets'],
      hidden: ['upcoming']
    });
  });

  it('is a no-op for the first rendered card, though the order starts earlier', () => {
    const layout: DashboardLayout = {
      order: ['budgets', 'recent', 'upcoming', 'chart', 'insights'],
      hidden: []
    };
    expect(moveVisible(layout, 'recent', -1, ['recent', 'upcoming', 'chart', 'insights'])).toBe(layout);
  });

  it('is a no-op for a card that is not rendered', () => {
    expect(moveVisible(defaultLayout, 'budgets', -1, ['recent', 'upcoming'])).toBe(defaultLayout);
  });

  it('never mutates the input layout', () => {
    const before = { order: [...defaultLayout.order], hidden: [...defaultLayout.hidden] };
    moveVisible(defaultLayout, 'chart', 1, [...DASHBOARD_CARD_IDS]);
    expect(defaultLayout).toEqual(before);
  });
});

describe('layoutWrite', () => {
  const DEFAULT: DashboardCardId[] = [...DASHBOARD_CARD_IDS];
  const MOVED: DashboardCardId[] = ['upcoming', 'recent', 'chart', 'insights', 'budgets'];
  const touched = (...fields: LayoutField[]): ReadonlySet<LayoutField> => new Set(fields);
  const layout = (order: DashboardCardId[], hidden: DashboardCardId[] = []): DashboardLayout =>
    ({ order: [...order], hidden: [...hidden] });

  it('writes hidden alone for a toggle on an account with nothing stored', () => {
    expect(layoutWrite(undefined, layout(DEFAULT, ['chart']), touched('hidden'))).toEqual({
      kind: 'fields',
      fields: { hidden: { set: ['chart'] } }
    });
  });

  it('writes order alone for a move, leaving a stored hidden untouched', () => {
    const raw: StoredDashboardLayout = { hidden: ['chart'] };
    expect(layoutWrite(raw, layout(MOVED, ['chart']), touched('order'))).toEqual({
      kind: 'fields',
      fields: { order: { set: MOVED } }
    });
  });

  // A layout held while saving can lag a hide another device has since
  // stored; an untouched field is judged from raw, so that hide stands.
  it('judges an untouched field from raw, not from a next that lags it', () => {
    const raw: StoredDashboardLayout = { hidden: ['chart'] };
    expect(layoutWrite(raw, layout(MOVED), touched('order'))).toEqual({
      kind: 'fields',
      fields: { order: { set: MOVED } }
    });
  });

  describe('a card this build does not know', () => {
    it('stays hidden when a known card is shown', () => {
      const raw: StoredDashboardLayout = { hidden: ['goals', 'chart'] };
      expect(layoutWrite(raw, layout(DEFAULT), touched('hidden'))).toEqual({
        kind: 'fields',
        fields: { hidden: { set: ['goals'] } }
      });
    });

    it('stays hidden when a known card is hidden beside it', () => {
      const raw: StoredDashboardLayout = { hidden: ['goals'] };
      expect(layoutWrite(raw, layout(DEFAULT, ['insights']), touched('hidden'))).toEqual({
        kind: 'fields',
        fields: { hidden: { set: ['goals', 'insights'] } }
      });
    });

    it('follows its stored predecessor through a move', () => {
      const raw: StoredDashboardLayout = {
        order: ['recent', 'goals', 'upcoming', 'chart', 'insights', 'budgets']
      };
      expect(layoutWrite(raw, layout(MOVED), touched('order'))).toEqual({
        kind: 'fields',
        fields: { order: { set: ['upcoming', 'recent', 'goals', 'chart', 'insights', 'budgets'] } }
      });
    });

    it('stays first when it led, and a run of them keeps its own order', () => {
      const raw: StoredDashboardLayout = {
        order: ['goals', 'chart', 'savings', 'loans', 'recent', 'upcoming', 'insights', 'budgets']
      };
      const next = layout(['recent', 'upcoming', 'insights', 'budgets', 'chart']);
      expect(layoutWrite(raw, next, touched('order'))).toEqual({
        kind: 'fields',
        fields: {
          order: {
            set: ['goals', 'recent', 'upcoming', 'insights', 'budgets', 'chart', 'savings', 'loans']
          }
        }
      });
    });

    it('keeps an order whose known part is the default', () => {
      const raw: StoredDashboardLayout = { order: [...DEFAULT, 'goals'] };
      expect(layoutWrite(raw, layout(DEFAULT, ['chart']), touched('hidden'))).toEqual({
        kind: 'fields',
        fields: { hidden: { set: ['chart'] } }
      });
    });
  });

  describe('an empty field', () => {
    it('is deleted when the last hidden card is shown', () => {
      const raw: StoredDashboardLayout = { hidden: ['chart'] };
      expect(layoutWrite(raw, layout(DEFAULT), touched('hidden'))).toEqual({
        kind: 'fields',
        fields: { hidden: { delete: true } }
      });
    });

    it('is deleted by a change that never touched it', () => {
      const raw: StoredDashboardLayout = { hidden: [] };
      expect(layoutWrite(raw, layout(MOVED), touched('order'))).toEqual({
        kind: 'fields',
        fields: { hidden: { delete: true }, order: { set: MOVED } }
      });
    });

    it('is not written at all when it was never stored', () => {
      expect(layoutWrite(undefined, layout(MOVED), touched('order', 'hidden'))).toEqual({
        kind: 'fields',
        fields: { order: { set: MOVED } }
      });
    });
  });

  describe('a default order', () => {
    it('is deleted when a move brings the order back to the default', () => {
      const raw: StoredDashboardLayout = { order: MOVED };
      expect(layoutWrite(raw, layout(DEFAULT), touched('order'))).toEqual({
        kind: 'fields',
        fields: { order: { delete: true } }
      });
    });

    it('is deleted by a toggle that never touched it', () => {
      const raw: StoredDashboardLayout = { order: DEFAULT, hidden: [] };
      expect(layoutWrite(raw, layout(DEFAULT, ['insights']), touched('hidden'))).toEqual({
        kind: 'fields',
        fields: { hidden: { set: ['insights'] }, order: { delete: true } }
      });
    });

    // The decision is this session's: the function sees the raw value this
    // session last read, never the server. A custom order another device has
    // stored since then is deleted by this write and lost (a Known gap,
    // recorded in ADR 0166 and docs/dashboard.md).
    it('is deleted from this session\'s view, whatever the server now holds', () => {
      const raw: StoredDashboardLayout = { order: DEFAULT };
      const write = layoutWrite(raw, layout(DEFAULT, ['chart']), touched('hidden'));
      expect(write).toEqual({
        kind: 'fields',
        fields: { hidden: { set: ['chart'] }, order: { delete: true } }
      });
    });
  });

  it('writes nothing for a change that ends where it started', () => {
    expect(layoutWrite({ hidden: ['chart'] }, layout(DEFAULT, ['chart']), touched('hidden'))).toEqual({
      kind: 'fields',
      fields: {}
    });
    expect(layoutWrite({ order: MOVED }, layout(MOVED), touched('order'))).toEqual({
      kind: 'fields',
      fields: {}
    });
  });

  it('drops junk and repeats from a field it writes', () => {
    const raw = { hidden: ['chart', 5, 'chart', 'goals', 'goals'] } as unknown as StoredDashboardLayout;
    expect(layoutWrite(raw, layout(DEFAULT, ['chart', 'insights']), touched('hidden'))).toEqual({
      kind: 'fields',
      fields: { hidden: { set: ['chart', 'goals', 'insights'] } }
    });
  });

  it('deletes a stored order that is not an array, which resolves to the default', () => {
    const raw = { order: 'nonsense', hidden: ['chart'] } as unknown as StoredDashboardLayout;
    expect(layoutWrite(raw, layout(DEFAULT), touched('hidden'))).toEqual({
      kind: 'fields',
      fields: { hidden: { delete: true }, order: { delete: true } }
    });
  });

  describe('a stored value that is not a map', () => {
    for (const raw of ['nonsense', ['chart'], null, 42]) {
      it(`takes a whole-key write over ${JSON.stringify(raw)}`, () => {
        expect(layoutWrite(raw, layout(MOVED, ['chart']), touched('hidden'))).toEqual({
          kind: 'whole',
          layout: { order: MOVED, hidden: ['chart'] }
        });
      });
    }

    it('leaves the default order and an empty hidden out of the whole key', () => {
      expect(layoutWrite('nonsense', layout(DEFAULT), touched('hidden'))).toEqual({
        kind: 'whole',
        layout: {}
      });
    });
  });

  it('never mutates its inputs', () => {
    const raw: StoredDashboardLayout = {
      order: ['recent', 'goals', 'upcoming', 'chart', 'insights', 'budgets'],
      hidden: ['goals']
    };
    const next = layout(MOVED, ['chart']);
    const before = JSON.stringify({ raw, next });
    layoutWrite(raw, next, touched('order', 'hidden'));
    expect(JSON.stringify({ raw, next })).toBe(before);
  });
});
