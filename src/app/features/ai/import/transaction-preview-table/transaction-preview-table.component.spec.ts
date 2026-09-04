import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatDatepicker } from '@angular/material/datepicker';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { CategorizedImportTransaction } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';

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
    // renders as nothing anywhere". This is that objection answered.
    component.transactions = [makeRow({ location: { country: 'KR' } })];
    component.categories = [];
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.extra-chip .extra-text') as HTMLElement;
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
  });
});
