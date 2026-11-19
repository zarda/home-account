// Delete, Undo and focus smoke test: a row deleted from the transactions
// page through its own menu and the real confirm, with the real deferred
// delete behind it and the Firebase emulators under both.
//
// The unit specs hold each part on stand-ins: the list's hand-off of focus,
// the page's hidden rows, the pending delete's window and its single flush.
// What they cannot show is the parts together on the real route: the row
// leaving the moment the confirm closes, focus going to the row now in its
// place while the row's document is still stored, Undo bringing the row and
// focus back, and the delete, once made real, taking the household's copy
// with the row and the list refreshed without it.
//
// Import the Firebase SDK through @angular/fire (not the root `firebase/*`
// packages) — see app.smoke.spec.ts for why the copies must match.
//
// Runs only under the emulators:
//   npm run smoke
//
// Notes:
// - i18n JSON is not served by the Karma asset config, so `| translate`
//   renders raw keys — assertions match keys and seeded data, never copy.
// - The case brings its own client online, and afterEach deletes it once
//   any delete still waiting has been made real: a waiting delete's timer
//   firing into a deleted app would fail under a later case, and a client
//   left online holds connections every later case needs (docs/testing.md,
//   Six connections to the emulator).
import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { initializeApp, deleteApp, FirebaseApp } from '@angular/fire/app';
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from '@angular/fire/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  addDoc,
  doc,
  setDoc,
  Firestore,
  Timestamp
} from '@angular/fire/firestore';
import { getStorage, connectStorageEmulator, Storage } from '@angular/fire/storage';
import { routes } from '../../app.routes';
import { provideAppCharts } from '../../core/config/chart.config';
import { provideAppDatepicker } from '../../core/config/datepicker.config';
import { provideAppDialogs } from '../../core/config/dialog.config';
import { AuthService } from '../../core/services/auth.service';
import { CurrencyService } from '../../core/services/currency.service';
import { HouseholdService } from '../../core/services/household.service';
import { LedgerShareService } from '../../core/services/ledger-share.service';
import { PendingDeleteService } from '../../core/services/pending-delete.service';
import { PeriodTotalsService } from '../../core/services/period-totals.service';
import { ledgerCopyPath } from '../../models/household-ledger.model';
import {
  MockAuthService,
  createMockUser,
  getDocumentAsOwner,
  pressKey,
  provideNoMotion
} from '../../core/services/testing';
import { silenceFirebaseWarnings } from '../../core/services/testing/silence-firebase-warnings';
import { stripProviderKeys } from '../../core/services/testing/provider-keys';

silenceFirebaseWarnings();
stripProviderKeys();

describe('Delete, Undo and focus on the transactions page (emulator smoke test)', () => {
  const AUTH_URL = 'http://127.0.0.1:9099';
  const SPEC_TIMEOUT = 60000;

  let caseApp: FirebaseApp | undefined;
  let harness: RouterTestingHarness | undefined;
  let pendingDelete: PendingDeleteService | undefined;

  /**
   * Polls until `predicate` holds, flushing the page between polls:
   * Firestore callbacks arrive outside the harness's knowledge. Past
   * `timeoutMs` it throws with what `found` reads, which ends the case at
   * the first step that went wrong. Kept short: a wait that ran on would
   * outlast the Undo window, and Karma gives up on a case that sends
   * nothing for 30 s.
   */
  async function waitFor(
    label: string,
    predicate: () => boolean | Promise<boolean>,
    found?: () => string,
    timeoutMs = 5000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      harness?.detectChanges();
      if (await predicate()) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${label}${found ? `; found ${found()}` : ''}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /** What holds focus, for a failure: the element, and the row it sits in. */
  function focused(): string {
    const active = document.activeElement;
    if (!active || active === document.body) return 'focus on the document';
    const row = active.closest('[data-tx-id]')?.getAttribute('data-tx-id');
    return `focus on ${active.tagName.toLowerCase()}.${Array.from(active.classList).join('.')}${row ? ` in row ${row}` : ''}`;
  }

  /** The rows the list shows, by id, top to bottom. */
  function rowIds(): (string | null)[] {
    return Array.from(document.querySelectorAll('app-transaction-list [data-tx-id]'), row =>
      row.getAttribute('data-tx-id')
    );
  }

  /** Row `id`'s menu button, in the phone list Karma's 756px window shows. */
  function menuButton(id: string): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`app-transaction-list [data-tx-id="${id}"] .row-menu-btn`);
  }

  /** The open notice's Undo. */
  function undoButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('.mat-mdc-snack-bar-container .mat-mdc-snack-bar-action');
  }

  /**
   * A key pressed on `target`, which must hold focus: pressKey, with the
   * legacy key code the menu's trigger and its key manager read.
   */
  function press(target: Element, key: 'Enter' | 'End'): void {
    expect(document.activeElement).withContext(`focus, on what ${key} is pressed on`).toBe(target);
    pressKey(target, key, { legacyKeyCode: true });
  }

  /**
   * Deletes row `id` by keyboard: Enter on its menu button opens the menu
   * on its first entry, End moves to Delete, Enter opens the real confirm,
   * and Enter on the confirm's Delete closes it. A synthetic Tab moves no
   * focus, so the one move a reader makes with Tab, onto the confirm's
   * Delete, is a focus call.
   */
  async function deleteByKeyboard(id: string): Promise<void> {
    const trigger = menuButton(id);
    if (!trigger) throw new Error(`No menu button on row ${id}`);
    trigger.focus();
    press(trigger, 'Enter');
    await waitFor(`row ${id}'s menu, open with focus on its first entry`, () =>
      trigger.getAttribute('aria-expanded') === 'true' && !!document.activeElement?.closest('.mat-mdc-menu-panel'),
      focused
    );

    press(document.activeElement!, 'End');
    const entry = document.querySelector('.mat-mdc-menu-panel .menu-item-destructive');
    await waitFor("focus on the menu's Delete, its last entry", () => !!entry && document.activeElement === entry, focused);
    press(entry!, 'Enter');

    await waitFor('the confirm Delete opened, with focus in it', () =>
      !!document.activeElement?.closest('mat-dialog-container'),
      focused
    );
    const confirm = document.activeElement!.closest('mat-dialog-container')!;
    const buttons = Array.from(confirm.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'));
    expect(buttons.map(button => button.textContent?.trim()))
      .withContext("the confirm's two answers")
      .toEqual(['common.cancel', 'common.delete']);
    const yes = buttons[1];
    if (!yes) throw new Error("No Delete in the confirm");
    yes.focus();
    press(yes, 'Enter');
    await waitFor('the confirm, closed', () => !document.querySelector('mat-dialog-container'));
  }

  afterEach(async () => {
    const app = caseApp;
    const page = harness;
    const deletes = pendingDelete;
    caseApp = undefined;
    harness = undefined;
    pendingDelete = undefined;
    try {
      // A delete a failed case left waiting is made real here, while the
      // client it writes through is still online: its window's timer must
      // not outlive the client.
      await deletes?.flush();
      if (page) {
        // Teardown order: settle the rate load, then the view, whose
        // listeners close with it, then the app — see app.smoke.spec.ts.
        await TestBed.inject(CurrencyService).ensureRatesLoaded();
        await new Promise(resolve => setTimeout(resolve, 500));
        page.fixture.destroy();
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } finally {
      if (app) await deleteApp(app).catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve));
    }
  });

  it(
    "hides a deleted row with focus on the row now in its place, brings both back on Undo, and deletes the row and its household copy once the delete is real",
    async () => {
      const app = initializeApp(
        {
          apiKey: 'fake-api-key',
          projectId: 'demo-home-account',
          storageBucket: 'demo-home-account.appspot.com'
        },
        `delete-undo-smoke-${Date.now()}`
      );
      caseApp = app;
      const auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
      const firestore = getFirestore(app);
      connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
      const storage = getStorage(app);
      connectStorageEmulator(storage, '127.0.0.1', 9199);
      const uid = (await signInAnonymously(auth)).user.uid;

      // The mock user's id is the emulator uid, so users/{uid}/… reads pass
      // the isOwner rules.
      const mockAuth = new MockAuthService();
      mockAuth.setMockUser(createMockUser(uid));
      TestBed.configureTestingModule({
        providers: [
          provideRouter(routes),
          provideNoMotion(),
          provideHttpClient(),
          provideAppDatepicker(),
          provideAppCharts(),
          // The app's own dialog options, as app.config provides them: the
          // confirm is the real one, and focus comes back from it the way
          // it does in the app.
          provideAppDialogs(),
          { provide: Firestore, useValue: firestore },
          { provide: Auth, useValue: auth },
          { provide: Storage, useValue: storage },
          { provide: AuthService, useValue: mockAuth }
        ],
        // Kept alive after the case (the fixture is destroyed by hand): a
        // Firestore timer that fires into a torn-down injector crashes with
        // NG0205.
        teardown: { destroyAfterEach: false }
      });
      pendingDelete = TestBed.inject(PendingDeleteService);

      // Three rows a minute apart, shapes as TransactionService.addTransaction
      // writes them: the row of the case's own between two others, so the
      // row that takes its place is the one after it, not the one before.
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
      const addRow = async (description: string, minutesAgo: number): Promise<string> =>
        (await addDoc(collection(firestore, `users/${uid}/transactions`), {
          userId: uid,
          type: 'expense',
          categoryId: categoryRef.id,
          date: Timestamp.fromMillis(now.toMillis() - minutesAgo * 60_000),
          createdAt: now,
          updatedAt: now,
          isRecurring: false,
          amount: 6.4,
          currency: 'USD',
          amountInBaseCurrency: 6.4,
          exchangeRate: 1,
          description
        })).id;
      const newerId = await addRow('Blue Bottle Coffee', 1);
      const ownId = await addRow('Corner Bakery', 2);
      const olderId = await addRow('Tokyo Dinner', 3);

      // The row is shared into a household the way the app shares one, so
      // its delete has a copy to take with it. share() resolves once the row
      // names the household, whether or not the copy was written, so the
      // copy is read until it is there.
      await setDoc(doc(firestore, `users/${uid}`), {
        email: 'test@example.com',
        displayName: 'Test User',
        createdAt: now,
        lastLoginAt: now,
        preferences: { baseCurrency: 'USD', language: 'en' }
      });
      const householdId = await TestBed.inject(HouseholdService).create('Home');
      await TestBed.inject(LedgerShareService).share([ownId], householdId);
      const rowPath = `users/${uid}/transactions/${ownId}`;
      const copyPath = ledgerCopyPath(householdId, uid, ownId);
      await waitFor("the row's household copy", async () => (await getDocumentAsOwner(copyPath)) !== null);

      const routed = await RouterTestingHarness.create();
      harness = routed;
      await routed.navigateByUrl('/transactions?showAll=true');
      const rows = (): string => `rows ${JSON.stringify(rowIds())}`;
      await waitFor(
        'the three rows, newest first',
        () => rowIds().join() === [newerId, ownId, olderId].join() && !!menuButton(ownId),
        rows,
        15000
      );

      // Deleted: the row leaves as the confirm closes, and focus, which the
      // row took with it, goes to the menu button of the row now second.
      // Nothing is touched yet: the delete waits out its Undo window.
      await deleteByKeyboard(ownId);
      await waitFor('the row gone', () => !rowIds().includes(ownId), rows);
      expect(rowIds()).withContext('the rows once the confirm has closed').toEqual([newerId, olderId]);
      await waitFor(
        'focus on the menu button of the row now in the place of the one deleted',
        () => document.activeElement === menuButton(olderId),
        focused
      );
      expect(await getDocumentAsOwner(rowPath)).withContext('the row, still stored while Undo is offered').not.toBeNull();
      expect(await getDocumentAsOwner(copyPath)).withContext('its household copy, still stored').not.toBeNull();

      // Undo, pressed in the notice by keyboard: the row comes back, and
      // focus with it, off the notice as it leaves. Nothing is deleted, even
      // once whatever still waits is made real: a delete Undo had left
      // waiting would be carried out by that flush, and the reads would find
      // the row and its copy gone.
      await waitFor("the notice's Undo", () => !!undoButton());
      const undo = undoButton()!;
      expect(undo.textContent?.trim()).withContext("the notice's Undo").toBe('common.undo');
      undo.focus();
      press(undo, 'Enter');
      await waitFor('the row back', () => rowIds().join() === [newerId, ownId, olderId].join(), rows);
      await waitFor(
        "focus back on the restored row's menu button",
        () => document.activeElement === menuButton(ownId),
        focused
      );
      await TestBed.inject(NgZone).run(() => pendingDelete!.flush());
      await waitFor('the notice, taken down by Undo', () => !undoButton());
      expect(await getDocumentAsOwner(rowPath)).withContext('the row, after Undo and a flush').not.toBeNull();
      expect(await getDocumentAsOwner(copyPath))
        .withContext('its household copy, after Undo and a flush')
        .not.toBeNull();

      // Deleted again, and made real at once: the row and its household
      // copy go together, and the notice is taken down. The page hides the
      // row until its delete is done and the loaded window no longer holds
      // it, so once it hides nothing, the rows it shows are the window's
      // own: the list has refreshed without the row, and the row stays gone.
      await deleteByKeyboard(ownId);
      await waitFor('the row gone again', () => !rowIds().includes(ownId), rows);
      await waitFor(
        'focus on the menu button of the row now in its place, the second time',
        () => document.activeElement === menuButton(olderId),
        focused
      );
      await TestBed.inject(NgZone).run(() => pendingDelete!.flush());
      expect(await getDocumentAsOwner(rowPath)).withContext('the row, once its delete is real').toBeNull();
      expect(await getDocumentAsOwner(copyPath)).withContext('its household copy, gone with it').toBeNull();
      await waitFor('the notice, taken down by the flush', () => !undoButton());
      // The page's own PeriodTotalsService (TransactionsComponent provides
      // it): its exclude set is the ids the page hides.
      const hidden = routed.fixture.debugElement
        .query(By.css('app-transactions'))
        .injector.get(PeriodTotalsService).exclude;
      await waitFor(
        'the hidden row let go, once the window no longer holds it',
        () => hidden().size === 0,
        () => `hidden ${JSON.stringify([...hidden()])}`
      );
      expect(rowIds()).withContext('the rows of the refreshed window').toEqual([newerId, olderId]);
    },
    SPEC_TIMEOUT
  );
});
