// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages). @angular/fire bundles its own pinned Firebase major, so instances
// built from the root packages are incompatible with the service layer.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore, connectFirestoreEmulator, Firestore, doc, setDoc,
} from '@angular/fire/firestore';

import { NativeReceiptService } from './native-receipt.service';
import { VisionOcrService } from './vision-ocr.service';
import { AppleIntelligenceService } from './apple-intelligence.service';
import { CategoryService } from './category.service';
import { AuthService } from './auth.service';
import { VisionOCRResult } from '../plugins/vision-ocr.plugin';
import {
  gradeCategorySuggestion,
  FALLBACK_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_CONFIDENCE,
  UNRESOLVED_CATEGORY_CONFIDENCE,
} from '../utils/categorization.utils';
import { silenceFirebaseWarnings } from './testing/silence-firebase-warnings';
silenceFirebaseWarnings();

/**
 * The on-device category seam against the catalog the app actually builds.
 *
 * The unit spec hands NativeReceiptService a hand-written `categories` signal,
 * and that is precisely how the raw-i18n-key payload stayed green through
 * #270: a fixture can assert a world that does not exist. The live catalog is
 * not a literal — it is `CategoryService.loadCategories()` merging in-code
 * defaults with the account's own category documents read from Firestore,
 * where a user-created entry appears under its own id and a "deleted" default
 * is a stored override with `isActive: false`. Neither shape is reachable
 * without Firestore and a signed-in user, so neither is exercised anywhere
 * else.
 *
 * What is asserted is the whole seam over that catalog: what the matcher
 * resolves, and what the import grade the row carries into the review table
 * therefore becomes. The grading itself is pure arithmetic and is unit-tested
 * in categorization.utils.spec.ts; what needs the emulator is the input it is
 * keyed on.
 *
 * The two Capacitor bridges are the only doubles: Vision OCR and the
 * foundation model do not exist in a browser, so what the model "answered" is
 * this suite's input and everything downstream of it is real.
 *
 * Runs only under the emulators:
 *   npm run smoke
 * (CI wraps it with `firebase emulators:exec --only auth,storage,firestore`.)
 */
describe('on-device receipt categories over the live catalog (smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  // A category the user made up: no i18n key, a name only this account knows.
  const CUSTOM_ID = 'custom_boat_maintenance';
  const CUSTOM_NAME = 'Boat Maintenance';
  // A built-in the user deleted. Stored as an override of the default id, so
  // it stays in the merged list with isActive false — offering it back, or
  // resolving an answer onto it, would resurrect a category the user removed.
  const DELETED_ID = 'food_restaurants';
  const DELETED_NAME = 'Restaurants';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;

  let service: NativeReceiptService;
  let visionMock: jasmine.SpyObj<VisionOcrService>;
  let appleMock: jasmine.SpyObj<AppleIntelligenceService>;

  const ocrResult: VisionOCRResult = {
    text: 'Harbour Supplies\n01/15/2026\nTotal: $120.50',
    blocks: [],
    confidence: 0.9,
    blockCount: 3,
  };

  const imageFile = () => new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });

  /** Run a scan whose foundation-model answer names `category`. */
  const scanAnswering = async (category: string) => {
    appleMock.isModelAvailable.and.returnValue(true);
    appleMock.parseReceiptText.and.resolveTo({
      merchant: 'Harbour Supplies', date: '2026-01-15',
      amount: 120.5, currency: 'USD', category, details: '',
    });
    return (await service.processImage(imageFile())).transactions[0];
  };

  beforeAll(async () => {
    app = initializeApp(
      { apiKey: 'fake-api-key', projectId: 'demo-home-account' },
      `native-receipt-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    uid = (await signInAnonymously(auth)).user.uid;

    const categoryDoc = (id: string) => doc(firestore, `users/${uid}/categories/${id}`);
    await setDoc(categoryDoc(CUSTOM_ID), {
      id: CUSTOM_ID, userId: uid, name: CUSTOM_NAME, icon: 'sailing',
      color: '#0277bd', type: 'expense', order: 900, isActive: true, isDefault: false,
    });
    await setDoc(categoryDoc(DELETED_ID), {
      id: DELETED_ID, userId: uid, name: 'categoryNames.restaurants', icon: 'restaurant',
      color: '#e64a19', type: 'expense', order: 12, isActive: false, isDefault: true,
    });
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    visionMock = jasmine.createSpyObj('VisionOcrService', [
      'detectEnvironment', 'isAvailable', 'recognizeText', 'isMacEnvironment',
    ]);
    visionMock.isAvailable.and.resolveTo({ available: true });
    visionMock.recognizeText.and.resolveTo(ocrResult);

    appleMock = jasmine.createSpyObj('AppleIntelligenceService', [
      'detectAvailability', 'isModelAvailable', 'parseReceiptText',
    ]);
    appleMock.isModelAvailable.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: Firestore, useValue: firestore },
        { provide: Auth, useValue: auth },
        {
          // The real AuthService owns the sign-in flow; this suite has already
          // signed in. Everything else in the chain is real.
          provide: AuthService,
          useValue: { userId: () => uid, currentUser: () => null },
        },
        { provide: VisionOcrService, useValue: visionMock },
        { provide: AppleIntelligenceService, useValue: appleMock },
      ],
    });

    // Populate the catalog signal the way the app does, from Firestore.
    await firstValueFrom(TestBed.inject(CategoryService).loadCategories());
    service = TestBed.inject(NativeReceiptService);
  });

  it('merges the account categories from Firestore into the catalog the matcher sees', () => {
    const categories = TestBed.inject(CategoryService).categories();

    // The merge actually happened: defaults are present, and so is a category
    // that exists only in this account's Firestore documents.
    expect(categories.length).toBeGreaterThan(1);
    expect(categories.find(c => c.id === CUSTOM_ID)?.name).toBe(CUSTOM_NAME);
    expect(categories.find(c => c.id === DELETED_ID)?.isActive).toBeFalse();
  });

  it('resolves a category that exists only in this account, and keeps its extraction grade', async () => {
    const transaction = await scanAnswering(CUSTOM_NAME);

    expect(transaction.suggestedCategoryId).toBe(CUSTOM_ID);
    expect(gradeCategorySuggestion(transaction)).toEqual({
      suggestedCategoryId: CUSTOM_ID,
      categoryConfidence: ocrResult.confidence,
    });
  });

  /**
   * The catalog is where this has to be checked. A deleted built-in is not
   * absent from it — it is a stored override with isActive false, a shape only
   * the Firestore merge produces — and the model can name it without ever
   * having been offered it, which is exactly what the locale and keyword
   * passes exist to catch.
   */
  it('does not file a receipt under a category this account deleted', async () => {
    const transaction = await scanAnswering(DELETED_NAME);

    expect(transaction.suggestedCategoryId).toBeUndefined();
    expect(gradeCategorySuggestion(transaction)).toEqual({
      suggestedCategoryId: FALLBACK_CATEGORY_ID,
      categoryConfidence: UNRESOLVED_CATEGORY_CONFIDENCE,
    });
  });

  it('does not reach a deleted category through the keyword map either', async () => {
    // "restaurant" is one of the compiled-in keywords, and it maps to the id
    // this account removed.
    const transaction = await scanAnswering('a restaurant downtown');

    expect(transaction.suggestedCategoryId).toBeUndefined();
    expect(gradeCategorySuggestion(transaction).categoryConfidence)
      .toBe(UNRESOLVED_CATEGORY_CONFIDENCE);
  });

  it('offers this account own category to the model and never the deleted one', async () => {
    await scanAnswering(CUSTOM_NAME);

    const sent = appleMock.parseReceiptText.calls.mostRecent().args[0].categories ?? [];
    // Both facts come from the Firestore merge rather than the in-code
    // defaults: an id that exists only in this account is offered, and a
    // default the account overrode as inactive is filtered out of the
    // vocabulary. Whether stored names are rendered as i18n keys is a
    // translation concern the unit spec pins with a stubbed t() — the Karma
    // builder serves only public/, so no locale bundle is loadable here.
    expect(sent.some(line => line.startsWith(`${CUSTOM_ID}:`))).toBeTrue();
    expect(sent.filter(line => line.startsWith(`${DELETED_ID}:`))).toEqual([]);
  });

  it('grades an answer the live catalog cannot place for review, not by how well Vision read', async () => {
    const transaction = await scanAnswering('Antimatter Containment');

    expect(transaction.suggestedCategoryId).toBeUndefined();
    // The number that used to colour the chip is still on the row, untouched:
    // it is what the strategy layer routes on, and it is not a category grade.
    expect(transaction.confidence).toBe(ocrResult.confidence);
    expect(gradeCategorySuggestion(transaction).categoryConfidence)
      .toBe(UNRESOLVED_CATEGORY_CONFIDENCE);
  });

  it('grades a scan nothing categorized at the floor, below an answer that resolved to nothing', async () => {
    // No foundation model on this device: the regex reader handles the scan,
    // and it never looks at what was bought. This is every scan on an iOS
    // device without Apple Intelligence.
    appleMock.isModelAvailable.and.returnValue(false);

    const transaction = (await service.processImage(imageFile())).transactions[0];

    expect(appleMock.parseReceiptText).not.toHaveBeenCalled();
    expect(transaction.categoryAttempted).toBeFalse();
    expect(gradeCategorySuggestion(transaction)).toEqual({
      suggestedCategoryId: FALLBACK_CATEGORY_ID,
      categoryConfidence: UNCATEGORIZED_CATEGORY_CONFIDENCE,
    });
    expect(UNCATEGORIZED_CATEGORY_CONFIDENCE).toBeLessThan(UNRESOLVED_CATEGORY_CONFIDENCE);
  });

  it('a receipt whose text carries no readable date comes back with fieldConfidence.date 0', async () => {
    // Same no-model regex path as above, but the OCR text carries no date
    // line at all for the reader to grade.
    appleMock.isModelAvailable.and.returnValue(false);
    visionMock.recognizeText.and.resolveTo({
      ...ocrResult,
      text: 'Harbour Supplies\nTotal: $120.50',
    });

    const transaction = (await service.processImage(imageFile())).transactions[0];

    expect(transaction.fieldConfidence?.date).toBe(0);
  });
});
