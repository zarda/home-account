import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';

import { WeeklyRecapComponent } from './weekly-recap.component';
import { RecapStatus, WeeklyRecapService } from '../../../core/services/weekly-recap.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { ReminderService } from '../../../core/services/reminder.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RecapFigures } from '../../../core/utils/weekly-recap.utils';
import { DateWindow, addDays } from '../../../core/utils/transaction-date.utils';
import { BudgetAlert, Category, RecurringOccurrence } from '../../../models';

/** The week the stubbed service always claims to be recapping. */
const WINDOW: DateWindow = {
  start: new Date(2026, 7, 24),
  end: new Date(2026, 7, 30, 23, 59, 59, 999),
};

function figures(overrides: Partial<RecapFigures> = {}): RecapFigures {
  return {
    spend: 320,
    income: 1000,
    count: 12,
    previousSpend: 400,
    spendDelta: -0.2,
    topCategories: [],
    ...overrides,
  };
}

function alert(overrides: Partial<BudgetAlert> = {}): BudgetAlert {
  return {
    budgetId: 'b1',
    budgetName: 'Groceries',
    percentUsed: 120,
    remaining: 0,
    severity: 'exceeded',
    ...overrides,
  };
}

function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    recurringId: 'r1',
    name: 'Rent',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    categoryId: 'housing',
    date: addDays(new Date(), 2),
    ...overrides,
  };
}

describe('WeeklyRecapComponent', () => {
  let fixture: ComponentFixture<WeeklyRecapComponent>;
  let component: WeeklyRecapComponent;
  let recap: {
    window: ReturnType<typeof signal<DateWindow>>;
    weekKey: ReturnType<typeof signal<string>>;
    figures: ReturnType<typeof signal<RecapFigures | null>>;
    status: ReturnType<typeof signal<RecapStatus>>;
    narrative: ReturnType<typeof signal<string>>;
    narrativeStatus: ReturnType<typeof signal<RecapStatus>>;
    visible: ReturnType<typeof signal<boolean>>;
    load: jasmine.Spy;
    dismiss: jasmine.Spy;
  };
  let currency: jasmine.SpyObj<CurrencyService>;
  let localeFormat: jasmine.SpyObj<LocaleFormatService>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let reminders: jasmine.SpyObj<ReminderService>;
  let router: jasmine.SpyObj<Router>;

  /** The params a translated key was last asked for, or null if never. */
  function paramsFor(key: string): Record<string, string | number> | null {
    const calls = translation.t.calls.all().filter(call => call.args[0] === key);
    return calls.length === 0 ? null : (calls[calls.length - 1].args[1] ?? {});
  }

  function text(selector: string): string {
    return (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? '';
  }

  function render(
    options: { alerts?: BudgetAlert[]; upcoming?: RecurringOccurrence[] } = {}
  ): void {
    fixture.componentRef.setInput('alerts', options.alerts ?? []);
    fixture.componentRef.setInput('upcoming', options.upcoming ?? []);
    fixture.componentRef.setInput('baseCurrency', 'USD');
    fixture.componentRef.setInput(
      'categories',
      new Map<string, Category>([['food', { id: 'food', name: 'categoryNames.food' } as Category]])
    );
    fixture.detectChanges();
  }

  beforeEach(async () => {
    recap = {
      window: signal<DateWindow>(WINDOW),
      weekKey: signal('2026-08-24'),
      figures: signal<RecapFigures | null>(figures()),
      status: signal<RecapStatus>('ready'),
      narrative: signal(''),
      narrativeStatus: signal<RecapStatus>('idle'),
      visible: signal(true),
      load: jasmine.createSpy('load').and.returnValue(Promise.resolve()),
      dismiss: jasmine.createSpy('dismiss'),
    };

    currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'convert']);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);
    currency.convert.and.callFake((amount: number) => amount * 2);

    localeFormat = jasmine.createSpyObj('LocaleFormatService', ['formatRange']);
    localeFormat.formatRange.and.returnValue('24 – 30 Aug 2026');

    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', ['getCategoryName']);
    categoryHelper.getCategoryName.and.callFake((id: string) => `name:${id}`);

    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);
    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    reminders = jasmine.createSpyObj<ReminderService>('ReminderService', ['sweep']);
    reminders.sweep.and.resolveTo();
    router = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [WeeklyRecapComponent, NoopAnimationsModule],
      providers: [
        { provide: WeeklyRecapService, useValue: recap },
        { provide: CurrencyService, useValue: currency },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: ReminderService, useValue: reminders },
        { provide: Router, useValue: router },
        { provide: LocaleFormatService, useValue: localeFormat },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyRecapComponent);
    component = fixture.componentInstance;
  });

  it('asks the service to compose the week once, on init', () => {
    render();
    fixture.detectChanges();

    expect(recap.load).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while the service says the card is not visible', () => {
    recap.visible.set(false);
    render();

    expect(text('.recap-card')).toBe('');
    // Still asked: the gate is the service's, and it needs the composition to
    // decide — a hidden card that never loads never becomes a visible one.
    expect(recap.load).toHaveBeenCalled();
  });

  it('heads the card with the recapped week and the spend', () => {
    render();

    expect(text('.recap-range')).toBe('24 – 30 Aug 2026');
    expect(localeFormat.formatRange).toHaveBeenCalledWith(WINDOW.start, WINDOW.end, 'medium');
    expect(text('.recap-spend')).toContain('USD 320');
  });

  it('names the direction and the size of the change against the week before', () => {
    recap.figures.set(figures({ spendDelta: 0.125 }));
    render();

    expect(text('.recap-delta')).toBe('recap.upVsLastWeek');
    expect(paramsFor('recap.upVsLastWeek')).toEqual({ percent: 13 });
  });

  it('reads a fall as a fall, with an unsigned percentage', () => {
    recap.figures.set(figures({ spendDelta: -0.2 }));
    render();

    expect(text('.recap-delta')).toBe('recap.downVsLastWeek');
    expect(paramsFor('recap.downVsLastWeek')).toEqual({ percent: 20 });
  });

  it('calls a change that rounds away flat rather than a rise of nothing', () => {
    recap.figures.set(figures({ spendDelta: 0.002 }));
    render();

    expect(text('.recap-delta')).toBe('recap.flat');
  });

  it('says there is nothing to compare against when the week before was empty', () => {
    recap.figures.set(figures({ spendDelta: null }));
    render();

    expect(text('.recap-delta')).toBe('recap.noComparison');
  });

  it('names the leading categories and what each cost', () => {
    recap.figures.set(
      figures({
        topCategories: [
          { categoryId: 'food', total: 120, count: 4, share: 0.38 },
          { categoryId: 'transport', total: 60, count: 2, share: 0.19 },
        ],
      })
    );
    render();

    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.recap-category');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('name:food');
    expect(chips[0].textContent).toContain('USD 120');
    expect(chips[1].textContent).toContain('name:transport');
  });

  it('counts the budgets over their thresholds without naming any of them', () => {
    render({ alerts: [alert({ budgetId: 'b1' }), alert({ budgetId: 'b2', severity: 'warning' })] });

    expect(text('.recap-budgets')).toBe('recap.budgetsOver');
    expect(paramsFor('recap.budgetsOver')).toEqual({ count: 2 });
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Groceries');
  });

  it('says the budgets are on track when none has crossed a threshold', () => {
    render({ alerts: [] });

    expect(text('.recap-budgets')).toBe('recap.budgetsOnTrack');
  });

  it('counts the week ahead of bills and converts their net', () => {
    render({
      upcoming: [
        occurrence({ recurringId: 'r1', amount: 100 }),
        occurrence({ recurringId: 'r2', amount: 40, type: 'income', date: addDays(new Date(), 6) }),
      ],
    });

    expect(paramsFor('recap.billsDue')).toEqual({ count: 2 });
    // convert() doubles, so the net is (40 - 100) * 2 — a figure no other
    // number on the card could produce.
    expect(component.billsDueNet()).toBe(-120);
    expect(text('.recap-bills')).toContain('USD 120');
    // The magnitude alone would still pass with the sign dropped — the '-'
    // lives in a sibling span from [showSign].
    expect(text('.recap-bills')).toContain('-');
  });

  it('marks a bills week that nets to income with a plus sign', () => {
    render({ upcoming: [occurrence({ recurringId: 'r1', amount: 20, type: 'income' })] });

    expect(component.billsDueNet()).toBe(40);
    expect(text('.recap-bills')).toContain('+');
  });

  it('leaves occurrences outside the coming week to the upcoming-bills card', () => {
    render({
      upcoming: [
        occurrence({ recurringId: 'overdue', date: addDays(new Date(), -1) }),
        occurrence({ recurringId: 'due', date: addDays(new Date(), 3) }),
        occurrence({ recurringId: 'later', date: addDays(new Date(), 7) }),
      ],
    });

    expect(component.billsDue().map(bill => bill.recurringId)).toEqual(['due']);
  });

  it('stands a placeholder in for the narrative while one is being written', () => {
    recap.narrativeStatus.set('loading');
    render();

    expect(text('.recap-narrative')).toBe('recap.narrativeLoading');
  });

  it('shows the narrative once it lands', () => {
    recap.narrative.set('You spent less than the week before.');
    recap.narrativeStatus.set('ready');
    render();

    expect(text('.recap-narrative')).toBe('You spent less than the week before.');
  });

  it('says so quietly when the narrative could not be written', () => {
    recap.narrativeStatus.set('failed');
    render();

    expect(text('.recap-narrative')).toBe('recap.narrativeUnavailable');
  });

  it('leaves the narrative out entirely when there is none to show', () => {
    recap.narrativeStatus.set('idle');
    render();

    expect(text('.recap-narrative')).toBe('');
  });

  it('labels the card as a region naming the recap title, not a live region', () => {
    render();

    const root = fixture.nativeElement as HTMLElement;
    const card = root.querySelector('.recap-card');
    const title = root.querySelector('.card-title');

    expect(card?.getAttribute('role')).toBe('region');
    expect(title?.id).toBeTruthy();
    expect(card?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(card?.querySelector('[role="status"]')).toBeNull();
    expect(card?.querySelector('[aria-live]')).toBeNull();
  });

  it('announces the card once per appearance, not once per repaint', () => {
    render();
    fixture.detectChanges();

    // The two things that really move under a card already on screen: the
    // preference document landing after the first paint, and the service
    // re-publishing the composition. Either re-runs the announcing effect,
    // and neither is a second sighting.
    fixture.componentRef.setInput('baseCurrency', 'JPY');
    recap.figures.set(figures());
    fixture.detectChanges();

    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('recap.announcement');
  });

  it('hands the recapped week to the transactions page as live filters', () => {
    render();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.recap-see-transactions')
      ?.click();

    expect(pendingFilters.apply).toHaveBeenCalledWith({
      startDate: WINDOW.start,
      endDate: WINDOW.end,
    });
    expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
  });

  it('puts this week away on this device when dismissed', () => {
    render();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.recap-dismiss')
      ?.click();

    expect(recap.dismiss).toHaveBeenCalledTimes(1);
  });

  it('sweeps after the dismissal, so a nudge already booked for the week is retired', () => {
    render();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.recap-dismiss')
      ?.click();

    // Order is the whole point: the sweep reads the dismissed week back out of
    // storage, so one running before the write would re-book what it retires.
    expect(reminders.sweep).toHaveBeenCalledTimes(1);
    expect(recap.dismiss).toHaveBeenCalledBefore(reminders.sweep);
  });
});
