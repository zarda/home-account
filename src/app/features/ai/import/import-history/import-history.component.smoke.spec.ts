// Import-history shortcut smoke test: proves the three-way branch (nothing /
// direct button / positional menu) against records that actually round-
// tripped through Firestore, not the hand-built fixture the unit spec
// constructs. Three things only this file can show: that a raw setDoc
// missing `transactionIds` — the shape of every record written before this
// field existed — passes the real import-history rules and renders no
// shortcut at all; that the ids the Router receives are the ones a real
// subscribeToCollection mapping actually attached, not just an array literal
// a mock handed back; and that a record missing `totalIncome`/
// `totalExpenses` and `totalsByCurrency` alike also passes the rules and
// renders a zero through the real `CurrencyService`, never the `NaN` an
// unguarded `Intl.NumberFormat` call would produce. A failed receipt attempt,
// stored the way the attempt service writes one, also reads its error line
// from the catalog rather than the English the record holds, and so does a
// whole import the rules refused, stored the way the confirm writes one
// through `failImport`. A record that kept photos off, stored with its two
// counters, draws each on a tile of its own. The unit spec
// overrides nothing here — ImportHistoryComponent's own template and its own
// MatMenuModule import are what render.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npx firebase emulators:exec --only auth,storage,firestore --project demo-home-account "npx ng test --watch=false --browsers=ChromeHeadless --include='**/import-history.component.smoke.spec.ts'"
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
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
import { NotificationService } from '../../../../core/services/notification.service';
import { ImportHistory } from '../../../../models';
import { silenceFirebaseWarnings } from '../../../../core/services/testing/silence-firebase-warnings';
import { provideNoMotion } from '../../../../core/services/testing';

jasmine.getEnv().configure({ random: false });
silenceFirebaseWarnings();

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
  let translation: jasmine.SpyObj<TranslationService>;

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
    // it. Seven distinct fileNames so each test can find its own card
    // without depending on query order.
    const legacy: Omit<ImportHistory, 'id'> = {
      userId: uid,
      // A morning hour below ten, in the browser's own zone, so the row's
      // time reads the same whatever the zone and a padded hour is told apart
      // from an unpadded one.
      importedAt: Timestamp.fromDate(new Date(2026, 4, 3, 9, 5)),
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
    const bareTotals: Omit<ImportHistory, 'id' | 'totalIncome' | 'totalExpenses'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'csv',
      fileType: 'generic_csv',
      fileName: 'smoke-bare-totals.csv',
      fileSize: 1024,
      transactionCount: 2,
      successCount: 2,
      skippedCount: 0,
      errorCount: 0,
      duplicatesSkipped: 0,
      status: 'completed'
      // totalIncome/totalExpenses/totalsByCurrency intentionally absent:
      // `importCreateValid` requires only userId/importedAt/source/fileType/
      // fileName/status, so this shape — older than either total scheme, a
      // restore, or a write from outside the app — passes create as-is.
    };
    // What ReceiptAttemptService.recordFailure writes for a cloud attempt
    // that could not reach the AI: the attempt's English beside its class.
    const failedAttempt: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'smoke-failed-receipt.jpg',
      fileSize: 40960,
      transactionCount: 0,
      successCount: 0,
      skippedCount: 0,
      errorCount: 1,
      totalIncome: 0,
      totalExpenses: 0,
      status: 'failed',
      duplicatesSkipped: 0,
      errors: [{ message: 'Cloud AI is not reachable.' }],
      door: 'wizard',
      errorType: 'network'
    };
    // What the confirm writes through failImport when the import itself was
    // refused: the record createPendingImport opened, now failed, holding the
    // rejection's prose beside the code it carried. No class, no door, and
    // nothing naming a row.
    const wholeImportFailed: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'csv',
      fileType: 'generic_csv',
      fileName: 'smoke-whole-import-failed.csv',
      fileSize: 2048,
      transactionCount: 0,
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 0,
      duplicatesSkipped: 0,
      status: 'failed',
      errors: [{ message: 'Missing or insufficient permissions.', code: 'permission-denied' }]
    };

    // What the confirm writes when photos stayed off a saved row: a count of
    // the rows the image quota refused and a count of the uploads that failed,
    // each written only when above zero. The rules take either as a whole
    // number and nothing else.
    const photosOff: Omit<ImportHistory, 'id'> = {
      userId: uid,
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'smoke-photo-counters.jpg',
      fileSize: 81920,
      transactionCount: 4,
      successCount: 4,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 80,
      duplicatesSkipped: 0,
      status: 'completed',
      receiptsSkipped: 1,
      receiptsFailed: 2
    };

    await Promise.all([
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-legacy`), legacy),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-single`), single),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-batch`), batch),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-bare-totals`), bareTotals),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-failed-attempt`), failedAttempt),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-whole-import-failed`), wholeImportFailed),
      setDoc(doc(firestore, `users/${uid}/imports/smoke-import-photo-counters`), photosOff)
    ]);
  });

  afterAll(async () => {
    await deleteApp(app).catch(() => undefined);
  });

  beforeEach(async () => {
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    // Nothing here stubs CurrencyService or LocaleFormatService, so the card
    // renders every record's totals and time through the real ones — and both
    // read the active locale from this service, so a spy answering only `t`
    // throws the moment the template renders a total.
    translation = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    translation.t.and.callFake((key: string) => key);
    translation.getIntlLocale.and.returnValue('en-US');

    await TestBed.configureTestingModule({
      imports: [ImportHistoryComponent],
      providers: [
        provideNoMotion(),
        FirestoreService,
        { provide: Firestore, useValue: firestore },
        { provide: AuthService, useValue: { userId: () => uid, currentUser: () => null } },
        { provide: TranslationService, useValue: translation },
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
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const card = cardFor('smoke-legacy-statement.csv');
    // Delete is always there; a legacy record with no transactionIds joins
    // it with nothing else.
    expect(card.querySelectorAll('mat-card-actions button').length).toBe(1);
  }, 20000);

  it("a one-transaction record's button navigates with its stored id", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

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
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

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

  it('a record with neither total renders a zero, not NaN', async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    // The seeding `setDoc` already resolving is the proof the rules took
    // the write; this is the other half — what the real CurrencyService
    // does with what they let through.
    const card = cardFor('smoke-bare-totals.csv');
    const incomeValue = card.querySelector('.stat.income .value');
    const expenseValue = card.querySelector('.stat.expense .value');

    expect(incomeValue?.textContent).toContain('$0.00');
    expect(expenseValue?.textContent).toContain('$0.00');
    expect(card.textContent).not.toContain('NaN');
  }, 20000);

  // The row's time came from `toLocaleTimeString` with a two-digit hour,
  // which pads 9:05 to 09:05; it now comes from the locale formatter. The
  // expectation is computed with Intl in this environment rather than written
  // out, so it holds on whatever ICU the browser ships.
  it("a stored record's row shows its time in the active language's convention", async () => {
    translation.getIntlLocale.and.returnValue('ja-JP');
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const stored = fixture.componentInstance.importHistory()
      .find(item => item.fileName === 'smoke-legacy-statement.csv');
    const importedAt = stored!.importedAt.toDate();
    const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const jaTime = new Intl.DateTimeFormat('ja-JP', timeOptions).format(importedAt);
    const enTime = new Intl.DateTimeFormat('en-US', timeOptions).format(importedAt);
    // A 24-hour clock against a 12-hour one with its marker: the two never
    // agree, so the assertion below cannot pass by the locale being ignored.
    expect(jaTime).not.toBe(enTime);

    // The subtitle is the short day, a space, then the time; a Japanese day
    // and time hold no space of their own.
    const subtitle = cardFor('smoke-legacy-statement.csv').querySelector('mat-card-subtitle');
    const shown = subtitle?.textContent?.trim() ?? '';
    expect(shown.slice(shown.lastIndexOf(' ') + 1)).toBe(jaTime);
  }, 20000);

  // The stored line is English; the card reads it back to the classifier's
  // own key, through the catalog (ADR 0036), and not to its class's sentence,
  // which would tell an online reader to check the connection. The spy
  // answers with the key, so the key on screen is the sentence a Japanese
  // reader gets in Japanese.
  it("a stored failed attempt's error line comes from the catalog, not the English it stored", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const card = cardFor('smoke-failed-receipt.jpg');
    const lines = Array.from(card.querySelectorAll('.errors li'))
      .map(li => li.textContent?.trim());
    expect(lines).toEqual(['import.errorCloudUnavailable']);
    expect(card.textContent).not.toContain('Cloud AI is not reachable.');
  }, 20000);

  // The record holds the rules' English and the code the refusal carried;
  // the card reads the code, so the reader is told the connection dropped
  // and to check the list before importing again, in their own language.
  // Nothing on it is a receipt attempt's, so it shows no failure class.
  it("a stored whole-import failure's error line comes from the catalog, not the English it stored", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const card = cardFor('smoke-whole-import-failed.csv');
    const lines = Array.from(card.querySelectorAll('.errors li'))
      .map(li => li.textContent?.trim());
    expect(lines).toEqual(['import.wholeFailedConnection']);
    expect(card.textContent).not.toContain('Missing or insufficient permissions.');
    expect(card.querySelector('.failure-class')).toBeNull();
  }, 20000);

  // failImport never writes the counts, so the record holds the 0 it was
  // opened with, and its own error line says the rows may already be in the
  // list. The card shows no tiles rather than a 0 nothing counted. The line
  // is the positive proof the card rendered this record, and the failed
  // receipt attempt beside it keeps its tiles, where nothing landed.
  it('a stored whole-import failure shows no figures it never counted', async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const card = cardFor('smoke-whole-import-failed.csv');
    expect(Array.from(card.querySelectorAll('.errors li')).map(li => li.textContent?.trim()))
      .toEqual(['import.wholeFailedConnection']);
    expect(card.querySelector('.stats-grid')).toBeNull();
    expect(cardFor('smoke-failed-receipt.jpg').querySelector('.stats-grid')).not.toBeNull();
  }, 20000);

  // The two counters round-trip through the rules and the live subscription,
  // and the card draws each on the tile its label names. A record that kept
  // every photo draws neither, so the tiles are not a fixture of the page.
  it("a stored record's photo counters render on their own tiles", async () => {
    await waitFor(
      () => fixture.componentInstance.importHistory().length === 7,
      'all seven seeded records');

    const card = cardFor('smoke-photo-counters.jpg');
    const figureOf = (label: string) => Array.from(card.querySelectorAll('.stat'))
      .find(tile => tile.querySelector('.label')?.textContent?.trim() === label)
      ?.querySelector('.value')?.textContent?.trim();
    expect(figureOf('import.statPhotosSkipped')).withContext('photos not attached').toBe('1');
    expect(figureOf('import.statPhotosFailed')).withContext('photos not uploaded').toBe('2');
    expect(cardFor('smoke-single-receipt.jpg').querySelector('.stat.photos'))
      .withContext('a record that kept its photos')
      .toBeNull();
  }, 20000);
});
