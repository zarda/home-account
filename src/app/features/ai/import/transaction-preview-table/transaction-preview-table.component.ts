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
  currencyDecimalPlaces,
  CurrencyInfo,
  CurrencySuggestionReason,
  roundToMinorUnit,
  VERIFY_FIELD_THRESHOLD,
} from '../../../../models';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { countryDisplayName, currencyReasonKey } from '../../../../core/utils/currency-suggestion.utils';
import { countryOptions } from '../../../../core/utils/country-options.utils';
import {
  amountIsUnfilled,
  blankImportRow,
  datedToday,
  descriptionIsUnfilled,
  joinSentences,
  mergeImportRows,
  mergeableRow,
  needsDateAnswer,
  parseAmountInput,
  splitImportRow,
  withoutFieldConfidence,
} from '../../../../core/utils/import-review.utils';
import { nextImportRowId } from '../../../../core/utils/import-row-id.utils';
import { isImeComposition } from '../../../../core/utils/keyboard.utils';
import { normalizeTag, normalizeTags } from '../../../../core/utils/tag.utils';
import { CategorySuggestionComponent } from '../category-suggestion/category-suggestion.component';
import { LocaleDatePipe } from '../../../../shared/pipes/locale-date.pipe';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { LocationLabelPipe } from '../../../../shared/pipes/location-label.pipe';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

/**
 * The fields a row edits in place, each with the input its editor focuses
 * on open and the triggers it could hand focus back to when an edit ends on
 * a key — tried in order. A map rather than a selector derived from the
 * field name: only two of these live in a `.<field>-section` holding an
 * `.inline-edit`, and a derived selector that matches nothing drops focus at
 * the document root without a word. Each input selector must match at most
 * one element per row: notes' box can be on the card independently of
 * `editing` (a filed note renders through `!!row.notes`), so sharing
 * `.inline-input` with a row whose description editor is also open would
 * give `querySelector` two matches to resolve by DOM order alone —
 * `.notes-input` is its own class so that ambiguity cannot arise.
 *
 * The place is the one field whose commit can take its own trigger off the
 * card: emptying the name of a location with nothing else under it withdraws
 * the whole chip, and what stands where it stood is the add trigger.
 *
 * Notes is the one field whose box also shows a filed value: its trigger
 * exists only while the row has no note, and Escape in a filed note's box
 * is a draft drop rather than an editor exit.
 */
const EDITORS = {
  amount: { input: '.inline-input', triggers: ['.amount-section .inline-edit'] },
  description: { input: '.inline-input', triggers: ['.description-section .inline-edit'] },
  tag: { input: '.inline-input', triggers: ['.tag-add'] },
  place: { input: '.inline-input', triggers: ['.place-name', '.location-add'] },
  // The primary vanishes two ways, and its own commit is neither:
  // splitImportRow refuses outright a split that would leave the row
  // unfilled, so the trigger's !amountIsUnfilled half fails only if some
  // other path emptied the amount while this editor was open. The second is
  // canSplit, which hides the trigger on a row worth less than two minor
  // units (ADR 0109) — a bulk re-denomination under an open editor is the
  // way there, USD 0.50 taken to JPY. Escape needs a landing in both, and
  // the add-tag trigger is the strip's next control over.
  split: { input: '.inline-input', triggers: ['.split-trigger', '.tag-add'] },
  notes: { input: '.notes-input', triggers: ['.add-notes-btn'] },
} as const;

type EditField = keyof typeof EDITORS;

/** One datalist per card instance: two on a page must not answer to one id. */
let vocabularyListSeq = 0;

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
  private notifications = inject(NotificationService);

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
  /**
   * Every tag the account already files by, offered to the add control. The
   * wizard fills it; an account with none gets a bare field, which still
   * takes anything typed into it.
   */
  @Input() tagVocabulary: readonly string[] = [];
  /**
   * What a hand-added row is denominated in when there is no row above it to
   * copy a currency from — the account's base, which the wizard reads. Empty
   * only in a test that never adds one; the curated picker's first code
   * stands in then.
   */
  @Input() defaultCurrency = '';
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

  /** What every row's tag input points its `list` at. */
  readonly vocabularyListId = `tag-vocabulary-${++vocabularyListSeq}`;

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

  /**
   * The figure follows the currency it is stored in — ADR 0109's rule,
   * applied here to a change of currency rather than of figure. A figure
   * that rounds to nothing leaves the row unfilled, which the placeholder
   * and the Continue gate already say; unlike the typed amount, the chip
   * has no editor to hold open, so there is nothing to refuse into.
   */
  updateCurrency(transaction: CategorizedImportTransaction, code: string): void {
    // Chosen by the user, so whatever the source failed to read no longer
    // applies — and a choice made for a fallen-back row is worth remembering
    // for the next one this session, including a later hand-correction to
    // this same row after an earlier one already cleared its marker.
    if (this.recordFellBackEligibility(transaction)) {
      this.currencySession.remember(code);
    }
    this.replaceRow(transaction, {
      currency: code,
      amount: roundToMinorUnit(transaction.amount, code),
      currencyFellBack: false,
      currencySuggestion: undefined,
    });
  }

  /**
   * A batch of photos from one trip is nearly always one currency. Bulk is
   * the user's choice, never the ladder's (ADR 0062) — but the session
   * memory is documented to hold a choice for a row nobody could read, so a
   * currency picked for a batch that already read fine does not belong
   * there. Gated the same way the per-row edit is, on eligibility rather
   * than the live marker, so a row already settled by hand earlier this
   * session still counts here.
   *
   * Rounds each row's amount the same way `updateCurrency` does, and for
   * the same reason — see its comment.
   *
   * The per-row chip rounds without asking, and this keeps that same rule —
   * a bulk switch is never refused. But a chip is one row the reviewer is
   * already looking at when it blanks; a bulk switch can blank several
   * without any of them being looked at, so this is the one path that says
   * how many. Just a count: each blanked row's own placeholder already
   * names itself, and the Continue gate holds until every one is filled.
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
    // Counted before the map below replaces `amount`: after it, every row
    // has already been rounded and a row that was blank to start looks the
    // same as one the switch just blanked.
    const blanked = selected.filter(
      t => !amountIsUnfilled(t) && amountIsUnfilled({ ...t, amount: roundToMinorUnit(t.amount, code) })
    ).length;
    this.transactions = this.transactions.map(t =>
      t.selected
        ? {
            ...t,
            currency: code,
            amount: roundToMinorUnit(t.amount, code),
            currencyFellBack: false,
            currencySuggestion: undefined,
          }
        : t
    );
    this.emitChanges();
    if (blanked > 0) {
      this.notifications.info(
        this.translationService.t('import.bulkCurrencyBlanked', { count: blanked, currency: code })
      );
    }
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
    return joinSentences(row.currencyFellBack ? this.currencyFellBackTooltip() : '', label);
  }

  /**
   * The reviewer's overrule of a duplicate verdict. The verdict was decided
   * inside the import doors, on inputs the reviewer could not change, and it
   * was what deselected the row — so the overrule selects it again. The
   * wizard reads the flag's true → false off this emission and keeps the row
   * clear through later re-checks until the row itself is edited.
   */
  clearDuplicate(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, { isDuplicate: false, duplicateOf: undefined, selected: true });
    // The button goes with the badge, and a focused element that leaves the
    // DOM drops focus at the document root; the description trigger beneath
    // is the row's nearest control, the one the editors' exits hand back to.
    // Unless that row's description is being edited, in which case the
    // trigger is not on the card at all and the date button below it is the
    // next control down.
    this.focusWhenRendered(
      this.inRow(transaction, '.description-text'),
      this.inRow(transaction, '.date-chip')
    );
  }

  // `tags` is spread only when non-empty, so an emptied list is exactly "not
  // written". The location is no longer that simple: since 0068 the mapper
  // rebuilds one from `receiptCountry` when the row carries no location, so
  // clearing the slot alone would let the country the user just dismissed
  // walk back in. Both marks go, or removal does not mean removal.
  //
  // The chip leaves with its button, and the add trigger is what stands in
  // its place — the same landing setCountry names — or the bare editor when
  // the row's own place editor was open.
  removeLocation(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, { location: undefined, receiptCountry: undefined });
    this.focusWhenRendered(this.inRow(transaction, '.location-add'), this.inRow(transaction, '.place-input'));
  }

  /**
   * The country this row will file under, however it was arrived at: one
   * printed in an address, one the reader concluded with no address to print
   * (0068), or one picked here by hand. Deliberately the same precedence the
   * DTO mapper applies, so the chip names the country that actually lands.
   */
  effectiveCountry(row: CategorizedImportTransaction): string | undefined {
    return row.location?.country ?? row.receiptCountry;
  }

  /**
   * That country in the active language. Resolved at render rather than
   * stored, for the reason locationLabel gives: one language's answer baked
   * into the row would be wrong in every other.
   */
  countryLabel(row: CategorizedImportTransaction): string {
    const code = this.effectiveCountry(row);
    return code ? countryDisplayName(code, this.localeFormat.locale) : '';
  }

  /**
   * The countries the picker offers — the transaction filter's own list,
   * with the row's country appended when the bundled table has no box for
   * it. Called from inside the menu's lazy content and nowhere else: this
   * names and collates 79 regions per call, and a batch is twenty rows.
   */
  countryChoices(row: CategorizedImportTransaction): { code: string; name: string }[] {
    return countryOptions(this.localeFormat.locale, this.effectiveCountry(row));
  }

  /**
   * The name trigger's own name. Its content is the place, or — on a row
   * that has a country and nothing else — an edit glyph, which says neither
   * what it edits nor what is in it.
   */
  placeNameLabel(row: CategorizedImportTransaction): string {
    const name = row.location?.name;
    return name
      ? this.translationService.t('import.editPlaceName', { name })
      : this.translationService.t('import.addPlaceName');
  }

  /** Likewise the country button, whose glyph alone says nothing when no country is set. */
  countryButtonLabel(row: CategorizedImportTransaction): string {
    const country = this.countryLabel(row);
    return country
      ? this.translationService.t('import.changeCountry', { country })
      : this.translationService.t('import.setCountry');
  }

  /**
   * Pick the row's country by hand, or withdraw it.
   *
   * `receiptCountry` goes either way. The mark is what the reader concluded,
   * and the mapper falls back to it whenever the location carries no country
   * of its own (`import-dto.utils`) — so left behind it would quietly put
   * the overruled country back the moment the picked one was withdrawn. A
   * country chosen by hand is the evidence now.
   *
   * Withdrawing from a location with no name drops the location whole, and
   * any coordinate on it with that: `locationSlot` refuses a bare coordinate
   * pair, so keeping one would leave a chip on the card standing for a
   * location the write would discard.
   *
   * That withdrawal takes the country button off the card with the chip, so
   * the add trigger that replaces it is where focus goes instead — a
   * selector that matches nothing would drop focus at the document root.
   */
  setCountry(row: CategorizedImportTransaction, code: string | null): void {
    const location = row.location;
    this.replaceRow(row, {
      location: code
        ? { ...(location ?? {}), country: code }
        : location?.name
          ? { ...location, country: undefined }
          : undefined,
      receiptCountry: undefined,
    });
    this.focusWhenRendered(this.inRow(row, '.extra-country'), this.inRow(row, '.location-add'));
  }

  // The chip goes with the tag; the add trigger is the strip's unconditional
  // control, or the bare input when that row's own tag editor was open.
  removeTag(transaction: CategorizedImportTransaction, tag: string): void {
    this.replaceRow(transaction, { tags: (transaction.tags ?? []).filter(t => t !== tag) });
    this.focusWhenRendered(this.inRow(transaction, '.tag-add'), this.inRow(transaction, '.tag-input'));
  }

  /** Accept = the ordinary currency edit, so one path clears the marks and records the choice. */
  acceptCurrencySuggestion(transaction: CategorizedImportTransaction): void {
    const offer = transaction.currencySuggestion;
    if (!offer) return;
    this.updateCurrency(transaction, offer.code);
    // The offer's own chip goes with the accepted choice, and the currency
    // chip is where the choice now shows — the same landing dismiss names,
    // for the same unmount.
    this.focusWhenRendered(this.inRow(transaction, '.currency-chip'));
  }

  /** Dismiss = drop the mark. The row keeps its fallen-back marker; nothing was applied. */
  dismissCurrencySuggestion(transaction: CategorizedImportTransaction): void {
    this.replaceRow(transaction, { currencySuggestion: undefined });
    this.focusWhenRendered(this.inRow(transaction, '.currency-chip'));
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
    return joinSentences(
      this.translationService.t('import.acceptCurrencySuggestion', { currency: code }),
      this.currencyOfferReason(row)
    );
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
   * A receipt row dated on another day, and still asked about.
   *
   * The mark is the question minus the rows asked for the other reason — an
   * assumed date reads as today — so it is written that way rather than
   * restating needsDateAnswer's conjuncts. Spelling them out a second time
   * is what let the `selected` guard go missing from one of the two, and a
   * mark on a row with no Keep beside it points at a control that is not
   * there. One `now` for both readings, so a run that straddles midnight
   * cannot read the row two ways in one call.
   */
  dateNotToday(row: CategorizedImportTransaction): boolean {
    const now = new Date();
    return needsDateAnswer(row, this.attention(row), now) && !datedToday(row.date, now);
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
    return joinSentences(this.dateTooltip(row), this.changeDateLabel(row));
  }

  dateChipText(row: CategorizedImportTransaction): string {
    return row.dateAssumed
      ? this.translationService.t('import.dateAssumedKeep')
      : this.translationService.t('import.dateNotTodayKeep', { date: this.formattedDate(row) });
  }

  /** The keep button's name says why the row is asked and what it keeps; the visible text says neither fully. */
  keepDateLabel(row: CategorizedImportTransaction): string {
    return joinSentences(
      this.dateTooltip(row),
      this.translationService.t('import.keepDate', { date: this.formattedDate(row) })
    );
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
    this.focusAnsweredDate(row);
  }

  /**
   * The only answer for a date that is already right: the picker's
   * dateChange does not fire when the same day is picked again, so nothing
   * else settles such a row.
   */
  keepDate(row: CategorizedImportTransaction): void {
    this.replaceRow(row, this.dateAnswered(row));
    this.focusAnsweredDate(row);
  }

  /**
   * The date button, after an answer that took the question chip away with
   * the control that was pressed — Keep, or the chip's own calendar button,
   * which the picker hands focus back to a moment before the chip unmounts.
   * The button is where the answer landed, it stays on the card, and it now
   * names the day as it stands. Harmless when the picker was opened from
   * the button itself: that is the same element.
   */
  private focusAnsweredDate(row: CategorizedImportTransaction): void {
    this.focusWhenRendered(this.inRow(row, '.date-chip'));
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
    // The button removes itself with the last question it answered, so it
    // takes focus to the document root unless the answer puts it somewhere.
    // The first row's date button is the top of what was just answered; an
    // empty list has none, and the header's own checkbox outlives it.
    const first = this.transactions[0];
    this.focusWhenRendered(
      ...(first ? [this.inRow(first, '.date-chip')] : []),
      '.header-left input[type="checkbox"]'
    );
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
  private editing = new Map<string, EditField>();

  // A plain method rather than a computed, for the reason selectedCount gives.
  isEditing(row: CategorizedImportTransaction, field: EditField): boolean {
    return this.editing.get(row.id) === field;
  }

  /**
   * Open the editor on a field and put the caret in it, so the tap that asked
   * to edit is also the tap that starts typing.
   */
  startEdit(row: CategorizedImportTransaction, field: EditField): void {
    this.editing.set(row.id, field);
    this.amountRejected.delete(row.id);
    this.cdr.markForCheck();
    this.focusWhenRendered(this.inRow(row, EDITORS[field].input));
  }

  /**
   * Focus the first of these that a swap is about to put on the card. The
   * target does not exist until the swap has rendered, which is what
   * afterNextRender waits for; a registration on a destroyed injector throws
   * NG0911, which is what the guard is for.
   *
   * Several selectors rather than one because a control's usual landing
   * place is not always on the card: the overrule's is absent while that
   * row's description is being edited, and the header's bulk Keep may have
   * no card left beneath it at all. A selector that matches nothing drops
   * focus at the document root exactly as no call would, so the fallbacks
   * are the point — and they belong here rather than in a second focus path,
   * which would be a second thing to keep in step with the swaps.
   */
  private focusWhenRendered(...selectors: string[]): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => {
        for (const selector of selectors) {
          const target = this.host.nativeElement.querySelector<HTMLElement>(selector);
          if (target) {
            target.focus();
            return;
          }
        }
      },
      { injector: this.injector }
    );
  }

  /** Scoped to one card: there is one of every control per row inside the @for. */
  private inRow(row: CategorizedImportTransaction, selector: string): string {
    return `[data-row-id="${CSS.escape(row.id)}"] ${selector}`;
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
    this.amountRejected.delete(row.id);
    this.cdr.markForCheck();
    if (restoreFocus && field) {
      this.focusWhenRendered(...EDITORS[field].triggers.map(selector => this.inRow(row, selector)));
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
   * File the place name typed on the chip, guarded the way the description
   * editor is.
   *
   * An emptied field means something here that it does not there: the name
   * is one of the two facts this chip carries, and withdrawing it is not
   * withdrawing the location. A country under it stays, as a chip of its
   * own; with nothing under it the location goes. Neither case touches
   * `receiptCountry` — a country the reader concluded is not something the
   * reviewer just declined, and it keeps its own chip through the removal
   * button, which is where declining it lives.
   *
   * Both branches carry the rest of the location through rather than rebuild
   * it from the fields named here, because the name is not all a row can
   * hold: `importFromJSON` rebuilds a restored backup's row through
   * `locationSlotFrom`, which keeps a coordinate pair the receipt door never
   * attaches. A list of fields to keep would drop the ones nobody thought
   * of. The one case where dropping them is right is a location left with no
   * country at all: `locationSlot` refuses a bare coordinate pair, so
   * nothing would remain to write.
   */
  commitPlaceName(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    if (isImeComposition(event)) return;
    const name = (event.target as HTMLInputElement).value.trim();
    this.closeEdit(row, event.type === 'keydown');
    if (name === (row.location?.name ?? '')) return;
    if (!name) {
      const location = { ...row.location };
      delete location.name;
      this.replaceRow(row, { location: location.country ? location : undefined });
      return;
    }
    this.replaceRow(row, { location: { ...row.location, name } });
  }

  /**
   * File one tag on the row, the way the description editor files a line:
   * one value per commit, because this field is a single tag and not the
   * transaction form's chip input — a comma typed here is part of the tag.
   *
   * Spelled through normalizeTag on the way in, so a tag added here matches
   * a stored one exactly and the filter can find the row. Nothing typed, or
   * a tag the row already carries, closes the editor and changes nothing —
   * and the row's own tags are spelled the same way for that comparison
   * only, because a JSON backup restores them verbatim: a row holding
   * `Coffee` would otherwise take the vocabulary's `coffee` as a second tag
   * and file both, the mapper passing tags through untouched.
   */
  commitTag(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    if (isImeComposition(event)) return;
    const tag = normalizeTag((event.target as HTMLInputElement).value);
    const tags = row.tags ?? [];
    this.closeEdit(row, event.type === 'keydown');
    if (!tag || normalizeTags(tags).includes(tag)) return;
    this.replaceRow(row, { tags: [...tags, tag] });
  }

  /**
   * Which rows' amount editors are holding a figure that could not be read,
   * by row id for the reason `editing` gives. Read through a method because
   * AOT rejects a private member in a template where JIT lets one through.
   */
  private amountRejected = new Set<string>();

  amountUnreadable(row: CategorizedImportTransaction): boolean {
    return this.amountRejected.has(row.id);
  }

  /**
   * A hand-typed amount settles the figure: the grade goes with it, the same
   * rule a date answer follows. The figure already shown closes the editor
   * and changes nothing.
   *
   * The parsed figure is rounded to what the row's own currency stores
   * before it is compared against the old one or written — a JPY row
   * typed at 179.33 settles at 179, the only figure formatAmount would
   * ever show for it, so the two never disagree.
   *
   * A figure that rounds to nothing is refused, on every row, the same way
   * an unreadable one is: amountRejected holds the row and the editor stays
   * open, marked invalid. 0.4 on a JPY row rounds to that same nothing —
   * written over a real figure it reads to the reviewer as one erased, and
   * on a row already at amount 0 the amount === row.amount short-circuit
   * below would otherwise close the editor having shown nothing changed on
   * a figure just typed. Both are the same silent loss, so both are refused
   * the one way.
   *
   * A figure parseAmountInput cannot read is refused for the same reason:
   * closing on it looked to the reviewer exactly like a commit — the editor
   * shut, the old amount stood, and the row went to import at a number they
   * believed they had just replaced. Escape is still the way out, and it is
   * the only deliberate way the old figure is kept: startEdit on any other
   * field of the same row — notes among them now — clears amountRejected
   * too, so the refusal goes with the editor and the typed figure with it.
   *
   * commitSplit below holds its own editor open on the same rule, for the
   * same reason: a figure that reads fine on its own but would leave
   * nothing behind on the row it came from is exactly as silent a mistake
   * as one that rounds to nothing or that parseAmountInput could not read
   * at all.
   */
  commitAmount(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    if (isImeComposition(event)) return;
    const parsed = parseAmountInput((event.target as HTMLInputElement).value);
    const amount = parsed === null ? null : roundToMinorUnit(parsed, row.currency);
    if (amount === null || amount === 0) {
      this.amountRejected.add(row.id);
      this.cdr.markForCheck();
      return;
    }
    this.closeEdit(row, event.type === 'keydown');
    if (amount === row.amount) return;
    this.replaceRow(row, {
      amount,
      fieldConfidence: withoutFieldConfidence(row.fieldConfidence, 'amount'),
    });
  }

  /**
   * Take the typed amount off the row into a new row directly beneath it.
   * splitImportRow is the only judge of what a valid split is — it rounds
   * before refusing, so a figure that reads fine here on its own can still
   * fail once rounded: 19.999 and 0.004 on a whole-number row, or 0.4 on a
   * JPY row, which a cent-based row would have kept. splitImportRow judges
   * all three the one way, and calling it directly rather than
   * re-checking `amount >= row.amount` first is what keeps the two from
   * disagreeing over exactly those figures. Its refusal reads to the
   * reviewer exactly like an unreadable one, so it holds the editor open
   * the same way commitAmount does rather than let it close having
   * silently done nothing.
   *
   * Nothing typed is different. This field opens empty by design rather
   * than pre-filled the way commitAmount's is, so a blank commit is not a
   * reviewer clearing a figure — it is a reviewer who opened the editor and
   * changed their mind. It closes the way commitTag and commitPlaceName
   * close on their own empty-by-design starts, on the Enter path as much as
   * on blur, rather than trap a keyboard reviewer behind an aria-invalid
   * field the only way out of which is clicking back in to press Escape.
   *
   * The new row is spliced in under the row it came from rather than
   * appended, and opens straight into its own description editor: it was
   * born holding the original's, which is rarely right for a line item
   * taken out on its own. Focus moves the way every other row-creating
   * control on this card moves it (addRow).
   */
  commitSplit(row: CategorizedImportTransaction, event: Event): void {
    if (!this.editing.has(row.id)) return;
    if (isImeComposition(event)) return;
    if (!(event.target as HTMLInputElement).value.trim()) {
      this.closeEdit(row, event.type === 'keydown');
      return;
    }
    const amount = parseAmountInput((event.target as HTMLInputElement).value);
    const split = amount === null ? null : splitImportRow(row, amount, nextImportRowId('split'));
    if (!split) {
      this.amountRejected.add(row.id);
      this.cdr.markForCheck();
      return;
    }
    // Ahead of closeEdit and the part's own editing entry: a row gone from
    // the table by the time this commits must not leave the editor closed
    // and an orphan entry in `editing` for a part that never gets spliced
    // in to render and clear it.
    const index = this.transactions.indexOf(row);
    if (index === -1) return;
    const [kept, part] = split;
    this.closeEdit(row, false);
    this.editing.set(part.id, 'description');
    const before = this.transactions.slice(0, index);
    const after = this.transactions.slice(index + 1);
    this.transactions = [...before, kept, part, ...after];
    this.emitChanges();
    this.cdr.markForCheck();
    this.focusWhenRendered(this.inRow(part, EDITORS.description.input));
  }

  /**
   * The trigger's own name. A blank description falls back to the button's
   * own visible text rather than editDescriptionLabel's "Add a description":
   * that names an action this control does not perform, and on a row with
   * both triggers showing it would collide with the real add-description
   * button's name.
   */
  splitLabel(row: CategorizedImportTransaction): string {
    return descriptionIsUnfilled(row)
      ? this.translationService.t('import.splitRow')
      : this.translationService.t('import.splitRowLabel', { description: row.description });
  }

  /**
   * The split refusal's own floor, named rather than left as "too small":
   * the smallest positive figure the row's own currency can hold, one
   * whole yen on a JPY row and one cent on a USD one. `10 ** -digits` is
   * that unit at whatever precision currencyDecimalPlaces gives the row,
   * formatted the same way formatAmount renders it so the two figures a
   * reviewer compares never disagree.
   */
  minimumAmountText(row: CategorizedImportTransaction): string {
    return this.currencyService.formatCurrency(10 ** -currencyDecimalPlaces(row.currency), row.currency);
  }

  /**
   * A row can only split into two figures each worth at least a minor unit,
   * so anything worth less than twice that unit — ¥1, $0.01 — has no split
   * that clears minimumAmountText's floor on both halves at once. ¥2 is the
   * split at the floor, ¥1 and ¥1: each half clears the unit, and the two
   * are not apart at all. The trigger hides rather than offer a control
   * every figure would refuse.
   */
  canSplit(row: CategorizedImportTransaction): boolean {
    return row.amount >= 2 * 10 ** -currencyDecimalPlaces(row.currency);
  }

  /**
   * Mergeable rows per currency, counted once per array rather than once
   * per row. canMerge is bound in the row @for, so a scan of the list from
   * inside it is quadratic on every render, and every other eager per-row
   * predicate on this card is O(1) — the O(n) work belongs behind the menu,
   * in mergeTargets, where it runs only for a menu someone opened. The
   * array's identity is the key: every edit here produces a new array
   * rather than mutating the old one (the reason replaceRow rewrites a
   * row), and the wizard hands back a new one on every emission, so a
   * census cannot outlive the rows it counted.
   */
  private mergeCensus: { rows: readonly CategorizedImportTransaction[]; byCurrency: Map<string, number> } | null = null;

  private mergeableByCurrency(): Map<string, number> {
    let census = this.mergeCensus;
    if (census?.rows !== this.transactions) {
      const byCurrency = new Map<string, number>();
      for (const t of this.transactions) {
        if (mergeableRow(t)) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + 1);
      }
      census = this.mergeCensus = { rows: this.transactions, byCurrency };
    }
    return census.byCurrency;
  }

  /**
   * Whether this row can merge at all — mergeImportRows' own two refusals,
   * read here too so the trigger renders only when the menu behind it would
   * have something to offer: the row takes part (mergeableRow), and so does
   * at least one other row in its currency.
   */
  canMerge(row: CategorizedImportTransaction): boolean {
    return mergeableRow(row) && (this.mergeableByCurrency().get(row.currency) ?? 0) > 1;
  }

  /**
   * The rows canMerge counted, less this one, as a filter — called only from
   * inside the lazy menu content, the way countryChoices is: filtering every
   * row on a batch of twenty is a cost worth paying only for a menu someone
   * actually opened.
   */
  mergeTargets(row: CategorizedImportTransaction): CategorizedImportTransaction[] {
    return this.transactions.filter(t => t !== row && t.currency === row.currency && mergeableRow(t));
  }

  /**
   * The trigger's own name. Unlike splitLabel there is no blank fallback:
   * the template offers this trigger only under canMerge, which refuses a
   * blank row on either side (mergeableRow).
   */
  mergeLabel(row: CategorizedImportTransaction): string {
    return this.translationService.t('import.mergeIntoLabel', { description: row.description });
  }

  /**
   * One target's own name in the menu — mergeTargets lists only rows that
   * pass mergeableRow, so the description is never blank here either.
   */
  mergeOptionLabel(target: CategorizedImportTransaction): string {
    return this.translationService.t('import.mergeOption', {
      description: target.description,
      amount: this.formatAmount(target),
      date: this.formattedDate(target),
    });
  }

  /**
   * Fold row into target. mergeImportRows is the single judge of validity —
   * canMerge and mergeTargets already keep a currency mismatch, a blank row
   * and a flagged one off the menu, so the null case here is the pure
   * function refusing on its own account, not a path the UI is expected to
   * reach.
   *
   * Both rows are read by id when the click lands, not taken as given: the
   * listener holds the row objects captured when the lazy menu rendered,
   * while the wizard replaces a row under the same id whenever a re-check
   * reconciles its verdict. Under zone.js the tick after that reconcile
   * refreshes the open menu's contexts before a click can dispatch;
   * resolving by id makes the click independent of whether such a refresh
   * ran in between at all (none does after a harness assignment, and a
   * zoneless scheduler may order it differently). Filtered by identity, a
   * stale source would vanish and the target stay as it was. A row gone
   * from the batch by then is the stale-commit no-op commitSplit models
   * with its indexOf guard.
   *
   * row's own trigger leaves with it, so focus has nowhere on row to return
   * to; it goes to the survivor instead — its own merge trigger when a third
   * row still shares its currency, its description trigger when this merge
   * just took the last one. Material's own focus restore targets the
   * trigger this click removed, and afterNextRender runs after the change
   * detection that removes it, so this call is what actually wins.
   */
  mergeInto(row: CategorizedImportTransaction, target: CategorizedImportTransaction): void {
    const source = this.transactions.find(t => t.id === row.id);
    const dest = this.transactions.find(t => t.id === target.id);
    if (!source || !dest || source === dest) return;
    const merged = mergeImportRows(dest, source);
    if (!merged) return;
    this.forgetRow(source.id);
    this.transactions = this.transactions.filter(t => t !== source).map(t => t === dest ? merged : t);
    this.emitChanges();
    this.cdr.markForCheck();
    this.focusWhenRendered(this.inRow(merged, '.merge-trigger'), this.inRow(merged, '.description-section .inline-edit'));
  }

  /**
   * The trigger's own name. A blank description falls back to the button's
   * own visible text, splitLabel's reason: import.removeRowLabel would name
   * a value the row does not have, on a control offered even before
   * anything has been written into it.
   */
  removeLabel(row: CategorizedImportTransaction): string {
    return descriptionIsUnfilled(row)
      ? this.translationService.t('common.remove')
      : this.translationService.t('import.removeRowLabel', { description: row.description });
  }

  /**
   * The row's own trigger leaves with it, so focus goes where a keyboard
   * reviewer clearing a batch would want it — the same control on the next
   * row, the previous row's when this was the last, and the list's own
   * control when the list is empty. The wizard prunes `receiptRowIds` along
   * with everything else it keeps for the id on its own (0106's mechanics,
   * `onTransactionsUpdated`).
   */
  removeRow(row: CategorizedImportTransaction): void {
    const index = this.transactions.indexOf(row);
    if (index === -1) return;
    const neighbour = this.transactions[index + 1] ?? this.transactions[index - 1];
    this.forgetRow(row.id);
    this.transactions = this.transactions.filter(t => t !== row);
    this.emitChanges();
    this.cdr.markForCheck();
    this.focusWhenRendered(
      ...(neighbour ? [this.inRow(neighbour, '.remove-trigger')] : []),
      '.add-row'
    );
  }

  /**
   * Drop every per-id container's entry for a row that just left the card.
   * `editing`, `amountRejected`, `draftNotes` and `fellBackEligible` are all
   * keyed by row id and outlive `replaceRow`'s swap on purpose — until
   * mergeInto and removeRow, a row's id never stopped appearing in
   * `transactions` at all, so nothing else has ever needed to prune them.
   */
  private forgetRow(id: string): void {
    this.editing.delete(id);
    this.amountRejected.delete(id);
    this.draftNotes.delete(id);
    this.fellBackEligible.delete(id);
  }

  /**
   * The gate's own readings of the two fields it holds an import for, bound
   * as fields because the template cannot reach an imported function. The
   * placeholder, the trigger's name and the wizard's count must all come
   * from here: a truthiness test beside a trimmed gate leaves a row of
   * spaces counted as unfilled and shown as filled, on a trigger with no
   * width to press on.
   */
  readonly amountIsUnfilled = amountIsUnfilled;
  readonly descriptionIsUnfilled = descriptionIsUnfilled;

  /**
   * The triggers' names have to carry their values, which their own content
   * states without saying what it is — and a field nothing has been written
   * into has no value to carry, so the name says what the placeholder in it
   * says rather than naming an empty string or a formatted zero.
   */
  editDescriptionLabel(row: CategorizedImportTransaction): string {
    return descriptionIsUnfilled(row)
      ? this.translationService.t('import.addDescription')
      : this.translationService.t('import.editDescription', { description: row.description });
  }

  editAmountLabel(row: CategorizedImportTransaction): string {
    return amountIsUnfilled(row)
      ? this.translationService.t('import.addAmount')
      : this.translationService.t('import.editAmount', { amount: this.formatAmount(row) });
  }

  /**
   * What has been typed into a row's notes editor so far, by row id — not on
   * the row itself, because the row is the parent's object: the old textarea
   * wrote straight onto it, so a note typed during an in-flight import could
   * change what was written for a row not yet processed. Whether the editor
   * is open needs no container of its own: a row edits one field at a time,
   * notes included, so `editing` already carries that, and a filed note's
   * box is on the card by `row.notes`, not by `editing`. A draft here can
   * outlive its box, but only on a path no pointer or keyboard reaches — a
   * same-row `startEdit` to another field with no blur in between; every
   * reachable path blurs the textarea first, and `commitNotes` is what
   * drains this map there.
   */
  private draftNotes = new Map<string, string>();

  // Plain methods, for the reason selectedCount gives.
  showsNotes(row: CategorizedImportTransaction): boolean {
    return !!row.notes || this.isEditing(row, 'notes');
  }

  /** What the editor shows: the draft while one is being typed, else the row's own note. */
  notesText(row: CategorizedImportTransaction): string {
    return this.draftNotes.get(row.id) ?? row.notes ?? '';
  }

  updateNotesDraft(row: CategorizedImportTransaction, text: string): void {
    this.draftNotes.set(row.id, text);
  }

  /**
   * File the note when the editor is left. An emptied note is absent rather
   * than '': the mapper writes `note` on truthiness, and '' would be a key
   * holding nothing. Nothing typed, or the note the row already had, is not
   * a change and replaces nothing.
   *
   * An editor left with nothing in it also closes — closeEdit's doing now:
   * opening one is a single tap on a crowded card, and without it that tap
   * could not be taken back. A filed note needs no such push; its box stays
   * up on `row.notes` alone, whatever the shared slot just cleared to.
   */
  commitNotes(row: CategorizedImportTransaction): void {
    const draft = this.draftNotes.get(row.id);
    this.draftNotes.delete(row.id);
    if (this.isEditing(row, 'notes')) this.closeEdit(row, false);
    const notes = draft?.trim() || undefined;
    if (draft === undefined || notes === row.notes) return;
    this.replaceRow(row, { notes });
  }

  /**
   * Abandon the draft, the way Escape abandons the description and the
   * amount — but not through cancelEdit: a filed note's box is on the card
   * whatever `editing` holds, so a row that came with a note has no slot of
   * its own to close, and if this row's slot holds some other field, that
   * editor is open on purpose and is not what Escape here means. Only when
   * the slot is notes does closing it apply.
   */
  cancelNotes(row: CategorizedImportTransaction): void {
    this.draftNotes.delete(row.id);
    if (this.isEditing(row, 'notes')) this.closeEdit(row, true);
    else this.cdr.markForCheck();
  }

  /** One row per line of what is shown, so the box grows as the reviewer types. */
  getRowCount(row: CategorizedImportTransaction): number {
    const notes = this.notesText(row);
    if (!notes) return 1;
    const lineCount = notes.split('\n').length;
    return Math.min(Math.max(lineCount, 1), 20);
  }

  /**
   * A blank row at the end of the list, for what the reader never reached.
   *
   * The notice above the list tells the reviewer to add whatever the answer
   * was cut short of; this is the control that lets them, and it belongs to
   * the list rather than to any row — appended at the end, never spliced in
   * after the row it took its day and currency from, because the list is in
   * the order the source gave it and a row nobody read has no place in that
   * order.
   *
   * The editor is seeded before the row is emitted, because the emission is
   * what the parent renders the row from: the state that decides whether it
   * comes up as an input rather than an empty trigger has to be in place by
   * then. `focusWhenRendered` waits for whichever pass renders it, so the
   * tap that added the row is the tap that starts typing.
   *
   * The row goes onto the card's own list as well, the way every edit here
   * does — the parent owns the array, but the card must not be rendering a
   * list the reviewer has already added to.
   */
  addRow(): void {
    const row = blankImportRow(
      nextImportRowId('manual'),
      this.transactions.at(-1),
      // The picker's first code covers a card given no base currency at all,
      // which is a test's shape rather than the wizard's.
      this.defaultCurrency || this.currencies[0]?.code || 'USD'
    );
    this.editing.set(row.id, 'description');
    this.transactions = [...this.transactions, row];
    this.emitChanges();
    this.cdr.markForCheck();
    this.focusWhenRendered(this.inRow(row, EDITORS.description.input));
  }

  private emitChanges(): void {
    this.transactionsUpdated.emit([...this.transactions]);
    const selectedIds = new Set(
      this.transactions.filter(t => t.selected).map(t => t.id)
    );
    this.selectionChanged.emit(selectedIds);
  }
}
