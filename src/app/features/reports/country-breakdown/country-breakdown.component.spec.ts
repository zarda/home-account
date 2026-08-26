import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { CountryBreakdownComponent } from './country-breakdown.component';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    userId: 'user1',
    type: 'expense',
    amount: 100,
    amountInBaseCurrency: 100,
    exchangeRate: 1,
    currency: 'USD',
    categoryId: 'cat1',
    description: 'Test transaction',
    date: Timestamp.fromDate(new Date(2024, 5, 15)),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    isRecurring: false,
    ...overrides,
  };
}

const inCountry = (amount: number, country?: string) =>
  txn({ amount, ...(country ? { location: { country } } : {}) });

describe('CountryBreakdownComponent', () => {
  let component: CountryBreakdownComponent;
  let fixture: ComponentFixture<CountryBreakdownComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CountryBreakdownComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: { convert: (amount: number) => amount } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(CountryBreakdownComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(CountryBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('ranks countries by what they cost, largest first', () => {
    component.transactions = [inCountry(10, 'JP'), inCountry(30, 'KR'), inCountry(5, 'JP')];

    expect(component.rows().map(r => r.country)).toEqual(['KR', 'JP']);
    expect(component.rows()[0].total).toBe(30);
    expect(component.rows()[1].count).toBe(2);
  });

  it('shares each row against the placed spend, not the whole period', () => {
    // The unplaced rows are reported as coverage instead. Dividing by the
    // period total would make every share shrink as unplaced history grows,
    // which says nothing about the trip.
    component.transactions = [inCountry(30, 'KR'), inCountry(10, 'JP'), inCountry(60)];

    const shares = component.rows().map(r => Math.round(r.share));
    expect(shares).toEqual([75, 25]);
  });

  it('reports how much of the period the ranking speaks for', () => {
    component.transactions = [inCountry(10, 'KR'), inCountry(5), inCountry(5)];

    expect(component.placed()).toBe(1);
    expect(component.expenses()).toBe(3);
  });

  it('caps the list and counts the remainder', () => {
    const codes = ['KR', 'JP', 'DE', 'FR', 'IT', 'ES', 'GB', 'US', 'CA', 'AU'];
    component.transactions = codes.map((c, i) => inCountry(100 - i, c));

    expect(component.rows().length).toBe(8);
    expect(component.remainderCount()).toBe(2);
  });

  it('counts no remainder when everything fits', () => {
    component.transactions = [inCountry(10, 'KR'), inCountry(5, 'JP')];

    expect(component.remainderCount()).toBe(0);
  });

  it('has nothing to rank when no expense records a country', () => {
    component.transactions = [inCountry(10), inCountry(5)];

    expect(component.hasCountries()).toBeFalse();
    expect(component.hasExpenses()).toBeTrue();
  });

  it('hides itself entirely for a period with no expenses', () => {
    component.transactions = [txn({ type: 'income', amount: 500 })];

    expect(component.hasExpenses()).toBeFalse();
  });

  it('divides by nothing for an empty period', () => {
    component.transactions = [];

    expect(component.rows()).toEqual([]);
    expect(component.placed()).toBe(0);
    expect(component.expenses()).toBe(0);
  });
});

describe('CountryBreakdownComponent, through its own template', () => {
  let fixture: ComponentFixture<CountryBreakdownComponent>;
  let component: CountryBreakdownComponent;
  let locale: ReturnType<typeof signal<string>>;

  beforeEach(async () => {
    locale = signal('en');
    const translation = {
      currentLocale: locale,
      getIntlLocale: () => (locale() === 'ja' ? 'ja-JP' : 'en-US'),
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    };

    await TestBed.configureTestingModule({
      imports: [CountryBreakdownComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: { convert: (amount: number) => amount } },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CountryBreakdownComponent);
    component = fixture.componentInstance;
  });

  const labels = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.row-label') as NodeListOf<HTMLElement>)
      .map(el => el.textContent!.trim());

  it('renders a row per country, largest first', () => {
    component.transactions = [inCountry(10, 'JP'), inCountry(30, 'KR')];
    fixture.detectChanges();

    expect(labels().length).toBe(2);
    expect(labels()[0]).toContain('South Korea');
    expect(labels()[1]).toContain('Japan');
  });

  it('names the country in the active locale', () => {
    // The reason the code is stored and the name resolved at render.
    locale.set('ja');
    component.transactions = [inCountry(30, 'KR')];
    fixture.detectChanges();

    expect(labels()[0]).toContain('韓国');
  });

  it('shows the empty state naming why nothing is recorded yet', () => {
    // Not a bare "no data": the card is empty on every existing account, and
    // saying so is the honest consequence of there being no backfill.
    component.transactions = [inCountry(10), inCountry(5)];
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('app-empty-state');
    expect(empty).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.row-label')).toBeNull();
  });

  it('renders nothing at all for a period with no expenses', () => {
    component.transactions = [txn({ type: 'income', amount: 500 })];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
  });

  it('shows the coverage figure', () => {
    component.transactions = [inCountry(10, 'KR'), inCountry(5), inCountry(5)];
    fixture.detectChanges();

    const coverage = fixture.nativeElement.querySelector('.coverage') as HTMLElement;
    expect(coverage.textContent).toContain('"placed":1');
    expect(coverage.textContent).toContain('"count":3');
  });
});
