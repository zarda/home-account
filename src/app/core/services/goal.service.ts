import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { roundMoney } from '../utils/transaction-aggregation.utils';
import { CreateGoalDTO, Goal } from '../../models';

/** A contribution that would drive the stored amount below zero. */
export const GOAL_CONTRIBUTION_BELOW_ZERO = 'GOAL_CONTRIBUTION_BELOW_ZERO';

/**
 * Savings goals and projects at users/{uid}/goals, mirroring the budget
 * pattern: a signal published by the collection subscription, CRUD through
 * FirestoreService, and restore-friendly creation at caller-chosen ids.
 *
 * Contributions are manual entries on a single counter and commit through a
 * Firestore transaction (the ADR 0007 precedent) — two devices contributing
 * at once must both land, and a withdrawal must see the amount it is
 * shrinking. See ADR 0021.
 */
@Injectable({ providedIn: 'root' })
export class GoalService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  goals = signal<Goal[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.goals.set([]);
      }
    });
  }

  activeGoals = computed(() => this.goals().filter(goal => goal.isActive));

  private get userGoalsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/goals`;
  }

  /** Live list; publishes the signal. Callers own the subscription (ADR 0009). */
  getGoals(): Observable<Goal[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    this.isLoading.set(true);
    return this.firestoreService
      .subscribeToCollection<Goal>(this.userGoalsPath, {
        orderBy: [{ field: 'name', direction: 'asc' }]
      })
      .pipe(
        map(goals => {
          this.goals.set(goals);
          this.isLoading.set(false);
          return goals;
        })
      );
  }

  /** One-shot read for the backup export. */
  async exportAll(): Promise<Goal[]> {
    const userId = this.authService.userId();
    if (!userId) return [];
    return this.firestoreService.getCollection<Goal>(
      this.userGoalsPath, { orderBy: [{ field: 'name', direction: 'asc' }] });
  }

  /**
   * Create a new goal.
   *
   * `options.id` writes at a caller-chosen id so restoring a backup twice
   * overwrites rather than duplicating; `options.contributedAmount` carries
   * a restored balance verbatim — unlike a budget's `spent`, contributions
   * have no transaction source to recompute from.
   */
  async createGoal(
    data: CreateGoalDTO,
    options?: { id?: string; contributedAmount?: number }
  ): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const goal: Omit<Goal, 'id' | 'targetDate' | 'items' | 'note'> &
        Partial<Pick<Goal, 'targetDate' | 'items' | 'note'>> = {
        userId,
        kind: data.kind,
        name: data.name,
        targetAmount: data.targetAmount,
        contributedAmount: options?.contributedAmount ?? 0,
        currency: data.currency,
        isActive: true,
        createdAt: this.firestoreService.getTimestamp(),
        updatedAt: this.firestoreService.getTimestamp()
      };

      // Optionals are added only when present (Firestore rejects undefined).
      if (data.targetDate) {
        goal.targetDate = this.firestoreService.dateToTimestamp(data.targetDate);
      }
      if (data.items?.length) {
        goal.items = data.items;
      }
      if (data.note) {
        goal.note = data.note;
      }

      if (options?.id) {
        await this.firestoreService.setDocument(`${this.userGoalsPath}/${options.id}`, goal);
        return options.id;
      }
      return await this.firestoreService.addDocument(this.userGoalsPath, goal);
    } finally {
      this.isLoading.set(false);
    }
  }

  async updateGoal(id: string, data: Partial<CreateGoalDTO>): Promise<void> {
    this.isLoading.set(true);

    try {
      const updateData: Record<string, unknown> = {};

      if (data.kind !== undefined) updateData['kind'] = data.kind;
      if (data.name !== undefined) updateData['name'] = data.name;
      if (data.targetAmount !== undefined) updateData['targetAmount'] = data.targetAmount;
      if (data.currency !== undefined) updateData['currency'] = data.currency;
      if (data.items !== undefined) updateData['items'] = data.items;
      if (data.note !== undefined) updateData['note'] = data.note;

      if (data.targetDate !== undefined) {
        // null clears the stored date; a Date replaces it.
        updateData['targetDate'] = data.targetDate
          ? this.firestoreService.dateToTimestamp(data.targetDate)
          : deleteField();
      }

      updateData['updatedAt'] = this.firestoreService.getTimestamp();
      await this.firestoreService.updateDocument(`${this.userGoalsPath}/${id}`, updateData);
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteGoal(id: string): Promise<void> {
    await this.firestoreService.deleteDocument(`${this.userGoalsPath}/${id}`);
  }

  async deactivateGoal(id: string): Promise<void> {
    await this.firestoreService.updateDocument(`${this.userGoalsPath}/${id}`, {
      isActive: false,
      updatedAt: this.firestoreService.getTimestamp()
    });
  }

  async activateGoal(id: string): Promise<void> {
    await this.firestoreService.updateDocument(`${this.userGoalsPath}/${id}`, {
      isActive: true,
      updatedAt: this.firestoreService.getTimestamp()
    });
  }

  /**
   * Add to (or, with a negative amount, take from) the contributed counter.
   * Transactional: the write lands on the amount it actually read, and a
   * withdrawal past zero aborts with GOAL_CONTRIBUTION_BELOW_ZERO.
   */
  async contribute(id: string, amount: number): Promise<void> {
    const ref = this.firestoreService.getDocRef(`${this.userGoalsPath}/${id}`);

    await this.firestoreService.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('Goal not found');

      const current = (snapshot.data() as Goal).contributedAmount ?? 0;
      const next = roundMoney(current + amount);
      if (next < 0) throw new Error(GOAL_CONTRIBUTION_BELOW_ZERO);

      tx.update(ref, {
        contributedAmount: next,
        updatedAt: this.firestoreService.getTimestamp()
      });
    });
  }

  /** Check or uncheck one item on a project's list, by position. */
  async toggleItem(id: string, index: number, done: boolean): Promise<void> {
    const ref = this.firestoreService.getDocRef(`${this.userGoalsPath}/${id}`);

    await this.firestoreService.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('Goal not found');

      const items = [...((snapshot.data() as Goal).items ?? [])];
      if (index < 0 || index >= items.length) throw new Error('Item out of range');

      items[index] = { ...items[index], done };
      tx.update(ref, {
        items,
        updatedAt: this.firestoreService.getTimestamp()
      });
    });
  }

  /**
   * Remove every goal, for account deletion. Enumerates the collection
   * rather than the signal — the signal only holds what a subscription
   * happened to deliver.
   */
  async deleteAll(): Promise<number> {
    const userId = this.authService.userId();
    if (!userId) return 0;
    const rows = await this.firestoreService.getCollection<Goal>(this.userGoalsPath);
    for (const row of rows) {
      await this.firestoreService.deleteDocument(`${this.userGoalsPath}/${row.id}`);
    }
    this.goals.set([]);
    return rows.length;
  }
}
