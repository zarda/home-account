import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Category, RecurringOccurrence } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { AmountDisplayComponent } from '../../../shared/components/amount-display/amount-display.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LocaleDatePipe } from '../../../shared/pipes/locale-date.pipe';

/** One local calendar day of the window, with the rules landing on it. */
export interface UpcomingBillDay {
  key: string;
  date: Date;
  occurrences: RecurringOccurrence[];
}

/**
 * The scheduled half of the dashboard: what the recurring rules will move in
 * the next couple of weeks, day by day, with the window's net underneath.
 *
 * Dumb like the other dashboard widgets — the page owns the listener, the
 * base currency and the conversion, so this card can be rendered from a
 * literal. Row amounts stay in each rule's own currency: a future occurrence
 * has no write-time base-currency snapshot, and showing a converted figure
 * beside a rule the user typed in their own currency reads as a wrong number.
 * Only the net, which has to add unlike currencies up, is converted (ADR 0091).
 */
@Component({
  selector: 'app-upcoming-bills',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    AmountDisplayComponent,
    EmptyStateComponent,
    TranslatePipe,
    LocaleDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upcoming-bills.component.html',
  styleUrl: './upcoming-bills.component.scss',
})
export class UpcomingBillsComponent {
  occurrences = input.required<RecurringOccurrence[]>();
  categories = input.required<Map<string, Category>>();
  baseCurrency = input.required<string>();
  /** Window net in the base currency; income positive. Folded by the page. */
  net = input.required<number>();

  private categoryHelperService = inject(CategoryHelperService);

  /**
   * Occurrences arrive sorted by date, so first-seen order is date order and
   * a Map preserves it — the grouping deliberately adds no sort of its own,
   * which would be a second ordering rule to keep in step with the service's.
   *
   * Days already past are grouped and shown like any other: they are due but
   * not yet posted, and hiding them would conceal money about to move on the
   * one occasion the catch-up has failed.
   */
  readonly days = computed<UpcomingBillDay[]>(() => {
    const days = new Map<string, UpcomingBillDay>();
    for (const occurrence of this.occurrences()) {
      const key = dayKey(occurrence.date);
      const day = days.get(key);
      if (day) {
        day.occurrences.push(occurrence);
      } else {
        days.set(key, { key, date: occurrence.date, occurrences: [occurrence] });
      }
    }
    return [...days.values()];
  });

  getCategoryName(categoryId: string): string {
    return this.categoryHelperService.getCategoryName(categoryId, this.categories());
  }

  getCategoryIcon(categoryId: string): string {
    return this.categoryHelperService.getCategoryIcon(categoryId, this.categories());
  }

  getCategoryColor(categoryId: string): string {
    return this.categoryHelperService.getCategoryColor(categoryId, this.categories());
  }
}
