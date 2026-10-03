import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldDefaultOptions, MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { CategoryHelperService } from '../../../../core/services/category-helper.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { HouseholdBudgetInput } from '../../../../core/services/household-plans.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { BUDGET_ALERT_THRESHOLDS } from '../../../../core/utils/budget-alert.utils';
import { defaultCategories } from '../../../../core/utils/category-merge.utils';
import { isHouseholdBudgetCategory } from '../../../../core/utils/household-plans.utils';
import { defaultBudgetStart } from '../../../../core/utils/transaction-date.utils';
import { BudgetPeriod, HOUSEHOLD_PLAN_CATEGORY_MAX, HOUSEHOLD_PLAN_NAME_LENGTH, HouseholdBudget } from '../../../../models';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { CategoryGlyphPipe } from '../../../../shared/pipes/category-glyph.pipe';
import { writeFailureMessage } from '../../household-failure';
import {
  budgetCategoriesValidator,
  planNameValidator,
  positiveAmountValidator,
  savePlanDialog
} from '../household-plan-form';

export interface HouseholdBudgetDialogData {
  /** The budget edited; none for a new one. */
  budget?: HouseholdBudget;
  /** A new budget's currency until another is picked: the viewer's base. */
  currency: string;
  /**
   * Stores what was entered, resolving once it is stored. A rejection keeps
   * the dialog open with everything entered, and says why.
   */
  save: (input: HouseholdBudgetInput) => Promise<void>;
}

/** One built-in expense category a household budget can count. */
export interface BudgetCategoryOption {
  id: string;
  icon: string;
  color: string;
  /** A group, which counts every category in it. */
  group: boolean;
}

const PERIODS: readonly BudgetPeriod[] = ['weekly', 'monthly', 'yearly'];

/** The percentage of its limit at which a budget warns, when one is given. */
const ALERT_THRESHOLD = { min: 1, max: 100 } as const;

/** An end date, when there is one, on or after the start it is read against. */
function endNotBeforeStart(control: AbstractControl<Date | null>): ValidationErrors | null {
  const end = control.value;
  const start = (control.parent as FormGroup | null)?.get('startDate')?.value as Date | null | undefined;
  return end && start && end.getTime() < start.getTime() ? { endBeforeStart: true } : null;
}

/**
 * Makes or edits one of the household's budgets. Its categories are the
 * built-in expense categories and their groups, the ones every member's
 * rows are counted under whatever each member named or added. Its currency
 * is chosen once, when it is made.
 */
@Component({
  selector: 'app-household-budget-dialog',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
    CategoryGlyphPipe
  ],
  // Each hint and error grows its own field rather than running over the
  // next one; the stylesheet keeps the one-line row Material would reserve.
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { subscriptSizing: 'dynamic' } satisfies MatFormFieldDefaultOptions
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-budget-dialog.component.html',
  styleUrl: '../household-plan-dialog.scss'
})
export class HouseholdBudgetDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<HouseholdBudgetDialogComponent, boolean>>(MatDialogRef);
  readonly data = inject<HouseholdBudgetDialogData>(MAT_DIALOG_DATA);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);
  private readonly categoryHelper = inject(CategoryHelperService);

  readonly editing = !!this.data.budget;
  readonly periods = PERIODS;
  readonly currencies = inject(CurrencyService).getSupportedCurrencies();
  readonly nameMax = HOUSEHOLD_PLAN_NAME_LENGTH.max;
  readonly categoryMax = HOUSEHOLD_PLAN_CATEGORY_MAX;
  readonly thresholdRange = ALERT_THRESHOLD;
  /** Where a budget with no threshold of its own warns, as the section judges it. */
  readonly defaultThreshold = BUDGET_ALERT_THRESHOLDS.warning;

  /**
   * The categories a household budget can count, in the order the app lists
   * them: by the check the budget is judged by, so the list never offers one
   * that its own validator refuses.
   */
  private readonly builtIns = new Map(
    defaultCategories()
      .filter(category => isHouseholdBudgetCategory(category.id))
      .map(category => [category.id, category] as const)
  );

  readonly categories: BudgetCategoryOption[] = [...this.builtIns.values()]
    .map(({ id, icon, color, parentId }) => ({ id, icon, color, group: !parentId }));

  readonly saving = signal(false);

  readonly form = this.buildForm();

  private readonly chosen = signal<readonly string[]>(this.form.controls.categoryIds.value);

  /** Each category's name in the language shown. */
  readonly names = computed(() => {
    this.translation.translationsVersion();
    return new Map(this.categories.map(({ id }) => [id, this.categoryHelper.getCategoryName(id, this.builtIns)] as const));
  });

  /** The chosen categories by name, for the closed select, joined as the language joins a list. */
  readonly chosenNames = computed(() => {
    const names = this.names();
    return this.chosen()
      .map(id => names.get(id) ?? this.categoryHelper.getCategoryName(id, this.builtIns))
      .join(this.translation.t('transactions.share.separator'));
  });

  constructor() {
    const { controls } = this.form;
    const destroyRef = inject(DestroyRef);
    controls.categoryIds.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(ids => this.chosen.set(ids));
    // A new budget's start follows its period until one is chosen; an edited
    // budget keeps the start it counts from.
    controls.period.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(period => {
      if (!this.editing && controls.startDate.pristine) controls.startDate.setValue(defaultBudgetStart(period, new Date()));
    });
    controls.startDate.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe(() =>
      controls.endDate.updateValueAndValidity({ emitEvent: false }));
    // Its check reads the start beside it, which it has only once in the form.
    controls.endDate.updateValueAndValidity({ emitEvent: false });
  }

  clearEndDate(): void {
    this.form.controls.endDate.setValue(null);
  }

  async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    await savePlanDialog(
      this.dialogRef,
      this.saving,
      () => this.data.save({
        name: value.name.trim(),
        categoryIds: value.categoryIds,
        amount: value.amount as number,
        currency: value.currency,
        period: value.period,
        startDate: value.startDate as Date,
        endDate: value.endDate,
        alertThreshold: value.alertThreshold
      }),
      error => this.notification.error(writeFailureMessage(error, key => this.translation.t(key)))
    );
  }

  /** Closes without saving; not while a save is on its way (savePlanDialog). */
  cancel(): void {
    if (!this.saving()) this.dialogRef.close(false);
  }

  private buildForm() {
    const budget = this.data.budget;
    const period: BudgetPeriod = budget?.period ?? 'monthly';
    return new FormGroup({
      name: new FormControl(budget?.name ?? '', { nonNullable: true, validators: planNameValidator }),
      categoryIds: new FormControl<string[]>([...(budget?.categoryIds ?? [])], {
        nonNullable: true,
        validators: budgetCategoriesValidator
      }),
      amount: new FormControl<number | null>(budget?.amount ?? null, positiveAmountValidator),
      currency: new FormControl(
        { value: budget?.currency ?? this.data.currency, disabled: !!budget },
        { nonNullable: true, validators: Validators.required }
      ),
      period: new FormControl<BudgetPeriod>(period, { nonNullable: true }),
      startDate: new FormControl<Date | null>(
        budget ? budget.startDate.toDate() : defaultBudgetStart(period, new Date()),
        Validators.required
      ),
      endDate: new FormControl<Date | null>(budget?.endDate?.toDate() ?? null, endNotBeforeStart),
      alertThreshold: new FormControl<number | null>(budget?.alertThreshold ?? null, [
        Validators.min(ALERT_THRESHOLD.min),
        Validators.max(ALERT_THRESHOLD.max)
      ])
    });
  }
}
