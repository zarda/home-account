import { ChangeDetectionStrategy, Component, ViewChild, computed, inject, output, signal } from '@angular/core';

import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

export type PeriodOption = 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

interface CustomPeriod {
  type: 'month' | 'year';
  year: number;
  month?: number; // 0-11, only for type 'month'
}

/**
 * A resolved period selection. start/end are full calendar boundaries
 * (first day 00:00 to last day 23:59:59); consumers with to-date
 * semantics (e.g. the dashboard's period-over-period deltas) clamp the
 * end themselves.
 */
export interface PeriodSelection {
  option: PeriodOption;
  start: Date;
  end: Date;
  /** Localized label for the selection (custom periods; '' otherwise). */
  label: string;
}

/**
 * The selection every consumer starts from ('This Month', calendar
 * bounds). The selector emits only on user interaction, so parents seed
 * their initial load from this same source of truth.
 */
export function defaultPeriodSelection(): PeriodSelection {
  const now = new Date();
  return {
    option: 'thisMonth',
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
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
    const { start, end } = this.resolveDates();
    this.selectionChange.emit({
      option: this.selectedPeriod(),
      start,
      end,
      label: this.customPeriodLabel(),
    });
  }

  private resolveDates(): { start: Date; end: Date } {
    const now = new Date();
    const cp = this.customPeriod();

    if (this.selectedPeriod() === 'custom' && cp) {
      if (cp.type === 'month') {
        return {
          start: new Date(cp.year, cp.month!, 1),
          end: new Date(cp.year, cp.month! + 1, 0, 23, 59, 59),
        };
      }
      return {
        start: new Date(cp.year, 0, 1),
        end: new Date(cp.year, 11, 31, 23, 59, 59),
      };
    }

    switch (this.selectedPeriod()) {
      case 'lastMonth':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
          end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
        };
      case 'last3Months':
        return {
          start: new Date(now.getFullYear(), now.getMonth() - 2, 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        };
      case 'thisYear':
        return {
          start: new Date(now.getFullYear(), 0, 1),
          end: new Date(now.getFullYear(), 11, 31, 23, 59, 59),
        };
      case 'thisMonth':
      default:
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
        };
    }
  }
}
