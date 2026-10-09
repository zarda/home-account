import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, EMPTY } from 'rxjs';

import { CommandPaletteComponent } from './command-palette.component';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  AUDIT_SCHEMES,
  provideNoMotion,
  runAxe,
  summarizeViolations,
  withTheme,
} from '../../../core/services/testing';
import { NAV_ITEMS, PALETTE_ONLY_ITEMS } from '../../layout/nav-items';

/**
 * English labels for the keys the palette resolves. Filtering matches the
 * *translated* label, so the fake has to hand back real words — matching on
 * the key would pass with a filter that never translated anything.
 */
const EN_LABELS: Record<string, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budgets',
  'nav.reports': 'Reports',
  'nav.ai': 'AI',
  'nav.data': 'Your Data',
  'nav.household': 'Household',
  'nav.settings': 'Settings',
  'nav.about': 'About',
  'nav.searchHistory': 'Search History',
  'nav.importFile': 'Import photos',
  'nav.importHistory': 'Import History',
  'transactions.addTransaction': 'Add Transaction',
  'ai.scanReceipt': 'Scan Receipt',
  'palette.sectionNavigate': 'Go to',
  'palette.sectionActions': 'Actions',
  'palette.sectionShortcuts': 'Keyboard shortcuts',
  'shortcuts.addTransaction': 'Add a transaction',
  'shortcuts.openPalette': 'Open or close this palette',
  'shortcuts.showShortcuts': 'Show these shortcuts',
};

describe('CommandPaletteComponent', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let component: CommandPaletteComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CommandPaletteComponent>>;
  let closed$: Subject<undefined>;
  let router: jasmine.SpyObj<Router>;
  let quickAdd: jasmine.SpyObj<QuickAddService>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let translation: jasmine.SpyObj<TranslationService>;
  let labels: Record<string, string>;
  let translationsVersion: ReturnType<typeof signal<number>>;

  beforeEach(async () => {
    labels = { ...EN_LABELS };
    closed$ = new Subject<undefined>();
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'afterClosed']);
    dialogRef.afterClosed.and.returnValue(closed$.asObservable());
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    quickAdd = jasmine.createSpyObj('QuickAddService', ['openAddTransaction', 'openScanReceipt']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    translationsVersion = signal(0);
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    (translation as unknown as { translationsVersion: unknown }).translationsVersion =
      translationsVersion;
    translation.t.and.callFake((key: string, params?: Record<string, string | number>) => {
      const label = labels[key] ?? key;
      return params ? `${label} ${JSON.stringify(params)}` : label;
    });

    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
        provideNoMotion(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommandPaletteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function searchInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input') as HTMLInputElement;
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.palette-item'));
  }

  function type(text: string): void {
    const input = searchInput();
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enterOn(
    element: HTMLElement,
    overrides: Partial<KeyboardEvent> = {}
  ): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      ...overrides,
    });
    element.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  function arrowOn(element: HTMLElement, key: 'ArrowDown' | 'ArrowUp'): void {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  it('offers every destination and both quick actions before anything is typed', () => {
    expect(component.filtered().length).toBe(NAV_ITEMS.length + PALETTE_ONLY_ITEMS.length + 2);
    expect(component.actionResults().map(command => command.labelKey)).toEqual([
      'transactions.addTransaction',
      'ai.scanReceipt',
    ]);
    expect(rows().length).toBe(component.filtered().length);
  });

  it('lists the household page among the destinations', () => {
    expect(component.navResults().map(command => command.labelKey)).toContain('nav.household');

    type('house');

    expect(component.filtered().map(command => command.labelKey)).toEqual(['nav.household']);
  });

  /**
   * Rows are buttons, never anchors: app.smoke.spec's aria-current invariant
   * walks `a.nav-item` and asserts exactly one marks itself current, so a
   * palette that navigated with links would join that set from inside a
   * dialog and fail every route.
   */
  it('renders rows as buttons rather than links', () => {
    expect(rows().length).toBeGreaterThan(0);
    for (const row of rows()) {
      expect(row.tagName).toBe('BUTTON');
    }
    expect(fixture.nativeElement.querySelectorAll('a').length).toBe(0);
  });

  it('narrows to the commands whose translated label matches the query', () => {
    type('budget');

    expect(component.filtered().map(command => command.labelKey)).toEqual(['nav.budgets']);
    expect(rows().length).toBe(1);
  });

  it('matches case-insensitively', () => {
    type('DASHboard');

    expect(component.filtered().map(command => command.labelKey)).toEqual(['nav.dashboard']);
  });

  it('finds a quick action by its label', () => {
    type('scan');

    expect(component.filtered().map(command => command.labelKey)).toEqual(['ai.scanReceipt']);
    expect(component.navResults().length).toBe(0);
  });

  it('shows the empty message when nothing matches', () => {
    type('zzzznothing');

    expect(component.filtered().length).toBe(0);
    expect(rows().length).toBe(0);
    expect(fixture.nativeElement.querySelector('.palette-empty')).toBeTruthy();
  });

  // The filter memo folds the catalog version, so switching language
  // re-labels and re-filters the open palette instead of matching the
  // previous locale's words.
  it('re-filters against the new catalog after a locale switch', () => {
    type('レポート');
    expect(component.filtered().length).toBe(0);

    labels['nav.reports'] = 'レポート';
    translationsVersion.set(1);
    fixture.detectChanges();

    expect(component.filtered().map(command => command.labelKey)).toEqual(['nav.reports']);
  });

  it('announces the result count as the query changes, each count replacing any still waiting', () => {
    type('budget');

    expect(translation.t).toHaveBeenCalledWith('palette.resultCount', { count: 1 });
    expect(announcer.announce).toHaveBeenCalledWith('palette.resultCount {"count":1}', 'polite', 'replace');
  });

  describe('selection', () => {
    it('closes before it navigates', () => {
      const dashboard = component.filtered()[0];

      component.select(dashboard);

      expect(dialogRef.close).toHaveBeenCalled();
      // Still nothing: the navigation waits for the close to finish.
      expect(router.navigate).not.toHaveBeenCalled();

      closed$.next(undefined);

      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('closes before it opens the add-transaction dialog', () => {
      const add = component.actionResults()[0];

      component.select(add);

      expect(dialogRef.close).toHaveBeenCalled();
      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();

      closed$.next(undefined);

      expect(quickAdd.openAddTransaction).toHaveBeenCalledTimes(1);
      expect(quickAdd.openScanReceipt).not.toHaveBeenCalled();
    });

    it('closes before it opens the receipt scanner', () => {
      const scan = component.actionResults()[1];

      component.select(scan);

      expect(dialogRef.close).toHaveBeenCalled();
      expect(quickAdd.openScanReceipt).not.toHaveBeenCalled();

      closed$.next(undefined);

      expect(quickAdd.openScanReceipt).toHaveBeenCalledTimes(1);
    });

    it('activates a row from a click', () => {
      type('scan');
      rows()[0].click();
      closed$.next(undefined);

      expect(quickAdd.openScanReceipt).toHaveBeenCalledTimes(1);
    });

    // The rows stay hit-testable for the whole exit transition, so without a
    // latch a double-click queues two runs on the one close — two stacked
    // add-transaction dialogs, both opened with disableClose.
    it('runs the command once however many times it is chosen', () => {
      const add = component.actionResults()[0];

      component.select(add);
      component.select(add);
      closed$.next(undefined);

      expect(dialogRef.close).toHaveBeenCalledTimes(1);
      expect(quickAdd.openAddTransaction).toHaveBeenCalledTimes(1);
    });

    it('ignores a second click on a row that already fired', () => {
      type('scan');
      rows()[0].click();
      rows()[0].click();
      closed$.next(undefined);

      expect(quickAdd.openScanReceipt).toHaveBeenCalledTimes(1);
    });

    it('does not let a second, different row overtake the first choice', () => {
      const dashboard = component.navResults()[0];
      const add = component.actionResults()[0];

      component.select(dashboard);
      component.select(add);
      closed$.next(undefined);

      expect(router.navigate).toHaveBeenCalledOnceWith(['/dashboard']);
      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
    });
  });

  // docs/shortcuts.md promises "type a few letters, Enter" — no ArrowDown
  // first.
  describe('enter in the search box', () => {
    it('runs the first result', () => {
      type('budget');

      const event = enterOn(searchInput());
      closed$.next(undefined);

      expect(event.defaultPrevented).toBeTrue();
      expect(router.navigate).toHaveBeenCalledOnceWith(['/budgets']);
    });

    it('takes the head of the filtered list, which is the top row', () => {
      const event = enterOn(searchInput());
      closed$.next(undefined);

      expect(event.defaultPrevented).toBeTrue();
      expect(router.navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    });

    it('does nothing, and swallows nothing, when the filter emptied the list', () => {
      type('zzzznothing');

      const event = enterOn(searchInput());

      expect(event.defaultPrevented).toBeFalse();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    // The Enter that commits a kana composition is text, not a command.
    it('leaves an IME composition alone', () => {
      type('budget');

      const event = enterOn(searchInput(), {
        isComposing: true,
      } as unknown as KeyboardEventInit);

      expect(event.defaultPrevented).toBeFalse();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('keyboard traversal', () => {
    it('moves real focus from the search box to the first row on ArrowDown', () => {
      searchInput().focus();

      arrowOn(searchInput(), 'ArrowDown');

      expect(document.activeElement).toBe(rows()[0]);
    });

    it('roves between rows and stops at both ends', () => {
      arrowOn(searchInput(), 'ArrowDown');
      expect(document.activeElement).toBe(rows()[0]);

      arrowOn(rows()[0], 'ArrowDown');
      expect(document.activeElement).toBe(rows()[1]);

      arrowOn(rows()[1], 'ArrowUp');
      expect(document.activeElement).toBe(rows()[0]);

      // First row, ArrowUp: nothing above it to take focus.
      arrowOn(rows()[0], 'ArrowUp');
      expect(document.activeElement).toBe(rows()[0]);

      const last = rows()[rows().length - 1];
      last.focus();
      arrowOn(last, 'ArrowDown');
      expect(document.activeElement).toBe(last);
    });

    it('leaves focus alone when the filter emptied the list', () => {
      type('zzzznothing');
      searchInput().focus();

      arrowOn(searchInput(), 'ArrowDown');

      expect(document.activeElement).toBe(searchInput());
    });
  });
});

/**
 * The Shortcuts section (#446): reference, not a command. It renders through
 * the real template, as the describe above does, and is driven by the
 * dialog's data the way KeyboardShortcutService opens it: `?` passes
 * `{section: 'shortcuts'}`, Ctrl/Cmd+K passes no data at all, so the token
 * has to be optional. `create` awaits nothing once the palette exists: the
 * section is part of the palette's own template, so it is there after the
 * first render, with no chunk that could arrive late or not at all.
 */
describe('CommandPaletteComponent, Shortcuts section (#446)', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let component: CommandPaletteComponent;
  let closed$: Subject<undefined>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CommandPaletteComponent>>;
  let router: jasmine.SpyObj<Router>;

  async function create(data?: unknown): Promise<void> {
    closed$ = new Subject<undefined>();
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close', 'afterClosed']);
    dialogRef.afterClosed.and.returnValue(closed$.asObservable());
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    (translation as unknown as { translationsVersion: unknown }).translationsVersion = signal(0);
    translation.t.and.callFake((key: string) => EN_LABELS[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
        {
          provide: QuickAddService,
          useValue: jasmine.createSpyObj('QuickAddService', ['openAddTransaction', 'openScanReceipt']),
        },
        { provide: AnnouncerService, useValue: jasmine.createSpyObj('AnnouncerService', ['announce']) },
        { provide: TranslationService, useValue: translation },
        ...(data === undefined ? [] : [{ provide: MAT_DIALOG_DATA, useValue: data }]),
        provideNoMotion(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommandPaletteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.tick();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const section = () => el().querySelector<HTMLElement>('.palette-shortcuts');
  const sectionTitles = () =>
    Array.from(el().querySelectorAll('.palette-section-title'), title => title.textContent?.trim());
  const rows = () => Array.from(el().querySelectorAll<HTMLButtonElement>('.palette-item'));
  const searchInput = () => el().querySelector('input') as HTMLInputElement;

  function type(text: string): void {
    searchInput().value = text;
    searchInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function keydown(element: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('renders without dialog data, after the commands while nothing is typed', async () => {
    await create();

    expect(section()).withContext('the section').not.toBeNull();
    expect(sectionTitles()).toEqual(['Go to', 'Actions', 'Keyboard shortcuts']);
  });

  it('opens on the section when the dialog data names it', async () => {
    await create({ section: 'shortcuts' });

    expect(sectionTitles()).toEqual(['Keyboard shortcuts', 'Go to', 'Actions']);
  });

  // A section loaded from a chunk pops in a moment after the palette on the
  // first open, and is missing from a first open made offline.
  it('is in the DOM on the very first open, after one render and nothing awaited, and stays', async () => {
    await create({ section: 'shortcuts' });

    expect(section()).withContext('the section, synchronously').not.toBeNull();
    expect(section()!.querySelectorAll('dl kbd').length).withContext('its keys').toBeGreaterThan(0);

    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(section()).withContext('once every pending task has run').not.toBeNull();
  });

  it('lists each shortcut as its keys in <kbd> beside what it does', async () => {
    await create({ section: 'shortcuts' });

    const list = section()!.querySelector('dl');
    expect(list).withContext('a description list').not.toBeNull();
    const entries = Array.from(list!.querySelectorAll('dt'), term => ({
      keys: Array.from(term.querySelectorAll('kbd'), key => key.textContent?.trim()),
      label: term.nextElementSibling?.tagName === 'DD' ? term.nextElementSibling.textContent?.trim() : null,
    }));
    expect(entries).toEqual([
      { keys: ['n'], label: 'Add a transaction' },
      // Both modifiers: there is no platform detection to pick one.
      { keys: ['Ctrl', 'K', '⌘', 'K'], label: 'Open or close this palette' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ]);
  });

  // Enter runs filtered()[0] and the arrows rove `.palette-item`: a shortcut
  // row in either would be "run" or focused as if it were a command.
  it('is never a command: no row of it is a .palette-item, focusable, or in filtered()', async () => {
    await create({ section: 'shortcuts' });

    expect(section()!.querySelectorAll('.palette-item, button, a, input, [tabindex]').length).toBe(0);
    expect(component.filtered().length).toBe(NAV_ITEMS.length + PALETTE_ONLY_ITEMS.length + 2);
    expect(component.filtered().some(command => command.labelKey.startsWith('shortcuts.'))).toBeFalse();
    expect(rows().length).toBe(component.filtered().length);
  });

  it('leaves while a query is typed and comes back when it is cleared', async () => {
    await create({ section: 'shortcuts' });

    type('budget');
    expect(section()).toBeNull();

    type('  ');
    expect(section()).not.toBeNull();
  });

  it('leaves Enter in the search box running the first command', async () => {
    await create({ section: 'shortcuts' });

    const event = keydown(searchInput(), 'Enter');
    closed$.next(undefined);

    expect(event.defaultPrevented).toBeTrue();
    expect(router.navigate).toHaveBeenCalledOnceWith(['/dashboard']);
  });

  it('leaves the arrows roving the command rows only', async () => {
    await create({ section: 'shortcuts' });

    keydown(searchInput(), 'ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);

    keydown(rows()[0], 'ArrowUp');
    expect(document.activeElement).toBe(rows()[0]);
  });

  // A pin, not a behaviour: the section is the palette's own markup on the
  // palette's own classes, so both sides read one rule. It fails only if a
  // restyled copy of the title or the section gap comes back and drifts.
  it("titles and spaces the section the way the palette does its own", async () => {
    await create();

    const [goTo, , shortcuts] = Array.from(
      el().querySelectorAll<HTMLElement>('.palette-section-title'),
      title => getComputedStyle(title)
    );
    for (const property of [
      'font-size', 'font-weight', 'text-transform', 'letter-spacing', 'color',
      'margin-block-start', 'margin-block-end',
    ]) {
      expect(shortcuts.getPropertyValue(property))
        .withContext(property)
        .toBe(goTo.getPropertyValue(property));
    }
    const sectionGap = (node: Element | null) => getComputedStyle(node!).marginBlockStart;
    expect(sectionGap(section()))
      .toBe(sectionGap(el().querySelector('.palette-section')));
  });

  // The keys sit in a fixed column, so a row with two chords wraps. A wrap
  // inside a chord leaves "⌘" at the end of one line and its "K" alone on the
  // next, which reads as two shortcuts.
  for (const width of [520, 288]) {
    it(`never splits a chord across lines at ${width} px`, async () => {
      await create({ section: 'shortcuts' });
      const host = el();
      host.style.display = 'block';
      host.style.width = `${width}px`;
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-medium-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
      try {
        for (const term of Array.from(section()!.querySelectorAll('dt'))) {
          const chords: HTMLElement[][] = [[]];
          for (const node of Array.from(term.querySelectorAll<HTMLElement>('kbd, .shortcut-or'))) {
            if (node.tagName === 'KBD') chords[chords.length - 1].push(node);
            else chords.push([]);
          }
          for (const chord of chords) {
            const tops = chord.map(key => Math.round(key.getBoundingClientRect().top));
            expect(new Set(tops).size)
              .withContext(`${chord.map(key => key.textContent).join(' ')} at ${width} px`)
              .toBe(1);
          }
          const column = term.getBoundingClientRect();
          for (const key of Array.from(term.querySelectorAll('kbd'))) {
            expect(key.getBoundingClientRect().right)
              .withContext(`${key.textContent} inside its column`)
              .toBeLessThanOrEqual(column.right + 0.5);
          }
        }
      } finally {
        host.remove();
      }
    });
  }

  it('passes the axe sweep in both schemes', async () => {
    await create({ section: 'shortcuts' });

    for (const scheme of AUDIT_SCHEMES) {
      await withTheme(scheme, async () => {
        expect(summarizeViolations(await runAxe(el())))
          .withContext(`${scheme} scheme`)
          .toEqual([]);
      });
    }
  });
});
