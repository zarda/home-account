import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { GoalProgressCardComponent } from './goal-progress-card.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { Goal } from '../../../../models';

describe('GoalProgressCardComponent', () => {
  let fixture: ComponentFixture<GoalProgressCardComponent>;
  let component: GoalProgressCardComponent;

  function goal(overrides: Partial<Goal> = {}): Goal {
    return {
      id: 'g1',
      userId: 'user123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides
    };
  }

  beforeEach(async () => {
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrency.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount}`
    );

    await TestBed.configureTestingModule({
      imports: [GoalProgressCardComponent, NoopAnimationsModule],
      providers: [{ provide: CurrencyService, useValue: mockCurrency }],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalProgressCardComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(GoalProgressCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('goal', goal());
    fixture.detectChanges();
  });

  it('computes percentage, capped bar value, and remaining', () => {
    expect(component.percentage()).toBe(25);
    expect(component.barValue()).toBe(25);
    expect(component.remaining()).toBe(2250);
    expect(component.reached()).toBeFalse();
  });

  it('caps the bar at 100 but keeps the true percentage', () => {
    fixture.componentRef.setInput('goal', goal({ contributedAmount: 4500 }));
    fixture.detectChanges();

    expect(component.percentage()).toBe(150);
    expect(component.barValue()).toBe(100);
    expect(component.remaining()).toBe(0);
    expect(component.reached()).toBeTrue();
  });

  it('counts checked items for a project', () => {
    fixture.componentRef.setInput(
      'goal',
      goal({
        kind: 'project',
        items: [
          { name: 'Flights', amount: 800, done: true },
          { name: 'Hotel', amount: 1200, done: false }
        ]
      })
    );
    fixture.detectChanges();

    expect(component.doneCount()).toBe(1);
    expect(component.kindIcon()).toBe('flag');
  });

  it('emits toggleItem with the item position and next state', () => {
    const emitted: { index: number; done: boolean }[] = [];
    component.toggleItem.subscribe(event => emitted.push(event));

    component.onItemToggled(1, true);

    expect(emitted).toEqual([{ index: 1, done: true }]);
  });
});
