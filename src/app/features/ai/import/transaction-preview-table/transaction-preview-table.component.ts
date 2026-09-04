import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  Output,
  afterNextRender,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
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
import { datedToday, needsDateAnswer, parseAmountInput, withoutFieldConfidence } from '../../../../core/utils/import-review.utils';
import { isImeComposition } from '../../../../core/utils/keyboard.utils';
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
    MatDatepickerModule,
    MatNativeDateModule,
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
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private cdr = inject(ChangeDetectorRef);

  @Input() transactions: CategorizedImportTransaction[] = [];
  @Input() categories: Category[] = [];
  /**
   * The rows a receipt reader produced, by id: the ones whose date is a
   * question the reviewer answers (`needsDateAnswer`). The wizard fills it.
   * Per row rather than per batch, because the dropzone accepts a mixed pick
   * and `processFiles` concatenates the photo batch's rows with every CSV and
   * PDF row into one array — a batch-wide bit would turn each historical CSV
   * row into a question the moment one photo rode along.
   */
  @Input() dateAttentionIds: ReadonlySet<string> = new Set();
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

  /**
   * The country the reader concluded when no address was printed. The mapper
   * writes it as the row's location (0068), so the card shows it the way it
   * shows one, and the location's own remove is what clears it.
   */
  receiptCountryText(row: CategorizedImportTransaction): string {
    return row.receiptCountry ? countryDisplayName(row.receiptCountry, this.localeFormat.locale) : '';
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

  /**
   * Explains why a row is dated today rather than something read off the
   * source — the implausible wording when the row was read clearly and
   * still cannot be right, the unreadable wording otherwise.
   */
  dateAssumedTooltip(row: CategorizedImportTransaction): string {
    return this.translationService.t(
      row.dateImplausible ? 'import.dateImplausibleTooltip' : 'import.dateAssumedTooltip'
    );
  }

  /**
   * Tooltip for a flagged field, carrying the percentage the model reported —
   * except a date whose row already carries `dateAssumed`: the shown value
   * is "now", not a reading, so a confidence percentage would describe a
   * date that isn't there anymore. The assumed wording takes over instead.
   */
  verificationTooltip(
    transaction: CategorizedImportTransaction,
    field: 'amount' | 'date'
  ): string {
    if (field === 'date' && transaction.dateAssumed) {
      return this.dateAssumedTooltip(transaction);
    }
    const percent = Math.round((transaction.fieldConfidence?.[field] ?? 0) * 100);
    return this.translationService.t(
      field === 'amount' ? 'import.verifyAmount' : 'import.verifyDate',
      { percent }
    );
  }

  private attention(row: CategorizedImportTransaction): boolean {
    return this.dateAttentionIds.has(row.id);
  }

  /**
   * A receipt row dated on another day, still unanswered — and selected:
   * a row that will not be imported is not a question, and the chip that
   * answers one (needsDateAnswer) never renders for an unselected row, so
   * the mark would point at a Keep that is not there.
   */
  dateNotToday(row: CategorizedImportTransaction): boolean {
    return this.attention(row) && row.selected && !row.dateReviewed && !datedToday(row.date);
  }

  /**
   * Whether the date button wears a flag: a grade under the bar, or a
   * receipt day that is not today. An assumed date with a clear grade wears
   * none — the question chip is that row's surface, and the wording still
   * rides on the button's name.
   */
  dateFlagged(row: CategorizedImportTransaction): boolean {
    return this.needsVerification(row, 'date') || this.dateNotToday(row);
  }

  /**
   * An assumed date is asked about on every batch — the chip's Keep is the
   * only way to settle it — and gated only under attention; a date on
   * another day is asked about only under attention at all.
   */
  showsDateChip(row: CategorizedImportTransaction): boolean {
    return (!!row.dateAssumed && !row.dateReviewed) || needsDateAnswer(row, this.attention(row));
  }

  /**
   * Why the date is marked, in the reviewer's words: checked, once they
   * answered (so the check icon has a name); for an assumed or graded date,
   * the wording verificationTooltip already chooses; otherwise the receipt
   * was dated another day. Empty for a row nobody doubts.
   */
  dateTooltip(row: CategorizedImportTransaction): string {
    if (row.dateReviewed) {
      return this.translationService.t('import.dateReviewed');
    }
    if (row.dateAssumed || this.needsVerification(row, 'date')) {
      return this.verificationTooltip(row, 'date');
    }
    if (this.dateNotToday(row)) {
      return this.translationService.t('import.dateNotTodayTooltip', { date: this.formattedDate(row) });
    }
    return '';
  }

  changeDateLabel(row: CategorizedImportTransaction): string {
    return this.translationService.t('import.changeDate', { date: this.formattedDate(row) });
  }

  /** The mark leads the button's name, exactly as currencyChipLabel does. */
  dateChipLabel(row: CategorizedImportTransaction): string {
    return this.withReason(this.dateTooltip(row), this.changeDateLabel(row));
  }

  dateChipText(row: CategorizedImportTransaction): string {
    return row.dateAssumed
      ? this.translationService.t('import.dateAssumedKeep')
      : this.translationService.t('import.dateNotTodayKeep', { date: this.formattedDate(row) });
  }

  /** The keep button's name says why the row is asked and what it keeps; the visible text says neither fully. */
  keepDateLabel(row: CategorizedImportTransaction): string {
    return this.withReason(
      this.dateTooltip(row),
      this.translationService.t('import.keepDate', { date: this.formattedDate(row) })
    );
  }

  /**
   * Reason, then action, joined the way currencyChipLabel joins them. The
   * three date tooltips are sentences with a stop of their own — "." in
   * en, "。" in ja and tc — so the reason's terminator goes before the join
   * adds one, or a flagged row is read out "here.. Change". dateReviewed
   * and the percent wording carry no stop and join as they are.
   */
  private withReason(reason: string, label: string): string {
    return reason ? `${reason.replace(/\s*[.。]?\s*$/, '')}. ${label}` : label;
  }

  /**
   * What every date answer settles, in one place so a picked day, Keep and
   * the bulk Keep cannot drift: the marks go, the date's grade goes (absent
   * is the reading needsVerification already gives a row nobody doubts) and
   * the row is marked answered. With the marks left standing,
   * needsVerification and the assumed tooltip would keep a kept row amber
   * after the reviewer had answered.
   */
  private dateAnswered(row: CategorizedImportTransaction): Partial<CategorizedImportTransaction> {
    return {
      dateReviewed: true,
      dateAssumed: undefined,
      dateImplausible: undefined,
      fieldConfidence: withoutFieldConfidence(row.fieldConfidence, 'date'),
    };
  }

  /** `null` is what the picker emits for a cleared input; a row cannot be dated nothing. */
  updateDate(row: CategorizedImportTransaction, value: Date | null): void {
    if (!value) return;
    this.replaceRow(row, { ...this.dateAnswered(row), date: value });
  }

  /**
   * The only answer for a date that is already right: the picker's
   * dateChange does not fire when the same day is picked again, so nothing
   * else settles such a row.
   */
  keepDate(row: CategorizedImportTransaction): void {
    this.replaceRow(row, this.dateAnswered(row));
  }

  /**
   * Selected receipt rows still owing a date answer — what the header's
   * bulk Keep is for. A plain method for the reason selectedCount gives:
   * both the rows and the attention set are plain @Input()s.
   */
  unansweredCount(): number {
    return this.transactions.filter(t => needsDateAnswer(t, this.attention(t))).length;
  }

  /**
   * Keep for every row still asked: a trip's worth of receipts are all
   * dated on their own days, and the dates are usually right. Exactly the
   * rows needsDateAnswer names, each settled the way the single Keep
   * settles it, so a bulk-kept assumed row does not stay amber; every other
   * row keeps its identity, the way applyCurrencyToSelected leaves the
   * unselected ones.
   */
  keepAllDates(): void {
    this.transactions = this.transactions.map(t =>
      needsDateAnswer(t, this.attention(t)) ? { ...t, ...this.dateAnswered(t) } : t
    );
    this.emitChanges();
  }

  private formattedDate(row: CategorizedImportTransaction): string {
    return this.localeFormat.formatDate(row.date);
  }

  /**
   * Which field a row is being edited in, by row id — never a flag on the row
   * itself, because committing an edit replaces the row and would drop the
   * state the commit is still reading. Keyed the way fellBackEligible is, and
   * surviving replaceRow for the same reason.
   */
  private editing = new Map<string, 'amount' | 'description'>();

  // A plain method rather than a computed, for the reason selectedCount gives.
  isEditing(row: CategorizedImportTransaction, field: 'amount' | 'description'): boolean {
    return this.editing.get(row.id) === field;
  }

  /**
   * Open the editor on a field and put the caret in it, so the tap that asked
   * to edit is also the tap that starts typing.
   */
  startEdit(row: CategorizedImportTransaction, field: 'amount' | 'description'): void {
    this.editing.set(row.id, field);
    this.cdr.markForCheck();
    this.focusWhenRendered(`[data-row-id="${CSS.escape(row.id)}"] .inline-input`);
  }

  /**
   * Focus the element a swap is about to put on the card. The target does not
   * exist until the swap has rendered, which is what afterNextRender waits
   * for; a registration on a destroyed injector throws NG0911, which is what
   * the guard is for. The card's own data-row-id scopes the query, because
   * there is one of every editor per row inside the @for.
   */
  private focusWhenRendered(selector: string): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector }
    );
  }

  /**
   * Close the editor, leaving the row as it was. Clearing the state is the
   * first thing every exit does: the input goes with it, and the blur that
   * departure fires reaches the same commit handler, which reads the cleared
   * state as "nothing is being edited" and stands down.
   *
   * A key that ends the edit hands focus back to the trigger that replaces
   * the input, so a keyboard reviewer walking down the batch is not dropped
   * at the document root by every correction — and the trigger they land on
   * names the value as it now stands. A blur is the one exit that does not:
   * focus is already going somewhere the reviewer chose, and pulling it back
   * would trap them in the row.
   */
  private closeEdit(row: CategorizedImportTransaction, restoreFocus: boolean): void {
    const field = this.editing.get(row.id);
    this.editing.delete(row.id);
    this.cdr.markForCheck();
    if (restoreFocus && field) {
      this.focusWhenRendered(`[data-row-id="${CSS.escape(row.id)}"] .${field}-section .inline-edit`);
    }
  }

  cancelEdit(row: CategorizedImportTransaction): void {
    this.closeEdit(row, true);
  }

  commitDescription(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    // ja and tc type through an IME, where Enter confirms the conversion
    // rather than finishing the line — the same guard the saved-search label
    // carries. The amount takes it too: an IME left in Japanese mode composes
    // digits as well, and that Enter would end the edit mid-figure.
    if (isImeComposition(event)) return;
    const description = (event.target as HTMLInputElement).value.trim();
    this.closeEdit(row, event.type === 'keydown');
    // An emptied field is a reviewer starting over, not one asking for a row
    // that reads as nothing in the list.
    if (!description || description === row.description) return;
    this.replaceRow(row, { description });
  }

  /**
   * A hand-typed amount settles the figure: the grade goes with it, the same
   * rule a date answer follows. Anything unreadable — or the figure already
   * shown — closes the editor and changes nothing.
   */
  commitAmount(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    if (isImeComposition(event)) return;
    const amount = parseAmountInput((event.target as HTMLInputElement).value);
    this.closeEdit(row, event.type === 'keydown');
    if (amount === null || amount === row.amount) return;
    this.replaceRow(row, {
      amount,
      fieldConfidence: withoutFieldConfidence(row.fieldConfidence, 'amount'),
    });
  }

  /** The trigger's name has to carry the value, which its own content states without saying what it is. */
  editDescriptionLabel(row: CategorizedImportTransaction): string {
    return this.translationService.t('import.editDescription', { description: row.description });
  }

  editAmountLabel(row: CategorizedImportTransaction): string {
    return this.translationService.t('import.editAmount', { amount: this.formatAmount(row) });
  }

  /**
   * Which rows have their notes editor open, and what has been typed into it
   * so far — by row id, for the reason `editing` gives: filing the note
   * replaces the row, and state carried on the object would be dropped by the
   * commit that reads it. The draft lives here and not on the row because the
   * row is the parent's object: the old textarea wrote straight onto it, so a
   * note typed during an in-flight import could change what was written for
   * a row not yet processed.
   */
  private notesOpen = new Set<string>();
  private draftNotes = new Map<string, string>();

  // Plain methods, for the reason selectedCount gives.
  showsNotes(row: CategorizedImportTransaction): boolean {
    return !!row.notes || this.notesOpen.has(row.id);
  }

  /** What the editor shows: the draft while one is being typed, else the row's own note. */
  notesText(row: CategorizedImportTransaction): string {
    return this.draftNotes.get(row.id) ?? row.notes ?? '';
  }

  /** Open the editor on a row without notes and put the caret in it, as startEdit does. */
  initNotes(row: CategorizedImportTransaction): void {
    this.notesOpen.add(row.id);
    this.cdr.markForCheck();
    this.focusWhenRendered(`[data-row-id="${CSS.escape(row.id)}"] .notes-input`);
  }

  updateNotesDraft(row: CategorizedImportTransaction, text: string): void {
    this.draftNotes.set(row.id, text);
  }

  /**
   * File the note when the editor is left. An emptied note is absent rather
   * than '': the mapper writes `note` on truthiness, and '' would be a key
   * holding nothing. Nothing typed, or the note the row already had, is not
   * a change and replaces nothing.
   */
  commitNotes(row: CategorizedImportTransaction): void {
    const draft = this.draftNotes.get(row.id);
    this.draftNotes.delete(row.id);
    if (draft === undefined) return;
    const notes = draft.trim() || undefined;
    if (notes === row.notes) return;
    this.replaceRow(row, { notes });
  }

  /** One row per line of what is shown, so the box grows as the reviewer types. */
  getRowCount(row: CategorizedImportTransaction): number {
    const notes = this.notesText(row);
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
