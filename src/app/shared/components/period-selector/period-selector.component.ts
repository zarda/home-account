import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, output, signal } from '@angular/core';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CustomPeriod, PeriodOption, PeriodSelection } from '../../../models';
import { periodWindow } from '../../../core/utils/transaction-date.utils';

// The period vocabulary lives in the models barrel so transaction-date.utils
// can resolve a window without importing a component. Re-exported here because
// this is where every consumer already imports it from.
export type { CustomPeriod, PeriodOption, PeriodSelection };

/**
 * The selection every consumer starts from ('This Month', calendar
 * bounds). The selector emits only on user interaction, so parents seed
 * their initial load from this same source of truth.
 */
export function defaultPeriodSelection(): PeriodSelection {
  return {
    option: 'thisMonth',
    ...periodWindow('thisMonth', new Date()),
    label: '',
  };
}

/**
 * One period selector for dashboard + reports (previously ~70 duplicated
 * template lines and two subtly divergent date implementations): quick
 * ranges as a toggle group, plus a custom month/year picker behind a
 * calendar menu, surfaced as a dismissible chip.
 */
@Component({
  selector: 'app-period-selector',
  standalone: true,
  imports: [
    MatButtonToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatMenuModule,
    MatIconModule,
    MatButtonModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './period-selector.component.html',
  styleUrl: './period-selector.component.scss',
})
export class PeriodSelectorComponent {
  private translationService = inject(TranslationService);

  selectionChange = output<PeriodSelection>();

  selectedPeriod = signal<PeriodOption>('thisMonth');
  private customPeriod = signal<CustomPeriod | null>(null);

  isCustomPeriod = computed(() => this.selectedPeriod() === 'custom');

  customPeriodLabel = computed(() => {
    const cp = this.customPeriod();
    if (!cp) return '';
    const locale = this.translationService.getIntlLocale();
    if (cp.type === 'year') {
      return new Date(cp.year, 0, 1).toLocaleDateString(locale, { year: 'numeric' });
    }
    return new Date(cp.year, cp.month!, 1).toLocaleDateString(locale, {
      month: 'short',
      year: 'numeric',
    });
  });

  @ViewChild('monthPicker') monthPicker!: MatDatepicker<Date>;
  @ViewChild('yearPicker') yearPicker!: MatDatepicker<Date>;

  onToggleChange(option: PeriodOption): void {
    this.customPeriod.set(null);
    this.selectedPeriod.set(option);
    this.emitSelection();
  }

  openMonthPicker(): void {
    this.monthPicker.open();
  }

  openYearPicker(): void {
    this.yearPicker.open();
  }

  onMonthSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({ type: 'month', year: date.getFullYear(), month: date.getMonth() });
    this.selectedPeriod.set('custom');
    this.emitSelection();
  }

  onYearSelected(date: Date, picker: MatDatepicker<Date>): void {
    picker.close();
    this.customPeriod.set({ type: 'year', year: date.getFullYear() });
    this.selectedPeriod.set('custom');
    this.emitSelection();
  }

  clearCustomPeriod(): void {
    this.customPeriod.set(null);
    this.selectedPeriod.set('thisMonth');
    this.emitSelection();
  }

  private emitSelection(): void {
    this.selectionChange.emit({
      option: this.selectedPeriod(),
      ...periodWindow(this.selectedPeriod(), new Date(), this.customPeriod()),
      label: this.customPeriodLabel(),
    });
  }
}
