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
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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
  endDate?: Date;
}

export interface RecurringOccurrence {
  recurringId: string;
  name: string;
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  date: Date;
}
