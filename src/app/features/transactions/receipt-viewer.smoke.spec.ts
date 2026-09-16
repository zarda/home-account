// Receipt-viewer smoke test: proves the real doors onto a transaction's
// stored receipt photo open the real dialog — the desktop list icon and the
// phone's trailing menu — with the real router, the real Material overlays,
// the real provider graph, and the Firebase emulators behind the page's
// Firestore and Storage reads.
//
// Unit specs mount the dialog directly against stubs for MatDialogRef and
// MAT_DIALOG_DATA, so none of them can see whether a door actually opens it,
// whether the image it shows is the one really stored, or whether the lens
// beside it leaves the transaction untouched. That is what this covers.
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
// - The no-provider case deletes the Gemini key so the lens is only ever
//   asked whether it could translate; nothing there reaches a model. The
//   panel case instead provides ReceiptTranslationService itself as a
//   double — stubbing only the cloud façade would leave available() false
//   regardless (no key means no vision provider), which is the disabled
//   state the other case already proves.
// - The final spec deletes the Firebase app while its injector is alive
//   (teardown is disabled) — no spec may run after it, hence random: false.
import { Injector, Provider, signal } from '@angular/core';
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
  doc,
  setDoc,
  getDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { MediaMatcher } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { StorageService } from '../../core/services/storage.service';
import { ReceiptTranslationService } from '../../core/services/receipt-translation.service';
import { MockAuthService, createMockUser } from '../../core/services/testing';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';

/**
 * A viewport width standing in for the device, so a spec can rotate a phone.
 * Width features are answered from that width — which covers the app's
 * breakpoint scale and the list's own `(min-width: 768px)` alike — and any
 * query with no width feature in it (reduced motion, forced colours) is handed
 * to the real matcher rather than silently answered "no match".
 */
class FakeMediaMatcher {
  constructor(private readonly width$: BehaviorSubject<number>) {}

  private evaluate(query: string, width: number): boolean {
    const mins = [...query.matchAll(/\(min-width:\s*([\d.]+)px\)/g)];
    const maxes = [...query.matchAll(/\(max-width:\s*([\d.]+)px\)/g)];
    if (mins.length === 0 && maxes.length === 0) {
      return window.matchMedia(query).matches;
    }
    return (
      mins.every(m => width >= parseFloat(m[1])) && maxes.every(m => width <= parseFloat(m[1]))
    );
  }

  matchMedia(query: string): MediaQueryList {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const evaluate = (width: number) => this.evaluate(query, width);
    const width$ = this.width$;

    width$.subscribe(width => {
      const event = { media: query, matches: evaluate(width) } as MediaQueryListEvent;
      listeners.forEach(fn => fn(event));
    });

    return {
      media: query,
      get matches() {
        return evaluate(width$.value);
      },
      addListener: (fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeListener: (fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
      addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn)
    } as unknown as MediaQueryList;
  }
}

/**
 * A minimal but genuinely decodable PNG (1x1, from a base64 literal) rather
 * than `new Blob(['img'])`: this goes to the real Storage emulator and is
 * then rendered by a real `<img>` tag, which needs bytes it can actually
 * decode to avoid a broken-image console error.
 */
const RECEIPT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function receiptFile(): File {
  const bytes = Uint8Array.from(atob(RECEIPT_PNG_BASE64), c => c.charCodeAt(0));
  return new File([bytes], 'receipt.png', { type: 'image/png' });
}

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();
stripProviderKeys();

describe('Receipt viewer doors and lens (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;
  const DESCRIPTION = 'Lawson Ginza';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let transactionId: string;
  let receiptUrl: string;
  let mockAuth: MockAuthService;
  let width$: BehaviorSubject<number>;

  function bodyText(): string {
    return document.body.textContent ?? '';
  }

  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
  }

  function viewReceiptItem(): HTMLElement | undefined {
    return menuItems().find(item => (item.textContent ?? '').includes('transactions.viewReceipt'));
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

  /** The transactions page, loaded and showing the seeded row. */
  async function openTransactions(): Promise<RouterTestingHarness> {
    // The mock user's id must match the emulator uid so users/{uid}/… reads
    // pass the isOwner Firestore rules.
    mockAuth.setMockUser(createMockUser(uid));
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/transactions');
    await waitFor(
      'transactions page with the seeded row',
      () => bodyText().includes('transactions.title') && bodyText().includes(DESCRIPTION),
      () => harness.detectChanges()
    );
    return harness;
  }

  /** Base providers every case needs; a case with its own lens state adds to them. */
  function configureTestBed(extraProviders: Provider[] = []): void {
    mockAuth = new MockAuthService();
    width$ = new BehaviorSubject<number>(1440);
    // Reset unconditionally rather than relying on the implicit reset the
    // framework schedules for the next spec: this module's beforeAll runs
    // ahead of any of that, and the whole-suite ordering proof runs this file
    // after one that leaves the previous module instantiated.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        // Fake the OS-level matcher, never BreakpointObserver itself: the
        // observer's own logic is part of what these specs are checking.
        { provide: MediaMatcher, useValue: new FakeMediaMatcher(width$) },
        provideNoopAnimations(),
        provideHttpClient(),
        provideNativeDateAdapter(),
        provideAppCharts(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth },
        ...extraProviders
      ],
      teardown: { destroyAfterEach: false }
    });
  }

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `receipt-viewer-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // One category + one receipted transaction so /transactions exercises its
    // real Firestore read path (shapes mirror TransactionService.addTransaction).
    const now = Timestamp.now();
    const categoryDoc = doc(collection(firestore, `users/${uid}/categories`));
    await setDoc(categoryDoc, {
      userId: uid,
      name: 'Groceries',
      icon: 'shopping_cart',
      color: '#FF9800',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: false
    });

    // Pre-allocate the transaction's id so the receipt can be uploaded to its
    // real storage path before the document itself is written.
    const transactionRef = doc(collection(firestore, `users/${uid}/transactions`));
    transactionId = transactionRef.id;

    // Upload through the real StorageService (compress-then-store, exactly
    // what every door in the app calls), not a raw SDK put — a raw put would
    // skip prepareReceiptImage and prove nothing about the path a real photo
    // takes. A plain Injector, never TestBed: beforeAll runs before this
    // describe's own beforeEach gets a turn to (re)configure the testing
    // module, so an earlier spec file's still-instantiated module would make
    // TestBed.configureTestingModule here throw.
    const uploaderInjector = Injector.create({
      providers: [StorageService, { provide: Storage, useValue: storage }]
    });
    receiptUrl = await uploaderInjector.get(StorageService).uploadReceipt(uid, transactionId, receiptFile());

    await setDoc(transactionRef, {
      userId: uid,
      type: 'expense',
      categoryId: categoryDoc.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      amount: 4.2,
      currency: 'USD',
      amountInBaseCurrency: 4.2,
      exchangeRate: 1,
      description: DESCRIPTION,
      receiptUrl,
      receiptUrls: [receiptUrl],
      receiptCount: 1
    });
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  describe('no vision provider configured', () => {
    beforeEach(() => configureTestBed());

    it(
      'opens the stored receipt from the desktop list icon, the lens honest about having no provider',
      async () => {
        const harness = await openTransactions();

        const icon = document.querySelector<HTMLElement>('.receipt-icon-button');
        expect(icon).withContext('the desktop receipt control').not.toBeNull();
        icon!.click();
        await waitFor(
          'receipt dialog',
          () => document.querySelector('img.receipt-image') !== null,
          () => harness.detectChanges()
        );

        // The dialog shows the photo that was actually uploaded, not a stand-in.
        expect(document.querySelector('img.receipt-image')?.getAttribute('src')).toBe(receiptUrl);

        // The lens is real, and so is the provider registry behind it: nothing
        // in this environment holds a key, so the only honest answer is a
        // disabled button that says where a key would go.
        const translate = document.querySelector<HTMLButtonElement>('.translate-button');
        expect(translate).withContext('the lens rendered its button').not.toBeNull();
        expect(translate!.disabled).withContext('no provider can answer').toBeTrue();
        expect(document.querySelector('.no-provider-hint')?.textContent)
          .toContain('receiptViewer.noVisionProvider');

        document.querySelector<HTMLElement>('.close-button')!.click();
        await waitFor(
          'receipt dialog closed',
          () => document.querySelector('img.receipt-image') === null,
          () => harness.detectChanges()
        );
        harness.fixture.destroy();
      },
      SPEC_TIMEOUT
    );

    it(
      'opens the same receipt from the phone trailing menu, the image never overflowing the real window',
      async () => {
        width$.next(430);
        const harness = await openTransactions();
        await waitFor(
          'mobile list',
          () => document.querySelector('.row-menu-btn') !== null,
          () => harness.detectChanges()
        );

        document.querySelector<HTMLElement>('.row-menu-btn')!.click();
        await waitFor(
          'row trailing menu',
          () => menuItems().length > 0,
          () => harness.detectChanges()
        );

        const item = viewReceiptItem();
        expect(item).withContext('the only route to the receipt on a phone').toBeDefined();
        item!.click();
        await waitFor(
          'receipt dialog from the phone menu',
          () => document.querySelector('img.receipt-image') !== null,
          () => harness.detectChanges()
        );

        const image = document.querySelector<HTMLImageElement>('img.receipt-image')!;
        expect(image.getAttribute('src')).toBe(receiptUrl);
        // window.innerWidth here is karma's real (desktop) window — width$ only
        // fakes the media matcher, not the viewport — so this proves the image
        // never overflows the actual window at the phone layout, not that it
        // fits a 430px phone; that fit is journey 22's, driven in a real browser.
        const rect = image.getBoundingClientRect();
        expect(rect.right).withContext('right edge inside the viewport').toBeLessThanOrEqual(window.innerWidth);
        expect(rect.left).withContext('left edge inside the viewport').toBeGreaterThanOrEqual(0);

        document.querySelector<HTMLElement>('.close-button')!.click();
        await waitFor(
          'receipt dialog closed',
          () => document.querySelector('img.receipt-image') === null,
          () => harness.detectChanges()
        );
        harness.fixture.destroy();
      },
      SPEC_TIMEOUT
    );
  });

  describe('vision provider available (lens double)', () => {
    // Stubbing the cloud façade alone would change nothing: available() stays
    // false with no key, which is the disabled state the sibling describe
    // already proves. Doubling the service itself is what lets this side
    // reach the panel without a real vision call.
    let translateSpy: jasmine.Spy;
    let failureKeySpy: jasmine.Spy;

    beforeEach(() => {
      translateSpy = jasmine.createSpy('translate')
        .and.resolveTo({ text: 'Rice ball 150', sourceLanguage: 'Japanese' });
      failureKeySpy = jasmine.createSpy('failureKey');
      configureTestBed([
        {
          provide: ReceiptTranslationService,
          useValue: { available: signal(true), translate: translateSpy, failureKey: failureKeySpy }
        }
      ]);
    });

    it(
      'reads the photo on demand and leaves the stored transaction untouched',
      async () => {
        const harness = await openTransactions();

        const transactionRef = doc(firestore, `users/${uid}/transactions/${transactionId}`);
        const before = JSON.stringify((await getDoc(transactionRef)).data());

        document.querySelector<HTMLElement>('.receipt-icon-button')!.click();
        await waitFor(
          'receipt dialog',
          () => document.querySelector('img.receipt-image') !== null,
          () => harness.detectChanges()
        );

        document.querySelector<HTMLButtonElement>('.translate-button')!.click();
        await waitFor(
          'translation panel',
          () => document.querySelector('.translation-panel') !== null,
          () => harness.detectChanges()
        );

        expect(translateSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: transactionId }), 0);
        expect(document.querySelector('.translated-text')?.textContent).toContain('Rice ball 150');
        expect(document.querySelector('.translation-marker')?.textContent).toContain('noteTranslation.marker');

        // The lens-never-writes contract, checked against the real rules: the
        // document read back after the panel renders is byte-identical to the
        // one read before the dialog ever opened.
        const after = JSON.stringify((await getDoc(transactionRef)).data());
        expect(after).withContext('the lens never writes').toBe(before);

        document.querySelector<HTMLElement>('.close-button')!.click();
        await waitFor(
          'receipt dialog closed',
          () => document.querySelector('img.receipt-image') === null,
          () => harness.detectChanges()
        );

        // Drain the exchange-rate initialization chain (Firestore cache read +
        // external fetch) before teardown — its in-flight work would otherwise
        // outlive the app and stall the browser (same rationale as
        // app.smoke.spec.ts).
        await TestBed.inject(CurrencyService).ensureRatesLoaded();
        await new Promise(resolve => setTimeout(resolve, 500));

        // Shut down while this spec's injector is alive (see header comment):
        // close the routed components' Firestore listeners, then the SDK. The
        // emulator's state is throwaway, so the seeded row is left in place.
        harness.fixture.destroy();
        await new Promise(resolve => setTimeout(resolve, 300));
        await deleteApp(app);
        await new Promise(resolve => setTimeout(resolve, 300));
      },
      SPEC_TIMEOUT
    );
  });
});
