import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { provideAppCharts } from '../../../core/config/chart.config';

import { ForecastComponent } from './forecast.component';
import { RecurringService } from '../../../core/services/recurring.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RecurringOccurrence, RecurringTransaction } from '../../../models';
import { MAX_FORECAST_POINTS } from '../../../core/utils/forecast-series.utils';
import { createTranslationStub } from '../../../core/services/testing';

function tomorrowFor(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
}

function occurrenceFor(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    recurringId: 'r1',
    name: 'Rent',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    categoryId: 'housing_rent',
    date: tomorrowFor(),
    ...overrides
  };
}

describe('ForecastComponent', () => {
  let fixture: ComponentFixture<ForecastComponent>;
  let component: ForecastComponent;
  let mockRecurring: jasmine.SpyObj<RecurringService>;
  let mockCurrency: jasmine.SpyObj<CurrencyService>;
  let activeRules: ReturnType<typeof signal<RecurringTransaction[]>>;
  let occurrenceStreams: Subject<RecurringOccurrence[]>[];

  function tomorrow(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
  }

  function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
    return {
      recurringId: 'r1',
      name: 'Rent',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      categoryId: 'housing_rent',
      date: tomorrow(),
      ...overrides
    };
  }

  beforeEach(async () => {
    occurrenceStreams = [];
    activeRules = signal<RecurringTransaction[]>([{ id: 'r1' } as RecurringTransaction]);

    mockRecurring = jasmine.createSpyObj('RecurringService', ['getNextOccurrences'], {
      activeRecurring: activeRules
    });
    mockRecurring.getNextOccurrences.and.callFake(() => {
      const stream = new Subject<RecurringOccurrence[]>();
      occurrenceStreams.push(stream);
      return stream.asObservable();
    });

    mockCurrency = jasmine.createSpyObj('CurrencyService', [
      'convert',
      'amountInBase',
      'getCurrencyInfo',
      'formatCurrency'
    ]);
    mockCurrency.convert.and.callFake((amount: number) => amount * 2);
    mockCurrency.amountInBase.and.callFake(
      (t: { amount: number }) => t.amount
    );
    mockCurrency.getCurrencyInfo.and.returnValue(undefined);
    mockCurrency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    const mockTranslation = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    mockTranslation.t.and.callFake((key: string) => key);
    mockTranslation.getIntlLocale.and.returnValue('en-US');

    await TestBed.configureTestingModule({
      imports: [ForecastComponent, NoopAnimationsModule],
      providers: [
        provideAppCharts(),
        { provide: RecurringService, useValue: mockRecurring },
        { provide: CurrencyService, useValue: mockCurrency },
        { provide: TranslationService, useValue: mockTranslation }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(ForecastComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(ForecastComponent);
    component = fixture.componentInstance;
    component.currency = 'USD';
    fixture.detectChanges();
  });

  it('zeroes the projection at today', () => {
    occurrenceStreams[0].next([occurrence()]);
    fixture.detectChanges();

    const series = component.series();
    expect(series.projectedCumulative[series.todayIndex]).toBe(0);
  });

  it('converts foreign-currency occurrences into the display currency', () => {
    occurrenceStreams[0].next([occurrence({ currency: 'EUR', amount: 50 })]);

    // The series is a lazy computed; reading it is what runs the conversion.
    const series = component.series();

    expect(mockCurrency.convert).toHaveBeenCalledWith(50, 'EUR', 'USD');
    const last = series.projectedCumulative[series.projectedCumulative.length - 1];
    expect(last).toBe(-100); // 50 doubled by the convert fake, expense sign
  });

  it('resubscribes when the horizon changes and unsubscribes the old stream', () => {
    expect(mockRecurring.getNextOccurrences).toHaveBeenCalledWith(30);
    expect(occurrenceStreams[0].observed).toBeTrue();

    component.setHorizon(60);

    expect(mockRecurring.getNextOccurrences).toHaveBeenCalledWith(60);
    expect(occurrenceStreams[0].observed).toBeFalse();
    expect(occurrenceStreams[1].observed).toBeTrue();
  });

  it('does not resubscribe when the same horizon is picked again', () => {
    component.setHorizon(30);

    expect(mockRecurring.getNextOccurrences).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on destroy', () => {
    fixture.destroy();

    expect(occurrenceStreams[0].observed).toBeFalse();
  });

  it('reports the empty state without active rules', () => {
    activeRules.set([]);
    fixture.detectChanges();

    expect(component.hasRules()).toBeFalse();
  });

  it('bounds the chart and carries the year once the period opened years ago', () => {
    // The case issue #268 was filed about: a past year used to draw one
    // label per day from 1 January 2015 to today plus the horizon.
    component.dateRange = { start: new Date(2015, 0, 1), end: new Date(2015, 11, 31) };
    fixture.detectChanges();

    const labels = component.chartData().labels as string[];

    expect(component.bucketDays()).toBe(30);
    expect(labels.length).toBeLessThanOrEqual(MAX_FORECAST_POINTS);
    // A span this wide repeats months, so the label has to say which year.
    expect(labels[0]).toContain('2015');
  });

  it('leaves a period inside the ceiling at one point per day', () => {
    const now = new Date();
    component.dateRange = {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: now
    };
    fixture.detectChanges();

    expect(component.bucketDays()).toBe(1);
  });

  it('sums the projected net at the horizon', () => {
    occurrenceStreams[0].next([
      occurrence({ amount: 100 }),
      occurrence({ type: 'income', amount: 300 })
    ]);
    fixture.detectChanges();

    // The convert fake doubles both: income 600 minus expense 200.
    expect(component.projectedNet()).toBe(400);
  });
});

/**
 * The cases above override the template to `<div></div>`, so they prove the
 * series arithmetic and never the card: the no-rules empty state, the horizon
 * toggle group (the only control on this card), the canvas the projection is
 * actually drawn on, and the bucket note that explains a folded x-axis.
 *
 * Full render: `provideAppCharts()` is mandatory (docs/performance.md:47-49),
 * and the chart draws on a real canvas headless.
 */
describe('ForecastComponent, through its own template', () => {
  let fixture: ComponentFixture<ForecastComponent>;
  let component: ForecastComponent;
  let rules: ReturnType<typeof signal<RecurringTransaction[]>>;
  let streams: Subject<RecurringOccurrence[]>[];

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const horizonButtons = () =>
    Array.from(el().querySelectorAll('.horizon-toggle mat-button-toggle button')) as HTMLButtonElement[];

  function render(): void {
    fixture.detectChanges();
    streams.forEach(stream => stream.next([occurrenceFor()]));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    streams = [];
    rules = signal<RecurringTransaction[]>([{ id: 'r1' } as RecurringTransaction]);

    const recurring = jasmine.createSpyObj('RecurringService', ['getNextOccurrences'], {
      activeRecurring: rules,
    });
    recurring.getNextOccurrences.and.callFake(() => {
      const stream = new Subject<RecurringOccurrence[]>();
      streams.push(stream);
      return stream.asObservable();
    });

    const currency = jasmine.createSpyObj('CurrencyService', [
      'convert', 'amountInBase', 'getCurrencyInfo', 'formatCurrency',
    ]);
    currency.convert.and.callFake((amount: number) => amount);
    currency.amountInBase.and.callFake((t: { amount: number }) => t.amount);
    currency.getCurrencyInfo.and.returnValue(undefined);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    await TestBed.configureTestingModule({
      imports: [ForecastComponent, NoopAnimationsModule],
      providers: [
        provideAppCharts(),
        { provide: RecurringService, useValue: recurring },
        { provide: CurrencyService, useValue: currency },
        {
          provide: TranslationService,
          useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForecastComponent);
    component = fixture.componentInstance;
    component.currency = 'USD';
  });

  it('offers the empty state, and no chart, when no rule feeds a forecast', () => {
    rules.set([]);
    fixture.detectChanges();

    const empty = el().querySelector('app-empty-state') as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain('reports.forecastNoRulesTitle');
    expect(empty.textContent).toContain('reports.forecastNoRulesBody');
    expect(el().querySelector('canvas')).toBeNull();
    expect(el().querySelector('.horizon-toggle')).toBeNull();
  });

  it('draws the projection on a real canvas, with its note and summary', () => {
    render();

    expect(el().querySelector('app-empty-state')).toBeNull();
    expect(el().querySelector('canvas')).not.toBeNull();
    expect(text('.forecast-note')).toBe('reports.forecastZeroNote');
    expect(text('.forecast-summary'))
      .toBe(`reports.forecastProjectedNet:${JSON.stringify({ amount: component.projectedNetLabel() })}`);
  });

  it('offers one labelled toggle per horizon, with 30 days chosen', () => {
    render();

    expect(horizonButtons().map(b => b.textContent?.trim()))
      .toEqual(['reports.forecastDays30', 'reports.forecastDays60', 'reports.forecastDays90']);
    expect(component.horizon()).toBe(30);
    expect(horizonButtons()[0].getAttribute('aria-checked')).toBe('true');
  });

  it('changes the horizon from the toggle a user clicks', () => {
    render();

    horizonButtons()[2].click();
    fixture.detectChanges();

    expect(component.horizon()).toBe(90);
    expect(horizonButtons()[2].getAttribute('aria-checked')).toBe('true');
    expect(horizonButtons()[0].getAttribute('aria-checked')).toBe('false');
  });

  it('explains a folded axis only when the days are actually bucketed', () => {
    render();
    // A short history plus 30 projected days fits inside MAX_FORECAST_POINTS,
    // so every day is its own point and there is nothing to explain.
    expect(component.bucketDays()).toBe(1);
    expect(el().querySelector('.forecast-bucket-note')).toBeNull();

    // Push history + projection past the point cap so the axis has to fold.
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - MAX_FORECAST_POINTS);
    component.dateRange = { start, end };
    component.setHorizon(90);
    fixture.detectChanges();
    streams.forEach(stream => stream.next([occurrenceFor()]));
    fixture.detectChanges();

    expect(component.bucketDays()).toBeGreaterThan(1);
    expect(text('.forecast-bucket-note'))
      .toBe(`reports.forecastBucketNote:${JSON.stringify({ count: component.bucketDays() })}`);
  });
});
