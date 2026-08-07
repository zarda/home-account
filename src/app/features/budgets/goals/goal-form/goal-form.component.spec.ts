import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { GoalFormComponent, GoalFormDialogData } from './goal-form.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { CreateGoalDTO, Goal } from '../../../../models';

describe('GoalFormComponent', () => {
  let fixture: ComponentFixture<GoalFormComponent>;
  let component: GoalFormComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalFormComponent>>;

  const savedGoal: Goal = {
    id: 'g1',
    userId: 'user123',
    kind: 'project',
    name: 'Japan trip',
    targetAmount: 2000,
    contributedAmount: 500,
    currency: 'USD',
    targetDate: Timestamp.fromDate(new Date(2027, 3, 1)),
    items: [
      { name: 'Flights', amount: 800, done: true },
      { name: 'Hotel', amount: 1200, done: false }
    ],
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  async function create(data: GoalFormDialogData): Promise<void> {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    const mockAuth = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({ preferences: { baseCurrency: 'USD' } })
    });
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies']);
    mockCurrency.getSupportedCurrencies.and.returnValue([
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'EUR', name: 'Euro', symbol: '€' }
    ]);
    const mockTranslation = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [GoalFormComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: AuthService, useValue: mockAuth },
        { provide: CurrencyService, useValue: mockCurrency },
        { provide: TranslationService, useValue: mockTranslation }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalFormComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(GoalFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('add mode', () => {
    beforeEach(async () => {
      await create({ mode: 'add' });
    });

    it('starts as a saving goal in the base currency', () => {
      expect(component.form.value.kind).toBe('saving');
      expect(component.form.value.currency).toBe('USD');
      expect(component.form.valid).toBeFalse();
    });

    it('submits a DTO without optional fields when none are set', () => {
      component.form.patchValue({ name: 'Emergency fund', targetAmount: 3000 });

      component.onSubmit();

      expect(dialogRef.close).toHaveBeenCalled();
      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.kind).toBe('saving');
      expect(dto.name).toBe('Emergency fund');
      expect(dto.targetAmount).toBe(3000);
      expect(dto.targetDate).toBeUndefined();
      expect(dto.items).toBeUndefined();
      expect(dto.note).toBeUndefined();
    });

    it('adds and removes item rows and copies their total into the target', () => {
      component.addItem();
      component.addItem();
      component.items.at(0).patchValue({ name: 'Flights', amount: 800 });
      component.items.at(1).patchValue({ name: 'Hotel', amount: 1200 });

      component.useItemsTotal();
      expect(component.form.value.targetAmount).toBe(2000);

      component.removeItem(1);
      component.useItemsTotal();
      expect(component.form.value.targetAmount).toBe(800);
    });

    it('carries the item rows on submit with done defaulting to false', () => {
      component.form.patchValue({ name: 'Japan trip', kind: 'project', targetAmount: 2000 });
      component.addItem();
      component.items.at(0).patchValue({ name: 'Flights', amount: 800 });

      component.onSubmit();

      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.items).toEqual([{ name: 'Flights', amount: 800, done: false }]);
    });

    it('refuses to submit while invalid', () => {
      component.onSubmit();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    beforeEach(async () => {
      await create({ mode: 'edit', goal: savedGoal });
    });

    it('patches every field from the goal, keeping item done flags', () => {
      expect(component.form.value.kind).toBe('project');
      expect(component.form.value.name).toBe('Japan trip');
      expect(component.form.value.targetAmount).toBe(2000);
      expect(component.form.value.targetDate).toEqual(new Date(2027, 3, 1));
      expect(component.items.length).toBe(2);

      component.onSubmit();

      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.items?.[0]).toEqual({ name: 'Flights', amount: 800, done: true });
    });

    it('emits null when a stored target date is cleared', () => {
      component.form.patchValue({ targetDate: null });

      component.onSubmit();

      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.targetDate).toBeNull();
    });

    it('replaces the items with an empty list when all rows are removed', () => {
      component.removeItem(1);
      component.removeItem(0);

      component.onSubmit();

      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.items).toEqual([]);
    });
  });
});
