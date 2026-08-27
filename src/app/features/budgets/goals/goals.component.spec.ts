import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Timestamp } from '@angular/fire/firestore';

import { GoalsComponent } from './goals.component';
import { GoalService } from '../../../core/services/goal.service';
import { PendingFiltersService } from '../../../core/services/pending-filters.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { CreateGoalDTO, Goal } from '../../../models';

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
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [GoalsComponent, NoopAnimationsModule],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalsComponent, {
        set: {
          template: '<div></div>',
          // MatDialogModule in the component's own imports shadows the
          // TestBed provider, so the mock must land at component level too.
          providers: [{ provide: MatDialog, useValue: mockDialog }]
        }
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
    const router = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [GoalsComponent, NoopAnimationsModule],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: PendingFiltersService, useValue: pendingFilters },
        { provide: Router, useValue: router }
      ]
    })
      .overrideComponent(GoalsComponent, {
        set: {
          // MatDialogModule in the component's own imports shadows the
          // TestBed provider, so the mock must land at component level too.
          providers: [{ provide: MatDialog, useValue: mockDialog }]
        }
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
});
