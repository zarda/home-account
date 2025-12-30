import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import {
  RecurringTransaction,
  RecurringFrequency,
  CreateRecurringDTO,
  RecurringOccurrence,
  Transaction,
  CreateTransactionDTO
} from '../../models';

@Injectable({ providedIn: 'root' })
export class RecurringService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private transactionService = inject(TransactionService);

  // Signals
  recurringTransactions = signal<RecurringTransaction[]>([]);
  isLoading = signal<boolean>(false);

  // Computed signals
  activeRecurring = computed(() =>
    this.recurringTransactions().filter(r => r.isActive)
  );

  upcomingRecurring = computed(() => {
    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return this.activeRecurring()
      .filter(r => {
        const nextDate = r.nextOccurrence.toDate();
        return nextDate >= now && nextDate <= thirtyDaysLater;
      })
      .sort((a, b) =>
        a.nextOccurrence.toDate().getTime() - b.nextOccurrence.toDate().getTime()
      );
  });

  private get userRecurringPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/recurring`;
  }

  // Get all recurring transactions
  getRecurring(): Observable<RecurringTransaction[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<RecurringTransaction>(
      this.userRecurringPath,
      { orderBy: [{ field: 'nextOccurrence', direction: 'asc' }] }
    ).pipe(
      map(recurring => {
        this.recurringTransactions.set(recurring);
        return recurring;
      })
    );
  }

  // Get a single recurring transaction by ID
  getRecurringById(id: string): Observable<RecurringTransaction | null> {
    return this.firestoreService.subscribeToDocument<RecurringTransaction>(
      `${this.userRecurringPath}/${id}`
    );
  }

  // Create a new recurring transaction
  async createRecurring(data: CreateRecurringDTO): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const nextOccurrence = this.calculateNextOccurrence(
        data.startDate,
        data.frequency
      );

      const recurring: Omit<RecurringTransaction, 'id'> = {
        userId,
        name: data.name,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        categoryId: data.categoryId,
        description: data.description,
        frequency: data.frequency,
        startDate: this.firestoreService.dateToTimestamp(data.startDate),
        endDate: data.endDate
          ? this.firestoreService.dateToTimestamp(data.endDate)
          : undefined,
        nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence),
        isActive: true,
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp()
      };

      return await this.firestoreService.addDocument(
        this.userRecurringPath,
        recurring
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Update an existing recurring transaction
  async updateRecurring(
    id: string,
    data: Partial<CreateRecurringDTO>
  ): Promise<void> {
    this.isLoading.set(true);

    try {
      const updateData: Partial<RecurringTransaction> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.type !== undefined) updateData.type = data.type;
      if (data.amount !== undefined) updateData.amount = data.amount;
      if (data.currency !== undefined) updateData.currency = data.currency;
      if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.frequency !== undefined) updateData.frequency = data.frequency;

      if (data.startDate !== undefined) {
        updateData.startDate = this.firestoreService.dateToTimestamp(data.startDate);
      }

      if (data.endDate !== undefined) {
        updateData.endDate = this.firestoreService.dateToTimestamp(data.endDate);
      }

      // Recalculate next occurrence if frequency or start date changed
      if (data.frequency || data.startDate) {
        const current = await this.firestoreService.getDocument<RecurringTransaction>(
          `${this.userRecurringPath}/${id}`
        );

        if (current) {
          const frequency = data.frequency ?? current.frequency;
          const startDate = data.startDate ?? current.startDate.toDate();
          const nextOccurrence = this.calculateNextOccurrence(startDate, frequency);
          updateData.nextOccurrence = this.firestoreService.dateToTimestamp(nextOccurrence);
        }
      }

      await this.firestoreService.updateDocument(
        `${this.userRecurringPath}/${id}`,
        updateData
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Delete a recurring transaction
  async deleteRecurring(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userRecurringPath}/${id}`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  // Pause a recurring transaction
  async pauseRecurring(id: string): Promise<void> {
    await this.firestoreService.updateDocument(
      `${this.userRecurringPath}/${id}`,
      { isActive: false }
    );
  }

  // Resume a recurring transaction
  async resumeRecurring(id: string): Promise<void> {
    const recurring = await this.firestoreService.getDocument<RecurringTransaction>(
      `${this.userRecurringPath}/${id}`
    );

    if (!recurring) return;

    // Recalculate next occurrence from today
    const nextOccurrence = this.calculateNextOccurrence(new Date(), recurring.frequency);

    await this.firestoreService.updateDocument(
      `${this.userRecurringPath}/${id}`,
      {
        isActive: true,
        nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence)
      }
    );
  }

  // Process due recurring transactions and create actual transactions
  async processRecurringTransactions(): Promise<Transaction[]> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) return [];

      const now = new Date();
      const createdTransactions: Transaction[] = [];

      // Get all active recurring transactions that are due
      const dueRecurring = this.activeRecurring().filter(r => {
        const nextDate = r.nextOccurrence.toDate();
        return nextDate <= now;
      });

      for (const recurring of dueRecurring) {
        // Check if end date has passed
        if (recurring.endDate && recurring.endDate.toDate() < now) {
          await this.pauseRecurring(recurring.id);
          continue;
        }

        // Create the transaction
        const transactionData: CreateTransactionDTO = {
          type: recurring.type,
          amount: recurring.amount,
          currency: recurring.currency,
          categoryId: recurring.categoryId,
          description: recurring.description,
          date: recurring.nextOccurrence.toDate(),
          isRecurring: true,
          recurringId: recurring.id
        };

        const transactionId = await this.transactionService.addTransaction(transactionData);

        // Update the recurring transaction with next occurrence
        const nextOccurrence = this.calculateNextOccurrenceFromDate(
          recurring.nextOccurrence.toDate(),
          recurring.frequency
        );

        await this.firestoreService.updateDocument(
          `${this.userRecurringPath}/${recurring.id}`,
          {
            nextOccurrence: this.firestoreService.dateToTimestamp(nextOccurrence),
            lastProcessed: this.firestoreService.getTimestamp()
          }
        );

        // Fetch the created transaction
        const transaction = await this.firestoreService.getDocument<Transaction>(
          `users/${userId}/transactions/${transactionId}`
        );

        if (transaction) {
          createdTransactions.push(transaction);
        }
      }

      return createdTransactions;
    } finally {
      this.isLoading.set(false);
    }
  }

  // Get upcoming occurrences for the next N days
  getNextOccurrences(days: number): Observable<RecurringOccurrence[]> {
    return this.getRecurring().pipe(
      map(recurring => {
        const now = new Date();
        const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const occurrences: RecurringOccurrence[] = [];

        for (const r of recurring) {
          if (!r.isActive) continue;

          let nextDate = r.nextOccurrence.toDate();

          // Collect all occurrences within the date range
          while (nextDate <= endDate) {
            if (r.endDate && nextDate > r.endDate.toDate()) break;

            occurrences.push({
              recurringId: r.id,
              name: r.name,
              type: r.type,
              amount: r.amount,
              currency: r.currency,
              categoryId: r.categoryId,
              date: new Date(nextDate)
            });

            nextDate = this.calculateNextOccurrenceFromDate(nextDate, r.frequency);
          }
        }

        return occurrences.sort((a, b) => a.date.getTime() - b.date.getTime());
      })
    );
  }

  // Calculate next occurrence from today
  private calculateNextOccurrence(startDate: Date, frequency: RecurringFrequency): Date {
    const now = new Date();
    let nextDate = new Date(startDate);

    // If start date is in the future, return it
    if (nextDate > now) {
      return nextDate;
    }

    // Calculate next occurrence from start date that is after now
    while (nextDate <= now) {
      nextDate = this.calculateNextOccurrenceFromDate(nextDate, frequency);
    }

    return nextDate;
  }

  // Calculate next occurrence from a given date
  private calculateNextOccurrenceFromDate(
    fromDate: Date,
    frequency: RecurringFrequency
  ): Date {
    const next = new Date(fromDate);

    switch (frequency.type) {
      case 'daily':
        next.setDate(next.getDate() + frequency.interval);
        break;

      case 'weekly':
        next.setDate(next.getDate() + (7 * frequency.interval));
        if (frequency.dayOfWeek !== undefined) {
          // Adjust to specific day of week
          const currentDay = next.getDay();
          const targetDay = frequency.dayOfWeek;
          const diff = (targetDay - currentDay + 7) % 7;
          if (diff > 0) {
            next.setDate(next.getDate() + diff);
          }
        }
        break;

      case 'monthly':
        next.setMonth(next.getMonth() + frequency.interval);
        if (frequency.dayOfMonth !== undefined) {
          // Set to specific day of month (handle month overflow)
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.min(frequency.dayOfMonth, lastDay));
        }
        break;

      case 'yearly':
        next.setFullYear(next.getFullYear() + frequency.interval);
        if (frequency.monthOfYear !== undefined) {
          next.setMonth(frequency.monthOfYear - 1);
        }
        if (frequency.dayOfMonth !== undefined) {
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
          next.setDate(Math.min(frequency.dayOfMonth, lastDay));
        }
        break;
    }

    return next;
  }

  // Helper: Get frequency display text
  getFrequencyText(frequency: RecurringFrequency): string {
    const interval = frequency.interval;
    const suffix = interval > 1 ? 's' : '';

    switch (frequency.type) {
      case 'daily':
        return interval === 1 ? 'Daily' : `Every ${interval} day${suffix}`;
      case 'weekly':
        return interval === 1 ? 'Weekly' : `Every ${interval} week${suffix}`;
      case 'monthly':
        return interval === 1 ? 'Monthly' : `Every ${interval} month${suffix}`;
      case 'yearly':
        return interval === 1 ? 'Yearly' : `Every ${interval} year${suffix}`;
      default:
        return 'Custom';
    }
  }
}
