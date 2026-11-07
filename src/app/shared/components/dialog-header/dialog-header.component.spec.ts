import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { DialogHeaderComponent } from './dialog-header.component';
import { provideAppDialogs } from '../../../core/config/dialog.config';
import { SupportedLocale, TranslationService } from '../../../core/services/translation.service';
import {
  accessibleName,
  catalogTranslationStub,
  catalogTranslator,
  provideNoMotion,
  textLines,
} from '../../../core/services/testing';

describe('DialogHeaderComponent', () => {
  let fixture: ComponentFixture<DialogHeaderComponent>;
  let component: DialogHeaderComponent;

  const el = (selector: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [DialogHeaderComponent],
      providers: [
        { provide: TranslationService, useValue: translation },
        // The header renders mat-dialog-title, which needs a dialog ref.
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogHeaderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('titleKey', 'budget.createBudget');
    fixture.detectChanges();
  });

  it('renders the translated title', () => {
    expect(el('.dialog-header-text')!.textContent).toContain('t:budget.createBudget');
  });

  it('omits the icon unless one is given', () => {
    expect(el('.dialog-header-icon')).toBeNull();

    fixture.componentRef.setInput('icon', 'download');
    fixture.detectChanges();
    expect(el('.dialog-header-icon')!.textContent).toContain('download');
  });

  it('gives the close button an aria-label', () => {
    expect(el('.dialog-header-close')!.getAttribute('aria-label')).toBe('t:common.close');
  });

  it('emits closed when the close button is pressed', () => {
    let count = 0;
    component.closed.subscribe(() => count++);

    el('.dialog-header-close')!.click();
    expect(count).toBe(1);
  });

  it('holds only the title, glyph and words, in the element that names the dialog', () => {
    fixture.componentRef.setInput('icon', 'download');
    fixture.detectChanges();
    const title = el('[mat-dialog-title]');
    const close = el('.dialog-header-close');

    expect(title).withContext('the header renders a mat-dialog-title').not.toBeNull();
    expect(close).withContext('the header renders its close button').not.toBeNull();
    expect(accessibleName(title!)).toBe('t:budget.createBudget');
    expect(title!.contains(close)).withContext('the close button stands beside the title').toBeFalse();
  });
});

/** A dialog drawn with the shared header alone. */
@Component({
  selector: 'app-headered-dialog',
  imports: [DialogHeaderComponent, MatDialogModule],
  template: `
    <app-dialog-header [titleKey]="data.titleKey" [icon]="data.icon" />
    <mat-dialog-content></mat-dialog-content>
  `,
})
class HeaderedDialogComponent {
  readonly data = inject<{ titleKey: string; icon: string }>(MAT_DIALOG_DATA);
}

/** Karma serves no fonts, so a case that reads widths pins the runner's face (docs/testing.md). */
const RUNNER_FACE = "Verdana, 'DejaVu Sans', sans-serif";

/** The dialog the running case opened, which its afterEach closes. */
let opened: MatDialogRef<HeaderedDialogComponent> | undefined;

/**
 * Gives a describe a TestBed that opens dialogs under the app's options, in
 * `locale`'s words and with no motion, so the surface is not mid-scale when a
 * case measures it, and closes the dialog each case opened.
 */
function inRealDialogs(locale: SupportedLocale): void {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HeaderedDialogComponent],
      providers: [
        provideAppDialogs(),
        provideNoMotion(),
        { provide: TranslationService, useValue: catalogTranslationStub(locale) },
      ],
    });
  });

  afterEach(async () => {
    const ref = opened;
    opened = undefined;
    if (!ref) return;
    const closed = firstValueFrom(ref.afterClosed());
    ref.close();
    TestBed.tick();
    await closed;
  });
}

/**
 * Opens HeaderedDialogComponent `width` wide and returns its container.
 * Material's dialog stylesheet and the container's aria-labelledby come only
 * with a real dialog. openPlanDialog does the same for the household plans,
 * but it opens under PLAN_DIALOG_CONFIG and pins the fields' faces; this
 * pins the title's, which Material takes from its headline token.
 */
async function openHeadered(titleKey: string, icon: string, width = '480px'): Promise<HTMLElement> {
  const ref = TestBed.inject(MatDialog).open(HeaderedDialogComponent, { data: { titleKey, icon }, width });
  opened = ref;
  TestBed.tick();
  await firstValueFrom(ref.afterOpened());
  TestBed.tick();
  // By the ref's own id, so a case reads the dialog it opened.
  const container = document.getElementById(ref.id);
  if (!container) throw new Error('The dialog did not open');
  container.style.fontFamily = RUNNER_FACE;
  container.style.setProperty('--mat-sys-headline-small-font', RUNNER_FACE);
  return container;
}

const TITLES = [
  ['transactions.note', 'notes'],
  ['receiptViewer.title', 'receipt_long'],
  ['transactions.share.title', 'group_add'],
] as const;

for (const locale of ['en', 'ja', 'tc'] as const) {
  describe(`DialogHeaderComponent in a real dialog, in ${locale}`, () => {
    const t = catalogTranslator(locale, { strict: true });
    inRealDialogs(locale);

    for (const [titleKey, icon] of TITLES) {
      it(`names the ${titleKey} dialog by its title alone`, async () => {
        const container = await openHeadered(titleKey, icon);
        const title = container.querySelector<HTMLElement>('[mat-dialog-title]');

        expect(title).withContext('the header renders a mat-dialog-title').not.toBeNull();
        expect(container.getAttribute('aria-labelledby')).withContext('Material names the dialog by it').toBe(title!.id);
        expect(accessibleName(container)).toBe(t(titleKey));
      });
    }
  });
}

describe('DialogHeaderComponent in a real dialog, its row', () => {
  inRealDialogs('en');

  const parts = (container: HTMLElement) => ({
    row: container.querySelector<HTMLElement>('.dialog-header')!.getBoundingClientRect(),
    text: container.querySelector<HTMLElement>('.dialog-header-text')!,
    close: container.querySelector<HTMLElement>('.dialog-header-close')!.getBoundingClientRect(),
  });
  const centre = (rect: DOMRect): number => (rect.top + rect.bottom) / 2;

  // Pin: proved by deleting the row's ::before, its 40px strut.
  it('sets a short title midway between its start and the close button, on a 40px line (pin)', async () => {
    const { row, text, close } = parts(await openHeadered('transactions.note', 'notes'));
    const words = text.getBoundingClientRect();
    const before = words.left - (row.left + 24);

    expect(row.height).withContext('16px, the 40px line, 16px and the 1px rule').toBeCloseTo(73, 1);
    expect(close.right).withContext('the close button reaches 8px into the end padding').toBeCloseTo(row.right - 16, 1);
    expect(before).withContext('the title is set in from the start').toBeGreaterThan(8);
    expect(before).withContext('as far from the start as from the close button').toBeCloseTo(close.left - words.right, 0);
    expect(centre(words)).withContext('the title and the close button share one centre line').toBeCloseTo(centre(close), 1);
  });

  // Pin: proved by deleting the title's flex-shrink: 1.
  it('wraps a title too long for one line and keeps the close button in the row (pin)', async () => {
    const { row, text, close } = parts(await openHeadered('transactions.select.stopTitle', 'group_remove', '343px'));
    const words = text.getBoundingClientRect();

    expect(textLines(text)).withContext('the title wraps').toBeGreaterThan(1);
    expect(words.left).withContext('8px past the start padding').toBeCloseTo(row.left + 32, 1);
    expect(close.right).withContext('the close button stays in the row').toBeCloseTo(row.right - 16, 1);
    expect(row.height).withContext('the row grows with the title').toBeGreaterThan(73);
    expect(centre(words)).withContext('the title and the close button share one centre line').toBeCloseTo(centre(close), 1);
  });
});
