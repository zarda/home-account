import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { UpcomingBillsComponent } from './upcoming-bills.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { Category, RecurringOccurrence } from '../../../models';

function occurrence(overrides: Partial<RecurringOccurrence> = {}): RecurringOccurrence {
  return {
    recurringId: 'r1',
    name: 'Rent',
    type: 'expense',
    amount: 1200,
    currency: 'USD',
    categoryId: 'housing',
    date: new Date(2026, 8, 1, 9, 0),
    ...overrides,
  };
}

describe('UpcomingBillsComponent', () => {
  let fixture: ComponentFixture<UpcomingBillsComponent>;
  let component: UpcomingBillsComponent;
  let currency: jasmine.SpyObj<CurrencyService>;

  function render(occurrences: RecurringOccurrence[], net = 0): void {
    fixture.componentRef.setInput('occurrences', occurrences);
    fixture.componentRef.setInput('categories', new Map<string, Category>());
    fixture.componentRef.setInput('baseCurrency', 'USD');
    fixture.componentRef.setInput('net', net);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'convert']);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Housing');
    categoryHelper.getCategoryIcon.and.returnValue('home');
    categoryHelper.getCategoryColor.and.returnValue('#123456');

    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [UpcomingBillsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: currency },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        {
          provide: LocaleFormatService,
          useValue: { locale: 'en-US', formatDate: (value: Date) => `day ${value.getDate()}` },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpcomingBillsComponent);
    component = fixture.componentInstance;
  });

  it('groups occurrences by local day, keeping the order they arrive in', () => {
    render([
      occurrence({ recurringId: 'r1', date: new Date(2026, 8, 1, 9, 0) }),
      occurrence({ recurringId: 'r2', date: new Date(2026, 8, 1, 21, 30) }),
      occurrence({ recurringId: 'r3', date: new Date(2026, 8, 4, 8, 0) }),
    ]);

    const days = component.days();
    expect(days.length).toBe(2);
    expect(days[0].key).toBe('2026-09-01');
    expect(days[0].occurrences.map(o => o.recurringId)).toEqual(['r1', 'r2']);
    expect(days[1].key).toBe('2026-09-04');
    expect(days[1].occurrences.map(o => o.recurringId)).toEqual(['r3']);

    expect(fixture.nativeElement.querySelectorAll('.day-group').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.bill-row').length).toBe(3);
  });

  // Two occurrences an hour apart across local midnight belong to different
  // days; a UTC-keyed grouping would fold them together east of Greenwich.
  it('splits a local midnight boundary into two days', () => {
    render([
      occurrence({ recurringId: 'r1', date: new Date(2026, 8, 1, 23, 30) }),
      occurrence({ recurringId: 'r2', date: new Date(2026, 8, 2, 0, 30) }),
    ]);

    expect(component.days().map(d => d.key)).toEqual(['2026-09-01', '2026-09-02']);
  });

  // Future occurrences carry no base-currency snapshot, so the row shows the
  // rule's own figure — converting it here would contradict the rule the user
  // typed in.
  it('renders each row in the rule currency, expenses negative', () => {
    render([
      occurrence({ recurringId: 'r1', type: 'expense', amount: 1200, currency: 'USD' }),
      occurrence({
        recurringId: 'r2',
        type: 'income',
        amount: 380000,
        currency: 'JPY',
        date: new Date(2026, 8, 2, 9, 0),
      }),
    ]);

    expect(currency.formatCurrency).toHaveBeenCalledWith(1200, 'USD');
    expect(currency.formatCurrency).toHaveBeenCalledWith(380000, 'JPY');
    expect(currency.convert).not.toHaveBeenCalled();

    const amounts = fixture.nativeElement.querySelectorAll('.bill-row app-amount-display');
    expect(amounts.length).toBe(2);
    expect(amounts[0].textContent).toContain('USD 1200');
    expect(amounts[1].textContent).toContain('JPY 380000');
  });

  it('shows the window net in the base currency with a sign', () => {
    render([occurrence()], -742.5);

    const footer = fixture.nativeElement.querySelector('.net-footer');
    expect(footer.textContent).toContain('dashboard.upcomingNet');
    expect(footer.textContent).toContain('-');
    expect(currency.formatCurrency).toHaveBeenCalledWith(742.5, 'USD');
  });

  it('shows the empty state and no net footer when nothing is scheduled', () => {
    render([]);

    expect(component.days()).toEqual([]);
    const emptyState = fixture.nativeElement.querySelector('.empty-container app-empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent).toContain('dashboard.noUpcomingBills');
    expect(fixture.nativeElement.querySelector('.net-footer')).toBeNull();
  });

  it('links the header through to the recurring rules', () => {
    render([occurrence()]);

    const link = fixture.nativeElement.querySelector('.view-all-link');
    // The rules live on the Budgets page's second tab, so the bare /budgets
    // route would land on envelopes.
    expect(link.getAttribute('href')).toBe('/budgets?tab=recurring');
    expect(link.textContent).toContain('dashboard.viewAll');
  });
});
