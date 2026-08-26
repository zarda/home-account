import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import {
  Category,
  CategorizedImportTransaction,
  CurrencyInfo,
  CurrencySuggestionReason,
  VERIFY_FIELD_THRESHOLD,
} from '../../../../models';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { countryDisplayName, currencyReasonKey } from '../../../../core/utils/currency-suggestion.utils';
import { CategorySuggestionComponent } from '../category-suggestion/category-suggestion.component';
import { LocaleDatePipe } from '../../../../shared/pipes/locale-date.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { LocationLabelPipe } from '../../../../shared/pipes/location-label.pipe';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-transaction-preview-table',
  standalone: true,
  imports: [
    EmptyStateComponent,
    CommonModule,
    MatCheckboxModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    FormsModule,
    CategorySuggestionComponent,
    MatTooltipModule,
    LocaleDatePipe,
    TranslatePipe,
    LocationLabelPipe,
    FitTextDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-preview-table.component.html',
  styleUrl: './transaction-preview-table.component.scss'
})
export class TransactionPreviewTableComponent {
  private translationService = inject(TranslationService);
  private currencyService = inject(CurrencyService);
  private currencySession = inject(CurrencyChoiceSessionService);
  private localeFormat = inject(LocaleFormatService);

  @Input() transactions: CategorizedImportTransaction[] = [];
  @Input() categories: Category[] = [];
  @Output() transactionsUpdated = new EventEmitter<CategorizedImportTransaction[]>();
  @Output() selectionChanged = new EventEmitter<Set<string>>();

  /**
   * Row ids that have fallen back at some point this session, kept apart
   * from `currencyFellBack` itself — which the first hand-correction clears,
   * because the row really is settled and the marker earns its removal.
   * Eligibility to record a choice is a different question from whether the
   * marker is still showing, the same separation the transaction form keeps
   * between its own visible marker and its own `scanCurrencyFellBack` flag
   * (#156): otherwise a second correction to an already-settled row sees a
   * clean `currencyFellBack` and records nothing, and the session is left
   * holding the user's first guess rather than the answer they landed on.
   *
   * This Set's own correctness assumes the review step stays eagerly
   * instantiated the way it is today (its content sits directly in the
   * `mat-step`, not behind a lazy `<ng-template matStepContent>`). If that
   * ever changes, the step's view — and this Set with it — resets each time
   * the stepper navigates away and back, while the rows themselves persist
   * on the parent; a row's eligibility would be forgotten and the
   * first-answer bug this Set exists to prevent would return with no spec
   * to catch it.
   */
  private fellBackEligible = new Set<string>();

  readonly currencies = this.currencyService.getSupportedCurrencies();

  // Plain methods, not computed(): `transactions` is a regular @Input array,
  // not a signal — a computed would evaluate once and
  // cache stale selection state forever
  selectedCount(): number {
    return this.transactions.filter(t => t.selected).length;
  }

  /** 1-based photo list for the receipt badge, e.g. "1–3" for a merged row. */
  receiptPhotos(row: CategorizedImportTransaction): string {
    const meta = row.imageMetadata;
    const sources = meta?.mergedFromImages?.length ? meta.mergedFromImages : [meta?.imageIndex ?? 0];
    return sources.map(i => i + 1).join('–');
  }

  allSelected(): boolean {
    const nonDuplicates = this.transactions.filter(t => !t.isDuplicate);
    return nonDuplicates.length > 0 && nonDuplicates.every(t => t.selected);
  }

  someSelected(): boolean {
    return this.transactions.some(t => t.selected);
  }

  /**
   * Replace one row in place of mutating it.
   *
   * Every edit here used to assign straight onto the `@Input()` object, which
   * worked only because `emitChanges` happened to emit a fresh array — the
   * parent's signal saw a new reference while the objects inside it were the
   * same ones the parent already held. Any `computed()` reading those objects
   * would have gone stale. Rewriting the row makes the change visible by
   * identity, which matters now that a row carries state (`fieldConfidence`)
   * an edit is supposed to clear.
   */
  private replaceRow(
    transaction: CategorizedImportTransaction,
    changes: Partial<CategorizedImportTransaction>
  ): void {
    const index = this.transactions.indexOf(transaction);
    if (index === -1) return;
    this.transactions = [
      ...this.transactions.slice(0, index),
      { ...transaction, ...changes },
      ...this.transactions.slice(index + 1),
    ];
    this.emitChanges();
  }

  toggleSelectAll(checked: boolean): void {
    this.transactions = this.transactions.map(t =>
      t.isDuplicate ? t : { ...t, selected: checked }
    );
    this.emitChanges();
  }

  toggleSelection(transaction: CategorizedImportTransaction, checked: boolean): void {
    this.replaceRow(transaction, { selected: checked });
  }

  toggleType(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, {
      type: transaction.type === 'income' ? 'expense' : 'income',
    });
  }

  updateCategory(transaction: CategorizedImportTransaction, categoryId: string): void {
    this.replaceRow(transaction, {
      suggestedCategoryId: categoryId,
      categoryConfidence: 1.0, // User confirmed
    });
  }

  /**
   * The curated picker, plus the row's own code when it is not curated.
   * getCurrencyInfo already answers any ISO code (currencyInfoFor); the
   * literal covers a code the ISO table does not know.
   */
  currencyOptions(row: CategorizedImportTransaction): CurrencyInfo[] {
    const curated = this.currencies;
    if (curated.some(c => c.code === row.currency)) return curated;
    const own = this.currencyService.getCurrencyInfo(row.currency)
      ?? { code: row.currency, nameKey: row.currency, symbol: row.currency };
    return [own, ...curated];
  }

  /** Decimals follow the currency: ¥1,200, not ¥1,200.00. */
  formatAmount(row: CategorizedImportTransaction): string {
    return this.currencyService.formatCurrency(row.amount, row.currency);
  }

  /**
   * Records this row as eligible to have a currency choice remembered, and
   * reports whether it now is. True the first time a row falls back, and
   * every time after — clearing the visible marker on the row does not
   * retire the row's own membership here. See `fellBackEligible` for why the
   * two have to stay apart. Named as an action rather than a plain predicate
   * because the recording is not incidental: `applyCurrencyToSelected` below
   * calls this once per selected row specifically so every row's membership
   * gets recorded, and depends on that call never being skipped by
   * short-circuiting.
   */
  private recordFellBackEligibility(transaction: CategorizedImportTransaction): boolean {
    const eligible = !!transaction.currencyFellBack || this.fellBackEligible.has(transaction.id);
    if (eligible) {
      this.fellBackEligible.add(transaction.id);
    }
    return eligible;
  }

  updateCurrency(transaction: CategorizedImportTransaction, code: string): void {
    // Chosen by the user, so whatever the source failed to read no longer
    // applies — and a choice made for a fallen-back row is worth remembering
    // for the next one this session, including a later hand-correction to
    // this same row after an earlier one already cleared its marker.
    if (this.recordFellBackEligibility(transaction)) {
      this.currencySession.remember(code);
    }
    this.replaceRow(transaction, { currency: code, currencyFellBack: false, currencySuggestion: undefined });
  }

  /**
   * A batch of photos from one trip is nearly always one currency. Bulk is
   * the user's choice, never the ladder's (ADR 0062) — but the session
   * memory is documented to hold a choice for a row nobody could read, so a
   * currency picked for a batch that already read fine does not belong
   * there. Gated the same way the per-row edit is, on eligibility rather
   * than the live marker, so a row already settled by hand earlier this
   * session still counts here.
   */
  applyCurrencyToSelected(code: string): void {
    const selected = this.transactions.filter(t => t.selected);
    let eligible = false;
    // Not `selected.some(t => this.recordFellBackEligibility(t))`: `.some`
    // stops at the first `true`, and every selected row needs its own
    // membership in `fellBackEligible` recorded, not just the first one.
    for (const t of selected) {
      if (this.recordFellBackEligibility(t)) eligible = true;
    }
    if (eligible) {
      this.currencySession.remember(code);
    }
    this.transactions = this.transactions.map(t =>
      t.selected ? { ...t, currency: code, currencyFellBack: false, currencySuggestion: undefined } : t
    );
    this.emitChanges();
  }

  currencyFellBackTooltip(): string {
    return this.translationService.t('import.currencyFellBack');
  }

  /**
   * A button's aria-label replaces the name its content would compute, so the
   * marker icon inside the chip is never announced on its own. The mark rides
   * on the chip's own name instead.
   */
  currencyChipLabel(row: CategorizedImportTransaction): string {
    const label = this.translationService.t('import.setCurrency', { currency: row.currency });
    return row.currencyFellBack ? `${this.currencyFellBackTooltip()}. ${label}` : label;
  }

  // `tags` is spread only when non-empty, so an emptied list is exactly "not
  // written". The location is no longer that simple: since 0068 the mapper
  // rebuilds one from `receiptCountry` when the row carries no location, so
  // clearing the slot alone would let the country the user just dismissed
  // walk back in. Both marks go, or removal does not mean removal.
  removeLocation(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, { location: undefined, receiptCountry: undefined });
  }

  removeTag(transaction: CategorizedImportTransaction, tag: string): void {
    this.replaceRow(transaction, { tags: (transaction.tags ?? []).filter(t => t !== tag) });
  }

  /** Accept = the ordinary currency edit, so one path clears the marks and records the choice. */
  acceptCurrencySuggestion(transaction: CategorizedImportTransaction): void {
    const offer = transaction.currencySuggestion;
    if (!offer) return;
    this.updateCurrency(transaction, offer.code);
  }

  /** Dismiss = drop the mark. The row keeps its fallen-back marker; nothing was applied. */
  dismissCurrencySuggestion(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, { currencySuggestion: undefined });
  }

  currencyOfferText(row: CategorizedImportTransaction): string {
    const offer = row.currencySuggestion;
    if (!offer) return '';
    return offer.country
      ? this.translationService.t('import.currencyFromCountry', {
          country: countryDisplayName(offer.country, this.localeFormat.locale),
          currency: offer.code,
        })
      : this.translationService.t('import.currencySuggested', { currency: offer.code });
  }

  currencyOfferReason(row: CategorizedImportTransaction): string {
    const offer = row.currencySuggestion;
    return offer ? this.reasonLabel(offer.reason) : '';
  }

  /** The accept button's name says what it does and why; the visible text alone says neither fully. */
  currencyOfferLabel(row: CategorizedImportTransaction): string {
    const code = row.currencySuggestion?.code ?? '';
    return `${this.translationService.t('import.acceptCurrencySuggestion', { currency: code })}. ${this.currencyOfferReason(row)}`;
  }

  private reasonLabel(reason: CurrencySuggestionReason): string {
    return this.translationService.t(currencyReasonKey(reason));
  }

  /** Link to the offered rule, or undo it — restoring what the source said about isRecurring. */
  toggleRecurringLink(transaction: CategorizedImportTransaction, linked: boolean): void {
    const match = transaction.recurringMatch;
    if (!match) return;
    this.replaceRow(
      transaction,
      linked
        ? { recurringId: match.id, isRecurring: true }
        : { recurringId: undefined, isRecurring: match.sourceIsRecurring }
    );
  }

  /**
   * Whether a field was read confidently enough not to need a second look.
   *
   * An unreported confidence is not a low one: CSV and JSON imports have no
   * model to ask, and flagging every one of their rows would train the user to
   * ignore the marker.
   */
  needsVerification(transaction: CategorizedImportTransaction, field: 'amount' | 'date'): boolean {
    const confidence = transaction.fieldConfidence?.[field];
    return confidence !== undefined && confidence < VERIFY_FIELD_THRESHOLD;
  }

  /** Tooltip for a flagged field, carrying the percentage the model reported. */
  verificationTooltip(
    transaction: CategorizedImportTransaction,
    field: 'amount' | 'date'
  ): string {
    const percent = Math.round((transaction.fieldConfidence?.[field] ?? 0) * 100);
    return this.translationService.t(
      field === 'amount' ? 'import.verifyAmount' : 'import.verifyDate',
      { percent }
    );
  }

  updateNotes(): void {
    this.emitChanges();
  }

  initNotes(transaction: CategorizedImportTransaction): void {
    transaction.notes = '';
    // Focus will happen naturally since the textarea appears via @if
  }

  getRowCount(notes: string): number {
    if (!notes) return 1;
    const lineCount = notes.split('\n').length;
    return Math.min(Math.max(lineCount, 1), 20);
  }

  private emitChanges(): void {
    this.transactionsUpdated.emit([...this.transactions]);
    const selectedIds = new Set(
      this.transactions.filter(t => t.selected).map(t => t.id)
    );
    this.selectionChanged.emit(selectedIds);
  }
}
