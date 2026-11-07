import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogConfig,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { firstValueFrom } from 'rxjs';

import { accessibleName, closeEveryDialog, pressMenuEntry, provideNoMotion } from '../services/testing';
import { provideAppDialogs } from './dialog.config';

@Component({
  selector: 'app-dialog-config-body',
  imports: [MatDialogTitle, MatDialogContent],
  template: `<h2 mat-dialog-title>Rename the account</h2>
    <mat-dialog-content><button type="button">Save</button></mat-dialog-content>`,
})
class DialogBodyComponent {}

/**
 * A page with two menus, and a button outside either. The first menu is a
 * decoy, there so that the trigger focus goes back to is the one whose menu
 * was opened, not the page's first. The second menu's entries open the body,
 * one of them told to return focus elsewhere. The button opens it too and
 * leaves the page as it does, as a control a page swaps out would.
 */
@Component({
  selector: 'app-dialog-config-menu-host',
  imports: [MatMenuModule],
  template: `<button type="button" class="decoy" [matMenuTriggerFor]="decoy">Sort</button>
    <mat-menu #decoy="matMenu">
      <button mat-menu-item type="button">By date</button>
    </mat-menu>
    <button type="button" class="opener" [matMenuTriggerFor]="menu">More</button>
    <button #elsewhere type="button" class="elsewhere">Elsewhere</button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" class="rename" (click)="open()">Rename</button>
      <button mat-menu-item type="button" class="rename-elsewhere" (click)="open(elsewhere)">
        Rename elsewhere
      </button>
    </mat-menu>
    @if (!renamedOnce()) {
      <button type="button" class="rename-once" (click)="openOnce()">Rename once</button>
    }`,
})
class MenuHostComponent {
  private readonly dialog = inject(MatDialog);
  readonly renamedOnce = signal(false);

  open(restoreFocus?: HTMLElement): void {
    this.dialog.open(DialogBodyComponent, restoreFocus ? { restoreFocus } : {});
  }

  openOnce(): void {
    this.open();
    this.renamedOnce.set(true);
  }
}

/** Closes one dialog and waits until it has left the page. */
async function closeIt(ref: MatDialogRef<unknown>): Promise<void> {
  const closed = firstValueFrom(ref.afterClosed());
  ref.close();
  TestBed.tick();
  await closed;
}

// MatDialog.open spreads these options in place of `new MatDialogConfig()`,
// so a key they leave out is undefined, not Material's default.
describe('provideAppDialogs', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAppDialogs()] }));

  it("keeps Material's defaults but the width, the max width and the focus trap's timing", () => {
    const material: MatDialogConfig = { ...new MatDialogConfig() };
    const app = TestBed.inject(MAT_DIALOG_DEFAULT_OPTIONS);
    // The app's options with its three changes set back to Material's.
    const rest: MatDialogConfig = {
      ...app,
      width: material.width,
      maxWidth: material.maxWidth,
      delayFocusTrap: material.delayFocusTrap,
    };

    expect(app.width).toBe('min(480px, calc(100vw - 32px))');
    expect(app.maxWidth).toBe('calc(100vw - 32px)');
    expect(rest).withContext("every other key is Material's own, present").toEqual(material);
    expect(app.delayFocusTrap).withContext('focus enters a dialog as it renders').toBe(false);
  });
});

describe("a dialog opened under provideAppDialogs (Material's container)", () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAppDialogs(), provideNoMotion()] }));
  afterEach(closeEveryDialog);

  /** Opens the body under the app's options and waits until it has opened. */
  async function open(config?: MatDialogConfig): Promise<HTMLElement> {
    const ref = TestBed.inject(MatDialog).open(DialogBodyComponent, config);
    TestBed.tick();
    await firstValueFrom(ref.afterOpened());
    TestBed.tick();
    const container = document.getElementById(ref.id);
    expect(container).withContext('the dialog opened').not.toBeNull();
    return container!;
  }

  it('is a dialog, named by its title', async () => {
    const container = await open();

    expect(container.getAttribute('role')).toBe('dialog');
    expect(container.getAttribute('aria-modal'))
      .withContext("Material's value: the page behind is aria-hidden instead")
      .toBe('false');
    expect(accessibleName(container)).toBe('Rename the account');
  });

  // Pin: proved by deleting `maxWidth` from provideAppDialogs.
  it('lets a per-open width replace the default but not the max width (pin)', async () => {
    const container = await open({ width: '720px' });
    const pane = container.closest<HTMLElement>('.cdk-overlay-pane');
    // Read back as the browser writes the value, which reorders a calc().
    const gutter = document.createElement('div').style;
    gutter.maxWidth = 'calc(100vw - 32px)';

    expect(gutter.maxWidth).withContext('the browser reads the max width').not.toBe('');
    expect(pane).withContext('the overlay pane').not.toBeNull();
    expect(pane!.style.width).toBe('720px');
    expect(pane!.style.maxWidth).toBe(gutter.maxWidth);
  });

  it("hands focus back to the menu's trigger once a dialog its entry opened has gone", async () => {
    const fixture = TestBed.createComponent(MenuHostComponent);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('.opener') as HTMLElement;

    await closeIt(await pressMenuEntry(fixture, opener, '.rename'));

    expect(document.activeElement)
      .withContext("focus, on the trigger of the menu that was opened, not the page's first")
      .toBe(opener);
  });

  // Pin: proved by having the rule focus the trigger whether or not focus had dropped.
  it('leaves focus where a dialog an entry opened was told to return it (pin)', async () => {
    const fixture = TestBed.createComponent(MenuHostComponent);
    fixture.detectChanges();
    const opener = fixture.nativeElement.querySelector('.opener') as HTMLElement;

    await closeIt(await pressMenuEntry(fixture, opener, '.rename-elsewhere'));

    expect(document.activeElement)
      .withContext('focus, where the dialog was told to return it')
      .toBe(fixture.nativeElement.querySelector('.elsewhere'));
  });

  // Pin: proved by having the rule take the page's first menu trigger in
  // place of the one that owns the panel focus was in.
  it("leaves focus a dialog no menu opened dropped on the document, for the page's own recovery (pin)", async () => {
    const fixture = TestBed.createComponent(MenuHostComponent);
    fixture.detectChanges();
    const once = fixture.nativeElement.querySelector('.rename-once') as HTMLElement;

    once.focus();
    expect(document.activeElement).withContext('focus, on the button pressed').toBe(once);
    once.click();
    fixture.detectChanges();
    TestBed.tick();
    const ref = TestBed.inject(MatDialog).openDialogs.at(0);
    expect(ref).withContext('the dialog the button opened').toBeDefined();
    await firstValueFrom(ref!.afterOpened());
    expect(once.isConnected).withContext('the button, gone from the page').toBeFalse();
    expect(document.getElementById(ref!.id)?.contains(document.activeElement))
      .withContext('focus, in the dialog')
      .toBeTrue();
    await closeIt(ref!);

    expect(document.activeElement).withContext('focus, left on the document').toBe(document.body);
  });
});

describe('a dialog opened under provideAppDialogs, its entrance animated', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAppDialogs()] }));
  afterEach(closeEveryDialog);

  // Pin: proved by deleting `delayFocusTrap: false` from provideAppDialogs.
  // Read before any await: Material's own trap waits for the entrance to end,
  // which a synchronous read never gives the chance.
  it('moves focus into the dialog at its first render, before its entrance ends (pin)', () => {
    TestBed.inject(MatDialog).open(DialogBodyComponent);
    TestBed.tick();
    const save = document.querySelector<HTMLElement>('mat-dialog-container button');

    expect(save).withContext('the dialog rendered').not.toBeNull();
    expect(document.activeElement).withContext('focus is in the dialog before its entrance ends').toBe(save);
  });
});
