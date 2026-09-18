import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import { CurrencyService } from '../../../../core/services/currency.service';
import { splitRemainder } from '../../../../core/utils/split-purchase.utils';
import { Category, SplitPart, roundToMinorUnit } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * The parts a purchase is taken apart into (#70).
 *
 * The purchase's own Amount stays the total; each row names a category and
 * an amount taken off it, and whatever is left stays on the purchase's main
 * category — `splitImportRow`'s shape, so the wizard and the form ask for a
 * split the same way. The rows are the whole state: an empty list is not a
 * split, so nothing here demands a remainder until a part exists.
 *
 * The remainder is `splitRemainder`'s, not this component's: the same
 * rounding the service will apply when it writes, so the footer can never
 * promise a figure the write would refuse.
 */
@Component({
  selector: 'app-split-parts',
  standalone: true,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './split-parts.component.html',
  styleUrl: './split-parts.component.scss',
})
export class SplitPartsComponent {
  private currencyService = inject(CurrencyService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);

  readonly categories = input<Category[]>([]);
  readonly currency = input<string>('');
  readonly total = input<number>(0);

  readonly parts = model<SplitPart[]>([]);

  readonly remainder = computed(() => splitRemainder(this.total(), this.parts(), this.currency()));

  /**
   * Whether any row's select is still empty — checked apart from
   * `splitRemainder` so the footer can name which thing is wrong; the amount
   * rule itself stays the one copy, in `splitRemainder` alone.
   */
  readonly missingCategory = computed(() => this.parts().some(part => !part.categoryId.trim()));

  /** The remainder as money, or null while the parts cannot stand. */
  readonly remainderLabel = computed(() => {
    const remainder = this.remainder();
    return remainder === null ? null : this.currencyService.formatCurrency(remainder, this.currency());
  });

  /** A blank field rather than the `0` an empty row's amount really is. */
  amountValue(part: SplitPart): string {
    return part.amount ? String(part.amount) : '';
  }

  addPart(): void {
    this.parts.update(parts => [...parts, { categoryId: '', amount: 0 }]);
    this.focusWhenRendered(`[data-split-row="${this.parts().length - 1}"] mat-select`);
  }

  removePart(index: number): void {
    this.parts.update(parts => parts.filter((_, at) => at !== index));
  }

  setCategory(index: number, categoryId: string): void {
    this.parts.update(parts =>
      parts.map((part, at) => (at === index ? { ...part, categoryId } : part))
    );
  }

  /**
   * Read on change rather than on every keystroke: rounding mid-entry would
   * write the rounded figure back into the field and eat the decimal point
   * the user was still typing. A field that is not a number reads as no
   * amount, which `splitRemainder` refuses like any other unusable part.
   */
  setAmount(index: number, value: string): void {
    const parsed = Number.parseFloat(value);
    const amount = Number.isFinite(parsed) ? roundToMinorUnit(parsed, this.currency()) : 0;
    this.parts.update(parts =>
      parts.map((part, at) => (at === index ? { ...part, amount } : part))
    );
  }

  /**
   * The rows re-render after the add, which is what afterNextRender waits
   * for; registering on a destroyed injector throws NG0911, hence the guard.
   */
  private focusWhenRendered(selector: string): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector }
    );
  }
}
