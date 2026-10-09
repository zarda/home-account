import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { DashboardCardMenuComponent } from './dashboard-card-menu.component';
import { DashboardLayoutService } from '../dashboard-layout.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DASHBOARD_CARD_IDS, DashboardCardId, DashboardLayout } from '../../../models';
import { createTranslationStub, provideNoMotion } from '../../../core/services/testing';

// The cards' own titles, so a name or an announcement reads as the card.
const TITLES: Record<string, string> = {
  'dashboard.recentTransactions': 'Recent Transactions',
  'dashboard.upcomingBills': 'Upcoming Bills',
  'dashboard.spendingByCategory': 'Spending by Category',
  'ai.insights': 'AI Insights',
  'dashboard.budgetProgress': 'Budget Progress',
};

describe('DashboardCardMenuComponent', () => {
  let fixture: ComponentFixture<DashboardCardMenuComponent>;
  let layout: jasmine.SpyObj<DashboardLayoutService>;
  let announcer: jasmine.SpyObj<AnnouncerService>;
  let accountLayout: WritableSignal<DashboardLayout>;

  /** A save that fails, as the service's run does: rejected after it reverts. */
  function failedSave(): Promise<void> {
    const save = Promise.reject(new Error('offline'));
    save.catch(() => undefined);
    return save;
  }

  const settle = () => new Promise(resolve => setTimeout(resolve));

  const reverted = (key: string) =>
    announcer.announce.calls.allArgs().map(([text]) => text).filter(text => text.startsWith(key));

  const trigger = () => fixture.nativeElement.querySelector('.card-menu-trigger') as HTMLButtonElement;
  const item = (action: string) =>
    document.querySelector(`.mat-mdc-menu-panel [data-action="${action}"]`) as HTMLButtonElement | null;

  function render(card: DashboardCardId, visible: DashboardCardId[]): void {
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('visible', visible);
    fixture.detectChanges();
  }

  /** The panel renders into the CDK overlay, outside the fixture. */
  function openMenu(): void {
    trigger().click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    accountLayout = signal<DashboardLayout>({ order: [...DASHBOARD_CARD_IDS], hidden: [] });
    layout = jasmine.createSpyObj('DashboardLayoutService', ['hide', 'moveVisible'], { layout: accountLayout });
    layout.hide.and.resolveTo();
    layout.moveVisible.and.resolveTo();
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    await TestBed.configureTestingModule({
      imports: [DashboardCardMenuComponent],
      providers: [
        provideNoMotion(),
        { provide: DashboardLayoutService, useValue: layout },
        { provide: AnnouncerService, useValue: announcer },
        {
          provide: TranslationService,
          useValue: createTranslationStub({
            t: (key: string, params?: Record<string, string | number>) =>
              params ? `${key}:${JSON.stringify(params)}` : (TITLES[key] ?? key),
          }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardCardMenuComponent);
    // Attached, so the trigger has a box to measure.
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  it("names its trigger for the card, through the shared 'more actions for' sentence", () => {
    render('recent', ['recent', 'upcoming']);

    expect(trigger().getAttribute('aria-label'))
      .toBe('common.moreActionsFor:{"description":"Recent Transactions"}');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
  });

  // At density 0 every icon button is 40 px already. A denser theme shrinks
  // them all through this token, set on an ancestor the way the theme sets it
  // on <html> (density -3 emits 28 px); the trigger keeps its 40 px.
  it('keeps the trigger a 40 px target under a denser theme', () => {
    fixture.nativeElement.style.setProperty('--mat-icon-button-state-layer-size', '28px');
    render('chart', ['chart']);

    const box = trigger().getBoundingClientRect();
    expect(box.width).withContext('width').toBe(40);
    expect(box.height).withContext('height').toBe(40);
  });

  it('offers Hide, Move up and Move down, in that order', () => {
    render('upcoming', ['recent', 'upcoming', 'chart']);
    openMenu();

    // The label alone: the item's icon sits beside it, and its ligature is text.
    const labels = Array.from(document.querySelectorAll('.mat-mdc-menu-panel .mat-mdc-menu-item-text'))
      .map(label => label.textContent?.trim());
    expect(labels).toEqual(['dashboard.cardMenuHide', 'dashboard.cardMenuMoveUp', 'dashboard.cardMenuMoveDown']);
  });

  it('hides its card through the layout service, says so, and tells the dashboard', () => {
    render('upcoming', ['recent', 'upcoming', 'chart']);
    let hidden = 0;
    fixture.componentInstance.cardHidden.subscribe(() => hidden++);
    openMenu();

    item('hide')!.click();

    expect(layout.hide).toHaveBeenCalledOnceWith('upcoming');
    expect(announcer.announce).toHaveBeenCalledOnceWith('dashboard.cardHidden:{"card":"Upcoming Bills"}');
    expect(hidden).toBe(1);
  });

  // Recent and upcoming come before chart in the stored order, but neither
  // is shown here, so chart is first.
  it('disables Move up on the first of the visible cards, not of the stored order', () => {
    render('chart', ['chart', 'budgets']);
    openMenu();

    expect(item('up')!.disabled).withContext('up').toBeTrue();
    expect(item('down')!.disabled).withContext('down').toBeFalse();
  });

  it('disables Move down on the last of the visible cards', () => {
    render('budgets', ['chart', 'budgets']);
    openMenu();

    expect(item('up')!.disabled).withContext('up').toBeFalse();
    expect(item('down')!.disabled).withContext('down').toBeTrue();
  });

  it('moves over the visible cards and announces the position among them', () => {
    // Upcoming and insights stand between chart and budgets in the order,
    // and render nothing.
    render('chart', ['recent', 'chart', 'budgets']);
    openMenu();

    item('down')!.click();

    expect(layout.moveVisible).toHaveBeenCalledOnceWith('chart', 1, ['recent', 'chart', 'budgets']);
    expect(announcer.announce).toHaveBeenCalledOnceWith(
      'settings.dashboardCardMoved:{"card":"Spending by Category","position":3,"total":3}',
      'polite',
      'replace'
    );
  });

  // Both announcements go out before the save settles. A failed save puts
  // the layout back, and a screen-reader user who heard the first one is told
  // what is true now (accessibility.md, "Announcements"). The move's
  // correction waits for the fallback to render, so `visible` is the cards
  // back on the page.
  it('announces where the card is back when its move fails, once for the failed save', async () => {
    layout.moveVisible.and.returnValue(failedSave());
    render('chart', ['recent', 'chart', 'budgets']);

    openMenu();
    item('down')!.click();
    openMenu();
    item('down')!.click();
    await settle();
    TestBed.tick();

    expect(reverted('settings.dashboardCardMoveReverted')).toEqual([
      'settings.dashboardCardMoveReverted:{"card":"Spending by Category","position":2,"total":3}',
    ]);
  });

  it('says nothing more of a failed move that left the card where it was said to be', async () => {
    layout.moveVisible.and.returnValue(failedSave());
    render('chart', ['recent', 'chart', 'budgets']);
    openMenu();
    item('down')!.click();
    await settle();

    // The fallback still holds the move: it landed before a later write failed.
    fixture.componentRef.setInput('visible', ['recent', 'budgets', 'chart']);
    TestBed.tick();

    expect(reverted('settings.dashboardCardMoveReverted')).toEqual([]);
  });

  it('says the card is back when its hide fails', async () => {
    layout.hide.and.returnValue(failedSave());
    render('upcoming', ['recent', 'upcoming', 'chart']);
    openMenu();

    item('hide')!.click();
    await settle();

    expect(announcer.announce.calls.mostRecent().args)
      .toEqual(['dashboard.cardHideReverted:{"card":"Upcoming Bills"}']);
  });

  it('says nothing more of a failed hide that left the card hidden', async () => {
    layout.hide.and.returnValue(failedSave());
    // The hide's own write landed before a later one in the save failed.
    accountLayout.set({ order: [...DASHBOARD_CARD_IDS], hidden: ['upcoming'] });
    render('upcoming', ['recent', 'upcoming', 'chart']);
    openMenu();

    item('hide')!.click();
    await settle();

    expect(reverted('dashboard.cardHideReverted')).toEqual([]);
  });

  it('says nothing more when the save lands', async () => {
    render('chart', ['recent', 'chart', 'budgets']);
    openMenu();
    item('down')!.click();
    openMenu();
    item('hide')!.click();
    await settle();

    expect(announcer.announce.calls.allArgs().map(([text]) => text.split(':')[0]))
      .toEqual(['settings.dashboardCardMoved', 'dashboard.cardHidden']);
  });

  it('counts a move up the same way', () => {
    render('budgets', ['recent', 'chart', 'budgets']);
    openMenu();

    item('up')!.click();

    expect(layout.moveVisible).toHaveBeenCalledOnceWith('budgets', -1, ['recent', 'chart', 'budgets']);
    expect(announcer.announce).toHaveBeenCalledOnceWith(
      'settings.dashboardCardMoved:{"card":"Budget Progress","position":2,"total":3}',
      'polite',
      'replace'
    );
  });
});
