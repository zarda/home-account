import { Timestamp } from '@angular/fire/firestore';

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;                // Always positive
  currency: string;              // ISO 4217 code
  amountInBaseCurrency: number;  // Converted amount for reporting
  exchangeRate: number;          // Rate at time of transaction
  categoryId: string;
  description: string;
  note?: string;
  date: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  receiptUrl?: string;           // Firebase Storage URL
  tags?: string[];
  isRecurring: boolean;
  recurringId?: string;          // Link to RecurringTransaction
  location?: TransactionLocation;
}

export interface TransactionLocation {
  name: string;
  lat?: number;
  lng?: number;
}

export interface TransactionFilters {
  type?: TransactionType;
  categoryId?: string;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
  searchQuery?: string;
}

export interface CreateTransactionDTO {
  type: TransactionType;
  amount: number;
  currency: string;
  categoryId: string;
  description: string;
  date: Date;
  note?: string;
  receiptFile?: File;
  tags?: string[];
  isRecurring?: boolean;
  recurringId?: string;
  location?: TransactionLocation;
}

export interface MonthlyTotal {
  income: number;
  expense: number;
  balance: number;
  transactionCount: number;
  byCategory: CategoryTotal[];
}

export interface CategoryTotal {
  categoryId: string;
  total: number;
}
