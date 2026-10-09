/**
 * Enter that confirms an IME composition (ja/tc input) reaches keydown
 * handlers with isComposing set (keyCode 229 on older engines); treating it
 * as submit would commit half-typed queries.
 */
export function isImeComposition(event: Event): boolean {
  const keyboard = event as KeyboardEvent;
  return keyboard.isComposing || keyboard.keyCode === 229;
}

const TYPED_KEY_OWNERS =
  'input, textarea, select, [contenteditable], [role="listbox"], [role="menu"], [role="menubar"], [role="combobox"], .cdk-overlay-pane';

/**
 * Whether a keydown target already owns a printable letter, so a
 * single-letter hotkey must stand down: the user is typing the letter or
 * steering with it, not invoking a command. Two families share the selector:
 *  - native text entry: input/textarea/select/contenteditable;
 *  - a Material widget whose key manager consumes printable letters for
 *    first-letter typeahead: mat-select (focused trigger or open panel),
 *    mat-menu, selection list. None of those is a MatDialog, so an
 *    open-dialog guard never sees them, and none is a native control, so
 *    the tag selectors never see them either; they are reached by their
 *    ARIA roles (combobox/listbox/menu/menubar) and by the overlay pane the
 *    open ones render into.
 * A target with no closest() (the document, the window) owns nothing.
 */
export function ownsTypedKey(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(TYPED_KEY_OWNERS);
}
