import { BudgetAlertSeverity } from '../../models';

/**
 * Single source of truth for budget alert severity thresholds (percent of
 * budget used). `warning` is the app-wide default; each budget's own
 * `alertThreshold` overrides it.
 */
export const BUDGET_ALERT_THRESHOLDS = {
  exceeded: 100,
  critical: 90,
  warning: 80
} as const;

/**
 * Severity for a spend percentage, or null when no alert applies.
 * `warningThreshold` is the budget's configurable alert threshold.
 */
export function getBudgetAlertSeverity(
  percentUsed: number,
  warningThreshold: number = BUDGET_ALERT_THRESHOLDS.warning
): BudgetAlertSeverity | null {
  if (percentUsed >= BUDGET_ALERT_THRESHOLDS.exceeded) return 'exceeded';
  if (percentUsed >= BUDGET_ALERT_THRESHOLDS.critical) return 'critical';
  if (percentUsed >= warningThreshold) return 'warning';
  return null;
}
