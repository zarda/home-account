import { Component, computed, inject, Input, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatExpansionModule } from '@angular/material/expansion';

import { Transaction, Category } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CurrencyService } from '../../../core/services/currency.service';

interface CategoryBreakdown {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  total: number;
  percentage: number;
  transactionCount: number;
  averageAmount: number;
}

@Component({
  selector: 'app-category-breakdown',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonToggleModule,
    MatExpansionModule,
    EmptyStateComponent,
    CurrencyPipe
  ],
  templateUrl: './category-breakdown.component.html',
  styleUrl: './category-breakdown.component.scss',
})
export class CategoryBreakdownComponent {
  private currencyService = inject(CurrencyService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set categories(value: Category[]) {
    this._categories.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _categories = signal<Category[]>([]);
  private _currency = signal('USD');

  // Expose currency for template
  get currencyCode(): string {
    return this._currency();
  }

  // Use signal for selectedType so computed signals react to changes
  selectedType = signal<'expense' | 'income'>('expense');

  // Convert transaction amount to current base currency dynamically
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.convert(t.amount, t.currency, this._currency());
  }

  // Filter transactions by type
  filteredTransactions = computed(() => {
    return this._transactions().filter(t => t.type === this.selectedType());
  });

  // Total for selected type (using dynamic conversion)
  total = computed(() => {
    return this.filteredTransactions().reduce((sum, t) => sum + this.toBaseCurrency(t), 0);
  });

  // Category breakdown (using dynamic conversion)
  categoryBreakdown = computed<CategoryBreakdown[]>(() => {
    const transactions = this.filteredTransactions();
    const categories = this._categories();
    const total = this.total();

    const breakdown = new Map<string, { total: number; count: number }>();

    for (const t of transactions) {
      const existing = breakdown.get(t.categoryId) || { total: 0, count: 0 };
      existing.total += this.toBaseCurrency(t);
      existing.count += 1;
      breakdown.set(t.categoryId, existing);
    }

    return Array.from(breakdown.entries())
      .map(([categoryId, data]) => {
        const category = categories.find(c => c.id === categoryId);
        return {
          categoryId,
          name: category?.name || 'Unknown',
          icon: category?.icon || 'category',
          color: category?.color || '#9E9E9E',
          total: data.total,
          percentage: total > 0 ? (data.total / total) * 100 : 0,
          transactionCount: data.count,
          averageAmount: data.count > 0 ? data.total / data.count : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  // Get transactions for a specific category
  getTransactionsForCategory(categoryId: string): Transaction[] {
    return this.filteredTransactions()
      .filter(t => t.categoryId === categoryId)
      .sort((a, b) => b.date.toDate().getTime() - a.date.toDate().getTime())
      .slice(0, 5);
  }

  hasData = computed(() => this.filteredTransactions().length > 0);
}
