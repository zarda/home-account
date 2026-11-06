import { focusDropped } from './focus.utils';

describe('focusDropped', () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    button = document.createElement('button');
    button.type = 'button';
    document.body.appendChild(button);
  });

  afterEach(() => button.remove());

  // Pin: proved by having focusDropped answer `active === null` alone.
  it('reads focus on the document as dropped (pin)', () => {
    button.focus();
    button.remove();

    expect(document.activeElement).withContext('Chrome hands focus to the body, not null').toBe(document.body);
    expect(focusDropped()).toBeTrue();
  });

  // Pin: proved by having focusDropped answer true whatever holds focus.
  it('reads focus on an element as kept (pin)', () => {
    button.focus();

    expect(document.activeElement).withContext('the button, focused').toBe(button);
    expect(focusDropped()).toBeFalse();
  });
});
