import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
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
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  TransactionService,
  RECEIPT_IMAGE_LIMIT_ERROR,
  RECEIPT_ATTACH_FAILED,
  GOAL_LINK_INVALID,
} from '../../../core/services/transaction.service';
import { GoalService } from '../../../core/services/goal.service';
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
import { AIStrategyService, ProcessedTransaction } from '../../../core/services/ai-strategy.service';
import { AIImportService } from '../../../core/services/ai-import.service';
import { ReceiptAttemptService } from '../../../core/services/receipt-attempt.service';
import { GroundingHistoryService } from '../../../core/services/grounding-history.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { TagSuggestionService } from '../../../core/services/tag-suggestion.service';
import {
  Transaction,
  CreateTransactionDTO,
  BudgetPeriod,
  Category,
  CurrencyInfo,
  CurrencySuggestion,
  CurrencySuggestionReason,
  FieldConfidence,
  Goal,
  VERIFY_FIELD_THRESHOLD,
  baseCurrencyOf
} from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { NoteTranslationComponent } from '../../../shared/components/note-translation/note-translation.component';
import { CameraCaptureComponent } from '../camera-capture/camera-capture.component';
import { compressImage } from '../../../shared/utils/image-compression';
import { countryForCoordinates, currencyForCountry } from '../../../core/utils/country-bounds';
import { locationSlot } from '../../../core/utils/import-dto.utils';
import { countryDisplayName, currencyReasonKey, localeRegion, suggestCurrency } from '../../../core/utils/currency-suggestion.utils';
import { readCountryCode } from '../../../core/utils/receipt-extraction.utils';
import { CurrencyChoiceSessionService } from '../../../core/services/currency-choice-session.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { normalizeTag, normalizeTags } from '../../../core/utils/tag.utils';
import { dayKey, parseDateInput } from '../../../core/utils/transaction-date.utils';
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_TRANSACTION,
} from '../../../core/services/storage.service';
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
    NoteTranslationComponent,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-form.component.html',
  styleUrl: './transaction-form.component.scss',
})
export class TransactionFormComponent implements OnInit, AfterViewInit, OnDestroy {
  private notifications = inject(NotificationService);
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<TransactionFormComponent>);
  data: DialogData = inject(MAT_DIALOG_DATA);
  private transactionService = inject(TransactionService);
  private goalService = inject(GoalService);
  private categoryService = inject(CategoryService);
  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private strategyService = inject(AIStrategyService);
  private receiptQuota = inject(ReceiptQuotaService);
  private receiptToNote = inject(ReceiptToNoteService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private aiImportService = inject(AIImportService);
  private groundingHistory = inject(GroundingHistoryService);
  private tagSuggestions = inject(TagSuggestionService);
  private tagMemory = inject(TagMemoryService);
  private cdr = inject(ChangeDetectorRef);
  private analytics = inject(AnalyticsService);
  private receiptAttempts = inject(ReceiptAttemptService);
  private currencySession = inject(CurrencyChoiceSessionService);
  private localeFormat = inject(LocaleFormatService);
  private destroyRef = inject(DestroyRef);
  /** True from a scan that fell back until the user settles the currency; what makes a hand edit worth remembering. */
  private scanCurrencyFellBack = false;

  @ViewChild('picker') picker!: MatDatepicker<Date>;

  form!: FormGroup;
  isSubmitting = signal(false);
  transactionType = signal<'expense' | 'income'>('expense');
  private categoryIdSignal = signal<string>('');

  // AI Receipt Scanner signals
  isScanning = signal(false);
  scanError = signal<string | null>(null);
  // Compressed receipt images queued for upload alongside the transaction,
  // each with its preview data URL. On edit these append after the stored
  // images — replacing one is remove-then-attach.
  pendingReceipts = signal<{ file: File; preview: string }[]>([]);

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
  // The queued image the scan ran against; discarding it clears filledByScan.
  private scannedReceipt: { file: File; preview: string } | null = null;
  /** What the last scan offered, so saving can record which offers were refused. */
  private scanSuggestedTags: string[] = [];
  /**
   * The country the reader read off a printed address, and the exact name it
   * prefilled alongside it. `locationField` carries the country to the save
   * only while the Location field still holds this name unedited — a typed
   * name outranks the paper it replaced, and the country goes with it (#156).
   */
  private printedLocationCountry: { name: string; country: string } | null = null;

  /**
   * The country the last scan concluded the receipt was issued in.
   *
   * Separate state from `printedLocationCountry`, not a relaxation of it. That
   * one is gated on the Location field still holding the paper's own address,
   * because an edited address no longer describes what the paper described.
   * This one never came from an address at all — a receipt can name its
   * country through a tax number, a phone format or its own script — so an
   * empty or rewritten address field does not refute it (0068).
   */
  private scanCountry: string | null = null;

  // Images already stored on the item being edited, by storage slot. Kept as
  // local state so per-image removal and conversion update the strip without
  // re-reading the document.
  storedReceipts = signal<{ url: string; slot: number }[]>([]);
  // Slot with an in-flight remove/convert, so one image's spinner does not
  // lock its siblings.
  busyStoredSlot = signal<number | null>(null);

  /** True while another image can be queued under the per-transaction cap. */
  canQueueMore = computed(
    () =>
      this.storedReceipts().length + this.pendingReceipts().length <
      MAX_RECEIPTS_PER_TRANSACTION
  );

  // Tags live in a signal rather than a form control: Material's chip grid
  // is not a value accessor for the array, it emits add/remove events.
  tags = signal<string[]>([]);
  readonly tagSeparatorKeys = [ENTER, COMMA] as const;

  // Coordinates captured for the location field; the name is a form control.
  locationCoords = signal<{ lat: number; lng: number } | null>(null);
  isLocating = signal(false);
  /** Hide the capture button entirely where the API does not exist. */
  readonly geolocationAvailable = 'geolocation' in navigator;

  // AI Category Suggestion signals
  suggestedCategory = signal<Category | null>(null);
  isSuggesting = signal(false);

  /**
   * Whether to offer the receipt UI at all. Deliberately connectivity-blind:
   * attaching and previewing images is worth having with no signal, and only
   * the scan itself needs a reachable engine.
   */
  isAiAvailable = computed(() => this.strategyService.hasAnyEngine());

  /** How clearly the scan read the amount and date, when it could say. */
  scanFieldConfidence = signal<FieldConfidence | null>(null);

  /**
   * A currency the receipt did not state, offered from the ladder in
   * currency-suggestion.utils.ts: the receipt's own country first, then where
   * the device is, then the last choice this session, then the locale.
   * Offered rather than applied: the stored value stays the account's base
   * currency until the user accepts.
   */
  suggestedCurrency = signal<CurrencySuggestion | null>(null);

  /**
   * The position the scan fetched for its currency guess, offered as the
   * receipt's coordinate. Only for a receipt dated today: a fix taken at home
   * says nothing about where last week's receipt was paid. (#314)
   */
  suggestedCoordinates = signal<{ lat: number; lng: number } | null>(null);

  /**
   * A currency this transaction uses that the picker does not list.
   *
   * Extraction can produce any currency the rates endpoint knows, which is far
   * more than the nineteen the picker curates. Without an option to match,
   * `mat-select` finds nothing selected and opening the form to edit anything
   * else would silently rewrite the currency — so the row's own code is added
   * for as long as the form is showing it.
   */
  private unlistedCurrency = signal<CurrencyInfo | null>(null);

  currencies = computed<CurrencyInfo[]>(() => {
    const curated = this.currencyService.getSupportedCurrencies();
    const extra = this.unlistedCurrency();
    return extra ? [...curated, extra] : curated;
  });
  expenseCategories = this.categoryService.expenseCategories;
  incomeCategories = this.categoryService.incomeCategories;

  get periods(): { value: BudgetPeriod; label: string }[] {
    return [
      { value: 'weekly', label: this.translationService.t('transactions.weekly') },
      { value: 'monthly', label: this.translationService.t('transactions.monthly') },
      { value: 'yearly', label: this.translationService.t('transactions.yearly') }
    ];
  }

  // The form's current currency, mirrored into a signal (the categoryIdSignal
  // pattern) so goal option labels can react to it under OnPush.
  private formCurrency = signal<string>('');

  /**
   * The note as it currently stands, for the lens beneath the field. Mirrored
   * the same way the currency is: the lens takes a signal, and reading the
   * control from the template would not re-run under OnPush.
   */
  readonly noteValue = signal<string>('');

  private goalsSub?: Subscription;

  /**
   * Goals the picker offers: every active goal, plus — on edit — the row's
   * currently linked goal even when since deactivated, so the stored value
   * still renders and can be cleared. A linked goal that no longer exists
   * at all hides the picker; the held value then rides through the save
   * unchanged, where the service tolerates it.
   */
  goalOptions = computed<Goal[]>(() => {
    const active = this.goalService.activeGoals();
    const linkedId = this.data.transaction?.goalId;
    if (!linkedId || active.some(goal => goal.id === linkedId)) return active;
    const linked = this.goalService.goals().find(goal => goal.id === linkedId);
    return linked ? [...active, linked] : active;
  });

  /**
   * Option label: the goal's name, with its currency appended when it
   * differs from the transaction's — the amount will be converted at save,
   * and the suffix is what says so.
   */
  goalLabel(goal: Goal): string {
    return goal.currency === this.formCurrency()
      ? goal.name
      : `${goal.name} (${goal.currency})`;
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

  /**
   * Keep the picker able to show `code`, whether or not it is curated.
   * A no-op for the nineteen that already have an option.
   */
  private ensureCurrencyListed(code: string | null | undefined): void {
    if (!code || this.currencyService.getSupportedCurrencies().some(c => c.code === code)) {
      this.unlistedCurrency.set(null);
      return;
    }
    this.unlistedCurrency.set(this.currencyService.getCurrencyInfo(code) ?? null);
  }

  ngOnInit(): void {
    this.initForm();
    this.ensureCurrencyListed(this.data.transaction?.currency);
    // The goals signal is only warm if some page subscribed (ADR 0009), and
    // the transactions page has no goal surface — the picker owns its own.
    this.goalsSub = this.goalService.getGoals().subscribe();
    this.seedStoredReceipts();
    this.tags.set([...(this.data.transaction?.tags ?? [])]);
    const location = this.data.transaction?.location;
    if (location?.lat !== undefined && location?.lng !== undefined) {
      this.locationCoords.set({ lat: location.lat, lng: location.lng });
    }
    this.form.get('currency')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(code => this.onCurrencyEdited(String(code ?? '')));
  }

  /**
   * Attach the device's coordinates to the location. Denial or failure
   * degrades to whatever name was typed — the form never blocks on this.
   * Coarse accuracy is enough for "where was this shop" and avoids the long
   * cold-start wait GPS-grade accuracy costs.
   */
  useMyLocation(): void {
    if (!this.geolocationAvailable || this.isLocating()) return;

    this.isLocating.set(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        this.locationCoords.set({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        // The field now holds a real position, so the scan's offer of one is spent.
        this.suggestedCoordinates.set(null);
        this.isLocating.set(false);
        this.notifications.success(this.translationService.t('transactions.locationCaptured'));
      },
      positionError => {
        this.isLocating.set(false);
        const key = positionError.code === 1
          ? 'transactions.locationDenied'
          : 'transactions.locationUnavailable';
        this.notifications.error(this.translationService.t(key));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  clearCoordinates(): void {
    this.locationCoords.set(null);
    // Clearing the coordinates is a refusal, so the offer goes with them.
    this.suggestedCoordinates.set(null);
  }

  addTag(event: MatChipInputEvent): void {
    const tag = normalizeTag(event.value);
    if (tag && !this.tags().includes(tag)) {
      this.tags.update(tags => [...tags, tag]);
    }
    event.chipInput.clear();
  }

  removeTag(tag: string): void {
    this.tags.update(tags => tags.filter(existing => existing !== tag));
  }

  /**
   * Snapshot the edited item's stored images as {url, slot} pairs. The slot
   * is the entry's index in receiptUrls (a legacy row's single receiptUrl is
   * slot 0); tombstoned entries are skipped but the survivors keep their
   * original slots, which is what per-image removal and conversion act on.
   */
  private seedStoredReceipts(): void {
    const transaction = this.data.transaction;
    if (this.data.mode !== 'edit' || !transaction) return;
    const slots = transaction.receiptUrls
      ?? (transaction.receiptUrl ? [transaction.receiptUrl] : []);
    this.storedReceipts.set(
      slots.map((url, slot) => ({ url, slot })).filter(entry => !!entry.url)
    );
  }

  ngAfterViewInit(): void {
    this.setupDatepickerListeners();
  }

  ngOnDestroy(): void {
    this.datesSubs.forEach(sub => sub.unsubscribe());
    this.goalsSub?.unsubscribe();
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
    const defaultCurrency = baseCurrencyOf(this.authService.currentUser());
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
      goalId: [transaction?.goalId || null],
      locationName: [transaction?.location?.name || ''],
    });

    // Mirror the currency into its signal for the goal option labels.
    this.formCurrency.set(transaction?.currency || defaultCurrency);
    this.form.get('currency')?.valueChanges.subscribe((currency) => {
      this.formCurrency.set(currency || '');
    });

    // Seeded from the control rather than from the transaction: on edit the
    // lens has to offer a translation of the stored note before anything is
    // typed, and valueChanges alone never fires for the value it started with.
    this.noteValue.set(this.form.get('note')!.value ?? '');
    this.form.get('note')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(note => this.noteValue.set(note ?? ''));

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
      const receipts = this.pendingReceipts().map(pending => pending.file);

      const transactionData: CreateTransactionDTO = {
        type: formValue.type,
        amount: parseFloat(formValue.amount),
        currency: formValue.currency,
        categoryId: formValue.categoryId,
        description: formValue.description,
        date: formValue.date,
        ...(formValue.note ? { note: formValue.note } : {}),
        // Edit always sends the period, for the same reason tags does below:
        // clearing the select has to reach the document, and an omitted key
        // would leave the old period in place.
        ...(this.data.mode === 'edit'
          ? { period: formValue.period ?? undefined }
          : formValue.period
            ? { period: formValue.period }
            : {}),
        // Same presence contract as period: on edit the key always travels,
        // so clearing the select unlinks rather than leaving the old goal.
        ...(this.data.mode === 'edit'
          ? { goalId: formValue.goalId ?? undefined }
          : formValue.goalId
            ? { goalId: formValue.goalId }
            : {}),
        ...(receipts.length ? { receiptFiles: receipts } : {}),
        // Edit always sends tags — an emptied list must clear the stored
        // ones, which an omitted field would leave in place.
        ...(this.data.mode === 'edit'
          ? { tags: this.tags() }
          : this.tags().length
            ? { tags: this.tags() }
            : {}),
        ...this.locationField(formValue.locationName),
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
          has_tags: this.tags().length > 0,
          has_location: !!transactionData.location,
          receipt_image_count: receipts.length,
        });
        // The chips left on and the offers taken off, so the next scan of
        // this merchant starts from the user's own decision.
        if (this.filledByScan && this.scanSuggestedTags.length) {
          const kept = this.tags();
          await this.tagMemory.remember(
            transactionData.description,
            kept,
            this.scanSuggestedTags.filter(tag => !kept.includes(tag))
          );
        }
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
      } else if (error instanceof Error && error.message === RECEIPT_ATTACH_FAILED) {
        // The batch rolled back: the transaction is unchanged and none of
        // the queued images were kept.
        this.notifications.error(this.translationService.t('receiptImages.attachFailed'));
      } else if (error instanceof Error && error.message === GOAL_LINK_INVALID) {
        // The chosen goal vanished or was deactivated under the open form;
        // nothing was saved, and the entry is still here to re-aim.
        this.notifications.error(this.translationService.t('transactions.goalLinkInvalid'));
      } else {
        // A rules rejection, a failed rates load, a network error — the
        // dialog is disableClose, so without this the user pressed Add,
        // nothing happened, and their only exit discarded the entry.
        console.error('[TransactionForm] Save failed:', error);
        this.notifications.error(this.translationService.t('common.error'));
      }
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /**
   * The DTO's location fragment. A blank name means no location: the field
   * is omitted on add, and cleared on edit (coordinates hang off the name —
   * a bare lat/lng with nothing human-readable would render as an empty
   * chip, so clearing the name discards them too). When a coordinate is
   * attached, its bundled-table country overrules whatever the receipt's own
   * address printed — the phone outranking the paper, backwards from the
   * currency ladder's own precedence — acceptable only because a coordinate
   * lands here solely by the user's own deliberate action, never a scan's
   * guess (#156).
   */
  private locationField(rawName: unknown): Partial<CreateTransactionDTO> {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) {
      // No address, but the scan may still have concluded a country. That is
      // a location in its own right now (0068); it renders as the country's
      // name and it is what makes a trip reportable.
      const scanned = locationSlot(undefined, this.scanCountry);
      if (scanned.location) return scanned;
      return this.data.mode === 'edit' ? { location: undefined } : {};
    }
    const coords = this.locationCoords();
    if (!coords) {
      // The scan's own conclusion about the address it just prefilled, kept
      // only while the field still holds that exact prefill. A name the user
      // typed is their own answer to "where", and the paper's country is not
      // attached to it.
      const printedCountry = this.printedLocationCountry?.name === name
        ? this.printedLocationCountry.country
        : undefined;
      return locationSlot(name, printedCountry);
    }
    // Placed on device from the bundled table; absent when the coordinates
    // fall in open water or a country the table does not cover.
    const country = countryForCoordinates(coords.lat, coords.lng);
    return locationSlot(name, country, coords);
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
    const files = Array.from(input.files ?? []);

    // Reset input so the same files can be selected again
    input.value = '';

    if (files.length === 0) return;

    // Validate file types
    if (files.some(file => !file.type.startsWith('image/'))) {
      const message = this.translationService.t('ai.invalidFileType');
      this.notifications.error(message);
      return;
    }

    // Cap the queue at what the transaction can still hold.
    const capacity = MAX_RECEIPTS_PER_TRANSACTION
      - this.storedReceipts().length
      - this.pendingReceipts().length;
    if (capacity <= 0) {
      this.notifications.error(
        this.translationService.t('receiptImages.maxPerTransaction', {
          max: MAX_RECEIPTS_PER_TRANSACTION,
        })
      );
      return;
    }
    const accepted = files.slice(0, capacity);
    if (accepted.length < files.length) {
      this.notifications.info(
        this.translationService.t('receiptImages.maxPerTransaction', {
          max: MAX_RECEIPTS_PER_TRANSACTION,
        })
      );
    }

    // Every queued image stores a NEW one — at the limit, offer
    // cleanup/upgrade instead. All or nothing: a partial queue would save
    // a different set of images than the user picked.
    if (!(await this.receiptQuota.canAddImages(accepted.length))) {
      this.openLimitDialog();
      return;
    }

    // Compress/resize and cap at the receipt size limit before keeping them.
    let queued: { file: File; preview: string }[];
    try {
      queued = await Promise.all(
        accepted.map(async file => {
          let receipt: File;
          try {
            receipt = await compressImage(file, { maxBytes: MAX_RECEIPT_BYTES });
          } catch {
            receipt = file;
          }
          return { file: receipt, preview: await this.readAsDataUrl(receipt) };
        })
      );
    } catch {
      this.notifications.error(this.translationService.t('ai.readError'));
      return;
    }

    const wasEmpty = this.pendingReceipts().length === 0;
    this.pendingReceipts.update(list => [...list, ...queued]);

    // The AI scan fills the form from one receipt; run it for the first
    // image queued into an empty strip, as before multi-select existed.
    if (wasEmpty && queued.length > 0) {
      if (this.strategyService.canProcessNow()) {
        this.scannedReceipt = queued[0];
        this.scanReceipt(queued[0].file);
      } else {
        // The image is kept either way — only the scan needs a reachable
        // engine. Saying so now beats a generic failure after a long wait.
        this.notifications.info(this.translationService.t('ai.scanOffline'));
      }
    }
  }

  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read receipt image'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Fill the form from one receipt photo.
   *
   * Routed through AIStrategyService rather than a named provider, so the scan
   * honours whichever model the user configured and can fall back to the
   * on-device pipeline where one exists.
   */
  private async scanReceipt(file: File): Promise<void> {
    this.isScanning.set(true);
    this.scanError.set(null);
    this.scanSuggestedTags = [];
    let receiptCount = 1;
    // The form door: a failed scan leaves a record, a successful one leaves
    // the transaction the user goes on to save, which is the record.
    const attempt = this.receiptAttempts.begin('form', 'receipt_image', [file]);

    try {
      const result = await this.strategyService.processReceipt(file);
      const primary = result.transactions[0];
      // Unlike a parsed receipt, a processing result can legitimately come
      // back with no rows — an unreadable photo is not an error to the engine.
      if (!primary) {
        attempt.failed('nothing_extracted');
        throw new Error('The scan produced no transaction');
      }

      // Cleared before the patch below, which fires onCurrencyEdited through
      // valueChanges — otherwise a still-true flag left over from an earlier
      // scan this form instance ran would mistake this scan's own read for a
      // user settling that earlier fallback (#156).
      this.scanCurrencyFellBack = false;
      this.scanCountry = null;

      // Auto-fill form with extracted data
      this.ensureCurrencyListed(primary.currency);
      this.form.patchValue({
        amount: primary.amount > 0 ? primary.amount : '',
        currency: primary.currency || this.form.get('currency')?.value,
        description: primary.description || '',
        date: primary.date || new Date(),
      });

      // The itemized receipt body is assembled upstream, which already falls
      // back to the item lines when the model reproduced no receipt text.
      if (primary.notes) {
        this.form.patchValue({ note: primary.notes });
      }

      // Set category if suggested
      if (primary.suggestedCategoryId) {
        const category = this.filteredCategories().find(c => c.id === primary.suggestedCategoryId);
        if (category) {
          this.form.patchValue({ categoryId: primary.suggestedCategoryId });
          this.categoryIdSignal.set(primary.suggestedCategoryId);
        }
      }

      // The address the receipt prints, into an empty Location field only —
      // a place the user already typed outranks anything read off the paper.
      const printedLocation = primary.location?.name;
      const typedLocation = String(this.form.get('locationName')?.value ?? '').trim();
      if (printedLocation && !typedLocation) {
        this.form.patchValue({ locationName: printedLocation });
        // The reader's own country claim for that address, carried to the
        // save only while the field still holds exactly this prefill — an
        // edit means the paper's address no longer describes it (#156).
        this.printedLocationCountry = primary.location?.country
          ? { name: printedLocation, country: primary.location.country }
          : null;
      } else {
        this.printedLocationCountry = null;
      }
      // The receipt's own country claim, independent of whether it printed an
      // address and of what the Location field ends up holding.
      this.scanCountry = primary.receiptCountry || null;

      this.scanFieldConfidence.set(primary.fieldConfidence ?? null);

      // The receipt did not say what money this was, so the account's base
      // currency is sitting in the field. Offer a better guess; never apply it.
      this.suggestedCurrency.set(null);
      this.suggestedCoordinates.set(null);
      this.scanCurrencyFellBack = !!primary.currencyFellBack;
      if (primary.currencyFellBack) {
        void this.suggestCurrencyFromLocation(primary);
      }

      // Show success message
      const message = this.translationService.t('ai.scanSuccess');
      this.notifications.success(message);
      this.filledByScan = true;
      attempt.succeeded(result);
      receiptCount = result.receiptCount ?? 1;
      await this.suggestTagsForScan(primary);
    } catch (error) {
      console.error('Receipt scan error:', error);
      attempt.failed(error);
      const message = this.translationService.t('ai.scanError');
      this.scanError.set(message);
      this.notifications.error(message);
      // A failed scan leaves the user filling the form in by hand. An offer
      // the previous scan made no longer describes anything on the form.
      this.filledByScan = false;
      this.scanFieldConfidence.set(null);
      this.suggestedCurrency.set(null);
      this.suggestedCoordinates.set(null);
      this.scanCurrencyFellBack = false;
      this.scanCountry = null;
    } finally {
      this.isScanning.set(false);
    }

    if (receiptCount > 1) {
      await this.offerMultiReceiptReview(receiptCount);
    }
  }

  /**
   * Tags only from what the account already uses, into the chip input where
   * each can be removed before saving. Runs after the scan has been reported
   * as done: a second round-trip, and never a reason to fail the first.
   */
  private async suggestTagsForScan(primary: ProcessedTransaction): Promise<void> {
    try {
      const [suggestedTags] = await this.tagSuggestions.suggest(
        [{ description: primary.description, ...(primary.notes ? { details: primary.notes } : {}) }],
        await this.groundingHistory.recent()
      );
      if (suggestedTags?.length) {
        this.scanSuggestedTags = suggestedTags;
        this.tags.update(current => normalizeTags([...current, ...suggestedTags]));
      }
    } catch (error) {
      console.warn('[TransactionForm] Tag suggestion failed:', error);
    }
  }

  /**
   * Offer a currency for a scan that fell back, from the ladder.
   *
   * The receipt's own country is asked first and costs nothing. A position
   * is fetched only when that rung is silent and the receipt is dated today
   * — an old receipt never prompts for location — and a coordinate already
   * attached to this transaction is reused whatever the date, being the
   * receipt's own place. Refusal is silent: the base currency is already in
   * the field, and a suggestion nobody asked for is not worth an error.
   */
  private async suggestCurrencyFromLocation(primary: ProcessedTransaction): Promise<void> {
    // The same question the ladder's own receipt rung asks (#156):
    // readCountryCode canonicalizes CLDR aliases (UK → GB) before the
    // currency table is consulted, so this gate never fetches a position
    // the ladder was always going to ignore in favour of the receipt.
    const receiptSpeaks = !!currencyForCountry(readCountryCode(primary.receiptCountry));
    const attached = this.locationCoords();
    const datedToday = this.isDatedToday();
    let positionCountry: string | undefined;

    if (!receiptSpeaks) {
      const coords = attached ?? (datedToday ? await this.currentCoordinates() : null);
      if (coords) {
        // A fix fetched for the currency is also where this receipt was paid
        // — when it is from today. Offered, never attached (#314).
        if (!attached && datedToday) {
          this.suggestedCoordinates.set(coords);
        }
        positionCountry = countryForCoordinates(coords.lat, coords.lng) ?? undefined;
      }
    }

    this.suggestedCurrency.set(suggestCurrency({
      receiptCountry: primary.receiptCountry,
      positionCountry,
      datedToday: attached !== null || datedToday,
      sessionCurrency: this.currencySession.current() ?? undefined,
      localeRegion: localeRegion(),
      currentCurrency: String(this.form.get('currency')?.value ?? ''),
    }));
  }

  /** A coarse position, or null for any reason at all. */
  private currentCoordinates(): Promise<{ lat: number; lng: number } | null> {
    if (!this.geolocationAvailable) {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        // A country needs nothing better than this, and a cached fix avoids
        // waking the GPS for an answer that is only a suggestion.
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
      );
    });
  }

  /** "Looks like South Korea — use KRW?", or just "Use THB?" for a session rung that knows no country. */
  suggestionLabel(suggestion: CurrencySuggestion): string {
    return suggestion.country
      ? this.translationService.t('import.currencyFromCountry', {
          country: countryDisplayName(suggestion.country, this.localeFormat.locale),
          currency: suggestion.code,
        })
      : this.translationService.t('import.currencySuggested', { currency: suggestion.code });
  }

  reasonLabel(reason: CurrencySuggestionReason): string {
    return this.translationService.t(currencyReasonKey(reason));
  }

  /** Take the suggested currency, adding it to the picker if it is uncurated, and remember it for the session. */
  acceptCurrencySuggestion(): void {
    const suggestion = this.suggestedCurrency();
    if (!suggestion) {
      return;
    }
    this.ensureCurrencyListed(suggestion.code);
    this.suggestedCurrency.set(null);
    this.form.patchValue({ currency: suggestion.code });
  }

  dismissCurrencySuggestion(): void {
    this.suggestedCurrency.set(null);
  }

  /**
   * A currency the user settles by hand on a fallen-back scan is as good an
   * answer as an accepted chip, and the next receipt this session should
   * know it. A scan whose currency was read is not a choice about fallback.
   *
   * The flag is left standing rather than cleared here, so a later correction
   * to the same fallen-back scan overwrites the session with the user's
   * final answer instead of their first. It is cleared only where a new
   * scan — or the discarding of one — means there is no fallback left to settle.
   */
  private onCurrencyEdited(code: string): void {
    if (!this.scanCurrencyFellBack || !code) {
      return;
    }
    this.suggestedCurrency.set(null);
    this.currencySession.remember(code);
  }

  private isDatedToday(): boolean {
    const value = this.form.get('date')?.value;
    const date = value instanceof Date ? value : parseDateInput(value);
    return !!date && dayKey(date) === dayKey(new Date());
  }

  acceptCoordinateSuggestion(): void {
    const coords = this.suggestedCoordinates();
    if (!coords) return;
    this.locationCoords.set(coords);
    this.suggestedCoordinates.set(null);
  }

  dismissCoordinateSuggestion(): void {
    this.suggestedCoordinates.set(null);
  }

  /**
   * True when the scan was unsure enough about a field to be worth a look.
   *
   * This form has no review step — a scanned value goes straight into a field
   * the user is about to submit — so the flag has to live beside the input
   * itself, the way the import preview flags its own rows.
   */
  shouldVerifyField(field: 'amount' | 'date'): boolean {
    const confidence = this.scanFieldConfidence()?.[field];
    return confidence !== undefined && confidence < VERIFY_FIELD_THRESHOLD;
  }

  /** Why a field is flagged, phrased as the import preview phrases it. */
  verifyFieldTooltip(field: 'amount' | 'date'): string {
    const percent = Math.round((this.scanFieldConfidence()?.[field] ?? 0) * 100);
    return this.translationService.t(
      field === 'amount' ? 'import.verifyAmount' : 'import.verifyDate',
      { percent }
    );
  }

  /**
   * A single-shot scan spotted several receipts in the photo. The form can
   * hold only the primary one, so offer the receipt-aware import review;
   * declining keeps the already-patched form.
   */
  private async offerMultiReceiptReview(count: number): Promise<void> {
    const file = this.pendingReceipts()[0]?.file;
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
    // This extraction starts at the form, from an image the user chose
    // there — the same door the single-shot scan above already opened and
    // settled, not the camera's (#151).
    const attempt = this.receiptAttempts.begin('form', 'receipt_image', [file]);
    try {
      const importResult = await this.aiImportService.importFromMultipleImages([file]);
      if (importResult.transactions.length > 0) {
        attempt.succeeded(importResult);
      } else {
        attempt.failed('nothing_extracted');
      }
      // Close before navigating so the wizard reads the completed
      // navigation's history state
      this.dialogRef.close(false);
      this.router.navigate(['/import/file'], {
        state: { importResult, fromCamera: true, door: 'form', multiImage: false },
      });
    } catch (error) {
      attempt.failed(error);
      console.error('Multi-receipt import error:', error);
      this.notifications.error(this.translationService.t('ai.scanError'));
    } finally {
      this.isScanning.set(false);
    }
  }

  removePendingReceipt(index: number): void {
    const removed = this.pendingReceipts()[index];
    this.pendingReceipts.update(list => list.filter((_, i) => i !== index));
    // Discarding the image the scan ran against withdraws the scan's claim
    // on this form — whatever the user keeps typing is manual entry.
    if (removed && removed === this.scannedReceipt) {
      this.scannedReceipt = null;
      this.filledByScan = false;
      this.scanError.set(null);
      this.scanFieldConfidence.set(null);
      this.suggestedCurrency.set(null);
      this.scanCurrencyFellBack = false;
      // The prefilled address's country claim dies with the scan that made
      // it — otherwise a still-typed Location field would save with a
      // country read off a receipt the user just discarded. The receipt's own
      // country claim dies with it for the same reason.
      this.printedLocationCountry = null;
      this.scanCountry = null;
    }
  }

  /**
   * Remove one stored receipt image from the item being edited, freeing one
   * slot of the receipt-image quota. The rest of the strip is untouched.
   */
  async removeStoredReceipt(stored: { url: string; slot: number }): Promise<void> {
    const transaction = this.data.transaction;
    if (!transaction || this.busyStoredSlot() !== null) return;

    const data: ConfirmDialogData = {
      title: this.translationService.t('receiptImages.removeOneConfirmTitle'),
      message: this.translationService.t('receiptImages.removeOneConfirmMessage'),
      confirmLabel: this.translationService.t('common.remove'),
      confirmColor: 'warn',
      icon: 'delete',
    };
    const confirmed = await new Promise<boolean>(resolve => {
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
        .subscribe(result => resolve(!!result));
    });
    if (!confirmed) return;

    this.busyStoredSlot.set(stored.slot);
    try {
      await this.transactionService.removeReceiptAt(transaction.id, stored.slot);
      this.storedReceipts.update(list => list.filter(entry => entry.slot !== stored.slot));
      this.notifications.success(this.translationService.t('receiptImages.removed'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.busyStoredSlot.set(null);
    }
  }

  /**
   * Convert one stored receipt image into detailed note text and remove
   * that image. The note control picks up the new text so the form stays
   * consistent with what was persisted.
   */
  async convertStoredReceiptToNote(stored: { url: string; slot: number }): Promise<void> {
    const transaction = this.data.transaction;
    if (!transaction || this.busyStoredSlot() !== null) return;

    this.busyStoredSlot.set(stored.slot);
    try {
      // Convert against the note currently in the form, not the stored one
      const note = await this.receiptToNote.convertReceiptToNote(
        {
          ...transaction,
          note: this.form.get('note')?.value || transaction.note,
        },
        stored.slot
      );
      this.form.patchValue({ note });
      this.storedReceipts.update(list => list.filter(entry => entry.slot !== stored.slot));
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
      this.busyStoredSlot.set(null);
    }
  }

  // === AI Category Suggestion Methods ===

  private setupCategorySuggestion(): void {
    if (!this.strategyService.canUseCloud()) return;

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
    this.analytics.trackAiAssistUsed({ feature: 'categorization' });
    this.isSuggesting.set(true);
    this.suggestedCategory.set(null);

    try {
      const categories = this.filteredCategories();
      const suggestedId = await this.strategyService.suggestCategory(description, categories);

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
