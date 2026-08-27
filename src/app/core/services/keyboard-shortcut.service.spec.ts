import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { KeyboardShortcutService } from './keyboard-shortcut.service';
import { QuickAddService } from './quick-add.service';

describe('KeyboardShortcutService', () => {
  let service: KeyboardShortcutService;
  let dialog: { openDialogs: unknown[] };
  let quickAdd: jasmine.SpyObj<QuickAddService>;

  beforeEach(() => {
    dialog = { openDialogs: [] };
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

  it('opens the add-transaction dialog and prevents default on a clean event', () => {
    const event = keydownN(document.body);
    spyOn(event, 'preventDefault').and.callThrough();

    service.handleAddHotkey(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(quickAdd.openAddTransaction).toHaveBeenCalled();
  });
});
