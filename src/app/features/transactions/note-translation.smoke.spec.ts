// Note-translation smoke test: proves every door onto a transaction's note
// opens — the desktop icon in the description cell, the desktop actions menu,
// the phone's trailing menu, and the edit form — with the real router, the
// real Material overlays, the real provider graph, and the Firebase emulators
// behind the page's Firestore reads.
//
// Unit specs mount each door against a MatDialog spy, so none of them can see
// whether the dialog it names actually opens, or whether the lens inside it
// works out that nothing can answer. That is what this covers.
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
// - No AI provider is configured in this environment, so the lens is only
//   ever asked whether it could translate; nothing here reaches a model.
// - The final spec deletes the Firebase app while its injector is alive
//   (teardown is disabled) — no spec may run after it, hence random: false.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { provideAppCharts } from '../../core/config/chart.config';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  deleteDoc,
  doc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { MediaMatcher } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { MockAuthService, createMockUser } from '../../core/services/testing';
import { environment } from '../../../environments/environment';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';

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

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();

describe('Note translation doors (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;

  // Three lines, because a receipt is written as lines and the dialog exists
  // to show them as lines. A single-line note would pass a version of this
  // page that folded every break away.
  const NOTE_LINES = ['おにぎり 2個 ¥300', 'お茶 ¥120', '合計 ¥420'];
  const NOTE = NOTE_LINES.join('\n');
  const DESCRIPTION = 'Family Mart Shibuya';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let transactionId: string;
  let mockAuth: MockAuthService;
  let width$: BehaviorSubject<number>;

  function bodyText(): string {
    return document.body.textContent ?? '';
  }

  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
  }

  function viewNoteItem(): HTMLElement | undefined {
    return menuItems().find(item => (item.textContent ?? '').includes('transactions.viewNote'));
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

  // A developer machine's gitignored environment can carry a real Gemini key
  // — the only provider key the build-time environment ever carries — which
  // would make the lens honestly report a provider instead of the disabled,
  // hinted state this spec exists to prove. The key must be absent for the
  // suite's duration no matter what machine runs it.
  const env = environment as { geminiApiKey?: string };
  let savedKey: string | undefined;
  let hadKey = false;

  beforeAll(async () => {
    hadKey = 'geminiApiKey' in env;
    savedKey = env.geminiApiKey;
    delete env.geminiApiKey;

    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `note-translation-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // One category + one noted transaction so /transactions exercises its real
    // Firestore read path (shapes mirror TransactionService.addTransaction).
    const now = Timestamp.now();
    const categoryRef = await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: 'Groceries',
      icon: 'shopping_cart',
      color: '#FF9800',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: false
    });
    const transactionRef = await addDoc(collection(firestore, `users/${uid}/transactions`), {
      userId: uid,
      type: 'expense',
      categoryId: categoryRef.id,
      date: now,
      createdAt: now,
      updatedAt: now,
      isRecurring: false,
      amount: 4.2,
      currency: 'USD',
      amountInBaseCurrency: 4.2,
      exchangeRate: 1,
      description: DESCRIPTION,
      note: NOTE
    });
    transactionId = transactionRef.id;
  });

  afterAll(async () => {
    if (hadKey) {
      env.geminiApiKey = savedKey;
    }
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    width$ = new BehaviorSubject<number>(1440);
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
        { provide: AuthService, useValue: mockAuth }
      ],
      teardown: { destroyAfterEach: false }
    });
  });

  it(
    'opens the note from the desktop icon, lines intact, with the lens honest about having no provider',
    async () => {
      const harness = await openTransactions();

      const icon = document.querySelector<HTMLElement>('.note-button');
      expect(icon).withContext('the desktop note control').not.toBeNull();
      icon!.click();
      await waitFor(
        'note dialog',
        () => document.querySelector('.note-text') !== null,
        () => harness.detectChanges()
      );

      const note = document.querySelector<HTMLElement>('.note-text')!;
      for (const line of NOTE_LINES) {
        expect(note.textContent).toContain(line);
      }
      // The real stylesheet, not the unit spec's: a note folded into one
      // paragraph is not the note that was written.
      expect(getComputedStyle(note).whiteSpace).toBe('pre-wrap');
      expect(document.querySelector('.note-subtitle')?.textContent).toContain(DESCRIPTION);

      // The lens is real, and so is the provider registry behind it: nothing
      // in this environment holds a key, so the only honest answer is a
      // disabled button that says where a key would go.
      const translate = document.querySelector<HTMLButtonElement>('.translate-button');
      expect(translate).withContext('the lens rendered its button').not.toBeNull();
      expect(translate!.disabled).withContext('no provider can answer').toBeTrue();
      expect(document.querySelector('.no-provider-hint')?.textContent)
        .toContain('noteTranslation.noProvider');

      TestBed.inject(MatDialog).closeAll();
      await waitFor(
        'note dialog closed',
        () => document.querySelector('.note-text') === null,
        () => harness.detectChanges()
      );
      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'lists the note in the desktop actions menu',
    async () => {
      const harness = await openTransactions();

      const actions = document.querySelector<HTMLElement>('.desktop-view .action-btn');
      expect(actions).withContext('the row actions button').not.toBeNull();
      actions!.click();
      await waitFor(
        'row actions menu',
        () => menuItems().length > 0,
        () => harness.detectChanges()
      );

      expect(viewNoteItem()).withContext('the menu route to the note').toBeDefined();

      document.body.click();
      harness.detectChanges();
      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'opens the editor with the lens under the note field when the row itself is clicked',
    async () => {
      const harness = await openTransactions();

      // The row, not the icon inside it: the icon stops the click, and this is
      // the behaviour that stop must not have taken away.
      document.querySelector<HTMLElement>('tr.table-row')!.click();
      await waitFor(
        'edit form',
        () => document.querySelector('textarea[formControlName="note"]') !== null,
        () => harness.detectChanges()
      );

      const field = document
        .querySelector<HTMLElement>('textarea[formControlName="note"]')!
        .closest('mat-form-field')!;
      expect(field.nextElementSibling?.tagName.toLowerCase())
        .withContext('the lens sits directly beneath the note field')
        .toBe('app-note-translation');
      expect(document.querySelector('app-note-translation .translate-button'))
        .withContext('the stored note gives the lens something to offer')
        .not.toBeNull();

      TestBed.inject(MatDialog).closeAll();
      await waitFor(
        'edit form closed',
        () => document.querySelector('textarea[formControlName="note"]') === null,
        () => harness.detectChanges()
      );
      harness.fixture.destroy();
    },
    SPEC_TIMEOUT
  );

  it(
    'opens the same note from the phone trailing menu',
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

      const item = viewNoteItem();
      expect(item).withContext('the only route to the note on a phone').toBeDefined();
      item!.click();
      await waitFor(
        'note dialog from the phone menu',
        () => document.querySelector('.note-text') !== null,
        () => harness.detectChanges()
      );
      expect(document.querySelector('.note-text')?.textContent).toContain(NOTE_LINES[2]);

      TestBed.inject(MatDialog).closeAll();
      await waitFor(
        'note dialog closed',
        () => document.querySelector('.note-text') === null,
        () => harness.detectChanges()
      );

      // Drain the exchange-rate initialization chain (Firestore cache read +
      // external fetch) before teardown — its in-flight work would otherwise
      // outlive the app and stall the browser (same rationale as
      // app.smoke.spec.ts).
      await TestBed.inject(CurrencyService).ensureRatesLoaded();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Shut down while this spec's injector is alive (see header comment):
      // close the routed components' Firestore listeners, drop the seeded row,
      // then the SDK.
      harness.fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
      await deleteDoc(doc(firestore, `users/${uid}/transactions/${transactionId}`));
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    SPEC_TIMEOUT
  );
});
