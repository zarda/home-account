import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { GoalContributeDialogComponent } from './goal-contribute-dialog.component';
import { Goal } from '../../../../models';

describe('GoalContributeDialogComponent', () => {
  let fixture: ComponentFixture<GoalContributeDialogComponent>;
  let component: GoalContributeDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalContributeDialogComponent>>;

  const goal: Goal = {
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
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [GoalContributeDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { goal } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalContributeDialogComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(GoalContributeDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('closes with a positive amount when adding', () => {
    component.amount = 25.5;
    component.onConfirm();

    expect(dialogRef.close).toHaveBeenCalledWith(25.5);
  });

  it('closes with a negated amount when withdrawing', () => {
    component.direction = 'withdraw';
    component.amount = 10;
    component.onConfirm();

    expect(dialogRef.close).toHaveBeenCalledWith(-10);
  });

  it('refuses zero and missing amounts', () => {
    component.amount = 0;
    expect(component.isValid).toBeFalse();

    component.amount = null;
    expect(component.isValid).toBeFalse();

    component.onConfirm();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
