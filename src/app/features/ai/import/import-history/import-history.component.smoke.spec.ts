// Import-history shortcut smoke test: proves the three-way branch (nothing /
// direct button / positional menu) against records that actually round-
// tripped through Firestore, not the hand-built fixture the unit spec
// constructs. Two things only this file can show: that a raw setDoc missing
// `transactionIds` — the shape of every record written before this field
// existed — passes the real import-history rules and renders no shortcut at
// all, and that the ids the Router receives are the ones a real
// subscribeToCollection mapping actually attached, not just an array literal
// a mock handed back. The unit spec overrides nothing here — ImportHistory-
// Component's own template and its own MatMenuModule import are what render.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npx firebase emulators:exec --only auth,storage,firestore --project demo-home-account "npx ng test --watch=false --browsers=ChromeHeadless --include='**/import-history.component.smoke.spec.ts'"
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, EMPTY } from 'rxjs';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { ImportHistoryComponent } from './import-history.component';
import { AuthService } from '../../../../core/services/auth.service';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ImportHistory } from '../../../../models';

jasmine.getEnv().configure({ random: false });

describe('ImportHistoryComponent transaction shortcut (emulator smoke test)', () => {
  const FIRESTORE_HOST = '127.0.0.1';
  const FIRESTORE_PORT = 8080;
  const AUTH_URL = 'http://127.0.0.1:9099';

  let app: FirebaseApp;
  let auth: Auth;
  let firestore: Firestore;
  let uid: string;
  let fixture: ComponentFixture<ImportHistoryComponent>;
  let router: jasmine.SpyObj<Router>;

  beforeAll(async () => {
    app = initializeApp(
      {
        apiKey: 'fake-api-key',
        projectId: 'demo-home-account'
      },
      `import-history-shortcut-smoke-${Date.now()}`
    );

    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });

    firestore = getFirestore(app);
    connectFirestoreEmulator(firestore, FIRESTORE_HOST, FIRESTORE_PORT);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    // Seeded with the raw SDK under the real import-history rules (they
    // validate userId/importedAt/source/fileType/fileName/status on create,
    // and accept transactionIds only as a list when present) — no
    // ImportHistoryService call, no AI provider, no confirmImport run behind
    // it. Three distinct fileNames so each test can find its own card
    // without depending on query order.
    const legacy: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'csv',
      fileType: 'generic_csv',
      fileName: 'smoke-legacy-statement.csv',
      fileSize: 2048,
      transactionCount: 4,
      successCount: 4,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 200,
      duplicatesSkipped: 0,
      status: 'completed'
      // transactionIds intentionally absent: the shape of every record
      // written before the field existed.
    };
    const single: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'smoke-single-receipt.jpg',
      fileSize: 51200,
      transactionCount: 1,
      successCount: 1,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 12.5,
      duplicatesSkipped: 0,
      status: 'completed',
      transactionIds: ['smoke-shortcut-single']
    };
    const batch: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'smoke-batch-receipts.jpg',
      fileSize: 153600,
      transactionCount: 3,
      successCount: 3,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 45,
      duplicatesSkipped: 0,
      status: 'completed',
      transactionIds: ['smoke-shortcut-a', 'smoke-shortcut-b', 'smoke-shortcut-c']
    };

    await Promise.all([
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-legacy`), legacy),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-single`), single),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-batch`), batch)
    ]);
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [ImportHistoryComponent],
      providers: [
        provideNoopAnimations(),
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        { provide: TranslationService, useValue: translation },
        { provide: LocaleFormatService, useValue: { locale: 'en-US', formatDate: () => '' } },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ImportHistoryComponent);
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

  function cardFor(fileName: string): HTMLElement {
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.history-item')) as HTMLElement[];
    const found = cards.find(card => (card.textContent ?? '').includes(fileName));
    if (!found) throw new Error(`no rendered card for ${fileName}`);
    return found;
  }

  it('a legacy record renders no shortcut', async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 3,
      'all three seeded records');

    const card = cardFor('smoke-legacy-statement.csv');
    // Delete is always there; a legacy record with no transactionIds joins
    // it with nothing else.
    expect(card.querySelectorAll('mat-card-actions button').length).toBe(1);
  }, 20000);

  it("a one-transaction record's button navigates with its stored id", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 3,
      'all three seeded records');

    const card = cardFor('smoke-single-receipt.jpg');
    const buttons = Array.from(card.querySelectorAll('mat-card-actions button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    const viewButton = buttons.find(b => b.textContent?.includes('import.viewTransaction'));
    expect(viewButton).withContext('a view-transaction button').toBeTruthy();

    viewButton!.click();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/transactions'],
      { queryParams: { tx: 'smoke-shortcut-single' } }
    );
  }, 20000);

  it("a batch record's menu holds one entry per stored id", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 3,
      'all three seeded records');

    const card = cardFor('smoke-batch-receipts.jpg');
    const buttons = Array.from(card.querySelectorAll('mat-card-actions button')) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    const trigger = buttons.find(b => b.textContent?.includes('import.viewTransactions'));
    expect(trigger).withContext('a view-transactions menu trigger').toBeTruthy();

    trigger!.click();
    fixture.detectChanges();

    const items = document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button[mat-menu-item]');
    expect(items.length).toBe(3);

    items[2].click();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/transactions'],
      { queryParams: { tx: 'smoke-shortcut-c' } }
    );
  }, 20000);
});
