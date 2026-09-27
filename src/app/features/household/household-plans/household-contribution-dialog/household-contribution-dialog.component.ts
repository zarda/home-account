import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldDefaultOptions, MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { startOfDay } from '../../../../core/utils/transaction-date.utils';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { writeFailureMessage } from '../../household-failure';
import { positiveAmountValidator, savePlanDialog } from '../household-plan-form';

export interface HouseholdContributionDialogData {
  /** The goal it goes toward, by name. */
  goalName: string;
  /** The goal's currency, which a contribution is entered in. */
  currency: string;
  /**
   * Records the contribution, resolving once it is stored. A rejection keeps
   * the dialog open with what was entered, and says why.
   */
  save: (amount: number, date: Date) => Promise<void>;
}

/** What the viewer puts toward one of the household's goals, in its currency, on a day (today unless chosen). */
@Component({
  selector: 'app-household-contribution-dialog',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
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
  templateUrl: './household-contribution-dialog.component.html',
  styleUrl: '../household-plan-dialog.scss'
})
export class HouseholdContributionDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<HouseholdContributionDialogComponent, boolean>>(MatDialogRef);
  readonly data = inject<HouseholdContributionDialogData>(MAT_DIALOG_DATA);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);

  readonly saving = signal(false);

  readonly form = new FormGroup({
    amount: new FormControl<number | null>(null, positiveAmountValidator),
    date: new FormControl<Date | null>(startOfDay(new Date()), Validators.required)
  });

  async submit(): Promise<void> {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { amount, date } = this.form.getRawValue();
    await savePlanDialog(
      this.dialogRef,
      this.saving,
      () => this.data.save(amount as number, date as Date),
      error => this.notification.error(writeFailureMessage(error, key => this.translation.t(key)))
    );
  }

  /** Closes without saving; not while a save is on its way (savePlanDialog). */
  cancel(): void {
    if (!this.saving()) this.dialogRef.close(false);
  }
}
