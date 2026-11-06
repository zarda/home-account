/// <reference types="jasmine" />
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

/** Closes every dialog still open and waits until each has left the page. */
export async function closeEveryDialog(): Promise<void> {
  const dialog = TestBed.inject(MatDialog);
  const closed = dialog.openDialogs.map(ref => firstValueFrom(ref.afterClosed()));
  dialog.closeAll();
  TestBed.tick();
  await Promise.all(closed);
}

/**
 * Chooses `entry` from the menu `trigger` opens, as a press does, and gives
 * back the dialog the entry opened once its menu has left the page.
 *
 * A synthetic click moves no focus, so the trigger and then the entry are
 * focused before each is clicked, as Chrome's press and the menu's keys
 * focus them: the dialog records the entry pressed as where focus goes back.
 * What keeps a case about that return honest is the `TestBed.tick()` after
 * the entry's click, which runs the dialog's focus trap (zone-mode
 * `detectChanges` runs no render hook), and the check that focus is then
 * inside the dialog. Without them focus stays on the trigger the menu's
 * close focused, the container skips its restore, and the case passes
 * whatever the app does. The entry is checked gone with its menu, too, as it
 * is by the time a person closes the dialog.
 *
 * The TestBed provides no motion (provideNoMotion), so the closed menu
 * leaves the page a task later rather than after its exit animation.
 */
export async function pressMenuEntry(
  fixture: ComponentFixture<unknown>,
  trigger: HTMLElement,
  entry: string
): Promise<MatDialogRef<unknown>> {
  const dialog = TestBed.inject(MatDialog);
  const before = new Set(dialog.openDialogs);
  trigger.focus();
  trigger.click();
  fixture.detectChanges();
  TestBed.tick();
  expect(trigger.getAttribute('aria-expanded')).withContext('the menu, open').toBe('true');
  const item = document.querySelector<HTMLElement>(`.mat-mdc-menu-panel ${entry}`);
  expect(item).withContext('the menu entry').not.toBeNull();
  item!.focus();
  expect(document.activeElement).withContext('focus, on the entry pressed').toBe(item);
  item!.click();
  fixture.detectChanges();
  TestBed.tick();
  const ref = dialog.openDialogs.find(open => !before.has(open));
  expect(ref).withContext('the dialog the entry opened').toBeDefined();
  await firstValueFrom(ref!.afterOpened());
  // The closed menu leaves the page a task later, its entry with it.
  await new Promise(resolve => setTimeout(resolve));
  expect(item!.isConnected).withContext('the entry, gone with its menu').toBeFalse();
  expect(document.getElementById(ref!.id)?.contains(document.activeElement))
    .withContext('focus, in the dialog')
    .toBeTrue();
  return ref!;
}
