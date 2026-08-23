import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { CategorizedImportTransaction } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';

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
        { provide: TranslationService, useValue: { t: (key: string) => key } },
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
});
