import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import { CurrencyService } from '../../../../core/services/currency.service';
import { goalPercentage } from '../../../../core/utils/goal-progress.utils';
import { Goal } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * One goal, its progress, and — for a project — its checklist. Mirrors the
 * budget progress card: the true percentage may pass 100 while the bar
 * clamps, so an overshoot reads in the number, not as a broken bar.
 */
@Component({
  selector: 'app-goal-progress-card',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressBarModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './goal-progress-card.component.html',
  styleUrl: './goal-progress-card.component.scss'
})
export class GoalProgressCardComponent {
  private currencyService = inject(CurrencyService);

  goal = input.required<Goal>();

  edit = output<void>();
  delete = output<void>();
  contribute = output<void>();
  toggleItem = output<{ index: number; done: boolean }>();

  readonly percentage = computed(() => Math.round(goalPercentage(this.goal())));
  readonly barValue = computed(() => Math.min(100, this.percentage()));
  readonly remaining = computed(() =>
    Math.max(0, this.goal().targetAmount - this.goal().contributedAmount)
  );
  readonly reached = computed(
    () => this.goal().contributedAmount >= this.goal().targetAmount
  );
  readonly kindIcon = computed(() => (this.goal().kind === 'saving' ? 'savings' : 'flag'));
  readonly items = computed(() => this.goal().items ?? []);
  readonly doneCount = computed(() => this.items().filter(item => item.done).length);
  readonly targetDate = computed(() => this.goal().targetDate?.toDate() ?? null);

  formatCurrency(amount: number): string {
    return this.currencyService.formatCurrency(amount, this.goal().currency);
  }

  onItemToggled(index: number, done: boolean): void {
    this.toggleItem.emit({ index, done });
  }
}
