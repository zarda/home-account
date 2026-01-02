import { AfterViewInit, ChangeDetectorRef, Component, EventEmitter, inject, Input, OnDestroy, OnInit, Output, signal, ViewChild } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Subscription } from 'rxjs';
import { Category, TransactionFilters } from '../../../models';
import { TransactionService } from '../../../core/services/transaction.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-transaction-filters',
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    TranslatePipe
  ],
  templateUrl: './transaction-filters.component.html',
  styleUrl: './transaction-filters.component.scss',
})
export class TransactionFiltersComponent implements OnInit, OnDestroy, AfterViewInit {
  private transactionService = inject(TransactionService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('dayPicker') dayPicker!: MatDatepicker<Date>;
  @ViewChild('startPicker') startPicker!: MatDatepicker<Date>;
  @ViewChild('endPicker') endPicker!: MatDatepicker<Date>;
  @ViewChild('monthPicker') monthPicker!: MatDatepicker<Date>;
  @ViewChild('yearPicker') yearPicker!: MatDatepicker<Date>;

  @Input() categories: Category[] = [];
  @Input() incomeCategories: Category[] = [];
  @Output() filtersChanged = new EventEmitter<TransactionFilters>();
  @Output() addTransaction = new EventEmitter<void>();

  expanded = signal(false);
  activeQuickFilter = signal<string | null>(null);

  filters: TransactionFilters = {};

  // Store transaction dates for calendar highlighting - keyed by "year-month"
  private transactionDatesCache = new Map<string, Map<string, 'income' | 'expense' | 'both'>>();
  private loadingMonths = new Set<string>();
  private datesSubs: Subscription[] = [];

  ngOnInit(): void {
    // Default to today's transactions
    this.setQuickFilter('today');
  }

  ngAfterViewInit(): void {
    // Subscribe to datepicker view changes to pre-load data
    this.setupDatepickerListeners(this.dayPicker);
    this.setupDatepickerListeners(this.startPicker);
    this.setupDatepickerListeners(this.endPicker);
  }

  ngOnDestroy(): void {
    this.datesSubs.forEach(sub => sub.unsubscribe());
  }

  private setupDatepickerListeners(picker: MatDatepicker<Date>): void {
    if (!picker) return;

    // When picker opens, load current and adjacent months
    const openSub = picker.openedStream.subscribe(() => {
      const now = new Date();
      this.preloadMonthsAround(now.getFullYear(), now.getMonth());
    });
    this.datesSubs.push(openSub);
  }

  private preloadMonthsAround(year: number, month: number): void {
    // Previous month
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    this.loadTransactionDatesForMonth(prevYear, prevMonth);

    // Current month
    this.loadTransactionDatesForMonth(year, month);

    // Next month
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    this.loadTransactionDatesForMonth(nextYear, nextMonth);
  }

  // Called when user navigates to a different month in the calendar
  onCalendarMonthChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  // Called when user selects a different year
  onCalendarYearChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  // Load transaction dates for a specific month (with caching)
  private loadTransactionDatesForMonth(year: number, month: number): void {
    const monthKey = `${year}-${month}`;

    // Skip if already loaded or loading
    if (this.transactionDatesCache.has(monthKey) || this.loadingMonths.has(monthKey)) {
      return;
    }

    this.loadingMonths.add(monthKey);
    const sub = this.transactionService.getTransactionDatesForMonth(year, month).subscribe(dates => {
      this.transactionDatesCache.set(monthKey, dates);
      this.loadingMonths.delete(monthKey);
      this.cdr.markForCheck(); // Trigger re-render of calendar cells
    });
    this.datesSubs.push(sub);
  }

  // Date class function for highlighting dates with transactions
  dateClass = (date: Date): string => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthKey = `${year}-${month}`;

    // Trigger loading for this month if not cached
    if (!this.transactionDatesCache.has(monthKey)) {
      this.loadTransactionDatesForMonth(year, month);
      return '';
    }

    const monthData = this.transactionDatesCache.get(monthKey);
    const dateKey = `${year}-${month}-${date.getDate()}`;
    const type = monthData?.get(dateKey);

    if (type === 'income') return 'has-income';
    if (type === 'expense') return 'has-expense';
    if (type === 'both') return 'has-both';
    return '';
  };

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
      case 'today':
        this.filters.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        this.filters.endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;

      case 'thisWeek': {
        const dayOfWeek = now.getDay();
        const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
        const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
        this.filters.startDate = monday;
        this.filters.endDate = sunday;
        break;
      }

      case 'thisMonth':
        this.filters.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        this.filters.endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
    }

    this.emitFilters();
  }

  setDateFilter(date: Date | null): void {
    if (!date) return;
    this.activeQuickFilter.set(null);
    this.filters.startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    this.filters.endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    this.emitFilters();
  }

  openMonthPicker(): void {
    this.monthPicker.open();
  }

  openYearPicker(): void {
    this.yearPicker.open();
  }

  onMonthSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.activeQuickFilter.set(null);
    this.filters.startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    this.filters.endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    this.emitFilters();
  }

  onYearSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.activeQuickFilter.set(null);
    this.filters.startDate = new Date(date.getFullYear(), 0, 1);
    this.filters.endDate = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
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
