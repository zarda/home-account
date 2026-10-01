// What a household plan's dialogs share: the checks they make before
// anything is sent, how a save runs, and the size they open at.

import { WritableSignal } from '@angular/core';
import { AbstractControl, ValidationErrors } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';

import { isAmount, isHouseholdBudgetCategory } from '../../../core/utils/household-plans.utils';
import { HOUSEHOLD_PLAN_CATEGORY_MAX, HOUSEHOLD_PLAN_NAME_LENGTH } from '../../../models';

// Each check below is the one HouseholdPlansService makes, so what a dialog
// lets through the service stores as it was entered; the service still
// judges it, and its refusal is shown as it words it.

/** A name as it is stored: trimmed, and within HOUSEHOLD_PLAN_NAME_LENGTH's min and max. */
export function planNameValidator(control: AbstractControl<string | null>): ValidationErrors | null {
  const name = (control.value ?? '').trim();
  if (name.length < HOUSEHOLD_PLAN_NAME_LENGTH.min) return { required: true };
  if (name.length > HOUSEHOLD_PLAN_NAME_LENGTH.max) return { tooLong: { max: HOUSEHOLD_PLAN_NAME_LENGTH.max } };
  return null;
}

/** An amount above zero; an empty number field reads as null. */
export function positiveAmountValidator(control: AbstractControl<number | null>): ValidationErrors | null {
  const amount = control.value;
  return isAmount(amount) && amount > 0 ? null : { positive: true };
}

/**
 * The categories a household budget counts: one to
 * HOUSEHOLD_PLAN_CATEGORY_MAX, each a built-in expense category or group. A
 * member's own category means nothing to the others, and an income one is
 * never spent.
 */
export function budgetCategoriesValidator(control: AbstractControl<readonly string[] | null>): ValidationErrors | null {
  const ids = control.value ?? [];
  if (ids.length === 0) return { required: true };
  if (!ids.every(isHouseholdBudgetCategory)) return { builtInOnly: true };
  if (new Set(ids).size > HOUSEHOLD_PLAN_CATEGORY_MAX) return { tooMany: { max: HOUSEHOLD_PLAN_CATEGORY_MAX } };
  return null;
}

/**
 * Runs a plan dialog's save, closing the dialog with true once it is stored.
 * While the save is on its way nothing closes the dialog: not Escape or its
 * backdrop (disableClose), and not its Cancel or header close, whose
 * cancel() waits on `saving`. A write that landed after its dialog had gone
 * would be one the section never counts or says. A refusal keeps the dialog
 * open with what was entered, and `refused` says why.
 */
export async function savePlanDialog(
  dialogRef: Pick<MatDialogRef<unknown, boolean>, 'close' | 'disableClose'>,
  saving: WritableSignal<boolean>,
  save: () => Promise<void>,
  refused: (error: unknown) => void
): Promise<void> {
  const closable = dialogRef.disableClose;
  saving.set(true);
  dialogRef.disableClose = true;
  try {
    await save();
    dialogRef.close(true);
  } catch (error) {
    refused(error);
  } finally {
    saving.set(false);
    dialogRef.disableClose = closable;
  }
}

/** The dialog width every plan dialog opens at; the phone's own width below it. */
export const PLAN_DIALOG_CONFIG = { width: '100%', maxWidth: '520px' } as const;
