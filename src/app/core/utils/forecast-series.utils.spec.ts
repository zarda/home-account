import { buildForecastSeries } from './forecast-series.utils';
import { dayKey } from './transaction-date.utils';

describe('forecast-series.utils', () => {
  const TODAY = new Date(2026, 7, 7); // 2026-08-07
  const PERIOD_START = new Date(2026, 7, 1);

  function expense(date: Date, amount: number) {
    return { date, amount, type: 'expense' as const };
  }

  function income(date: Date, amount: number) {
    return { date, amount, type: 'income' as const };
  }

  it('zeroes the projection at today and walks cumulative net after it', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 7,
      periodStart: PERIOD_START,
      actuals: [],
      occurrences: [income(new Date(2026, 7, 10), 1000), expense(new Date(2026, 7, 12), 300)]
    });

    expect(series.bucketEnds[series.todayIndex]).toBe('2026-08-07');
    expect(series.projectedCumulative[series.todayIndex]).toBe(0);
    // 10th: +1000; 12th: -300 on top.
    expect(series.projectedCumulative[series.bucketEnds.indexOf('2026-08-10')]).toBe(1000);
    expect(series.projectedCumulative[series.bucketEnds.indexOf('2026-08-12')]).toBe(700);
    expect(series.projectedCumulative[series.bucketEnds.indexOf('2026-08-14')]).toBe(700);
  });

  it('runs actuals cumulatively from the period start up to today, null after', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 3,
      periodStart: PERIOD_START,
      actuals: [income(new Date(2026, 7, 2), 500), expense(new Date(2026, 7, 5), 200)],
      occurrences: []
    });

    expect(series.bucketEnds[0]).toBe('2026-08-01');
    expect(series.actualCumulative[0]).toBe(0);
    expect(series.actualCumulative[series.bucketEnds.indexOf('2026-08-02')]).toBe(500);
    expect(series.actualCumulative[series.bucketEnds.indexOf('2026-08-05')]).toBe(300);
    expect(series.actualCumulative[series.todayIndex]).toBe(300);
    expect(series.actualCumulative[series.todayIndex + 1]).toBeNull();
    // And the projection is null before today.
    expect(series.projectedCumulative[series.todayIndex - 1]).toBeNull();
  });

  it('aggregates several occurrences on the same day', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 5,
      periodStart: PERIOD_START,
      actuals: [],
      occurrences: [
        expense(new Date(2026, 7, 9), 100),
        expense(new Date(2026, 7, 9), 50),
        income(new Date(2026, 7, 9), 20)
      ]
    });

    expect(series.projectedCumulative[series.bucketEnds.indexOf('2026-08-09')]).toBe(-130);
  });

  it('drops occurrences on or before today — the catch-up engine posts those', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 5,
      periodStart: PERIOD_START,
      actuals: [],
      occurrences: [expense(new Date(2026, 7, 7), 999), expense(new Date(2026, 7, 5), 999)]
    });

    expect(series.projectedCumulative.every(v => v === null || v === 0)).toBeTrue();
  });

  it('drops occurrences past the horizon', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 3,
      periodStart: PERIOD_START,
      actuals: [],
      occurrences: [expense(new Date(2026, 7, 20), 999)]
    });

    expect(series.bucketEnds[series.bucketEnds.length - 1]).toBe('2026-08-10');
    expect(series.projectedCumulative[series.bucketEnds.length - 1]).toBe(0);
  });

  it('is flat at zero with no rules at all', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 2,
      periodStart: PERIOD_START,
      actuals: [],
      occurrences: []
    });

    expect(series.projectedCumulative[series.bucketEnds.length - 1]).toBe(0);
  });

  it('spans DST transitions without duplicating or skipping a day', () => {
    // US spring-forward 2026: March 8.
    const march = buildForecastSeries({
      today: new Date(2026, 2, 6),
      horizonDays: 5,
      periodStart: new Date(2026, 2, 1),
      actuals: [],
      occurrences: []
    });
    expect(march.bucketEnds).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
      '2026-03-11'
    ]);

    // US fall-back 2026: November 1.
    const november = buildForecastSeries({
      today: new Date(2026, 9, 30),
      horizonDays: 4,
      periodStart: new Date(2026, 9, 28),
      actuals: [],
      occurrences: []
    });
    expect(november.bucketEnds).toEqual([
      '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
      '2026-11-01', '2026-11-02', '2026-11-03'
    ]);
  });

  it('starts at today when the period begins in the future', () => {
    const series = buildForecastSeries({
      today: TODAY,
      horizonDays: 2,
      periodStart: new Date(2026, 8, 1),
      actuals: [],
      occurrences: []
    });

    expect(series.bucketEnds[0]).toBe(dayKey(TODAY));
    expect(series.todayIndex).toBe(0);
  });
});
