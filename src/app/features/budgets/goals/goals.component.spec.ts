import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of, EMPTY } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';

import { GoalsComponent } from './goals.component';
import { GoalService } from '../../../core/services/goal.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CreateGoalDTO, Goal } from '../../../models';
import {
  createLocaleFormatStub,
  createTranslationStub,
  expectPainted,
  inPalette,
  PALETTES,
  provideNoMotion,
  standOnThePage,
  tokenValue,
} from '../../../core/services/testing';

describe('GoalsComponent', () => {
  let fixture: ComponentFixture<GoalsComponent>;
  let component: GoalsComponent;
  let mockGoalService: jasmine.SpyObj<GoalService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let pendingFilters: jasmine.SpyObj<PendingFiltersService>;
  let router: jasmine.SpyObj<Router>;

  const storedGoal: Goal = {
    id: 'g1',
    userId: 'user123',
    kind: 'saving',
    name: 'Emergency fund',
    targetAmount: 3000,
    contributedAmount: 750,
    currency: 'USD',
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  beforeEach(async () => {
    mockGoalService = jasmine.createSpyObj(
      'GoalService',
      ['getGoals', 'createGoal', 'updateGoal', 'deleteGoal', 'contribute', 'toggleItem'],
      { goals: signal<Goal[]>([storedGoal]) }
    );
    mockGoalService.getGoals.and.returnValue(of([storedGoal]));
    mockGoalService.createGoal.and.resolveTo('new-id');
    mockGoalService.updateGoal.and.resolveTo(undefined);
    mockGoalService.deleteGoal.and.resolveTo(undefined);
    mockGoalService.contribute.and.resolveTo(undefined);
    mockGoalService.toggleItem.and.resolveTo(undefined);

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error']);

    const mockTranslation = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslation.t.and.callFake((key: string) => key);

    pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [GoalsComponent],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        provideNoMotion()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalsComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GoalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('subscribes the live goals on init', () => {
    expect(mockGoalService.getGoals).toHaveBeenCalled();
    expect(component.goals()).toEqual([storedGoal]);
  });

  it('creates a goal from the add dialog result', fakeAsync(() => {
    const dto = { kind: 'saving', name: 'Fund' } as CreateGoalDTO;
    mockDialog.open.and.returnValue({ afterClosed: () => of(dto) } as never);

    component.openAddDialog();
    tick();

    expect(mockGoalService.createGoal).toHaveBeenCalledWith(dto);
    expect(notifications.success).toHaveBeenCalled();
  }));

  it('updates a goal from the edit dialog result', fakeAsync(() => {
    const dto = { name: 'Bigger fund' } as CreateGoalDTO;
    mockDialog.open.and.returnValue({ afterClosed: () => of(dto) } as never);

    component.openEditDialog(storedGoal);
    tick();

    expect(mockGoalService.updateGoal).toHaveBeenCalledWith('g1', dto);
  }));

  it('contributes the signed amount from the contribute dialog', fakeAsync(() => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(-25) } as never);

    component.openContributeDialog(storedGoal);
    tick();

    expect(mockGoalService.contribute).toHaveBeenCalledWith('g1', -25);
    expect(notifications.success).toHaveBeenCalled();
  }));

  it('surfaces a below-zero withdrawal as an error', fakeAsync(() => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(-9000) } as never);
    mockGoalService.contribute.and.rejectWith(new Error('GOAL_CONTRIBUTION_BELOW_ZERO'));

    component.openContributeDialog(storedGoal);
    tick();

    expect(notifications.error).toHaveBeenCalled();
  }));

  it('deletes only after the confirm dialog agrees', fakeAsync(() => {
    mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

    component.deleteGoal(storedGoal);
    tick();

    expect(mockGoalService.deleteGoal).toHaveBeenCalledWith('g1');
  }));

  it('forwards item toggles to the service', fakeAsync(() => {
    component.onToggleItem(storedGoal, { index: 1, done: true });
    tick();

    expect(mockGoalService.toggleItem).toHaveBeenCalledWith('g1', 1, true);
  }));

  describe('viewTransactions', () => {
    it('hands off the goal filter and navigates to the list', () => {
      component.viewTransactions(storedGoal);

      expect(pendingFilters.apply).toHaveBeenCalledWith({ goalId: 'g1' });
      expect(router.navigate).toHaveBeenCalledWith(['/transactions']);
    });

    it('carries no date, so links from any month show', () => {
      // The page defaults to this month; only replacing the whole filter set
      // with a dateless one clears that window.
      component.viewTransactions(storedGoal);

      const applied = pendingFilters.apply.calls.mostRecent().args[0];
      expect(Object.keys(applied)).toEqual(['goalId']);
    });
  });
});

/**
 * The suite above overrides the template with a stub so it can test the
 * component in isolation; that stub can never see the empty-state wiring.
 * This suite renders the real template against an empty goal list instead.
 */
describe('GoalsComponent empty state CTA', () => {
  let fixture: ComponentFixture<GoalsComponent>;
  let component: GoalsComponent;

  beforeEach(async () => {
    const mockGoalService = jasmine.createSpyObj(
      'GoalService',
      ['getGoals'],
      { goals: signal<Goal[]>([]) }
    );
    mockGoalService.getGoals.and.returnValue(of([]));

    const mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    const notifications = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    const mockTranslation = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslation.t.and.callFake((key: string) => key);
    const pendingFilters = jasmine.createSpyObj('PendingFiltersService', ['apply']);
    const router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });

    await TestBed.configureTestingModule({
      imports: [GoalsComponent],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router },
        provideNoMotion()
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(GoalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders an add-goal action and routes it through the page\'s own add dialog', () => {
    const emptyState = fixture.debugElement.query(By.directive(EmptyStateComponent));
    expect(emptyState).withContext('empty state renders when there are no goals').toBeTruthy();

    const instance = emptyState.componentInstance as EmptyStateComponent;
    expect(instance.actionLabel).toBe('goal.addGoal');

    spyOn(component, 'openAddDialog');
    emptyState.triggerEventHandler('action', undefined);

    expect(component.openAddDialog).toHaveBeenCalled();
  });

  // The tab sits directly under the Budgets page's h1, with no heading between.
  it("heads the empty state one level under the page's own heading", () => {
    const outline = (Array.from(fixture.nativeElement.querySelectorAll('h1, h2, h3, h4, h5, h6')) as HTMLElement[])
      .map(heading => `${heading.tagName.toLowerCase()} ${heading.textContent?.trim()}`);
    expect(outline).toEqual(['h2 goal.emptyTitle']);
  });

  // #533: the tab's hint sits on the page itself, and rests in the muted
  // token, not a fade, which the high-contrast palette could never deepen.
  it('rests its hint in the muted token, at AA on the page, in all four palettes', () => {
    standOnThePage(fixture.nativeElement as HTMLElement);
    const hint = (fixture.nativeElement as HTMLElement).querySelector('.goals-hint');

    for (const palette of PALETTES) {
      inPalette(palette.classes, () => {
        const label = `${palette.name} Goals hint`;
        expect(hint ? getComputedStyle(hint).opacity : null).withContext(`${label} opacity`).toBe('1');
        expectPainted(hint, '--text-muted', label);
      });
    }
  });

  // The account's text size scales the page's root (AccessibilityService
  // writes --app-font-scale on <html>); a size in the app's type scale
  // follows it, a px size does not.
  it("sets its hint in the app's type scale, so it follows the account's text size", () => {
    const hint = (fixture.nativeElement as HTMLElement).querySelector('.goals-hint');
    const root = document.documentElement;
    const before = root.style.getPropertyValue('--app-font-scale');
    try {
      for (const scale of ['1', '1.3']) {
        root.style.setProperty('--app-font-scale', scale);
        expect(hint ? getComputedStyle(hint).fontSize : null)
          .withContext(`the hint at scale ${scale}`)
          .toBe(tokenValue('--text-sm', 'font-size'));
      }
    } finally {
      if (before) root.style.setProperty('--app-font-scale', before);
      else root.style.removeProperty('--app-font-scale');
    }
  });
});

/**
 * On a 320px phone the page leaves the Goals tab 248px, under the 300px a
 * card was given as its least width: the grid's one column ran 52px past the
 * page, Delete off the screen and Contribute cut. A column is now at most the
 * grid's own width, so the cards keep to the page at any width the grid is
 * given. The real cards render, with a View Transactions in the second.
 */
describe('GoalsComponent, its grid at a phone width', () => {
  let fixture: ComponentFixture<GoalsComponent>;

  const goals: Goal[] = [
    {
      id: 'g1',
      userId: 'user123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    {
      id: 'g2',
      userId: 'user123',
      kind: 'project',
      name: 'Japan trip',
      targetAmount: 2000,
      contributedAmount: 100,
      linkedAmount: 120,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }
  ];

  beforeEach(async () => {
    const mockGoalService = jasmine.createSpyObj('GoalService', ['getGoals'], { goals: signal<Goal[]>(goals) });
    mockGoalService.getGoals.and.returnValue(of(goals));
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    currency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    await TestBed.configureTestingModule({
      imports: [GoalsComponent],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error']) },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        { provide: CurrencyService, useValue: currency },
        { provide: PendingFiltersService, useValue: jasmine.createSpyObj('PendingFiltersService', ['apply']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY }) },
        provideNoMotion()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GoalsComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = '248px';
    fixture.detectChanges();
  });

  it('keeps every card, and every control on it, inside the 248px the tab is given', () => {
    const host = fixture.nativeElement as HTMLElement;
    const grid = host.querySelector<HTMLElement>('.goals-grid');
    expect(grid).withContext('the grid renders').not.toBeNull();
    if (!grid) return;
    const page = host.getBoundingClientRect();

    expect(grid.scrollWidth).withContext('the grid holds its cards').toBeLessThanOrEqual(grid.clientWidth);
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.goal-card'));
    expect(cards.length).withContext('one card per goal').toBe(2);
    cards.forEach((card, i) => {
      const box = card.getBoundingClientRect();
      expect(box.left).withContext(`card ${i + 1} starts on the page`).toBeGreaterThanOrEqual(page.left - 0.5);
      expect(box.right).withContext(`card ${i + 1} ends on the page`).toBeLessThanOrEqual(page.right + 0.5);
      for (const button of Array.from(card.querySelectorAll<HTMLElement>('button'))) {
        const name = button.getAttribute('aria-label') ?? button.textContent?.trim();
        expect(button.getBoundingClientRect().right)
          .withContext(`card ${i + 1}: "${name}" ends on the page`)
          .toBeLessThanOrEqual(page.right + 0.5);
      }
    });
  });
});
