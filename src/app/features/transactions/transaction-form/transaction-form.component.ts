import { AfterViewInit, ChangeDetectorRef, Component, computed, inject, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { CommonModule } from '@angular/common';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepicker, MatDatepickerModule } from '@angular/material/datepicker';
import { Subscription, debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TransactionService, RECEIPT_IMAGE_LIMIT_ERROR } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
  RECEIPT_TO_NOTE_NO_DETAILS,
  RECEIPT_TO_NOTE_DOWNLOAD_FAILED,
} from '../../../core/services/receipt-to-note.service';
import { ReceiptLimitDialogComponent } from '../receipt-images/receipt-limit-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { CategoryService } from '../../../core/services/category.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { AIImportService } from '../../../core/services/ai-import.service';
import { Transaction, CreateTransactionDTO, BudgetPeriod, Category } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { CameraCaptureComponent } from '../camera-capture/camera-capture.component';
import { compressImage } from '../../../shared/utils/image-compression';
import { formatReceiptItemLines } from '../../../core/utils/receipt-consolidation';
import { MAX_RECEIPT_BYTES } from '../../../core/services/storage.service';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { NotificationService } from '../../../core/services/notification.service';
import { AnalyticsService } from '../../../core/services/analytics.service';

interface DialogData {
  mode: 'add' | 'edit';
  transaction?: Transaction;
}

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [
    LoadingSpinnerComponent,
    DialogHeaderComponent,
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    TranslatePipe,
    CdkTextareaAutosize
  ],
  templateUrl: './transaction-form.component.html',
  styleUrl: './transaction-form.component.scss',
})
export class TransactionFormComponent implements OnInit, AfterViewInit, OnDestroy {
  private notifications = inject(NotificationService);
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<TransactionFormComponent>);
  data: DialogData = inject(MAT_DIALOG_DATA);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private geminiService = inject(GeminiService);
  private receiptQuota = inject(ReceiptQuotaService);
  private receiptToNote = inject(ReceiptToNoteService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private aiImportService = inject(AIImportService);
  private cdr = inject(ChangeDetectorRef);
  private analytics = inject(AnalyticsService);

  @ViewChild('picker') picker!: MatDatepicker<Date>;

  form!: FormGroup;
  isSubmitting = signal(false);
  transactionType = signal<'expense' | 'income'>('expense');
  private categoryIdSignal = signal<string>('');

  // AI Receipt Scanner signals
  receiptPreview = signal<string | null>(null);
  isScanning = signal(false);
  scanError = signal<string | null>(null);
  // Compressed receipt image to upload alongside the transaction.
  receiptFile = signal<File | null>(null);

  /**
   * Whether a receipt scan filled any of this form.
   *
   * The same form serves manual entry and receipt-assisted entry, and the
   * transaction that comes out is identical either way, so nothing on the
   * saved record can tell the two apart. Reported as the `method` of
   * transaction_add, which is the whole point of that event — knowing whether
   * scanning is worth its maintenance cost. Cleared whenever the scan is
   * undone, so a failed or discarded scan does not claim credit for a form the
   * user then filled in by hand.
   */
  private filledByScan = false;

  // Existing stored receipt (edit mode). Cleared locally after the user
  // removes it or converts it into note text.
  private existingReceiptGone = signal(false);
  isConvertingReceipt = signal(false);

  get existingReceiptUrl(): string | null {
    if (this.existingReceiptGone()) return null;
    return this.data.transaction?.receiptUrl ?? null;
  }

  // AI Category Suggestion signals
  suggestedCategory = signal<Category | null>(null);
  isSuggesting = signal(false);

  // Check if AI features are available
  isAiAvailable = computed(() => this.geminiService.isAvailable());

  currencies = this.currencyService.getSupportedCurrencies();
  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;

  get periods(): { value: BudgetPeriod; label: string }[] {
    return [
      { value: 'weekly', label: this.translationService.t('transactions.weekly') },
      { value: 'monthly', label: this.translationService.t('transactions.monthly') },
      { value: 'yearly', label: this.translationService.t('transactions.yearly') }
    ];
  }

  // Store transaction dates for calendar highlighting - keyed by "year-month"
  private transactionDatesCache = new Map<string, Map<string, 'income' | 'expense' | 'both'>>();
  private loadingMonths = new Set<string>();
  private datesSubs: Subscription[] = [];

  // Computed signal that reacts to both type changes and category loading
  filteredCategories = computed(() => {
    const type = this.transactionType();
    if (type === 'income') {
      return this.incomeCategories();
    }
    return this.expenseCategories();
  });

  // Computed signal for selected category (used by mat-select-trigger)
  selectedCategory = computed(() => {
    const categoryId = this.categoryIdSignal();
    if (!categoryId) return null;
    return this.filteredCategories().find(c => c.id === categoryId) || null;
  });

  constructor() {
    // Only load categories if not already loaded
    if (this.categoryService.categories().length === 0) {
      this.categoryService.loadCategories().subscribe();
    }
  }

  ngOnInit(): void {
    this.initForm();
  }

  ngAfterViewInit(): void {
    this.setupDatepickerListeners();
  }

  ngOnDestroy(): void {
    this.datesSubs.forEach(sub => sub.unsubscribe());
  }

  private setupDatepickerListeners(): void {
    if (!this.picker) return;

    const openSub = this.picker.openedStream.subscribe(() => {
      const now = new Date();
      this.preloadMonthsAround(now.getFullYear(), now.getMonth());
    });
    this.datesSubs.push(openSub);
  }

  private preloadMonthsAround(year: number, month: number): void {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    this.loadTransactionDatesForMonth(prevYear, prevMonth);

    this.loadTransactionDatesForMonth(year, month);

    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    this.loadTransactionDatesForMonth(nextYear, nextMonth);
  }

  onCalendarMonthChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  onCalendarYearChange(date: Date): void {
    this.preloadMonthsAround(date.getFullYear(), date.getMonth());
  }

  private loadTransactionDatesForMonth(year: number, month: number): void {
    const monthKey = `${year}-${month}`;

    if (this.transactionDatesCache.has(monthKey) || this.loadingMonths.has(monthKey)) {
      return;
    }

    this.loadingMonths.add(monthKey);
    const sub = this.transactionService.getTransactionDatesForMonth(year, month).subscribe(dates => {
      this.transactionDatesCache.set(monthKey, dates);
      this.loadingMonths.delete(monthKey);
      this.cdr.markForCheck();
    });
    this.datesSubs.push(sub);
  }

  dateClass = (date: Date): string => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthKey = `${year}-${month}`;

    if (!this.transactionDatesCache.has(monthKey)) {
      this.loadTransactionDatesForMonth(year, month);
      return '';
    }

    const monthData = this.transactionDatesCache.get(monthKey);
    const dateKey = `${year}-${month}-${date.getDate()}`;
    const type = monthData?.get(dateKey);

    if (type === 'income') return 'has-income';
    if (type === 'expense') return 'has-expense';
    if (type === 'both') return 'has-both';
    return '';
  };

  private initForm(): void {
    const transaction = this.data.transaction;
    const defaultCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
    const initialType = transaction?.type || 'expense';

    this.transactionType.set(initialType);

    this.form = this.fb.group({
      type: [initialType, Validators.required],
      amount: [transaction?.amount || '', [Validators.required, Validators.min(0.01)]],
      currency: [transaction?.currency || defaultCurrency, Validators.required],
      categoryId: [transaction?.categoryId || '', Validators.required],
      description: [transaction?.description || '', Validators.required],
      date: [transaction?.date?.toDate?.() || new Date(), Validators.required],
      note: [transaction?.note || ''],
      period: [transaction?.period || null],
    });

    // Watch for type changes
    this.form.get('type')?.valueChanges.subscribe((type) => {
      this.transactionType.set(type);
      // Reset category if it doesn't match the type
      const currentCategoryId = this.form.get('categoryId')?.value;
      if (currentCategoryId) {
        const validCategories = this.filteredCategories();
        if (!validCategories.some(c => c.id === currentCategoryId)) {
          this.form.patchValue({ categoryId: '' });
        }
      }
    });

    // Watch for category changes to update the trigger display
    this.categoryIdSignal.set(transaction?.categoryId || '');
    this.form.get('categoryId')?.valueChanges.subscribe((categoryId) => {
      this.categoryIdSignal.set(categoryId || '');
      // Clear suggestion when category is manually selected
      if (categoryId) {
        this.suggestedCategory.set(null);
      }
    });

    // Setup AI category suggestion
    this.setupCategorySuggestion();
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);

    try {
      const formValue = this.form.value;
      const receipt = this.receiptFile();

      const transactionData: CreateTransactionDTO = {
        type: formValue.type,
        amount: parseFloat(formValue.amount),
        currency: formValue.currency,
        categoryId: formValue.categoryId,
        description: formValue.description,
        date: formValue.date,
        ...(formValue.note ? { note: formValue.note } : {}),
        ...(formValue.period ? { period: formValue.period } : {}),
        ...(receipt ? { receiptFile: receipt } : {}),
      };

      if (this.data.mode === 'add') {
        await this.transactionService.addTransaction(transactionData);
        // Tagged here rather than in TransactionService.addTransaction: that
        // chokepoint also serves backup restore and offline replay, which
        // would report thousands of events for one user action and none of
        // them for a real entry decision.
        this.analytics.trackTransactionAdd({
          method: this.filledByScan ? 'receipt_scan' : 'manual',
          type: transactionData.type === 'income' ? 'income' : 'expense',
        });
      } else if (this.data.transaction) {
        await this.transactionService.updateTransaction(
          this.data.transaction.id,
          transactionData
        );
      }

      this.dialogRef.close(true);
    } catch (error) {
      if (error instanceof Error && error.message === RECEIPT_IMAGE_LIMIT_ERROR) {
        this.openLimitDialog();
      }
      // Other save failures - could add snackbar notification here
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private openLimitDialog(): void {
    this.dialog.open(ReceiptLimitDialogComponent, {
      maxWidth: '95vw',
      autoFocus: false,
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  // === AI Receipt Scanner Methods ===

  openLongReceiptCapture(): void {
    // Subscribe before closing: the capture dialog must open only after
    // this dialog's overlay is fully disposed, regardless of which page
    // opened the form.
    this.dialogRef.afterClosed().subscribe(() => {
      this.dialog.open(CameraCaptureComponent, {
        width: '500px',
        maxWidth: '95vw',
      });
    });
    this.dialogRef.close(false);
  }

  async onReceiptSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Reset input so the same file can be selected again
    input.value = '';

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      const message = this.translationService.t('ai.invalidFileType');
      this.notifications.error(message);
      return;
    }

    // Storing this image consumes a quota slot unless the item already
    // has one to replace — at the limit, offer cleanup/upgrade instead
    if (!this.existingReceiptUrl && !(await this.receiptQuota.canAddImage())) {
      this.openLimitDialog();
      return;
    }

    // Compress/resize and cap at the receipt size limit before keeping the file.
    let receipt: File;
    try {
      receipt = await compressImage(file, { maxBytes: MAX_RECEIPT_BYTES });
    } catch {
      receipt = file;
    }
    this.receiptFile.set(receipt);

    // Build a preview and run the AI scan from the (compressed) file.
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      this.receiptPreview.set(base64);
      this.scanReceipt(base64);
    };
    reader.onerror = () => {
      const message = this.translationService.t('ai.readError');
      this.notifications.error(message);
    };
    reader.readAsDataURL(receipt);
  }

  private async scanReceipt(base64Image: string): Promise<void> {
    this.isScanning.set(true);
    this.scanError.set(null);
    let receiptCount = 1;

    try {
      const result = await this.geminiService.parseReceipt(base64Image);

      // Auto-fill form with extracted data
      this.form.patchValue({
        amount: result.amount > 0 ? result.amount : '',
        currency: result.currency || this.form.get('currency')?.value,
        description: result.merchant || '',
        date: result.date || new Date(),
      });

      // Record the itemized receipt content in the note field
      const receiptNote = result.receiptDetails
        || (result.items?.length ? formatReceiptItemLines(result.items, result.currency) : '');
      if (receiptNote) {
        this.form.patchValue({ note: receiptNote });
      }

      // Set category if suggested
      if (result.suggestedCategory) {
        const category = this.filteredCategories().find(c => c.id === result.suggestedCategory);
        if (category) {
          this.form.patchValue({ categoryId: result.suggestedCategory });
          this.categoryIdSignal.set(result.suggestedCategory);
        }
      }

      // Show success message
      const message = this.translationService.t('ai.scanSuccess');
      this.notifications.success(message);
      this.filledByScan = true;
      receiptCount = result.receiptCount ?? 1;
    } catch (error) {
      console.error('Receipt scan error:', error);
      const message = this.translationService.t('ai.scanError');
      this.scanError.set(message);
      this.notifications.error(message);
      // A failed scan leaves the user filling the form in by hand.
      this.filledByScan = false;
    } finally {
      this.isScanning.set(false);
    }

    if (receiptCount > 1) {
      await this.offerMultiReceiptReview(receiptCount);
    }
  }

  /**
   * A single-shot scan spotted several receipts in the photo. The form can
   * hold only the primary one, so offer the receipt-aware import review;
   * declining keeps the already-patched form.
   */
  private async offerMultiReceiptReview(count: number): Promise<void> {
    const file = this.receiptFile();
    if (!file) return;

    const data: ConfirmDialogData = {
      title: this.translationService.t('ai.multipleReceiptsTitle'),
      message: this.translationService.t('ai.multipleReceiptsMessage', { count }),
      confirmLabel: this.translationService.t('ai.reviewSeparately'),
      cancelLabel: this.translationService.t('ai.keepSingle'),
      icon: 'receipt_long',
    };
    const confirmed = await new Promise<boolean>(resolve => {
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
        .subscribe(result => resolve(!!result));
    });
    if (!confirmed) return;

    this.isScanning.set(true);
    try {
      const importResult = await this.aiImportService.importFromMultipleImages([file]);
      // Close before navigating so the wizard reads the completed
      // navigation's history state
      this.dialogRef.close(false);
      this.router.navigate(['/import/file'], {
        state: { importResult, fromCamera: true, multiImage: false },
      });
    } catch (error) {
      console.error('Multi-receipt import error:', error);
      this.notifications.error(this.translationService.t('ai.scanError'));
    } finally {
      this.isScanning.set(false);
    }
  }

  clearReceipt(): void {
    this.receiptPreview.set(null);
    this.scanError.set(null);
    this.receiptFile.set(null);
    this.filledByScan = false;
  }

  /**
   * Remove the stored receipt image from the item being edited,
   * freeing one slot of the receipt-image quota.
   */
  async removeExistingReceipt(): Promise<void> {
    const transaction = this.data.transaction;
    if (!transaction?.receiptUrl) return;

    const data: ConfirmDialogData = {
      title: this.translationService.t('receiptImages.removeConfirmTitle'),
      message: this.translationService.t('receiptImages.removeConfirmMessage'),
      confirmLabel: this.translationService.t('common.remove'),
      confirmColor: 'warn',
      icon: 'delete',
    };
    const confirmed = await new Promise<boolean>(resolve => {
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
        .subscribe(result => resolve(!!result));
    });
    if (!confirmed) return;

    try {
      await this.transactionService.removeReceipt(transaction.id);
      this.existingReceiptGone.set(true);
      this.notifications.success(this.translationService.t('receiptImages.removed'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    }
  }

  /**
   * Convert the stored receipt image into detailed note text and remove
   * the image. The note control picks up the new text so the form stays
   * consistent with what was persisted.
   */
  async convertExistingReceiptToNote(): Promise<void> {
    const transaction = this.data.transaction;
    if (!transaction?.receiptUrl || this.isConvertingReceipt()) return;

    this.isConvertingReceipt.set(true);
    try {
      // Convert against the note currently in the form, not the stored one
      const note = await this.receiptToNote.convertReceiptToNote({
        ...transaction,
        note: this.form.get('note')?.value || transaction.note,
      });
      this.form.patchValue({ note });
      this.existingReceiptGone.set(true);
      this.notifications.success(this.translationService.t('receiptImages.converted'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === RECEIPT_TO_NOTE_AI_UNAVAILABLE) {
        this.notifications.error(this.translationService.t('receiptImages.convertFailedNoAi'));
      } else if (message === RECEIPT_TO_NOTE_NO_DETAILS) {
        this.notifications.error(this.translationService.t('receiptImages.convertFailedNoDetails'));
      } else if (message === RECEIPT_TO_NOTE_DOWNLOAD_FAILED) {
        this.notifications.error(this.translationService.t('receiptImages.convertFailedDownload'));
      } else {
        this.notifications.error(this.translationService.t('receiptImages.convertFailed'));
      }
    } finally {
      this.isConvertingReceipt.set(false);
    }
  }

  // === AI Category Suggestion Methods ===

  private setupCategorySuggestion(): void {
    if (!this.geminiService.isAvailable()) return;

    const descriptionControl = this.form.get('description');
    if (!descriptionControl) return;

    const sub = descriptionControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      filter((value: string): value is string => !!value && value.length >= 3)
    ).subscribe((description: string) => {
      // Only suggest if no category is selected yet
      if (!this.form.get('categoryId')?.value) {
        this.fetchCategorySuggestion(description);
      }
    });

    this.datesSubs.push(sub);
  }

  private async fetchCategorySuggestion(description: string): Promise<void> {
    this.isSuggesting.set(true);
    this.suggestedCategory.set(null);

    try {
      const categories = this.filteredCategories();
      const suggestedId = await this.geminiService.suggestCategory(description, categories);

      if (suggestedId) {
        const category = categories.find(c => c.id === suggestedId);
        if (category) {
          this.suggestedCategory.set(category);
        }
      }
    } catch (error) {
      console.error('Category suggestion error:', error);
      // Silently fail - don't show error to user
    } finally {
      this.isSuggesting.set(false);
    }
  }

  acceptSuggestion(): void {
    const category = this.suggestedCategory();
    if (category) {
      this.form.patchValue({ categoryId: category.id });
      this.categoryIdSignal.set(category.id);
      this.suggestedCategory.set(null);
    }
  }
}
