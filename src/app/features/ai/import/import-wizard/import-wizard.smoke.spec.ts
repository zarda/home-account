// Wizard review smoke test: proves that a camera/scan handoff arriving via
// router state renders the review step with per-receipt labels — the full
// wizard template, real Material stepper, and real Firestore-backed
// category loading against the emulators. No AI provider exists here; the
// handoff payload is built directly, exactly as the capture dialog and the
// form's multi-receipt chooser hand it over.
//
// A second case stubs one seam deeper — CloudLLMProviderService, the only
// thing with no local emulator — so the real AIImportService runs its actual
// consolidation, categorization fallback and confirmImport against the
// emulators. That is the only path that can show a receipt's printed total
// surviving all the way from extraction into the stored transaction, rather
// than the item sum a naive merge would have written instead.
//
// The last case runs the same seam over the fields the review step now
// suggests — a printed location, tags drawn from the account's own
// vocabulary, and the recurring rule a row looks like. The unit suites mock
// addTransaction, so only this one can say the rules accept those fields, or
// that the tag memory the confirm writes passes tagMemoryValid.
//
// The last three cases combine both arrangements for the first time: the
// provider stub runs the real extraction, its result is handed over through
// router state, and the review step that renders it is the real card. That is
// the only place a correction made on the card — a kept date, a retyped
// amount or description, an overruled duplicate verdict — can be followed
// through the wizard's own confirmImport into the document the rules accepted,
// or a re-check watched against a ledger that actually holds the row it finds.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  Firestore
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { ImportWizardComponent } from './import-wizard.component';
import { AuthService } from '../../../../core/services/auth.service';
import { MockAuthService, createMockUser } from '../../../../core/services/testing';
import { AIImportService } from '../../../../core/services/ai-import.service';
import { CloudLLMProviderService } from '../../../../core/services/cloud-llm-provider.service';
import { PwaService } from '../../../../core/services/pwa.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { DuplicateDetectionService } from '../../../../core/services/duplicate-detection.service';
import { ReceiptQuotaService } from '../../../../core/services/receipt-quota.service';
import { MultiImageExtractedTransaction, ParsedReceipt } from '../../../../core/services/gemini.service';
import { DEFAULT_USER_PREFERENCES, ImportResult } from '../../../../models';
import { parseDateInput } from '../../../../core/utils/transaction-date.utils';
import { TransactionPreviewTableComponent } from '../transaction-preview-table/transaction-preview-table.component';
import { silenceFirebaseWarnings } from '../../../../core/services/testing/silence-firebase-warnings';

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();

/**
 * Step until the wizard has settled, rather than sleeping a guessed span.
 * The cases above wait out a known macrotask; a re-check is a Firestore round
 * trip behind an edit, so this polls the state it is waiting for and fails
 * loudly when it never arrives instead of asserting against a half-applied
 * verdict.
 */
async function until(
  fixture: ComponentFixture<ImportWizardComponent>,
  predicate: () => boolean,
  timeoutMs = 10000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('the wizard never reached the expected state');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    fixture.detectChanges();
  }
  fixture.detectChanges();
}

/**
 * The single-receipt seam the three review-correction cases share: the cloud
 * provider (the only thing with no local emulator), the two services it is
 * always stubbed alongside, and the exchange-rate fetch. Everything the import
 * itself does — the strategy, the categorization fallback, duplicate
 * detection, the Firestore writes — runs for real.
 *
 * CurrencyService is stubbed wider here than in the cases above, which never
 * render the review step: the card asks for the whole currency picker at
 * construction and formats every row's amount from its template, so the
 * narrow { getExchangeRate, ensureRatesLoaded } stub throws before a row can
 * be corrected. One copy, so the widening cannot drift between the three.
 * The rate stays 1, which keeps the JPY rows off the network without touching
 * the figures under test — nothing here converts.
 */
function stubReceiptSeams(parsed: ParsedReceipt): void {
  const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
    'CloudLLMProviderService',
    [
      'hasAnyCloudProvider',
      'parseReceipt',
      'initializeProviders',
      'resetProviders',
      'setOpenAIModel',
      'setClaudeModel',
      'availableProviders',
      'providerStatus',
      'resolveProvider'
    ]
  );
  cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
  cloudLLMProvider.parseReceipt.and.resolveTo(parsed);
  cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
  cloudLLMProvider.resetProviders.and.resolveTo(undefined);
  cloudLLMProvider.availableProviders.and.returnValue([]);
  cloudLLMProvider.providerStatus.and.returnValue({
    gemini: false,
    openai: false,
    claude: false
  });
  cloudLLMProvider.resolveProvider.and.returnValue(null);

  const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
    'isOnline',
    'registerBackgroundSync'
  ]);
  pwa.isOnline.and.returnValue(true);
  pwa.registerBackgroundSync.and.resolveTo(true);

  const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
    'AnalyticsService',
    ['trackAiAssistUsed']
  );

  TestBed.configureTestingModule({
    providers: [
      { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
      { provide: PwaService, useValue: pwa },
      { provide: AnalyticsService, useValue: analytics },
      {
        provide: CurrencyService,
        useValue: {
          getExchangeRate: () => 1,
          ensureRatesLoaded: () => Promise.resolve(),
          getSupportedCurrencies: () => [
            { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
            { code: 'JPY', nameKey: 'currencies.jpy', symbol: '¥' }
          ],
          getCurrencyInfo: (code: string) => ({
            code,
            nameKey: `currencies.${code.toLowerCase()}`,
            symbol: code
          }),
          formatCurrency: (amount: number, code: string) => `${code} ${amount}`
        }
      }
    ],
    teardown: { destroyAfterEach: false }
  });
}

describe('ImportWizardComponent camera handoff (emulator smoke test)', () => {
  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let storage: ReturnType<typeof getStorage>;
  let uid: string;
  let mockAuth: MockAuthService;

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account',
        storageBucket: 'demo-home-account.appspot.com'
      },
      `wizard-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    storage = getStorage(app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // The wizard loads categories through the real CategoryService
    await addDoc(collection(firestore, `users/${uid}/categories`), {
      userId: uid,
      name: 'Groceries',
      icon: 'shopping_cart',
      color: '#FF9800',
      type: 'expense',
      order: 0,
      isActive: true,
      isDefault: false
    });
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(() => {
    mockAuth = new MockAuthService();
    mockAuth.setMockUser(createMockUser(uid));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideNativeDateAdapter(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        { provide: Storage, useValue: storage },
        { provide: AuthService, useValue: mockAuth }
      ],
      teardown: { destroyAfterEach: false }
    });
  });

  it(
    'renders the review step with one labeled row per detected receipt',
    async () => {
      // The exact payload shape handleImportResult / the form chooser pass:
      // one photo, two receipt groups → two transactions.
      const importResult: ImportResult = {
        source: 'image',
        fileType: 'receipt_image',
        fileName: 'receipts.jpg',
        fileSize: 1234,
        confidence: 0.9,
        warnings: [],
        duplicates: [],
        transactions: [
          {
            id: 'r1',
            description: 'Coffee Corner',
            amount: 12.5,
            currency: 'USD',
            date: new Date('2026-07-01'),
            type: 'expense',
            suggestedCategoryId: 'other_expense',
            categoryConfidence: 0.9,
            isDuplicate: false,
            selected: true,
            imageMetadata: {
              imageIndex: 0,
              imageId: 'image_0',
              positionInImage: 'top',
              confidenceScore: 0.9,
              receiptId: 1,
              mergedFromImages: [0]
            }
          },
          {
            id: 'r2',
            description: 'Corner Bakery',
            amount: 8.25,
            currency: 'USD',
            date: new Date('2026-07-01'),
            type: 'expense',
            suggestedCategoryId: 'other_expense',
            categoryConfidence: 0.85,
            isDuplicate: false,
            selected: true,
            imageMetadata: {
              imageIndex: 0,
              imageId: 'image_0',
              positionInImage: 'bottom',
              confidenceScore: 0.85,
              receiptId: 2
            }
          }
        ],
        multiImageMetadata: {
          totalImages: 1,
          itemsMerged: 0,
          deduplicationMethod: 'ai',
          imageIds: ['image_0']
        }
      };

      history.replaceState({ importResult, fromCamera: true, multiImage: false }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      // ngAfterViewInit defers the handoff population by a macrotask
      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const component = fixture.componentInstance;
      expect(component.stepper.selectedIndex).toBe(2);
      expect(component.receiptsDetectedCount()).toBe(2);

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Coffee Corner');
      expect(text).toContain('Corner Bakery');
      const badges = (fixture.nativeElement as HTMLElement).querySelectorAll('.receipt-badge');
      expect(badges.length).toBe(2);

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );

  it(
    'holds Continue and Import until a receipt dated before today is answered',
    async () => {
      // The gate's whole user-visible surface. The unit spec overrides the
      // template with a bare div, so this is the only place that can say the
      // two buttons are held, that the hint and the confirm card reach a
      // screen, and that answering the date releases both. Confirm is
      // reachable with the question still open because a camera handoff runs
      // the stepper non-linear — which is why Import carries a guard of its
      // own rather than leaning on the review step being incomplete.
      const importResult: ImportResult = {
        source: 'image',
        fileType: 'receipt_image',
        fileName: 'july-receipt.jpg',
        fileSize: 1234,
        confidence: 0.9,
        warnings: [],
        duplicates: [],
        transactions: [
          {
            id: 'r1',
            description: 'Corner Store',
            amount: 12.5,
            currency: 'USD',
            date: new Date('2026-07-01'),
            type: 'expense',
            suggestedCategoryId: 'other_expense',
            categoryConfidence: 0.9,
            isDuplicate: false,
            selected: true
          }
        ]
      };

      history.replaceState({ importResult, fromCamera: true, multiImage: false }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance;
      const continueButton = () =>
        host.querySelector<HTMLButtonElement>('.review-step .action-button')!;
      const importButton = () =>
        host.querySelector<HTMLButtonElement>('.confirm-step .import-button')!;

      expect(component.stepper.selectedIndex).toBe(2);
      expect(continueButton().disabled).toBeTrue();
      expect(host.querySelector('.dates-hint')).not.toBeNull();

      // The stepper header reaches Confirm from here with the question open.
      component.stepper.selectedIndex = 3;
      fixture.detectChanges();
      expect(
        host.querySelector('.confirm-step .dates-card .card-value')?.textContent?.trim()
      ).toBe('1');
      expect(importButton().disabled).toBeTrue();

      component.stepper.selectedIndex = 2;
      fixture.detectChanges();
      host.querySelector<HTMLButtonElement>('.keep-dates')!.click();
      fixture.detectChanges();

      expect(host.querySelector('.dates-hint')).toBeNull();
      expect(continueButton().disabled).toBeFalse();

      component.stepper.selectedIndex = 3;
      fixture.detectChanges();
      expect(host.querySelector('.confirm-step .dates-card')).toBeNull();
      expect(importButton().disabled).toBeFalse();

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );

  it(
    'says on the review step when the reader ran out of room mid-answer',
    async () => {
      // The rows are real and reviewable; what is missing is whatever came
      // after the break. Only this suite renders the actual review step —
      // the unit spec overrides the template with a bare div — so this is
      // the one place that can say the notice reaches a screen (#331).
      const importResult: ImportResult = {
        source: 'image',
        fileType: 'receipt_image',
        fileName: 'long-receipt.jpg',
        fileSize: 2048,
        confidence: 0.9,
        warnings: [{ type: 'parse_error', message: 'ran out of room mid-answer' }],
        duplicates: [],
        transactions: [
          {
            id: 'r1',
            description: 'Corner Store',
            amount: 12.5,
            currency: 'USD',
            date: new Date('2026-07-01'),
            type: 'expense',
            suggestedCategoryId: 'other_expense',
            categoryConfidence: 0.9,
            isDuplicate: false,
            selected: true
          }
        ]
      };

      history.replaceState({ importResult, fromCamera: true, multiImage: true }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(fixture.componentInstance.stepper.selectedIndex).toBe(2);
      expect(host.querySelector('.incomplete-notice')).not.toBeNull();
      // And the row it did read is still there to review.
      expect(host.textContent ?? '').toContain('Corner Store');

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );

  it(
    'imports a receipt at its printed total, not its item sum, into Firestore',
    async () => {
      // Two line items from the same receipt; only the printed grand total
      // (on the last item, matching the AI's own reporting convention) is the
      // number that must land — not 10 + 5.
      const extractedRows: MultiImageExtractedTransaction[] = [
        {
          date: '2026-07-01',
          description: 'Latte',
          amount: 10,
          type: 'expense',
          currency: 'USD',
          imageIndex: 0,
          positionInImage: 'top',
          confidence: 0.9,
          receiptId: 1
        },
        {
          date: '2026-07-01',
          description: 'Muffin',
          amount: 5,
          type: 'expense',
          currency: 'USD',
          imageIndex: 0,
          positionInImage: 'bottom',
          confidence: 0.9,
          receiptId: 1,
          receiptDetails: 'Latte — USD 10.00\nMuffin — USD 5.00\nTotal — USD 16.20',
          receiptTotal: 16.2
        }
      ];

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'answerWasIncomplete',
          'extractTransactionsFromMultipleImages',
          'categorizeTransactions',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.answerWasIncomplete.and.returnValue(false);
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(extractedRows);
      cloudLLMProvider.categorizeTransactions.and.callFake(async raws =>
        raws.map(r => ({ ...r, suggestedCategoryId: 'other_expense', confidence: 0.9 }))
      );
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          // Only the exchange-rate fetch is stubbed out — everything else the
          // import touches (consolidation, categorization fallback, the
          // Firestore writes) runs for real. USD-to-USD never converts, so
          // this cannot mask the amount under test.
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      const result = await importService.importFromMultipleImages([
        new File([new Uint8Array([1])], 'r.jpg', { type: 'image/jpeg' })
      ]);

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].amount).toBe(16.2);
      expect(result.transactions[0].fieldConfidence).toBeUndefined();

      const importHistory = await importService.confirmImport(
        result.transactions,
        'r.jpg',
        1234,
        'image',
        'receipt_image'
      );
      expect(importHistory.successCount).toBe(1);

      const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
      expect(snapshot.docs.length).toBe(1);
      const landed = snapshot.docs[0].data();
      expect(landed['amount']).toBe(16.2);
      expect(landed['currency']).toBe('USD');
    },
    30000
  );

  it(
    'stores a confirmed receipt with its photo and its widened fields under the real rules',
    async () => {
      // The unit suite mocks addTransaction, so nothing there proves the
      // Firestore rules accept a transaction carrying tags, a location map
      // and a period alongside receipt URLs, or that the storage upload
      // actually runs. This does, against the emulators.
      const extractedRows: MultiImageExtractedTransaction[] = [
        {
          date: '2026-07-02',
          description: 'Beans',
          amount: 9.4,
          type: 'expense',
          currency: 'USD',
          imageIndex: 0,
          positionInImage: 'top',
          confidence: 0.9,
          receiptId: 1
        }
      ];

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'answerWasIncomplete',
          'extractTransactionsFromMultipleImages',
          'categorizeTransactions',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.answerWasIncomplete.and.returnValue(false);
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(extractedRows);
      cloudLLMProvider.categorizeTransactions.and.callFake(async raws =>
        raws.map(r => ({ ...r, suggestedCategoryId: 'other_expense', confidence: 0.9 }))
      );
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          },
          // The quota check reads Remote Config, which has no emulator; the
          // storage upload and the rules are what this case is about.
          {
            provide: ReceiptQuotaService,
            useValue: { canAddImages: async () => true, noteImagesAdded: () => undefined }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      const photo = new File([new Uint8Array([1, 2, 3])], 'beans.jpg', { type: 'image/jpeg' });
      const result = await importService.importFromMultipleImages([photo]);
      expect(result.transactions.length).toBe(1);
      expect(result.sourceFiles?.length).toBe(1);

      // What the review step lets the user leave on the row.
      const reviewed = {
        ...result.transactions[0],
        tags: ['coffee'],
        location: { name: 'Coffee Corner' },
        period: 'monthly' as const
      };

      const importHistory = await importService.confirmImport(
        [reviewed],
        'beans.jpg',
        photo.size,
        'image',
        'receipt_image',
        result.sourceFiles
      );

      expect(importHistory.successCount).toBe(1);
      // The read-back is the landed imports document, so this is the record
      // the history page will render.
      expect(importHistory.source).toBe('image');
      expect(importHistory.fileType).toBe('receipt_image');
      expect(importHistory.receiptsSkipped).toBeUndefined();

      const snapshot = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const doc = snapshot.docs.map(d => d.data()).find(d => d['description'] === 'Beans');
      expect(doc).toBeDefined();
      expect(doc!['tags']).toEqual(['coffee']);
      expect(doc!['location']).toEqual({ name: 'Coffee Corner' });
      expect(doc!['period']).toBe('monthly');
      expect(typeof doc!['receiptUrl']).toBe('string');
      expect(doc!['receiptUrl'] as string).toMatch(/^https?:\/\//);
      expect((doc!['receiptUrls'] as string[]).length).toBe(1);
      expect(doc!['receiptCount']).toBe(1);
    },
    30000
  );

  it(
    "stores a row's printed location, vocabulary-checked tags and accepted rule link under the real rules",
    async () => {
      // The three fields the review step now suggests, each proved by the
      // stored document rather than by what the service returned: a location
      // the receipt printed, tags checked against this account's vocabulary,
      // and a link to the recurring rule the row was offered and the user
      // accepted. The unit suites mock addTransaction, so none of them can
      // tell an accepted field from one the rules reject.
      const ruleId = 'smoke-suggested-rule';

      // RAG on, so GroundingHistoryService reads the recent window and the
      // model rung of the tag ladder is reachable at all. Base currency stays
      // USD, so no conversion sits between the receipt and the document.
      mockAuth.setMockUser(
        createMockUser(uid, {
          preferences: { ...DEFAULT_USER_PREFERENCES, ragInsightsLevel: 'standard' }
        })
      );

      // The vocabulary a suggestion has to come from: one transaction this
      // account already tagged. Dated well outside the duplicate window, and
      // at an amount no row here shares, so it can never read as a match.
      const tagged = new Date();
      tagged.setDate(tagged.getDate() - 30);
      await setDoc(doc(firestore, `users/${uid}/transactions/smoke-suggested-history`), {
        userId: uid,
        type: 'expense',
        amount: 3.5,
        currency: 'USD',
        amountInBaseCurrency: 3.5,
        exchangeRate: 1,
        categoryId: 'other_expense',
        description: 'Morning cup',
        date: Timestamp.fromDate(tagged),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isRecurring: false,
        tags: ['coffee']
      });

      // The active rule the row should be offered. listAll() enumerates the
      // collection, so seeding it with the raw SDK is all RecurringService
      // needs — no service call, and no scheduler run behind it.
      await setDoc(doc(firestore, `users/${uid}/recurring/${ruleId}`), {
        userId: uid,
        name: 'Beans',
        type: 'expense',
        amount: 9.4,
        currency: 'USD',
        categoryId: 'food_dining',
        description: 'Monthly beans',
        frequency: { type: 'monthly', interval: 1 },
        startDate: Timestamp.now(),
        nextOccurrence: Timestamp.now(),
        isActive: true
      });

      // The case above confirmed a row for this same merchant, which left its
      // tags in the memory. Memory answers before the model does, so the rung
      // under test is only reachable from an empty entry.
      await deleteDoc(doc(firestore, `users/${uid}/tagMemory/beans`));

      const extractedRows: MultiImageExtractedTransaction[] = [
        {
          date: '2026-08-05',
          description: 'Beans',
          merchant: 'Beans',
          amount: 9.4,
          type: 'expense',
          currency: 'USD',
          // The post-parse slot: the printed address is read into a location
          // inside the provider, which is what is stubbed out here.
          location: { name: '渋谷店 1-2-3' },
          imageIndex: 0,
          positionInImage: 'top',
          confidence: 0.9,
          receiptId: 1
        }
      ];

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'answerWasIncomplete',
          'extractTransactionsFromMultipleImages',
          'categorizeTransactions',
          'suggestTags',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.answerWasIncomplete.and.returnValue(false);
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(extractedRows);
      cloudLLMProvider.categorizeTransactions.and.callFake(async raws =>
        raws.map(r => ({ ...r, suggestedCategoryId: 'other_expense', confidence: 0.9 }))
      );
      // One tag this account uses and one the model invented. The adapter's
      // own vocabulary check is stubbed out along with the provider, so the
      // filter that has to drop 'invented' is the service's own.
      cloudLLMProvider.suggestTags.and.resolveTo([['coffee', 'invented']]);
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      // The rows already stored — earlier cases wrote some, and one of them
      // wrote a 'Beans' too — so the confirm's own document can be told apart
      // from them by id rather than by a field this case is here to check.
      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      const result = await importService.importFromMultipleImages([
        new File([new Uint8Array([1, 2, 3])], 'beans.jpg', { type: 'image/jpeg' })
      ]);

      expect(result.transactions.length).toBe(1);
      const offered = result.transactions[0];
      expect(offered.location).toEqual({ name: '渋谷店 1-2-3' });
      expect(cloudLLMProvider.suggestTags).toHaveBeenCalled();
      expect(offered.tags).toEqual(['coffee']);
      expect(offered.recurringMatch?.name).toBe('Beans');
      // Offered, never assumed: linking a row to a rule is a write, and the
      // review card leaves that decision to the user.
      expect(offered.recurringId).toBeUndefined();
      expect(offered.selected).toBeTrue();

      // The row as the review card hands it back once the link is accepted.
      const reviewed = {
        ...offered,
        recurringId: offered.recurringMatch!.id,
        isRecurring: true
      };

      const importHistory = await importService.confirmImport(
        [reviewed],
        'beans.jpg',
        1234,
        'image',
        'receipt_image'
      );
      expect(importHistory.successCount).toBe(1);

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const landed = after.docs.filter(d => !before.has(d.id));
      expect(landed.length).toBe(1);
      const stored = landed[0].data();
      expect(stored['description']).toBe('Beans');
      expect(stored['location']).toEqual({ name: '渋谷店 1-2-3' });
      expect(stored['tags']).toEqual(['coffee']);
      expect(stored['recurringId']).toBe(ruleId);
      expect(stored['isRecurring']).toBeTrue();

      // What the confirm remembered about the merchant, read back through the
      // rules that had to accept it: tagMemoryValid pins every key and type.
      const memory =
        (await getDoc(doc(firestore, `users/${uid}/tagMemory/beans`))).data() ?? {};
      expect(memory['tags']).toEqual(['coffee']);
      expect(memory['suppressed']).toEqual([]);
      expect(memory['count']).toBe(1);
    },
    30000
  );

  it(
    'a doubted scan date reaches the review step marked and is stored dated today',
    async () => {
      // The single-receipt door: importFromImage routes through
      // AIStrategyService, which has no native engine on this platform, so
      // it lands on parseReceipt — the one producer that already reports a
      // dateConfidence today (readFieldConfidence). Task 3, not this one,
      // teaches a producer to zero it out on a date it had to invent.
      const parsedReceipt: ParsedReceipt = {
        merchant: 'Doubtful Diner',
        amount: 12.5,
        currency: 'USD',
        date: new Date(2026, 5, 1),
        suggestedCategory: 'other_expense',
        confidence: 0.9,
        fieldConfidence: { date: 0.3 }
      };

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'parseReceipt',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.parseReceipt.and.resolveTo(parsedReceipt);
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      // Earlier cases in this file already wrote rows of their own, so the
      // confirm below is told apart by id rather than by count or field.
      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      // Real clock: mocking it here would desync the Firebase SDK's own
      // timers, so "today" is read back against the wall clock instead.
      const testStart = Date.now();

      const result = await importService.importFromImage(
        new File([new Uint8Array([1])], 'diner.jpg', { type: 'image/jpeg' })
      );

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].dateAssumed).toBeTrue();

      const importHistory = await importService.confirmImport(
        result.transactions,
        'diner.jpg',
        1234,
        'image',
        'receipt_image'
      );
      expect(importHistory.successCount).toBe(1);

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const landed = after.docs.filter(d => !before.has(d.id));
      expect(landed.length).toBe(1);
      const stored = landed[0].data();
      expect((stored['date'] as Timestamp).toMillis()).toBeGreaterThanOrEqual(testStart);
    },
    30000
  );

  it(
    'a confidently graded absurd date reaches the review step marked and is stored dated today',
    async () => {
      // Same single-receipt door as the doubted-date case above, but graded
      // 0.9 — clear of the verify threshold, so needsVerification would stay
      // quiet. The plausibility window, not the confidence check, is what
      // has to catch this one. The amount is deliberately unlike any other
      // fixture in this file: both this row and the doubted-date row above
      // land dated "today" against the real wall clock, and a shared amount
      // would trip duplicate detection's same-day-same-amount match.
      const today = new Date();
      const farFutureDate = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate());
      const parsedReceipt: ParsedReceipt = {
        merchant: 'Time Traveler Diner',
        amount: 61.3,
        currency: 'USD',
        date: farFutureDate,
        suggestedCategory: 'other_expense',
        confidence: 0.9,
        fieldConfidence: { date: 0.9 }
      };

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'parseReceipt',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.parseReceipt.and.resolveTo(parsedReceipt);
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      // Earlier cases in this file already wrote rows of their own, so the
      // confirm below is told apart by id rather than by count or field.
      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      // Real clock: mocking it here would desync the Firebase SDK's own
      // timers, so "today" is read back against the wall clock instead.
      const testStart = Date.now();

      const result = await importService.importFromImage(
        new File([new Uint8Array([1])], 'timetravel.jpg', { type: 'image/jpeg' })
      );

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].dateAssumed).toBeTrue();
      expect(result.transactions[0].dateImplausible).toBeTrue();

      const importHistory = await importService.confirmImport(
        result.transactions,
        'timetravel.jpg',
        1234,
        'image',
        'receipt_image'
      );
      expect(importHistory.successCount).toBe(1);

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const landed = after.docs.filter(d => !before.has(d.id));
      expect(landed.length).toBe(1);
      const stored = landed[0].data();
      expect((stored['date'] as Timestamp).toMillis()).toBeGreaterThanOrEqual(testStart);
    },
    30000
  );

  it(
    'the completed record names the transactions it created',
    async () => {
      // Only the real confirmImport path can prove this: the unit suite
      // mocks addTransaction and can only assert what the service *passes*
      // to it, never the id a real write returns or that the rules accept
      // it back on the completed record.
      const extractedRows: MultiImageExtractedTransaction[] = [
        {
          date: '2026-07-03',
          description: 'Newsstand',
          amount: 4.5,
          type: 'expense',
          currency: 'USD',
          imageIndex: 0,
          positionInImage: 'top',
          confidence: 0.9,
          receiptId: 1
        }
      ];

      const cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService> = jasmine.createSpyObj(
        'CloudLLMProviderService',
        [
          'hasAnyCloudProvider',
          'answerWasIncomplete',
          'extractTransactionsFromMultipleImages',
          'categorizeTransactions',
          'initializeProviders',
          'resetProviders',
          'setOpenAIModel',
          'setClaudeModel',
          'availableProviders',
          'providerStatus',
          'resolveProvider'
        ]
      );
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
      cloudLLMProvider.answerWasIncomplete.and.returnValue(false);
      cloudLLMProvider.extractTransactionsFromMultipleImages.and.resolveTo(extractedRows);
      cloudLLMProvider.categorizeTransactions.and.callFake(async raws =>
        raws.map(r => ({ ...r, suggestedCategoryId: 'other_expense', confidence: 0.9 }))
      );
      cloudLLMProvider.initializeProviders.and.resolveTo(undefined);
      cloudLLMProvider.resetProviders.and.resolveTo(undefined);
      cloudLLMProvider.availableProviders.and.returnValue([]);
      cloudLLMProvider.providerStatus.and.returnValue({
        gemini: false,
        openai: false,
        claude: false
      });
      cloudLLMProvider.resolveProvider.and.returnValue(null);

      const pwa: jasmine.SpyObj<PwaService> = jasmine.createSpyObj('PwaService', [
        'isOnline',
        'registerBackgroundSync'
      ]);
      pwa.isOnline.and.returnValue(true);
      pwa.registerBackgroundSync.and.resolveTo(true);

      const analytics: jasmine.SpyObj<AnalyticsService> = jasmine.createSpyObj(
        'AnalyticsService',
        ['trackAiAssistUsed']
      );

      TestBed.configureTestingModule({
        providers: [
          { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
          { provide: PwaService, useValue: pwa },
          { provide: AnalyticsService, useValue: analytics },
          {
            provide: CurrencyService,
            useValue: { getExchangeRate: () => 1, ensureRatesLoaded: () => Promise.resolve() }
          }
        ],
        teardown: { destroyAfterEach: false }
      });

      const importService = TestBed.inject(AIImportService);
      // Earlier cases in this file already wrote rows of their own, so the
      // ids this confirm creates are told apart by set difference.
      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      const result = await importService.importFromMultipleImages([
        new File([new Uint8Array([1])], 'newsstand.jpg', { type: 'image/jpeg' })
      ]);
      expect(result.transactions.length).toBe(1);

      const importHistory = await importService.confirmImport(
        result.transactions,
        'newsstand.jpg',
        1234,
        'image',
        'receipt_image'
      );
      expect(importHistory.successCount).toBe(1);

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const createdIds = after.docs.map(d => d.id).filter(id => !before.has(id));

      expect(importHistory.transactionIds).toEqual(createdIds);
      expect(importHistory.transactionIds?.length).toBe(importHistory.successCount);
    },
    30000
  );

  it(
    'a receipt dated before today waits for its own answer, and the kept date is what is stored',
    async () => {
      // The gate case above hands over a result built by hand, answers the
      // batch with the header's bulk Keep and never confirms. This one runs
      // the real extraction, answers the one row on its own chip, and presses
      // the wizard's own Import: what it adds is the per-row half of the
      // question — the marked date button, the chip whose Keep settles a
      // single receipt — and the document that comes out the far end still
      // dated the day the receipt was printed, not the day it was scanned.
      stubReceiptSeams({
        merchant: 'セブン-イレブン',
        amount: 538,
        currency: 'JPY',
        date: new Date(2026, 7, 14),
        suggestedCategory: 'other_expense',
        confidence: 0.9,
        fieldConfidence: { amount: 0.9, date: 0.9 }
      });

      const importService = TestBed.inject(AIImportService);
      // The wizard's own confirm ends in router.navigate, and provideRouter([])
      // has nowhere to send it.
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      // Earlier cases in this file already wrote rows of their own, so this
      // confirm's document is told apart by id.
      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      const result = await importService.importFromImage(
        new File([new Uint8Array([1])], 'seven.jpg', { type: 'image/jpeg' })
      );

      expect(result.transactions.length).toBe(1);
      // Read clearly, off a real day: nothing was assumed, and the merchant is
      // what the row is called — parseReceipt reports no description of its own.
      expect(result.transactions[0].dateAssumed).toBeUndefined();
      expect(result.transactions[0].description).toBe('セブン-イレブン');

      history.replaceState({ importResult: result, fromCamera: true, multiImage: false }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance;
      expect(component.stepper.selectedIndex).toBe(2);
      expect(host.querySelector('.date-chip.not-today')).not.toBeNull();

      const keep = host.querySelector<HTMLButtonElement>('.extra-chip.date-check .extra-accept');
      expect(keep).withContext('the row carries its own Keep, not just the batch one').not.toBeNull();
      keep!.click();
      fixture.detectChanges();

      expect(host.querySelector('.extra-chip.date-check')).toBeNull();
      expect(host.querySelector('.date-chip.not-today')).toBeNull();
      expect(component.unansweredDates()).toBe(0);
      expect(
        host.querySelector<HTMLButtonElement>('.review-step .action-button')!.disabled
      ).toBeFalse();

      await component.confirmImport();

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const landed = after.docs.filter(d => !before.has(d.id));
      expect(landed.length).toBe(1);
      const stored = landed[0].data();
      expect((stored['date'] as Timestamp).toMillis())
        .toBe(parseDateInput('2026-08-14')!.getTime());
      expect(stored['amount']).toBe(538);
      expect(stored['currency']).toBe('JPY');
      // The review's own bookkeeping stays on the review step.
      expect('dateReviewed' in stored).toBeFalse();
      expect('dateAssumed' in stored).toBeFalse();
      expect('fieldConfidence' in stored).toBeFalse();

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );

  it(
    'a date, an amount and a description corrected on the review card are what the import writes',
    async () => {
      // The row arrives with nothing readable where the date was and a graded
      // amount — the state a reviewer corrects from. The card's own suite
      // drives these three editors against a stubbed parent and can only say
      // what the card emitted; only here do the corrections travel through the
      // wizard's confirm into a document written under the real rules.
      stubReceiptSeams({
        merchant: 'セブン-イレブン',
        amount: 539,
        currency: 'JPY',
        date: new Date(NaN),
        suggestedCategory: 'other_expense',
        confidence: 0.9,
        fieldConfidence: { amount: 0.5, date: 0 }
      });

      const importService = TestBed.inject(AIImportService);
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

      const before = new Set(
        (await getDocs(collection(firestore, `users/${uid}/transactions`))).docs.map(d => d.id)
      );

      const result = await importService.importFromImage(
        new File([new Uint8Array([1])], 'dogenzaka.jpg', { type: 'image/jpeg' })
      );

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].dateAssumed).toBeTrue();

      history.replaceState({ importResult: result, fromCamera: true, multiImage: false }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance;
      const card = fixture.debugElement.query(By.directive(TransactionPreviewTableComponent))
        .componentInstance as TransactionPreviewTableComponent;
      // Every editor replaces the row it edits, so the object to hand the next
      // one is read again each time.
      const row = () => card.transactions[0];

      expect(host.querySelector('.amount-section .verify-flag'))
        .withContext('the figure was graded under the bar').not.toBeNull();

      card.updateDate(row(), new Date(2026, 7, 14));
      fixture.detectChanges();

      card.startEdit(row(), 'description');
      fixture.detectChanges();
      const description = host.querySelector<HTMLInputElement>('.description-input')!;
      description.value = 'Seven-Eleven Dogenzaka';
      description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      card.startEdit(row(), 'amount');
      fixture.detectChanges();
      const amount = host.querySelector<HTMLInputElement>('.amount-input')!;
      amount.value = '540';
      amount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      // All three are detection inputs, so re-checks are in flight behind
      // these assertions. Import waits on them; so does this, because a
      // verdict landing mid-confirm would rewrite the rows being submitted.
      await until(fixture, () => component.rechecksInFlight() === 0);

      const reviewed = component.extractedTransactions()[0];
      expect(reviewed.date.getTime()).toBe(parseDateInput('2026-08-14')!.getTime());
      expect(reviewed.description).toBe('Seven-Eleven Dogenzaka');
      expect(reviewed.amount).toBe(540);
      expect(component.unansweredDates()).toBe(0);
      expect(host.querySelector('.amount-section .verify-flag'))
        .withContext('a hand-typed figure settles the grade').toBeNull();
      expect(
        host.querySelector<HTMLButtonElement>('.review-step .action-button')!.disabled
      ).toBeFalse();

      await component.confirmImport();

      const after = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const landed = after.docs.filter(d => !before.has(d.id));
      expect(landed.length).toBe(1);
      const stored = landed[0].data();
      expect((stored['date'] as Timestamp).toMillis())
        .toBe(parseDateInput('2026-08-14')!.getTime());
      expect(stored['description']).toBe('Seven-Eleven Dogenzaka');
      expect(stored['amount']).toBe(540);
      expect('fieldConfidence' in stored).toBeFalse();

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );

  it(
    'a corrected date is checked against the ledger again, and a verdict can be overruled',
    async () => {
      // The re-check with a real ledger behind it. The wizard's unit suite
      // stubs DuplicateDetectionService, so nothing there can say that a
      // corrected date finds a document the first check's window never
      // covered, that the badge and the panel follow the verdict onto a
      // screen, or that an overrule survives the re-check the next correction
      // starts. Nothing is confirmed here — the seeded row is the ledger, and
      // it is removed again at the end.
      const seeded = await addDoc(collection(firestore, `users/${uid}/transactions`), {
        userId: uid,
        type: 'expense',
        amount: 541,
        currency: 'JPY',
        // The rules require both. Nothing here converts, so the base figure is
        // the printed one.
        amountInBaseCurrency: 541,
        exchangeRate: 1,
        categoryId: 'other_expense',
        description: 'セブン-イレブン',
        date: Timestamp.fromDate(new Date(2026, 7, 14)),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isRecurring: false
      });

      stubReceiptSeams({
        merchant: 'セブン-イレブン',
        amount: 541,
        currency: 'JPY',
        date: new Date(NaN),
        suggestedCategory: 'other_expense',
        confidence: 0.9,
        fieldConfidence: { date: 0 }
      });

      const importService = TestBed.inject(AIImportService);
      // The real service, watched rather than replaced: its call count is how
      // the waits below know a re-check ran at all — including the last one,
      // whose answer is "no longer a duplicate" and changes nothing on screen.
      const checkDuplicates = spyOn(
        TestBed.inject(DuplicateDetectionService), 'checkDuplicates'
      ).and.callThrough();

      const result = await importService.importFromImage(
        new File([new Uint8Array([1])], 'recheck.jpg', { type: 'image/jpeg' })
      );

      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].dateAssumed).toBeTrue();
      expect(result.transactions[0].isDuplicate).toBeFalse();

      history.replaceState({ importResult: result, fromCamera: true, multiImage: false }, '');
      const fixture = TestBed.createComponent(ImportWizardComponent);
      fixture.detectChanges();

      await new Promise(resolve => setTimeout(resolve, 100));
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const component = fixture.componentInstance;
      const card = fixture.debugElement.query(By.directive(TransactionPreviewTableComponent))
        .componentInstance as TransactionPreviewTableComponent;
      const row = () => card.transactions[0];

      // Assumed onto today, the row was checked against a window the seeded
      // document sits weeks outside of.
      expect(component.duplicateInfos().length).toBe(0);
      expect(host.querySelector('.duplicate-badge')).toBeNull();

      card.updateDate(row(), new Date(2026, 7, 14));
      fixture.detectChanges();
      await until(fixture, () => component.duplicateInfos().length === 1);

      expect(host.querySelector('app-duplicate-warning')).not.toBeNull();
      expect(host.querySelector('.duplicate-badge')).not.toBeNull();
      expect(row().selected).withContext('the verdict deselects the row').toBeFalse();

      host.querySelector<HTMLButtonElement>('.duplicate-clear')!.click();
      fixture.detectChanges();

      expect(component.duplicateInfos().length).toBe(0);
      expect(host.querySelector('app-duplicate-warning')).toBeNull();
      expect(host.querySelector('.duplicate-badge')).toBeNull();
      expect(row().selected).withContext('the overrule selects it again').toBeTrue();

      const checksBefore = checkDuplicates.calls.count();
      card.startEdit(row(), 'amount');
      fixture.detectChanges();
      const amount = host.querySelector<HTMLInputElement>('.amount-input')!;
      amount.value = '542';
      amount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      await until(
        fixture,
        () => checkDuplicates.calls.count() > checksBefore && component.rechecksInFlight() === 0
      );

      // Nothing in the ledger is dated that day at that figure, so the row the
      // reviewer cleared is not put back under the badge by their own edit.
      expect(row().amount).toBe(542);
      expect(component.duplicateInfos().length).toBe(0);
      expect(host.querySelector('.duplicate-badge')).toBeNull();
      expect(row().selected).toBeTrue();

      await deleteDoc(seeded);

      history.replaceState({}, '');
      fixture.destroy();
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );
});
