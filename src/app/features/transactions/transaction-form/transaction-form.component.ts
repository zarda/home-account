import { AfterViewInit, ChangeDetectorRef, Component, computed, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { Subscription } from 'rxjs';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TransactionService } from '../../../core/services/transaction.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Transaction, CreateTransactionDTO, BudgetPeriod } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

interface DialogData {
  mode: 'add' | 'edit';
  transaction?: Transaction;
}

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe
  ],
  templateUrl: './transaction-form.component.html',
  styleUrl: './transaction-form.component.scss',
})
export class TransactionFormComponent implements OnInit, AfterViewInit, OnDestroy {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<TransactionFormComponent>);
  data: DialogData = inject(MAT_DIALOG_DATA);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('picker') picker!: MatDatepicker<Date>;

  form!: FormGroup;
  isSubmitting = signal(false);
  transactionType = signal<'expense' | 'income'>('expense');
  private categoryIdSignal = signal<string>('');

  currencies = this.currencyService.getSupportedCurrencies();
  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;

  get periods(): { value: BudgetPeriod; label: string }[] {
    return [
      { value: 'weekly', label: this.translationService.t('transactions.weekly') },
      { value: 'monthly', label: this.translationService.t('transactions.monthly') },
      { value: 'yearly', label: this.translationService.t('transactions.yearly') }
    ];
  }

  // Store transaction dates for calendar highlighting - keyed by "year-month"
  private transactionDatesCache = new Map<string, Map<string, 'income' | 'expense' | 'both'>>();
  private loadingMonths = new Set<string>();
  private datesSubs: Subscription[] = [];

  // Computed signal that reacts to both type changes and category loading
  filteredCategories = computed(() => {
    const type = this.transactionType();
    if (type === 'income') {
      return this.incomeCategories();
    }
    return this.expenseCategories();
  });

  // Computed signal for selected category (used by mat-select-trigger)
  selectedCategory = computed(() => {
    const categoryId = this.categoryIdSignal();
    if (!categoryId) return null;
    return this.filteredCategories().find(c => c.id === categoryId) || null;
  });

  constructor() {
    // Only load categories if not already loaded
    if (this.categoryService.categories().length === 0) {
      this.categoryService.loadCategories().subscribe();
    }
  }

  ngOnInit(): void {
    this.initForm();
  }

  ngAfterViewInit(): void {
    this.setupDatepickerListeners();
  }

  ngOnDestroy(): void {
    this.datesSubs.forEach(sub => sub.unsubscribe());
  }

  private setupDatepickerListeners(): void {
    if (!this.picker) return;

    const openSub = this.picker.openedStream.subscribe(() => {
      const now = new Date();
      this.preloadMonthsAround(now.getFullYear(), now.getMonth());
    });
    this.datesSubs.push(openSub);
  }

  private preloadMonthsAround(year: number, month: number): void {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    this.loadTransactionDatesForMonth(prevYear, prevMonth);

    this.loadTransactionDatesForMonth(year, month);

    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    this.loadTransactionDatesForMonth(nextYear, nextMonth);
  }

  onCalendarMonthChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  onCalendarYearChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  private loadTransactionDatesForMonth(year: number, month: number): void {
    const monthKey = `${year}-${month}`;

    if (this.transactionDatesCache.has(monthKey) || this.loadingMonths.has(monthKey)) {
      return;
    }

    this.loadingMonths.add(monthKey);
    const sub = this.transactionService.getTransactionDatesForMonth(year, month).subscribe(dates => {
      this.transactionDatesCache.set(monthKey, dates);
      this.loadingMonths.delete(monthKey);
      this.cdr.markForCheck();
    });
    this.datesSubs.push(sub);
  }

  dateClass = (date: Date): string => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthKey = `${year}-${month}`;

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

  private initForm(): void {
    const transaction = this.data.transaction;
    const defaultCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
    const initialType = transaction?.type || 'expense';

    this.transactionType.set(initialType);

    this.form = this.fb.group({
      type: [initialType, Validators.required],
      amount: [transaction?.amount || '', [Validators.required, Validators.min(0.01)]],
      currency: [transaction?.currency || defaultCurrency, Validators.required],
      categoryId: [transaction?.categoryId || '', Validators.required],
      description: [transaction?.description || '', Validators.required],
      date: [transaction?.date?.toDate?.() || new Date(), Validators.required],
      note: [transaction?.note || ''],
      period: [transaction?.period || null],
    });

    // Watch for type changes
    this.form.get('type')?.valueChanges.subscribe((type) => {
      this.transactionType.set(type);
      // Reset category if it doesn't match the type
      const currentCategoryId = this.form.get('categoryId')?.value;
      if (currentCategoryId) {
        const validCategories = this.filteredCategories();
        if (!validCategories.some(c => c.id === currentCategoryId)) {
          this.form.patchValue({ categoryId: '' });
        }
      }
    });

    // Watch for category changes to update the trigger display
    this.categoryIdSignal.set(transaction?.categoryId || '');
    this.form.get('categoryId')?.valueChanges.subscribe((categoryId) => {
      this.categoryIdSignal.set(categoryId || '');
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);

    try {
      const formValue = this.form.value;

      const transactionData: CreateTransactionDTO = {
        type: formValue.type,
        amount: parseFloat(formValue.amount),
        currency: formValue.currency,
        categoryId: formValue.categoryId,
        description: formValue.description,
        date: formValue.date,
        ...(formValue.note ? { note: formValue.note } : {}),
        ...(formValue.period ? { period: formValue.period } : {}),
      };

      if (this.data.mode === 'add') {
        await this.transactionService.addTransaction(transactionData);
      } else if (this.data.transaction) {
        await this.transactionService.updateTransaction(
          this.data.transaction.id,
          transactionData
        );
      }

      this.dialogRef.close(true);
    } catch {
      // Save failed - could add snackbar notification here
    } finally {
      this.isSubmitting.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
