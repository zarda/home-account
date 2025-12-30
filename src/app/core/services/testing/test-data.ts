import { Timestamp } from '@angular/fire/firestore';
import {
  User,
  UserPreferences,
  DEFAULT_USER_PREFERENCES,
  Transaction,
  TransactionType,
  Category,
  CategoryType,
  Budget,
  BudgetPeriod
} from '../../../models';

/**
 * Factory functions for creating test data
 */

// Counter for generating unique IDs
let idCounter = 0;

export function generateId(prefix = 'test'): string {
  return `${prefix}-${++idCounter}-${Date.now()}`;
}

export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Create a mock Timestamp
 */
export function createTimestamp(date: Date = new Date()): Timestamp {
  return Timestamp.fromDate(date);
}

/**
 * Create a mock User
 */
export function createUser(overrides: Partial<User> = {}): User {
  return {
    id: generateId('user'),
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://example.com/photo.jpg',
    createdAt: createTimestamp(),
    lastLoginAt: createTimestamp(),
    preferences: { ...DEFAULT_USER_PREFERENCES },
    ...overrides
  };
}

/**
 * Create a mock Transaction
 */
export function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const type: TransactionType = overrides.type ?? 'expense';
  const amount = overrides.amount ?? 100;

  return {
    id: generateId('txn'),
    userId: 'test-user-123',
    type,
    amount,
    currency: 'USD',
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    categoryId: type === 'income' ? 'employment_salary' : 'food_restaurants',
    description: type === 'income' ? 'Salary Payment' : 'Lunch at restaurant',
    date: createTimestamp(),
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    isRecurring: false,
    ...overrides
  };
}

/**
 * Create multiple mock Transactions
 */
export function createTransactions(count: number, overrides: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    createTransaction({
      amount: (i + 1) * 50,
      description: `Transaction ${i + 1}`,
      ...overrides
    })
  );
}

/**
 * Create a mock Category
 */
export function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: generateId('cat'),
    userId: null,
    name: 'Test Category',
    icon: 'category',
    color: '#FF5722',
    type: 'expense',
    order: 0,
    isActive: true,
    isDefault: true,
    ...overrides
  };
}

/**
 * Create multiple mock Categories
 */
export function createCategories(count: number, type: CategoryType = 'expense'): Category[] {
  return Array.from({ length: count }, (_, i) =>
    createCategory({
      id: `cat-${i + 1}`,
      name: `Category ${i + 1}`,
      type,
      order: i,
      isActive: true
    })
  );
}

/**
 * Create a mock Budget
 */
export function createBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: generateId('budget'),
    userId: 'test-user-123',
    categoryId: 'food',
    name: 'Food Budget',
    amount: 500,
    currency: 'USD',
    period: 'monthly',
    startDate: createTimestamp(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    spent: 0,
    isActive: true,
    alertThreshold: 80,
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    ...overrides
  };
}

/**
 * Create sample income transactions for testing
 */
export function createIncomeTransactions(): Transaction[] {
  return [
    createTransaction({ type: 'income', amount: 5000, description: 'Salary', categoryId: 'employment_salary' }),
    createTransaction({ type: 'income', amount: 500, description: 'Freelance', categoryId: 'self_employment_freelance' }),
    createTransaction({ type: 'income', amount: 100, description: 'Dividends', categoryId: 'investments_dividends' })
  ];
}

/**
 * Create sample expense transactions for testing
 */
export function createExpenseTransactions(): Transaction[] {
  return [
    createTransaction({ type: 'expense', amount: 50, description: 'Groceries', categoryId: 'food_groceries' }),
    createTransaction({ type: 'expense', amount: 30, description: 'Coffee', categoryId: 'food_coffee_&_drinks' }),
    createTransaction({ type: 'expense', amount: 100, description: 'Gas', categoryId: 'transport_fuel_&_gas' }),
    createTransaction({ type: 'expense', amount: 15, description: 'Netflix', categoryId: 'subscriptions_streaming_services' })
  ];
}

/**
 * Create a mixed set of transactions for testing monthly totals
 */
export function createMixedTransactions(): Transaction[] {
  return [
    ...createIncomeTransactions(),
    ...createExpenseTransactions()
  ];
}

/**
 * Create sample categories with parent-child relationships
 */
export function createCategoryHierarchy(): Category[] {
  return [
    // Parent category
    createCategory({
      id: 'food',
      name: 'Food & Drinks',
      type: 'expense',
      order: 0
    }),
    // Child categories
    createCategory({
      id: 'food_restaurants',
      name: 'Restaurants',
      type: 'expense',
      parentId: 'food',
      order: 1
    }),
    createCategory({
      id: 'food_groceries',
      name: 'Groceries',
      type: 'expense',
      parentId: 'food',
      order: 2
    }),
    // Income parent
    createCategory({
      id: 'employment',
      name: 'Employment',
      type: 'income',
      order: 10
    }),
    // Income child
    createCategory({
      id: 'employment_salary',
      name: 'Salary',
      type: 'income',
      parentId: 'employment',
      order: 11
    }),
    // Both type category
    createCategory({
      id: 'other',
      name: 'Other',
      type: 'both',
      order: 20
    })
  ];
}
