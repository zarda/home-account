import { pressKey } from './key-press';

describe('pressKey', () => {
  let button: HTMLButtonElement;
  let clicks: number;

  beforeEach(() => {
    button = document.createElement('button');
    button.type = 'button';
    clicks = 0;
    button.addEventListener('click', () => clicks++);
    document.body.appendChild(button);
  });

  afterEach(() => button.remove());

  it('presses a button on Enter, unless the keydown was cancelled', () => {
    pressKey(button, 'Enter');
    expect(clicks).withContext('Enter, let through').toBe(1);

    button.addEventListener('keydown', event => event.preventDefault(), { once: true });
    expect(pressKey(button, 'Enter').defaultPrevented).withContext('the keydown, cancelled').toBeTrue();
    expect(clicks).withContext('Enter, cancelled on the way').toBe(1);
  });

  it('presses nothing on End: it only moves', () => {
    const keydown = pressKey(button, 'End');
    expect(keydown.key).toBe('End');
    expect(clicks).toBe(0);
  });

  it("carries the legacy key code Chrome also sends, only when asked: the menu's key manager moves on it", () => {
    const codes = (['Enter', ' ', 'End'] as const).map(key => pressKey(button, key, { legacyKeyCode: true }).keyCode);
    expect(codes).withContext('asked for').toEqual([13, 32, 35]);

    const plain = (['Enter', ' ', 'End'] as const).map(key => pressKey(button, key).keyCode);
    expect(plain).withContext('not asked for').toEqual([0, 0, 0]);
  });
});
