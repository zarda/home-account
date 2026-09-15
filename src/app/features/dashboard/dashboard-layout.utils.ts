import { DashboardCardId, DashboardLayout } from '../../models';

/**
 * Pure layout math for #87 — the account's own arrangement, never a
 * component or a service, so a spec needs no TestBed to exercise it.
 */

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
