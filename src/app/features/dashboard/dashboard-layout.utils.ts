import {
  DASHBOARD_CARD_IDS,
  DashboardCardId,
  DashboardLayout,
  StoredDashboardLayout,
  isDashboardCardId,
  resolveDashboardOrder
} from '../../models';

/**
 * Pure layout math for #87 — the account's own arrangement, never a
 * component or a service, so a spec needs no TestBed to exercise it.
 */

/** The dashboard's own card titles, so anything naming a card reads as the card. */
export const CARD_TITLE_KEYS: Readonly<Record<DashboardCardId, string>> = {
  recent: 'dashboard.recentTransactions',
  upcoming: 'dashboard.upcomingBills',
  chart: 'dashboard.spendingByCategory',
  insights: 'ai.insights',
  budgets: 'dashboard.budgetProgress',
};

export const CARD_ICONS: Readonly<Record<DashboardCardId, string>> = {
  recent: 'receipt_long',
  upcoming: 'event_upcoming',
  chart: 'donut_large',
  insights: 'psychology',
  budgets: 'savings',
};

/** Desktop's asymmetric two-column split: these cards form the main column. */
export const DASHBOARD_MAIN_COLUMN: readonly DashboardCardId[] = ['chart', 'insights'];

/**
 * `grid-template-areas` for the desktop layout, one quoted row per grid row.
 * Each column keeps the account's relative order; row *i* pairs main *i*
 * with rail *i*, and the shorter column repeats its last card for the rows
 * that remain so the longer column never spans an area the DOM doesn't
 * have. An empty column gives the other column the full row width. The
 * default order reproduces today's fixed areas exactly (dashboard.component.scss:62-65).
 */
export function dashboardGridAreas(cards: readonly DashboardCardId[]): string {
  const main = cards.filter(id => DASHBOARD_MAIN_COLUMN.includes(id));
  const rail = cards.filter(id => !DASHBOARD_MAIN_COLUMN.includes(id));

  const rows = Math.max(main.length, rail.length);
  if (rows === 0) return '';

  // Undefined only when the column itself is empty — the caller substitutes
  // the other column's card in that case.
  const at = (column: readonly DashboardCardId[], i: number): DashboardCardId | undefined =>
    column[i] ?? column[column.length - 1];

  const rowStrings: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = at(main, i) ?? at(rail, i);
    const right = at(rail, i) ?? at(main, i);
    rowStrings.push(`'${left} ${right}'`);
  }
  return rowStrings.join(' ');
}

/** Swap `id` with its neighbor; a move past either end is a no-op. */
export function moveCard(layout: DashboardLayout, id: DashboardCardId, delta: -1 | 1): DashboardLayout {
  const index = layout.order.indexOf(id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= layout.order.length) {
    return layout;
  }

  const order = [...layout.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}

/**
 * Move `id` one step among the cards actually rendered, past its `visible`
 * neighbour and any card between them that renders nothing (a hidden card,
 * or budgets with none active), so every press changes what is seen. Only
 * `id` changes place; every other card keeps its relative order. A move past
 * either end of `visible`, or of a card not in it, is a no-op.
 */
export function moveVisible(
  layout: DashboardLayout,
  id: DashboardCardId,
  delta: -1 | 1,
  visible: readonly DashboardCardId[]
): DashboardLayout {
  const index = visible.indexOf(id);
  const neighbour = index === -1 ? undefined : visible[index + delta];
  if (neighbour === undefined || !layout.order.includes(id) || !layout.order.includes(neighbour)) {
    return layout;
  }

  const order = layout.order.filter(cardId => cardId !== id);
  const at = order.indexOf(neighbour) + (delta === 1 ? 1 : 0);
  order.splice(at, 0, id);
  return { ...layout, order };
}

/** Add or drop `id` from `hidden`; idempotent, and `order` is never touched. */
export function setCardHidden(layout: DashboardLayout, id: DashboardCardId, hidden: boolean): DashboardLayout {
  const isHidden = layout.hidden.includes(id);
  if (hidden === isHidden) {
    return layout;
  }

  return {
    ...layout,
    hidden: hidden ? [...layout.hidden, id] : layout.hidden.filter(cardId => cardId !== id)
  };
}

/** Structural equality — two freshly-built layouts are never `===`. */
export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return arraysEqual(a.order, b.order) && arraysEqual(a.hidden, b.hidden);
}

function arraysEqual(a: readonly DashboardCardId[], b: readonly DashboardCardId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A stored layout field that can be written on its own. */
export type LayoutField = 'order' | 'hidden';

/** One field's write: replace its value, or delete the field. */
export type LayoutFieldWrite = { set: string[] } | { delete: true };

/**
 * What a change sends: per field, a write or nothing; or, over a stored value
 * that is not a map, the whole key. A nested path would land there too, since
 * Firestore replaces the value with a map; the whole key says outright what
 * is stored.
 */
export type StoredLayoutWrite =
  | { kind: 'fields'; fields: Partial<Record<LayoutField, LayoutFieldWrite>> }
  | { kind: 'whole'; layout: StoredDashboardLayout };

/**
 * The smallest write that stores `next`, given `raw`, the value this session
 * last read, and the fields the change `touched`.
 *
 * - An untouched field is judged from `raw` alone and is not written, so a
 *   field another device changed is not sent back over it. The exception
 *   makes the stored value smaller: an empty `hidden`, and an `order` that
 *   resolves to the default with no unknown id, are deleted whether touched
 *   or not. Absent, they follow whatever default a later build ships.
 * - Ids this build does not know survive: a hidden one stays hidden, and one
 *   in the order follows the id stored before it.
 * - A touched field that ends where it started is not written.
 *
 * Nothing here reads the server, so a field another device rewrote since
 * `raw` was read can still be deleted.
 */
export function layoutWrite(
  raw: unknown,
  next: DashboardLayout,
  touched: ReadonlySet<LayoutField>
): StoredLayoutWrite {
  const stored = raw === undefined ? {} : isPlainMap(raw) ? raw : null;
  if (stored === null) {
    const layout: StoredDashboardLayout = {};
    if (!sameStrings(next.order, DASHBOARD_CARD_IDS)) layout.order = [...next.order];
    if (next.hidden.length > 0) layout.hidden = [...next.hidden];
    return { kind: 'whole', layout };
  }

  const fields: Partial<Record<LayoutField, LayoutFieldWrite>> = {};

  const storedHidden = storedStringIds(stored['hidden']);
  const hidden = touched.has('hidden')
    ? [
        ...storedHidden.filter(id => !isDashboardCardId(id) || next.hidden.includes(id)),
        ...next.hidden.filter(id => !storedHidden.includes(id)),
      ]
    : storedHidden;
  const hiddenWrite = fieldWrite(stored['hidden'], hidden, hidden.length === 0, touched.has('hidden'));
  if (hiddenWrite) fields.hidden = hiddenWrite;

  const storedOrder = storedStringIds(stored['order']);
  const order = touched.has('order') ? reanchorUnknownIds(next.order, storedOrder) : storedOrder;
  const orderIsDefault =
    order.every(isDashboardCardId) && sameStrings(resolveDashboardOrder(order), DASHBOARD_CARD_IDS);
  const orderWrite = fieldWrite(stored['order'], order, orderIsDefault, touched.has('order'));
  if (orderWrite) fields.order = orderWrite;

  return { kind: 'fields', fields };
}

/** `needless`: the field says nothing its absence would not, so it goes. */
function fieldWrite(
  stored: unknown,
  value: string[],
  needless: boolean,
  touched: boolean
): LayoutFieldWrite | null {
  if (needless) return stored === undefined ? null : { delete: true };
  if (!touched || sameStrings(stored, value)) return null;
  return { set: value };
}

/**
 * `order` with each unknown id from `storedIds` put back after the id stored
 * before it, wherever that id now stands; an unknown id stored first stays
 * first. The predecessor is always found: `order` is a resolved order, which
 * lists every known card, and an unknown predecessor was placed one step
 * earlier.
 */
function reanchorUnknownIds(order: readonly DashboardCardId[], storedIds: readonly string[]): string[] {
  const result: string[] = [...order];
  storedIds.forEach((id, i) => {
    if (isDashboardCardId(id)) return;
    const at = i === 0 ? 0 : result.indexOf(storedIds[i - 1]) + 1;
    result.splice(at, 0, id);
  });
  return result;
}

/** A stored array's string ids, first occurrence only; anything else is none. */
function storedStringIds(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.filter((id): id is string => typeof id === 'string'))];
}

/** A Firestore map arrives as a plain object; an array or a class instance is not one. */
function isPlainMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sameStrings(a: unknown, b: readonly string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((id, i) => id === b[i]);
}
