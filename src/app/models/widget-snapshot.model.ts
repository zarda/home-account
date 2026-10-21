import type { Budget } from './budget.model';
import type { RecurringOccurrence } from './recurring-transaction.model';
import type { DashboardCardId } from './user.model';

/**
 * The iOS home-screen widget's payload, serialised into the App Group's
 * `widget-snapshot.json` and decoded by `WidgetSnapshot.swift`, which rejects
 * anything that strays from this shape. Every string is composed on the web in
 * the account's language, so the widget carries no currency, locale or catalog
 * logic of its own.
 */
export type WidgetSnapshotState = 'figures' | 'locked' | 'signedOut';

/**
 * The dashboard cards the widget draws a section for, in the order
 * `figures.hidden` lists them. `WidgetSnapshot.swift`'s `Card` decodes exactly
 * these ids and rejects any other.
 */
export const WIDGET_CARDS = ['budgets', 'upcoming'] as const satisfies readonly DashboardCardId[];

export type WidgetCard = (typeof WIDGET_CARDS)[number];

/** Present in every state: the widget words its locked, signed-out and stale faces from these too. */
export interface WidgetSnapshotLabels {
  title: string;
  spent: string;
  net: string;
  topBudget: string;
  nextScheduled: string;
  noBudgets: string;
  nothingScheduled: string;
  locked: string;
  signedOut: string;
  stale: string;
  updated: string;
}

export interface WidgetSnapshotTopBudget {
  name: string;
  /** Decoded as a Swift `Int`, so a fraction fails the whole payload. */
  percent: number;
  detail: string;
}

export interface WidgetSnapshotNextScheduled {
  name: string;
  date: string;
  amount: string;
}

export interface WidgetSnapshotFigures {
  spent: string;
  net: string;
  /** Null when the account has no budget to rank, and when it hid Budget Progress. */
  topBudget: WidgetSnapshotTopBudget | null;
  /** Null when nothing is scheduled, and when the account hid Upcoming Bills. */
  nextScheduled: WidgetSnapshotNextScheduled | null;
  /**
   * The widget's cards the account hid on the dashboard, in `WIDGET_CARDS`
   * order; always written, empty when none is. A null field above is the
   * card's empty state unless its id is listed here.
   */
  hidden: WidgetCard[];
}

export interface WidgetSnapshot {
  version: 1;
  state: WidgetSnapshotState;
  /** Epoch milliseconds. */
  writtenAt: number;
  /**
   * `YYYY-MM` of the local month, zero-padded. The widget compares it with the
   * device's month to tell this month's figures from last month's.
   */
  monthKey: string;
  labels: WidgetSnapshotLabels;
  /** Only in the `figures` state; left out entirely otherwise. */
  figures?: WidgetSnapshotFigures;
}

/** The figures the dashboard already holds for this month, handed over as it paints. */
export interface WidgetSnapshotInput {
  spent: number;
  net: number;
  baseCurrency: string;
  budgets: Budget[];
  upcoming: RecurringOccurrence[];
  /** The account's hidden cards, as the dashboard holds them: any card, in any order. */
  hidden: readonly DashboardCardId[];
  now?: Date;
}
