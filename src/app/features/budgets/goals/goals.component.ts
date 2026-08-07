import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { GoalService } from '../../../core/services/goal.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CreateGoalDTO, Goal } from '../../../models';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { GoalFormComponent, GoalFormDialogData } from './goal-form/goal-form.component';
import {
  GoalContributeDialogComponent,
  GoalContributeDialogData
} from './goal-contribute-dialog/goal-contribute-dialog.component';
import { GoalProgressCardComponent } from './goal-progress-card/goal-progress-card.component';

/**
 * The Goals tab on the Budgets page: savings goals and projects, each a
 * progress card. Self-contained like the Recurring tab beside it — the
 * subscription is scoped here and dies with the tab's host page.
 */
@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    EmptyStateComponent,
    LoadingSpinnerComponent,
    GoalProgressCardComponent,
    TranslatePipe
  ],
  templateUrl: './goals.component.html',
  styleUrl: './goals.component.scss'
})
export class GoalsComponent implements OnInit {
  private goalService = inject(GoalService);
  private notifications = inject(NotificationService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);

  goals = signal<Goal[]>([]);
  isLoading = signal(true);

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

  ngOnInit(): void {
    // A live stream that never completes; without the destroy hook a closed
    // page keeps its listener for the rest of the session.
    this.goalService.getGoals()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: goals => {
          this.goals.set(goals);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false)
      });
  }

  openAddDialog(): void {
    const data: GoalFormDialogData = { mode: 'add' };
    this.dialog.open(GoalFormComponent, { width: '100%', maxWidth: '520px', data })
      .afterClosed()
      .subscribe((result: CreateGoalDTO | undefined) => {
        if (!result) return;
        this.goalService.createGoal(result)
          .then(() => this.notifications.success(this.t('goal.created')))
          .catch(() => this.notifications.error(this.t('goal.createFailed')));
      });
  }

  openEditDialog(goal: Goal): void {
    const data: GoalFormDialogData = { mode: 'edit', goal };
    this.dialog.open(GoalFormComponent, { width: '100%', maxWidth: '520px', data })
      .afterClosed()
      .subscribe((result: CreateGoalDTO | undefined) => {
        if (!result) return;
        this.goalService.updateGoal(goal.id, result)
          .then(() => this.notifications.success(this.t('goal.updated')))
          .catch(() => this.notifications.error(this.t('goal.updateFailed')));
      });
  }

  openContributeDialog(goal: Goal): void {
    const data: GoalContributeDialogData = { goal };
    this.dialog.open(GoalContributeDialogComponent, { width: '100%', maxWidth: '400px', data })
      .afterClosed()
      .subscribe((amount: number | undefined) => {
        if (!amount) return;
        this.goalService.contribute(goal.id, amount)
          .then(() => this.notifications.success(this.t('goal.contributionRecorded')))
          .catch(() => this.notifications.error(this.t('goal.contributionFailed')));
      });
  }

  deleteGoal(goal: Goal): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.t('goal.deleteTitle'),
        message: this.t('goal.deleteMessage', { name: goal.name }),
        confirmLabel: this.t('common.delete'),
        confirmColor: 'warn'
      }
    })
      .afterClosed()
      .subscribe(confirmed => {
        if (!confirmed) return;
        this.goalService.deleteGoal(goal.id)
          .then(() => this.notifications.success(this.t('goal.deleted')))
          .catch(() => this.notifications.error(this.t('goal.deleteFailed')));
      });
  }

  onToggleItem(goal: Goal, event: { index: number; done: boolean }): void {
    this.goalService.toggleItem(goal.id, event.index, event.done)
      .catch(() => this.notifications.error(this.t('goal.updateFailed')));
  }
}
