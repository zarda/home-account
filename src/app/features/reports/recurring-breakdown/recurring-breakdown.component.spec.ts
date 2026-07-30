import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { RecurringBreakdownComponent } from './recurring-breakdown.component';
import { Transaction } from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';

describe('RecurringBreakdownComponent', () => {
  let component: RecurringBreakdownComponent;
  let fixture: ComponentFixture<RecurringBreakdownComponent>;
  let convertSpy: jasmine.Spy;

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

  beforeEach(async () => {
    convertSpy = jasmine.createSpy('convert').and.callFake((amount: number) => amount);
    const mockCurrencyService = {
      convert: convertSpy,
    };

    await TestBed.configureTestingModule({
      imports: [RecurringBreakdownComponent, NoopAnimationsModule],
      providers: [{ provide: CurrencyService, useValue: mockCurrencyService }],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(RecurringBreakdownComponent, {
        set: { template: '<div></div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringBreakdownComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('recurring predicate', () => {
    it('counts a row with only recurringId set as recurring', () => {
      component.transactions = [txn({ id: 't1', recurringId: 'rt1', isRecurring: false })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(1);
      expect(component.oneOffCount()).toBe(0);
    });

    it('counts a row with only isRecurring: true as recurring', () => {
      component.transactions = [txn({ id: 't1', isRecurring: true })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(1);
      expect(component.oneOffCount()).toBe(0);
    });

    it('counts a row with neither flag as one-off', () => {
      component.transactions = [txn({ id: 't1', isRecurring: false })];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(0);
      expect(component.oneOffCount()).toBe(1);
    });

    it('excludes income rows from both buckets', () => {
      component.transactions = [
        txn({ id: 't1', type: 'income', isRecurring: true }),
        txn({ id: 't2', type: 'income', recurringId: 'rt1' }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringCount()).toBe(0);
      expect(component.oneOffCount()).toBe(0);
      expect(component.hasExpenses()).toBeFalse();
    });
  });

  describe('shares', () => {
    it('splits shares 30% / 70% for recurring 30 + one-off 70', () => {
      component.transactions = [
        txn({ id: 't1', amount: 30, isRecurring: true }),
        txn({ id: 't2', amount: 70, isRecurring: false }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringTotal()).toBe(30);
      expect(component.oneOffTotal()).toBe(70);
      expect(component.recurringShare()).toBe(30);
      expect(component.oneOffShare()).toBe(70);
    });
  });

  describe('empty states', () => {
    it('is hasRecurring() false with oneOffTotal intact when no recurring expenses exist', () => {
      component.transactions = [
        txn({ id: 't1', amount: 40, isRecurring: false }),
        txn({ id: 't2', amount: 60, isRecurring: false }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.hasRecurring()).toBeFalse();
      expect(component.oneOffTotal()).toBe(100);
      expect(component.hasExpenses()).toBeTrue();
    });

    it('is hasExpenses() false when there are no expenses at all', () => {
      component.transactions = [];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.hasExpenses()).toBeFalse();
    });
  });

  describe('currency conversion', () => {
    it('converts amounts through CurrencyService.convert', () => {
      convertSpy.and.callFake((amount: number) => amount * 2);
      component.transactions = [
        txn({ id: 't1', amount: 50, currency: 'EUR', isRecurring: true }),
      ];
      component.currency = 'USD';
      fixture.detectChanges();

      expect(component.recurringTotal()).toBe(100);
      expect(convertSpy).toHaveBeenCalledWith(50, 'EUR', 'USD');
    });
  });
});
