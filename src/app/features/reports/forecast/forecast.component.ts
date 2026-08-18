import { ChangeDetectionStrategy, Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { CurrencyService } from '../../../core/services/currency.service';
import { RecurringService } from '../../../core/services/recurring.service';
import { ChartThemeService } from '../../../core/services/chart-theme.service';
import { TranslationService } from '../../../core/services/translation.service';
import { ForecastSeries, buildForecastSeries } from '../../../core/utils/forecast-series.utils';
import { parseDayKey, toDate } from '../../../core/utils/transaction-date.utils';
import { RecurringOccurrence, Transaction } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

export type ForecastHorizon = 30 | 60 | 90;

/**
 * The Forecast tab: scheduled occurrences blended with the period's actuals
 * into a running-net line. The projection baselines at zero on today — the
 * app has no account-balance concept, so the chart shows change, never a
 * balance (ADR 0022). The dataset split at today's tick is the marker: the
 * solid actual line ends where the dashed projection begins.
 *
 * Lives behind matTabContent like the Insights tab: getNextOccurrences opens
 * a live listener that republishes the shared recurring signal, so it must
 * only exist while the tab does, and the subscription is re-made — old one
 * first closed — whenever the horizon changes.
 */
@Component({
  selector: 'app-forecast',
  standalone: true,
  imports: [
    BaseChartDirective,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    EmptyStateComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forecast.component.html',
  styleUrl: './forecast.component.scss'
})
export class ForecastComponent implements OnInit, OnDestroy {
  private recurringService = inject(RecurringService);
  private currencyService = inject(CurrencyService);
  private chartTheme = inject(ChartThemeService);
  private translationService = inject(TranslationService);

  @Input() set transactions(value: Transaction[]) {
    this._transactions.set(value);
  }

  @Input() set dateRange(value: { start: Date; end: Date }) {
    this._dateRange.set(value);
  }

  @Input() set currency(value: string) {
    this._currency.set(value);
  }

  private _transactions = signal<Transaction[]>([]);
  private _dateRange = signal<{ start: Date; end: Date }>({ start: new Date(), end: new Date() });
  private _currency = signal('USD');

  readonly horizon = signal<ForecastHorizon>(30);
  readonly horizons: ForecastHorizon[] = [30, 60, 90];
  private occurrences = signal<RecurringOccurrence[]>([]);
  private occurrenceSub: Subscription | null = null;

  chartType = 'line' as const;

  /** Active rules arrive through the same listener the occurrences do. */
  readonly hasRules = computed(() => this.recurringService.activeRecurring().length > 0);

  get currencyCode(): string {
    return this._currency();
  }

  ngOnInit(): void {
    this.subscribeOccurrences();
  }

  ngOnDestroy(): void {
    this.occurrenceSub?.unsubscribe();
  }

  setHorizon(days: ForecastHorizon): void {
    if (this.horizon() === days) return;
    this.horizon.set(days);
    this.subscribeOccurrences();
  }

  /**
   * The stream never completes (it is an onSnapshot under the hood), so the
   * previous subscription must be closed before a new window opens — a
   * horizon toggle must swap listeners, not stack them.
   */
  private subscribeOccurrences(): void {
    this.occurrenceSub?.unsubscribe();
    this.occurrenceSub = this.recurringService
      .getNextOccurrences(this.horizon())
      .subscribe(occurrences => this.occurrences.set(occurrences));
  }

  readonly series = computed<ForecastSeries>(() => {
    const currency = this._currency();
    return buildForecastSeries({
      today: new Date(),
      horizonDays: this.horizon(),
      periodStart: this._dateRange().start,
      actuals: this._transactions().map(t => ({
        // Ledger dates are always valid; epoch is a defensive fallback that
        // lands before any period start and so drops out of the window.
        date: toDate(t.date) ?? new Date(0),
        amount: this.currencyService.amountInBase(t, currency),
        type: t.type
      })),
      occurrences: this.occurrences().map(o => ({
        date: o.date,
        amount: this.currencyService.convert(o.amount, o.currency, currency),
        type: o.type
      }))
    });
  });

  /** Net change the schedule adds up to by the end of the horizon. */
  readonly projectedNet = computed(() => {
    const projected = this.series().projectedCumulative;
    for (let i = projected.length - 1; i >= 0; i -= 1) {
      const value = projected[i];
      if (value !== null) return value;
    }
    return 0;
  });

  readonly projectedNetLabel = computed(() =>
    this.currencyService.formatCurrency(this.projectedNet(), this._currency())
  );

  /** Days each plotted point spans; 1 while the period fits the ceiling. */
  readonly bucketDays = computed(() => this.series().bucketDays);

  /**
   * One formatter over at most MAX_FORECAST_POINTS entries — the bucketing is
   * what bounds this. A period opening in 2015 used to format a few thousand
   * labels on every recompute.
   *
   * The year is carried only when the span needs it: a chart that opens and
   * closes in the same calendar year reads better without it repeated on
   * every tick.
   */
  private readonly bucketLabels = computed(() => {
    const ends = this.series().bucketEnds;
    const dates = ends.map(key => parseDayKey(key));
    const years = new Set(dates.map(date => date?.getFullYear()).filter(year => year != null));

    const format = new Intl.DateTimeFormat(this.translationService.getIntlLocale(), {
      month: 'short',
      day: 'numeric',
      ...(years.size > 1 ? { year: 'numeric' as const } : {})
    });
    return dates.map((date, i) => (date ? format.format(date) : ends[i]));
  });

  chartOptions = computed((): ChartConfiguration<'line'>['options'] => {
    const axis = this.chartTheme.axis();
    const palette = this.chartTheme.palette();
    const symbol = this.currencyService.getCurrencyInfo(this._currency())?.symbol
      ?? this._currency();

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: this.chartTheme.animation(),
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: this.chartTheme.legendLabels() },
        tooltip: {
          titleFont: { family: palette.fontFamily },
          bodyFont: { family: palette.fontFamily }
        }
      },
      scales: {
        x: { ...axis },
        y: {
          ...axis,
          ticks: {
            ...axis.ticks,
            callback: value => `${symbol}${Number(value).toLocaleString()}`
          }
        }
      }
    };
  });

  chartData = computed((): ChartData<'line'> => {
    const series = this.series();
    return {
      labels: this.bucketLabels(),
      datasets: [
        {
          label: this.translationService.t('reports.forecastActualSeries'),
          data: series.actualCumulative,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          pointRadius: 0,
          tension: 0.25,
          fill: false
        },
        {
          label: this.translationService.t('reports.forecastProjectedSeries'),
          data: series.projectedCumulative,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0.25,
          fill: false
        }
      ]
    };
  });
}
