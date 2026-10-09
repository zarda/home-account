import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { KeyboardShortcutService } from './keyboard-shortcut.service';
import { QuickAddService } from './quick-add.service';
import { CommandPaletteComponent } from '../../shared/components/command-palette/command-palette.component';

interface FakeDialogRef {
  close: jasmine.Spy;
  afterClosed: jasmine.Spy;
  closed$: Subject<undefined>;
}

describe('KeyboardShortcutService', () => {
  let service: KeyboardShortcutService;
  let dialog: { openDialogs: unknown[]; open: jasmine.Spy };
  let quickAdd: jasmine.SpyObj<QuickAddService>;
  let openedRefs: FakeDialogRef[];

  function makeRef(): FakeDialogRef {
    const closed$ = new Subject<undefined>();
    const ref: FakeDialogRef = {
      close: jasmine.createSpy('close'),
      afterClosed: jasmine.createSpy('afterClosed').and.returnValue(closed$.asObservable()),
      closed$,
    };
    return ref;
  }

  beforeEach(() => {
    openedRefs = [];
    dialog = {
      openDialogs: [],
      open: jasmine.createSpy('open').and.callFake(() => {
        const ref = makeRef();
        openedRefs.push(ref);
        // The real MatDialog registers the dialog before returning.
        dialog.openDialogs = [...dialog.openDialogs, ref];
        return ref;
      }),
    };
    quickAdd = jasmine.createSpyObj('QuickAddService', ['openAddTransaction']);

    TestBed.configureTestingModule({
      providers: [
        KeyboardShortcutService,
        { provide: MatDialog, useValue: dialog },
        { provide: QuickAddService, useValue: quickAdd },
      ],
    });

    service = TestBed.inject(KeyboardShortcutService);
  });

  function keydownN(target: EventTarget, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'n', cancelable: true, ...overrides });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    return event;
  }

  function keydownK(target: EventTarget, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
      ...overrides,
    });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    return event;
  }

  /** Play out the close the service asked for, the way MatDialog would. */
  function settleClose(ref: FakeDialogRef): void {
    dialog.openDialogs = dialog.openDialogs.filter(open => open !== ref);
    ref.closed$.next(undefined);
  }

  it('does nothing while an IME composition is committing the key', () => {
    const event = keydownN(document.body, { isComposing: true } as unknown as KeyboardEventInit);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when a dialog is already open', () => {
    dialog.openDialogs = [{}];
    const event = keydownN(document.body);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is an input', () => {
    const input = document.createElement('input');
    const event = keydownN(input);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is a textarea', () => {
    const textarea = document.createElement('textarea');
    const event = keydownN(textarea);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is a select', () => {
    const select = document.createElement('select');
    const event = keydownN(select);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    const event = keydownN(div);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is nested inside a contenteditable region', () => {
    const container = document.createElement('div');
    container.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    container.appendChild(span);
    const event = keydownN(span);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  // Material drives mat-select, mat-menu and the selection lists with
  // first-letter typeahead, and none of those is a MatDialog — so the
  // open-dialog guard never sees them and the letter would jump the list
  // *and* open the add form. They are recognised by their ARIA roles and by
  // the overlay pane the open ones render into.
  it('does nothing when the target is inside an overlay listbox', () => {
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    listbox.appendChild(option);
    const event = keydownN(option);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  // A focused but closed mat-select trigger: the panel is not open, so there
  // is no overlay pane to find, and the host is a combobox.
  it('does nothing when the target is a closed select trigger', () => {
    const combobox = document.createElement('div');
    combobox.setAttribute('role', 'combobox');
    const event = keydownN(combobox);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is inside an open menu', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    const event = keydownN(item);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the target is inside an overlay pane', () => {
    const pane = document.createElement('div');
    pane.classList.add('cdk-overlay-pane');
    const item = document.createElement('button');
    pane.appendChild(item);
    const event = keydownN(item);

    service.handleAddHotkey(event);

    expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
  });

  it('opens the add-transaction dialog and prevents default on a clean event', () => {
    const event = keydownN(document.body);
    spyOn(event, 'preventDefault').and.callThrough();

    service.handleAddHotkey(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(quickAdd.openAddTransaction).toHaveBeenCalled();
  });

  describe('palette hotkey', () => {
    it('opens the palette at the shared dialog width', () => {
      const event = keydownK(document.body);
      spyOn(event, 'preventDefault').and.callThrough();

      service.handlePaletteHotkey(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(dialog.open).toHaveBeenCalledWith(CommandPaletteComponent, {
        width: '520px',
        maxWidth: '95vw',
      });
    });

    // Unlike the 'n' hotkey: a palette has to be summonable from a search
    // box, so a text-entry target is not a reason to stand down.
    it('opens even while the user is typing in a text field', () => {
      const input = document.createElement('input');

      service.handlePaletteHotkey(keydownK(input));

      expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('closes the open palette instead of opening a second one', () => {
      service.handlePaletteHotkey(keydownK(document.body));
      service.handlePaletteHotkey(keydownK(document.body));

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(openedRefs[0].close).toHaveBeenCalledTimes(1);
    });

    it('opens again once the palette it closed has gone', () => {
      service.handlePaletteHotkey(keydownK(document.body));
      settleClose(openedRefs[0]);

      service.handlePaletteHotkey(keydownK(document.body));

      expect(dialog.open).toHaveBeenCalledTimes(2);
    });

    it('stands down over another dialog, but still swallows the key', () => {
      dialog.openDialogs = [{}];
      const event = keydownK(document.body);
      spyOn(event, 'preventDefault').and.callThrough();

      service.handlePaletteHotkey(event);

      // The whole point of the binding is that the browser's own Ctrl/Cmd+K
      // never fires while the app is focused — including in the branch where
      // the app itself does nothing.
      expect(event.preventDefault).toHaveBeenCalled();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('leaves an IME composition alone, key and all', () => {
      const event = keydownK(document.body, {
        isComposing: true,
      } as unknown as KeyboardEventInit);
      spyOn(event, 'preventDefault').and.callThrough();

      service.handlePaletteHotkey(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('does not fold the palette into the add-hotkey guard chain', () => {
      // A palette open means a dialog is open: 'n' must stand down.
      service.handlePaletteHotkey(keydownK(document.body));

      service.handleAddHotkey(keydownN(document.body));

      expect(quickAdd.openAddTransaction).not.toHaveBeenCalled();
    });
  });

  // '?' is a printable character like 'n', so it takes the 'n' hotkey's
  // three guards rather than the palette chord's: somebody typing a question
  // mark into a field, or steering a typeahead with it, is not asking for
  // help.
  describe('shortcuts hotkey (?)', () => {
    function keydownQuestion(
      target: EventTarget,
      overrides: Partial<KeyboardEvent> = {}
    ): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: '?',
        shiftKey: true,
        cancelable: true,
        ...overrides,
      });
      Object.defineProperty(event, 'target', { value: target, configurable: true });
      return event;
    }

    it('opens the palette on its Shortcuts section and claims the key', () => {
      const event = keydownQuestion(document.body);

      service.handleHelpHotkey(event);

      expect(event.defaultPrevented).toBeTrue();
      expect(dialog.open).toHaveBeenCalledOnceWith(CommandPaletteComponent, {
        width: '520px',
        maxWidth: '95vw',
        data: { section: 'shortcuts' },
      });
    });

    it('leaves an IME composition alone, key and all', () => {
      const event = keydownQuestion(document.body, {
        isComposing: true,
      } as unknown as KeyboardEventInit);

      service.handleHelpHotkey(event);

      expect(event.defaultPrevented).toBeFalse();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('stands down over an open dialog and leaves the key to it', () => {
      dialog.openDialogs = [{}];
      const event = keydownQuestion(document.body);

      service.handleHelpHotkey(event);

      expect(event.defaultPrevented).toBeFalse();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('stands down when the target owns the typed key', () => {
      const input = document.createElement('input');
      const combobox = document.createElement('div');
      combobox.setAttribute('role', 'combobox');

      for (const target of [input, combobox]) {
        const event = keydownQuestion(target);

        service.handleHelpHotkey(event);

        expect(event.defaultPrevented).withContext(target.tagName).toBeFalse();
      }
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('never opens a second palette', () => {
      service.handleHelpHotkey(keydownQuestion(document.body));
      service.handleHelpHotkey(keydownQuestion(document.body));

      // Over a palette Ctrl/Cmd+K opened, too.
      service.handlePaletteHotkey(keydownK(document.body));
      settleClose(openedRefs[0]);
      service.handlePaletteHotkey(keydownK(document.body));
      service.handleHelpHotkey(keydownQuestion(document.body));

      expect(dialog.open).toHaveBeenCalledTimes(2);
    });

    it('opens a palette that Ctrl/Cmd+K then toggles closed', () => {
      service.handleHelpHotkey(keydownQuestion(document.body));

      service.handlePaletteHotkey(keydownK(document.body));

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(openedRefs[0].close).toHaveBeenCalledTimes(1);
    });

    it('leaves the Ctrl/Cmd+K palette without a section', () => {
      service.handleHelpHotkey(keydownQuestion(document.body));
      settleClose(openedRefs[0]);

      service.handlePaletteHotkey(keydownK(document.body));

      expect(dialog.open.calls.mostRecent().args).toEqual([
        CommandPaletteComponent,
        { width: '520px', maxWidth: '95vw' },
      ]);
    });
  });

  // The header's button is the palette's only door on a touch screen. It
  // opens the palette Ctrl/Cmd+K opens, and that is one tracked palette.
  describe('palette button (#446)', () => {
    it('opens the plain palette at the shared dialog width', () => {
      service.openPalette();

      expect(dialog.open).toHaveBeenCalledOnceWith(CommandPaletteComponent, {
        width: '520px',
        maxWidth: '95vw',
      });
    });

    it('opens a palette that Ctrl/Cmd+K then toggles closed', () => {
      service.openPalette();

      service.handlePaletteHotkey(keydownK(document.body));

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(openedRefs[0].close).toHaveBeenCalledTimes(1);
    });

    it('never opens a palette over an open dialog, its own included', () => {
      service.openPalette();
      service.openPalette();
      settleClose(openedRefs[0]);
      dialog.openDialogs = [{}];
      service.openPalette();

      expect(dialog.open).toHaveBeenCalledTimes(1);
    });
  });

  // What the header's one-time '?' hint reads: once any door has opened the
  // palette, its Shortcuts section has been on screen.
  describe('paletteOpened (#446)', () => {
    const question = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: '?', shiftKey: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: document.body, configurable: true });
      return event;
    };

    it('is false until a palette opens', () => {
      expect(service.paletteOpened()).toBeFalse();
    });

    const doors: [string, (s: KeyboardShortcutService) => void][] = [
      ['the button', s => s.openPalette()],
      ['Ctrl/Cmd+K', s => s.handlePaletteHotkey(keydownK(document.body))],
      ['?', s => s.handleHelpHotkey(question())],
    ];
    for (const [door, open] of doors) {
      it(`turns true when ${door} opens one, and stays true after it closes`, () => {
        open(service);
        settleClose(openedRefs[0]);

        expect(service.paletteOpened()).toBeTrue();
      });
    }

    it('stays false when every door stands down', () => {
      dialog.openDialogs = [{}];
      service.openPalette();
      service.handlePaletteHotkey(keydownK(document.body));
      service.handleHelpHotkey(question());

      expect(dialog.open).not.toHaveBeenCalled();
      expect(service.paletteOpened()).toBeFalse();
    });
  });
});
