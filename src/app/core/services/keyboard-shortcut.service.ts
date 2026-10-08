import { Injectable, inject, signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { QuickAddService } from './quick-add.service';
import {
  CommandPaletteComponent,
  CommandPaletteData,
} from '../../shared/components/command-palette/command-palette.component';
import { isImeComposition, ownsTypedKey } from '../utils/keyboard.utils';

/** The header's one-time hint, and the palette button beside it (shared/layout/header). */
const SHORTCUTS_HINT_SELECTOR = '.shortcuts-hint';
const PALETTE_BUTTON_SELECTOR = '.palette-button';

/**
 * Global keyboard shortcuts for the authed shell (#80). Only that shell
 * reaches this: MainLayoutComponent wires in the keys and its header opens
 * the palette. /login and /lock are top-level routes outside that layout, so
 * a signed-out or locked session can never reach a shortcut.
 *
 * Guard order for the 'n' hotkey matters and each guard earns its place:
 *  1. An IME composition committing the key (kana confirmation, etc.) must
 *     never be read as a command — reuses keyboard.utils' isImeComposition.
 *  2. A dialog already open means the user is mid-form (or focused on a
 *     confirm button inside one); a second 'n' must not spawn another form.
 *  3. A target that already owns the letter (keyboard.utils' ownsTypedKey:
 *     native text entry, or a Material typeahead widget guard 2 cannot see)
 *     means the user is typing 'n' or steering with it, not invoking it.
 *  Only once all three pass does the key do anything. '?' is a printable
 *  character too, so it takes the same three.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private dialog = inject(MatDialog);
  private quickAdd = inject(QuickAddService);

  /** The palette this service opened, while it is open. */
  private paletteRef: MatDialogRef<CommandPaletteComponent> | null = null;

  private readonly opened = signal(false);

  /**
   * Whether a palette has opened in this session, by any door. The palette
   * lists the shortcuts whenever its search is empty, so the header's
   * one-time '?' hint has nothing left to say once this is true.
   */
  readonly paletteOpened = this.opened.asReadonly();

  handleAddHotkey(event: KeyboardEvent): void {
    if (isImeComposition(event)) return;
    if (this.dialog.openDialogs.length > 0) return;
    if (ownsTypedKey(event.target)) return;

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

    this.openPaletteDialog();
  }

  /**
   * The header's palette button, the only door a touch screen has. It opens
   * the plain palette, the one Ctrl/Cmd+K opens and then toggles closed.
   * Over any open dialog, the palette's own included, it does nothing: a
   * dialog's backdrop covers the button, so only a stray second call gets
   * here, and the palette is never stacked.
   */
  openPalette(): void {
    if (this.dialog.openDialogs.length > 0) return;

    this.openPaletteDialog();
  }

  /**
   * '?' opens the palette on its Shortcuts section. The 'n' hotkey's three
   * guards, in its order, and for its reasons: a question mark typed into a
   * field or steering a typeahead is text, and over an open dialog (this
   * palette included) the key belongs to that dialog, so there is never a
   * second palette. Unlike Ctrl/Cmd+K, the key is claimed only on the path
   * that acts on it, as 'n' is: a '?' this service stands down for reaches
   * whatever it was typed into, untouched.
   */
  handleHelpHotkey(event: KeyboardEvent): void {
    if (isImeComposition(event)) return;
    if (this.dialog.openDialogs.length > 0) return;
    if (ownsTypedKey(event.target)) return;

    event.preventDefault();
    this.openPaletteDialog({ section: 'shortcuts' });
  }

  private openPaletteDialog(data?: CommandPaletteData): void {
    // Same width as the app's other typed-into dialog (Smart Search). `data`
    // and `restoreFocus` are set only when there is some, so the plain
    // palette's config is exactly what it always was.
    const restoreFocus = this.restoreFocusPastTheHint();
    const ref = this.dialog.open(CommandPaletteComponent, {
      width: '520px',
      maxWidth: '95vw',
      ...(data ? { data } : {}),
      ...(restoreFocus ? { restoreFocus } : {}),
    });
    this.paletteRef = ref;
    this.opened.set(true);
    ref.afterClosed().subscribe(() => {
      // Guarded rather than cleared outright: a close that lands after a
      // newer palette opened must not forget the newer one.
      if (this.paletteRef === ref) {
        this.paletteRef = null;
      }
    });
  }

  /**
   * Where focus goes when the palette closes, if not back to what had it.
   *
   * The header retires its one-time hint as soon as a palette opens
   * (`paletteOpened`), so a palette opened by a key pressed on the hint's own
   * dismiss button would hand focus back to a button that is gone, and focus
   * would fall to the page. The palette button stands beside the hint, and is
   * where the dismiss itself sends focus.
   */
  private restoreFocusPastTheHint(): string | null {
    if (typeof document === 'undefined') return null;
    return document.activeElement?.closest(SHORTCUTS_HINT_SELECTOR) ? PALETTE_BUTTON_SELECTOR : null;
  }
}
