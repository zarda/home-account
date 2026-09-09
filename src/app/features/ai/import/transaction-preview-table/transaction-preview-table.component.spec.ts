import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatDatepicker } from '@angular/material/datepicker';
import { MatTooltip } from '@angular/material/tooltip';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { CategorizedImportTransaction } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { toCreateTransactionDTO } from '../../../../core/utils/import-dto.utils';
import { needsDateAnswer } from '../../../../core/utils/import-review.utils';

describe('TransactionPreviewTableComponent', () => {
  let component: TransactionPreviewTableComponent;
  let fixture: ComponentFixture<TransactionPreviewTableComponent>;

  // Built fresh for every test: several tests mutate the transaction objects
  // in place (selected, type, category), so a shared array makes results
  // depend on execution order under Jasmine's random ordering.
  const createMockTransactions = (): CategorizedImportTransaction[] => [
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
  let mockTransactions: CategorizedImportTransaction[];
  let currencySession: jasmine.SpyObj<CurrencyChoiceSessionService>;

  beforeEach(async () => {
    mockTransactions = createMockTransactions();
    currencySession = jasmine.createSpyObj('CurrencyChoiceSessionService', ['remember', 'current', 'clear']);

    await TestBed.configureTestingModule({
      imports: [TransactionPreviewTableComponent, NoopAnimationsModule],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        {
          // Echoes the key and its params so tooltip assertions can check the
          // interpolated value without depending on the English wording.
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, string | number>) =>
              params ? `${key}:${JSON.stringify(params)}` : key,
          },
        },
        {
          // Two codes are enough to prove the picker curates: one the row
          // already carries and one to switch to. MXN answers the case the
          // curated list does not carry but the ISO table does.
          provide: CurrencyService,
          useValue: {
            getSupportedCurrencies: () => [
              { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
              { code: 'JPY', nameKey: 'currencies.jpy', symbol: '¥' },
            ],
            getCurrencyInfo: (code: string) =>
              code === 'MXN' ? { code, nameKey: 'currencies.mxn', symbol: '$' } : undefined,
            formatCurrency: (amount: number, code: string) => `${code} ${amount}`,
          },
        },
        { provide: CurrencyChoiceSessionService, useValue: currencySession },
      ],
    })
      .overrideComponent(TransactionPreviewTableComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(TransactionPreviewTableComponent);
    component = fixture.componentInstance;
  });

  // The template is overridden above, so the badge markup itself is covered
  // by the import-wizard smoke test; these pin the label's photo numbering.
  describe('receiptPhotos', () => {
    it('lists 1-based merge sources for a merged row', () => {
      const row = {
        ...createMockTransactions()[0],
        imageMetadata: {
          imageIndex: 0, imageId: 'image_0', positionInImage: 'middle' as const,
          confidenceScore: 0.9, receiptId: 2, mergedFromImages: [0, 1],
        },
      };
      expect(component.receiptPhotos(row)).toBe('1–2');
    });

    it('falls back to the row image index when no merge sources exist', () => {
      const row = {
        ...createMockTransactions()[0],
        imageMetadata: {
          imageIndex: 2, imageId: 'image_2', positionInImage: 'top' as const,
          confidenceScore: 0.8, receiptId: 1,
        },
      };
      expect(component.receiptPhotos(row)).toBe('3');
    });

    it('tolerates rows without metadata', () => {
      expect(component.receiptPhotos(createMockTransactions()[0])).toBe('1');
    });
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
      component.transactions = component.transactions.map(t => ({ ...t, selected: false }));

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
      component.toggleSelection(component.transactions[0], false);

      expect(component.transactions[0].selected).toBeFalse();
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

      expect(component.transactions[0].type).toBe('expense');

      component.toggleType(component.transactions[0]);

      expect(component.transactions[0].type).toBe('income');
    });

    it('should toggle income to expense', () => {
      const transactions = mockTransactions.map(t => ({ ...t }));
      component.transactions = transactions;
      fixture.detectChanges();

      expect(component.transactions[1].type).toBe('income');

      component.toggleType(component.transactions[1]);

      expect(component.transactions[1].type).toBe('expense');
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
      component.updateCategory(component.transactions[0], 'salary');

      expect(component.transactions[0].suggestedCategoryId).toBe('salary');
    });

    it('should set confidence to 1.0 (user confirmed)', () => {
      component.updateCategory(component.transactions[0], 'salary');

      expect(component.transactions[0].categoryConfidence).toBe(1.0);
    });

    it('should emit transactionsUpdated event', () => {
      spyOn(component.transactionsUpdated, 'emit');

      component.updateCategory(component.transactions[0], 'salary');

      expect(component.transactionsUpdated.emit).toHaveBeenCalled();
    });
  });

  describe('field verification markers', () => {
    const row = (overrides = {}) => ({
      id: 'r1',
      description: 'Blurry receipt',
      amount: 12.34,
      currency: 'USD',
      date: new Date('2026-06-01'),
      type: 'expense' as const,
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      ...overrides,
    });

    it('flags an amount the model was unsure it read', () => {
      const t = row({ fieldConfidence: { amount: 0.4 } });
      expect(component.needsVerification(t, 'amount')).toBeTrue();
    });

    it('leaves a confidently read amount unflagged', () => {
      const t = row({ fieldConfidence: { amount: 0.98 } });
      expect(component.needsVerification(t, 'amount')).toBeFalse();
    });

    it('does not flag a field the source could not report on', () => {
      // CSV and JSON imports have no model to ask. Flagging every one of their
      // rows would train the user to ignore the marker.
      expect(component.needsVerification(row(), 'amount')).toBeFalse();
      expect(component.needsVerification(row({ fieldConfidence: {} }), 'date')).toBeFalse();
    });

    it('flags amount and date independently', () => {
      const t = row({ fieldConfidence: { amount: 0.99, date: 0.3 } });
      expect(component.needsVerification(t, 'amount')).toBeFalse();
      expect(component.needsVerification(t, 'date')).toBeTrue();
    });

    it('reports the confidence as a percentage in the tooltip', () => {
      const t = row({ fieldConfidence: { amount: 0.42 } });
      expect(component.verificationTooltip(t, 'amount')).toContain('42');
    });
  });

  describe('the date button\'s name', () => {
    const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}) => ({
      ...createMockTransactions()[0],
      ...overrides,
    });
    const formatted = (row: CategorizedImportTransaction) =>
      TestBed.inject(LocaleFormatService).formatDate(row.date);

    it('says only how to change the date on a row nobody doubts', () => {
      // Same shape as currencyChipLabel: the mark leads the name only when
      // there is one, so a plain CSV row is not announced as suspect.
      const row = makeRow();
      expect(component.dateChipLabel(row)).toBe(`import.changeDate:{"date":"${formatted(row)}"}`);
    });

    it('leads with the not-today wording for a receipt row dated another day', () => {
      const row = makeRow({ id: 'receipt', date: new Date(2026, 5, 1) });
      component.dateAttentionIds = new Set(['receipt']);
      expect(component.dateChipLabel(row)).toBe(
        `import.dateNotTodayTooltip:{"date":"${formatted(row)}"}. import.changeDate:{"date":"${formatted(row)}"}`
      );
    });

    it('stays quiet about another day on a row outside the attention set', () => {
      const row = makeRow({ id: 'statement', date: new Date(2026, 5, 1) });
      expect(component.dateNotToday(row)).toBeFalse();
      expect(component.dateChipLabel(row)).toBe(`import.changeDate:{"date":"${formatted(row)}"}`);
    });

    it('keeps the percent wording for a low grade that was not assumed', () => {
      // The resolver assumes every grade under the bar, so this row cannot
      // come out of it — but a row that got here some other way must not
      // wear a blank name.
      const row = makeRow({ fieldConfidence: { date: 0.3 } });
      expect(component.dateTooltip(row)).toBe('import.verifyDate:{"percent":30}');
    });

    it('names the keep button by the reason and by the date it keeps', () => {
      const row = makeRow({ dateAssumed: true });
      expect(component.keepDateLabel(row)).toBe(`import.dateAssumedTooltip. import.keepDate:{"date":"${formatted(row)}"}`);
      expect(component.dateChipText(row)).toBe('import.dateAssumedKeep');
    });

    it('drops the reason\'s own stop before the join adds one', () => {
      // The three date tooltips are sentences with a terminator of their
      // own — "." in en, "。" in ja and tc — and the join puts one between
      // the reason and the action, so a flagged row's name would end its
      // reason "here.. Change" or "。. 日付". dateReviewed and the percent
      // wording carry no stop and keep the plain ". " join the cases above
      // pin; the echoing stub returns bare keys, so these two are stood in
      // for with real sentences.
      const sentences: Record<string, string> = {
        'import.dateAssumedTooltip': 'This row is dated today — keep it or change it here.',
        'import.dateNotTodayTooltip': 'このレシートの日付は今日ではありません。',
      };
      spyOn(TestBed.inject(TranslationService), 't').and.callFake(
        (key: string, params?: Record<string, string | number>) =>
          sentences[key] ?? (params ? `${key}:${JSON.stringify(params)}` : key)
      );

      const assumed = makeRow({ dateAssumed: true });
      expect(component.dateChipLabel(assumed))
        .toBe(`This row is dated today — keep it or change it here. import.changeDate:{"date":"${formatted(assumed)}"}`);
      const receipt = makeRow({ id: 'receipt', date: new Date(2026, 5, 1) });
      component.dateAttentionIds = new Set(['receipt']);
      expect(component.keepDateLabel(receipt))
        .toBe(`このレシートの日付は今日ではありません. import.keepDate:{"date":"${formatted(receipt)}"}`);
    });

    it('asks a not-today row to keep the day it is dated, and flags its button', () => {
      const row = makeRow({ id: 'receipt', date: new Date(2026, 5, 1) });
      component.dateAttentionIds = new Set(['receipt']);
      expect(component.dateChipText(row)).toBe(`import.dateNotTodayKeep:{"date":"${formatted(row)}"}`);
      expect(component.dateNotToday(row)).withContext('the class the button wears').toBeTrue();
      expect(component.dateFlagged(row)).withContext('the flag icon the button shows').toBeTrue();
    });
  });

  describe('the bulk date answer', () => {
    // A trip's worth of receipts are all dated on their own days, and the
    // dates are usually right: one Keep for every row still asked, settled
    // exactly the way the single Keep settles a row.
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };
    // Every row is dated deliberately: the fixture's own dates are half of
    // what the count means, and rows that all inherit one stale day would
    // read the same whether the predicate looked at the date or not.
    const rows = (): CategorizedImportTransaction[] => [
      { ...createMockTransactions()[0], id: 'asked', date: yesterday(), fieldConfidence: { amount: 0.5, date: 0.9 } },
      { ...createMockTransactions()[0], id: 'assumed', date: new Date(), dateAssumed: true, dateImplausible: true, fieldConfidence: { date: 0.3 } },
      { ...createMockTransactions()[0], id: 'today', date: new Date() },
      { ...createMockTransactions()[0], id: 'unselected', date: yesterday(), selected: false },
      { ...createMockTransactions()[0], id: 'answered', date: yesterday(), dateReviewed: true },
      { ...createMockTransactions()[0], id: 'outside', date: yesterday() },
    ];

    beforeEach(() => {
      component.transactions = rows();
      component.dateAttentionIds = new Set(['asked', 'assumed', 'today', 'unselected', 'answered']);
    });

    it('counts the selected rows under attention still owing an answer', () => {
      // Two of the three attention rows that are selected and unanswered:
      // the one dated yesterday and the assumed one. The third is dated
      // today and was read, so nobody is being asked about it.
      expect(component.unansweredCount()).toBe(2);
    });

    it('counts nothing outside the attention set', () => {
      // A CSV batch is never asked, so its header offers no bulk Keep.
      component.dateAttentionIds = new Set();
      expect(component.unansweredCount()).toBe(0);
    });

    it('keeps exactly the rows still asked, and leaves every other row by identity', () => {
      const before = component.transactions;
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.keepAllDates();

      expect(emitted.length).toBe(1);
      const byId = new Map(emitted[0].map(t => [t.id, t]));
      const asked = byId.get('asked')!;
      expect(asked.date).withContext('kept, not moved').toBe(before[0].date);
      expect(asked.dateReviewed).toBeTrue();
      expect(asked.dateAssumed).toBeUndefined();
      expect(asked.dateImplausible).toBeUndefined();
      expect(asked.fieldConfidence).withContext('only the date\'s grade goes').toEqual({ amount: 0.5 });
      const assumed = byId.get('assumed')!;
      expect(assumed.dateReviewed).toBeTrue();
      expect(assumed.dateAssumed).toBeUndefined();
      expect(assumed.dateImplausible).toBeUndefined();
      expect(assumed.fieldConfidence).withContext('the date was the only grade').toBeUndefined();
      // Untouched by identity: dated today, not selected, already answered,
      // outside attention.
      expect(byId.get('today')).toBe(before[2]);
      expect(byId.get('unselected')).toBe(before[3]);
      expect(byId.get('answered')).toBe(before[4]);
      expect(byId.get('outside')).toBe(before[5]);
      expect(component.unansweredCount()).toBe(0);
    });
  });

  describe('row edits', () => {
    const rows = () => [
      {
        id: 'r1', description: 'A', amount: 1, currency: 'USD', date: new Date('2026-06-01'),
        type: 'expense' as const, suggestedCategoryId: 'food', categoryConfidence: 0.5,
        isDuplicate: false, selected: false,
      },
      {
        id: 'r2', description: 'B', amount: 2, currency: 'USD', date: new Date('2026-06-02'),
        type: 'expense' as const, suggestedCategoryId: 'food', categoryConfidence: 0.5,
        isDuplicate: false, selected: false,
      },
    ];

    it('does not mutate the row objects it was given', () => {
      // Edits used to assign onto the @Input objects, which the parent also
      // holds — so a computed() over them would never see the change.
      const original = rows();
      const snapshot = { ...original[0] };
      component.transactions = original;

      component.updateCategory(original[0], 'transport');

      expect(original[0]).toEqual(snapshot);
      expect(component.transactions[0].suggestedCategoryId).toBe('transport');
    });

    it('stamps full confidence when the user picks a category', () => {
      component.transactions = rows();
      component.updateCategory(component.transactions[0], 'transport');
      expect(component.transactions[0].categoryConfidence).toBe(1.0);
    });

    it('emits a new array on every edit', () => {
      component.transactions = rows();
      const emitted: unknown[] = [];
      component.transactionsUpdated.subscribe(v => emitted.push(v));

      component.toggleSelection(component.transactions[0], true);
      component.toggleType(component.transactions[1]);

      expect(emitted.length).toBe(2);
      expect(emitted[0]).not.toBe(emitted[1]);
    });
  });

  describe('currency edits', () => {
    const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}) => ({
      ...createMockTransactions()[0],
      ...overrides,
    });

    it('replaces the row with the chosen currency and clears the fallen-back mark', () => {
      const row = makeRow({ currency: 'USD', currencyFellBack: true });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.updateCurrency(row, 'JPY');

      expect(emitted[0][0].currency).toBe('JPY');
      expect(emitted[0][0].currencyFellBack).toBeFalse();
      expect(emitted[0][0]).not.toBe(row);
      expect(row.currency).toBe('USD'); // the input object is untouched
    });

    it('applies a currency to the selected rows only', () => {
      component.transactions = [
        makeRow({ id: 'a', currency: 'USD', selected: true }),
        makeRow({ id: 'b', currency: 'USD', selected: false }),
        makeRow({ id: 'c', currency: 'USD', selected: true }),
      ];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.applyCurrencyToSelected('JPY');

      expect(emitted[0].map(t => t.currency)).toEqual(['JPY', 'USD', 'JPY']);
    });

    it('lists the row\'s own code when the picker does not curate it', () => {
      expect(component.currencyOptions(makeRow({ currency: 'MXN' })).map(o => o.code)).toContain('MXN');
      expect(component.currencyOptions(makeRow({ currency: 'USD' })).map(o => o.code)).toEqual(['USD', 'JPY']);
    });

    it('formats the amount through CurrencyService, so decimals follow the currency', () => {
      expect(component.formatAmount(makeRow({ amount: 1200, currency: 'JPY' }))).toBe('JPY 1200');
    });

    it('leads the chip\'s name with the mark when nobody read the currency', () => {
      // The chip's aria-label replaces whatever its contents would have said,
      // so a marker icon inside it is announced to no one. Only a row that
      // actually fell back gets the prefix.
      expect(component.currencyChipLabel(makeRow({ currency: 'USD', currencyFellBack: true })))
        .toBe('import.currencyFellBack. import.setCurrency:{"currency":"USD"}');
      expect(component.currencyChipLabel(makeRow({ currency: 'JPY' })))
        .toBe('import.setCurrency:{"currency":"JPY"}');
    });

    it('remembers a currency chosen by hand for a fallen-back row, and drops the offer', () => {
      const row = makeRow({ currency: 'USD', currencyFellBack: true, currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' } });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.updateCurrency(row, 'JPY');

      expect(currencySession.remember).toHaveBeenCalledWith('JPY');
      expect(emitted[0][0].currencySuggestion).toBeUndefined();
    });

    it('does not remember an edit to a currency the source read', () => {
      const row = makeRow({ currency: 'USD' });
      component.transactions = [row];
      component.updateCurrency(row, 'JPY');
      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('keeps remembering a hand-correction after the marker that first earned it has cleared, so the session holds the final answer — not the first (#156)', () => {
      // Mirrors the form's own fix (see transaction-form.component.ts):
      // the visible fell-back marker and the row's eligibility to record a
      // choice are two different things. The first correction clears the
      // marker — the row really is settled, the icon should go — but a
      // second, third, however-many-th hand-correction to the same row has
      // to keep landing in the session, because that is the whole point of
      // remembering a fallen-back row's choice: the next receipt this
      // session should see what the user meant, not what they mis-picked.
      const row = makeRow({ currency: 'USD', currencyFellBack: true });
      component.transactions = [row];

      component.updateCurrency(row, 'JPY');
      const settled = component.transactions[0];
      expect(settled.currencyFellBack).withContext('marker cleared by the first correction').toBeFalse();

      component.updateCurrency(settled, 'KRW');

      expect(currencySession.remember).toHaveBeenCalledTimes(2);
      expect(currencySession.remember.calls.mostRecent().args).toEqual(['KRW']);
    });

    it('remembers the bulk choice and drops every selected row\'s offer', () => {
      component.transactions = [
        makeRow({
          id: 'a',
          currency: 'USD',
          selected: true,
          currencyFellBack: true,
          currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
        }),
        makeRow({ id: 'b', currency: 'USD', selected: false, currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' } }),
      ];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.applyCurrencyToSelected('JPY');

      expect(currencySession.remember).toHaveBeenCalledWith('JPY');
      expect(emitted[0][0].currencySuggestion).toBeUndefined();
      expect(emitted[0][1].currencySuggestion).toBeDefined();
    });

    it('does not remember a bulk choice when none of the selected rows fell back — the memory is documented to hold only that', () => {
      component.transactions = [
        makeRow({ id: 'a', currency: 'USD', selected: true }),
        makeRow({ id: 'b', currency: 'USD', selected: true }),
      ];

      component.applyCurrencyToSelected('JPY');

      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('remembers a bulk choice for a row already settled by hand this session, even though its own marker is gone', () => {
      // The bulk path has to consult the same persisted eligibility as the
      // per-row edit — gating it on the row's live currencyFellBack flag
      // alone would reproduce the first-answer-only bug through this path
      // the moment a row had already been corrected once by hand (#156).
      const row = makeRow({ id: 'a', currency: 'USD', selected: true, currencyFellBack: true });
      component.transactions = [row];
      component.updateCurrency(row, 'JPY');
      currencySession.remember.calls.reset();

      component.transactions = component.transactions.map(t => ({ ...t, selected: true }));
      component.applyCurrencyToSelected('KRW');

      expect(currencySession.remember).toHaveBeenCalledWith('KRW');
    });
  });

  describe('suggested fields', () => {
    const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}) => ({
      ...createMockTransactions()[0],
      ...overrides,
    });

    it('removes a suggested location without mutating the row', () => {
      const row = makeRow({ location: { name: 'Shibuya' } });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.removeLocation(row);

      expect(emitted[0][0].location).toBeUndefined();
      expect(row.location).toEqual({ name: 'Shibuya' });
    });

    it('removing a location also forgets the country the receipt claimed', () => {
      // The mapper rebuilds a location from receiptCountry when the row has
      // none, so clearing the slot alone would walk the dismissed country
      // straight back into the document.
      const row = makeRow({ location: { country: 'KR' }, receiptCountry: 'KR' });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.removeLocation(row);

      expect(emitted[0][0].location).toBeUndefined();
      expect(emitted[0][0].receiptCountry).toBeUndefined();
      expect(row.receiptCountry).toBe('KR');
    });

    it('keeps the currency offer after the location is removed', () => {
      // The offer is materialised once at row build, so dropping the country
      // mark afterwards must not take the suggestion with it.
      const row = makeRow({
        location: { country: 'KR' },
        receiptCountry: 'KR',
        currencyFellBack: true,
        currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
      });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.removeLocation(row);

      expect(emitted[0][0].currencySuggestion).toEqual({ code: 'KRW', country: 'KR', reason: 'receipt' });
    });

    it('removes one tag and leaves the others', () => {
      const row = makeRow({ tags: ['coffee', 'work'] });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.removeTag(row, 'work');

      expect(emitted[0][0].tags).toEqual(['coffee']);
    });
  });

  describe('the offered currency', () => {
    const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}) => ({
      ...createMockTransactions()[0],
      ...overrides,
    });
    const offer = { code: 'KRW', country: 'KR', reason: 'receipt' as const };

    it('accepting applies it through the currency edit, clears both marks and remembers it', () => {
      const row = makeRow({ currency: 'USD', currencyFellBack: true, currencySuggestion: offer });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.acceptCurrencySuggestion(row);

      expect(emitted[0][0].currency).toBe('KRW');
      expect(emitted[0][0].currencyFellBack).toBeFalse();
      expect(emitted[0][0].currencySuggestion).toBeUndefined();
      expect(currencySession.remember).toHaveBeenCalledWith('KRW');
      expect(row.currency).toBe('USD'); // the input object is untouched
    });

    it('dismissing drops the offer and nothing else — ADR 0062: offered, never applied', () => {
      const row = makeRow({ currency: 'USD', currencyFellBack: true, currencySuggestion: offer });
      component.transactions = [row];
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));

      component.dismissCurrencySuggestion(row);

      expect(emitted[0][0].currency).toBe('USD');
      expect(emitted[0][0].currencyFellBack).toBeTrue();
      expect(emitted[0][0].currencySuggestion).toBeUndefined();
      expect(currencySession.remember).not.toHaveBeenCalled();
    });

    it('names the country in the chip and the reason in its accessible name', () => {
      // The review card and the form share one namespace for these strings
      // (M7): a chip built here reads the same keys the form's own does.
      const row = makeRow({ currencySuggestion: offer });
      expect(component.currencyOfferText(row)).toBe('import.currencyFromCountry:{"country":"South Korea","currency":"KRW"}');
      expect(component.currencyOfferLabel(row)).toBe('import.acceptCurrencySuggestion:{"currency":"KRW"}. import.currencyReasonReceipt');
      expect(component.currencyOfferText(makeRow({ currencySuggestion: { code: 'THB', reason: 'session' } })))
        .toBe('import.currencySuggested:{"currency":"THB"}');
      expect(component.currencyOfferReason(makeRow({ currencySuggestion: { code: 'THB', reason: 'session' } })))
        .toBe('import.currencyReasonSession');
      expect(component.currencyOfferReason(makeRow({ currencySuggestion: { code: 'JPY', country: 'JP', reason: 'locale' } })))
        .toBe('import.currencyReasonLocale');
    });

    it('gives no reason for a row with no offer, matching currencyOfferText\'s own empty return', () => {
      // Unreachable through the template, which gates the whole strip on
      // row.currencySuggestion — but a helper that invents a "receipt"
      // reason for a row with no offer at all invites a future caller to
      // trust it.
      expect(component.currencyOfferReason(makeRow({ currencySuggestion: undefined }))).toBe('');
    });
  });

  describe('the offered recurring link', () => {
    const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}) => ({
      ...createMockTransactions()[0],
      ...overrides,
    });

    const emissions = (): CategorizedImportTransaction[][] => {
      const emitted: CategorizedImportTransaction[][] = [];
      component.transactionsUpdated.subscribe(t => emitted.push(t));
      return emitted;
    };

    it('links the row to the rule it was offered when accepted', () => {
      const row = makeRow({ recurringMatch: { id: 'rule-1', name: 'Netflix' } });
      component.transactions = [row];
      const emitted = emissions();

      component.toggleRecurringLink(row, true);

      expect(emitted[0][0].recurringId).toBe('rule-1');
      expect(emitted[0][0].isRecurring).toBeTrue();
      expect(row.recurringId).toBeUndefined(); // the input object is untouched
    });

    it('restores what the source said about the row when the link is declined', () => {
      const row = makeRow({
        recurringMatch: { id: 'rule-1', name: 'Netflix', sourceIsRecurring: false },
        recurringId: 'rule-1',
        isRecurring: true,
      });
      component.transactions = [row];
      const emitted = emissions();

      component.toggleRecurringLink(row, false);

      expect(emitted[0][0].recurringId).toBeUndefined();
      expect(emitted[0][0].isRecurring).toBeFalse();
    });

    it('leaves isRecurring unanswered when the source never said', () => {
      // The mapper writes isRecurring only when it is present, so undefined
      // has to survive the undo or a declined link still writes "recurring".
      const row = makeRow({
        recurringMatch: { id: 'rule-1', name: 'Netflix' },
        recurringId: 'rule-1',
        isRecurring: true,
      });
      component.transactions = [row];
      const emitted = emissions();

      component.toggleRecurringLink(row, false);

      expect(emitted[0][0].isRecurring).toBeUndefined();
    });

    it('does nothing for a row that was offered no rule', () => {
      const row = makeRow();
      component.transactions = [row];
      const emitted = emissions();

      component.toggleRecurringLink(row, true);

      expect(emitted.length).toBe(0);
    });
  });
});

/**
 * Every case above overrides the template to `<div></div>`, so none of them
 * would notice a typo'd `(click)` or a broken `@if` gate on the offer chip —
 * they call the methods directly. This is the one place the real template
 * is rendered and its controls actually clicked, the same way a user would
 * reach acceptCurrencySuggestion and dismissCurrencySuggestion.
 */
describe('TransactionPreviewTableComponent, the offer chip through its own template', () => {
  let fixture: ComponentFixture<TransactionPreviewTableComponent>;
  let component: TransactionPreviewTableComponent;
  let currencySession: jasmine.SpyObj<CurrencyChoiceSessionService>;

  const makeRow = (overrides: Partial<CategorizedImportTransaction> = {}): CategorizedImportTransaction => ({
    id: 'txn1',
    description: 'Coffee Shop',
    amount: 5.5,
    currency: 'USD',
    date: new Date('2024-01-15'),
    type: 'expense',
    suggestedCategoryId: 'food',
    categoryConfidence: 0.9,
    isDuplicate: false,
    selected: true,
    ...overrides,
  });

  beforeEach(async () => {
    currencySession = jasmine.createSpyObj('CurrencyChoiceSessionService', ['remember', 'current', 'clear']);

    await TestBed.configureTestingModule({
      imports: [TransactionPreviewTableComponent, NoopAnimationsModule],
      providers: [
        {
          // Echoes the key and its params, as the first describe does, so a
          // label that carries the formatted date can be asserted whole.
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, string | number>) =>
              params ? `${key}:${JSON.stringify(params)}` : key,
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            getSupportedCurrencies: () => [{ code: 'USD', nameKey: 'currencies.usd', symbol: '$' }],
            getCurrencyInfo: () => undefined,
            formatCurrency: (amount: number, code: string) => `${code} ${amount}`,
          },
        },
        { provide: CurrencyChoiceSessionService, useValue: currencySession },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionPreviewTableComponent);
    component = fixture.componentInstance;
  });

  function emissions(): CategorizedImportTransaction[][] {
    const emitted: CategorizedImportTransaction[][] = [];
    component.transactionsUpdated.subscribe(t => emitted.push(t));
    return emitted;
  }

  it('renders a country-only location as the country name', () => {
    // 0064 declined to store a nameless country because "a country alone
    // renders as nothing anywhere". This is that objection answered. The
    // country reads off its own picker rather than the chip's text: since
    // the chip became an editor, `.extra-text` is where the place name goes
    // and nothing else.
    component.transactions = [makeRow({ location: { country: 'KR' } })];
    component.categories = [];
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.extra-chip .country-name') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('South Korea');
  });

  it('still renders a printed address by its own name', () => {
    component.transactions = [makeRow({ location: { name: 'Myeongdong', country: 'KR' } })];
    component.categories = [];
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.extra-chip .extra-text') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('Myeongdong');
  });

  it('clicking accept applies the offer, the same way acceptCurrencySuggestion does', () => {
    const row = makeRow({
      currencyFellBack: true,
      currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
    });
    component.transactions = [row];
    component.categories = [];
    fixture.detectChanges();
    const emitted = emissions();

    (fixture.nativeElement.querySelector('.currency-offer .extra-accept') as HTMLElement).click();

    expect(emitted[0][0].currency).toBe('KRW');
    expect(emitted[0][0].currencyFellBack).toBeFalse();
    expect(emitted[0][0].currencySuggestion).toBeUndefined();
    expect(currencySession.remember).toHaveBeenCalledWith('KRW');
  });

  it('clicking dismiss drops only the offer, the same way dismissCurrencySuggestion does', () => {
    const row = makeRow({
      currencyFellBack: true,
      currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
    });
    component.transactions = [row];
    component.categories = [];
    fixture.detectChanges();
    const emitted = emissions();

    (fixture.nativeElement.querySelector('.currency-offer .extra-remove') as HTMLElement).click();

    expect(emitted[0][0].currency).toBe('USD');
    expect(emitted[0][0].currencyFellBack).toBeTrue();
    expect(emitted[0][0].currencySuggestion).toBeUndefined();
    expect(currencySession.remember).not.toHaveBeenCalled();
  });

  it('hands focus to the currency chip when the offer is dismissed', () => {
    // The offer chip goes with its own remove button; the currency chip
    // beneath it is unconditional, so no fallback is needed behind it.
    const row = makeRow({
      currencyFellBack: true,
      currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
    });
    component.transactions = [row];
    component.categories = [];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.currency-offer .extra-remove') as HTMLElement).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.currency-chip'));
  });

  it('hands focus to the currency chip when the offer is accepted', () => {
    // Accept goes through updateCurrency, which clears currencySuggestion
    // the same way dismiss does — the same unmount, so the same landing.
    const row = makeRow({
      currencyFellBack: true,
      currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
    });
    component.transactions = [row];
    component.categories = [];
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.currency-offer .extra-accept') as HTMLElement).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.currency-chip'));
  });

  /**
   * The touch picker renders in the CDK overlay container, outside the
   * fixture, so a test that opened it closes it again — or the next test
   * finds a stray dialog in the document.
   */
  describe('the date on the card', () => {
    const formatted = (row: CategorizedImportTransaction) =>
      TestBed.inject(LocaleFormatService).formatDate(row.date);
    const dateButton = () => fixture.nativeElement.querySelector('button.date-chip') as HTMLButtonElement;
    const questionChips = () =>
      fixture.nativeElement.querySelectorAll('.extra-chip.date-check') as NodeListOf<HTMLElement>;
    const openDialog = () => document.querySelector('.mat-datepicker-content [role="dialog"]');
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };

    function render(rows: CategorizedImportTransaction[], attention: string[] = []): void {
      component.transactions = rows;
      component.categories = [];
      component.dateAttentionIds = new Set(attention);
      fixture.detectChanges();
    }

    afterEach(() => {
      for (const picker of fixture.debugElement.queryAll(By.directive(MatDatepicker))) {
        (picker.componentInstance as MatDatepicker<Date>).close();
      }
      expect(document.querySelector('.mat-datepicker-content'))
        .withContext('no picker left open for the next test')
        .toBeNull();
    });

    it('renders the date as a button named by its mark and then by what a tap does', () => {
      // The ordinary assumed row: resolveImportDate marks dateAssumed for the
      // same low reading that trips needsVerification. The flag still
      // renders, but a button's aria-label replaces its content, so the
      // flag is decorative and the wording rides on the name instead.
      const row = makeRow({ id: 'r1', dateAssumed: true, fieldConfidence: { date: 0.3 } });
      render([row]);

      const button = dateButton();
      expect(button.id).toBe('date-chip-r1');
      expect(button.getAttribute('aria-label'))
        .toBe(`import.dateAssumedTooltip. import.changeDate:{"date":"${formatted(row)}"}`);
      const flag = button.querySelector('.verify-flag');
      expect(flag).withContext('the low-confidence flag on the date button still renders').not.toBeNull();
      expect(flag?.getAttribute('aria-hidden')).withContext('but is decorative').toBe('true');
    });

    it('opens the touch picker from the button, and the dialog is named after the button', () => {
      render([makeRow({ id: 'r1' })]);

      dateButton().click();
      fixture.detectChanges();

      const dialog = openDialog();
      expect(dialog).withContext('the touch dialog is in the document').not.toBeNull();
      // The dialog takes its name from the anchor input's own aria-labelledby;
      // a bare input outside a form field has no other label to hand it.
      expect(dialog?.getAttribute('aria-labelledby')).toBe('date-chip-r1');
    });

    it('names a reviewed row\'s button by the check, shows the check, and asks nothing', () => {
      const row = makeRow({ dateReviewed: true });
      render([row]);

      expect(dateButton().getAttribute('aria-label'))
        .toBe(`import.dateReviewed. import.changeDate:{"date":"${formatted(row)}"}`);
      expect(dateButton().querySelector('mat-icon')?.textContent?.trim()).toBe('check');
      expect(questionChips().length).toBe(0);
    });

    it('picking a day emits a new row dated that day, with the marks and the date grade gone', () => {
      const row = makeRow({ dateAssumed: true, dateImplausible: true, fieldConfidence: { amount: 0.5, date: 0.3 } });
      render([row]);
      const emitted = emissions();
      const picked = new Date(2026, 5, 3);

      component.updateDate(row, picked);

      const next = emitted[0][0];
      expect(next).not.toBe(row);
      expect(next.date).toBe(picked);
      expect(next.dateReviewed).toBeTrue();
      expect(next.dateAssumed).toBeUndefined();
      expect(next.dateImplausible).toBeUndefined();
      expect(next.fieldConfidence).withContext('the amount grade stays; the object is exactly what remains').toEqual({ amount: 0.5 });
    });

    it('drops the grade altogether when the date was the only field graded', () => {
      const row = makeRow({ dateAssumed: true, fieldConfidence: { date: 0.3 } });
      render([row]);
      const emitted = emissions();

      component.updateDate(row, new Date(2026, 5, 3));

      expect(emitted[0][0].fieldConfidence).toBeUndefined();
    });

    it('ignores a cleared picker', () => {
      // The input emits null when its text is cleared; a row cannot be dated nothing.
      const row = makeRow();
      render([row]);
      const emitted = emissions();

      component.updateDate(row, null);

      expect(emitted.length).toBe(0);
    });

    it('keeping the date answers the question without changing the date', () => {
      const row = makeRow({ dateAssumed: true, dateImplausible: true, fieldConfidence: { amount: 0.5, date: 0.3 } });
      render([row]);
      const emitted = emissions();

      component.keepDate(row);

      const next = emitted[0][0];
      expect(next.date).toBe(row.date);
      expect(next.dateReviewed).toBeTrue();
      expect(next.dateAssumed).toBeUndefined();
      expect(next.dateImplausible).toBeUndefined();
      expect(next.fieldConfidence).toEqual({ amount: 0.5 });
    });

    it('asks about an assumed date on any batch, and about another day only for a receipt row', () => {
      render([makeRow({ id: 'assumed', dateAssumed: true }), makeRow({ id: 'old', date: yesterday() })]);
      expect(questionChips().length).withContext('attention off: only the assumed row is asked').toBe(1);

      // Through setInput, the way the wizard's binding reaches it: the
      // component is OnPush, and a property assigned on the instance does
      // not mark its view, so detectChanges alone would leave the DOM as is.
      fixture.componentRef.setInput('dateAttentionIds', new Set(['old']));
      fixture.detectChanges();
      expect(questionChips().length).withContext('attention on: the not-today row is asked too').toBe(2);
    });

    it('renders the question only while the row carries the mark', () => {
      render([makeRow({ id: 'marked', dateAssumed: true }), makeRow({ id: 'unmarked' })]);

      expect(questionChips().length).toBe(1);
    });

    it('renders the keep button with the reason and the keep wording in its name', () => {
      const row = makeRow({ dateAssumed: true });
      render([row]);

      const keep = fixture.nativeElement.querySelector('.extra-chip.date-check .extra-accept') as HTMLElement;
      // Reason, then action: the name is more than the tooltip, so `toContain`.
      expect(keep.getAttribute('aria-label')).toContain(component.dateAssumedTooltip(row));
      expect(keep.getAttribute('aria-label')).toContain('import.keepDate');
    });

    it('an implausible row is asked with the implausible wording and wears no verify flag', () => {
      // Graded 0.9 — well clear of the verify threshold — because that is
      // exactly the case the window exists for: needsVerification stays
      // quiet, so the question chip is the only surface this row gets.
      const row = makeRow({ dateAssumed: true, dateImplausible: true, fieldConfidence: { date: 0.9 } });
      render([row]);

      const keep = fixture.nativeElement.querySelector('.extra-chip.date-check .extra-accept') as HTMLElement;
      expect(keep.getAttribute('aria-label')).toContain(component.dateAssumedTooltip(row));
      expect(component.dateAssumedTooltip(row)).toBe('import.dateImplausibleTooltip');
      expect(dateButton().querySelector('.verify-flag'))
        .withContext('grade clears the threshold, so the date button wears no flag')
        .toBeNull();
      expect(dateButton().getAttribute('aria-label'))
        .withContext('the mark still rides on the button name')
        .toMatch(/^import\.dateImplausibleTooltip\. /);
    });

    it('clicking keep answers through keepDate, and the question goes', () => {
      const row = makeRow({ dateAssumed: true });
      render([row]);
      const emitted = emissions();

      (fixture.nativeElement.querySelector('.date-check .extra-accept') as HTMLElement).click();
      fixture.detectChanges();

      expect(emitted[0][0].dateReviewed).toBeTrue();
      expect(questionChips().length).toBe(0);
      expect(dateButton().querySelector('mat-icon')?.textContent?.trim()).toBe('check');
    });

    it('hands focus to the date button when Keep takes the question away', () => {
      // Keep is the most-tapped control in the review and it removes the
      // chip it sits on. A focused element that leaves the DOM drops focus
      // at the document root, so a reviewer answering a batch of receipts
      // from the keyboard is thrown out of the list on every answer — the
      // same fall closeEdit was fixed for. The date button is where the
      // answer landed and it names the day as it now stands.
      render([makeRow({ id: 'r1', dateAssumed: true })]);
      const keep = fixture.nativeElement.querySelector('.date-check .extra-accept') as HTMLElement;
      keep.focus();

      keep.click();
      fixture.detectChanges();

      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#date-chip-r1'));
    });

    it('hands focus to the date button when a day is picked from the question', () => {
      // The picker restores focus to whatever held it when the dialog
      // opened — here the question's own calendar button, which the answer
      // unmounts a moment later, so the restore lands on a detached node.
      render([makeRow({ id: 'r1', date: new Date(2026, 5, 10), dateAssumed: true })]);
      const change = fixture.nativeElement.querySelector('.date-check .extra-change') as HTMLElement;
      change.focus();
      change.click();
      fixture.detectChanges();

      const third = Array.from(document.querySelectorAll<HTMLElement>('.mat-calendar-body-cell'))
        .find(cell => cell.querySelector('.mat-calendar-body-cell-content')?.textContent?.trim() === '3')!;
      third.click();
      fixture.detectChanges();

      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#date-chip-r1'));
    });

    it('marks exactly the asked rows that are dated another day, and no others', () => {
      // The mark and the question are one predicate: needsDateAnswer, plus
      // "and not today" for the rows it asks about because the date is
      // assumed. Spelling the conjuncts out a second time is what let the
      // `selected` guard go missing from one of them once already, so what
      // is pinned here is the agreement, not the wording.
      const rows = [
        makeRow({ id: 'asked', date: yesterday() }),
        makeRow({ id: 'unselected', date: yesterday(), selected: false }),
        makeRow({ id: 'answered', date: yesterday(), dateReviewed: true }),
        makeRow({ id: 'assumed', date: new Date(), dateAssumed: true }),
        makeRow({ id: 'today', date: new Date() }),
        makeRow({ id: 'outside', date: yesterday() }),
      ];
      const attention = new Set(['asked', 'unselected', 'answered', 'assumed', 'today']);
      render(rows, [...attention]);

      expect(rows.filter(row => component.dateNotToday(row)).map(row => row.id))
        .withContext('only the selected, unanswered, attended row dated another day')
        .toEqual(['asked']);
      for (const row of rows) {
        expect(component.dateNotToday(row) && !needsDateAnswer(row, attention.has(row.id)))
          .withContext(`${row.id} is marked but not asked`)
          .toBeFalse();
      }
    });

    it('the change button on the question opens the same picker', () => {
      render([makeRow({ id: 'r1', dateAssumed: true })]);

      (fixture.nativeElement.querySelector('.date-check .extra-change') as HTMLElement).click();
      fixture.detectChanges();

      expect(openDialog()?.getAttribute('aria-labelledby')).toBe('date-chip-r1');
    });

    it('opens the picker on the row\'s own day, and a picked day comes back through dateChange', () => {
      // The anchor's [value] is what the calendar opens on; without it the
      // dialog opens on today's month, and a June receipt corrected in
      // September starts three months from its own day. June 2026 is a
      // month no later run can be in, so a today cell showing would mean
      // the calendar ignored the row. The emission is the (dateChange) wire
      // to updateDate, which every other case here calls directly.
      const row = makeRow({
        id: 'r1',
        date: new Date(2026, 5, 10),
        dateAssumed: true,
        dateImplausible: true,
        fieldConfidence: { amount: 0.5, date: 0.3 },
      });
      render([row]);
      const emitted = emissions();
      const dayOf = (cell: Element | null) =>
        cell?.querySelector('.mat-calendar-body-cell-content')?.textContent?.trim();

      dateButton().click();
      fixture.detectChanges();

      expect(dayOf(document.querySelector('.mat-calendar-body-active')))
        .withContext('the calendar opens on the row\'s own day')
        .toBe('10');
      expect(document.querySelector('.mat-calendar-body-today'))
        .withContext('and on the row\'s own month, not this one')
        .toBeNull();

      const third = Array.from(document.querySelectorAll<HTMLElement>('.mat-calendar-body-cell'))
        .find(cell => dayOf(cell) === '3') as HTMLElement;
      third.click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      const next = emitted[0][0];
      expect(next.date).toEqual(new Date(2026, 5, 3));
      expect(next.dateReviewed).toBeTrue();
      expect(next.dateAssumed).toBeUndefined();
      expect(next.dateImplausible).toBeUndefined();
      expect(next.fieldConfidence).toEqual({ amount: 0.5 });
      expect(openDialog()).withContext('a touch dialog with no actions closes on the pick').toBeNull();
    });

    it('says it opens a dialog rather than wearing a menu caret', () => {
      // A caret says "menu": the currency chip is one and keeps it, the
      // date opens a modal dialog and says so on aria-haspopup.
      render([makeRow()]);

      expect(dateButton().getAttribute('aria-haspopup')).toBe('dialog');
      expect(dateButton().querySelector('.chip-caret')).withContext('no caret on the date').toBeNull();
      expect(fixture.nativeElement.querySelector('.currency-chip .chip-caret'))
        .withContext('the menu keeps its caret')
        .not.toBeNull();
    });

    it('asks about another day only on a row that will be imported', () => {
      // An unselected row is not a question: nothing about it reaches the
      // import, and needsDateAnswer already keeps the chip — the Keep that
      // answers — off such a row, so an amber mark and its "keep it, or
      // pick another day" wording would point at a control that is not
      // there.
      const row = makeRow({ id: 'old', date: yesterday(), selected: false });
      render([row], ['old']);

      expect(dateButton().classList.contains('not-today')).withContext('no mark while unselected').toBeFalse();
      expect(dateButton().querySelector('.verify-flag')).withContext('no flag while unselected').toBeNull();
      expect(dateButton().getAttribute('aria-label'))
        .withContext('nothing leads the name while unselected')
        .toBe(`import.changeDate:{"date":"${formatted(row)}"}`);
      expect(questionChips().length).withContext('no question while unselected').toBe(0);

      (fixture.nativeElement.querySelector('.card-select input[type="checkbox"]') as HTMLInputElement).click();
      fixture.detectChanges();

      expect(dateButton().classList.contains('not-today')).withContext('selected: the mark').toBeTrue();
      expect(dateButton().querySelector('.verify-flag')?.textContent?.trim())
        .withContext('selected: the flag')
        .toBe('error_outline');
      expect(questionChips().length).withContext('selected: the question').toBe(1);
      expect(fixture.nativeElement.querySelector('.date-check .extra-text')?.textContent?.trim())
        .toBe(`import.dateNotTodayKeep:{"date":"${formatted(row)}"}`);
    });
  });

  /**
   * The description and the amount are read where they are written, so these
   * cases go through the real controls: a trigger that swaps itself for an
   * input, and the input's own Enter, Escape and blur.
   */
  describe('editing the description and the amount', () => {
    const trigger = (field: 'description' | 'amount') =>
      fixture.nativeElement.querySelector(
        field === 'description' ? '.description-section .inline-edit' : '.amount-section .inline-edit'
      ) as HTMLButtonElement;
    const input = (field: 'description' | 'amount') =>
      fixture.nativeElement.querySelector(`.${field}-input`) as HTMLInputElement | null;

    function render(row: CategorizedImportTransaction): void {
      component.transactions = [row];
      component.categories = [];
      fixture.detectChanges();
    }

    /** Typing, then the key that ends the edit. */
    function type(field: 'description' | 'amount', text: string, key = 'Enter'): void {
      const box = input(field)!;
      box.value = text;
      box.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }

    it('swaps the description for a focused input holding what it said', () => {
      render(makeRow());

      trigger('description').click();
      fixture.detectChanges();

      const box = input('description')!;
      expect(box.value).toBe('Coffee Shop');
      expect(document.activeElement)
        .withContext('the input takes the tap that opened it, so typing starts straight away')
        .toBe(box);
      expect(trigger('description')).withContext('the trigger is gone while editing').toBeNull();
    });

    it('commits a new description on Enter, by identity, and puts the text back', () => {
      const row = makeRow();
      render(row);
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      type('description', '  Kissaten Ueshima  ');
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0][0]).withContext('a new row, not the one the parent holds').not.toBe(row);
      expect(emitted[0][0].description).withContext('trimmed').toBe('Kissaten Ueshima');
      expect(row.description).withContext('the input object is untouched').toBe('Coffee Shop');
      expect(input('description')).withContext('the editor closes on commit').toBeNull();
      expect(trigger('description').textContent?.trim()).toBe('Kissaten Ueshima');
    });

    it('does not commit a second time on the blur that follows Enter', () => {
      // Enter removes the input, and the blur it takes with it arrives at the
      // same handler: without the guard the row is replaced twice, and Task
      // 5's duplicate re-check would run on a row that changed nothing.
      // replaceRow's own indexOf is the second line of defence here — the row
      // this listener still closes over is no longer in the list — so the
      // guard itself is pinned by the Escape and cancel cases below, where
      // the row is still there for a stray blur to overwrite.
      render(makeRow());
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      const box = input('description')!;
      box.value = 'Kissaten';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      box.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
    });

    it('leaves the row alone on Escape, and on the blur Escape takes with it', () => {
      const row = makeRow();
      render(row);
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      const box = input('description')!;
      box.value = 'Something else';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      // The departing input blurs into the same commit handler while the row
      // is still in the list, so nothing but the cleared state stands between
      // that blur and filing the text the reviewer just abandoned.
      box.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(input('description')).withContext('the editor closes on Escape too').toBeNull();
      expect(trigger('description').textContent?.trim()).toBe('Coffee Shop');
    });

    it('treats an emptied description as a cancel', () => {
      // A row with no description reads as nothing at all in the list; the
      // reviewer who cleared the field meant to start over, not to erase it.
      render(makeRow());
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      type('description', '   ');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(trigger('description').textContent?.trim()).toBe('Coffee Shop');
    });

    it('emits nothing when the description comes back the same', () => {
      render(makeRow());
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      type('description', 'Coffee Shop');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
    });

    it('leaves the Enter that confirms an IME composition to the composition', () => {
      // ja and tc type through an IME, where the first Enter accepts the
      // conversion: committing on it would file half of the word the
      // reviewer was writing. Same guard the saved-search label carries.
      render(makeRow());
      const emitted = emissions();

      trigger('description').click();
      fixture.detectChanges();
      const box = input('description')!;
      box.value = '喫茶';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(input('description')).withContext('still editing').not.toBeNull();
    });

    it('names the amount trigger by the figure it is showing', () => {
      render(makeRow({ amount: 538, currency: 'JPY' }));

      expect(trigger('amount').getAttribute('aria-label'))
        .toBe('import.editAmount:{"amount":"JPY 538"}');
    });

    it('commits a typed amount and stops doubting the figure', () => {
      // An amount the reviewer typed is nobody's doubt any more — the same
      // rule the date answer follows.
      const row = makeRow({ amount: 5.5, fieldConfidence: { amount: 0.4, date: 0.3 } });
      render(row);
      expect(fixture.nativeElement.querySelector('.amount-section .verify-flag'))
        .withContext('the amount starts flagged')
        .not.toBeNull();
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '1,234.50');
      fixture.detectChanges();

      expect(emitted[0][0].amount).toBe(1234.5);
      expect(emitted[0][0]).not.toBe(row);
      expect(row.amount).withContext('the input object is untouched').toBe(5.5);
      expect(emitted[0][0].fieldConfidence)
        .withContext('only the amount\'s grade goes; the object is exactly what remains')
        .toEqual({ date: 0.3 });
      expect(fixture.nativeElement.querySelector('.amount-section .verify-flag'))
        .withContext('and the flag with it')
        .toBeNull();
    });

    it('keeps the amount and its grade when nothing usable was typed', () => {
      const row = makeRow({ amount: 5.5, fieldConfidence: { amount: 0.4 } });
      render(row);
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', 'abc');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(component.transactions[0].amount).toBe(5.5);
      expect(component.transactions[0].fieldConfidence).toEqual({ amount: 0.4 });
      expect(fixture.nativeElement.querySelector('.amount-section .verify-flag'))
        .withContext('still flagged, because nothing was answered')
        .not.toBeNull();
    });

    it('emits nothing when the amount comes back the same', () => {
      render(makeRow({ amount: 1234.5 }));
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '1,234.50');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
    });

    it('takes no sign from the amount field — the type toggle owns it', () => {
      const row = makeRow({ amount: 5.5, type: 'expense' });
      render(row);
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '-42');
      fixture.detectChanges();

      expect(emitted[0][0].amount).toBe(42);
      expect(emitted[0][0].type).toBe('expense');
    });

    it('leaves the amount alone on Escape, and on the blur Escape takes with it', () => {
      const row = makeRow({ amount: 5.5, fieldConfidence: { amount: 0.4 } });
      render(row);
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      const box = input('amount')!;
      box.value = '99';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      box.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(component.transactions[0].amount).toBe(5.5);
      expect(component.transactions[0].fieldConfidence)
        .withContext('an abandoned edit settles nothing, so the grade stays')
        .toEqual({ amount: 0.4 });
    });

    it('leaves the Enter that confirms an IME composition alone in the amount too', () => {
      // A reviewer who left the IME in Japanese mode composes digits through
      // it as well, and that first Enter is the one that confirms the
      // conversion — committing on it takes the field away mid-figure.
      render(makeRow({ amount: 5.5 }));
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      const box = input('amount')!;
      box.value = '１２３';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(input('amount')).withContext('still editing').not.toBeNull();
    });

    it('hands focus back to the trigger the editor replaced', () => {
      // Opening an editor takes focus; closing one has to give it back, or a
      // keyboard reviewer is dropped at the document root by every correction
      // and has to walk the whole wizard again to reach the next row.
      render(makeRow());

      trigger('description').click();
      fixture.detectChanges();
      type('description', 'Kissaten');
      fixture.detectChanges();
      expect(document.activeElement).withContext('after a commit').toBe(trigger('description'));

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '99', 'Escape');
      fixture.detectChanges();
      expect(document.activeElement).withContext('after a cancel').toBe(trigger('amount'));
    });

    it('holds the amount editor open and says why when the figure cannot be read', () => {
      // Closing on an unreadable figure filed the old amount and said
      // nothing: the reviewer saw the editor shut, assumed the correction
      // took, and the row went in at the number they had just retyped over.
      render(makeRow({ amount: 5.5 }));
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '1.234.567');
      fixture.detectChanges();

      const box = input('amount')!;
      expect(box).withContext('the editor stays open on what was typed').not.toBeNull();
      expect(box.value).withContext('and keeps it, to be corrected rather than retyped').toBe('1.234.567');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.querySelector('.amount-error')?.textContent?.trim())
        .toBe('import.amountNotANumber:{"minimum":"USD 0.01"}');
      expect(box.getAttribute('aria-describedby'))
        .withContext('the hint names the field it belongs to')
        .toBe(fixture.nativeElement.querySelector('.amount-error')?.id);
      expect(emitted.length).withContext('nothing is filed').toBe(0);
    });

    it('takes the correction that follows a refused figure', () => {
      render(makeRow({ amount: 5.5 }));
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '1.234.567');
      fixture.detectChanges();
      type('amount', '1234.56');
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0][0].amount).toBe(1234.56);
      expect(input('amount')).withContext('a figure it could read closes the editor').toBeNull();
      expect(fixture.nativeElement.querySelector('.amount-error')).toBeNull();
    });

    it('Escape still abandons a refused figure', () => {
      render(makeRow({ amount: 5.5 }));
      const emitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', 'abc');
      fixture.detectChanges();
      type('amount', 'abc', 'Escape');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(input('amount')).toBeNull();
      expect(fixture.nativeElement.querySelector('.amount-error')).toBeNull();
      expect(document.activeElement).withContext('and the trigger takes focus back').toBe(trigger('amount'));
    });

    it('edits one row at a time', () => {
      // The state is a map keyed by row id, so an edit opened on one row must
      // not open an input on every other card in the batch.
      component.transactions = [makeRow({ id: 'a' }), makeRow({ id: 'b', description: 'Bakery' })];
      component.categories = [];
      fixture.detectChanges();

      (fixture.nativeElement.querySelectorAll('.description-section .inline-edit')[1] as HTMLElement).click();
      fixture.detectChanges();

      const boxes = fixture.nativeElement.querySelectorAll('.description-input') as NodeListOf<HTMLInputElement>;
      expect(boxes.length).toBe(1);
      expect(boxes[0].value).toBe('Bakery');
    });

    it('shows a description of nothing but spaces as unfilled, on a box that can be pressed', () => {
      // A quoted "   " cell survives the CSV reader untrimmed, and the gate
      // counts such a row as unfilled. A truthiness test here would render
      // the spaces instead: `.description-text` is fit-content over
      // collapsed whitespace, so the trigger would be about zero-width and
      // the reviewer's only escape from the gate would be deselecting.
      render(makeRow({ description: '   ' }));

      const box = trigger('description');
      expect(box.querySelector('.placeholder')?.textContent?.trim()).toBe('import.addDescription');
      expect(box.getAttribute('aria-label'))
        .withContext('the name says what the placeholder says, not a run of spaces')
        .toBe('import.addDescription');
      expect(box.getBoundingClientRect().width).withContext('a box to press on').toBeGreaterThan(0);
    });

    it('shows an amount that is not positive as unfilled, on both the trigger and its name', () => {
      // Not only a hand-added row: a blank or unreadable CSV cell, a missing
      // total and a refund that cancels its charge all reach the card as 0,
      // with no grade for the verify flag to read. Left as a formatted zero
      // it is an ordinary card the hint's count cannot point at.
      render(makeRow({ amount: 0 }));

      const box = trigger('amount');
      expect(box.querySelector('.placeholder')?.textContent?.trim()).toBe('import.addAmount');
      expect(box.querySelector('.amount-text')).withContext('no figure stands in its place').toBeNull();
      expect(box.getAttribute('aria-label')).toBe('import.addAmount');
    });

    it('leaves a figure it could ship reading as itself', () => {
      render(makeRow({ amount: 5.5 }));

      const box = trigger('amount');
      expect(box.querySelector('.placeholder')).toBeNull();
      expect(box.querySelector('.amount-text')?.textContent?.trim()).toBe('-USD 5.5');
      expect(box.getAttribute('aria-label')).toBe('import.editAmount:{"amount":"USD 5.5"}');
    });

    it('rounds a typed amount to what the currency stores', () => {
      // JPY has no fractional yen: 179.33 settles at 179, and the trigger's
      // own text — driven by the same formatAmount the editor's label uses
      // — reads the row back rounded, not the fraction that was typed.
      render(makeRow({ amount: 5.5, currency: 'JPY' }));
      const jpyEmitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '179.33');
      fixture.detectChanges();

      expect(jpyEmitted[0][0].amount).toBe(179);
      expect(trigger('amount').querySelector('.amount-text')?.textContent?.trim()).toBe('-JPY 179');

      // A row already at the whole-yen figure a typed fraction would round
      // to reads as unchanged even though what was typed is not that
      // figure: the comparison is against 179.33 rounded to 179, not
      // against 179.33 itself, so retyping a fraction the row should never
      // have held commits nothing. The old, unrounded comparison would
      // have written 179.33 back onto a row that already read as 179.
      render(makeRow({ amount: 179, currency: 'JPY' }));
      const unchangedEmitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '179.33');
      fixture.detectChanges();

      expect(unchangedEmitted.length).toBe(0);

      // A currency with three decimals keeps its own precision rather
      // than being flattened to the cent.
      render(makeRow({ amount: 5.5, currency: 'KWD' }));
      const kwdEmitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '1.2345');
      fixture.detectChanges();

      expect(kwdEmitted[0][0].amount).toBe(1.235);
    });

    it('refuses a figure that rounds to nothing, the same on a filled row and one already empty', () => {
      // 0.4 clears parseAmountInput's own >0 guard, so this is not the
      // unreadable-figure path on its face — but JPY has no fractional yen,
      // and 0.4 rounds to a real currency value's absence: 0. Filing it on
      // a filled row would overwrite a real figure with one amountIsUnfilled
      // reads as none at all; filing it on a row already at 0 would close
      // the editor having shown the reviewer nothing changed on a figure
      // they had just typed. Both are the same silent loss an unreadable
      // figure is refused for, so both take that refusal too.
      render(makeRow({ amount: 5.5, currency: 'JPY' }));
      const filledEmitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '0.4');
      fixture.detectChanges();

      const filledBox = input('amount')!;
      expect(filledBox).withContext('the editor stays open on a filled row').not.toBeNull();
      expect(filledBox.getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.querySelector('.amount-error')?.textContent?.trim())
        .toBe('import.amountNotANumber:{"minimum":"JPY 1"}');
      expect(filledEmitted.length).withContext('nothing is filed').toBe(0);
      expect(component.transactions[0].amount).withContext('the old figure stands').toBe(5.5);

      // Escape abandons the refusal (the one deliberate way out, per
      // commitAmount's own doc) so the second precondition starts from a
      // closed editor rather than continuing the first one's session.
      filledBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      render(makeRow({ amount: 0, currency: 'JPY' }));
      const emptyEmitted = emissions();

      trigger('amount').click();
      fixture.detectChanges();
      type('amount', '0.4');
      fixture.detectChanges();

      const emptyBox = input('amount')!;
      expect(emptyBox).withContext('the editor stays open on a row already at 0 too').not.toBeNull();
      expect(emptyBox.getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.querySelector('.amount-error')?.textContent?.trim())
        .toBe('import.amountNotANumber:{"minimum":"JPY 1"}');
      expect(emptyEmitted.length).withContext('nothing is filed').toBe(0);
    });
  });

  describe('the bulk keep on the header', () => {
    const keepAll = () => fixture.nativeElement.querySelector('button.keep-dates') as HTMLButtonElement | null;
    const questionChips = () =>
      fixture.nativeElement.querySelectorAll('.extra-chip.date-check') as NodeListOf<HTMLElement>;
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };

    it('appears only with something to answer', () => {
      // Dated today on purpose: makeRow's own default is a 2024 day, so a row
      // named for today has to be given one or it is a second not-today row
      // and proves nothing about the ones that are asked.
      component.transactions = [makeRow({ id: 'old', date: yesterday() }), makeRow({ id: 'today', date: new Date() })];
      component.categories = [];
      fixture.detectChanges();
      expect(keepAll()).withContext('attention off: nothing is asked').toBeNull();

      // setInput, not an instance assignment: the component is OnPush.
      fixture.componentRef.setInput('dateAttentionIds', new Set(['old', 'today']));
      fixture.detectChanges();
      expect(keepAll()).withContext('attention on: the not-today row is asked').not.toBeNull();
      expect(component.unansweredCount())
        .withContext('and only that row — today\'s is not a question')
        .toBe(1);
      expect(keepAll()!.textContent).toContain('import.keepAllDates');
    });

    it('clicking it answers every row still asked, and the button goes with the questions', () => {
      component.transactions = [makeRow({ id: 'old', date: yesterday() }), makeRow({ id: 'assumed', dateAssumed: true })];
      component.categories = [];
      component.dateAttentionIds = new Set(['old', 'assumed']);
      fixture.detectChanges();
      expect(questionChips().length).toBe(2);
      const emitted = emissions();

      keepAll()!.click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].map(t => t.dateReviewed)).toEqual([true, true]);
      expect(keepAll()).toBeNull();
      expect(questionChips().length).toBe(0);
    });

    it('hands focus to the first row\'s date button, which it has just answered', () => {
      // The button answers every question and then removes itself, so it
      // takes focus down with it unless the answer puts focus somewhere.
      component.transactions = [makeRow({ id: 'old', date: yesterday() }), makeRow({ id: 'older', date: yesterday() })];
      component.categories = [];
      component.dateAttentionIds = new Set(['old', 'older']);
      fixture.detectChanges();
      const button = keepAll()!;
      button.focus();

      button.click();
      fixture.detectChanges();

      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#date-chip-old'));
    });

    it('falls back to the select-all checkbox when no row is left to land on', () => {
      // The header outlives the list, and focus has to have somewhere to go
      // even when there is no card under it.
      component.transactions = [];
      component.categories = [];
      fixture.detectChanges();

      component.keepAllDates();
      fixture.detectChanges();

      expect(document.activeElement)
        .toBe(fixture.nativeElement.querySelector('.header-left input[type="checkbox"]'));
    });
  });
  /**
   * A country the reader concluded without a printed address is written as
   * the row's location by the mapper, so the card has to show it and let it
   * go — through the same removal the location chip already has.
   */
  describe('a country nobody could see', () => {
    const countryChip = () =>
      fixture.nativeElement.querySelector('.extra-chip.country-chip') as HTMLElement | null;

    it('renders the receipt country as a chip, and its remove control clears both marks', () => {
      const row = makeRow({ receiptCountry: 'KR' });
      component.transactions = [row];
      component.categories = [];
      fixture.detectChanges();
      const emitted = emissions();

      const chip = countryChip();
      expect(chip).withContext('the country the mapper would write is on the card').not.toBeNull();
      expect(chip!.querySelector('.country-name')?.textContent?.trim()).toBe('South Korea');
      expect(chip!.querySelector('mat-icon')?.textContent?.trim()).toBe('place');
      const remove = chip!.querySelector('.extra-remove') as HTMLElement;
      expect(remove.getAttribute('aria-label')).toBe('import.removeLocation');

      remove.click();
      fixture.detectChanges();

      const next = emitted[0][0];
      expect(next).not.toBe(row);
      expect(next.location).toBeUndefined();
      expect(next.receiptCountry).toBeUndefined();
      expect(row.receiptCountry).withContext('the input object is untouched').toBe('KR');
      // The consequence, at the chokepoint: nothing left for locationSlot to
      // rebuild a location from.
      expect('location' in toCreateTransactionDTO(next, 'USD')).toBeFalse();
      expect(countryChip()).withContext('the chip goes with the marks').toBeNull();
    });

    it('does not render the country beside a printed address that already carries it', () => {
      component.transactions = [makeRow({ location: { name: 'Myeongdong', country: 'KR' }, receiptCountry: 'KR' })];
      component.categories = [];
      fixture.detectChanges();

      expect(countryChip()).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('.extra-chip').length).withContext('the address chip alone').toBe(1);
    });
  });

  /**
   * Notes go through the real textarea: the input event ngModel listens to,
   * then the blur that files the note. The old textarea wrote straight onto
   * the @Input() object, and could not be opened on a row without a note.
   */
  describe('notes on the card', () => {
    const addButton = () => fixture.nativeElement.querySelector('.add-notes-btn') as HTMLButtonElement | null;
    const textarea = () => fixture.nativeElement.querySelector('.notes-input') as HTMLTextAreaElement | null;

    function render(row: CategorizedImportTransaction): void {
      component.transactions = [row];
      component.categories = [];
      fixture.detectChanges();
    }

    function type(text: string): void {
      const box = textarea()!;
      box.value = text;
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    function leave(): void {
      textarea()!.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();
    }

    it('opens a focused, empty textarea on a row without notes', async () => {
      render(makeRow());
      expect(textarea()).withContext('nothing to edit yet').toBeNull();

      addButton()!.click();
      fixture.detectChanges();

      const box = textarea();
      expect(box).withContext('the textarea replaces the button').not.toBeNull();
      expect(box!.value).toBe('');
      expect(addButton()).toBeNull();
      // The focus hook runs in the tick the zone fires once it is empty, and
      // NgModel writes its first value through a microtask of its own — so
      // unlike the description input, the textarea is focused one microtask
      // after detectChanges returns rather than inside it.
      await fixture.whenStable();
      expect(document.activeElement).withContext('the tap that opened it starts the typing').toBe(box);
    });

    it('files what was typed on a new row, and leaves the input object untouched', async () => {
      const row = makeRow();
      render(row);
      const emitted = emissions();

      addButton()!.click();
      fixture.detectChanges();
      type('  two croissants  ');
      expect(emitted.length).withContext('typing alone files nothing').toBe(0);
      leave();

      expect(emitted.length).toBe(1);
      const next = emitted[0][0];
      expect(next).withContext('a new row, not the one the parent holds').not.toBe(row);
      expect(next.notes).withContext('trimmed').toBe('two croissants');
      expect('notes' in row).withContext('the input object is untouched').toBeFalse();
      expect(textarea()).withContext('the note stays open to read').not.toBeNull();
      await fixture.whenStable();
      expect(textarea()!.value).withContext('and shows what was filed').toBe('two croissants');
    });

    it('files no note at all when the text is cleared', async () => {
      const row = makeRow({ notes: 'keep the receipt' });
      render(row);
      await fixture.whenStable();
      expect(textarea()!.value).toBe('keep the receipt');
      const emitted = emissions();

      type('   ');
      leave();

      const next = emitted[0][0];
      expect(next.notes).toBeUndefined();
      expect(row.notes).withContext('the input object is untouched').toBe('keep the receipt');
      // The confirm step's own rename, then the chokepoint: an absent note is
      // no `note` key, where '' would have been a key holding nothing.
      expect('note' in toCreateTransactionDTO({ ...next, note: next.notes }, 'USD')).toBeFalse();
    });

    it('still edits a row that came with notes', async () => {
      const row = makeRow({ notes: 'a' });
      render(row);
      await fixture.whenStable();
      expect(addButton()).withContext('a row with notes opens straight into the editor').toBeNull();
      const emitted = emissions();

      type('b');
      leave();

      expect(emitted[0][0].notes).toBe('b');
      expect(row.notes).withContext('the input object is untouched').toBe('a');
    });

    it('files nothing for a blur that changed nothing', () => {
      // Leaving an untouched editor, or typing the note the row already has:
      // neither is a change, so neither replaces the row.
      render(makeRow({ notes: 'a' }));
      const emitted = emissions();

      leave();
      type('a');
      leave();

      expect(emitted.length).toBe(0);
    });

    it('closes an editor that was opened by accident and never typed into', () => {
      // Opening one is a single tap on a crowded card. Without this the tap
      // cannot be taken back: an empty box sits on that row for the rest of
      // the review, and there is nothing to press to be rid of it.
      render(makeRow());
      addButton()!.click();
      fixture.detectChanges();
      const emitted = emissions();

      leave();

      expect(emitted.length).withContext('nothing typed, nothing filed').toBe(0);
      expect(textarea()).toBeNull();
      expect(addButton()).withContext('the button comes back').not.toBeNull();
    });

    it('closes an editor whose draft was typed and then emptied again', () => {
      render(makeRow());
      addButton()!.click();
      fixture.detectChanges();

      type('   ');
      leave();

      expect(textarea()).toBeNull();
      expect(addButton()).not.toBeNull();
    });

    it('Escape drops the draft, closes the editor and hands the button its focus back', async () => {
      // The same exit the description and amount editors have: a reviewer
      // who starts a note and thinks better of it leaves nothing behind,
      // and is not dropped at the document root for changing their mind.
      render(makeRow());
      addButton()!.click();
      fixture.detectChanges();
      type('half a thought');
      const emitted = emissions();

      textarea()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(emitted.length).withContext('a cancel files nothing').toBe(0);
      expect(textarea()).toBeNull();
      expect(document.activeElement).toBe(addButton());
    });

    it('Escape on a row that came with notes puts its own note back', async () => {
      // The row's note is what the editor is showing, so there is no
      // button to go back to and nothing to close — only the draft goes.
      const row = makeRow({ notes: 'keep the receipt' });
      render(row);
      await fixture.whenStable();
      const emitted = emissions();

      type('scribble');
      textarea()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(emitted.length).toBe(0);
      expect(textarea()!.value).toBe('keep the receipt');
    });

    it('opens notes on one row at a time', () => {
      component.transactions = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
      component.categories = [];
      fixture.detectChanges();

      (fixture.nativeElement.querySelectorAll('.add-notes-btn')[1] as HTMLElement).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('.notes-input').length).toBe(1);
      expect(fixture.nativeElement.querySelector('[data-row-id="b"] .notes-input')).not.toBeNull();
    });

    it('grows with the draft as it is typed', () => {
      render(makeRow());
      addButton()!.click();
      fixture.detectChanges();
      expect(textarea()!.getAttribute('rows')).toBe('1');

      type('items\nsecond line\nthird');

      expect(textarea()!.getAttribute('rows')).toBe('3');
    });

    it('opens through the card\'s one machine: isEditing(row, "notes") while the box is open, and not once the note is filed', () => {
      const row = makeRow();
      render(row);
      expect(component.isEditing(row, 'notes')).withContext('nothing open yet').toBeFalse();

      addButton()!.click();
      fixture.detectChanges();
      expect(component.isEditing(row, 'notes')).withContext('the row\'s one slot now holds notes').toBeTrue();

      type('two croissants');
      leave();

      expect(component.isEditing(row, 'notes')).withContext('closeEdit cleared the slot on commit').toBeFalse();
    });

    it('Escape in a filed note\'s box drops the draft and leaves the row\'s open description editor alone', async () => {
      // Not cancelEdit: the row's slot holds 'description' here, not
      // 'notes', so cancelNotes must not read that slot as its own to close.
      const row = makeRow({ notes: 'a' });
      render(row);
      component.startEdit(row, 'description');
      fixture.detectChanges();
      const emitted = emissions();

      type('scribble');
      textarea()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      // NgModel writes the reverted value through its own microtask, the
      // same fall case 9 above waits out.
      await fixture.whenStable();

      expect(component.isEditing(row, 'description')).withContext('the row\'s real editor is untouched').toBeTrue();
      expect(fixture.nativeElement.querySelector('.description-input')).withContext('still on the card').not.toBeNull();
      expect(textarea()!.value).withContext('the draft alone goes').toBe('a');
      expect(emitted.length).toBe(0);
    });

    it('opening the notes editor on one row leaves another row\'s open editor alone', () => {
      // The two-row shape sidesteps depending on what a same-row startEdit
      // to 'notes' would do here: editing holds one field per row, and every
      // commit gates on editing.has(row.id), not on which field it names.
      const rowA = makeRow({ id: 'a' });
      const rowB = makeRow({ id: 'b' });
      component.transactions = [rowA, rowB];
      component.categories = [];
      fixture.detectChanges();
      component.startEdit(rowA, 'description');
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('[data-row-id="b"] .add-notes-btn') as HTMLElement).click();
      fixture.detectChanges();

      expect(component.isEditing(rowA, 'description')).withContext('row a keeps its own entry in the per-row map').toBeTrue();
      expect(fixture.nativeElement.querySelector('[data-row-id="a"] .description-input')).withContext('row a\'s editor is still on the card').not.toBeNull();
      expect(component.isEditing(rowB, 'notes')).withContext('row b opened its own entry, not row a\'s').toBeTrue();
      expect(fixture.nativeElement.querySelector('[data-row-id="b"] .notes-input')).withContext('row b\'s box is on the card too').not.toBeNull();
    });
  });

  /**
   * The duplicate verdict was decided inside the import doors, on inputs the
   * reviewer could not change; the badge now carries the overrule. The card's
   * side of it is one replaced row — the wizard reads the flag's true → false
   * off the emission — so what is pinned here is the control and the row it
   * emits.
   */
  describe('the duplicate verdict on the card', () => {
    const clearButtons = () =>
      fixture.nativeElement.querySelectorAll('.duplicate-clear') as NodeListOf<HTMLButtonElement>;
    const yesterday = () => {
      const day = new Date();
      day.setDate(day.getDate() - 1);
      return day;
    };

    it('renders the overrule only on a flagged row, on the badge, named for what it does', () => {
      component.transactions = [
        makeRow({ id: 'flagged', isDuplicate: true, duplicateOf: 'stored-1', selected: false }),
        makeRow({ id: 'clean' }),
      ];
      component.categories = [];
      fixture.detectChanges();

      expect(clearButtons().length).toBe(1);
      const button = clearButtons()[0];
      expect(button.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('flagged');
      expect(button.closest('.duplicate-badge')).withContext('on the badge it answers').not.toBeNull();
      expect(button.getAttribute('aria-label')).toBe('import.notADuplicate');
      expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('close');
    });

    it('clicking it emits the row unflagged and selected, by a new identity', () => {
      const row = makeRow({ isDuplicate: true, duplicateOf: 'stored-1', selected: false });
      component.transactions = [row];
      component.categories = [];
      fixture.detectChanges();
      const emitted = emissions();

      clearButtons()[0].click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      const next = emitted[0][0];
      expect(next).withContext('a new row, not the one the parent holds').not.toBe(row);
      expect(next.isDuplicate).toBeFalse();
      expect(next.duplicateOf).toBeUndefined();
      expect(next.selected).toBeTrue();
      expect(row.isDuplicate).withContext('the input object is untouched').toBeTrue();
      expect(row.selected).toBeFalse();
      expect(clearButtons().length).withContext('the badge goes with the verdict').toBe(0);
    });

    it('hands focus to the description trigger the badge sat above', () => {
      // The button leaves the DOM with the badge it rides on, and a focused
      // element that is removed drops focus at the document root — the same
      // fall the editors' exits guard against, answered the same way.
      component.transactions = [makeRow({ isDuplicate: true, duplicateOf: 'stored-1', selected: false })];
      component.categories = [];
      fixture.detectChanges();
      const button = clearButtons()[0];
      button.focus();
      expect(document.activeElement).withContext('the overrule has focus while it is pressed').toBe(button);

      button.click();
      fixture.detectChanges();

      expect(document.activeElement)
        .toBe(fixture.nativeElement.querySelector('[data-row-id="txn1"] .description-text'));
    });

    it('falls back to the date button when the description editor holds the row', () => {
      // The overrule is reachable while the description is being corrected,
      // and the trigger it usually hands focus to is not on the card then:
      // a selector that matches nothing leaves focus at the document root
      // just as surely as no selector at all.
      component.transactions = [makeRow({ isDuplicate: true, duplicateOf: 'stored-1', selected: false })];
      component.categories = [];
      fixture.detectChanges();
      component.startEdit(component.transactions[0], 'description');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.description-text'))
        .withContext('the trigger is gone while the editor is open')
        .toBeNull();

      clearButtons()[0].click();
      fixture.detectChanges();

      expect(document.activeElement)
        .toBe(fixture.nativeElement.querySelector('[data-row-id="txn1"] .date-chip'));
    });

    it('says what it is by sight as well as by name', () => {
      // import.recheckFailed tells the reviewer to use "Not a duplicate",
      // and this is it: an icon-only × whose name lived only in aria-label,
      // so the instruction named a control nobody could find by looking.
      component.transactions = [makeRow({ isDuplicate: true, duplicateOf: 'stored-1', selected: false })];
      component.categories = [];
      fixture.detectChanges();

      const tooltip = fixture.debugElement.query(By.css('.duplicate-clear')).injector.get(MatTooltip);
      expect(tooltip.message).toBe('import.notADuplicate');
      expect(clearButtons()[0].getAttribute('aria-label'))
        .withContext('one key, so the two names cannot drift')
        .toBe(tooltip.message);
    });

    it('a row that comes back selected joins the date gate if its date needs an answer', () => {
      // needsDateAnswer reads `selected`: a deselected duplicate dated on
      // another day was never a question, and the overrule is what makes it
      // one.
      const row = makeRow({ id: 'old', date: yesterday(), isDuplicate: true, duplicateOf: 'stored-1', selected: false });
      component.transactions = [row];
      component.categories = [];
      component.dateAttentionIds = new Set(['old']);
      fixture.detectChanges();
      expect(component.unansweredCount()).withContext('not asked while deselected').toBe(0);
      const emitted = emissions();

      clearButtons()[0].click();
      fixture.detectChanges();

      expect(needsDateAnswer(emitted[0][0], true)).toBeTrue();
      expect(component.unansweredCount()).toBe(1);
      expect(fixture.nativeElement.querySelector('.extra-chip.date-check'))
        .withContext('the question renders on the row now')
        .not.toBeNull();
    });
  });

  describe('adding a tag from the account\'s own vocabulary', () => {
    const addTrigger = (id = 'txn1') =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .tag-add`) as HTMLButtonElement | null;
    const box = (id = 'txn1') =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .tag-input`) as HTMLInputElement | null;

    function render(rows: CategorizedImportTransaction[], vocabulary: readonly string[] = []): void {
      component.transactions = rows;
      component.categories = [];
      component.tagVocabulary = vocabulary;
      fixture.detectChanges();
    }

    /** Typing, then the key that ends the edit. */
    function type(text: string, key = 'Enter', init: KeyboardEventInit = {}): void {
      const input = box()!;
      input.value = text;
      input.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
      fixture.detectChanges();
    }

    it('offers what the account already files by, through one native list', () => {
      render([makeRow()], ['coffee', 'work']);

      const list = fixture.nativeElement.querySelector('datalist') as HTMLDataListElement;
      expect(Array.from(list.options).map(option => option.value)).toEqual(['coffee', 'work']);
      expect(fixture.nativeElement.querySelectorAll('datalist').length)
        .withContext('one list for the card, not one per row')
        .toBe(1);
    });

    it('gives each card a list of its own, so two on a page cannot share one', () => {
      render([makeRow()], ['coffee']);
      const other = TestBed.createComponent(TransactionPreviewTableComponent);
      other.componentInstance.transactions = [makeRow()];
      other.componentInstance.categories = [];
      other.componentInstance.tagVocabulary = ['work'];
      other.detectChanges();

      const listId = (root: HTMLElement) => (root.querySelector('datalist') as HTMLElement).id;
      try {
        expect(listId(fixture.nativeElement)).not.toBe(listId(other.nativeElement));
      } finally {
        other.destroy();
      }
    });

    it('opens a focused input pointed at that list', () => {
      render([makeRow()], ['coffee']);

      addTrigger()!.click();
      fixture.detectChanges();

      const input = box()!;
      expect(input.getAttribute('list')).toBe(component.vocabularyListId);
      expect(document.activeElement)
        .withContext('the tap that opened it starts the typing')
        .toBe(input);
      expect(addTrigger()).withContext('the trigger is gone while editing').toBeNull();
    });

    it('files one tag on Enter, spelled the one way, on a new row', () => {
      const row = makeRow({ tags: ['coffee'] });
      render([row]);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      type('Lunch ');

      expect(emitted.length).toBe(1);
      expect(emitted[0][0]).withContext('a new row, not the one the parent holds').not.toBe(row);
      expect(emitted[0][0].tags).toEqual(['coffee', 'lunch']);
      expect(row.tags).withContext('the input object is untouched').toEqual(['coffee']);
      expect(box()).withContext('the editor closes on commit').toBeNull();
    });

    it('files nothing for a tag the row already carries', () => {
      // Normalized on the way in, so the same tag in another case is the
      // same tag — a second chip saying `coffee` is not an edit.
      render([makeRow({ tags: ['coffee'] })]);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      type('Coffee');

      expect(emitted.length).toBe(0);
      expect(box()).withContext('the editor still closes').toBeNull();
    });

    it('files nothing for a tag the row arrived carrying in another case', () => {
      // A JSON backup restores its tags verbatim, so a row can hold `Coffee`
      // while the vocabulary — normalized — offers `coffee`. Comparing the
      // typed tag against the raw list files both, and the mapper passes
      // tags straight through: two chips of one tag on the stored row.
      render([makeRow({ tags: ['Coffee'] })], ['coffee']);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      type('coffee');

      expect(emitted.length).toBe(0);
      expect(box()).withContext('the editor still closes').toBeNull();
    });

    it('files nothing on Escape, or on a commit with nothing in the field', () => {
      render([makeRow()]);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      type('lunch', 'Escape');
      expect(emitted.length).withContext('a cancel files nothing').toBe(0);
      expect(box()).toBeNull();

      addTrigger()!.click();
      fixture.detectChanges();
      type('   ');
      expect(emitted.length).withContext('an emptied field is a reviewer starting over').toBe(0);
      expect(box()).toBeNull();
    });

    it('files one tag for the Enter and the blur it is followed by', () => {
      // Both handlers reach the same commit, and the second one runs while
      // the input is still on the card: without the guard the row would take
      // the tag twice and the second emission would be a no-op edit.
      render([makeRow()]);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      const input = box()!;
      input.value = 'lunch';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      input.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0][0].tags).toEqual(['lunch']);
    });

    it('ignores the Enter that confirms an IME conversion', () => {
      // ja and tc type through an IME, where the first Enter confirms the
      // conversion rather than finishing the tag.
      render([makeRow()]);
      const emitted = emissions();

      addTrigger()!.click();
      fixture.detectChanges();
      type('弁当', 'Enter', { isComposing: true });

      expect(emitted.length).toBe(0);
      expect(box()).withContext('still editing').not.toBeNull();
    });

    it('hands focus back to the trigger the input replaced', () => {
      // A keyboard reviewer adding a tag to each of twenty rows is dropped at
      // the document root by every one of them otherwise.
      render([makeRow()]);

      addTrigger()!.click();
      fixture.detectChanges();
      type('lunch');

      expect(document.activeElement).toBe(addTrigger());
    });

    it('hands focus to the add-tag trigger when a tag is removed', () => {
      // The chip's own remove button leaves with the chip; the add trigger
      // is what stands in its place.
      render([makeRow({ tags: ['coffee'] })]);

      (fixture.nativeElement.querySelector('.tag-chip .extra-remove') as HTMLElement).click();
      fixture.detectChanges();

      expect(document.activeElement).toBe(addTrigger());
    });
  });

  /**
   * 0068 gave the card a country it could render; this is the reviewer
   * answering it. The place name is typed like a description, the country
   * picked off the same list the transaction filter offers — and a country
   * chosen by hand has to clear `receiptCountry`, or the mapper's
   * `?? row.receiptCountry` fallback rebuilds the one that was replaced.
   */
  describe('editing the location and its country', () => {
    const chip = () => fixture.nativeElement.querySelector('.extra-chip') as HTMLElement | null;
    const nameTrigger = () => fixture.nativeElement.querySelector('.place-name') as HTMLButtonElement | null;
    const nameInput = () => fixture.nativeElement.querySelector('.place-input') as HTMLInputElement | null;
    const countryButton = () => fixture.nativeElement.querySelector('.extra-country') as HTMLButtonElement | null;
    const addTrigger = () => fixture.nativeElement.querySelector('.location-add') as HTMLButtonElement | null;

    function render(row: CategorizedImportTransaction): void {
      component.transactions = [row];
      component.categories = [];
      fixture.detectChanges();
    }

    /** Typing into the open name editor, then the key that ends the edit. */
    function type(text: string, key = 'Enter'): void {
      const input = nameInput()!;
      input.value = text;
      input.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fixture.detectChanges();
    }

    /** The lazy menu's items, which do not exist until it is opened. */
    function openCountryMenu(): HTMLElement[] {
      countryButton()!.click();
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel .mat-mdc-menu-item'));
    }

    it('names the place on its own trigger, and opens a focused field holding it', () => {
      render(makeRow({ location: { name: 'Myeongdong', country: 'KR' } }));

      expect(nameTrigger()!.getAttribute('aria-label'))
        .toBe('import.editPlaceName:{"name":"Myeongdong"}');

      nameTrigger()!.click();
      fixture.detectChanges();

      const input = nameInput()!;
      expect(input.value).withContext('the editor starts from what is there').toBe('Myeongdong');
      expect(document.activeElement)
        .withContext('the tap that opened it starts the typing')
        .toBe(input);
    });

    it('files a corrected name and leaves the country where it was', () => {
      const row = makeRow({ location: { name: 'Myeongdong', country: 'KR' } });
      render(row);
      const emitted = emissions();

      nameTrigger()!.click();
      fixture.detectChanges();
      type('  Insadong  ');

      expect(emitted.length).toBe(1);
      expect(emitted[0][0]).withContext('a new row, not the one the parent holds').not.toBe(row);
      expect(emitted[0][0].location).toEqual({ name: 'Insadong', country: 'KR' });
      expect(row.location)
        .withContext('the input object is untouched')
        .toEqual({ name: 'Myeongdong', country: 'KR' });
    });

    it('keeps the country when the name is emptied, and the chip with it', () => {
      // The country is a separate fact the reviewer did not withdraw —
      // dropping it here would be the removal button's job, not this one's.
      render(makeRow({ location: { name: 'Myeongdong', country: 'KR' } }));
      const emitted = emissions();

      nameTrigger()!.click();
      fixture.detectChanges();
      type('   ');

      expect(emitted[0][0].location).toEqual({ country: 'KR' });
      expect(chip()).withContext('a country with no name is still a chip').not.toBeNull();
      expect(chip()!.classList).toContain('country-chip');
    });

    it('keeps a coordinate the row arrived with when the name is emptied', () => {
      // The receipt door attaches no coordinate, but it is not the only door:
      // a restored backup's row is rebuilt through locationSlotFrom, which
      // carries the location whole. The name is the one fact this edit
      // withdraws.
      render(makeRow({ location: { name: 'Myeongdong', lat: 37.56, lng: 126.98, country: 'KR' } }));
      const emitted = emissions();

      nameTrigger()!.click();
      fixture.detectChanges();
      type('   ');

      expect(emitted[0][0].location).toEqual({ lat: 37.56, lng: 126.98, country: 'KR' });
    });

    it('drops the location when the name is emptied and there is no country under it', () => {
      render(makeRow({ location: { name: 'Myeongdong' } }));
      const emitted = emissions();

      nameTrigger()!.click();
      fixture.detectChanges();
      type('   ');

      expect(emitted[0][0].location).toBeUndefined();
      expect(chip()).withContext('nothing left to render').toBeNull();
    });

    it('hands focus to the add trigger when the commit takes the chip away', () => {
      // The keyboard path through the case above: the trigger the editor
      // replaced leaves the card with the chip, and a focus call that finds
      // nothing drops the reviewer at the document root.
      render(makeRow({ location: { name: 'Myeongdong' } }));

      nameTrigger()!.click();
      fixture.detectChanges();
      type('   ');

      expect(addTrigger()).withContext('what stands where the chip stood').not.toBeNull();
      expect(document.activeElement).toBe(addTrigger());
    });

    it('hands focus back to the trigger the field replaced', () => {
      // A keyboard reviewer walking down the batch is dropped at the document
      // root by every correction otherwise.
      render(makeRow({ location: { name: 'Myeongdong' } }));

      nameTrigger()!.click();
      fixture.detectChanges();
      type('Insadong');

      expect(document.activeElement).toBe(nameTrigger());
    });

    it('names the country on its own button and lists the rest under it', () => {
      render(makeRow({ location: { name: 'Shibuya', country: 'JP' } }));

      expect(countryButton()!.textContent?.trim()).toBe('Japan');
      expect(countryButton()!.getAttribute('aria-label')).toBe('import.changeCountry:{"country":"Japan"}');

      const items = openCountryMenu();
      expect(items[0].textContent?.trim())
        .withContext('the way out leads the list')
        .toBe('import.noCountry');
      expect(items.length).withContext('the bundled table, plus the way out').toBe(80);
      expect(items.filter(item => item.classList.contains('current')).length).toBe(1);
      expect(items.find(item => item.classList.contains('current'))?.textContent?.trim()).toBe('Japan');
    });

    it('offers no way out when there is no country to withdraw', () => {
      render(makeRow({ location: { name: 'Shibuya' } }));

      expect(countryButton()!.getAttribute('aria-label')).toBe('import.setCountry');
      expect(countryButton()!.querySelector('mat-icon')?.textContent?.trim()).toBe('public');
      expect(openCountryMenu()[0].textContent?.trim()).not.toBe('import.noCountry');
    });

    it('files a hand-picked country on a row that only had a name', () => {
      render(makeRow({ location: { name: 'Shibuya' } }));
      const emitted = emissions();

      openCountryMenu().find(item => item.textContent?.trim() === 'South Korea')!.click();
      fixture.detectChanges();

      expect(emitted[0][0].location).toEqual({ name: 'Shibuya', country: 'KR' });
      expect(emitted[0][0].receiptCountry).toBeUndefined();
    });

    it('replaces a concluded country with the picked one, and drops the conclusion', () => {
      // The hand is the evidence now. Leaving the mark behind would let the
      // DTO's `?? row.receiptCountry` rebuild the country just overruled the
      // moment the location is cleared again.
      const row = makeRow({ receiptCountry: 'KR' });
      render(row);
      const emitted = emissions();

      openCountryMenu().find(item => item.textContent?.trim() === 'Japan')!.click();
      fixture.detectChanges();

      const next = emitted[0][0];
      expect(next.location).toEqual({ country: 'JP' });
      expect(next.receiptCountry).toBeUndefined();
      expect(row.receiptCountry).withContext('the input object is untouched').toBe('KR');
      expect(toCreateTransactionDTO(next, 'USD').location).toEqual({ country: 'JP' });
    });

    it('withdraws the country and keeps the name', () => {
      render(makeRow({ location: { name: 'Shibuya', country: 'JP' } }));
      const emitted = emissions();

      openCountryMenu()[0].click();
      fixture.detectChanges();

      const next = emitted[0][0];
      expect(next.location?.name).toBe('Shibuya');
      expect(next.location?.country).toBeUndefined();
      expect(chip()).withContext('the place is still on the card').not.toBeNull();
    });

    it('withdraws a concluded country outright, leaving nothing to rebuild it from', () => {
      render(makeRow({ receiptCountry: 'KR' }));
      const emitted = emissions();

      openCountryMenu()[0].click();
      fixture.detectChanges();

      const next = emitted[0][0];
      expect(next.location).toBeUndefined();
      expect(next.receiptCountry).toBeUndefined();
      expect('location' in toCreateTransactionDTO(next, 'USD')).toBeFalse();
      expect(chip()).withContext('the chip goes with the marks').toBeNull();
    });

    it('hands focus to the add trigger when the withdrawal takes the chip away', () => {
      // The country button goes with the chip, so the selector focus was
      // aimed at is no longer on the card; without the fallback the reviewer
      // is left at the document root.
      render(makeRow({ receiptCountry: 'KR' }));

      openCountryMenu()[0].click();
      fixture.detectChanges();

      expect(addTrigger()).withContext('what stands where the chip stood').not.toBeNull();
      expect(document.activeElement).toBe(addTrigger());
    });

    it('hands focus to the add trigger when the removal takes the chip away', () => {
      // The remove button goes with the whole chip, the same drop as the
      // withdrawal above.
      render(makeRow({ location: { name: 'Myeongdong' } }));

      (chip()!.querySelector('.extra-remove') as HTMLElement).click();
      fixture.detectChanges();

      expect(addTrigger()).withContext('what stands where the chip stood').not.toBeNull();
      expect(document.activeElement).toBe(addTrigger());
    });

    it('withdraws a country-only location the same way, chip and focus alike', () => {
      // The withdrawal keeps the location only when a name is under it, so a
      // location that was never more than a country loses its chip exactly as
      // the concluded mark does — and the country button with it.
      render(makeRow({ location: { country: 'KR' } }));
      const emitted = emissions();

      openCountryMenu()[0].click();
      fixture.detectChanges();

      expect(emitted[0][0].location).toBeUndefined();
      expect(chip()).toBeNull();
      expect(document.activeElement).toBe(addTrigger());
    });

    it('offers the same editor on a row the source said nothing about', () => {
      render(makeRow());

      expect(chip()).withContext('nothing to show yet').toBeNull();
      expect(addTrigger()).not.toBeNull();

      addTrigger()!.click();
      fixture.detectChanges();
      const emitted = emissions();
      type('Shibuya');

      expect(emitted[0][0].location).toEqual({ name: 'Shibuya' });
      expect(addTrigger()).withContext('the trigger gives way to the chip').toBeNull();
    });

    it('carries no add trigger on a row that already has a location', () => {
      render(makeRow({ location: { country: 'KR' } }));

      expect(addTrigger()).toBeNull();
    });
  });

  /**
   * The reader that ran out of room leaves items off the end of the list, and
   * the notice above tells the reviewer to add them. This is the control that
   * lets them. It sits under the whole list rather than in a row: it adds a
   * row, it does not edit one.
   */
  describe('adding a row by hand', () => {
    const addButton = () => fixture.nativeElement.querySelector('.add-row') as HTMLButtonElement | null;
    const descriptionInput = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .description-input`) as HTMLInputElement | null;
    const placeholder = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .description-text .placeholder`) as HTMLElement | null;

    function render(rows: CategorizedImportTransaction[], defaultCurrency = 'USD'): void {
      component.transactions = rows;
      component.categories = [];
      component.defaultCurrency = defaultCurrency;
      fixture.detectChanges();
    }

    /** The parent, which is what puts the emitted array back on the card. */
    function bindParent(): void {
      component.transactionsUpdated.subscribe(rows => (component.transactions = rows));
    }

    function selections(): Set<string>[] {
      const emitted: Set<string>[] = [];
      component.selectionChanged.subscribe(ids => emitted.push(ids));
      return emitted;
    }

    it('appends a blank row dated and denominated like the one above it', () => {
      const previous = makeRow({ currency: 'KRW', date: new Date(2026, 5, 14, 9, 0) });
      const given = [previous];
      render(given);
      const emitted = emissions();

      addButton()!.click();

      expect(emitted.length).toBe(1);
      // The array the parent still holds, not the card's field, which the
      // card reassigns: a push onto the input would pass against that one.
      expect(given.length).withContext('never mutates the @Input() array').toBe(1);
      expect(emitted[0]).withContext('a new array, as every other edit emits').not.toBe(given);
      expect(emitted[0].length).toBe(2);
      const added = emitted[0][1];
      expect(added.id).toMatch(/^manual_/);
      expect(added.description).toBe('');
      expect(added.amount).toBe(0);
      expect(added.currency).withContext('the trip\'s currency, not the account\'s').toBe('KRW');
      expect(added.date.getTime()).toBe(previous.date.getTime());
      expect(added.selected).toBeTrue();
    });

    it('falls back to the currency the wizard passes when there is no row above it', () => {
      // The card renders its empty state at the same time; the control is
      // under the list rather than inside it, so it is still there.
      render([], 'JPY');
      const emitted = emissions();

      expect(addButton()).withContext('offered on an empty list too').not.toBeNull();
      addButton()!.click();

      expect(emitted[0][0].currency).toBe('JPY');
    });

    it('opens the new row in its description editor, with the caret already in it', () => {
      // Seeded before the emission, so the row renders as an input the
      // moment the parent binds it — the tap that added the row is the tap
      // that starts typing, exactly as every other editor on this card.
      render([makeRow()]);
      const emitted = emissions();
      bindParent();

      addButton()!.click();
      const added = emitted[0][1];
      expect(component.isEditing(added, 'description'))
        .withContext('in edit mode before the parent has re-bound anything')
        .toBeTrue();

      fixture.detectChanges();

      const input = descriptionInput(added.id);
      expect(input).withContext('the row rendered as an editor').not.toBeNull();
      expect(document.activeElement).toBe(input);
    });

    it('reports the new row selected alongside the rows already chosen', () => {
      // Import counts the selection, not the array: a row added and left out
      // of it would be typed into and then silently dropped.
      render([makeRow({ id: 'kept' }), makeRow({ id: 'left-out', selected: false })]);
      const emitted = emissions();
      const selected = selections();

      addButton()!.click();

      expect(selected.length).toBe(1);
      expect(selected[0]).toEqual(new Set(['kept', emitted[0][2].id]));
    });

    it('mints an id of its own for every row added', () => {
      render([makeRow()]);
      const emitted = emissions();
      bindParent();

      addButton()!.click();
      fixture.detectChanges();
      addButton()!.click();

      expect(emitted[1].length).toBe(3);
      expect(emitted[1][2].id).not.toBe(emitted[1][1].id);
    });

    it('shows a blank description as waiting to be filled, and a typed one as itself', () => {
      // Both halves of a hand-added row say so; the amount's own placeholder
      // is pinned in the editors' describe, with the whitespace case.
      render([makeRow({ id: 'blank', description: '' }), makeRow({ id: 'filled', description: 'Coffee' })]);

      expect(placeholder('blank')?.textContent?.trim()).toBe('import.addDescription');
      expect(placeholder('filled')).withContext('nothing missing here').toBeNull();
    });
  });

  /**
   * A receipt whose line items the reader merged into one row, taken apart
   * before the import (#371). Merge is a separate control (Task 5); this is
   * the half that moves an amount off a row into a new one.
   */
  describe('splitting a row', () => {
    const splitTrigger = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .split-trigger`) as HTMLButtonElement | null;
    const splitInput = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .split-input`) as HTMLInputElement | null;
    const refusal = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .amount-error`) as HTMLElement | null;
    const descriptionInput = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .description-input`) as HTMLInputElement | null;
    const receiptBadges = () =>
      Array.from(fixture.nativeElement.querySelectorAll('.receipt-badge')) as HTMLElement[];

    function render(rows: CategorizedImportTransaction[]): void {
      component.transactions = rows;
      component.categories = [];
      fixture.detectChanges();
    }

    /** Typing, then the key that ends the edit. */
    function type(id: string, text: string, key = 'Enter'): void {
      const box = splitInput(id)!;
      box.value = text;
      box.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }

    it('renders on a filled row and not on a row with no amount', () => {
      render([makeRow({ id: 'filled' }), makeRow({ id: 'empty', amount: 0 })]);

      expect(splitTrigger('filled')).withContext('an amount to take off').not.toBeNull();
      expect(splitTrigger('empty')).withContext('nothing to split off zero').toBeNull();
    });

    it('renders on a row worth twice its currency\'s minor unit, and not on one worth exactly one', () => {
      // ¥1 has no split that leaves a positive whole yen on both halves —
      // every figure satisfies at most one of splitAmountRefused's two
      // clauses at once. ¥2 is the least that clears both.
      render([makeRow({ id: 'two', amount: 2, currency: 'JPY' }), makeRow({ id: 'one', amount: 1, currency: 'JPY' })]);

      expect(splitTrigger('two')).withContext('¥2 can leave ¥1 on each half').not.toBeNull();
      expect(splitTrigger('one')).withContext('¥1 has no split that clears the floor twice').toBeNull();
    });

    it('names itself "Split" rather than "Add a description" on a row with no description yet', () => {
      render([makeRow({ id: 'txn1', description: '' })]);

      expect(splitTrigger('txn1')!.getAttribute('aria-label')).toBe('import.splitRow');
    });

    it('opens a focused split input on click', () => {
      render([makeRow({ id: 'txn1' })]);

      splitTrigger('txn1')!.click();
      fixture.detectChanges();

      const box = splitInput('txn1')!;
      expect(document.activeElement).withContext('the tap that opened it starts typing').toBe(box);
      expect(splitTrigger('txn1')).withContext('the trigger is gone while editing').toBeNull();
    });

    it('splits the amount into two rows on Enter, and opens the new part\'s description editor', async () => {
      const row = makeRow({
        id: 'txn1',
        amount: 5400,
        currency: 'JPY',
        imageMetadata: { imageIndex: 0, imageId: 'image_0', positionInImage: 'top', confidenceScore: 0.9, receiptId: 3 },
      });
      const given = [row];
      render(given);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      type('txn1', '1,200');
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(given.length).withContext('never mutates the @Input() array').toBe(1);
      expect(emitted[0]).withContext('a new array, as every other edit emits').not.toBe(given);
      expect(emitted[0].length).toBe(2);
      const [kept, part] = emitted[0];
      expect(kept.id).withContext('the original keeps its identity').toBe('txn1');
      expect(kept.amount).toBe(4200);
      expect(part.id).toMatch(/^split_/);
      expect(part.amount).toBe(1200);
      expect(part.splitFrom).toBe('txn1');
      expect(component.isEditing(part, 'description'))
        .withContext('the part is born already open in its own editor')
        .toBeTrue();

      await fixture.whenStable();
      fixture.detectChanges();

      const description = descriptionInput(part.id);
      expect(description).withContext('the part rendered as a description editor').not.toBeNull();
      expect(document.activeElement).toBe(description);
    });

    it('carries the receipt badge to the split part unchanged', () => {
      render([makeRow({
        id: 'txn1',
        amount: 5400,
        imageMetadata: { imageIndex: 0, imageId: 'image_0', positionInImage: 'top', confidenceScore: 0.9, receiptId: 3 },
      })]);

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      type('txn1', '1,200');
      fixture.detectChanges();

      const badges = receiptBadges();
      expect(badges.length).withContext('both halves show a badge').toBe(2);
      expect(badges[0].textContent?.trim())
        .withContext('the same receipt and photo as the original')
        .toBe(badges[1].textContent?.trim());
    });

    it('rejects an unreadable figure, the whole amount, and more than the whole amount, without emitting', () => {
      render([makeRow({ id: 'txn1', amount: 5400 })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();

      for (const value of ['abc', '5400', '6000']) {
        type('txn1', value);
        fixture.detectChanges();

        const box = splitInput('txn1');
        expect(box).withContext(`editor stays open for ${value}`).not.toBeNull();
        expect(box!.getAttribute('aria-invalid')).withContext(value).toBe('true');
      }
      expect(emitted.length).toBe(0);
    });

    it('rejects a figure that only rounds to zero or to the whole amount, the same as one that already is', () => {
      // 19.999 and 0.004 both clear parseAmountInput's own >0 guard and
      // read as less than a 20 row's amount — splitImportRow is what
      // catches them, once its rounding puts one at the row's own amount
      // and the other at zero. A guard here that disagreed with that one
      // would close the editor on a figure splitImportRow was about to
      // refuse.
      render([makeRow({ id: 'txn1', amount: 20 })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();

      for (const value of ['19.999', '0.004']) {
        type('txn1', value);
        fixture.detectChanges();

        const box = splitInput('txn1');
        expect(box).withContext(`editor stays open for ${value}`).not.toBeNull();
        expect(box!.getAttribute('aria-invalid')).withContext(value).toBe('true');
      }
      expect(emitted.length).toBe(0);
    });

    it('says why it refused: the input names a message, and the message is an alert', () => {
      // aria-invalid alone tells a screen reader only that the figure was
      // refused, and a sighted reviewer only that the editor would not
      // close. The message is the amount editor's own pair, an alert for
      // the amount editor's reason: the commit that refused is often a
      // blur, by which time the reviewer is on the next card.
      render([makeRow({ id: 'txn1', amount: 5400 })]);

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      type('txn1', '6000');
      fixture.detectChanges();

      const box = splitInput('txn1')!;
      const message = refusal('txn1');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(message).withContext('the refusal is written down').not.toBeNull();
      expect(message!.getAttribute('role')).toBe('alert');
      expect(message!.textContent?.trim()).toBe('import.splitAmountRefused:{"minimum":"USD 0.01"}');
      expect(message!.id).toBe('split-error-txn1');
      expect(box.getAttribute('aria-describedby'))
        .withContext('the input names the message it stands with')
        .toBe(message!.id);
    });

    it('drops the message once a figure is taken, and opens clean the next time', () => {
      render([makeRow({ id: 'txn1', amount: 5400 })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      type('txn1', '6000');
      fixture.detectChanges();
      expect(refusal('txn1')).withContext('refused first').not.toBeNull();

      type('txn1', '1,200');
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(splitInput('txn1')).withContext('a figure the row can spare closes the editor').toBeNull();
      expect(refusal('txn1')).withContext('and takes the message with it').toBeNull();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();

      const box = splitInput('txn1')!;
      expect(box.getAttribute('aria-invalid')).toBeNull();
      expect(box.getAttribute('aria-describedby')).toBeNull();
      expect(refusal('txn1')).withContext('the refusal does not outlive the editor it was made in').toBeNull();
    });

    it('closes on a blur with nothing typed, rather than hold an empty figure open as unreadable', () => {
      render([makeRow({ id: 'txn1' })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      splitInput('txn1')!.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(splitInput('txn1')).withContext('closes instead of stranding an empty, invalid editor').toBeNull();
      expect(splitTrigger('txn1')).withContext('the trigger is back').not.toBeNull();
    });

    it('closes on Enter with nothing but spaces typed too, the same as blur', () => {
      render([makeRow({ id: 'txn1' })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      type('txn1', '   ');
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(splitInput('txn1')).toBeNull();
      expect(document.activeElement).withContext('a key hands focus back to the trigger').toBe(splitTrigger('txn1'));
    });

    it('emits nothing and returns focus to the trigger on Escape', () => {
      render([makeRow({ id: 'txn1', amount: 5400 })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      const box = splitInput('txn1')!;
      box.value = '1,200';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(splitInput('txn1')).toBeNull();
      expect(document.activeElement).toBe(splitTrigger('txn1'));
    });

    it('leaves a composing Enter to the IME', () => {
      render([makeRow({ id: 'txn1', amount: 5400 })]);
      const emitted = emissions();

      splitTrigger('txn1')!.click();
      fixture.detectChanges();
      const box = splitInput('txn1')!;
      box.value = '1200';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(splitInput('txn1')).withContext('still editing').not.toBeNull();
    });
  });

  /**
   * Two rows that belong to one purchase — a receipt the reader split across
   * two photos, or a wrong split — joined before the import (#371). This is
   * the other half of the pair splitting a row started above.
   */
  describe('merging a row into another', () => {
    const mergeTrigger = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .merge-trigger`) as HTMLButtonElement | null;
    const descriptionTrigger = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .description-section .inline-edit`) as HTMLButtonElement | null;
    const formattedDate = (row: CategorizedImportTransaction) =>
      TestBed.inject(LocaleFormatService).formatDate(row.date);

    function render(rows: CategorizedImportTransaction[]): void {
      component.transactions = rows;
      component.categories = [];
      fixture.detectChanges();
    }

    /** The lazy menu's items, which do not exist until it is opened. */
    function openMergeMenu(id: string): HTMLElement[] {
      mergeTrigger(id)!.click();
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel .mat-mdc-menu-item'));
    }

    it('renders the trigger only on a row another row shares a currency with', () => {
      render([
        makeRow({ id: 'a', currency: 'USD' }),
        makeRow({ id: 'b', currency: 'USD' }),
        makeRow({ id: 'c', currency: 'KRW' }),
      ]);

      expect(mergeTrigger('a')).not.toBeNull();
      expect(mergeTrigger('b')).not.toBeNull();
      expect(mergeTrigger('c')).withContext('nothing else is in KRW').toBeNull();
    });

    it('names the trigger after the row', () => {
      render([
        makeRow({ id: 'a', currency: 'USD', description: 'Coffee' }),
        makeRow({ id: 'b', currency: 'USD', description: 'Lunch' }),
      ]);

      expect(mergeTrigger('a')!.getAttribute('aria-label')).toBe('import.mergeIntoLabel:{"description":"Coffee"}');
      expect(mergeTrigger('b')!.getAttribute('aria-label')).toBe('import.mergeIntoLabel:{"description":"Lunch"}');
    });

    it('keeps a blank row out of a merge on either side: no trigger of its own, not listed on another\'s', () => {
      // A hand-added row is filled first: merged into, its placeholder
      // category and copied date would win, and the empty description is
      // the only part of that the unfilled gate would catch.
      render([
        makeRow({ id: 'a', currency: 'USD', description: 'Coffee' }),
        makeRow({ id: 'b', currency: 'USD', description: 'Lunch' }),
        makeRow({ id: 'c', currency: 'USD', description: '' }),
        makeRow({ id: 'd', currency: 'USD', description: 'Water', amount: 0 }),
      ]);

      expect(mergeTrigger('c')).withContext('no description yet').toBeNull();
      expect(mergeTrigger('d')).withContext('no amount yet').toBeNull();
      const items = openMergeMenu('a');
      expect(items.length).withContext('b only').toBe(1);
      expect(items[0].textContent).toContain('Lunch');
    });

    it('keeps a flagged row out of a merge on either side until the badge\'s own control overrules it', () => {
      // The verdict is answered by the overrule, never cleared on the way
      // through a merge — a re-check that then failed would leave a real
      // duplicate unflagged and selected.
      render([
        makeRow({ id: 'a', currency: 'USD', description: 'Coffee' }),
        makeRow({ id: 'b', currency: 'USD', description: 'Lunch' }),
        makeRow({ id: 'c', currency: 'USD', description: 'Snacks', isDuplicate: true, duplicateOf: 'stored-1', selected: false }),
      ]);

      expect(mergeTrigger('c')).withContext('flagged').toBeNull();
      expect(openMergeMenu('a').length).withContext('b only').toBe(1);

      (fixture.nativeElement.querySelector('[data-row-id="c"] .duplicate-clear') as HTMLElement).click();
      fixture.detectChanges();

      expect(mergeTrigger('c')).withContext('overruled, so back in').not.toBeNull();
      expect(document.querySelectorAll('.mat-mdc-menu-panel .mat-mdc-menu-item').length)
        .withContext('b and c, in the menu a still has open')
        .toBe(2);
    });

    it('offers no trigger on a row whose only same-currency company is blank or flagged', () => {
      render([
        makeRow({ id: 'a', currency: 'USD', description: 'Coffee' }),
        makeRow({ id: 'b', currency: 'USD', description: '' }),
        makeRow({ id: 'c', currency: 'USD', description: 'Snacks', isDuplicate: true, selected: false }),
      ]);

      expect(mergeTrigger('a')).withContext('nothing mergeable to offer').toBeNull();
    });

    it('keeps the trigger count right once an edit has replaced the array', () => {
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee' });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch' });
      const c = makeRow({ id: 'c', currency: 'USD', description: 'Snacks' });
      render([a, b, c]);
      // The parent puts every emitted array back through the input, which
      // is what marks this OnPush card for a re-render an instance
      // assignment would not — and the array the census is keyed on.
      component.transactionsUpdated.subscribe(rows => fixture.componentRef.setInput('transactions', rows));
      const triggers = () => (fixture.nativeElement.querySelectorAll('.merge-trigger') as NodeListOf<HTMLElement>).length;
      expect(triggers()).toBe(3);

      component.updateCurrency(c, 'KRW');
      fixture.detectChanges();
      expect(triggers()).withContext('c left USD; a and b still share it').toBe(2);
      expect(mergeTrigger('c')).toBeNull();

      component.updateCurrency(component.transactions.find(t => t.id === 'b')!, 'KRW');
      fixture.detectChanges();
      expect(triggers()).withContext('b joined c in KRW, leaving a alone in USD').toBe(2);
      expect(mergeTrigger('a')).toBeNull();
    });

    it('lists the other same-currency rows in the menu, named by mergeOption', () => {
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch', amount: 12 });
      render([
        makeRow({ id: 'a', currency: 'USD', description: 'Coffee', amount: 5.5 }),
        b,
        makeRow({ id: 'c', currency: 'KRW' }),
      ]);

      const items = openMergeMenu('a');
      expect(items.length).withContext('b only: c is a different currency, a is the row itself').toBe(1);
      expect(items[0].textContent?.trim()).toBe(
        `import.mergeOption:${JSON.stringify({ description: 'Lunch', amount: 'USD 12', date: formattedDate(b) })}`
      );
    });

    it('merges the source into the picked target: a shorter array, the target\'s id, the summed amount and the union badge', () => {
      const a = makeRow({
        id: 'a', currency: 'USD', description: 'Coffee', amount: 5.5,
        imageMetadata: { imageIndex: 0, imageId: 'image_0', positionInImage: 'top', confidenceScore: 0.9, receiptId: 1 },
      });
      const b = makeRow({
        id: 'b', currency: 'USD', description: 'Lunch', amount: 12,
        imageMetadata: { imageIndex: 1, imageId: 'image_1', positionInImage: 'bottom', confidenceScore: 0.8, receiptId: 1 },
      });
      const given = [a, b];
      render(given);
      const emitted = emissions();

      openMergeMenu('a').find(item => item.textContent?.includes('Lunch'))!.click();
      fixture.detectChanges();

      expect(given.length).withContext('never mutates the @Input() array').toBe(2);
      expect(emitted.length).toBe(1);
      expect(emitted[0]).withContext('a new array, as every other edit emits').not.toBe(given);
      expect(emitted[0].length).toBe(1);
      const [merged] = emitted[0];
      expect(merged.id).withContext('the target keeps its id').toBe('b');
      expect(merged.amount).toBe(17.5);

      const badge = fixture.nativeElement.querySelector('.receipt-badge') as HTMLElement;
      expect(badge.textContent).toContain('1–2');
    });

    it('merges by id, so a target replaced under the open menu still takes the source', () => {
      // The menu's items hold the row objects captured at render, and the
      // wizard replaces a row under the same id whenever a re-check
      // reconciles its verdict. Resolving by id makes the click independent
      // of whether a refresh ran between render and click — here it did
      // not: an instance assignment marks nothing dirty on an OnPush root,
      // so the items keep naming objects the array no longer holds.
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee', amount: 5.5 });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch', amount: 12 });
      render([a, b]);
      const emitted = emissions();
      const items = openMergeMenu('a');

      component.transactions = [a, { ...b }];
      fixture.detectChanges();
      items[0].click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].map(t => t.id)).withContext('the source gone, the target kept').toEqual(['b']);
      expect(emitted[0][0].amount).withContext('the target holds the source\'s figure').toBe(17.5);
    });

    it('merges by id on a direct call too, given a copy of the target the array never held', () => {
      // The case above rests on the fixture leaving an OnPush root alone
      // after an instance assignment; this one does not. Only the id can
      // resolve a copy, so the pin survives a harness that refreshes.
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee', amount: 5.5 });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch', amount: 12 });
      render([a, b]);
      const emitted = emissions();

      component.mergeInto(a, { ...b });
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].map(t => t.id)).withContext('the source gone, the target kept').toEqual(['b']);
      expect(emitted[0][0].amount).withContext('b\'s id, summed').toBe(17.5);
    });

    it('does nothing when the source or the target has left the batch by the time the click lands', () => {
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee', amount: 5.5 });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch', amount: 12 });
      const c = makeRow({ id: 'c', currency: 'USD', description: 'Snacks', amount: 3 });
      render([a, b, c]);
      const emitted = emissions();
      const items = openMergeMenu('a');

      component.transactions = [a, c];
      fixture.detectChanges();
      items.find(item => item.textContent?.includes('Lunch'))!.click();
      fixture.detectChanges();

      expect(emitted.length).withContext('the stale-commit no-op, as commitSplit models it').toBe(0);
    });

    it('forgets the source\'s in-progress edit once it has merged away', () => {
      const a = makeRow({ id: 'a', currency: 'USD' });
      const b = makeRow({ id: 'b', currency: 'USD' });
      render([a, b]);
      component.startEdit(a, 'description');
      fixture.detectChanges();
      expect(component.isEditing(a, 'description')).withContext('editing before the merge').toBeTrue();

      openMergeMenu('a')[0].click();
      fixture.detectChanges();

      expect(component.isEditing(a, 'description')).withContext('forgotten once merged away').toBeFalse();
    });

    it('focuses the survivor\'s merge trigger when another row still shares its currency', async () => {
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee' });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch' });
      const c = makeRow({ id: 'c', currency: 'USD', description: 'Snacks' });
      render([a, b, c]);

      openMergeMenu('a').find(item => item.textContent?.includes('Lunch'))!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(document.activeElement).toBe(mergeTrigger('b'));
    });

    it('focuses the survivor\'s description trigger when the merge leaves nothing else in its currency', async () => {
      const a = makeRow({ id: 'a', currency: 'USD', description: 'Coffee' });
      const b = makeRow({ id: 'b', currency: 'USD', description: 'Lunch' });
      render([a, b]);

      openMergeMenu('a')[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(mergeTrigger('b')).withContext('nothing else left in USD').toBeNull();
      expect(document.activeElement).toBe(descriptionTrigger('b'));
    });
  });

  /**
   * A row taken off the card outright, on the reviewer's own say — a blank
   * one added by mistake, or a flagged one they never want to see again.
   * Deselect already keeps a row off the import and off the gate (0103's
   * known gap); this is the one that does not come back from either.
   */
  describe('removing a row', () => {
    const removeTrigger = (id: string) =>
      fixture.nativeElement.querySelector(`[data-row-id="${id}"] .remove-trigger`) as HTMLButtonElement | null;

    function render(rows: CategorizedImportTransaction[]): void {
      component.transactions = rows;
      component.categories = [];
      fixture.detectChanges();
    }

    it('renders the trigger on every row, blank and flagged included', () => {
      render([
        makeRow({ id: 'filled' }),
        makeRow({ id: 'blank', description: '' }),
        makeRow({ id: 'flagged', isDuplicate: true }),
      ]);

      expect(fixture.nativeElement.querySelectorAll('.remove-trigger').length).toBe(3);
      expect(removeTrigger('filled')!.getAttribute('aria-label'))
        .toBe('import.removeRowLabel:{"description":"Coffee Shop"}');
      expect(removeTrigger('blank')!.getAttribute('aria-label'))
        .withContext('nothing to name yet').toBe('common.remove');
      expect(removeTrigger('flagged')!.getAttribute('aria-label'))
        .withContext('offered on a flagged row too').toBe('import.removeRowLabel:{"description":"Coffee Shop"}');
    });

    it('takes the row off the card and emits the rest as a new array, leaving the input untouched', () => {
      const a = makeRow({ id: 'a' });
      const b = makeRow({ id: 'b' });
      const c = makeRow({ id: 'c' });
      const given = [a, b, c];
      render(given);
      const emitted = emissions();
      const selected: Set<string>[] = [];
      component.selectionChanged.subscribe(ids => selected.push(ids));

      removeTrigger('b')!.click();
      fixture.detectChanges();

      expect(given.length).withContext('never mutates the @Input() array').toBe(3);
      expect(emitted.length).toBe(1);
      expect(emitted[0]).withContext('a new array, as every other edit emits').not.toBe(given);
      expect(emitted[0].length).toBe(2);
      expect(emitted[0][0]).withContext('the same object, not a copy').toBe(a);
      expect(emitted[0][1]).withContext('the same object, not a copy').toBe(c);
      expect(selected[0]).withContext('without the removed id').toEqual(new Set(['a', 'c']));
    });

    it('forgets what the card kept for the row', () => {
      // notes: 'a' is what makes the box render through row.notes alone
      // (showsNotes), so typing a draft here needs no startEdit and leaves
      // the editing slot free for amount — calling startEdit a second time
      // would clear amountRejected early and make the "before" assertion
      // below vacuous.
      const row = makeRow({ id: 'x', notes: 'a', amount: 5400 });
      render([row]);

      const notes = fixture.nativeElement.querySelector('[data-row-id="x"] .notes-input') as HTMLTextAreaElement;
      notes.value = 'draft';
      notes.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      component.startEdit(row, 'amount');
      fixture.detectChanges();
      const amount = fixture.nativeElement.querySelector('[data-row-id="x"] .amount-input') as HTMLInputElement;
      amount.value = 'abc';
      amount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();
      expect(component.amountUnreadable(row)).withContext('refused, before the removal').toBeTrue();
      expect(component.isEditing(row, 'amount')).withContext('still open, before the removal').toBeTrue();

      removeTrigger('x')!.click();
      fixture.detectChanges();

      expect(component.isEditing(row, 'amount')).withContext('the editing slot is gone').toBeFalse();
      expect(component.amountUnreadable(row)).withContext('the refusal is gone').toBeFalse();
      expect(component.notesText(row)).withContext('the draft is gone, the filed note is not').toBe('a');
    });

    it('hands focus to the next row\'s Remove, the previous row\'s when it was last, and Add a row when the list is empty', async () => {
      render([makeRow({ id: 'a' }), makeRow({ id: 'b' }), makeRow({ id: 'c' })]);

      removeTrigger('a')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(document.activeElement).withContext('the next row\'s own control').toBe(removeTrigger('b'));

      // Without this, the assertion below would pass on a broken handler
      // too: focus is already on b from the step above, and @for's
      // track row.id keeps that same element across c's removal.
      (document.activeElement as HTMLElement).blur();
      removeTrigger('c')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(document.activeElement).withContext('no row after it; the previous row\'s').toBe(removeTrigger('b'));

      removeTrigger('b')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(document.activeElement)
        .withContext('nothing left; the list\'s own control')
        .toBe(fixture.nativeElement.querySelector('.add-row'));
      expect(fixture.nativeElement.querySelector('app-empty-state')).withContext('the empty state renders').not.toBeNull();
    });

    it('lets a blank hand-added row leave again', async () => {
      render([makeRow({ id: 'existing' })]);

      component.addRow();
      fixture.detectChanges();
      const added = component.transactions.at(-1)!;

      removeTrigger(added.id)!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector(`[data-row-id="${added.id}"]`)).withContext('gone').toBeNull();
      expect(document.activeElement).withContext('the previous row\'s own control').toBe(removeTrigger('existing'));
    });
  });
});
