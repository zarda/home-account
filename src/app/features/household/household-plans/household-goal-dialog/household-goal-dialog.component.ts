import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldDefaultOptions, MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { CurrencyService } from '../../../../core/services/currency.service';
import { HouseholdGoalInput } from '../../../../core/services/household-plans.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { HOUSEHOLD_PLAN_NAME_LENGTH, HouseholdGoal } from '../../../../models';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { writeFailureMessage } from '../../household-failure';
import { planNameValidator, positiveAmountValidator, savePlanDialog } from '../household-plan-form';

export interface HouseholdGoalDialogData {
  /** The goal edited; none for a new one. */
  goal?: HouseholdGoal;
  /** A new goal's currency until another is picked: the viewer's base. */
  currency: string;
  /**
   * Stores what was entered, resolving once it is stored. A rejection keeps
   * the dialog open with everything entered, and says why.
   */
  save: (input: HouseholdGoalInput) => Promise<void>;
}

/**
 * Makes or edits one of the household's goals: a name, a target in the
 * currency its contributions are entered in, chosen once when it is made,
 * and a target date if it has one.
 */
@Component({
  selector: 'app-household-goal-dialog',
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
    TranslatePipe
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
  templateUrl: './household-goal-dialog.component.html',
  styleUrl: '../household-plan-dialog.scss'
})
export class HouseholdGoalDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<HouseholdGoalDialogComponent, boolean>>(MatDialogRef);
  readonly data = inject<HouseholdGoalDialogData>(MAT_DIALOG_DATA);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);

  readonly editing = !!this.data.goal;
  readonly currencies = inject(CurrencyService).getSupportedCurrencies();
  readonly nameMax = HOUSEHOLD_PLAN_NAME_LENGTH.max;

  readonly saving = signal(false);

  readonly form = new FormGroup({
    name: new FormControl(this.data.goal?.name ?? '', { nonNullable: true, validators: planNameValidator }),
    targetAmount: new FormControl<number | null>(this.data.goal?.targetAmount ?? null, positiveAmountValidator),
    currency: new FormControl(
      { value: this.data.goal?.currency ?? this.data.currency, disabled: this.editing },
      { nonNullable: true, validators: Validators.required }
    ),
    targetDate: new FormControl<Date | null>(this.data.goal?.targetDate?.toDate() ?? null)
  });

  clearTargetDate(): void {
    this.form.controls.targetDate.setValue(null);
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
        targetAmount: value.targetAmount as number,
        currency: value.currency,
        targetDate: value.targetDate
      }),
      error => this.notification.error(writeFailureMessage(error, key => this.translation.t(key)))
    );
  }

  /** Closes without saving; not while a save is on its way (savePlanDialog). */
  cancel(): void {
    if (!this.saving()) this.dialogRef.close(false);
  }
}
