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
  getDocs,
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
import { MultiImageExtractedTransaction } from '../../../../core/services/gemini.service';
import { ImportResult } from '../../../../models';

jasmine.getEnv().configure({ random: false });

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
});
