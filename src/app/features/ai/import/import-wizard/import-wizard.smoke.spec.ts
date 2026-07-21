// Wizard review smoke test: proves that a camera/scan handoff arriving via
// router state renders the review step with per-receipt labels — the full
// wizard template, real Material stepper, and real Firestore-backed
// category loading against the emulators. No AI provider exists here; the
// handoff payload is built directly, exactly as the capture dialog and the
// form's multi-receipt chooser hand it over.
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
  Firestore
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { ImportWizardComponent } from './import-wizard.component';
import { AuthService } from '../../../../core/services/auth.service';
import { MockAuthService, createMockUser } from '../../../../core/services/testing';
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
      await deleteApp(app);
      await new Promise(resolve => setTimeout(resolve, 300));
    },
    30000
  );
});
