import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { CategoryService } from '../../../../core/services/category.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { RecurringTransaction, CreateRecurringDTO, FrequencyType, Category } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

interface DialogData {
  recurring?: RecurringTransaction;
}

@Component({
  selector: 'app-recurring-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    TranslatePipe,
  ],
  templateUrl: './recurring-form-dialog.component.html',
  styleUrl: './recurring-form-dialog.component.scss',
})
export class RecurringFormDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<RecurringFormDialogComponent>);
  private data = inject<DialogData>(MAT_DIALOG_DATA);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  // Form data
  name = '';
  type: 'income' | 'expense' = 'expense';
  amount: number | null = null;
  currency = 'USD';
  categoryId = '';
  description = '';
  frequencyType: FrequencyType = 'monthly';
  interval = 1;
  dayOfWeek: number | null = null;
  dayOfMonth: number | null = 1;
  startDate: Date = new Date();
  endDate: Date | null = null;
  hasEndDate = false;

  // Options - computed for translation
  get frequencyOptions(): { value: FrequencyType; label: string }[] {
    return [
      { value: 'daily', label: this.translationService.t('frequency.daily') },
      { value: 'weekly', label: this.translationService.t('frequency.weekly') },
      { value: 'monthly', label: this.translationService.t('frequency.monthly') },
      { value: 'yearly', label: this.translationService.t('frequency.yearly') },
    ];
  }

  get daysOfWeek(): { value: number; label: string }[] {
    return [
      { value: 0, label: this.translationService.t('days.sunday') },
      { value: 1, label: this.translationService.t('days.monday') },
      { value: 2, label: this.translationService.t('days.tuesday') },
      { value: 3, label: this.translationService.t('days.wednesday') },
      { value: 4, label: this.translationService.t('days.thursday') },
      { value: 5, label: this.translationService.t('days.friday') },
      { value: 6, label: this.translationService.t('days.saturday') },
    ];
  }

  daysOfMonth = Array.from({ length: 31 }, (_, i) => i + 1);

  currencies = this.currencyService.currencies;
  categories = signal<Category[]>([]);

  // Computed: filter categories by type
  filteredCategories = computed(() => {
    return this.categories().filter(c =>
      c.type === this.type || c.type === 'both'
    );
  });

  get isEdit(): boolean {
    return !!this.data?.recurring;
  }

  get title(): string {
    return this.translationService.t(this.isEdit ? 'settings.editRecurring' : 'settings.addRecurring');
  }

  get isValid(): boolean {
    return (
      this.name.trim().length > 0 &&
      this.amount !== null &&
      this.amount > 0 &&
      this.categoryId.length > 0 &&
      this.interval > 0
    );
  }

  get showDayOfWeek(): boolean {
    return this.frequencyType === 'weekly';
  }

  get showDayOfMonth(): boolean {
    return this.frequencyType === 'monthly' || this.frequencyType === 'yearly';
  }

  get frequencyPreview(): string {
    const t = this.translationService.t.bind(this.translationService);
    switch (this.frequencyType) {
      case 'daily':
        return this.interval === 1
          ? t('settings.everyDay')
          : t('settings.everyNDays', { n: this.interval });
      case 'weekly': {
        const day = this.daysOfWeek.find(d => d.value === this.dayOfWeek)?.label || '';
        return this.interval === 1
          ? t('settings.everyWeekday', { day })
          : t('settings.everyNWeeksOn', { n: this.interval, day });
      }
      case 'monthly': {
        const day = this.dayOfMonth ?? 1;
        const suffix = this.getDaySuffix(day);
        return this.interval === 1
          ? t('settings.everyMonthOn', { day, suffix })
          : t('settings.everyNMonthsOn', { n: this.interval, day, suffix });
      }
      case 'yearly':
        return this.interval === 1
          ? t('settings.everyYear')
          : t('settings.everyNYears', { n: this.interval });
      default:
        return '';
    }
  }

  ngOnInit(): void {
    this.loadCategories();

    if (this.data?.recurring) {
      this.populateFromRecurring(this.data.recurring);
    }
  }

  private loadCategories(): void {
    this.categoryService.loadCategories().subscribe({
      next: (cats) => this.categories.set(cats)
    });
  }

  private populateFromRecurring(recurring: RecurringTransaction): void {
    this.name = recurring.name;
    this.type = recurring.type;
    this.amount = recurring.amount;
    this.currency = recurring.currency;
    this.categoryId = recurring.categoryId;
    this.description = recurring.description;
    this.frequencyType = recurring.frequency.type;
    this.interval = recurring.frequency.interval;
    this.dayOfWeek = recurring.frequency.dayOfWeek ?? null;
    this.dayOfMonth = recurring.frequency.dayOfMonth ?? 1;
    this.startDate = recurring.startDate.toDate();
    if (recurring.endDate) {
      this.hasEndDate = true;
      this.endDate = recurring.endDate.toDate();
    }
  }

  onTypeChange(): void {
    // Reset category when type changes
    this.categoryId = '';
  }

  onFrequencyTypeChange(): void {
    // Set sensible defaults when frequency type changes
    if (this.frequencyType === 'weekly' && this.dayOfWeek === null) {
      this.dayOfWeek = new Date().getDay();
    }
    if ((this.frequencyType === 'monthly' || this.frequencyType === 'yearly') && this.dayOfMonth === null) {
      this.dayOfMonth = new Date().getDate();
    }
  }

  toggleEndDate(): void {
    this.hasEndDate = !this.hasEndDate;
    if (!this.hasEndDate) {
      this.endDate = null;
    }
  }

  private getDaySuffix(day: number): string {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  save(): void {
    if (!this.isValid || this.amount === null) return;

    const result: CreateRecurringDTO = {
      name: this.name.trim(),
      type: this.type,
      amount: this.amount,
      currency: this.currency,
      categoryId: this.categoryId,
      description: this.description.trim(),
      frequency: {
        type: this.frequencyType,
        interval: this.interval,
        ...(this.frequencyType === 'weekly' && this.dayOfWeek !== null && { dayOfWeek: this.dayOfWeek }),
        ...(this.showDayOfMonth && this.dayOfMonth !== null && { dayOfMonth: this.dayOfMonth }),
      },
      startDate: this.startDate,
      ...(this.hasEndDate && this.endDate && { endDate: this.endDate }),
    };

    this.dialogRef.close(result);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
