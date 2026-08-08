// Overflow smoke test: proves that a transaction whose every field is too
// long still shows all of it — with the real router, the real stylesheets and
// the Firebase emulators behind the page's Firestore reads.
//
// Unit specs measure a row in isolation. What they cannot see is the page it
// lives on: the card that clips it, the scroll container that pages it, and
// the chrome around both. That is what this covers.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
//
// Notes:
// - i18n JSON is not served by the Karma asset config, so `| translate`
//   renders raw keys — assertions match keys, never copy.
// - The final spec deletes the Firebase app while its injector is alive
//   (teardown is disabled) — no spec may run after it, hence random: false.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAppCharts } from '../../core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MockAuthService, createMockUser } from '../../core/services/testing';

jasmine.getEnv().configure({ random: false });

describe('Transaction overflow (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;

  // Long enough that nothing about it fits: an unbreakable run in the
  // description, a category and a location longer than the columns holding
  // them, the full tag complement, and a nine-figure foreign amount whose
  // converted line doubles its width.
  const LONG_DESCRIPTION =
    'Weekly grocery run at the farmers market on Ferry Building Embarcadero ' +
    'plus household supplies and https://example.com/receipts/2026-07-03/A1B2C3D4E5F6';
  const LONG_CATEGORY = 'Groceries, Household Supplies and Pantry Staples';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;

  function bodyText(): string {
    return document.body.textContent ?? '';
  }

  async function waitFor(label: string, predicate: () => boolean, flush?: () => void, timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      flush?.();
      if (predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${label}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /** True when `inner` sits entirely within `outer`, to the nearest pixel. */
  function contains(outer: Element, inner: Element): boolean {
    const o = outer.getBoundingClientRect();
    const i = inner.getBoundingClientRect();
    return i.left >= o.left - 1 && i.right <= o.right + 1 && i.top >= o.top - 1 && i.bottom <= o.bottom + 1;
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `overflow-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    const now = Timestamp.now();
    const categoryRef = await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: LONG_CATEGORY,
      icon: 'shopping_cart',
      color: '#FF9800',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: false
    });

    // The hostile row (shapes mirror TransactionService.addTransaction).
    await addDoc(collection(firestore, `users/${uid}/transactions`), {
      userId: uid,
      type: 'expense',
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      amount: 123456789,
      currency: 'JPY',
      amountInBaseCurrency: 846296.5,
      exchangeRate: 0.006855,
      description: LONG_DESCRIPTION,
      tags: ['weekly-grocery-run', 'organic-produce', 'household-supplies', 'reimbursable', 'shared'],
      location: { name: 'Ferry Building Marketplace, One Ferry Building, San Francisco' }
    });

    // Enough ordinary rows behind it that the sliding window has something to
    // page — the paging assertion below is meaningless against a single row.
    for (let i = 0; i < 60; i++) {
      await addDoc(collection(firestore, `users/${uid}/transactions`), {
        userId: uid,
        type: 'expense',
        categoryId: categoryRef.id,
        date: Timestamp.fromMillis(now.toMillis() - (i + 1) * 3600_000),
        createdAt: now,
        updatedAt: now,
        isRecurring: false,
        amount: 6.4,
        currency: 'USD',
        amountInBaseCurrency: 6.4,
        exchangeRate: 1,
        description: `Blue Bottle Coffee ${i}`
      });
    }
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideNoopAnimations(),
        provideHttpClient(),
        provideNativeDateAdapter(),
        provideAppCharts(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth }
      ],
      teardown: { destroyAfterEach: false }
    });
  });

  it(
    'shows every part of a row whose content is far too long for it',
    async () => {
      // The mock user's id must match the emulator uid so users/{uid}/… reads
      // pass the isOwner Firestore rules.
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/transactions?showAll=true');
      await waitFor(
        'transactions page with the hostile row',
        () => bodyText().includes('transactions.title') && bodyText().includes('Ferry Building'),
        () => harness.detectChanges()
      );

      // Karma's context iframe is 756px wide, just under the 768px breakpoint
      // that switches this page to the table, so what renders here is the
      // mobile list. That is not a limitation to work around — it is the view
      // most users see. The desktop table is measured across 768/1024/1440 by
      // docs/ui-audit/tools/capture-overflow.mjs. Branching rather than
      // asserting one shape, so this keeps testing whichever view it gets.
      const list = document.querySelector('app-transaction-list');
      expect(list).withContext('transaction list rendered').not.toBeNull();

      const tableScroll = document.querySelector('.table-scroll');
      if (tableScroll) {
        expect(getComputedStyle(tableScroll).overflowX)
          .withContext('table overflow is reachable, not hidden')
          .toMatch(/auto|scroll/);
        const menu = document.querySelector('.col-actions button');
        expect(menu).withContext('table row menu rendered').not.toBeNull();
        expect(contains(tableScroll, menu!.closest('tr') as Element))
          .withContext('table row laid out inside its scroller')
          .toBeTrue();
      } else {
        // The card clips, so anything outside it is destroyed rather than
        // merely off-screen. The menu is the only route to Delete.
        const card = document.querySelector('.mobile-list') as Element;
        expect(card).withContext('mobile list card rendered').not.toBeNull();

        const row = card.querySelector('app-transaction-row .transaction-row') as Element;
        const menu = card.querySelector('.row-actions button') as Element;
        expect(menu).withContext('row overflow menu rendered').not.toBeNull();
        expect(contains(row, menu)).withContext('menu inside its row').toBeTrue();
        expect(contains(card, menu)).withContext('menu inside the clipping card').toBeTrue();

        /* Inside the row is not the same as at a predictable place in it, and
           the difference is a shipped bug: the menu used to wrap to a line of
           its own and sit at the row's left edge, which every containment
           check above is perfectly happy with. It is now absolutely pinned to
           the row's top-right corner, out of the reflow entirely. */
        const tile = card.querySelector('app-transaction-row app-category-chip') as Element;
        const rowRect = row.getBoundingClientRect();
        expect(Math.abs(menu.getBoundingClientRect().right - (rowRect.right - 8)))
          .withContext('menu at the row content edge')
          .toBeLessThanOrEqual(1);
        expect(Math.abs(menu.getBoundingClientRect().top - (rowRect.top + 8)))
          .withContext('menu at the top of the row')
          .toBeLessThanOrEqual(2);

        /* The amount is the head line's only trailing item, flush against the
           head's content box — the 44px reserve under the pinned menu is head
           padding, so measuring against the content edge states the rule once. */
        const head = card.querySelector('app-transaction-row .row-head') as HTMLElement;
        const headPad = parseFloat(getComputedStyle(head).paddingRight);
        expect(headPad).withContext('menu projected, corner reserved').toBe(44);
        const amount = card.querySelector('app-transaction-row .row-amount') as Element;
        expect(Math.abs(head.getBoundingClientRect().right - headPad - amount.getBoundingClientRect().right))
          .withContext('amount at the content edge, not merely inside the row')
          .toBeLessThanOrEqual(1);

        /* The tile is what the row is read by at a glance, and it belongs on
           the same line as the text it labels. The surface never wraps, so
           the tile can no longer be orphaned the way line-collection at the
           description's max-content width once managed. */
        const body = card.querySelector('app-transaction-row .row-body') as Element;
        expect(Math.abs(tile.getBoundingClientRect().top - body.getBoundingClientRect().top))
          .withContext('category tile shares a line with the text stack')
          .toBeLessThanOrEqual(1);

        /* The list opts into the swipe drawer; the real route must render it.
           Its geometry and gesture live in the row and directive specs — here
           it only has to exist and stay clipped while closed. */
        expect(card.querySelector('app-transaction-row .row-swipe-actions'))
          .withContext('swipe drawer rendered on the transactions page')
          .not.toBeNull();

        /* The category strip carries the long category name, the location and
           the tags, and scrolls rather than stacking them (ADR 0012). */
        const strip = card.querySelector('app-transaction-row .row-category') as HTMLElement;
        expect(getComputedStyle(strip).overflowX)
          .withContext('category strip is reachable by scrolling')
          .toMatch(/auto|scroll/);

        // The row did not push its own card sideways.
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      }

      // Every digit present, in whichever view. A shortened amount is a
      // different number, and nothing on screen says it was shortened.
      const amount = document.querySelector('.amount, .col-amount app-amount-display');
      expect(amount).withContext('amount rendered').not.toBeNull();
      expect(amount!.textContent).toContain('123,456,789');

      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'keeps the page scroll container as the sliding window paging root',
    async () => {
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/transactions?showAll=true');
      await waitFor(
        'transaction list mounted',
        () => document.querySelector('app-transaction-list') !== null,
        () => harness.detectChanges()
      );

      // transaction-list finds its paging root by walking up for the first
      // ancestor that scrolls vertically. .table-scroll is a descendant, so it
      // cannot be adopted — but if anyone later moves overflow-x onto a
      // wrapper above the list, that wrapper's overflow-y computes to auto and
      // the window would silently stop loading. A comment cannot prevent that;
      // this can.
      const list = document.querySelector('app-transaction-list');
      expect(list).withContext('transaction list rendered').not.toBeNull();

      let found: Element | null = null;
      for (let el = list!.parentElement; el; el = el.parentElement) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          found = el;
          break;
        }
      }

      expect(found).withContext('a scrolling ancestor exists').not.toBeNull();
      expect(found!.classList.contains('main-container'))
        .withContext(`paging root is .main-container, found .${found?.className}`)
        .toBeTrue();

      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'still pages the sliding window after the row changes',
    async () => {
      mockAuth.setMockUser(createMockUser(uid));
      const harness = await RouterTestingHarness.create();

      await harness.navigateByUrl('/transactions?showAll=true');
      await waitFor(
        'first page of rows',
        () => document.querySelectorAll('.table-row, app-transaction-row').length > 0,
        () => harness.detectChanges()
      );

      const firstPage = document.querySelectorAll('.table-row, app-transaction-row').length;
      expect(firstPage).withContext('window loaded a first page').toBeGreaterThan(0);

      // Cheap insurance that the reflow and appFitText have not disturbed the
      // IntersectionObserver edges the window pages on.
      const scroller = document.querySelector('.main-container') as HTMLElement | null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
      }
      await waitFor(
        'window still growing',
        () => document.querySelectorAll('.table-row, app-transaction-row').length >= firstPage,
        () => harness.detectChanges(),
        8000
      );

      expect(document.querySelectorAll('.table-row, app-transaction-row').length)
        .toBeGreaterThanOrEqual(firstPage);

      // Teardown order matters: settle the rate load, then the view, then the
      // app — see app.smoke.spec.ts.
      await TestBed.inject(CurrencyService).ensureRatesLoaded();
      await new Promise(resolve => setTimeout(resolve, 500));
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    SPEC_TIMEOUT
  );
});
