import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { Transaction, Category, MonthlyTotal } from '../../models';

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
}

export interface ExportData {
  transactions: Transaction[];
  categories: Category[];
  exportDate: string;
  version: string;
}

export interface ImportedTransaction {
  description: string;
  amount: number;
  date: Date;
  type?: 'income' | 'expense';
  category?: string;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);

  // Export transactions to CSV
  exportToCSV(transactions: Transaction[], options?: ExportOptions): Blob {
    const categories = this.categoryService.categories();

    // Filter transactions based on options
    let filtered = this.filterTransactions(transactions, options);

    // Build CSV header
    const headers = options?.format === 'summary'
      ? ['Date', 'Type', 'Category', 'Amount', 'Currency']
      : ['Date', 'Type', 'Category', 'Description', 'Amount', 'Currency', 'Amount (Base)', 'Note', 'Tags'];

    // Build CSV rows
    const rows = filtered.map(t => {
      const category = categories.find(c => c.id === t.categoryId);
      const date = t.date.toDate().toISOString().split('T')[0];

      if (options?.format === 'summary') {
        return [
          date,
          t.type,
          category?.name ?? 'Unknown',
          t.amount.toString(),
          t.currency
        ];
      }

      return [
        date,
        t.type,
        category?.name ?? 'Unknown',
        this.escapeCSV(t.description),
        t.amount.toString(),
        t.currency,
        t.amountInBaseCurrency.toString(),
        this.escapeCSV(t.note ?? ''),
        (t.tags ?? []).join('; ')
      ];
    });

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  }

  // Export report to PDF
  async exportToPDF(report: ReportData): Promise<Blob> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Title
    doc.setFontSize(20);
    doc.text(report.title, pageWidth / 2, 20, { align: 'center' });

    // Period
    doc.setFontSize(12);
    doc.text(report.period, pageWidth / 2, 30, { align: 'center' });

    // Summary section
    doc.setFontSize(14);
    doc.text('Summary', 14, 45);

    doc.setFontSize(11);
    const summaryY = 55;
    doc.text(`Total Income: ${this.currencyService.formatCurrency(report.summary.income, 'USD')}`, 14, summaryY);
    doc.text(`Total Expenses: ${this.currencyService.formatCurrency(report.summary.expense, 'USD')}`, 14, summaryY + 7);
    doc.text(`Balance: ${this.currencyService.formatCurrency(report.summary.balance, 'USD')}`, 14, summaryY + 14);
    doc.text(`Total Transactions: ${report.summary.transactionCount}`, 14, summaryY + 21);

    // Category breakdown table
    if (report.summary.byCategory.length > 0) {
      doc.setFontSize(14);
      doc.text('Spending by Category', 14, summaryY + 35);

      const categoryData = report.summary.byCategory
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map(c => {
          const category = report.categories.find(cat => cat.id === c.categoryId);
          return [
            category?.name ?? 'Unknown',
            this.currencyService.formatCurrency(c.total, 'USD'),
            `${((c.total / report.summary.expense) * 100).toFixed(1)}%`
          ];
        });

      autoTable(doc, {
        startY: summaryY + 40,
        head: [['Category', 'Amount', '% of Total']],
        body: categoryData,
        theme: 'striped',
        headStyles: { fillColor: [63, 81, 181] },
        margin: { left: 14 }
      });
    }

    // Transactions table
    if (report.transactions.length > 0) {
      const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100;

      doc.setFontSize(14);
      doc.text('Transactions', 14, finalY + 15);

      const transactionData = report.transactions.map(t => {
        const category = report.categories.find(c => c.id === t.categoryId);
        return [
          t.date.toDate().toLocaleDateString(),
          t.type === 'income' ? '+' : '-',
          category?.name ?? 'Unknown',
          t.description.substring(0, 30),
          this.currencyService.formatCurrency(t.amount, t.currency)
        ];
      });

      autoTable(doc, {
        startY: finalY + 20,
        head: [['Date', 'Type', 'Category', 'Description', 'Amount']],
        body: transactionData,
        theme: 'striped',
        headStyles: { fillColor: [63, 81, 181] },
        margin: { left: 14 },
        columnStyles: {
          3: { cellWidth: 50 }
        }
      });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(
        `Page ${i} of ${pageCount} | Generated on ${new Date().toLocaleDateString()}`,
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
      version: '1.0'
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

  // Parse imported data and convert to transaction DTOs
  parseImportedData(raw: ImportedTransaction[]): Array<{
    type: 'income' | 'expense';
    amount: number;
    currency: string;
    categoryId: string;
    description: string;
    date: Date;
  }> {
    return raw.map(r => ({
      type: r.type ?? (r.amount >= 0 ? 'income' : 'expense'),
      amount: Math.abs(r.amount),
      currency: 'USD', // Default, can be enhanced
      categoryId: 'other_expense', // Will be categorized by AI
      description: r.description,
      date: r.date
    }));
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

  // Helper: Escape CSV special characters
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  // Helper: Parse CSV text to raw transactions
  private parseCSV(text: string): ImportedTransaction[] {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const transactions: ImportedTransaction[] = [];

    // Detect column indices
    const dateCol = this.findColumn(headers, ['date', 'transaction date', 'posted date']);
    const descCol = this.findColumn(headers, ['description', 'memo', 'payee', 'merchant']);
    const amountCol = this.findColumn(headers, ['amount', 'value', 'sum']);
    const debitCol = this.findColumn(headers, ['debit', 'withdrawal', 'expense']);
    const creditCol = this.findColumn(headers, ['credit', 'deposit', 'income']);
    const typeCol = this.findColumn(headers, ['type', 'transaction type']);

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
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

      transactions.push({
        date: this.parseDate(values[dateCol] || ''),
        description: values[descCol] || 'Unknown',
        amount: Math.abs(amount),
        type
      });
    }

    return transactions;
  }

  // Helper: Parse a single CSV line handling quoted values
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
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

  // Download helper
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
