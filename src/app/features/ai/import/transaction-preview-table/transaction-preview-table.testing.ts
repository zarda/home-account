/// <reference types="jasmine" />

/**
 * Runs `pass` with the review list under `root` let out to its full height,
 * then puts its cap back. The container clips what overflows it, and axe
 * takes a card outside that clip as off screen: at its 70dvh cap in Karma's
 * short frame the list shows about two cards, and contrast on the rest would
 * go unscored while the pass still read as clean. So every card is first
 * seen inside the container.
 *
 * `root` is the review card's own element, or a host that renders one, as
 * the wizard's review step does.
 */
export async function withEveryCardShown<T>(root: HTMLElement, pass: () => Promise<T>): Promise<T> {
  const list = root.querySelector<HTMLElement>('.transactions-list');
  if (!list) throw new Error('withEveryCardShown: no review list (.transactions-list) under the root');
  const cap = list.style.maxHeight;
  list.style.maxHeight = 'none';
  try {
    const container = root.querySelector<HTMLElement>('.table-container')!.getBoundingClientRect();
    const cards = [...root.querySelectorAll<HTMLElement>('.transaction-card')];
    const clipped = cards
      .filter(card => {
        const rect = card.getBoundingClientRect();
        return rect.top < container.top || rect.bottom > container.bottom
          || rect.left < container.left || rect.right > container.right;
      })
      .map(card => card.dataset['rowId']);
    expect(clipped).withContext('cards outside the container, which axe would skip').toEqual([]);
    return await pass();
  } finally {
    list.style.maxHeight = cap;
  }
}
