import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { GoalsComponent } from './goals.component';
import { GoalService } from '../../../core/services/goal.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CreateGoalDTO, Goal } from '../../../models';

describe('GoalsComponent', () => {
  let fixture: ComponentFixture<GoalsComponent>;
  let component: GoalsComponent;
  let mockGoalService: jasmine.SpyObj<GoalService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let notifications: jasmine.SpyObj<NotificationService>;

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

    await TestBed.configureTestingModule({
      imports: [GoalsComponent, NoopAnimationsModule],
      providers: [
        { provide: GoalService, useValue: mockGoalService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: mockTranslation }
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
});
