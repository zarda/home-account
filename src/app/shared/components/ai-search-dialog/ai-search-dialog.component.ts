import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NlSearchService } from '../../../core/services/nl-search.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { TranslationService } from '../../../core/services/translation.service';
import { isImeComposition } from '../../../core/utils/keyboard.utils';
import { AggregateAnswer, NlSearchResult, TransactionFilters } from '../../../models';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Global natural-language search dialog, opened from the app header.
 * Filter interpretations are shown for confirmation before they are
 * applied; aggregate answers are computed locally from real transaction
 * data by NlSearchService.
 */
@Component({
  selector: 'app-ai-search-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './ai-search-dialog.component.html',
  styleUrl: './ai-search-dialog.component.scss',
})
export class AiSearchDialogComponent {
  private nlSearch = inject(NlSearchService);
  private pendingFilters = inject(PendingFiltersService);
  private router = inject(Router);
  private dialogRef = inject(MatDialogRef<AiSearchDialogComponent>);
  private currencyService = inject(CurrencyService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private dateFormatService = inject(DateFormatService);

  query = '';
  isLoading = signal(false);
  private result = signal<NlSearchResult | null>(null);

  filterResult = computed(() => {
    const r = this.result();
    return r?.kind === 'filter' ? r : null;
  });
  answerResult = computed(() => {
    const r = this.result();
    return r?.kind === 'answer' ? r.answer : null;
  });
  fallbackResult = computed(() => {
    const r = this.result();
    return r?.kind === 'keywordFallback' ? r : null;
  });

  async submit(): Promise<void> {
    const query = this.query.trim();
    if (!query || this.isLoading()) return;

    this.isLoading.set(true);
    this.result.set(null);
    try {
      this.result.set(await this.nlSearch.search(query));
    } finally {
      this.isLoading.set(false);
    }
  }

  onEnter(event: Event): void {
    if (isImeComposition(event)) return;
    void this.submit();
  }

  applyFilters(filters: TransactionFilters): void {
    this.pendingFilters.apply(filters);
    void this.router.navigate(['/transactions']);
    this.dialogRef.close();
  }

  /** Human-readable summary chips for an interpreted filter set. */
  describeFilters(filters: TransactionFilters): string[] {
    const parts: string[] = [];
    if (filters.type) {
      parts.push(this.translationService.t(
        filters.type === 'expense' ? 'transactions.expense' : 'transactions.income'));
    }
    if (filters.categoryId) {
      parts.push(this.categoryName(filters.categoryId));
    }
    if (filters.startDate || filters.endDate) {
      parts.push(this.periodLabel(filters));
    }
    if (filters.minAmount !== undefined) {
      parts.push(`≥ ${filters.minAmount}`);
    }
    if (filters.maxAmount !== undefined) {
      parts.push(`≤ ${filters.maxAmount}`);
    }
    if (filters.currency) {
      parts.push(filters.currency);
    }
    if (filters.searchQuery) {
      parts.push(`"${filters.searchQuery}"`);
    }
    return parts;
  }

  periodLabel(filters: TransactionFilters): string {
    const start = filters.startDate ? this.dateFormatService.formatDate(filters.startDate) : '…';
    const end = filters.endDate ? this.dateFormatService.formatDate(filters.endDate) : '…';
    return `${start} – ${end}`;
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

  fallbackNoticeKey(reason: 'offline' | 'noProvider' | 'error'): string {
    switch (reason) {
      case 'offline': return 'aiSearch.offlineFallback';
      case 'noProvider': return 'aiSearch.noProviderFallback';
      case 'error': return 'aiSearch.errorFallback';
    }
  }
}
