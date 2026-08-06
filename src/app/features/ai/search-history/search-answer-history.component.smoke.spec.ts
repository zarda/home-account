// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so a
// Firestore instance built from root `firebase/firestore` is incompatible
// with the query calls FirestoreService makes via @angular/fire.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { of } from 'rxjs';
import { SearchAnswerHistoryComponent } from './search-answer-history.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AuthService } from '../../../core/services/auth.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { PwaService } from '../../../core/services/pwa.service';
import { SearchHistoryService } from '../../../core/services/search-history.service';
import { StorageService } from '../../../core/services/storage.service';
import { TranslationService } from '../../../core/services/translation.service';
import { dayKey } from '../../../core/utils/transaction-date.utils';
import { Transaction } from '../../../models';

/**
 * End-to-end smoke test for the search-answer history page against the
 * Firestore emulator: the real component over the real history service,
 * NlSearchService and TransactionService. What the unit specs stub is real
 * here — the live subscription rendering seeded documents, Refresh
 * recomputing from seeded transactions through the local aggregate path and
 * persisting corrected figures, and delete removing the document — all with
 * the live security rules validating every write.
 *
 * Runs only under the emulators:
 *   npm run test:smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('SearchAnswerHistoryComponent (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: ReturnType<typeof getFirestore>;
  let uid: string;
  let fixture: ComponentFixture<SearchAnswerHistoryComponent>;

  const SEEDED_COMPUTED_AT = Timestamp.fromMillis(Date.UTC(2026, 7, 3, 12));

  const txn = (id: string, amount: number): Record<string, unknown> => ({
    userId: '',
    description: `seed ${id}`,
    categoryId: 'cat-food',
    type: 'expense',
    amount,
    currency: 'USD',
    amountInBaseCurrency: amount,
    exchangeRate: 1,
    date: Timestamp.fromDate(new Date(2026, 7, 10, 12)),
    isRecurring: false,
  });

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `search-answer-page-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded with the raw SDK: the TestBed cannot be configured here, because
    // beforeAll runs before the framework's per-test auto-reset. The stored
    // answer's figures are deliberately stale — two August transactions total
    // 100, the record claims 999 — so Refresh has something visible to
    // correct.
    await Promise.all([
      setDoc(doc(firestore, `users/${uid}/transactions/tx-1`), { ...txn('tx-1', 80), userId: uid }),
      setDoc(doc(firestore, `users/${uid}/transactions/tx-2`), { ...txn('tx-2', 20), userId: uid }),
      setDoc(doc(firestore, `users/${uid}/searchAnswers/ans-1`), {
        userId: uid,
        schemaVersion: 1,
        query: 'how much on food in august',
        operation: 'sum',
        limit: 3,
        scope: { startDate: '2026-08-01', endDate: '2026-08-31' },
        baseCurrency: 'USD',
        value: 999,
        currency: 'USD',
        transactionCount: 1,
        computedAt: SEEDED_COMPUTED_AT,
        lastUsedAt: SEEDED_COMPUTED_AT,
      }),
    ]);
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchAnswerHistoryComponent],
      providers: [
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
        // The replay path converts through amountInBase; the seeded rows carry
        // their own base amounts, so the stub keeps the smoke about Firestore
        // rather than exchange rates.
        {
          provide: CurrencyService,
          useValue: {
            amountInBase: (t: Transaction) => t.amountInBaseCurrency ?? t.amount,
            formatCurrency: (value: number, code: string) => `${code} ${value.toFixed(2)}`,
          },
        },
        { provide: DateFormatService, useValue: { formatDate: (d: Date) => dayKey(d) } },
        // Constructed by NlSearchService but never reached by replayAggregate.
        { provide: AIStrategyService, useValue: { canUseCloud: () => false } },
        { provide: CloudLLMProviderService, useValue: {} },
        { provide: PwaService, useValue: { isOnline: () => true } },
        { provide: SearchHistoryService, useValue: { recordRecent: () => Promise.resolve() } },
        { provide: AnalyticsService, useValue: { trackAiAssistUsed: () => undefined } },
        // TransactionService injects it for receipt files; the range fetch
        // the replay path uses never touches storage.
        { provide: StorageService, useValue: {} },
        // Confirmation UX is unit-covered; the smoke exercises the delete.
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchAnswerHistoryComponent);
    fixture.detectChanges();
  });

  // The page renders off a live onSnapshot subscription; poll until the
  // condition holds instead of racing it.
  async function waitFor(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 150; i++) {
      fixture.detectChanges();
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it('renders, reopens, refreshes and deletes a stored answer end to end', async () => {
    // The seeded record arrives through the live subscription.
    await waitFor(
      () => fixture.componentInstance.history.answers().length === 1,
      'the seeded record to arrive');
    let text = fixture.nativeElement.textContent as string;
    expect(text).toContain('how much on food in august');
    expect(text).toContain('USD 999.00');

    // Reopening shows the stored snapshot with its computed-at label.
    (fixture.nativeElement.querySelector('.history-open') as HTMLButtonElement).click();
    await waitFor(
      () => !!fixture.nativeElement.querySelector('app-nl-answer-card'),
      'the snapshot card');
    text = fixture.nativeElement.textContent as string;
    expect(text).toContain('aiSearch.historyComputedAt');
    expect(text).toContain('2026-08-03');

    // Refresh recomputes from the seeded transactions — 80 + 20, not 999 —
    // and persists the corrected figures onto the same document.
    (fixture.nativeElement.querySelector('.history-refresh') as HTMLButtonElement).click();
    await waitFor(
      () => (fixture.nativeElement.textContent as string).includes('USD 100.00'),
      'the refreshed figure');

    const refreshed = (await getDoc(doc(firestore, `users/${uid}/searchAnswers/ans-1`))).data();
    expect(refreshed?.['value']).toBe(100);
    expect(refreshed?.['transactionCount']).toBe(2);
    expect((refreshed?.['computedAt'] as Timestamp).toMillis())
      .toBeGreaterThan(SEEDED_COMPUTED_AT.toMillis());
    // Identity untouched by the refresh.
    expect(refreshed?.['query']).toBe('how much on food in august');
    expect(refreshed?.['scope']).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31' });

    // Delete removes the document and the page falls back to its empty state.
    (fixture.nativeElement.querySelector('.history-delete') as HTMLButtonElement).click();
    await waitFor(
      () => fixture.componentInstance.history.answers().length === 0,
      'the record to disappear');
    const remaining = await getDocs(collection(firestore, `users/${uid}/searchAnswers`));
    expect(remaining.size).toBe(0);
    expect((fixture.nativeElement.textContent as string)).toContain('aiSearch.historyEmpty');
  }, 30000);
});
