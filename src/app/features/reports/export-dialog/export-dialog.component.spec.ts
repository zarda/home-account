import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ExportDialogComponent } from './export-dialog.component';
import { ExportService } from '../../../core/services/export.service';
import { TranslationService } from '../../../core/services/translation.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { Transaction, Category } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';

describe('ExportDialogComponent', () => {
  let component: ExportDialogComponent;
  let fixture: ComponentFixture<ExportDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<ExportDialogComponent>>;
  let mockExportService: jasmine.SpyObj<ExportService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;

  const mockCategories: Category[] = [
    {
      id: 'cat1',
      userId: null,
      name: 'Food & Drinks',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: true
    }
  ];

  const mockTransactions: Transaction[] = [
    {
      id: 't1',
      userId: 'user1',
      type: 'expense',
      amount: 100,
      amountInBaseCurrency: 100,
      exchangeRate: 1,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Groceries',
      date: Timestamp.fromDate(new Date(2024, 5, 15)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      isRecurring: false
    }
  ];

  const mockDialogData = {
    transactions: mockTransactions,
    categories: mockCategories,
    dateRange: { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) },
    currency: 'USD'
  };

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockExportService = jasmine.createSpyObj('ExportService', [
      'exportToCSV',
      'exportToPDF',
      'exportToJSON',
      'exportCategorySummaryCSV',
      'exportCategorySummaryPDF',
      'downloadBlob'
    ]);

    mockExportService.exportToCSV.and.returnValue(new Blob(['test'], { type: 'text/csv' }));
    mockExportService.exportToJSON.and.returnValue(new Blob(['{}'], { type: 'application/json' }));
    mockExportService.exportToPDF.and.returnValue(Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })));
    mockExportService.exportCategorySummaryCSV.and.returnValue(new Blob(['summary'], { type: 'text/csv' }));
    mockExportService.exportCategorySummaryPDF.and.returnValue(
      Promise.resolve(new Blob(['summary-pdf'], { type: 'application/pdf' }))
    );
    mockExportService.downloadBlobWithPicker = jasmine.createSpy('downloadBlobWithPicker').and.returnValue(Promise.resolve(true));

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'reports.csvDescription': 'Export as spreadsheet',
        'reports.pdfDescription': 'PDF Report',
        'reports.jsonDescription': 'JSON Backup',
        'reports.summaryCsvDescription': 'Category totals as spreadsheet',
        'reports.summaryPdfDescription': 'Category totals as report'
      };
      return translations[key] || key;
    });
    mockTranslationService.getIntlLocale.and.returnValue('en-US');

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', ['convert', 'amountInBase']);
    mockCurrencyService.convert.and.callFake((amount: number) => amount);
    mockCurrencyService.amountInBase.and.callFake((t: Transaction) => t.amount);

    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: ExportService, useValue: mockExportService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: CurrencyService, useValue: mockCurrencyService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ExportDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should default to CSV format', () => {
      expect(component.selectedFormat).toBe('csv');
    });

    it('should have includeDetails as true by default', () => {
      expect(component.includeDetails).toBeTrue();
    });

    it('should not be exporting initially', () => {
      expect(component.isExporting()).toBeFalse();
    });
  });

  describe('computed properties', () => {
    it('should return transaction count', () => {
      expect(component.transactionCount).toBe(1);
    });

    it('should return date range label', () => {
      const label = component.dateRangeLabel;
      expect(label).toContain('6/1/2024');
      expect(label).toContain('6/30/2024');
    });
  });

  describe('format options', () => {
    it('should have 5 format options', () => {
      expect(component.formatOptions.length).toBe(5);
    });

    it('should include CSV option', () => {
      const csv = component.formatOptions.find(o => o.value === 'csv');
      expect(csv).toBeDefined();
      expect(csv?.label).toBe('CSV');
    });

    it('should include PDF option', () => {
      const pdf = component.formatOptions.find(o => o.value === 'pdf');
      expect(pdf).toBeDefined();
      expect(pdf?.label).toBe('PDF');
    });

    it('should include JSON option', () => {
      const json = component.formatOptions.find(o => o.value === 'json');
      expect(json).toBeDefined();
      expect(json?.label).toBe('JSON');
    });

    it('should include category summary CSV option', () => {
      const summary = component.formatOptions.find(o => o.value === 'summary-csv');
      expect(summary?.label).toBe('CSV');
      expect(summary?.icon).toBe('summarize');
      expect(summary?.description).toBe('Category totals as spreadsheet');
    });

    it('should include category summary PDF option', () => {
      const summary = component.formatOptions.find(o => o.value === 'summary-pdf');
      expect(summary?.label).toBe('PDF');
      expect(summary?.icon).toBe('analytics');
      expect(summary?.description).toBe('Category totals as report');
    });
  });

  describe('export', () => {
    it('should export CSV when selected', async () => {
      component.selectedFormat = 'csv';
      await component.export();

      expect(mockExportService.exportToCSV).toHaveBeenCalled();
      expect(mockExportService.downloadBlobWithPicker).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should export JSON when selected', async () => {
      component.selectedFormat = 'json';
      await component.export();

      expect(mockExportService.exportToJSON).toHaveBeenCalled();
      expect(mockExportService.downloadBlobWithPicker).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should export PDF when selected', async () => {
      component.selectedFormat = 'pdf';
      await component.export();

      expect(mockExportService.exportToPDF).toHaveBeenCalled();
      expect(mockExportService.downloadBlobWithPicker).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should export the category summary CSV in the base currency', async () => {
      component.selectedFormat = 'summary-csv';
      await component.export();

      expect(mockExportService.exportCategorySummaryCSV)
        .toHaveBeenCalledWith(mockTransactions, 'USD');
      expect(mockExportService.downloadBlobWithPicker)
        .toHaveBeenCalledWith(jasmine.any(Blob), `category-summary-${dayKey(new Date())}.csv`);
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should pass the period label to the category summary PDF', async () => {
      component.selectedFormat = 'summary-pdf';
      await component.export();

      expect(mockExportService.exportCategorySummaryPDF)
        .toHaveBeenCalledWith(mockTransactions, 'USD', component.dateRangeLabel);
      expect(mockExportService.downloadBlobWithPicker)
        .toHaveBeenCalledWith(jasmine.any(Blob), `category-summary-${dayKey(new Date())}.pdf`);
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should keep the dialog open when the save picker is cancelled', async () => {
      mockExportService.downloadBlobWithPicker.and.returnValue(Promise.resolve(false));

      component.selectedFormat = 'summary-csv';
      await component.export();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
      expect(component.isExporting()).toBeFalse();
    });

    it('should set isExporting to false after completion', async () => {
      await component.export();
      expect(component.isExporting()).toBeFalse();
    });
  });

  describe('cancel', () => {
    it('should close dialog with false', () => {
      component.cancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });
  });

  // #429 P1: the report PDF used to convert every past transaction at
  // whatever rate happened to be loaded, so the same period printed a
  // different total here than on every screen that reads the write-time
  // snapshot. The stub below makes `convert` and `amountInBase` disagree, so
  // only reading the snapshot can produce the expected figure.
  describe('the report PDF, built from the base-currency snapshot', () => {
    let snapshotComponent: ExportDialogComponent;
    let snapshotFixture: ComponentFixture<ExportDialogComponent>;
    let snapshotDialogRef: jasmine.SpyObj<MatDialogRef<ExportDialogComponent>>;
    let snapshotExportService: jasmine.SpyObj<ExportService>;
    let snapshotCurrencyService: jasmine.SpyObj<CurrencyService>;

    const snapshotTransactions: Transaction[] = [
      {
        id: 't2',
        userId: 'user1',
        type: 'expense',
        amount: 100,
        amountInBaseCurrency: 150,
        exchangeRate: 1.5,
        currency: 'EUR',
        categoryId: 'cat1',
        description: 'Dinner',
        date: Timestamp.fromDate(new Date(2024, 5, 15)),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isRecurring: false,
      },
    ];

    beforeEach(async () => {
      TestBed.resetTestingModule();

      snapshotDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
      snapshotExportService = jasmine.createSpyObj('ExportService', ['exportToPDF', 'downloadBlobWithPicker']);
      snapshotExportService.exportToPDF.and.returnValue(Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })));
      snapshotExportService.downloadBlobWithPicker = jasmine.createSpy('downloadBlobWithPicker').and.returnValue(Promise.resolve(true));

      snapshotCurrencyService = jasmine.createSpyObj('CurrencyService', ['convert', 'amountInBase']);
      // A regression that read convert() would double the stamped total.
      snapshotCurrencyService.convert.and.callFake((amount: number) => amount * 2);
      snapshotCurrencyService.amountInBase.and.callFake((t: Transaction) => t.amountInBaseCurrency);

      await TestBed.configureTestingModule({
        imports: [ExportDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: snapshotDialogRef },
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              transactions: snapshotTransactions,
              categories: mockCategories,
              dateRange: { start: new Date(2024, 5, 1), end: new Date(2024, 5, 30) },
              currency: 'USD',
            },
          },
          { provide: ExportService, useValue: snapshotExportService },
          { provide: TranslationService, useValue: mockTranslationService },
          { provide: CurrencyService, useValue: snapshotCurrencyService },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();

      snapshotFixture = TestBed.createComponent(ExportDialogComponent);
      snapshotComponent = snapshotFixture.componentInstance;
      snapshotFixture.detectChanges();
    });

    it("carries the stamped snapshot's total, not a live conversion", async () => {
      snapshotComponent.selectedFormat = 'pdf';
      await snapshotComponent.export();

      expect(snapshotCurrencyService.amountInBase).toHaveBeenCalledWith(snapshotTransactions[0], 'USD');
      const reportData = snapshotExportService.exportToPDF.calls.mostRecent().args[0];
      expect(reportData.summary.expense).toBe(150);
      expect(reportData.summary.byCategory).toEqual([{ categoryId: 'cat1', total: 150 }]);
    });
  });
});
