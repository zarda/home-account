import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { DuplicateWarningComponent, DuplicateInfo } from './duplicate-warning.component';
import { CategorizedImportTransaction, DuplicateCheck } from '../../../../models';
import en from '../../../../../assets/i18n/en.json';
import ja from '../../../../../assets/i18n/ja.json';
import tc from '../../../../../assets/i18n/tc.json';

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

  describe('getMatchLabelKey', () => {
    const matchTypes: DuplicateCheck['matchType'][] = ['exact', 'likely', 'possible', 'none'];

    it('maps each match type to its own key', () => {
      const keys = matchTypes.map(t => component.getMatchLabelKey(t));
      expect(keys).toEqual([
        'import.matchExact',
        'import.matchLikely',
        'import.matchPossible',
        'import.matchUnknown',
      ]);
    });

    it('resolves every key in every locale', () => {
      // These labels were hard-coded English until now. The keys are looked up
      // dynamically, so check-i18n.mjs cannot see them — its regex only matches
      // a literal key next to the translate pipe. This assertion is the only
      // thing standing between a renamed key and a raw 'import.matchExact'
      // rendering in the UI.
      for (const locale of [en, ja, tc]) {
        for (const type of matchTypes) {
          const leaf = component.getMatchLabelKey(type).split('.')[1];
          const value = (locale.import as Record<string, string>)[leaf];
          expect(value)
            .withContext(`${component.getMatchLabelKey(type)} is missing or empty`)
            .toBeTruthy();
        }
      }
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
