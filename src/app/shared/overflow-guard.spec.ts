import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';

import { TransactionRowComponent } from './components/transaction-row/transaction-row.component';
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
  `,
  styles: [
    `
      // .mobile-list clips, and reproducing that here is the point: a row that
      // overflows in the app does not merely look wrong, it loses pixels.
      .narrow,
      .typical {
        overflow: hidden;
      }
      .narrow {
        width: 288px;
      }
      .typical {
        width: 343px;
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

  describe('a row whose content is far too long for it', () => {
    it('keeps the overflow menu inside the row', () => {
      // The menu is the only route to Delete. Before this, a long category
      // name was an anonymous flex item at its min-content size with nothing
      // able to shrink it, so it painted straight over the button.
      expect(contains(el('.narrow', '.transaction-row'), el('.narrow', '.menu-probe')))
        .withContext('overflow menu inside its row')
        .toBeTrue();
    });

    it('keeps every part of the row inside the clipping container', () => {
      const clip = host.querySelector('.narrow') as HTMLElement;
      for (const selector of ['.transaction-row', '.row-details', '.row-amount', '.menu-probe']) {
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
      const overflow = el('.narrow', '.tag-overflow');
      expect(overflow).withContext('+N chip rendered').not.toBeNull();
      expect(contains(el('.narrow', '.transaction-row'), overflow)).toBeTrue();
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
      expect(el('.typical', '.transaction-row').getBoundingClientRect().height)
        .withContext('row is still the usual two-line height')
        .toBeLessThanOrEqual(80);
    });

    it('leaves an amount that fits at its stylesheet size', () => {
      // appFitText writes nothing at all unless it has to.
      expect(el('.typical', '.amount').style.fontSize).toBe('');
    });
  });
});
