import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  inject,
  signal
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FocusContext, focusWhenRendered } from './focus-when-rendered';
import { pressKey } from '../../core/services/testing';

/**
 * A pressed control that its press can take away, a landing that comes only
 * with the next render, a fallback that is always there, and a region an
 * action can be taken from.
 */
@Component({
  standalone: true,
  template: `
    @if (pressedShown()) {
      <button type="button" class="pressed">Pressed</button>
    }
    @if (landed()) {
      <button type="button" class="landing">Landing</button>
    }
    <button type="button" class="fallback">Fallback</button>
    <div class="origin">
      <button type="button" class="in-origin">In the origin</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
class FocusProbeComponent {
  readonly pressedShown = signal(true);
  readonly landed = signal(false);
  readonly context: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: inject(DestroyRef)
  };
}

describe('focusWhenRendered', () => {
  let fixture: ComponentFixture<FocusProbeComponent>;
  let probe: FocusProbeComponent;
  let elsewhere: HTMLButtonElement;

  const find = (selector: string): HTMLButtonElement => {
    const found = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(selector);
    expect(found).withContext(selector).not.toBeNull();
    return found!;
  };

  /** Lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
  function render(): void {
    fixture.detectChanges();
    TestBed.tick();
  }

  /** A key's keydown as the browser sends it to whatever holds focus. */
  function keydown(key: string, repeat: boolean): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
  }

  function keyup(key: string): void {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  }

  /** The pressed control hands focus to the fallback, which takes it once rendered. */
  function handOff(): HTMLButtonElement {
    find('.pressed').focus();
    focusWhenRendered(probe.context, '.fallback');
    render();
    const fallback = find('.fallback');
    expect(document.activeElement).withContext('focus, handed to the fallback').toBe(fallback);
    return fallback;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FocusProbeComponent] });
    fixture = TestBed.createComponent(FocusProbeComponent);
    probe = fixture.componentInstance;
    fixture.detectChanges();
    elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.type = 'button';
  });

  afterEach(() => {
    // Lets go of any guard a case left standing before the next case presses keys.
    keyup('Enter');
    elsewhere.remove();
  });

  describe('where focus lands', () => {
    // The landing does not exist when the swap asks for it: only the render
    // that follows makes it.
    it('focuses the first of its selectors once the next render has made it', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, ['.landing', '.fallback']);
      expect(document.activeElement).withContext('focus, before the render').toBe(find('.pressed'));

      probe.landed.set(true);
      render();

      expect(document.activeElement).toBe(find('.landing'));
    });

    it('falls back to the next selector while the first matches nothing', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, ['.landing', '.fallback']);
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });

    it('takes one selector on its own', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, '.fallback');
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });

    it('looks under its host alone', () => {
      elsewhere.classList.add('outside');
      find('.pressed').focus();
      focusWhenRendered(probe.context, ['.outside', '.fallback']);
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });

    it('moves nothing, and stands no guard, when no selector matches', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, ['.landing', '.nowhere']);
      render();

      expect(document.activeElement).withContext('focus, where it was').toBe(find('.pressed'));
      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after no hand-off').toBeFalse();
    });

    // Unless asked to, the hand-off does not ask where focus is: a photo's
    // arrow that a move disables can keep focus in Chrome, and focus is
    // meant to leave it.
    it('moves focus from wherever it is by then', () => {
      elsewhere.focus();
      focusWhenRendered(probe.context, '.fallback');
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });
  });

  // Where focus is is asked once the render has run, not when the hand-off
  // is: the press asking for it still holds focus then, and only the render
  // that takes its control away drops it.
  describe('only if dropped', () => {
    it('leaves focus the viewer has put elsewhere by then, and stands no guard', () => {
      find('.pressed').focus();
      find('.pressed').blur();
      focusWhenRendered(probe.context, '.fallback', { onlyIfDropped: true, from: find('.origin') });
      expect(document.activeElement).withContext('focus, on the document when the hand-off is asked for').toBe(document.body);

      elsewhere.focus();
      render();

      expect(document.activeElement).withContext('focus, where the viewer put it').toBe(elsewhere);
      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after no hand-off').toBeFalse();
    });

    it('takes focus the render drops as it takes the pressed control away', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, ['.landing', '.fallback'], { onlyIfDropped: true });

      probe.pressedShown.set(false);
      probe.landed.set(true);
      render();

      expect((fixture.nativeElement as HTMLElement).querySelector('.pressed'))
        .withContext('the pressed control, taken away')
        .toBeNull();
      expect(document.activeElement).toBe(find('.landing'));
    });

    it('takes focus the document holds', () => {
      find('.pressed').focus();
      find('.pressed').blur();
      expect(document.activeElement).withContext('focus, on the document').toBe(document.body);

      focusWhenRendered(probe.context, '.fallback', { onlyIfDropped: true });
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });

    it('takes focus left inside the control the action was taken from', () => {
      find('.in-origin').focus();
      focusWhenRendered(probe.context, '.fallback', { onlyIfDropped: true, from: find('.origin') });
      render();

      expect(document.activeElement).toBe(find('.fallback'));
    });

    it('leaves focus inside the host but outside that control', () => {
      find('.pressed').focus();
      focusWhenRendered(probe.context, '.fallback', { onlyIfDropped: true, from: find('.origin') });
      render();

      expect(document.activeElement).toBe(find('.pressed'));
    });
  });

  // Chrome and WebKit press a focused button on the keypress that follows
  // each Enter keydown, a held key's repeats included, so the control a
  // press handed focus to was pressed by every repeat after.
  describe('a key held through the hand-off', () => {
    it('cancels the repeats of an Enter or a Space, ahead of the control\'s own listeners', () => {
      const fallback = handOff();
      const heard = jasmine.createSpy('the control\'s own keydown');
      fallback.addEventListener('keydown', heard);
      const clicked = jasmine.createSpy('the control\'s click');
      fallback.addEventListener('click', clicked);

      for (const n of [1, 2, 3]) {
        expect(pressKey(fallback, 'Enter', { repeat: true }).defaultPrevented)
          .withContext(`Enter's repeat ${n}, cancelled`)
          .toBeTrue();
        expect(pressKey(fallback, ' ', { repeat: true }).defaultPrevented)
          .withContext(`Space's repeat ${n}, cancelled`)
          .toBeTrue();
      }
      expect(heard).withContext('the control\'s own keydown').not.toHaveBeenCalled();
      expect(clicked).withContext('presses').not.toHaveBeenCalled();
    });

    it('lets go once the key comes up', () => {
      handOff();
      keyup('Enter');

      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after the key came up').toBeFalse();
    });

    it('lets go on a fresh press, and leaves that press alone', () => {
      handOff();

      expect(keydown(' ', false).defaultPrevented).withContext('a fresh Space').toBeFalse();
      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after the fresh press').toBeFalse();
    });

    it('passes any other key, and keeps standing through it', () => {
      handOff();

      expect(keydown('Shift', false).defaultPrevented).withContext('a fresh Shift').toBeFalse();
      expect(keydown('Shift', true).defaultPrevented).withContext('a held Shift').toBeFalse();
      keyup('Shift');
      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after Shift').toBeTrue();
    });

    it('stands one guard however many hand-offs arm it', () => {
      const added = spyOn(window, 'addEventListener').and.callThrough();
      const removed = spyOn(window, 'removeEventListener').and.callThrough();
      handOff();
      handOff();
      handOff();

      // A capture listener is one whichever way its options say so.
      const capturing = (options: unknown): boolean =>
        options === true || (typeof options === 'object' && (options as AddEventListenerOptions | null)?.capture === true);
      const listening = (spy: jasmine.Spy, type: string): number =>
        spy.calls.allArgs().filter(([each, , options]) => each === type && capturing(options)).length;
      for (const type of ['keydown', 'keyup']) {
        expect(listening(added, type) - listening(removed, type)).withContext(`${type} listeners standing`).toBe(1);
      }
    });
  });

  describe('once its component is gone', () => {
    it('asks for no render, and throws nothing', () => {
      fixture.destroy();

      expect(() => focusWhenRendered(probe.context, '.fallback')).not.toThrow();
    });

    it('cancels a hand-off the render had yet to run', () => {
      const landing = document.body.appendChild(document.createElement('button'));
      landing.className = 'detached-landing';
      try {
        elsewhere.focus();
        focusWhenRendered({ ...probe.context, host: document.body }, '.detached-landing');
        fixture.destroy();
        TestBed.tick();

        expect(document.activeElement).withContext('focus, where it was').toBe(elsewhere);
      } finally {
        landing.remove();
      }
    });

    it('lets go of the guard its hand-off stood', () => {
      handOff();
      fixture.destroy();

      expect(keydown('Enter', true).defaultPrevented).withContext('a repeat, after the component went').toBeFalse();
    });
  });
});
