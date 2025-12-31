import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { Category, TransactionFilters } from '../../../models';

@Component({
  selector: 'app-transaction-filters',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatExpansionModule
  ],
  templateUrl: './transaction-filters.component.html',
  styleUrl: './transaction-filters.component.scss',
})
export class TransactionFiltersComponent {
  @Input() categories: Category[] = [];
  @Input() incomeCategories: Category[] = [];
  @Output() filtersChanged = new EventEmitter<TransactionFilters>();
  @Output() addTransaction = new EventEmitter<void>();

  expanded = signal(false);
  activeQuickFilter = signal<string | null>(null);

  filters: TransactionFilters = {};

  activeFilterCount(): number {
    let count = 0;
    if (this.filters.type) count++;
    if (this.filters.categoryId) count++;
    if (this.filters.startDate) count++;
    if (this.filters.endDate) count++;
    if (this.filters.searchQuery) count++;
    if (this.filters.minAmount !== undefined) count++;
    if (this.filters.maxAmount !== undefined) count++;
    return count;
  }

  onFilterChange(): void {
    this.activeQuickFilter.set(null);
    this.emitFilters();
  }

  setQuickFilter(filter: string): void {
    this.activeQuickFilter.set(filter);
    const now = new Date();

    switch (filter) {
      case 'thisMonth':
        this.filters.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        this.filters.endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;

      case 'lastMonth':
        this.filters.startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        this.filters.endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;

      case 'last7Days':
        this.filters.endDate = new Date();
        this.filters.startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;

      case 'last30Days':
        this.filters.endDate = new Date();
        this.filters.startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    this.emitFilters();
  }

  isQuickFilterActive(filter: string): boolean {
    return this.activeQuickFilter() === filter;
  }

  clearFilters(): void {
    this.filters = {};
    this.activeQuickFilter.set(null);
    this.emitFilters();
  }

  private emitFilters(): void {
    // Clean up undefined values
    const cleanFilters: TransactionFilters = {};

    if (this.filters.type) cleanFilters.type = this.filters.type;
    if (this.filters.categoryId) cleanFilters.categoryId = this.filters.categoryId;
    if (this.filters.startDate) cleanFilters.startDate = this.filters.startDate;
    if (this.filters.endDate) cleanFilters.endDate = this.filters.endDate;
    if (this.filters.searchQuery) cleanFilters.searchQuery = this.filters.searchQuery;
    if (this.filters.minAmount !== undefined) cleanFilters.minAmount = this.filters.minAmount;
    if (this.filters.maxAmount !== undefined) cleanFilters.maxAmount = this.filters.maxAmount;

    this.filtersChanged.emit(cleanFilters);
  }
}
