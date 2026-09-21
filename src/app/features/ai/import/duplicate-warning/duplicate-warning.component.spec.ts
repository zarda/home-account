import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { DuplicateWarningComponent, DuplicateInfo } from './duplicate-warning.component';
import { CategorizedImportTransaction, DuplicateCheck } from '../../../../models';
import en from '../../../../../assets/i18n/en.json';
import ja from '../../../../../assets/i18n/ja.json';
import tc from '../../../../../assets/i18n/tc.json';
import { TranslationService } from '../../../../core/services/translation.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { createTranslationStub, createLocaleFormatStub } from '../../../../core/services/testing';

const mockDuplicateCheck: DuplicateCheck = {
  transactionId: 'txn1',
  isDuplicate: true,
  matchType: 'exact',
  existingTransactionId: 'existing1',
  confidence: 1.0
};

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

    it('should return the recurring icon for a posted occurrence', () => {
      expect(component.getMatchIcon('recurring_occurrence')).toBe('autorenew');
    });

    it('should return info icon for unknown match type', () => {
      expect(component.getMatchIcon('none')).toBe('info');
    });
  });

  describe('getMatchLabelKey', () => {
    const matchTypes: DuplicateCheck['matchType'][] =
      ['exact', 'likely', 'possible', 'recurring_occurrence', 'none'];

    it('maps each match type to its own key', () => {
      const keys = matchTypes.map(t => component.getMatchLabelKey(t));
      expect(keys).toEqual([
        'import.matchExact',
        'import.matchLikely',
        'import.matchPossible',
        'import.matchRecurringOccurrence',
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
          const value = (locale.import as Record<string, unknown>)[leaf];
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

/**
 * The cases above override the template to `<div></div>`, so the outer
 * `@if (duplicates.length > 0)` gate, the panel header's pluralised count,
 * the per-row icon and label the two mapping functions feed, the sign on the
 * amount and the two action buttons are all unproven by them. `getMatchIcon`
 * and `getMatchLabelKey` are tested as functions; this is the one place their
 * output actually reaches the DOM.
 */
describe('DuplicateWarningComponent, through its own template', () => {
  let fixture: ComponentFixture<DuplicateWarningComponent>;
  let component: DuplicateWarningComponent;

  function txn(overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction {
    return {
      id: 'txn1',
      description: 'Coffee Shop',
      amount: 12.5,
      currency: 'USD',
      date: new Date('2026-03-04T00:00:00Z'),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.9,
      isDuplicate: true,
      selected: false,
      ...overrides,
    };
  }

  function render(duplicates: DuplicateInfo[]): void {
    component.duplicates = duplicates;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const items = () => Array.from(el().querySelectorAll('.duplicate-item')) as HTMLElement[];
  const button = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('.actions button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DuplicateWarningComponent, NoopAnimationsModule],
      providers: [
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DuplicateWarningComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when there is no duplicate to warn about', () => {
    render([]);

    expect(el().querySelector('.duplicate-warning')).toBeNull();
    expect(el().textContent?.trim()).toBe('');
  });

  it('counts the duplicates in the panel header', () => {
    render([
      { transaction: txn({ id: 'a' }), check: mockDuplicateCheck },
      { transaction: txn({ id: 'b' }), check: { ...mockDuplicateCheck, transactionId: 'b' } },
    ]);

    expect(text('mat-panel-title span')).toBe('import.duplicatesFound:{"count":2}');
    expect(text('.description')).toBe('import.duplicatesDescription');
    expect(items().length).toBe(2);
  });

  it('carries each row\'s own icon, label and confidence', () => {
    render([
      { transaction: txn({ id: 'a' }), check: { ...mockDuplicateCheck, matchType: 'exact', confidence: 1 } },
      {
        transaction: txn({ id: 'b' }),
        check: { ...mockDuplicateCheck, transactionId: 'b', matchType: 'possible', confidence: 0.62 },
      },
    ]);

    const [exact, possible] = items();
    expect(exact.querySelector('mat-icon')?.textContent?.trim()).toBe('error');
    expect(exact.querySelector('.match-type')?.textContent?.trim()).toBe('import.matchExact');
    expect(exact.querySelector('.confidence')?.textContent?.trim()).toBe('(100%)');
    expect(exact.classList).toContain('exact');

    expect(possible.querySelector('mat-icon')?.textContent?.trim()).toBe('help');
    expect(possible.querySelector('.match-type')?.textContent?.trim()).toBe('import.matchPossible');
    expect(possible.querySelector('.confidence')?.textContent?.trim()).toBe('(62%)');
    expect(possible.classList).not.toContain('exact');
  });

  it('signs an expense negative and an income positive', () => {
    render([
      { transaction: txn({ id: 'a', type: 'expense', amount: 12.5 }), check: mockDuplicateCheck },
      {
        transaction: txn({ id: 'b', type: 'income', amount: 40 }),
        check: { ...mockDuplicateCheck, transactionId: 'b' },
      },
    ]);

    const [expense, income] = items();
    expect(expense.querySelector('.amount')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('- $12.50');
    expect(expense.querySelector('.amount')?.classList).not.toContain('income');
    expect(income.querySelector('.amount')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('+ $40.00');
    expect(income.querySelector('.amount')?.classList).toContain('income');
  });

  it('shows each row\'s description and date', () => {
    render([{ transaction: txn({ description: 'Corner Market' }), check: mockDuplicateCheck }]);

    expect(items()[0].querySelector('.description')?.textContent?.trim()).toBe('Corner Market');
    expect(items()[0].querySelector('.date')?.textContent?.trim()).toBe('2026-03-04');
  });

  it('emits from the two action buttons a user actually clicks', () => {
    const seen: string[] = [];
    component.excludeAll.subscribe(() => seen.push('exclude'));
    component.includeAll.subscribe(() => seen.push('include'));
    render([{ transaction: txn(), check: mockDuplicateCheck }]);

    button('import.excludeDuplicates')?.click();
    button('import.includeDuplicates')?.click();

    expect(seen).toEqual(['exclude', 'include']);
  });
});
