import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { CommandPaletteComponent } from './command-palette.component';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
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
  'nav.settings': 'Settings',
  'nav.about': 'About',
  'nav.searchHistory': 'Search History',
  'nav.importFile': 'Import photos',
  'nav.importHistory': 'Import History',
  'transactions.addTransaction': 'Add Transaction',
  'ai.scanReceipt': 'Scan Receipt',
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
    router = jasmine.createSpyObj('Router', ['navigate']);
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
      imports: [CommandPaletteComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: Router, useValue: router },
        { provide: QuickAddService, useValue: quickAdd },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
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

  it('announces the result count as the query changes', () => {
    type('budget');

    expect(translation.t).toHaveBeenCalledWith('palette.resultCount', { count: 1 });
    expect(announcer.announce).toHaveBeenCalledWith('palette.resultCount {"count":1}');
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
