import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';

import { TransactionRowComponent } from './components/transaction-row/transaction-row.component';
import { InsightTransactionListComponent } from '../features/reports/insights/insight-card/insight-transaction-list.component';
import { FitTextRegistry } from './directives/fit-text.registry';
import { CurrencyService } from '../core/services/currency.service';
import { AuthService } from '../core/services/auth.service';
import { Category, Transaction, User } from '../models';
import { createCategory, createTransaction, createUser } from '../core/services/testing';

/**
 * The app's layout rule is that nothing is hidden: no button pushed out of
 * reach, no value cut off, no text clipped away. These measure that on the
 * densest thing in the app — a transaction row, which carries a description,
 * a category, a location, tags, an amount, a converted amount, a date and the
 * only route to Delete, all on one line.
 *
 * Same shape as icon-box.spec.ts: real global styles (styles.scss is in the
 * Karma bundle), the probe attached to the document because only an attached
 * element has a layout box, and fixed container widths so nothing depends on
 * the size of the browser window running the test.
 *
 * Both halves matter. The hostile row proves nothing is lost when content is
 * long. The ordinary row proves the fix for that did not make every row taller
 * — reflow is supposed to be what happens under pressure, not what happens.
 */
@Component({
  standalone: true,
  imports: [TransactionRowComponent],
  template: `
    <!-- 320px, the narrowest phone still in use, less the card's own padding. -->
    <div class="narrow">
      <app-transaction-row [transaction]="hostile()" [categories]="categories">
        <button class="menu-probe" type="button">⋮</button>
      </app-transaction-row>
    </div>

    <!-- 375px, an ordinary phone, with the content an ordinary row carries. -->
    <div class="typical">
      <app-transaction-row [transaction]="ordinary()" [categories]="categories">
        <button class="menu-probe" type="button">⋮</button>
      </app-transaction-row>
    </div>

    <!-- A short description with an amount too wide to share the line. This
         is the case that put the menu at the row's *left* edge: the trailing
         group wrapped, and the auto margin that was supposed to right-align
         it sat on the amount, which had stayed behind. -->
    <div class="brief">
      <app-transaction-row [transaction]="brief()" [categories]="categories">
        <button class="menu-probe" type="button">⋮</button>
      </app-transaction-row>
    </div>

    <!-- 343px again, with nothing projected into the actions slot — the
         dashboard card's shape. The reserved corner must not exist here. -->
    <div class="bare">
      <app-transaction-row [transaction]="ordinary()" [categories]="categories" />
    </div>
  `,
  styles: [
    `
      // .mobile-list clips, and reproducing that here is the point: a row that
      // overflows in the app does not merely look wrong, it loses pixels.
      .narrow,
      .typical,
      .brief,
      .bare {
        overflow: hidden;
      }
      .narrow {
        width: 288px;
      }
      .typical,
      .brief,
      .bare {
        width: 343px;
      }
      // Matches .row-menu-btn in transaction-list.component.scss, which is
      // what the app actually projects here. A default-sized button would
      // under-report what the pinned corner has to cover, and the reserve in
      // the row is sized to this button.
      .menu-probe {
        width: 40px;
        height: 40px;
        padding: 0;
      }
    `,
  ],
})
class OverflowProbeComponent {
  readonly categories = new Map<string, Category>([
    ['food', createCategory({ id: 'food', name: 'Groceries', icon: 'shopping_cart' })],
    [
      'long',
      createCategory({
        id: 'long',
        name: 'Groceries, Household Supplies and Pantry Staples',
        icon: 'shopping_cart',
      }),
    ],
  ]);

  readonly hostile = signal<Transaction>(
    createTransaction({
      categoryId: 'long',
      type: 'expense',
      currency: 'JPY',
      amount: 123456789,
      amountInBaseCurrency: 846296.5,
      description:
        'Weekly grocery run at the farmers market on Ferry Building Embarcadero plus household ' +
        'supplies and a refill of the pantry staples',
      tags: ['weekly-grocery-run', 'organic-produce', 'household-supplies', 'reimbursable', 'shared'],
      location: { name: 'Ferry Building Marketplace, One Ferry Building, San Francisco' },
    } as Partial<Transaction>)
  );

  readonly brief = signal<Transaction>(
    createTransaction({
      categoryId: 'food',
      type: 'expense',
      currency: 'JPY',
      amount: 123456789,
      amountInBaseCurrency: 846296.5,
      description: 'Coffee',
    } as Partial<Transaction>)
  );

  readonly ordinary = signal<Transaction>(
    createTransaction({
      categoryId: 'food',
      type: 'expense',
      currency: 'USD',
      amount: 42,
      description: 'Whole Foods Market',
      tags: ['groceries'],
    } as Partial<Transaction>)
  );
}

describe('overflow guard', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    // Formats the way the app does, symbol and grouping included. The other
    // row specs use a "USD 42.00" stand-in, which is fine when the assertion
    // is on text — but here the width of the amount is what decides how much
    // room the description gets, so an unrealistically wide amount would
    // manufacture a reflow that no user would ever see.
    currency.formatCurrency.and.callFake((amount: number, code: string) => {
      const symbol = { USD: '$', JPY: '¥', EUR: '€' }[code] ?? `${code} `;
      const digits = code === 'JPY' ? 0 : 2;
      return `${symbol}${amount.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`;
    });
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    const currentUser = signal<User | null>(
      createUser({ preferences: { baseCurrency: 'USD' } as User['preferences'] })
    );

    await TestBed.configureTestingModule({
      imports: [OverflowProbeComponent],
      providers: [
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    TestBed.inject(FitTextRegistry).flush();
  });

  afterEach(() => host.remove());

  function el(scope: string, selector: string): HTMLElement {
    return host.querySelector(`${scope} ${selector}`) as HTMLElement;
  }

  /** True when `inner` is fully inside `outer`, to the nearest pixel. */
  function contains(outer: HTMLElement, inner: HTMLElement): boolean {
    const o = outer.getBoundingClientRect();
    const i = inner.getBoundingClientRect();
    return i.left >= o.left - 1 && i.right <= o.right + 1 && i.top >= o.top - 1 && i.bottom <= o.bottom + 1;
  }

  /**
   * Distance from the amount's right edge to the head line's content edge.
   *
   * Containment is not enough and never was: an item that has wrapped to a
   * line of its own and sits at the row's *left* edge is still inside the row,
   * and that is exactly the bug these rows shipped with. The flush edge is the
   * head's content box because the reserved corner is head padding — 44px
   * where a menu is projected, nothing where none is — so the one rule covers
   * both the list shape and the dashboard shape.
   */
  function amountGapToRightEdge(scope: string): number {
    const head = el(scope, '.row-head');
    const headRect = head.getBoundingClientRect();
    const amount = el(scope, '.row-amount').getBoundingClientRect();
    return headRect.right - parseFloat(getComputedStyle(head).paddingRight) - amount.right;
  }

  describe('a row whose content is far too long for it', () => {
    it('keeps the overflow menu inside the row', () => {
      // The menu is the only route to Delete. Before this, a long category
      // name was an anonymous flex item at its min-content size with nothing
      // able to shrink it, so it painted straight over the button.
      expect(contains(el('.narrow', '.transaction-row'), el('.narrow', '.menu-probe')))
        .withContext('overflow menu inside its row')
        .toBeTrue();
    });

    it('keeps the amount at the right edge, not merely inside the row', () => {
      expect(Math.abs(amountGapToRightEdge('.narrow')))
        .withContext('amount flush with the row content edge')
        .toBeLessThanOrEqual(1);
    });

    it('pins the overflow menu to the top-right corner, out of the reflow', () => {
      // The menu's position no longer depends on anything that can wrap: it is
      // absolutely positioned against the surface, so however long the
      // description runs — here it wraps several lines — the menu sits at the
      // same corner of every row. The old leading column bought the same
      // property by setting every row's height; this pin does not (#219).
      const menu = el('.narrow', '.menu-probe').getBoundingClientRect();
      const row = el('.narrow', '.transaction-row').getBoundingClientRect();

      expect(Math.abs(menu.right - (row.right - 8)))
        .withContext('menu right edge at the row content edge')
        .toBeLessThanOrEqual(1);
      expect(Math.abs(menu.top - (row.top + 8)))
        .withContext('menu at the top of the row')
        .toBeLessThanOrEqual(1);
    });

    it('keeps the category tile on the same line as the body', () => {
      // The surface never wraps: the tile and the text stack are its only
      // in-flow items, so the tile can no longer be orphaned on a line of its
      // own the way `flex: 1 1 auto` line-collection once managed. This is
      // the tripwire for anyone who reintroduces wrapping at that level.
      const chip = el('.narrow', 'app-category-chip').getBoundingClientRect();
      const body = el('.narrow', '.row-body').getBoundingClientRect();
      expect(Math.abs(chip.top - body.top))
        .withContext('tile and body share a line')
        .toBeLessThanOrEqual(1);
    });

    it('scrolls the category strip instead of stacking it', () => {
      /* ADR 0012. Wrapped, this strip stacked six deep — 111px of category,
         location and tags on a row 347px tall at this width, which is most of
         a phone screen for one transaction. It scrolls now, so it costs one
         line however much it carries, and the row comes in around 240.

         Nothing is lost: a scroller hides nothing that cannot be reached,
         which is the whole difference between this and a truncation.

         The bound is on the strip, not on the row. Row height still moves with
         how long the description is, and should — that part wraps, and prose
         is what the reader came for. What must not vary is this. */
      const category = el('.narrow', '.row-category');
      expect(getComputedStyle(category).overflowX)
        .withContext('category strip is reachable by scrolling')
        .toMatch(/auto|scroll/);
      expect(category.scrollWidth)
        .withContext('there is genuinely more strip off the right edge')
        .toBeGreaterThan(category.clientWidth);
      // One 14px line, plus room for a classic horizontal scrollbar on the
      // platforms that draw one. Six lines was 111.
      expect(category.getBoundingClientRect().height)
        .withContext('strip stays one line whatever it carries')
        .toBeLessThanOrEqual(40);
    });

    it('keeps every part of the row inside the clipping container', () => {
      const clip = host.querySelector('.narrow') as HTMLElement;
      for (const selector of ['.transaction-row', '.row-body', '.row-head', '.row-amount', '.row-meta', '.menu-probe']) {
        expect(contains(clip, el('.narrow', selector)))
          .withContext(`${selector} inside the clipping container`)
          .toBeTrue();
      }
    });

    it('shows the amount in full rather than a shortened version of it', () => {
      // A clipped amount is not a shortened number, it is a different one:
      // nothing on screen distinguishes ¥123,400 from ¥123,456,789.
      const amount = el('.narrow', '.amount');
      expect(amount.textContent?.trim()).toBe('-¥123,456,789');
      expect(amount.getBoundingClientRect().width)
        .toBeLessThanOrEqual(el('.narrow', '.row-amount').getBoundingClientRect().width + 1);
    });

    it('does not cut off the description, it wraps it', () => {
      const description = el('.narrow', '.row-description');
      // Taller than one line, and no scrollable remainder hiding behind a clip.
      expect(description.getBoundingClientRect().height).toBeGreaterThan(24);
      expect(description.scrollHeight).toBeLessThanOrEqual(description.clientHeight + 1);
      expect(description.scrollWidth).toBeLessThanOrEqual(description.clientWidth + 1);
    });

    it('keeps the +N tag indicator, which is what says tags were hidden', () => {
      // Still inside the row now that the strip scrolls, because the chip is
      // sticky. Unpinned it would be the last child of a scroller and would
      // sit past the right edge, out of sight of exactly the reader who needs
      // to be told there is more.
      const overflow = el('.narrow', '.tag-overflow');
      expect(overflow).withContext('+N chip rendered').not.toBeNull();
      expect(contains(el('.narrow', '.transaction-row'), overflow)).toBeTrue();
      expect(contains(el('.narrow', '.row-category'), overflow))
        .withContext('+N pinned inside the visible strip, not scrolled off it')
        .toBeTrue();
      expect(overflow.getBoundingClientRect().right)
        .withContext('+N clear of the pinned menu')
        .toBeLessThanOrEqual(el('.narrow', '.menu-probe').getBoundingClientRect().left + 1);
    });

    it('keeps the date leading and the converted amount trailing on the meta line', () => {
      const meta = el('.narrow', '.row-meta').getBoundingClientRect();
      const date = el('.narrow', '.row-date').getBoundingClientRect();
      const converted = el('.narrow', '.amount-converted').getBoundingClientRect();
      expect(Math.abs(date.left - meta.left))
        .withContext('date at the leading edge')
        .toBeLessThanOrEqual(1);
      expect(Math.abs(converted.right - meta.right))
        .withContext('converted amount at the trailing edge')
        .toBeLessThanOrEqual(1);
    });
  });

  describe('a row whose amount cannot share the line', () => {
    it('keeps the amount at the right edge when it wraps to its own line', () => {
      // The shape the original bug was reported in — a short description and a
      // nine-figure amount, which pushes the amount onto a line of its own.
      // What used to land at the row's left edge here was the overflow menu,
      // which had wrapped away from the amount carrying the auto margin. The
      // menu is out of this path entirely now; the assertion that it cannot
      // recur is the leading-column one above.
      expect(Math.abs(amountGapToRightEdge('.brief')))
        .withContext('amount flush with the row content edge')
        .toBeLessThanOrEqual(1);
    });

    it('does not move the overflow menu when the amount wraps', () => {
      // The point of the pin. However the rest of the row reflows, the menu
      // is where it was on the row above it and the row below it.
      const menu = el('.brief', '.menu-probe').getBoundingClientRect();
      const row = el('.brief', '.transaction-row').getBoundingClientRect();

      expect(Math.abs(menu.right - (row.right - 8)))
        .withContext('still at the right edge')
        .toBeLessThanOrEqual(1);
      expect(Math.abs(menu.top - (row.top + 8)))
        .withContext('still at the top')
        .toBeLessThanOrEqual(1);
      expect(contains(el('.brief', '.transaction-row'), el('.brief', '.menu-probe')))
        .withContext('still inside the row')
        .toBeTrue();
    });
  });

  describe('an ordinary row', () => {
    it('does not reflow at 375px', () => {
      // The bound on the reflow, and the reason it is stated per-line rather
      // than as a total row height: the row has always been two lines tall,
      // description over category. What must not change is that neither of
      // them wraps. Wrapping is meant to be what happens under pressure, not
      // what happens — an everyday row growing taller would cost more than
      // the bug did.
      const description = el('.typical', '.row-description');
      const category = el('.typical', '.row-category');

      expect(description.getBoundingClientRect().height)
        .withContext('description stays on one line')
        .toBeLessThan(30);
      expect(category.getBoundingClientRect().height)
        .withContext('category, location and tags stay on one line')
        .toBeLessThan(30);
      /* 88px bound, ~81 measured: 8 of padding + a one-line head (~24) +
         2 gap + the strip (~20) + 2 gap + the meta line (~17) + 8 of padding.
         The menu is pinned outside the flow and adds no height; neither does
         the swipe drawer. It was 100, set by the leading column stacking the
         menu under the tile — the trade issue #219 tracked, and this layout
         is the revisit it asked for.

         Stated as a hard number rather than a loose bound for the same reason
         the 100 was: if this fails, a line grew or a gap crept in, and that
         should be a decision somebody makes again, not a detail that drifts. */
      expect(el('.typical', '.transaction-row').getBoundingClientRect().height)
        .withContext('row is the text stack plus padding, and no taller')
        .toBeLessThanOrEqual(88);
    });

    it('ends the strip scrollport left of the pinned menu', () => {
      // On a one-line head the strip's band vertically overlaps the pinned
      // menu, and the sticky +N pins to the scrollport's right edge — so the
      // scrollport itself must stop at the reserve, or the indicator ends up
      // under the button. margin-right rather than padding, because sticky
      // insets resolve against the scrollport box.
      const strip = el('.typical', '.row-category').getBoundingClientRect();
      const menu = el('.typical', '.menu-probe').getBoundingClientRect();
      expect(strip.right)
        .withContext('strip clears the menu')
        .toBeLessThanOrEqual(menu.left + 1);
    });

    it('leaves an amount that fits at its stylesheet size', () => {
      // appFitText writes nothing at all unless it has to.
      expect(el('.typical', '.amount').style.fontSize).toBe('');
    });
  });

  describe('a row without a projected menu, which is the dashboard shape', () => {
    it('reclaims the reserved corner', () => {
      // The reserve exists for the menu, and the dashboard projects none. An
      // unconditional reserve would shave 44px off every dashboard row for a
      // button that is not there.
      expect(getComputedStyle(el('.bare', '.row-head')).paddingRight)
        .withContext('no head reserve')
        .toBe('0px');
      expect(getComputedStyle(el('.bare', '.row-category')).marginRight)
        .withContext('no strip reserve')
        .toBe('0px');
      expect(Math.abs(amountGapToRightEdge('.bare')))
        .withContext('amount flush with the row content edge')
        .toBeLessThanOrEqual(1);
    });

    it('holds the same height bound with no menu to pin', () => {
      expect(el('.bare', '.transaction-row').getBoundingClientRect().height)
        .toBeLessThanOrEqual(88);
    });
  });
});

/**
 * The insight drill-down row, which is the same anatomy one screen over:
 * a description over a date, an amount at the trailing edge, inside a card.
 *
 * It is here rather than in insight-card.component.spec.ts because that spec
 * replaces the card's template with a stub, so nothing it renders has a layout
 * box. This is the only place the row's own stylesheet is measured.
 */
@Component({
  standalone: true,
  imports: [InsightTransactionListComponent],
  template: `
    <div class="insight-clip">
      <app-insight-transaction-list [transactionIds]="ids" [lookup]="lookup" />
    </div>
  `,
  styles: [
    `
      // The insight card on a 375px phone, less its own padding.
      .insight-clip {
        width: 311px;
        overflow: hidden;
      }
    `,
  ],
})
class InsightRowProbeComponent {
  readonly ids = ['t1'];
  readonly lookup = new Map<string, Transaction>([
    [
      't1',
      createTransaction({
        id: 't1',
        currency: 'USD',
        amount: 123456789.5,
        description:
          'Weekly grocery run at the farmers market on Ferry Building Embarcadero plus ' +
          'household supplies and a refill of the pantry staples',
      }),
    ],
  ]);
}

describe('overflow guard: the insight drill-down row', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InsightRowProbeComponent] }).compileComponents();

    const fixture = TestBed.createComponent(InsightRowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    TestBed.inject(FitTextRegistry).flush();
  });

  afterEach(() => host.remove());

  it('does not truncate the description', () => {
    // This one really did truncate. The three rules ADR 0010 deleted were dead
    // — text-overflow on a flex container — but this description is a plain
    // span, so its ellipsis rendered and really did shorten what the reader
    // saw, on the row a reader opens an insight to look at.
    const description = host.querySelector('.transaction-description') as HTMLElement;
    const style = getComputedStyle(description);
    expect(style.textOverflow).withContext('no ellipsis').toBe('clip');
    expect(style.whiteSpace).withContext('text is allowed to wrap').not.toBe('nowrap');
    expect(description.scrollWidth)
      .withContext('nothing hiding past the right edge')
      .toBeLessThanOrEqual(description.clientWidth + 1);
  });

  it('keeps the amount inside the row', () => {
    const item = host.querySelector('.transaction-item') as HTMLElement;
    const amount = host.querySelector('.transaction-amount') as HTMLElement;
    const i = item.getBoundingClientRect();
    const a = amount.getBoundingClientRect();
    expect(a.right).withContext('amount inside its row').toBeLessThanOrEqual(i.right + 1);
    expect(a.left).withContext('amount not pushed out to the left').toBeGreaterThanOrEqual(i.left - 1);
  });

  it('shows every digit of the amount, scaling rather than shortening it', () => {
    const amount = host.querySelector('.transaction-amount') as HTMLElement;
    expect(amount.textContent).toContain('123,456,789');
  });
});
