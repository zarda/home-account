import { Component, inject, OnInit, signal } from '@angular/core';
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

import { BudgetService } from '../../../core/services/budget.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { Budget, CreateBudgetDTO, BudgetPeriod } from '../../../models';

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
    MatProgressSpinnerModule
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

  form!: FormGroup;
  isSubmitting = signal(false);

  currencies = this.currencyService.getSupportedCurrencies();
  expenseCategories = this.categoryService.expenseCategories;

  periods: { value: BudgetPeriod; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' }
  ];

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

    this.form = this.fb.group({
      name: [budget?.name || '', Validators.required],
      categoryId: [budget?.categoryId || '', Validators.required],
      amount: [budget?.amount || '', [Validators.required, Validators.min(0.01)]],
      currency: [budget?.currency || defaultCurrency, Validators.required],
      period: [budget?.period || 'monthly', Validators.required],
      alertThreshold: [budget?.alertThreshold || 80]
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

      if (this.data.mode === 'add') {
        await this.budgetService.createBudget(budgetData);
      } else if (this.data.budget) {
        await this.budgetService.updateBudget(this.data.budget.id, budgetData);
      }

      this.dialogRef.close(true);
    } catch (error) {
      console.error('Failed to save budget:', error);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
