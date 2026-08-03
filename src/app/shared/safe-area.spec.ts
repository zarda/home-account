import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

/**
 * The shell keeps content clear of the notch, the home indicator and the
 * rounded corners by padding with `max(gutter, var(--safe-*))`. On every
 * machine CI runs on those variables resolve to 0px, so none of that
 * behaviour would otherwise be exercised until it reached a real phone.
 *
 * It is testable because every consumer reads the *variable* and never
 * `env(safe-area-inset-*)` directly. env() cannot be overridden from a
 * stylesheet or a test; a custom property can. That indirection is the only
 * reason these assertions can exist, and is why it should stay.
 *
 * The probe restates the shell's rules rather than importing MainLayout,
 * which would drag in the router, the auth service and a Firestore
 * connection to assert on four padding values. What is checked here is the
 * arithmetic — max() and not a sum, and the bottom inset owned by exactly one
 * element — which is where this has gone wrong before.
 */
@Component({
  standalone: true,
  template: `
    <div class="probe">
      <div class="content-wrapper">content</div>
      <div class="header-toolbar">header</div>
      <div class="main-container">scroller</div>
      <div class="main-container with-bottom-nav">scroller with nav</div>
    </div>
  `,
  styles: [
    `
      .probe {
        --safe-top: 44px;
        --safe-bottom: 34px;
        --safe-left: 44px;
        --safe-right: 44px;
        width: 600px;
      }

      // Mirrors main-layout.component.scss / header.component.scss.
      .content-wrapper {
        padding: 24px;
        padding-left: max(24px, var(--safe-left));
        padding-right: max(24px, var(--safe-right));
      }
      .header-toolbar {
        padding: 0 max(16px, var(--safe-right)) 0 max(16px, var(--safe-left));
      }
      .main-container:not(.with-bottom-nav) {
        padding-bottom: var(--safe-bottom);
      }
    `,
  ],
})
class SafeAreaProbeComponent {}

describe('safe-area insets', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SafeAreaProbeComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SafeAreaProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => host.remove());

  function padding(selector: string, side: 'Top' | 'Bottom' | 'Left' | 'Right'): number {
    const el = host.querySelector(selector) as HTMLElement;
    return parseFloat(getComputedStyle(el)[`padding${side}` as 'paddingTop']);
  }

  it('declares all four inset variables', () => {
    // --safe-left and --safe-right were missing while viewport-fit=cover was
    // already set, so nothing in the app cleared the landscape cutout.
    const root = getComputedStyle(document.documentElement);
    for (const name of ['--safe-top', '--safe-bottom', '--safe-left', '--safe-right']) {
      expect(root.getPropertyValue(name).trim())
        .withContext(`${name} is defined`)
        .not.toBe('');
    }
  });

  it('takes the larger of gutter and inset, never their sum', () => {
    // 44 of cutout against a 24 gutter gives 44, not 68. Adding them would
    // indent the content twice and leave a visible step beside the notch.
    expect(padding('.content-wrapper', 'Left')).toBeCloseTo(44, 0);
    expect(padding('.content-wrapper', 'Right')).toBeCloseTo(44, 0);
  });

  it('leaves a gutter wider than its inset alone', () => {
    const wide = host.querySelector('.probe') as HTMLElement;
    wide.style.setProperty('--safe-left', '8px');
    wide.style.setProperty('--safe-right', '8px');

    // 8px of inset behind a 24px gutter costs nothing: the content is already
    // clear of it, so the layout must not change at all.
    expect(padding('.content-wrapper', 'Left')).toBeCloseTo(24, 0);
    expect(padding('.header-toolbar', 'Right')).toBeCloseTo(16, 0);
  });

  it('gives the home-indicator inset exactly one owner', () => {
    // The scroller reserves the space only when there is no bottom nav.
    // Where there is one, the nav's container already paints the inset into
    // its own height, and reserving it twice would leave 34px of dead space
    // above the nav. Expressed with :not() so the two cases cannot both
    // apply — a rule plus a cancelling rule would drift the first time one
    // was edited without the other.
    expect(padding('.main-container:not(.with-bottom-nav)', 'Bottom')).toBeCloseTo(34, 0);
    expect(padding('.main-container.with-bottom-nav', 'Bottom')).toBeCloseTo(0, 0);
  });
});
