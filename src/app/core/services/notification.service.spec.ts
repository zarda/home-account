import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { NotificationService } from './notification.service';
import { AnnouncerService } from './announcer.service';
import { TranslationService } from './translation.service';
import { provideNoMotion, styleRules } from './testing';

describe('NotificationService', () => {
  let service: NotificationService;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;

  beforeEach(() => {
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  it('opens a success snackbar with the Close action and announces politely', () => {
    service.success('Saved');

    expect(snackBar.open).toHaveBeenCalledWith('Saved', 't:common.close', {
      duration: 3000,
      panelClass: 'snackbar-success',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Saved', 'polite');
  });

  it('gives errors a longer duration and an assertive announcement', () => {
    service.error('Failed');

    expect(snackBar.open).toHaveBeenCalledWith('Failed', 't:common.close', {
      duration: 5000,
      panelClass: 'snackbar-error',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Failed', 'assertive');
  });

  it('treats info like success but with its own panel class', () => {
    service.info('Heads up');

    expect(snackBar.open).toHaveBeenCalledWith('Heads up', 't:common.close', {
      duration: 3000,
      panelClass: 'snackbar-info',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Heads up', 'polite');
  });

  it('keeps the snackbar up for the duration a caller asks for, in every tone', () => {
    service.success('Saved. 2 photos were skipped', { durationMs: 5000 });
    service.info('Saved. 1 photo failed', { durationMs: 7000 });
    service.error('1 of 3 failed. 1 set aside', { durationMs: 9000 });

    expect(snackBar.open.calls.allArgs().map(([, , config]) => config?.duration)).toEqual([5000, 7000, 9000]);
  });

  it('falls back to the tone\'s own duration when a caller names none', () => {
    service.success('Saved', {});
    service.error('Failed', {});

    expect(snackBar.open.calls.allArgs().map(([, , config]) => config?.duration)).toEqual([3000, 5000]);
  });

  it('does nothing for an empty message', () => {
    service.success('');
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(announcer.announce).not.toHaveBeenCalled();
  });
});

@Component({ selector: 'app-notice-host', template: '<p>host</p>' })
class NoticeHostComponent {}

/**
 * The one notice that carries an action, on Material's real snack bar: it
 * stays until its caller takes it down, it is heard once, and every handler
 * its handle takes hears that notice alone.
 */
describe('NotificationService: a notice with an action', () => {
  let service: NotificationService;
  let snackBar: MatSnackBar;
  let open: jasmine.Spy;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let fixture: ComponentFixture<NoticeHostComponent>;

  beforeEach(() => {
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    TestBed.configureTestingModule({
      providers: [
        provideNoMotion(),
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
      ],
    });
    service = TestBed.inject(NotificationService);
    snackBar = TestBed.inject(MatSnackBar);
    open = spyOn(snackBar, 'open').and.callThrough();
    fixture = TestBed.createComponent(NoticeHostComponent);
  });

  afterEach(async () => {
    snackBar.dismiss();
    await shown();
  });

  async function shown(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const containers = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-snack-bar-container'));

  const actionButton = (container: HTMLElement): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>('button')!;

  it('opens with its own action and no Material duration, and stays until it is taken down', async () => {
    service.withAction('Deleted Coffee', 'Undo');
    await shown();

    const [message, action, config] = open.calls.mostRecent().args;
    expect(message).toBe('Deleted Coffee');
    expect(action).toBe('Undo');
    expect(config.duration).toBeUndefined();
    expect(config.panelClass).toBe('snackbar-info');
    // Settling runs out every timer the app is waiting on, so a duration
    // would have taken it down by now.
    expect(containers().length).toBe(1);
    expect(actionButton(containers()[0]).textContent?.trim()).toBe('Undo');
  });

  it('is announced once, through the queue, with the snack bar\'s own live region quiet', async () => {
    service.withAction('Deleted Coffee', 'Undo');
    await shown();

    expect(announcer.announce).toHaveBeenCalledOnceWith('Deleted Coffee', 'polite');
    expect(open.calls.mostRecent().args[2].politeness).toBe('off');
    expect(containers()[0].querySelector('[aria-live]')?.getAttribute('aria-live')).toBe('off');
  });

  // Material's own region would have read the action's label out with the
  // message; with it quiet, the caller's announcement is what names the action.
  it('is heard as the announcement its caller gives in place of the message, still once', async () => {
    service.withAction('Deleted Coffee', 'Undo', {
      announcement: 'Deleted Coffee. Undo is available for a few seconds.',
    });
    await shown();

    expect(announcer.announce).toHaveBeenCalledOnceWith(
      'Deleted Coffee. Undo is available for a few seconds.',
      'polite'
    );
    expect(open.calls.mostRecent().args[0]).withContext('the notice still shows the message').toBe('Deleted Coffee');
  });

  it('hands its action to onAction and reports the dismissal as by its action', async () => {
    const notice = service.withAction('Deleted Coffee', 'Undo');
    const pressed = jasmine.createSpy('onAction');
    const left = jasmine.createSpy('afterDismissed');
    notice.onAction(pressed);
    notice.afterDismissed(left);
    await shown();

    actionButton(containers()[0]).click();
    expect(pressed).toHaveBeenCalledTimes(1);
    await shown();

    expect(left).toHaveBeenCalledOnceWith(true);
    expect(containers().length).toBe(0);
  });

  it('takes itself down on dismiss(), reporting a dismissal not by its action, and asks Material only once', async () => {
    const notice = service.withAction('Deleted Coffee', 'Undo');
    const ref = open.calls.mostRecent().returnValue as MatSnackBarRef<TextOnlySnackBar>;
    const takenDown = spyOn(ref, 'dismiss').and.callThrough();
    const left = jasmine.createSpy('afterDismissed');
    notice.afterDismissed(left);
    await shown();

    notice.dismiss();
    notice.dismiss();
    await shown();

    expect(takenDown).withContext('the second dismiss(), on a notice already going').toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledOnceWith(false);
    expect(containers().length).toBe(0);
  });

  it('reports the pointer or focus on it as held, once per change', async () => {
    const notice = service.withAction('Deleted Coffee', 'Undo');
    const held = jasmine.createSpy('onHold');
    notice.onHold(held);
    await shown();
    const container = containers()[0];
    const button = actionButton(container);

    container.dispatchEvent(new PointerEvent('pointerenter'));
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    container.dispatchEvent(new PointerEvent('pointerleave'));
    expect(held.calls.allArgs()).withContext('focus still holds it').toEqual([[true]]);

    // Focus moving within the notice does not let it go.
    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: container }));
    expect(held.calls.allArgs()).toEqual([[true]]);

    button.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(held.calls.allArgs()).toEqual([[true], [false]]);
  });

  it('binds every handler to its own notice', async () => {
    const first = service.withAction('Deleted Coffee', 'Undo');
    const firstPressed = jasmine.createSpy('first onAction');
    const firstLeft = jasmine.createSpy('first afterDismissed');
    const firstHeld = jasmine.createSpy('first onHold');
    first.onAction(firstPressed);
    first.afterDismissed(firstLeft);
    first.onHold(firstHeld);
    await shown();

    const second = service.withAction('Deleted Rent', 'Undo');
    const secondPressed = jasmine.createSpy('second onAction');
    const secondLeft = jasmine.createSpy('second afterDismissed');
    second.onAction(secondPressed);
    second.afterDismissed(secondLeft);
    await shown();

    // The second took the first one's place, which reports its own leaving.
    expect(firstLeft).toHaveBeenCalledOnceWith(false);
    expect(containers().length).toBe(1);

    const container = containers()[0];
    container.dispatchEvent(new PointerEvent('pointerenter'));
    first.dismiss();
    await shown();
    expect(containers().length).withContext('an earlier handle cannot take a later notice down').toBe(1);

    actionButton(container).click();
    await shown();
    expect(secondPressed).toHaveBeenCalledTimes(1);
    expect(secondLeft).toHaveBeenCalledOnceWith(true);
    expect(firstPressed).not.toHaveBeenCalled();
    expect(firstLeft).toHaveBeenCalledTimes(1);
    expect(firstHeld).not.toHaveBeenCalled();
  });

  // The phone's bottom nav sits on the viewport's bottom edge, where the
  // notice opens: the notice would cover its tabs, and its Undo would sit
  // where a thumb reaches for them. The shell marks the body while the bar
  // is shown (main-layout), and the lift is keyed on that mark.
  it('stands clear of the bottom nav while it is shown, and only then', async () => {
    // A home indicator's inset, as an iPhone reports it: the bar grows by it,
    // and a notice that cleared only the bar's 64 px would cover its tabs.
    document.documentElement.style.setProperty('--safe-bottom', '34px');
    // The bar as main-layout pins it: 64 px over the inset, on the bottom
    // edge, shown on a phone.
    const nav = document.createElement('div');
    nav.className = 'bottom-nav-container';
    nav.style.cssText = 'position: fixed; bottom: 0; left: 0; right: 0; height: calc(64px + var(--safe-bottom));';
    document.body.append(nav);
    try {
      service.withAction('Deleted Coffee', 'Undo');
      await shown();
      const [container] = containers();

      expect(container.getBoundingClientRect().bottom)
        .withContext('the notice, with the bar not shown')
        .toBeGreaterThan(nav.getBoundingClientRect().top);

      nav.classList.add('visible');
      document.body.classList.add('bottom-nav-shown');
      expect(container.getBoundingClientRect().bottom)
        .withContext("the notice's bottom edge, against the shown bar's top")
        .toBeLessThanOrEqual(nav.getBoundingClientRect().top);
    } finally {
      nav.remove();
      document.body.classList.remove('bottom-nav-shown');
      document.documentElement.style.removeProperty('--safe-bottom');
    }
  });

  // iOS 15's WebView before 15.4 does not parse :has(), and drops the whole
  // rule that holds it, so a lift keyed on one left the notice over the tabs
  // there. Every rule that moves the notice is keyed on what it reads.
  it("keys its lift over the bottom nav on a class, not on :has(), which iOS 15's first WebViews drop", () => {
    const lifts = styleRules()
      .map(({ rule }) => rule)
      .filter(rule => rule.selectorText.includes('.mat-mdc-snack-bar-container') && rule.style.marginBottom !== '');
    expect(lifts.map(rule => rule.selectorText))
      .withContext('the rules that lift the notice')
      .toEqual(['body.bottom-nav-shown .mat-mdc-snack-bar-container']);
  });
});
