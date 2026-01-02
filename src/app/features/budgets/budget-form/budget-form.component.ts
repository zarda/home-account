import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BudgetService } from '../../../core/services/budget.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Budget, CreateBudgetDTO, BudgetPeriod } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

export interface BudgetFormDialogData {
  mode: 'add' | 'edit';
  budget?: Budget;
}

@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSliderModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTooltipModule,
    TranslatePipe
  ],
  templateUrl: './budget-form.component.html',
  styleUrl: './budget-form.component.scss'
})
export class BudgetFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<BudgetFormComponent>);
  data: BudgetFormDialogData = inject(MAT_DIALOG_DATA);
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);

  form!: FormGroup;
  isSubmitting = signal(false);
  private categoryIdSignal = signal<string>('');

  currencies = this.currencyService.getSupportedCurrencies();
  expenseCategories = this.categoryService.expenseCategories;

  // Computed signal for selected category (used by mat-select-trigger)
  selectedCategory = computed(() => {
    const categoryId = this.categoryIdSignal();
    if (!categoryId) return null;
    return this.expenseCategories().find(c => c.id === categoryId) || null;
  });

  get periods(): { value: BudgetPeriod; label: string }[] {
    return [
      { value: 'weekly', label: this.translationService.t('transactions.weekly') },
      { value: 'monthly', label: this.translationService.t('transactions.monthly') },
      { value: 'yearly', label: this.translationService.t('transactions.yearly') }
    ];
  }

  constructor() {
    // Load categories if not already loaded
    if (this.categoryService.categories().length === 0) {
      this.categoryService.loadCategories().subscribe();
    }
  }

  ngOnInit(): void {
    this.initForm();
  }

  private initForm(): void {
    const budget = this.data.budget;
    const defaultCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';

    // Convert Firestore Timestamp to Date for the form
    const startDate = budget?.startDate?.toDate() || null;

    this.form = this.fb.group({
      name: [budget?.name || '', Validators.required],
      categoryId: [budget?.categoryId || '', Validators.required],
      amount: [budget?.amount || '', [Validators.required, Validators.min(0.01)]],
      currency: [budget?.currency || defaultCurrency, Validators.required],
      period: [budget?.period || 'monthly', Validators.required],
      startDate: [startDate],
      alertThreshold: [budget?.alertThreshold || 80]
    });

    // Watch for category changes to update the trigger display
    this.categoryIdSignal.set(budget?.categoryId || '');
    this.form.get('categoryId')?.valueChanges.subscribe((categoryId) => {
      this.categoryIdSignal.set(categoryId || '');
    });
  }

  formatThreshold(value: number): string {
    return `${value}%`;
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);

    try {
      const formValue = this.form.value;

      const budgetData: CreateBudgetDTO = {
        name: formValue.name.trim(),
        categoryId: formValue.categoryId,
        amount: parseFloat(formValue.amount),
        currency: formValue.currency,
        period: formValue.period,
        alertThreshold: formValue.alertThreshold
      };

      // Only include startDate if user selected one
      if (formValue.startDate) {
        budgetData.startDate = formValue.startDate;
      }

      if (this.data.mode === 'add') {
        await this.budgetService.createBudget(budgetData);
      } else if (this.data.budget) {
        await this.budgetService.updateBudget(this.data.budget.id, budgetData);
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
