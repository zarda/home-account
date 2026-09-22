import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { GoalContributeDialogComponent } from './goal-contribute-dialog.component';
import { Goal } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { createTranslationStub } from '../../../../core/services/testing';

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

describe('GoalContributeDialogComponent', () => {
  let fixture: ComponentFixture<GoalContributeDialogComponent>;
  let component: GoalContributeDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalContributeDialogComponent>>;

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

/**
 * The cases above override the template to `<div></div>` and set `direction`
 * and `amount` on the instance directly, so nothing proves that the toggle
 * group and the number field are actually bound to them, that the confirm
 * button is gated on `isValid`, or that the header's close-X reaches
 * `onCancel`. Those are the only ways a user reaches any of it.
 */
describe('GoalContributeDialogComponent, through its own template', () => {
  let fixture: ComponentFixture<GoalContributeDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalContributeDialogComponent>>;

  const el = () => fixture.nativeElement as HTMLElement;
  const amountInput = () => el().querySelector('input[type="number"]') as HTMLInputElement;
  const toggle = (value: string) =>
    el().querySelector(`mat-button-toggle[value="${value}"] button`) as HTMLButtonElement;
  const action = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  function typeAmount(value: string): void {
    const input = amountInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [GoalContributeDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { goal } },
        { provide: TranslationService, useValue: createTranslationStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GoalContributeDialogComponent);
  });

  it('names the goal and its currency so the amount has a unit', () => {
    fixture.detectChanges();

    expect(el().querySelector('.goal-name')?.textContent?.trim()).toBe('Emergency fund');
    expect(el().querySelector('[matTextSuffix], .mat-mdc-form-field-text-suffix')?.textContent?.trim())
      .toBe('USD');
    expect(el().querySelector('mat-label')?.textContent?.trim()).toBe('goal.contributionAmount');
  });

  it('keeps confirm disabled until a positive amount is typed', () => {
    fixture.detectChanges();
    expect(action('common.confirm')?.disabled).toBeTrue();

    typeAmount('0');
    expect(action('common.confirm')?.disabled).toBeTrue();

    typeAmount('25.5');
    expect(action('common.confirm')?.disabled).toBeFalse();
  });

  it('closes with the typed amount when confirmed', () => {
    fixture.detectChanges();
    typeAmount('25.5');

    action('common.confirm')?.click();

    expect(dialogRef.close).toHaveBeenCalledWith(25.5);
  });

  it('negates the amount once the withdraw toggle is chosen', () => {
    fixture.detectChanges();
    typeAmount('10');

    toggle('withdraw').click();
    fixture.detectChanges();
    action('common.confirm')?.click();

    expect(dialogRef.close).toHaveBeenCalledWith(-10);
  });

  it('starts on add, and says so to a screen reader', async () => {
    fixture.detectChanges();
    // `[(ngModel)]` writes its initial value through a microtask, so the
    // toggle group is still unselected on the first change-detection pass.
    await fixture.whenStable();
    fixture.detectChanges();

    // A single-select toggle group is a radio group, so the state a screen
    // reader reads is aria-checked, not aria-pressed.
    expect(toggle('add').getAttribute('aria-checked')).toBe('true');
    expect(toggle('withdraw').getAttribute('aria-checked')).toBe('false');
  });

  it('closes with nothing from cancel and from the header close', () => {
    fixture.detectChanges();
    action('common.cancel')?.click();
    expect(dialogRef.close).toHaveBeenCalledWith();

    dialogRef.close.calls.reset();
    (el().querySelector('.dialog-header-close') as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
