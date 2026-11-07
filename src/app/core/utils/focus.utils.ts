/** Focus went to the document, as it does when the element holding it is removed. */
export function focusDropped(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}
