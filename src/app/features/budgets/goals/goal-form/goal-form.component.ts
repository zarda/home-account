import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

import { AuthService } from '../../../../core/services/auth.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { itemsTotal } from '../../../../core/utils/goal-progress.utils';
import { CreateGoalDTO, Goal, GoalItem, GoalKind, baseCurrencyOf } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';

export interface GoalFormDialogData {
  mode: 'add' | 'edit';
  goal?: Goal;
}

/**
 * Create/edit form for a goal. Pure form: it closes with the CreateGoalDTO
 * and the caller talks to the service, the same contract the recurring
 * dialog uses. Item rows carry their done flags through an edit untouched —
 * checking off items happens on the card, not here.
 */
@Component({
  selector: 'app-goal-form',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './goal-form.component.html',
  styleUrl: './goal-form.component.scss'
})
export class GoalFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<GoalFormComponent>);
  data: GoalFormDialogData = inject(MAT_DIALOG_DATA);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);

  form!: FormGroup;
  isSubmitting = signal(false);

  currencies = this.currencyService.getSupportedCurrencies();

  get kinds(): { value: GoalKind; label: string }[] {
    return [
      { value: 'saving', label: this.translationService.t('goal.kindSaving') },
      { value: 'project', label: this.translationService.t('goal.kindProject') }
    ];
  }

  ngOnInit(): void {
    const goal = this.data.goal;

    this.form = this.fb.group({
      kind: [goal?.kind ?? 'saving', Validators.required],
      name: [goal?.name ?? '', Validators.required],
      targetAmount: [goal?.targetAmount ?? '', [Validators.required, Validators.min(0.01)]],
      currency: [
        goal?.currency ?? baseCurrencyOf(this.authService.currentUser()),
        Validators.required
      ],
      targetDate: [goal?.targetDate?.toDate() ?? null],
      note: [goal?.note ?? ''],
      items: this.fb.array((goal?.items ?? []).map(item => this.itemGroup(item)))
    });
  }

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  private itemGroup(item?: GoalItem): FormGroup {
    return this.fb.group({
      name: [item?.name ?? '', Validators.required],
      amount: [item?.amount ?? '', [Validators.required, Validators.min(0)]],
      done: [item?.done ?? false]
    });
  }

  addItem(): void {
    this.items.push(this.itemGroup());
  }

  removeItem(index: number): void {
    this.items.removeAt(index);
  }

  /** Copy the checklist total into the target — a shortcut, never a link. */
  useItemsTotal(): void {
    const rows = this.items.getRawValue() as GoalItem[];
    this.form.patchValue({ targetAmount: itemsTotal(rows) });
  }

  clearTargetDate(): void {
    this.form.patchValue({ targetDate: null });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue() as {
      kind: GoalKind;
      name: string;
      targetAmount: number;
      currency: string;
      targetDate: Date | null;
      note: string;
      items: GoalItem[];
    };

    const dto: CreateGoalDTO = {
      kind: value.kind,
      name: value.name.trim(),
      targetAmount: value.targetAmount,
      currency: value.currency
    };

    if (value.targetDate) {
      dto.targetDate = value.targetDate;
    } else if (this.data.mode === 'edit' && this.data.goal?.targetDate) {
      // A stored date the user cleared: null tells the service to delete it.
      dto.targetDate = null;
    }

    if (value.items.length > 0) {
      dto.items = value.items;
    } else if (this.data.mode === 'edit' && (this.data.goal?.items?.length ?? 0) > 0) {
      // Every row removed on edit: replace the stored list with nothing.
      dto.items = [];
    }

    const note = value.note.trim();
    if (note) {
      dto.note = note;
    }

    this.dialogRef.close(dto);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
