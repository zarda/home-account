import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AggregateAnswer, TransactionFilters } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * One computed aggregate answer: label, headline figure, optional extreme
 * row and category breakdown, the resolved period, and a view-transactions
 * action. Rendered live inside the smart-search dialog and again for stored
 * snapshots — a snapshot passes `computedAt` so the figures are labeled with
 * when they were true, and its extreme-row detail line is simply absent
 * (the stored record keeps the row's id, not the row).
 */
@Component({
  selector: 'app-nl-answer-card',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nl-answer-card.component.html',
  styleUrl: './nl-answer-card.component.scss',
})
export class NlAnswerCardComponent {
  private currencyService = inject(CurrencyService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private dateFormatService = inject(DateFormatService);

  answer = input.required<AggregateAnswer>();
  /** Present for stored snapshots: when these figures were computed. */
  computedAt = input<Date | null>(null);
  viewTransactions = output<TransactionFilters>();

  onViewTransactions(): void {
    this.viewTransactions.emit(this.answer().scope);
  }

  periodLabel(filters: TransactionFilters): string {
    const start = filters.startDate ? this.dateFormatService.formatDate(filters.startDate) : '…';
    const end = filters.endDate ? this.dateFormatService.formatDate(filters.endDate) : '…';
    return `${start} – ${end}`;
  }

  formatComputedAt(date: Date): string {
    return this.dateFormatService.formatDate(date);
  }

  answerLabel(answer: AggregateAnswer): string {
    const keys: Record<AggregateAnswer['operation'], string> = {
      sum: 'aiSearch.answerSum',
      count: 'aiSearch.answerCount',
      average: 'aiSearch.answerAverage',
      max: 'aiSearch.answerMax',
      min: 'aiSearch.answerMin',
      topCategories: 'aiSearch.answerTopCategories',
    };
    return this.translationService.t(keys[answer.operation]);
  }

  answerValue(answer: AggregateAnswer): string {
    if (answer.operation === 'count') {
      return `${answer.value}`;
    }
    return this.formatMoney(answer.value, answer.currency);
  }

  formatMoney(value: number, currency?: string): string {
    return currency ? this.currencyService.formatCurrency(value, currency) : `${value}`;
  }

  categoryName(categoryId: string): string {
    const category = this.categoryService.categories().find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Other';
  }
}
