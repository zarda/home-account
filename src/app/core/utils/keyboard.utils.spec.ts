import { ownsTypedKey } from './keyboard.utils';

describe('ownsTypedKey', () => {
  function inside(parent: HTMLElement): HTMLElement {
    const child = document.createElement('span');
    parent.appendChild(child);
    return child;
  }

  function withAttribute(name: string, value: string): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute(name, value);
    return element;
  }

  describe('native text entry', () => {
    it('owns the key in an input', () => {
      expect(ownsTypedKey(document.createElement('input'))).toBeTrue();
    });

    it('owns the key in a textarea', () => {
      expect(ownsTypedKey(document.createElement('textarea'))).toBeTrue();
    });

    it('owns the key in a select', () => {
      expect(ownsTypedKey(document.createElement('select'))).toBeTrue();
    });

    it('owns the key in a contenteditable element', () => {
      expect(ownsTypedKey(withAttribute('contenteditable', 'true'))).toBeTrue();
    });

    it('owns the key anywhere inside a contenteditable region', () => {
      expect(ownsTypedKey(inside(withAttribute('contenteditable', 'true')))).toBeTrue();
    });
  });

  // Material's first-letter typeahead: none of these is a native control, so
  // only the ARIA role or the overlay pane identifies them.
  describe('typeahead widgets', () => {
    it('owns the key on a closed select trigger', () => {
      expect(ownsTypedKey(withAttribute('role', 'combobox'))).toBeTrue();
    });

    it('owns the key inside a listbox', () => {
      expect(ownsTypedKey(inside(withAttribute('role', 'listbox')))).toBeTrue();
    });

    it('owns the key inside a menu', () => {
      expect(ownsTypedKey(inside(withAttribute('role', 'menu')))).toBeTrue();
    });

    it('owns the key inside a menubar', () => {
      expect(ownsTypedKey(inside(withAttribute('role', 'menubar')))).toBeTrue();
    });

    it('owns the key inside an overlay pane', () => {
      const pane = document.createElement('div');
      pane.classList.add('cdk-overlay-pane');

      expect(ownsTypedKey(inside(pane))).toBeTrue();
    });
  });

  describe('targets that leave the key free', () => {
    it('leaves it free on the page body', () => {
      expect(ownsTypedKey(document.body)).toBeFalse();
    });

    it('leaves it free on a plain button', () => {
      expect(ownsTypedKey(document.createElement('button'))).toBeFalse();
    });

    it('leaves it free with no target', () => {
      expect(ownsTypedKey(null)).toBeFalse();
    });

    // A keydown dispatched on the document or window has no closest().
    it('leaves it free on a target that is not an element', () => {
      expect(ownsTypedKey(document)).toBeFalse();
      expect(ownsTypedKey(window)).toBeFalse();
    });
  });
});
