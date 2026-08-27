import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { QuickAddService } from './quick-add.service';
import { CommandPaletteComponent } from '../../shared/components/command-palette/command-palette.component';
import { isImeComposition } from '../utils/keyboard.utils';

/**
 * Global keyboard shortcuts for the authed shell (#80). MainLayoutComponent
 * is the only place this is wired in — /login and /lock are top-level
 * routes outside that layout, so a signed-out or locked session can never
 * reach a shortcut.
 *
 * Guard order for the 'n' hotkey matters and each guard earns its place:
 *  1. An IME composition committing the key (kana confirmation, etc.) must
 *     never be read as a command — reuses keyboard.utils' isImeComposition.
 *  2. A dialog already open means the user is mid-form (or focused on a
 *     confirm button inside one); a second 'n' must not spawn another form.
 *  3. A text-entry target (input/textarea/select/contenteditable) means the
 *     user is typing 'n', not invoking it.
 *  Only once all three pass does the key do anything.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private dialog = inject(MatDialog);
  private quickAdd = inject(QuickAddService);

  /** The palette this service opened, while it is open. */
  private paletteRef: MatDialogRef<CommandPaletteComponent> | null = null;

  handleAddHotkey(event: KeyboardEvent): void {
    if (isImeComposition(event)) return;
    if (this.dialog.openDialogs.length > 0) return;
    if ((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;

    event.preventDefault();
    this.quickAdd.openAddTransaction();
  }

  /**
   * Ctrl/Cmd+K toggles the command palette. Deliberately a different guard
   * chain from the 'n' hotkey:
   *
   *  - The IME guard stays first, for the same reason: a composition
   *    committing the key is text, not a command.
   *  - `preventDefault()` then runs on EVERY path, including the ones that go
   *    on to do nothing. Shadowing the browser's own Ctrl/Cmd+K (focus the
   *    address bar / search) is the point of claiming the chord at all; a
   *    branch that let it through would teach the user the palette is
   *    unreliable rather than that this dialog does not offer one.
   *  - There is NO text-entry guard. A palette has to be summonable from
   *    wherever the user's hands already are, the transaction search box
   *    included — the 'n' hotkey stands down there because 'n' is a letter
   *    somebody is typing, and Ctrl+K is not.
   *  - The palette's own dialog toggles; anybody else's dialog wins. Mid-form
   *    is not the moment to swap the dialog out from under a user, and the
   *    palette's actions would only stack another dialog on top.
   */
  handlePaletteHotkey(event: KeyboardEvent): void {
    if (isImeComposition(event)) return;

    event.preventDefault();

    if (this.paletteRef) {
      this.paletteRef.close();
      return;
    }
    if (this.dialog.openDialogs.length > 0) return;

    // Same width as the app's other typed-into dialog (Smart Search).
    const ref = this.dialog.open(CommandPaletteComponent, {
      width: '520px',
      maxWidth: '95vw',
    });
    this.paletteRef = ref;
    ref.afterClosed().subscribe(() => {
      // Guarded rather than cleared outright: a close that lands after a
      // newer palette opened must not forget the newer one.
      if (this.paletteRef === ref) {
        this.paletteRef = null;
      }
    });
  }
}
