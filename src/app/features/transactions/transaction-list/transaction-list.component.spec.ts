import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { Sort } from '@angular/material/sort';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { TransactionListComponent } from './transaction-list.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Transaction } from '../../../models';
import { createTransaction } from '../../../core/services/testing';

describe('TransactionListComponent', () => {
  let component: TransactionListComponent;
  let fixture: ComponentFixture<TransactionListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;

  const txns: Transaction[] = [
    createTransaction({ amount: 30, description: 'Banana', date: Timestamp.fromDate(new Date(2026, 0, 2)) }),
    createTransaction({ amount: 10, description: 'Apple', date: Timestamp.fromDate(new Date(2026, 0, 3)) }),
    createTransaction({ amount: 20, description: 'Cherry', date: Timestamp.fromDate(new Date(2026, 0, 1)) }),
  ];

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currency.formatCurrency.and.callFake((a: number, c: string) => `${c} ${a}`);
    const dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    dateFormat.formatDate.and.returnValue('date');
    dateFormat.formatRelativeDate.and.returnValue('rel');
    const categoryHelper = jasmine.createSpyObj('CategoryHelperService', [
      'getCategoryName', 'getCategoryIcon', 'getCategoryColor',
    ]);
    categoryHelper.getCategoryName.and.returnValue('Cat');
    categoryHelper.getCategoryIcon.and.returnValue('icon');
    categoryHelper.getCategoryColor.and.returnValue('#000');
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: currency },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: CategoryHelperService, useValue: categoryHelper },
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('transactions', txns);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('sortedTransactions', () => {
    it('sorts by date descending by default', () => {
      const result = component.sortedTransactions();
      expect(result.map((t) => t.description)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('sorts by amount ascending', () => {
      component.onSortChange({ active: 'amount', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.amount)).toEqual([10, 20, 30]);
    });

    it('sorts by description ascending', () => {
      component.onSortChange({ active: 'description', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('returns the original order for an unknown sort column', () => {
      component.onSortChange({ active: 'unknown', direction: 'asc' } as Sort);
      expect(component.sortedTransactions().map((t) => t.description)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('falls back to descending when direction is cleared', () => {
      component.onSortChange({ active: 'amount', direction: '' } as Sort);
      expect(component.sortedTransactions().map((t) => t.amount)).toEqual([30, 20, 10]);
    });
  });

  it('delegates category and formatting helpers', () => {
    expect(component.getCategoryName('c')).toBe('Cat');
    expect(component.getCategoryIcon('c')).toBe('icon');
    expect(component.getCategoryColor('c')).toBe('#000');
    expect(component.formatAmount(5, 'USD')).toBe('USD 5');
    expect(component.formatDate(Timestamp.now())).toBe('date');
    expect(component.formatRelativeDate(Timestamp.now())).toBe('rel');
  });

  describe('confirmDelete', () => {
    it('emits delete when confirmed', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).toHaveBeenCalledWith(txns[0]);
    });

    it('does not emit when cancelled', () => {
      dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
      const spy = jasmine.createSpy('delete');
      component.delete.subscribe(spy);
      component.confirmDelete(txns[0]);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
