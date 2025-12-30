import { Timestamp } from '@angular/fire/firestore';

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

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

export interface BudgetAlert {
  budgetId: string;
  budgetName: string;
  percentUsed: number;
  remaining: number;
  severity: 'warning' | 'critical' | 'exceeded';
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
