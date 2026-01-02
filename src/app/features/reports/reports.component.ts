import { Component, computed, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { TranslationService } from '../../core/services/translation.service';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { SpendingAnalysisComponent } from './spending-analysis/spending-analysis.component';
import { CategoryBreakdownComponent } from './category-breakdown/category-breakdown.component';
import { MonthlyComparisonComponent } from './monthly-comparison/monthly-comparison.component';
import { ExportDialogComponent } from './export-dialog/export-dialog.component';
import { Category, Transaction } from '../../models';

type PeriodOption = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

interface CustomPeriod {
  type: 'month' | 'year';
  year: number;
  month?: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    MatDialogModule,
    LoadingSpinnerComponent,
    SpendingAnalysisComponent,
    CategoryBreakdownComponent,
    MonthlyComparisonComponent,
    TranslatePipe,
  ],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);

  selectedPeriod: PeriodOption = 'thisMonth';
  isLoading = signal(true);
  selectedTabIndex = 0;

  // Custom period selection
  customPeriod = signal<CustomPeriod | null>(null);

  customPeriodLabel = computed(() => {
    const cp = this.customPeriod();
    if (!cp) return '';
    if (cp.type === 'year') return cp.year.toString();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[cp.month!]} ${cp.year}`;
  });

  isCustomPeriod = computed(() => this.selectedPeriod === 'custom');

  @ViewChild('monthPicker') monthPicker!: MatDatepicker<Date>;
  @ViewChild('yearPicker') yearPicker!: MatDatepicker<Date>;

  // User info
  baseCurrency = computed(() => {
    return this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
  });

  // Date range for child components
  dateRange = signal<{ start: Date; end: Date }>({ start: new Date(), end: new Date() });

  // Transaction data
  transactions = this.transactionService.transactions;
  categories = this.categoryService.categories;

  categoriesMap = computed(() => {
    const map = new Map<string, Category>();
    for (const cat of this.categories()) {
      map.set(cat.id, cat);
    }
    return map;
  });

  // Convert transaction amount to current base currency dynamically
  private toBaseCurrency(t: Transaction): number {
    return this.currencyService.convert(t.amount, t.currency, this.baseCurrency());
  }

  // Computed totals (using dynamic conversion)
  totalIncome = computed(() => {
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + this.toBaseCurrency(t), 0);
  });

  totalExpenses = computed(() => {
    return this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + this.toBaseCurrency(t), 0);
  });

  balance = computed(() => this.totalIncome() - this.totalExpenses());

  categoryTotals = computed(() => {
    const transactions = this.transactions();
    const expenseTransactions = transactions.filter(t => t.type === 'expense');

    const totals = new Map<string, number>();
    for (const t of expenseTransactions) {
      const current = totals.get(t.categoryId) || 0;
      totals.set(t.categoryId, current + this.toBaseCurrency(t));
    }

    return Array.from(totals.entries())
      .map(([categoryId, total]) => ({ categoryId, total }))
      .sort((a, b) => b.total - a.total);
  });

  ngOnInit(): void {
    this.loadData();
  }

  onPeriodChange(): void {
    this.customPeriod.set(null);
    this.loadData();
  }

  openMonthPicker(): void {
    this.monthPicker.open();
  }

  openYearPicker(): void {
    this.yearPicker.open();
  }

  onMonthSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({
      type: 'month',
      year: date.getFullYear(),
      month: date.getMonth()
    });
    this.selectedPeriod = 'custom';
    this.loadData();
  }

  onYearSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({
      type: 'year',
      year: date.getFullYear()
    });
    this.selectedPeriod = 'custom';
    this.loadData();
  }

  clearCustomPeriod(): void {
    this.customPeriod.set(null);
    this.selectedPeriod = 'thisMonth';
    this.loadData();
  }

  openExportDialog(): void {
    this.dialog.open(ExportDialogComponent, {
      width: '100%',
      maxWidth: '500px',
      data: {
        transactions: this.transactions(),
        categories: this.categories(),
        dateRange: this.dateRange(),
        currency: this.baseCurrency()
      }
    });
  }

  private loadData(): void {
    this.isLoading.set(true);
    const range = this.getPeriodDates();
    this.dateRange.set(range);

    this.transactionService.getByDateRange(range.start, range.end).subscribe({
      next: () => this.isLoading.set(false),
      error: () => this.isLoading.set(false)
    });

    this.categoryService.loadCategories().subscribe();
  }

  private getPeriodDates(): { start: Date; end: Date } {
    const now = new Date();

    if (this.selectedPeriod === 'custom') {
      const cp = this.customPeriod();
      if (cp) {
        if (cp.type === 'month') {
          return {
            start: new Date(cp.year, cp.month!, 1),
            end: new Date(cp.year, cp.month! + 1, 0, 23, 59, 59)
          };
        } else {
          return {
            start: new Date(cp.year, 0, 1),
            end: new Date(cp.year, 11, 31, 23, 59, 59)
          };
        }
      }
    }

    switch (this.selectedPeriod) {
      case 'thisMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        };

      case 'lastMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        };

      case 'last3Months':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        };

      case 'thisYear':
      default:
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        };
    }
  }
}
