import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category, HouseholdMemberIdentity, receiptImageCount, baseCurrencyOf} from '../../../models';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { CategoryHelperService } from '../../../core/services/category-helper.service';
import { CategoryChipComponent } from '../category-chip/category-chip.component';
import { MemberChipComponent } from '../member-chip/member-chip.component';
import { FitTextDirective } from '../../directives/fit-text.directive';
import { SwipeRevealDirective } from '../../directives/swipe-reveal.directive';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { LocationLabelPipe } from '../../pipes/location-label.pipe';

/**
 * One transaction-row anatomy (category tile beside a three-line text stack:
 * description with the signed amount, the category strip, date with the
 * converted amount; a pinned trailing actions slot; an optional swipe drawer)
 * shared by the dashboard recent-transactions card, the transactions mobile
 * list and, read-only with the member named on line 3, the household list —
 * previously duplicated and drifting.
 */
@Component({
  selector: 'app-transaction-row',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MatIconModule,
    CategoryChipComponent,
    MemberChipComponent,
    FitTextDirective,
    SwipeRevealDirective,
    TranslatePipe,
    LocationLabelPipe,
  ],
  templateUrl: './transaction-row.component.html',
  styleUrl: './transaction-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // On the host rather than the template: a template click or keydown on an
  // element with no tabindex fails interactive-supports-focus, and the row's
  // wrapper must not be a tab stop — it holds tab stops of its own.
  host: {
    '(click)': 'onActivate($event)',
    '(keydown.escape)': 'closeSwipe()',
  },
})
export class TransactionRowComponent {
  transaction = input.required<Transaction>();
  categories = input<Map<string, Category>>(new Map());

  /**
   * Opt-in for the swipe-to-reveal Edit/Delete drawer. The projected menu
   * stays the keyboard, screen-reader and discoverability route; the drawer
   * is the fast path for touch. The dashboard passes nothing and stays inert.
   */
  swipeActions = input(false);

  /**
   * False for a row that only shows: line 1 is plain text rather than the
   * row button, the row answers no click or key, and the location is never
   * a link. With swipeActions false and nothing projected, nothing in the
   * row is a control. The household list mixes every member's rows, and
   * no row opens from there, since most belong to someone else.
   */
  interactive = input(true);

  /** Whose row this is, named on line 3; a list mixing several people's rows passes it. */
  member = input<HouseholdMemberIdentity | null>(null);

  /**
   * Emitted on a click anywhere on the row outside its own controls, and on
   * Enter / Space on the row button — which reach the host as that button's
   * click. Not emitted while the swipe drawer is open: the swipe directive
   * stops that click in its capture phase and closes the drawer instead, as it
   * stops the click a drag leaves behind.
   */
  activate = output<Transaction>();

  /** Emitted by the drawer's Edit action. */
  edit = output<Transaction>();

  /** Emitted by the drawer's Delete action. The caller owns confirmation. */
  delete = output<Transaction>();

  protected swipeOpen = signal(false);
  // The drawer lives inside @if, so a template reference variable cannot
  // reach the surface's binding from outside that embedded view — the
  // element crosses over through this query instead.
  protected swipeDrawer = viewChild<ElementRef<HTMLElement>>('swipeDrawer');
  private swipeReveal = viewChild(SwipeRevealDirective);
  private host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private currencyService = inject(CurrencyService);
  private authService = inject(AuthService);
  private dateFormatService = inject(DateFormatService);
  private categoryHelperService = inject(CategoryHelperService);

  categoryName(): string {
    return this.categoryHelperService.getCategoryName(
      this.transaction().categoryId,
      this.categories()
    );
  }

  categoryIcon(): string {
    return this.categoryHelperService.getCategoryIcon(
      this.transaction().categoryId,
      this.categories()
    );
  }

  categoryColor(): string {
    return this.categoryHelperService.getCategoryColor(
      this.transaction().categoryId,
      this.categories()
    );
  }

  // Templates cannot call module functions, so the model helper is exposed
  // through the component.
  receiptCount(): number {
    return receiptImageCount(this.transaction());
  }

  // At most three tag chips on the category line; the rest fold into "+N".
  // The row is shared with the dashboard card, so tags must not add a line.
  visibleTags(): string[] {
    return this.transaction().tags?.slice(0, 3) ?? [];
  }

  overflowTagCount(): number {
    return Math.max(0, (this.transaction().tags?.length ?? 0) - 3);
  }

  /**
   * Maps link for the row's location — only when coordinates exist. A
   * name-only location stays plain text: linking a typed name would send a
   * typo to a confidently wrong destination. The URL form is the documented
   * cross-platform Maps search, which resolves on web, Android and WKWebView.
   * A row that only shows links nowhere.
   */
  mapsUrl(): string | null {
    if (!this.interactive()) return null;
    const location = this.transaction().location;
    if (location?.lat === undefined || location?.lng === undefined) return null;
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
  }

  formatAmount(): string {
    const transaction = this.transaction();
    return this.currencyService.formatCurrency(transaction.amount, transaction.currency);
  }

  // One string for the amount on screen and the amount in the row button's
  // name, so the two cannot disagree.
  signedAmount(): string {
    return `${this.transaction().type === 'income' ? '+' : '-'}${this.formatAmount()}`;
  }

  // Unique per page: a transaction appears in at most one list on a route.
  splitIndicatorId(): string {
    return `transaction-split-${this.transaction().id}`;
  }

  // Secondary line for foreign-currency rows: what the row counts as in the
  // user's base currency (write-time snapshot; live conversion for legacy
  // rows). Null for rows already in the base currency.
  convertedAmount(): string | null {
    const transaction = this.transaction();
    const baseCurrency = baseCurrencyOf(this.authService.currentUser());
    if (transaction.currency === baseCurrency) return null;
    const inBase = this.currencyService.amountInBase(transaction, baseCurrency);
    return `≈ ${this.currencyService.formatCurrency(inBase, baseCurrency)}`;
  }

  relativeDate(): string {
    return this.dateFormatService.formatRelativeDate(this.transaction().date as Date | Timestamp);
  }

  /**
   * The host's click: the whole row opens the transaction, except where
   * something else inside it owns the click.
   *
   * The row button's click lands here as well: Enter and Space on it arrive
   * as its click, so the keyboard opens the row through this one path, once.
   * What arrives from the surface is what its swipe directive lets through.
   * The directive's capture-phase click listener takes the click a drag
   * synthesizes, and while the drawer is open it takes every click on the
   * surface, the row button's included, and closes the drawer instead — a
   * press on an open row puts the drawer back rather than opening the
   * editor. The row's key listeners open nothing themselves: the host's
   * Escape closes the drawer, and the directive's capture-phase keydown only
   * clears the mark a drag left, so a drag that produced no click cannot
   * swallow the click a key press becomes.
   *
   * A control inside the row answers its own click, whether or not its
   * caller remembered to stop it: the drawer's buttons, the maps link, the
   * projected menu trigger and anything its menu renders in place.
   *
   * `.row-category` scrolls horizontally, and on a platform that draws a
   * classic scrollbar that scrollbar sits inside the row's hit area. Dragging
   * it is a scroll, not a tap, but the click still bubbles here and would open
   * the editor under the reader's cursor. A click below the scroller's content
   * box is a click on its scrollbar, and nothing else.
   *
   * A row that only shows opens nothing, whatever was clicked.
   */
  onActivate(event: Event): void {
    if (!this.interactive()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      event instanceof MouseEvent &&
      target?.classList.contains('row-category') &&
      event.offsetY > target.clientHeight
    ) {
      return;
    }
    const control = target?.closest('button, a, [role="menuitem"]');
    if (control && !control.classList.contains('row-activate') && this.host.contains(control)) {
      return;
    }
    this.activate.emit(this.transaction());
  }

  onSwipeEdit(event: Event): void {
    // stopPropagation, because the drawer sits inside the row's click target
    // and an action tap must never double as opening the editor.
    event.stopPropagation();
    this.closeSwipe();
    this.edit.emit(this.transaction());
  }

  onSwipeDelete(event: Event): void {
    event.stopPropagation();
    this.closeSwipe();
    this.delete.emit(this.transaction());
  }

  /** Escape and the drawer actions route here; a no-op while closed. */
  closeSwipe(): void {
    this.swipeReveal()?.close();
  }
}
