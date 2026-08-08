/**
 * The vocabulary of a reporting period.
 *
 * These live in the models barrel rather than beside the selector component
 * because `transaction-date.utils` computes every period window and must not
 * import a component to do it. `period-selector.component` re-exports them, so
 * the consumers that already import from there are unaffected.
 */

export type PeriodOption = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

/** The month or year behind a `custom` selection. */
export interface CustomPeriod {
  type: 'month' | 'year';
  year: number;
  month?: number; // 0-11, only for type 'month'
}

/**
 * A resolved period selection. start/end are full calendar boundaries (first
 * day 00:00:00.000 to last day 23:59:59.999); consumers with to-date semantics
 * (e.g. the dashboard's period-over-period deltas) clamp the end themselves,
 * through `clampWindowToNow`.
 */
export interface PeriodSelection {
  option: PeriodOption;
  start: Date;
  end: Date;
  /** Localized label for the selection (custom periods; '' otherwise). */
  label: string;
}
