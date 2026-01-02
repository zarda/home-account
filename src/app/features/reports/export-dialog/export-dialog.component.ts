import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ExportService, ReportData } from '../../../core/services/export.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Transaction, Category } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type ExportFormat = 'csv' | 'pdf' | 'json';

interface ExportDialogData {
  transactions: Transaction[];
  categories: Category[];
  dateRange: { start: Date; end: Date };
  currency: string;
}

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './export-dialog.component.html',
  styleUrl: './export-dialog.component.scss',
})
export class ExportDialogComponent {
  private dialogRef = inject(MatDialogRef<ExportDialogComponent>);
  private data = inject<ExportDialogData>(MAT_DIALOG_DATA);
  private exportService = inject(ExportService);
  private translationService = inject(TranslationService);

  selectedFormat: ExportFormat = 'csv';
  includeDetails = true;
  isExporting = false;

  get formatOptions() {
    return [
      {
        value: 'csv' as ExportFormat,
        label: 'CSV',
        description: this.translationService.t('reports.csvDescription'),
        icon: 'table_chart',
      },
      {
        value: 'pdf' as ExportFormat,
        label: 'PDF',
        description: this.translationService.t('reports.pdfDescription'),
        icon: 'picture_as_pdf',
      },
      {
        value: 'json' as ExportFormat,
        label: 'JSON',
        description: this.translationService.t('reports.jsonDescription'),
        icon: 'code',
      },
    ];
  }

  get transactionCount(): number {
    return this.data.transactions.length;
  }

  get dateRangeLabel(): string {
    const start = this.data.dateRange.start.toLocaleDateString();
    const end = this.data.dateRange.end.toLocaleDateString();
    return `${start} - ${end}`;
  }

  async export(): Promise<void> {
    this.isExporting = true;

    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];

      let success = false;
      switch (this.selectedFormat) {
        case 'csv':
          success = await this.exportCSV(dateStr);
          break;
        case 'pdf':
          success = await this.exportPDF(dateStr);
          break;
        case 'json':
          success = await this.exportJSON(dateStr);
          break;
      }

      if (success) {
        this.dialogRef.close(true);
      }
      // If user cancelled, don't close dialog
    } catch {
      // Export failed - dialog stays open
    } finally {
      this.isExporting = false;
    }
  }

  private async exportCSV(dateStr: string): Promise<boolean> {
    const blob = this.exportService.exportToCSV(
      this.data.transactions,
      {
        dateRange: this.data.dateRange,
        format: this.includeDetails ? 'detailed' : 'summary',
      }
    );
    return this.exportService.downloadBlobWithPicker(
      blob,
      `transactions-${dateStr}.csv`,
      'text/csv'
    );
  }

  private async exportPDF(dateStr: string): Promise<boolean> {
    const totalIncome = this.data.transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

    const totalExpense = this.data.transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amountInBaseCurrency, 0);

    const categoryTotals = new Map<string, number>();
    for (const t of this.data.transactions.filter(t => t.type === 'expense')) {
      const current = categoryTotals.get(t.categoryId) || 0;
      categoryTotals.set(t.categoryId, current + t.amountInBaseCurrency);
    }

    const reportData: ReportData = {
      title: 'Financial Report',
      period: this.dateRangeLabel,
      transactions: this.data.transactions,
      summary: {
        income: totalIncome,
        expense: totalExpense,
        balance: totalIncome - totalExpense,
        transactionCount: this.data.transactions.length,
        byCategory: Array.from(categoryTotals.entries()).map(([categoryId, total]) => ({
          categoryId,
          total,
        })),
      },
      categories: this.data.categories,
    };

    const blob = await this.exportService.exportToPDF(reportData);
    return this.exportService.downloadBlobWithPicker(
      blob,
      `report-${dateStr}.pdf`,
      'application/pdf'
    );
  }

  private async exportJSON(dateStr: string): Promise<boolean> {
    const blob = this.exportService.exportToJSON({
      transactions: this.data.transactions,
      categories: this.data.categories,
      exportDate: new Date().toISOString(),
      version: '1.0',
    });
    return this.exportService.downloadBlobWithPicker(
      blob,
      `backup-${dateStr}.json`,
      'application/json'
    );
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
