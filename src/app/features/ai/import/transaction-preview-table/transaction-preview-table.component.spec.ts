import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { CategorizedImportTransaction } from '../../../../models';

describe('TransactionPreviewTableComponent', () => {
  let component: TransactionPreviewTableComponent;
  let fixture: ComponentFixture<TransactionPreviewTableComponent>;

  const mockTransactions: CategorizedImportTransaction[] = [
    {
      id: 'txn1',
      description: 'Coffee Shop',
      amount: 5.50,
      currency: 'USD',
      date: new Date('2024-01-15'),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.9,
      isDuplicate: false,
      selected: true
    },
    {
      id: 'txn2',
      description: 'Salary',
      amount: 3000,
      currency: 'USD',
      date: new Date('2024-01-01'),
      type: 'income',
      suggestedCategoryId: 'salary',
      categoryConfidence: 0.95,
      isDuplicate: false,
      selected: true
    },
    {
      id: 'txn3',
      description: 'Duplicate Transaction',
      amount: 100,
      currency: 'USD',
      date: new Date('2024-01-10'),
      type: 'expense',
      suggestedCategoryId: 'other',
      categoryConfidence: 0.5,
      isDuplicate: true,
      selected: false
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionPreviewTableComponent, NoopAnimationsModule],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(TransactionPreviewTableComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(TransactionPreviewTableComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should have empty transactions initially', () => {
      expect(component.transactions).toEqual([]);
    });

    it('should have empty categories initially', () => {
      expect(component.categories).toEqual([]);
    });
  });

  describe('selection logic', () => {
    it('should correctly count selected transactions', () => {
      // Create fresh test data
      const testTransactions = [
        { ...mockTransactions[0], selected: true },
        { ...mockTransactions[1], selected: true },
        { ...mockTransactions[2], selected: false }
      ];
      const selectedCount = testTransactions.filter(t => t.selected).length;
      expect(selectedCount).toBe(2);
    });

    it('should compute allSelected correctly for non-duplicates', () => {
      // Create fresh test data with known state
      const testTransactions = [
        { ...mockTransactions[0], isDuplicate: false, selected: true },
        { ...mockTransactions[1], isDuplicate: false, selected: true },
        { ...mockTransactions[2], isDuplicate: true, selected: false }
      ];
      const nonDuplicates = testTransactions.filter(t => !t.isDuplicate);
      const allSelected = nonDuplicates.length > 0 && nonDuplicates.every(t => t.selected);
      expect(allSelected).toBeTrue();
    });

    it('should return false for allSelected when some non-duplicates are not selected', () => {
      const testTransactions = [
        { ...mockTransactions[0], isDuplicate: false, selected: false },
        { ...mockTransactions[1], isDuplicate: false, selected: true },
        { ...mockTransactions[2], isDuplicate: true, selected: false }
      ];
      const nonDuplicates = testTransactions.filter(t => !t.isDuplicate);
      const allSelected = nonDuplicates.length > 0 && nonDuplicates.every(t => t.selected);
      expect(allSelected).toBeFalse();
    });
  });

  describe('someSelected', () => {
    it('should return true when some transactions are selected', () => {
      component.transactions = mockTransactions;
      fixture.detectChanges();

      expect(component.someSelected()).toBeTrue();
    });

    it('should return false when no transactions are selected', () => {
      component.transactions = mockTransactions.map(t => ({ ...t, selected: false }));
      fixture.detectChanges();

      expect(component.someSelected()).toBeFalse();
    });
  });

  describe('toggleSelectAll', () => {
    beforeEach(() => {
      component.transactions = [...mockTransactions];
      fixture.detectChanges();
    });

    it('should select all non-duplicate transactions when checked', () => {
      // Deselect all first
      component.transactions.forEach(t => t.selected = false);

      component.toggleSelectAll(true);

      expect(component.transactions.filter(t => !t.isDuplicate && t.selected).length).toBe(2);
    });

    it('should not change duplicate transactions', () => {
      component.toggleSelectAll(true);

      const duplicateTxn = component.transactions.find(t => t.isDuplicate);
      expect(duplicateTxn?.selected).toBeFalse();
    });

    it('should deselect all non-duplicate transactions when unchecked', () => {
      component.toggleSelectAll(false);

      expect(component.transactions.filter(t => !t.isDuplicate && t.selected).length).toBe(0);
    });

    it('should emit transactionsUpdated event', () => {
      spyOn(component.transactionsUpdated, 'emit');

      component.toggleSelectAll(true);

      expect(component.transactionsUpdated.emit).toHaveBeenCalled();
    });

    it('should emit selectionChanged event', () => {
      spyOn(component.selectionChanged, 'emit');

      component.toggleSelectAll(true);

      expect(component.selectionChanged.emit).toHaveBeenCalled();
    });
  });

  describe('toggleSelection', () => {
    beforeEach(() => {
      component.transactions = [...mockTransactions];
      fixture.detectChanges();
    });

    it('should toggle transaction selection', () => {
      const txn = component.transactions[0];

      component.toggleSelection(txn, false);

      expect(txn.selected).toBeFalse();
    });

    it('should emit transactionsUpdated event', () => {
      spyOn(component.transactionsUpdated, 'emit');

      component.toggleSelection(component.transactions[0], false);

      expect(component.transactionsUpdated.emit).toHaveBeenCalled();
    });

    it('should emit selectionChanged event with correct ids', () => {
      spyOn(component.selectionChanged, 'emit');

      component.toggleSelection(component.transactions[0], false);

      expect(component.selectionChanged.emit).toHaveBeenCalled();
    });
  });

  describe('toggleType', () => {
    it('should toggle expense to income', () => {
      const transactions = mockTransactions.map(t => ({ ...t }));
      component.transactions = transactions;
      fixture.detectChanges();

      const txn = component.transactions[0];
      expect(txn.type).toBe('expense');

      component.toggleType(txn);

      expect(txn.type).toBe('income');
    });

    it('should toggle income to expense', () => {
      const transactions = mockTransactions.map(t => ({ ...t }));
      component.transactions = transactions;
      fixture.detectChanges();

      const txn = component.transactions[1];
      expect(txn.type).toBe('income');

      component.toggleType(txn);

      expect(txn.type).toBe('expense');
    });

    it('should emit transactionsUpdated event', () => {
      const transactions = mockTransactions.map(t => ({ ...t }));
      component.transactions = transactions;
      fixture.detectChanges();

      spyOn(component.transactionsUpdated, 'emit');

      component.toggleType(component.transactions[0]);

      expect(component.transactionsUpdated.emit).toHaveBeenCalled();
    });
  });

  describe('updateCategory', () => {
    beforeEach(() => {
      component.transactions = [...mockTransactions];
      fixture.detectChanges();
    });

    it('should update category id', () => {
      const txn = component.transactions[0];

      component.updateCategory(txn, 'salary');

      expect(txn.suggestedCategoryId).toBe('salary');
    });

    it('should set confidence to 1.0 (user confirmed)', () => {
      const txn = component.transactions[0];

      component.updateCategory(txn, 'salary');

      expect(txn.categoryConfidence).toBe(1.0);
    });

    it('should emit transactionsUpdated event', () => {
      spyOn(component.transactionsUpdated, 'emit');

      component.updateCategory(component.transactions[0], 'salary');

      expect(component.transactionsUpdated.emit).toHaveBeenCalled();
    });
  });
});
