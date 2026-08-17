import {
  BucketDays,
  ForecastEntry,
  MAX_FORECAST_POINTS,
  buildForecastSeries
} from './forecast-series.utils';
import { addDays, dayKey, parseDayKey } from './transaction-date.utils';

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

  /**
   * The fold that keeps a period which opened years ago from drawing one
   * point per day all the way to today (ADR 0054, issue #268).
   */
  describe('bucketing', () => {
    function series(periodStart: Date, horizonDays = 90, actuals: ForecastEntry[] = []) {
      return buildForecastSeries({
        today: TODAY,
        horizonDays,
        periodStart,
        actuals,
        occurrences: []
      });
    }

    it('plots one point per day while the span fits under the ceiling', () => {
      const built = series(PERIOD_START, 30);

      // Seven days of period plus a 30-day horizon: well inside the ceiling,
      // so the fold selects every index and the output is what it was before
      // bucketing existed.
      expect(built.bucketDays).toBe(1);
      expect(built.bucketEnds.length).toBe(37);
    });

    it('steps the ladder as the span grows, and never past the ceiling', () => {
      const rungs: { start: Date; expected: BucketDays }[] = [
        { start: PERIOD_START, expected: 1 },
        { start: new Date(2026, 0, 1), expected: 7 },
        { start: new Date(2015, 0, 1), expected: 30 },
        { start: new Date(1990, 0, 1), expected: 365 }
      ];

      for (const { start, expected } of rungs) {
        const built = series(start);
        expect(built.bucketDays).withContext(`rung for ${dayKey(start)}`).toBe(expected);
        expect(built.bucketEnds.length)
          .withContext(`points for ${dayKey(start)}`)
          .toBeLessThanOrEqual(MAX_FORECAST_POINTS);
      }
    });

    it('caps the period the issue was filed about', () => {
      // Picking 2015 with a 90-day horizon used to draw ~4,300 points.
      const built = series(new Date(2015, 0, 1));

      expect(built.bucketDays).toBe(30);
      expect(built.bucketEnds.length).toBeLessThanOrEqual(MAX_FORECAST_POINTS);
    });

    it('still opens at the period start and closes at today plus the horizon', () => {
      const built = series(new Date(2015, 0, 1));

      // The oldest and newest buckets may be short, but neither end moves:
      // the chart shows the whole span it was asked for, and the last tick
      // is still the seam the occurrence query closes on (ADR 0026).
      expect(built.bucketEnds[0]).toBe('2015-01-01');
      expect(built.bucketEnds[built.bucketEnds.length - 1]).toBe(dayKey(addDays(TODAY, 90)));
    });

    it('lands a boundary exactly on today, so the two datasets still meet', () => {
      const built = series(new Date(2015, 0, 1));

      // ADR 0022's seam: the solid line ends where the dashed one begins.
      // Bucketing walks outward from today precisely to keep this true.
      expect(built.bucketEnds[built.todayIndex]).toBe(dayKey(TODAY));
      expect(built.actualCumulative[built.todayIndex]).not.toBeNull();
      expect(built.projectedCumulative[built.todayIndex]).toBe(0);
      expect(built.actualCumulative[built.todayIndex + 1]).toBeNull();
      expect(built.projectedCumulative[built.todayIndex - 1]).toBeNull();
    });

    it('takes each bucket from its last day rather than averaging it', () => {
      const start = new Date(2026, 0, 1);

      // A 1 January start puts the ladder on the 7-day rung. Read where the
      // boundaries actually fall off an empty series rather than repeating
      // the walk's modular arithmetic here — they are anchored on today, so
      // hand-computing them only duplicates what is under test.
      const empty = series(start, 30);
      expect(empty.bucketDays).toBe(7);

      const closesOn = parseDayKey(empty.bucketEnds[3])!;
      const opensOn = addDays(parseDayKey(empty.bucketEnds[2])!, 1);

      const built = series(start, 30, [income(opensOn, 1000), expense(closesOn, 400)]);
      const closing = built.bucketEnds.indexOf(dayKey(closesOn));

      // 600 is the running total ON the closing day. A mean across the
      // bucket would be ~943, since the +1000 stands for six of its seven
      // days — a number in no day's ledger, which is the whole reason the
      // fold selects rather than aggregates.
      expect(built.actualCumulative[closing]).toBe(600);
      expect(built.actualCumulative[closing - 1]).toBe(0);
    });
  });
});
