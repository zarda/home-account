import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';
import { RecentTransactionsComponent } from './recent-transactions.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Transaction } from '../../../models';

describe('RecentTransactionsComponent', () => {
  let component: RecentTransactionsComponent;
  let fixture: ComponentFixture<RecentTransactionsComponent>;
  let categoryHelper: jasmine.SpyObj<CategoryHelperService>;
  let dateFormat: jasmine.SpyObj<DateFormatService>;
  let router: Router;

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
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

  it('delegates category lookups to the helper service', () => {
    expect(component.getCategoryName('c1')).toBe('Food');
    expect(component.getCategoryIcon('c1')).toBe('restaurant');
    expect(component.getCategoryColor('c1')).toBe('#fff');
    expect(categoryHelper.getCategoryName).toHaveBeenCalledWith('c1', jasmine.any(Map));
  });

  it('formats amounts and dates through their services', () => {
    expect(component.formatAmount(20, 'USD')).toBe('USD 20');
    expect(component.formatDate(Timestamp.now())).toBe('2026-06-15');
    expect(component.formatRelativeDate(Timestamp.now())).toBe('today');
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
});
