import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';

import { CurrencyService } from '../../../core/services/currency.service';
import { readCurrencyCode } from '../../../core/utils/receipt-extraction.utils';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * A currency typed as its ISO 4217 code, for the one the curated pickers do
 * not list. Closes with the code in capitals, or with nothing on cancel.
 *
 * Two checks, in this order. The runtime's own ISO table first
 * (`readCurrencyCode`), so an invented code is refused as not being one
 * rather than as lacking a rate. Then the loaded rate table
 * (`canRepresentCurrency`): a real code no table carries would otherwise be
 * stored and converted 1:1 against the base, through `getExchangeRate`'s
 * `?? 1`, and every total it touched would be wrong without a word.
 */
@Component({
  selector: 'app-currency-code-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatInputModule, MatButtonModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './currency-code-dialog.component.html',
  styleUrl: './currency-code-dialog.component.scss',
})
export class CurrencyCodeDialogComponent {
  private dialogRef = inject<MatDialogRef<CurrencyCodeDialogComponent, string>>(MatDialogRef);
  private currencyService = inject(CurrencyService);

  readonly code = new FormControl('', {
    nonNullable: true,
    validators: control => this.refusal(control.value),
  });
  readonly form = new FormGroup({ code: this.code });

  private refusal(value: string): ValidationErrors | null {
    const code = readCurrencyCode(value);
    if (!code) {
      return { invalidCode: true };
    }
    return this.currencyService.canRepresentCurrency(code) ? null : { noRateYet: { code } };
  }

  confirm(): void {
    // Validated again rather than trusted: the rates can land while the
    // dialog is open, and a code refused a keystroke ago is then fine.
    this.code.updateValueAndValidity();
    if (this.code.invalid) {
      return;
    }
    this.dialogRef.close(readCurrencyCode(this.code.value));
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
