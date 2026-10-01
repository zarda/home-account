import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelect, MatSelectModule } from '@angular/material/select';

import { SwitchOnChoiceDirective } from './switch-on-choice.directive';

/**
 * A switcher with a choice either side of the one selected, so that any key a
 * closed select takes as a pick would change the value.
 */
@Component({
  standalone: true,
  imports: [MatFormFieldModule, MatSelectModule, SwitchOnChoiceDirective],
  template: `
    <div class="probe">
      <mat-form-field>
        <mat-label>Household</mat-label>
        <mat-select
          appSwitchOnChoice
          [value]="value()"
          [disabled]="disabled()"
          (selectionChange)="value.set($event.value)"
        >
          <mat-option value="h1">The Lins</mat-option>
          <mat-option value="h2">Flat 4B</mat-option>
          <mat-option value="h3">Farmhouse</mat-option>
        </mat-select>
      </mat-form-field>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
class SwitcherProbeComponent {
  readonly value = signal('h2');
  readonly disabled = signal(false);
}

/** Every key the directive keeps from a closed select, with the legacy keyCode Material reads. */
const PICKING_KEYS: readonly (readonly [string, number])[] = [
  ['ArrowDown', 40],
  ['ArrowUp', 38],
  ['ArrowLeft', 37],
  ['ArrowRight', 39],
  ['Home', 36],
  ['End', 35],
  ['PageUp', 33],
  ['PageDown', 34]
];

/** Material reads the legacy keyCode, which a constructed event leaves at 0. */
function keydown(key: string, keyCode: number, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  return event;
}

describe('SwitchOnChoiceDirective', () => {
  let fixture: ComponentFixture<SwitcherProbeComponent>;
  let probe: SwitcherProbeComponent;
  let host: HTMLElement;
  let select: MatSelect;
  let selectElement: HTMLElement;
  /** The keydowns that got past the select, as far as the element around it. */
  let passed: KeyboardEvent[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SwitcherProbeComponent, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(SwitcherProbeComponent);
    probe = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
    // The panel is positioned against the select, which needs a layout box.
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();

    const debug = fixture.debugElement.query(By.directive(MatSelect));
    select = debug.injector.get(MatSelect);
    selectElement = debug.nativeElement as HTMLElement;
    passed = [];
    host.querySelector('.probe')?.addEventListener('keydown', event => passed.push(event as KeyboardEvent));
    selectElement.focus();
  });

  afterEach(() => {
    select.close();
    fixture.destroy();
    host.remove();
  });

  async function press(event: KeyboardEvent): Promise<KeyboardEvent> {
    selectElement.dispatchEvent(event);
    fixture.detectChanges();
    await fixture.whenStable();
    return event;
  }

  async function closePanel(): Promise<void> {
    select.close();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  describe('on a closed select', () => {
    for (const [key, keyCode] of PICKING_KEYS) {
      it(`opens the list on ${key} instead of picking the next choice`, async () => {
        const event = await press(keydown(key, keyCode));

        expect(select.panelOpen).withContext('the list is open').toBeTrue();
        expect(probe.value()).withContext('nothing was picked').toBe('h2');
        expect(select.value).toBe('h2');
        expect(event.defaultPrevented).toBeTrue();
        expect(passed).withContext('the select never saw it').toEqual([]);
      });
    }

    for (const [label, key, init] of [
      ['a letter', 'f', {}],
      ['a capital letter', 'F', { shiftKey: true }]
    ] as const) {
      it(`opens the list on ${label} instead of typing ahead to a choice`, async () => {
        const event = await press(keydown(key, 70, init));
        // Material's typeahead picks after a pause; nothing may land after it.
        await new Promise(resolve => setTimeout(resolve, 300));
        fixture.detectChanges();

        expect(select.panelOpen).toBeTrue();
        expect(probe.value()).toBe('h2');
        expect(event.defaultPrevented).toBeTrue();
        expect(passed).toEqual([]);
      });
    }

    for (const [label, key, keyCode] of [
      ['Space', ' ', 32],
      ['Enter', 'Enter', 13]
    ] as const) {
      it(`leaves ${label} to the select, which opens its list itself`, async () => {
        await press(keydown(key, keyCode));

        expect(passed.length).withContext('the select saw it').toBe(1);
        expect(select.panelOpen).toBeTrue();
        expect(probe.value()).toBe('h2');
      });
    }

    it('leaves Alt with an arrow to the select, which opens its list itself', async () => {
      await press(keydown('ArrowDown', 40, { altKey: true }));

      expect(passed.length).toBe(1);
      expect(select.panelOpen).toBeTrue();
      expect(probe.value()).toBe('h2');
    });

    for (const [label, init] of [
      ['Ctrl', { ctrlKey: true }],
      ['Meta', { metaKey: true }]
    ] as const) {
      it(`leaves ${label} with an arrow to the select, which picks nothing with it`, async () => {
        await press(keydown('ArrowDown', 40, init));

        expect(passed.length).toBe(1);
        expect(probe.value()).toBe('h2');
        expect(select.value).toBe('h2');
      });
    }

    it("leaves a key typed while composing to the input method's", async () => {
      const event = await press(keydown('f', 70, { isComposing: true }));

      expect(passed).toEqual([event]);
    });
  });

  it('leaves every key to an open list, which moves through its choices without picking', async () => {
    await press(keydown('ArrowDown', 40));
    expect(select.panelOpen).toBeTrue();
    passed = [];

    await press(keydown('ArrowDown', 40));

    expect(passed.length).withContext('the list saw it').toBe(1);
    expect(select.panelOpen).toBeTrue();
    expect(probe.value()).toBe('h2');
    await closePanel();
  });

  it('leaves a disabled select alone', async () => {
    probe.disabled.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const event = await press(keydown('ArrowDown', 40));

    expect(passed).toEqual([event]);
    expect(event.defaultPrevented).toBeFalse();
    expect(select.panelOpen).toBeFalse();
  });

  it('stops listening once destroyed', () => {
    const open = spyOn(select, 'open');
    const heard: KeyboardEvent[] = [];
    selectElement.addEventListener('keydown', event => heard.push(event as KeyboardEvent));
    fixture.destroy();

    const event = keydown('ArrowDown', 40);
    selectElement.dispatchEvent(event);

    expect(heard).toEqual([event]);
    expect(event.defaultPrevented).toBeFalse();
    expect(open).not.toHaveBeenCalled();
  });
});
