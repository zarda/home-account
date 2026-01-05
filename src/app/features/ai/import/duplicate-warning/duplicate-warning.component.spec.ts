import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { DuplicateWarningComponent, DuplicateInfo } from './duplicate-warning.component';
import { CategorizedImportTransaction, DuplicateCheck } from '../../../../models';

describe('DuplicateWarningComponent', () => {
  let component: DuplicateWarningComponent;
  let fixture: ComponentFixture<DuplicateWarningComponent>;

  const mockTransaction: CategorizedImportTransaction = {
    id: 'txn1',
    description: 'Test Transaction',
    amount: 100,
    currency: 'USD',
    date: new Date(),
    type: 'expense',
    suggestedCategoryId: 'food',
    categoryConfidence: 0.9,
    isDuplicate: true,
    selected: false
  };

  const mockDuplicateCheck: DuplicateCheck = {
    transactionId: 'txn1',
    isDuplicate: true,
    matchType: 'exact',
    existingTransactionId: 'existing1',
    confidence: 1.0
  };

  const mockDuplicates: DuplicateInfo[] = [
    { transaction: mockTransaction, check: mockDuplicateCheck }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DuplicateWarningComponent, NoopAnimationsModule],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(DuplicateWarningComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(DuplicateWarningComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should have empty duplicates array initially', () => {
      expect(component.duplicates).toEqual([]);
    });
  });

  describe('getMatchIcon', () => {
    it('should return error icon for exact match', () => {
      expect(component.getMatchIcon('exact')).toBe('error');
    });

    it('should return warning icon for likely match', () => {
      expect(component.getMatchIcon('likely')).toBe('warning');
    });

    it('should return help icon for possible match', () => {
      expect(component.getMatchIcon('possible')).toBe('help');
    });

    it('should return info icon for unknown match type', () => {
      expect(component.getMatchIcon('none')).toBe('info');
    });
  });

  describe('getMatchLabel', () => {
    it('should return Exact Match for exact type', () => {
      expect(component.getMatchLabel('exact')).toBe('Exact Match');
    });

    it('should return Likely Match for likely type', () => {
      expect(component.getMatchLabel('likely')).toBe('Likely Match');
    });

    it('should return Possible Match for possible type', () => {
      expect(component.getMatchLabel('possible')).toBe('Possible Match');
    });

    it('should return Unknown for unknown match type', () => {
      expect(component.getMatchLabel('none')).toBe('Unknown');
    });
  });

  describe('onExcludeAll', () => {
    it('should emit excludeAll event', () => {
      spyOn(component.excludeAll, 'emit');

      component.onExcludeAll();

      expect(component.excludeAll.emit).toHaveBeenCalled();
    });
  });

  describe('onIncludeAll', () => {
    it('should emit includeAll event', () => {
      spyOn(component.includeAll, 'emit');

      component.onIncludeAll();

      expect(component.includeAll.emit).toHaveBeenCalled();
    });
  });

  describe('with duplicates', () => {
    beforeEach(() => {
      component.duplicates = mockDuplicates;
      fixture.detectChanges();
    });

    it('should have duplicates set', () => {
      expect(component.duplicates.length).toBe(1);
    });

    it('should have correct duplicate info', () => {
      expect(component.duplicates[0].transaction.description).toBe('Test Transaction');
      expect(component.duplicates[0].check.matchType).toBe('exact');
    });
  });
});
