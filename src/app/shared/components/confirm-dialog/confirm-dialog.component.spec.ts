import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';
import {
  channels,
  iconBox,
  iconSquare,
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
} from '../../../core/services/testing';
import type { Rgb } from '../../../core/utils/color-contrast.utils';

describe('ConfirmDialogComponent', () => {
  let component: ConfirmDialogComponent;
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ConfirmDialogComponent>>;

  const data: ConfirmDialogData = {
    title: 'Delete item',
    message: 'Are you sure?',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    confirmColor: 'warn',
    icon: 'delete',
  };

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and expose the injected data', () => {
    expect(component).toBeTruthy();
    expect(component.data).toBe(data);
  });

  it('onConfirm closes the dialog with true', () => {
    component.onConfirm();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('onCancel closes the dialog with false', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('renders the provided action labels', () => {
    const buttons = fixture.nativeElement.querySelectorAll('mat-dialog-actions button');
    expect(buttons[0].textContent).toContain('Keep');
    expect(buttons[1].textContent).toContain('Delete');
  });

  // A glyph fills its box only when its line box is its font size, so the
  // circle that centres the box centres the glyph.
  it('sizes its icon at --text-2xl, its box and line box the same', () => {
    const icon = fixture.nativeElement.querySelector('mat-icon') as HTMLElement;
    expect(icon?.textContent?.trim()).toBe('delete');
    expect(iconBox(icon)).toEqual(iconSquare('--text-2xl'));
  });

  describe('label fallbacks', () => {
    // Regression: the fallbacks were hardcoded English 'Cancel'/'Confirm',
    // which leaked into ja/tc locales whenever a caller omitted a label.
    // They now go through the translation pipe (raw keys render under Karma
    // because i18n assets are not served in tests).
    it('falls back to translated common.cancel / common.confirm keys', async () => {
      TestBed.resetTestingModule();
      const bareData: ConfirmDialogData = { title: 'T', message: 'M' };
      await TestBed.configureTestingModule({
        imports: [ConfirmDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MAT_DIALOG_DATA, useValue: bareData },
        ],
      }).compileComponents();
      const bareFixture = TestBed.createComponent(ConfirmDialogComponent);
      bareFixture.detectChanges();

      const buttons = bareFixture.nativeElement.querySelectorAll('mat-dialog-actions button');
      expect(buttons[0].textContent).toContain('common.cancel');
      expect(buttons[1].textContent).toContain('common.confirm');
      expect(buttons[0].textContent).not.toContain('Cancel');
      expect(buttons[1].textContent).not.toContain('Confirm');
    });
  });

  describe('type-to-confirm', () => {
    async function createWith(
      overrides: Partial<ConfirmDialogData>
    ): Promise<ComponentFixture<ConfirmDialogComponent>> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ConfirmDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { title: 'T', message: 'M', ...overrides } },
        ],
      }).compileComponents();
      const created = TestBed.createComponent(ConfirmDialogComponent);
      created.detectChanges();
      return created;
    }

    function confirmButton(f: ComponentFixture<ConfirmDialogComponent>): HTMLButtonElement {
      return f.nativeElement.querySelectorAll('mat-dialog-actions button')[1] as HTMLButtonElement;
    }

    it('renders no input when requireText is absent', async () => {
      const f = await createWith({});
      expect(f.nativeElement.querySelector('input')).toBeNull();
      expect(confirmButton(f).disabled).toBeFalse();
    });

    it('keeps confirm disabled until the required text is typed', async () => {
      const f = await createWith({ requireText: 'DELETE' });
      const input = f.nativeElement.querySelector('input') as HTMLInputElement;

      expect(confirmButton(f).disabled).toBeTrue();

      input.value = 'DELE';
      input.dispatchEvent(new Event('input'));
      f.detectChanges();

      expect(confirmButton(f).disabled).toBeTrue();
    });

    it('enables confirm on an exact match', async () => {
      const f = await createWith({ requireText: 'DELETE' });
      const input = f.nativeElement.querySelector('input') as HTMLInputElement;

      input.value = 'DELETE';
      input.dispatchEvent(new Event('input'));
      f.detectChanges();

      const confirm = confirmButton(f);
      expect(confirm.disabled).toBeFalse();
      confirm.click();
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    });
  });

  describe('colours', () => {
    const THEMES = ['light', 'dark'] as const;
    /** `undefined` is the default variant: every caller that is not destructive. */
    const VARIANTS = [
      { name: 'warn', confirmColor: 'warn' },
      { name: 'default', confirmColor: undefined },
    ] as const;

    /**
     * A fresh TestBed per variant, because the component reads its data once.
     * The host is painted with the surface Material gives the dialog
     * container (`dialog-container-color` is `surface` in M3), which is what
     * this component sits on in the app.
     */
    async function render(overrides: Partial<ConfirmDialogData>): Promise<HTMLElement> {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ConfirmDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { title: 'T', message: 'M', ...overrides } },
        ],
      }).compileComponents();
      const created = TestBed.createComponent(ConfirmDialogComponent);
      created.detectChanges();
      const host = created.nativeElement as HTMLElement;
      host.style.display = 'block';
      host.style.background = 'var(--mat-sys-surface)';
      return host;
    }

    /** `el`'s top border as painted over what lies behind it. */
    function paintedBorder(el: Element): Rgb {
      const { rgb, alpha } = channels(getComputedStyle(el).borderTopColor);
      const behind = paintedBackground(el);
      const mix = (i: 0 | 1 | 2) => Math.round(rgb[i] * alpha + behind[i] * (1 - alpha));
      return [mix(0), mix(1), mix(2)];
    }

    /**
     * The element that draws the type-to-confirm field's edge: the notched
     * outline when the input sits in a Material field, else the input's own
     * border.
     */
    function boundaryOf(input: HTMLInputElement): Element {
      return input.closest('.mat-mdc-form-field')?.querySelector('.mdc-notched-outline__leading') ?? input;
    }

    it('paints the icon at 3:1 or better on its circle, and the circle apart from the dialog, for warn and the default, in both themes', async () => {
      for (const variant of VARIANTS) {
        const host = await render({ icon: 'delete', confirmColor: variant.confirmColor });
        const icon = host.querySelector('mat-icon') as HTMLElement;
        const circle = icon.parentElement as HTMLElement;
        for (const theme of THEMES) {
          withTheme(theme, () => {
            // A 24px glyph: a graphic, and large text to axe while Karma
            // serves no icon font, so 3:1 either way.
            expect(ratio(paintedColor(icon), paintedBackground(circle)))
              .withContext(`${theme} ${variant.name} icon on its circle`)
              .toBeGreaterThanOrEqual(3);
            // Not a contrast bar: the floor a tint must clear to show as a
            // circle at all. --color-primary-light measures 1.06 on the
            // light dialog, which is why the default circle mixes its own.
            expect(ratio(paintedBackground(circle), paintedBackground(host)))
              .withContext(`${theme} ${variant.name} circle on the dialog`)
              .toBeGreaterThanOrEqual(1.1);
          });
        }
      }
    });

    it('labels the type-to-confirm field and draws its outline at 3:1 or better, in both themes', async () => {
      const host = await render({ requireText: 'DELETE' });
      const input = host.querySelector('input') as HTMLInputElement;

      expect(Array.from(input.labels ?? [], label => label.textContent?.trim()))
        .withContext('a visible label names the field')
        .toEqual(['DELETE']);

      const edge = boundaryOf(input);
      for (const theme of THEMES) {
        withTheme(theme, () => {
          expect(ratio(paintedBorder(edge), paintedBackground(edge)))
            .withContext(`${theme} field outline on the dialog`)
            .toBeGreaterThanOrEqual(3);
        });
      }
    });
  });
});
