import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ExportDialogComponent } from './export-dialog.component';
import { ExportService } from '../../../core/services/export.service';
import { Transaction, Category } from '../../../models';

describe('ExportDialogComponent', () => {
  let component: ExportDialogComponent;
  let fixture: ComponentFixture<ExportDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<ExportDialogComponent>>;
  let mockExportService: jasmine.SpyObj<ExportService>;

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
      'downloadBlob'
    ]);

    mockExportService.exportToCSV.and.returnValue(new Blob(['test'], { type: 'text/csv' }));
    mockExportService.exportToJSON.and.returnValue(new Blob(['{}'], { type: 'application/json' }));
    mockExportService.exportToPDF.and.returnValue(Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' })));

    await TestBed.configureTestingModule({
      imports: [ExportDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: ExportService, useValue: mockExportService }
      ]
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
      expect(component.isExporting).toBeFalse();
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
    it('should have 3 format options', () => {
      expect(component.formatOptions.length).toBe(3);
    });

    it('should include CSV option', () => {
      const csv = component.formatOptions.find(o => o.value === 'csv');
      expect(csv).toBeDefined();
      expect(csv?.label).toBe('CSV');
    });

    it('should include PDF option', () => {
      const pdf = component.formatOptions.find(o => o.value === 'pdf');
      expect(pdf).toBeDefined();
      expect(pdf?.label).toBe('PDF Report');
    });

    it('should include JSON option', () => {
      const json = component.formatOptions.find(o => o.value === 'json');
      expect(json).toBeDefined();
      expect(json?.label).toBe('JSON Backup');
    });
  });

  describe('export', () => {
    it('should export CSV when selected', async () => {
      component.selectedFormat = 'csv';
      await component.export();

      expect(mockExportService.exportToCSV).toHaveBeenCalled();
      expect(mockExportService.downloadBlob).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should export JSON when selected', async () => {
      component.selectedFormat = 'json';
      await component.export();

      expect(mockExportService.exportToJSON).toHaveBeenCalled();
      expect(mockExportService.downloadBlob).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should export PDF when selected', async () => {
      component.selectedFormat = 'pdf';
      await component.export();

      expect(mockExportService.exportToPDF).toHaveBeenCalled();
      expect(mockExportService.downloadBlob).toHaveBeenCalled();
      expect(mockDialogRef.close).toHaveBeenCalledWith(true);
    });

    it('should set isExporting to false after completion', async () => {
      await component.export();
      expect(component.isExporting).toBeFalse();
    });
  });

  describe('cancel', () => {
    it('should close dialog with false', () => {
      component.cancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    });
  });
});
