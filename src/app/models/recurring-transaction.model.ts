import { Timestamp } from '@angular/fire/firestore';
import { TransactionType } from './transaction.model';

export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  userId: string;
  name: string;                  // e.g., 'Monthly Salary'
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  description: string;
  frequency: RecurringFrequency;
  startDate: Timestamp;
  endDate?: Timestamp;           // null = indefinite
  nextOccurrence: Timestamp;
  lastProcessed?: Timestamp;
  remindDaysBefore?: number;     // absent = no reminder; 0 = on the day
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Longest reminder lead the picker offers. firestore.rules deliberately stops
 * at "a whole number of days, not negative": an optional field tightened to a
 * ceiling there would deny the restore of a backup written by any build that
 * ever allowed more.
 */
export const MAX_REMINDER_LEAD_DAYS = 30;

export interface RecurringFrequency {
  type: FrequencyType;
  interval: number;              // Every X days/weeks/months/years
  dayOfWeek?: number;            // 0-6 for weekly (0 = Sunday)
  dayOfMonth?: number;           // 1-31 for monthly
  monthOfYear?: number;          // 1-12 for yearly
}

export interface CreateRecurringDTO {
  name: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  description: string;
  frequency: RecurringFrequency;
  startDate: Date;
  endDate?: Date | null;         // null = explicitly remove the end date (updates)
  remindDaysBefore?: number | null; // null = explicitly remove the reminder (updates)
}

export interface RecurringOccurrence {
  recurringId: string;
  name: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: Date;
  // Carried from the rule so a consumer deciding when to warn needs no join
  // back to the recurring collection.
  remindDaysBefore?: number;
}
