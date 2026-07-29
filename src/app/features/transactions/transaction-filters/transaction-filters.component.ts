import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, inject, Input, OnChanges, OnDestroy, OnInit, Output, signal, SimpleChanges, ViewChild } from '@angular/core';

import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { Category, CurrencyInfo, SavedSearch, TransactionFilters } from '../../../models';
import { TransactionService } from '../../../core/services/transaction.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { isImeComposition } from '../../../core/utils/keyboard.utils';
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
    MatChipsModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe
  ],
  templateUrl: './transaction-filters.component.html',
  styleUrl: './transaction-filters.component.scss',
})
export class TransactionFiltersComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  private transactionService = inject(TransactionService);
  private cdr = inject(ChangeDetectorRef);
  private currencyService = inject(CurrencyService);
  private elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  searchHistory = inject(SearchHistoryService);
  private analytics = inject(AnalyticsService);

  @ViewChild('dayPicker') dayPicker!: MatDatepicker<Date>;
  @ViewChild('startPicker') startPicker!: MatDatepicker<Date>;
  @ViewChild('endPicker') endPicker!: MatDatepicker<Date>;
  @ViewChild('monthPicker') monthPicker!: MatDatepicker<Date>;
  @ViewChild('yearPicker') yearPicker!: MatDatepicker<Date>;

  @Input() categories: Category[] = [];
  @Input() incomeCategories: Category[] = [];
  @Input() initialDate?: Date;
  /**
   * Filters applied from outside the panel (insight chips, smart search).
   * Each new object reference replaces the whole filter set and is emitted,
   * so the panel UI always reflects what was applied externally.
   */
  @Input() presetFilters?: TransactionFilters;
  @Input() showAll = false;
  @Output() filtersChanged = new EventEmitter<TransactionFilters>();

  expanded = signal(false);
  activeQuickFilter = signal<string | null>(null);
  readonly tagSeparatorKeys = [ENTER, COMMA] as const;

  filters: TransactionFilters = {};

  currencies: CurrencyInfo[] = this.currencyService.getSupportedCurrencies();

  // Store transaction dates for calendar highlighting - keyed by "year-month"
  private transactionDatesCache = new Map<string, Map<string, 'income' | 'expense' | 'both'>>();
  private loadingMonths = new Set<string>();
  private datesSubs: Subscription[] = [];

  private initialFilterApplied = false;

  // Search input is debounced so a filter pass (and window refetch) runs once
  // typing pauses, not per keystroke. Every other control emits immediately.
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private searchInput$ = new Subject<void>();
  private searchSub?: Subscription;
  private searchHistorySub?: Subscription;
  // Last searchQuery included in any emission; a pending debounce tick whose
  // value already went out (via Enter, blur, or another filter change) no-ops.
  private lastEmittedSearch = '';
  // Last query written to search history, so a repeated flush of the same
  // text records it once.
  private lastRecordedQuery = '';

  searchFocused = signal(false);
  saveMode = signal(false);
  saveLabel = '';

  ngOnInit(): void {
    this.searchSub = this.searchInput$
      .pipe(debounceTime(TransactionFiltersComponent.SEARCH_DEBOUNCE_MS))
      .subscribe(() => this.commitSearch());

    this.searchHistorySub = this.searchHistory.loadSearches().subscribe();

    // Default filter will be applied in ngOnChanges or after a tick if no initialDate
    setTimeout(() => {
      if (!this.initialFilterApplied) {
        if (this.showAll) {
          // Show all transactions without any date filter
          this.clearFilters();
        } else {
          // Default to the current month: "Today" left the desktop canvas
          // near-empty (often a single row).
          this.setQuickFilter('thisMonth');
        }
        this.initialFilterApplied = true;
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialDate'] && changes['initialDate'].currentValue) {
      this.setDateFilter(changes['initialDate'].currentValue);
      this.initialFilterApplied = true;
    }

    if (changes['presetFilters'] && changes['presetFilters'].currentValue) {
      this.filters = { ...(changes['presetFilters'].currentValue as TransactionFilters) };
      this.activeQuickFilter.set(null);
      this.initialFilterApplied = true;
      this.emitFilters();
    }
  }

  ngAfterViewInit(): void {
    // Subscribe to datepicker view changes to pre-load data
    this.setupDatepickerListeners(this.dayPicker);
    this.setupDatepickerListeners(this.startPicker);
    this.setupDatepickerListeners(this.endPicker);
  }

  ngOnDestroy(): void {
    this.datesSubs.forEach(sub => sub.unsubscribe());
    this.searchSub?.unsubscribe();
    this.searchHistorySub?.unsubscribe();
    this.searchInput$.complete();
  }

  onSearchInput(): void {
    // Input events only come from a focused input; resync the flag in case a
    // panel tap dropped it while DOM focus stayed on the input.
    this.searchFocused.set(true);
    this.searchInput$.next();
  }

  // Enter or leaving the search area commits the search immediately instead
  // of waiting out the debounce, and remembers the settled query.
  flushSearch(): void {
    this.commitSearch();
    this.recordSearch();
  }

  onSearchEnter(event: Event): void {
    if (isImeComposition(event)) return;
    this.flushSearch();
  }

  onSaveLabelEnter(event: Event): void {
    if (isImeComposition(event)) return;
    this.confirmSaveSearch();
  }

  private commitSearch(): void {
    if ((this.filters.searchQuery ?? '') === this.lastEmittedSearch) return;
    this.onFilterChange();
  }

  private recordSearch(): void {
    const query = (this.filters.searchQuery ?? '').trim();
    if (!query || query === this.lastRecordedQuery) return;
    this.lastRecordedQuery = query;
    void this.searchHistory.recordRecent(query);
    this.analytics.trackTransactionSearch({ has_filters: this.hasNarrowingFilters() });
  }

  /**
   * Whether the search was run against anything narrower than the default view.
   *
   * Deliberately not activeFilterCount(): that counts startDate and endDate as
   * two separate filters, and every quick filter — including the "this month"
   * one ngOnInit applies before the user touches anything — sets both. Reading
   * it here would report has_filters for a plain visit and miss the
   * distinction the event exists to draw.
   *
   * Reported only from recordSearch(), which runs on a committed, non-empty,
   * changed query — so this is one event per search the user meant, not one
   * per keystroke and not one per page load.
   */
  private hasNarrowingFilters(): boolean {
    return (
      !!this.filters.type ||
      !!this.filters.categoryId ||
      !!this.filters.currency ||
      this.filters.minAmount !== undefined ||
      this.filters.maxAmount !== undefined ||
      !!this.filters.tags?.length ||
      this.activeQuickFilter() !== 'thisMonth'
    );
  }

  // The recents/saved dropdown renders under a focused, still-empty search box.
  showSearchPanel(): boolean {
    return (
      this.searchFocused() &&
      !this.filters.searchQuery &&
      (this.searchHistory.savedSearches().length > 0 ||
        this.searchHistory.recentSearches().length > 0)
    );
  }

  onSearchFocus(): void {
    this.searchFocused.set(true);
  }

  // Fired on the whole search wrapper: focus moving between the input and the
  // suggestion buttons keeps the panel alive (Tab is how keyboard users reach
  // it); leaving the area closes it and commits the query.
  onSearchAreaFocusout(event: FocusEvent): void {
    const wrapper = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget)) {
      return;
    }
    this.searchFocused.set(false);
    this.flushSearch();
  }

  onSearchEscape(): void {
    this.searchFocused.set(false);
  }

  onSearchArrowDown(event: Event): void {
    const first = this.elementRef.nativeElement.querySelector<HTMLElement>('.suggestion-apply');
    if (!first) return;
    event.preventDefault();
    first.focus();
  }

  // One tap on a remembered search: apply it immediately (no debounce wait)
  // and refresh its recency instead of re-recording it.
  applySearch(item: SavedSearch): void {
    this.filters.searchQuery = item.query;
    this.lastRecordedQuery = item.query;
    this.searchFocused.set(false);
    this.onFilterChange();
    void this.searchHistory.touch(item.id);
  }

  removeSearch(item: SavedSearch, event: Event): void {
    event.stopPropagation();
    void this.searchHistory.deleteSearch(item.id);
  }

  toggleSaveMode(): void {
    this.saveMode.update(open => !open);
    if (this.saveMode()) {
      this.saveLabel = this.filters.searchQuery ?? '';
    }
  }

  confirmSaveSearch(): void {
    const query = (this.filters.searchQuery ?? '').trim();
    if (!query) return;
    const label = this.saveLabel.trim() || query;
    void this.searchHistory.saveSearch(query, label);
    this.saveMode.set(false);
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
    if (this.filters.currency) count++;
    if (this.filters.tags?.length) count++;
    return count;
  }

  addTagFilter(event: MatChipInputEvent): void {
    // Same normalization as the form's tag input, so a chip typed here
    // matches a tag typed there.
    const tag = event.value.trim().toLowerCase();
    if (tag && !(this.filters.tags ?? []).includes(tag)) {
      this.filters.tags = [...(this.filters.tags ?? []), tag];
      this.onFilterChange();
    }
    event.chipInput.clear();
  }

  removeTagFilter(tag: string): void {
    this.filters.tags = (this.filters.tags ?? []).filter(existing => existing !== tag);
    if (this.filters.tags.length === 0) delete this.filters.tags;
    this.onFilterChange();
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
    this.lastEmittedSearch = this.filters.searchQuery ?? '';

    // Clean up undefined values
    const cleanFilters: TransactionFilters = {};

    if (this.filters.type) cleanFilters.type = this.filters.type;
    if (this.filters.categoryId) cleanFilters.categoryId = this.filters.categoryId;
    if (this.filters.startDate) cleanFilters.startDate = this.filters.startDate;
    if (this.filters.endDate) cleanFilters.endDate = this.filters.endDate;
    if (this.filters.searchQuery) cleanFilters.searchQuery = this.filters.searchQuery;
    if (this.filters.minAmount !== undefined) cleanFilters.minAmount = this.filters.minAmount;
    if (this.filters.maxAmount !== undefined) cleanFilters.maxAmount = this.filters.maxAmount;
    if (this.filters.currency) cleanFilters.currency = this.filters.currency;
    if (this.filters.tags?.length) cleanFilters.tags = this.filters.tags;

    this.filtersChanged.emit(cleanFilters);
  }
}
