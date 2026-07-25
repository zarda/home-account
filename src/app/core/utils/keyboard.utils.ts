/**
 * Enter that confirms an IME composition (ja/tc input) reaches keydown
 * handlers with isComposing set (keyCode 229 on older engines); treating it
 * as submit would commit half-typed queries.
 */
export function isImeComposition(event: Event): boolean {
  const keyboard = event as KeyboardEvent;
  return keyboard.isComposing || keyboard.keyCode === 229;
}
