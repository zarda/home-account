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
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import { ReceiptQuotaService } from '../../../../core/services/receipt-quota.service';
import { MultiImageExtractedTransaction, ParsedReceipt } from '../../../../core/services/gemini.service';
import { DEFAULT_USER_PREFERENCES, ImportResult } from '../../../../models';
import { silenceFirebaseWarnings } from '../../../../core/services/testing/silence-firebase-warnings';

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();

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
});
