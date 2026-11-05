import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogConfig,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { accessibleName, provideNoMotion } from '../services/testing';
import { provideAppDialogs } from './dialog.config';

@Component({
  selector: 'app-dialog-config-body',
  imports: [MatDialogTitle, MatDialogContent],
  template: `<h2 mat-dialog-title>Rename the account</h2>
    <mat-dialog-content><button type="button">Save</button></mat-dialog-content>`,
})
class DialogBodyComponent {}

/** Closes every dialog still open and waits until each has left the page. */
async function closeEveryDialog(): Promise<void> {
  const dialog = TestBed.inject(MatDialog);
  const closed = dialog.openDialogs.map(ref => firstValueFrom(ref.afterClosed()));
  dialog.closeAll();
  TestBed.tick();
  await Promise.all(closed);
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
