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
