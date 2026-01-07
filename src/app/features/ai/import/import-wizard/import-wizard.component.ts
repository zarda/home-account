import { Component, inject, signal, computed, OnDestroy, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';

import { AIImportService } from '../../../../core/services/ai-import.service';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import {
  CategorizedImportTransaction,
  ImportResult,
  DuplicateCheck
} from '../../../../models';

import { FileDropzoneComponent } from '../file-dropzone/file-dropzone.component';
import { TransactionPreviewTableComponent } from '../transaction-preview-table/transaction-preview-table.component';
import { DuplicateWarningComponent, DuplicateInfo } from '../duplicate-warning/duplicate-warning.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-import-wizard',
  standalone: true,
  imports: [
    CommonModule,
    MatStepperModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatCardModule,
    MatChipsModule,
    FileDropzoneComponent,
    TransactionPreviewTableComponent,
    DuplicateWarningComponent,
    TranslatePipe
  ],
  templateUrl: './import-wizard.component.html',
  styleUrl: './import-wizard.component.scss'
})
export class ImportWizardComponent implements OnInit, AfterViewInit, OnDestroy {
  private importService = inject(AIImportService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  @ViewChild('stepper') stepper!: MatStepper;

  acceptedFileTypes = '.csv,.pdf,.png,.jpg,.jpeg,.webp';

  // Flag to track if we came from camera
  fromCamera = false;
  private cameraImportResult: ImportResult | null = null;

  // State signals
  selectedFiles = signal<File[]>([]);
  extractedTransactions = signal<CategorizedImportTransaction[]>([]);
  selectedTransactionIds = signal<Set<string>>(new Set());
  duplicateChecks = signal<DuplicateCheck[]>([]);
  processingError = signal<string | null>(null);
  isImporting = signal(false);
  importProgress = signal(0);
  importStatus = signal('');

  // Service bindings
  isProcessing = this.importService.isProcessing;
  processingStatus = this.importService.processingStatus;
  processingProgress = this.importService.processingProgress;
  categories = this.categoryService.categories;

  // Image preview URLs
  imagePreviewUrls = computed(() => {
    return this.selectedFiles()
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        name: f.name,
        url: URL.createObjectURL(f)
      }));
  });

  // Computed
  uploadComplete = computed(() => this.selectedFiles().length > 0);
  processingComplete = computed(() =>
    !this.isProcessing() && this.extractedTransactions().length > 0
  );
  processingFinishedEmpty = computed(() =>
    !this.isProcessing() &&
    this.extractedTransactions().length === 0 &&
    !this.processingError() &&
    this.selectedFiles().length > 0
  );
  reviewComplete = computed(() => this.selectedTransactionIds().size > 0);

  selectedCount = computed(() => {
    return this.extractedTransactions().filter(t => t.selected).length;
  });

  selectedIncome = computed(() => {
    return this.extractedTransactions()
      .filter(t => t.selected && t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  selectedExpenses = computed(() => {
    return this.extractedTransactions()
      .filter(t => t.selected && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  duplicatesSkipped = computed(() => {
    return this.extractedTransactions().filter(t => t.isDuplicate && !t.selected).length;
  });

  duplicateInfos = computed((): DuplicateInfo[] => {
    const txns = this.extractedTransactions();
    const checks = this.duplicateChecks();

    return checks
      .filter(c => c.isDuplicate)
      .map(check => ({
        transaction: txns.find(t => t.id === check.transactionId)!,
        check
      }))
      .filter(info => info.transaction);
  });

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translationService.t(key, params);
  }

  ngOnInit(): void {
    // Check if we received import result from camera capture via router state
    const state = history.state as { importResult?: ImportResult; fromCamera?: boolean } | undefined;

    if (state?.importResult && state?.fromCamera) {
      this.fromCamera = true;
      this.cameraImportResult = state.importResult;
    }
  }

  ngAfterViewInit(): void {
    // If we have camera import result, populate the data and skip to review step
    if (this.fromCamera && this.cameraImportResult) {
      // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        const result = this.cameraImportResult!;

        // Populate the transactions
        this.extractedTransactions.set(result.transactions);
        this.duplicateChecks.set(result.duplicates);

        // Auto-select non-duplicates
        const nonDuplicateIds = new Set(
          result.transactions
            .filter(t => !t.isDuplicate)
            .map(t => t.id)
        );
        this.selectedTransactionIds.set(nonDuplicateIds);

        // Skip to review step (index 2)
        if (this.stepper) {
          this.stepper.selectedIndex = 2;
        }
      });
    }
  }

  ngOnDestroy(): void {
    // Cleanup object URLs
    this.imagePreviewUrls().forEach(p => URL.revokeObjectURL(p.url));
  }

  onFilesSelected(files: File[]): void {
    this.selectedFiles.set(files);
    // Reset processing state
    this.extractedTransactions.set([]);
    this.processingError.set(null);
  }

  async processFiles(): Promise<void> {
    this.processingError.set(null);
    this.extractedTransactions.set([]);

    try {
      for (const file of this.selectedFiles()) {
        const result: ImportResult = await this.importService.importFromFile(file);

        this.extractedTransactions.update(txns => [...txns, ...result.transactions]);
        this.duplicateChecks.update(checks => [...checks, ...result.duplicates]);
      }

      // Auto-select non-duplicates
      const nonDuplicateIds = new Set(
        this.extractedTransactions()
          .filter(t => !t.isDuplicate)
          .map(t => t.id)
      );
      this.selectedTransactionIds.set(nonDuplicateIds);
    } catch (error) {
      this.processingError.set(
        error instanceof Error ? error.message : 'Failed to process files'
      );
    }
  }

  onTransactionsUpdated(transactions: CategorizedImportTransaction[]): void {
    this.extractedTransactions.set(transactions);
  }

  onSelectionChanged(selectedIds: Set<string>): void {
    this.selectedTransactionIds.set(selectedIds);
  }

  excludeAllDuplicates(): void {
    this.extractedTransactions.update(txns =>
      txns.map(t => ({
        ...t,
        selected: t.isDuplicate ? false : t.selected
      }))
    );
    this.updateSelectedIds();
  }

  includeAllDuplicates(): void {
    this.extractedTransactions.update(txns =>
      txns.map(t => ({
        ...t,
        selected: true
      }))
    );
    this.updateSelectedIds();
  }

  private updateSelectedIds(): void {
    const selectedIds = new Set(
      this.extractedTransactions()
        .filter(t => t.selected)
        .map(t => t.id)
    );
    this.selectedTransactionIds.set(selectedIds);
  }

  async confirmImport(): Promise<void> {
    this.isImporting.set(true);
    this.importProgress.set(0);

    try {
      const file = this.selectedFiles()[0];
      const result = await this.importService.confirmImport(
        this.extractedTransactions(),
        file?.name || 'import',
        file?.size || 0,
        'csv',
        'generic_csv'
      );

      this.snackBar.open(
        this.t('import.importComplete', { count: result.successCount }),
        this.t('common.close'),
        { duration: 5000 }
      );

      // Navigate back to transactions with showAll to see imported data
      this.router.navigate(['/transactions'], {
        queryParams: { showAll: 'true' }
      });
    } catch (error) {
      this.snackBar.open(
        this.t('import.importFailed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
        this.t('common.close'),
        { duration: 5000 }
      );
    } finally {
      this.isImporting.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/transactions']);
  }
}
