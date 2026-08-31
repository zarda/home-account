import { Injectable, inject } from '@angular/core';
// Type only: the renderer itself still arrives through loadJsPdf's dynamic
// import, so nothing here pulls jspdf into the initial bundle.
import type { jsPDF } from 'jspdf';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { LocaleFormatService } from './locale-format.service';
import { TranslationService } from './translation.service';
import { readCurrencyCode } from '../utils/receipt-extraction.utils';
import {
  Transaction,
  TransactionLocation,
  Category,
  CreateTransactionDTO,
  BudgetPeriod,
  isBudgetPeriod,
  Budget,
  Goal,
  RecurringTransaction,
  InsightSnapshot,
  MonthlyTotal
} from '../../models';
import { dayKey, parseDayKey } from '../utils/transaction-date.utils';
import {
  CategoryTypeTotal,
  groupByCategoryAndType,
  roundMoney,
} from '../utils/transaction-aggregation.utils';
import { parseCsvRows, toCsvText, unguardCsvCell } from '../utils/csv.utils';
import { normalizeTags } from '../utils/tag.utils';
import { locationSlot, toCreateTransactionDTO } from '../utils/import-dto.utils';

// File System Access API type declarations
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: {
    description: string;
    accept: Record<string, string[]>;
  }[];
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

export interface ExportOptions {
  dateRange?: { start: Date; end: Date };
  categories?: string[];
  includeReceipts?: boolean;
  format?: 'detailed' | 'summary';
}

export interface ReportData {
  title: string;
  period: string;
  transactions: Transaction[];
  summary: MonthlyTotal;
  categories: Category[];
  currency: string;
}

/** Bumped whenever the backup gains or reshapes a section. */
export const BACKUP_SCHEMA_VERSION = '1.4';

/**
 * Versions this build can restore. Older ones simply carry fewer sections;
 * a version not in this list came from a newer build and is refused rather
 * than half-read.
 */
export const SUPPORTED_BACKUP_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4'] as const;

export interface ExportData {
  transactions: Transaction[];
  categories: Category[];
  /**
   * Monthly spending-insight snapshots. Optional so a backup written before
   * they existed still parses as an ExportData.
   */
  insightSnapshots?: InsightSnapshot[];
  /** Budgets and recurring rules. Optional for the same reason (added in 1.2). */
  budgets?: Budget[];
  recurring?: RecurringTransaction[];
  /**
   * Savings goals and projects. Optional for the same reason (added in 1.3).
   * From 1.4 transactions may carry goalId/goalAmount links and goals a
   * linkedAmount counter; all three ride along because sections serialize
   * whole documents, and restore recomputes the counter from the links.
   */
  goals?: Goal[];
  exportDate: string;
  version: string;
}

/**
 * One row on its way into the importer — the shared shape behind the CSV
 * import and the JSON backup restore. Everything beyond the four core
 * fields is optional: a bank CSV carries none of it, a backup carries all
 * of it, and parseImportedData falls back per field so both keep working.
 */
export interface ImportedTransaction {
  description: string;
  amount: number;
  date: Date;
  type?: 'income' | 'expense';
  category?: string;
  currency?: string;
  categoryId?: string;
  note?: string;
  tags?: string[];
  location?: TransactionLocation;
  isRecurring?: boolean;
  period?: BudgetPeriod;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private translationService = inject(TranslationService);
  private localeFormat = inject(LocaleFormatService);

  // Convert ArrayBuffer to base64 string (handles large binary data)
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // Process in 32KB chunks to avoid call stack issues
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }

  // Font URLs for different languages
  private readonly fontUrls: Record<string, string> = {
    // Noto Sans JP (Japanese) - covers hiragana, katakana, kanji
    ja: 'https://fonts.gstatic.com/s/notosansjp/v55/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
    // Noto Sans TC (Traditional Chinese)
    tc: 'https://fonts.gstatic.com/s/notosanstc/v38/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf',
  };

  // Cache fonts by language
  private fontCache = new Map<string, string>();

  // Load CJK font based on current language
  private async loadCJKFont(): Promise<string | null> {
    // Detect current language from translation service
    const currentLang = this.translationService.currentLocale();
    const fontKey = currentLang === 'ja' ? 'ja' : 'tc'; // Default to TC for non-Japanese

    // Check cache first
    if (this.fontCache.has(fontKey)) {
      return this.fontCache.get(fontKey)!;
    }

    const url = this.fontUrls[fontKey];

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`Failed to fetch font from ${url}:`, response.status);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();

      // Convert to base64 using chunked approach for large files
      const base64 = this.arrayBufferToBase64(arrayBuffer);

      this.fontCache.set(fontKey, base64);
      return base64;
    } catch (error) {
      console.warn(`Error loading font from ${url}:`, error);
      return null;
    }
  }

  // Helper: Get translated category name
  private getCategoryName(category: Category | undefined): string {
    return category?.name ? this.translationService.t(category.name) : 'Unknown';
  }

  // Export transactions to CSV
  exportToCSV(transactions: Transaction[], options?: ExportOptions): Blob {
    const categories = this.categoryService.categories();

    // Filter transactions based on options
    const filtered = this.filterTransactions(transactions, options);

    // Build CSV header. Summary is the at-a-glance format and is lossy by
    // design — it drops description, note, tags, location, period and
    // recurrence. Detailed is the format that round-trips.
    const headers = options?.format === 'summary'
      ? ['Date', 'Type', 'Category', 'Amount', 'Currency']
      : ['Date', 'Type', 'Category', 'Description', 'Amount', 'Currency', 'Amount (Base)', 'Note', 'Tags', 'Location', 'Period', 'Recurring'];

    // Build CSV rows
    const rows = filtered.map(t => {
      const category = categories.find(c => c.id === t.categoryId);
      // Local calendar day, matching what the app displays — toISOString
      // would shift any evening (west of UTC) or morning (east) row onto
      // the neighbouring day.
      const date = dayKey(t.date.toDate());

      if (options?.format === 'summary') {
        return [
          date,
          t.type,
          this.getCategoryName(category),
          t.amount.toString(),
          t.currency
        ];
      }

      // Raw values only. Escaping is toCsvText's job, applied to every cell —
      // it used to be applied here, to three cells of ten, and the category
      // name and the joined tags were two of the seven that went out unescaped.
      return [
        date,
        t.type,
        this.getCategoryName(category),
        t.description,
        t.amount.toString(),
        t.currency,
        t.amountInBaseCurrency.toString(),
        t.note ?? '',
        (t.tags ?? []).join('; '),
        // Name only: coordinates belong in the JSON backup, which carries
        // the whole transaction.
        t.location?.name ?? '',
        t.period ?? '',
        t.isRecurring ? 'true' : ''
      ];
    });

    return new Blob([toCsvText(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  }

  // Helper: Get PDF translation
  private pdfT(key: string): string {
    return this.translationService.t(`reports.pdf.${key}`);
  }

  /**
   * Loaded on demand: the PDF renderer serves one button, and every visitor
   * paid for it on first paint because this service is rooted. Same reason
   * pdfjs and the provider SDKs load at their call sites.
   */
  private async loadJsPdf() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    return { jsPDF, autoTable };
  }

  /**
   * Per-category totals for the period, both sides of the ledger.
   *
   * Conversion goes through `amountInBase` — the write-time snapshot every
   * other surface in the app reads — rather than a live `convert()`. The
   * export dialog's own `toBaseCurrency` converts live and is a standing
   * divergence; matching it here would make a legacy row total one way in
   * this file and another way on every screen that shows the same period.
   */
  private categorySummaryTotals(
    transactions: Transaction[],
    baseCurrency: string
  ): CategoryTypeTotal[] {
    return groupByCategoryAndType(
      transactions,
      t => this.currencyService.amountInBase(t, baseCurrency)
    );
  }

  /**
   * One row per category and type, income included, in the account's base
   * currency. Untruncated: this is the whole period, not a ranked top slice.
   */
  exportCategorySummaryCSV(transactions: Transaction[], baseCurrency: string): Blob {
    const categories = this.categoryService.categories();
    const headers = ['Type', 'Category', 'Amount', 'Currency', 'Transactions'];

    const rows = this.categorySummaryTotals(transactions, baseCurrency).map(row => [
      row.type,
      this.getCategoryName(categories.find(c => c.id === row.categoryId)),
      // Bare decimals, not formatCurrency: a symbol or a thousands separator
      // fails csv.utils' NUMERIC test, the cell picks up the formula guard,
      // and SUM() over the column returns 0 in every spreadsheet.
      this.currencyService.formatAmount(row.total, baseCurrency),
      baseCurrency,
      row.count.toString()
    ]);

    return new Blob([toCsvText(headers, rows)], { type: 'text/csv;charset=utf-8;' });
  }

  /**
   * Embed the CJK font and return the family every table must be styled with.
   *
   * Falls back to helvetica, which carries no CJK glyphs — an offline ja/tc
   * user gets a readable Latin report rather than no report at all.
   */
  private async embedCJKFont(doc: jsPDF): Promise<string> {
    const fontBase64 = await this.loadCJKFont();
    if (!fontBase64) {
      return 'helvetica';
    }

    try {
      doc.addFileToVFS('NotoSansCJK-Regular.ttf', fontBase64);
      doc.addFont('NotoSansCJK-Regular.ttf', 'NotoSansCJK', 'normal');
      doc.setFont('NotoSansCJK');
      return 'NotoSansCJK';
    } catch (error) {
      console.warn('Error adding CJK font to PDF:', error);
      return 'helvetica';
    }
  }

  /** Baseline below the last table autoTable drew. */
  private afterLastTable(doc: jsPDF, fallback: number): number {
    return (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable?.finalY ?? fallback;
  }

  /**
   * Category summary as PDF.
   *
   * A separate builder rather than a mode of exportToPDF, which slices its
   * category table to the ten largest rows and reorders the caller's array
   * with an in-place sort. Neither is wanted here: the summary is the whole
   * period, and the transactions handed in belong to the caller.
   */
  async exportCategorySummaryPDF(
    transactions: Transaction[],
    baseCurrency: string,
    period: string
  ): Promise<Blob> {
    const { jsPDF, autoTable } = await this.loadJsPdf();
    const doc = new jsPDF();
    // Threaded into every table below. One table left on the default family
    // renders as tofu for a ja or tc reader, and the offline spec only proves
    // the fallback, never the threading.
    const fontName = await this.embedCJKFont(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const categories = this.categoryService.categories();

    doc.setFontSize(20);
    doc.text(this.pdfT('categorySummaryTitle'), pageWidth / 2, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(period, pageWidth / 2, 30, { align: 'center' });

    const totals = this.categorySummaryTotals(transactions, baseCurrency);
    const expenseRows = totals.filter(row => row.type === 'expense');
    const incomeRows = totals.filter(row => row.type === 'income');
    // Summed from the rounded rows rather than from the raw transactions, so
    // the totals block agrees to the cent with the tables above it.
    const sum = (rows: CategoryTypeTotal[]) =>
      roundMoney(rows.reduce((running, row) => running + row.total, 0));
    const expenseTotal = sum(expenseRows);
    const incomeTotal = sum(incomeRows);

    const body = (rows: CategoryTypeTotal[], total: number) => rows.map(row => [
      this.getCategoryName(categories.find(c => c.id === row.categoryId)),
      this.currencyService.formatCurrency(row.total, baseCurrency),
      // A zero denominator is reachable: a period can hold rows that all
      // convert to nothing.
      total === 0 ? '0.0%' : `${((row.total / total) * 100).toFixed(1)}%`
    ]);

    let nextY = 45;

    const section = (
      heading: string,
      percentHeading: string,
      rows: CategoryTypeTotal[],
      total: number
    ): void => {
      if (rows.length === 0) {
        return;
      }
      // The summary is untruncated, so a heading can land at the foot of a
      // page with no room for the table it introduces.
      if (nextY > pageHeight - 40) {
        doc.addPage();
        nextY = 20;
      }

      doc.setFontSize(14);
      doc.text(heading, 14, nextY);

      autoTable(doc, {
        startY: nextY + 5,
        head: [[this.pdfT('category'), this.pdfT('amount'), percentHeading]],
        body: body(rows, total),
        theme: 'striped',
        styles: { font: fontName, fontStyle: 'normal' },
        headStyles: { fillColor: [63, 81, 181], font: fontName, fontStyle: 'normal' },
        margin: { left: 14 }
      });

      nextY = this.afterLastTable(doc, nextY) + 15;
    };

    section(
      this.pdfT('spendingByCategory'), this.pdfT('percentOfExpenses'),
      expenseRows, expenseTotal
    );
    section(
      this.pdfT('incomeByCategory'), this.pdfT('percentOfIncome'),
      incomeRows, incomeTotal
    );

    if (nextY > pageHeight - 40) {
      doc.addPage();
      nextY = 20;
    }

    doc.setFontSize(14);
    doc.text(this.pdfT('summary'), 14, nextY);

    doc.setFontSize(11);
    const money = (value: number) => this.currencyService.formatCurrency(value, baseCurrency);
    doc.text(`${this.pdfT('totalIncome')}: ${money(incomeTotal)}`, 14, nextY + 10);
    doc.text(`${this.pdfT('totalExpenses')}: ${money(expenseTotal)}`, 14, nextY + 17);
    doc.text(`${this.pdfT('balance')}: ${money(roundMoney(incomeTotal - expenseTotal))}`, 14, nextY + 24);

    this.stampPageFooters(doc, pageWidth, pageHeight);

    return doc.output('blob');
  }

  /** Page number and generation date, centred at the foot of every page. */
  private stampPageFooters(doc: jsPDF, pageWidth: number, pageHeight: number): void {
    const pageCount = doc.getNumberOfPages();
    const generatedDate = this.localeFormat.formatDate(new Date(), 'short');

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      const pageText = this.translationService.t('reports.pdf.pageOf', { current: i, total: pageCount });
      const generatedText = this.translationService.t('reports.pdf.generatedOn', { date: generatedDate });
      doc.text(`${pageText} | ${generatedText}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }
  }

  // Export report to PDF
  async exportToPDF(report: ReportData): Promise<Blob> {
    const { jsPDF, autoTable } = await this.loadJsPdf();
    const doc = new jsPDF();

    // Try to load and embed CJK font for Chinese/Japanese character support
    const fontBase64 = await this.loadCJKFont();
    let fontName = 'helvetica'; // Default font

    if (fontBase64) {
      try {
        doc.addFileToVFS('NotoSansCJK-Regular.ttf', fontBase64);
        doc.addFont('NotoSansCJK-Regular.ttf', 'NotoSansCJK', 'normal');
        doc.setFont('NotoSansCJK');
        fontName = 'NotoSansCJK';
      } catch (error) {
        console.warn('Error adding CJK font to PDF:', error);
      }
    }

    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(20);
    doc.text(this.pdfT('title'), pageWidth / 2, 20, { align: 'center' });

    // Period
    doc.setFontSize(12);
    doc.text(report.period, pageWidth / 2, 30, { align: 'center' });

    // Summary section
    doc.setFontSize(14);
    doc.text(this.pdfT('summary'), 14, 45);

    doc.setFontSize(11);
    const summaryY = 55;
    const baseCurrency = report.currency;
    doc.text(`${this.pdfT('totalIncome')}: ${this.currencyService.formatCurrency(report.summary.income, baseCurrency)}`, 14, summaryY);
    doc.text(`${this.pdfT('totalExpenses')}: ${this.currencyService.formatCurrency(report.summary.expense, baseCurrency)}`, 14, summaryY + 7);
    doc.text(`${this.pdfT('balance')}: ${this.currencyService.formatCurrency(report.summary.balance, baseCurrency)}`, 14, summaryY + 14);
    doc.text(`${this.pdfT('totalTransactions')}: ${report.summary.transactionCount}`, 14, summaryY + 21);

    // Category breakdown table
    if (report.summary.byCategory.length > 0) {
      doc.setFontSize(14);
      doc.text(this.pdfT('spendingByCategory'), 14, summaryY + 35);

      const categoryData = report.summary.byCategory
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(c => {
          const category = report.categories.find(cat => cat.id === c.categoryId);
          return [
            this.getCategoryName(category),
            this.currencyService.formatCurrency(c.total, baseCurrency),
            `${((c.total / report.summary.expense) * 100).toFixed(1)}%`
          ];
        });

      autoTable(doc, {
        startY: summaryY + 40,
        head: [[this.pdfT('category'), this.pdfT('amount'), this.pdfT('percentOfTotal')]],
        body: categoryData,
        theme: 'striped',
        styles: { font: fontName, fontStyle: 'normal' },
        headStyles: { fillColor: [63, 81, 181], font: fontName, fontStyle: 'normal' },
        margin: { left: 14 }
      });
    }

    // Transactions table
    if (report.transactions.length > 0) {
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;

      doc.setFontSize(14);
      doc.text(this.pdfT('transactions'), 14, finalY + 15);

      const transactionData = report.transactions.map(t => {
        const category = report.categories.find(c => c.id === t.categoryId);
        return [
          this.localeFormat.formatDate(t.date, 'short'),
          t.type === 'income' ? '+' : '-',
          this.getCategoryName(category),
          t.description.substring(0, 30),
          this.currencyService.formatCurrency(t.amount, t.currency)
        ];
      });

      autoTable(doc, {
        startY: finalY + 20,
        head: [[this.pdfT('date'), this.pdfT('type'), this.pdfT('category'), this.pdfT('description'), this.pdfT('amount')]],
        body: transactionData,
        theme: 'striped',
        styles: { font: fontName, fontStyle: 'normal' },
        headStyles: { fillColor: [63, 81, 181], font: fontName, fontStyle: 'normal' },
        margin: { left: 14 },
        columnStyles: {
          3: { cellWidth: 50 }
        }
      });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    const generatedDate = this.localeFormat.formatDate(new Date(), 'short');
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      const pageText = this.translationService.t('reports.pdf.pageOf', { current: i, total: pageCount });
      const generatedText = this.translationService.t('reports.pdf.generatedOn', { date: generatedDate });
      doc.text(
        `${pageText} | ${generatedText}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    return doc.output('blob');
  }

  // Export full data to JSON (for backup)
  exportToJSON(data: ExportData): Blob {
    const exportObject = {
      ...data,
      exportDate: new Date().toISOString(),
      version: BACKUP_SCHEMA_VERSION
    };

    const jsonString = JSON.stringify(exportObject, null, 2);
    return new Blob([jsonString], { type: 'application/json' });
  }

  // Import transactions from CSV
  async importFromCSV(file: File): Promise<ImportedTransaction[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const transactions = this.parseCSV(text);
          resolve(transactions);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Parse imported data and convert to transaction DTOs.
   *
   * `baseCurrency` is required rather than defaulted so a new call site has to
   * say what an unlabelled row should become. It used to be a hardcoded 'USD',
   * which silently relabelled every foreign row a bank CSV carried.
   */
  parseImportedData(raw: ImportedTransaction[], baseCurrency: string): CreateTransactionDTO[] {
    // The guards live in the shared mapper, which the AI wizard's confirm
    // step also writes through — a field carried by one import door but not
    // the other was the standing defect this shape replaces.
    return raw.map(r => toCreateTransactionDTO(r, baseCurrency));
  }

  // Helper: Filter transactions based on export options
  private filterTransactions(
    transactions: Transaction[],
    options?: ExportOptions
  ): Transaction[] {
    let filtered = [...transactions];

    if (options?.dateRange) {
      filtered = filtered.filter(t => {
        const date = t.date.toDate();
        return date >= options.dateRange!.start && date <= options.dateRange!.end;
      });
    }

    if (options?.categories && options.categories.length > 0) {
      filtered = filtered.filter(t =>
        options.categories!.includes(t.categoryId)
      );
    }

    return filtered.sort((a, b) =>
      b.date.toDate().getTime() - a.date.toDate().getTime()
    );
  }

  // Helper: Parse CSV text to raw transactions
  private parseCSV(text: string): ImportedTransaction[] {
    // Parsed as one document rather than split on newlines first: a newline
    // inside a quoted note is content, and splitting first tore in half the
    // very rows the escaper had correctly quoted. Unguarding the whole matrix
    // here, before any column index is read, means a column added later cannot
    // forget to do it.
    const rows = parseCsvRows(text).map(row => row.map(unguardCsvCell));
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().trim());
    const transactions: ImportedTransaction[] = [];

    // Detect column indices
    const dateCol = this.findColumn(headers, ['date', 'transaction date', 'posted date']);
    const descCol = this.findColumn(headers, ['description', 'memo', 'payee', 'merchant']);
    const amountCol = this.findColumn(headers, ['amount', 'value', 'sum']);
    const debitCol = this.findColumn(headers, ['debit', 'withdrawal', 'expense']);
    const creditCol = this.findColumn(headers, ['credit', 'deposit', 'income']);
    const typeCol = this.findColumn(headers, ['type', 'transaction type']);
    // exportToCSV writes a Currency column that this parser never read, so the
    // app could not re-import its own export: a ฿1,200 dinner came back as
    // $1,200. Optional, so it is left out of the row-length guard below and a
    // bank CSV without one still imports.
    const currencyCol = this.findColumn(headers, ['currency']);
    // Same contract as Currency: optional, out of the row-length guard, so a
    // file exported before these columns existed still imports. findColumn
    // matches by substring, so a bank's "Statement Period" column lands here
    // too — which is why both values are validated rather than trusted.
    const periodCol = this.findColumn(headers, ['period']);
    const recurringCol = this.findColumn(headers, ['recurring']);
    // The last three columns the export writes. Same optional contract again:
    // out of the row-length guard, validated rather than trusted. Tags split
    // on the export's own '; ' join — a tag containing that separator cannot
    // survive, which is the join's fault, not the escaper's. A location cell
    // becomes a name only; the file never carried coordinates, so none may
    // be invented, and an empty cell must yield no key at all rather than
    // `{ name: '' }`, which the rules would accept while meaning nothing.
    const noteCol = this.findColumn(headers, ['note']);
    const tagsCol = this.findColumn(headers, ['tags']);
    const locationCol = this.findColumn(headers, ['location']);

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (values.length < Math.max(dateCol, descCol, amountCol) + 1) continue;

      let amount: number;
      let type: 'income' | 'expense' | undefined;

      // Handle different amount formats
      if (amountCol >= 0) {
        amount = this.parseAmount(values[amountCol]);
      } else if (debitCol >= 0 && creditCol >= 0) {
        const debit = this.parseAmount(values[debitCol]);
        const credit = this.parseAmount(values[creditCol]);
        amount = credit > 0 ? credit : -debit;
      } else {
        continue; // Skip if no amount column found
      }

      // Determine type
      if (typeCol >= 0) {
        const typeValue = values[typeCol].toLowerCase();
        type = typeValue.includes('income') || typeValue.includes('credit')
          ? 'income'
          : 'expense';
      } else {
        type = amount >= 0 ? 'income' : 'expense';
      }

      // Validated against the ISO set rather than SUPPORTED_CURRENCIES, which
      // is the picker list and not the set the app can handle — refusing a
      // currency the rates endpoint carries would lose data, not protect it.
      const currency = currencyCol >= 0 && currencyCol < values.length
        ? readCurrencyCode(values[currencyCol])
        : '';

      const period = periodCol >= 0 && periodCol < values.length
        ? this.readBudgetPeriod(values[periodCol])
        : undefined;

      const isRecurring = recurringCol >= 0 && recurringCol < values.length
        ? this.readFlag(values[recurringCol])
        : undefined;

      const note = noteCol >= 0 && noteCol < values.length
        ? values[noteCol].trim()
        : '';

      // A hand-edited file can repeat a tag in a second casing; the card keys
      // its chips by value and the filter only finds the normalized form.
      const tags = tagsCol >= 0 && tagsCol < values.length
        ? normalizeTags(values[tagsCol].split('; '))
        : [];

      const locationName = locationCol >= 0 && locationCol < values.length
        ? values[locationCol].trim()
        : '';

      transactions.push({
        date: this.parseDate(values[dateCol] || ''),
        description: values[descCol] || 'Unknown',
        amount: Math.abs(amount),
        type,
        ...(currency ? { currency } : {}),
        ...(period ? { period } : {}),
        ...(isRecurring ? { isRecurring } : {}),
        ...(note ? { note } : {}),
        ...(tags.length ? { tags } : {}),
        ...locationSlot(locationName)
      });
    }

    return transactions;
  }

  // Helper: Read a budget period, ignoring anything outside the enum the
  // picker offers — a bank's "Statement Period" cell reads "2024-01 to
  // 2024-02", and Firestore's rules would reject it on write anyway.
  private readBudgetPeriod(value: string | undefined): BudgetPeriod | undefined {
    const normalized = (value ?? '').trim().toLowerCase();
    return isBudgetPeriod(normalized) ? normalized : undefined;
  }

  // Helper: Read a boolean flag column. Absence and anything unrecognised mean
  // "not set" rather than false, matching how period and currency behave.
  private readFlag(value: string | undefined): true | undefined {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1'
      ? true
      : undefined;
  }

  // Helper: Find column index by possible names
  private findColumn(headers: string[], possibleNames: string[]): number {
    for (const name of possibleNames) {
      const index = headers.findIndex(h => h.includes(name));
      if (index >= 0) return index;
    }
    return -1;
  }

  // Helper: Parse amount string to number
  private parseAmount(value: string): number {
    if (!value) return 0;

    // Remove currency symbols and whitespace
    const cleaned = value
      .replace(/[$€£¥฿₹]/g, '')
      .replace(/,/g, '')
      .replace(/\s/g, '')
      .trim();

    // Handle parentheses as negative
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      return -parseFloat(cleaned.slice(1, -1)) || 0;
    }

    return parseFloat(cleaned) || 0;
  }

  // Helper: Parse date string to Date object
  private parseDate(value: string): Date {
    if (!value) return new Date();

    // A date-only column is the app's own export format, and it means a local
    // calendar day — not the UTC midnight `new Date` would read it as. Checked
    // first and separately because the patterns below are unanchored: the
    // YYYY-MM-DD one also matches inside a full ISO instant, so folding this
    // into the loop would truncate the time off one.
    const dayOnly = parseDayKey(value.trim());
    if (dayOnly) {
      return dayOnly;
    }

    // Try various date formats
    const formats = [
      /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
      /(\d{2})\/(\d{2})\/(\d{4})/, // MM/DD/YYYY
      /(\d{2})-(\d{2})-(\d{4})/, // MM-DD-YYYY
      /(\d{2})\/(\d{2})\/(\d{2})/, // MM/DD/YY
    ];

    for (const format of formats) {
      const match = value.match(format);
      if (match) {
        // Try to create a valid date
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // Fallback to Date.parse
    const parsed = Date.parse(value);
    return isNaN(parsed) ? new Date() : new Date(parsed);
  }

  // Check if File System Access API is available
  isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  }

  /**
   * Download blob with native file picker (File System Access API)
   * Falls back to legacy download for unsupported browsers
   * @returns true if file was saved, false if user cancelled
   */
  async downloadBlobWithPicker(
    blob: Blob,
    filename: string
  ): Promise<boolean> {
    // Try modern File System Access API first (Chrome, Edge)
    if (this.isFileSystemAccessSupported()) {
      try {
        const extension = filename.split('.').pop() || '';
        const fileTypes = this.getFileTypeOptions(extension);

        const handle = await window.showSaveFilePicker!({
          suggestedName: filename,
          types: fileTypes,
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (error) {
        // User cancelled or API error
        if ((error as Error).name === 'AbortError') {
          return false; // User cancelled - don't fall back
        }
        console.warn('File System Access API failed, falling back to legacy download:', error);
      }
    }

    // Fallback: Legacy download method (Safari, Firefox, older browsers)
    this.downloadBlob(blob, filename);
    return true;
  }

  private getFileTypeOptions(extension: string): SaveFilePickerOptions['types'] {
    const types: Record<string, { description: string; accept: Record<string, string[]> }> = {
      csv: {
        description: 'CSV Files',
        accept: { 'text/csv': ['.csv'] },
      },
      pdf: {
        description: 'PDF Files',
        accept: { 'application/pdf': ['.pdf'] },
      },
      json: {
        description: 'JSON Files',
        accept: { 'application/json': ['.json'] },
      },
    };

    return types[extension] ? [types[extension]] : [];
  }

  // Legacy download helper (fallback for unsupported browsers)
  downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
