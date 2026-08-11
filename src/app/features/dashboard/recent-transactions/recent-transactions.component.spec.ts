import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { RecentTransactionsComponent } from './recent-transactions.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Transaction } from '../../../models';
import { createUser } from '../../../core/services/testing';
import { parseDayKey } from '../../../core/utils/transaction-date.utils';

describe('RecentTransactionsComponent', () => {
  let component: RecentTransactionsComponent;
  let fixture: ComponentFixture<RecentTransactionsComponent>;
  let categoryHelper: jasmine.SpyObj<CategoryHelperService>;
  let dateFormat: jasmine.SpyObj<DateFormatService>;
  let router: Router;

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName',
      'getCategoryIcon',
      'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Food');
    categoryHelper.getCategoryIcon.and.returnValue('restaurant');
    categoryHelper.getCategoryColor.and.returnValue('#fff');
    dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('2026-06-15');
    dateFormat.formatRelativeDate.and.returnValue('today');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [RecentTransactionsComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser: signal(createUser()) } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecentTransactionsComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // Row anatomy (category chip, amounts, converted line, dates) is covered
  // by the shared TransactionRowComponent spec; here we assert the rows
  // are rendered through it.
  it('renders each transaction through the shared row component', () => {
    fixture.componentRef.setInput('transactions', [
      { id: 't1', description: 'Coffee', amount: 5, currency: 'USD', type: 'expense', categoryId: 'c1', date: Timestamp.now() } as Transaction,
      { id: 't2', description: 'Salary', amount: 100, currency: 'USD', type: 'income', categoryId: 'c1', date: Timestamp.now() } as Transaction,
    ]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('app-transaction-row');
    expect(rows.length).toBe(2);
    expect(categoryHelper.getCategoryName).toHaveBeenCalledWith('c1', jasmine.any(Map));
    expect(dateFormat.formatRelativeDate).toHaveBeenCalled();
  });

  it('onAddTransaction navigates to the transactions page in add mode', () => {
    const navSpy = spyOn(router, 'navigate');
    component.onAddTransaction();
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { action: 'add' } });
  });

  it('onTransactionClick navigates with the local date as a query param', () => {
    const navSpy = spyOn(router, 'navigate');
    const txn = { date: Timestamp.fromDate(new Date(2026, 5, 15)) } as Transaction;
    component.onTransactionClick(txn);
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { date: '2026-06-15' } });
  });

  it('onTransactionClick handles a plain Date value', () => {
    const navSpy = spyOn(router, 'navigate');
    const txn = { date: new Date(2026, 0, 5) } as unknown as Transaction;
    component.onTransactionClick(txn);
    expect(navSpy).toHaveBeenCalledWith(['/transactions'], { queryParams: { date: '2026-01-05' } });
  });

  /**
   * The two halves of the round trip are exact inverses, and only asserting
   * them together catches a drift in either. This side always wrote a local
   * day; the transactions page read it back with `new Date()`, which is UTC,
   * so clicking an evening row west of UTC pre-filtered to the following day.
   */
  it('emits a day the transactions page parses back to the same local day', () => {
    const navSpy = spyOn(router, 'navigate');

    for (const local of [new Date(2026, 5, 15), new Date(2026, 7, 31, 20, 30)]) {
      component.onTransactionClick({ date: Timestamp.fromDate(local) } as Transaction);

      const emitted = navSpy.calls.mostRecent().args[1]!.queryParams!['date'] as string;
      const parsed = parseDayKey(emitted);

      expect(parsed).not.toBeNull();
      expect(parsed!.getFullYear()).toBe(local.getFullYear());
      expect(parsed!.getMonth()).toBe(local.getMonth());
      expect(parsed!.getDate()).toBe(local.getDate());
    }
  });
});
