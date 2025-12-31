import { Component, computed, inject, OnInit, signal } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TransactionService } from '../../../core/services/transaction.service';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { Transaction, CreateTransactionDTO } from '../../../models';

interface DialogData {
  mode: 'add' | 'edit';
  transaction?: Transaction;
}

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './transaction-form.component.html',
  styleUrl: './transaction-form.component.scss',
})
export class TransactionFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<TransactionFormComponent>);
  data: DialogData = inject(MAT_DIALOG_DATA);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);

  form!: FormGroup;
  isSubmitting = signal(false);
  transactionType = signal<'expense' | 'income'>('expense');

  currencies = this.currencyService.getSupportedCurrencies();
  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;

  // Computed signal that reacts to both type changes and category loading
  filteredCategories = computed(() => {
    const type = this.transactionType();
    if (type === 'income') {
      return this.incomeCategories();
    }
    return this.expenseCategories();
  });

  constructor() {
    // Only load categories if not already loaded
    if (this.categoryService.categories().length === 0) {
      this.categoryService.loadCategories().subscribe();
    }
  }

  ngOnInit(): void {
    this.initForm();

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
  }

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
    } catch (error) {
      console.error('Failed to save transaction:', error);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
