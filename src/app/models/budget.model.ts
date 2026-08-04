import { Timestamp } from '@angular/fire/firestore';

// The union is derived from the tuple so the two cannot drift: anything that
// has to enumerate the periods at runtime — the CSV importer, the form's
// picker — reads BUDGET_PERIODS rather than pinning the list a second time.
export const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const;

export type BudgetPeriod = typeof BUDGET_PERIODS[number];

export function isBudgetPeriod(value: unknown): value is BudgetPeriod {
  return typeof value === 'string' && (BUDGET_PERIODS as readonly string[]).includes(value);
}

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  name: string;
  amount: number;                // Budget limit
  currency: string;
  period: BudgetPeriod;
  startDate: Timestamp;          // For custom periods
  endDate?: Timestamp;
  spent: number;                 // Calculated field (denormalized)
  spentPeriod?: string;          // dayKey of the period start `spent` was
                                 // computed for; absent on docs written
                                 // before the field existed (reads as stale)
  isActive: boolean;
  alertThreshold: number;        // Percentage (e.g., 80 = alert at 80%)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BudgetSummary {
  budgetId: string;
  period: string;                // '2024-01' for monthly
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  percentUsed: number;
  transactions: number;          // Count
}

export type BudgetAlertSeverity = 'warning' | 'critical' | 'exceeded';

export interface BudgetAlert {
  budgetId: string;
  budgetName: string;
  percentUsed: number;
  remaining: number;
  severity: BudgetAlertSeverity;
}

export interface CreateBudgetDTO {
  categoryId: string;
  name: string;
  amount: number;
  currency: string;
  period: BudgetPeriod;
  startDate?: Date;
  endDate?: Date;
  alertThreshold?: number;
}
