import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { QuickAddService } from './quick-add.service';
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

  handleAddHotkey(event: KeyboardEvent): void {
    if (isImeComposition(event)) return;
    if (this.dialog.openDialogs.length > 0) return;
    if ((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;

    event.preventDefault();
    this.quickAdd.openAddTransaction();
  }
}
