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
import { createTranslationStub } from '../../../../core/services/testing';

const savedGoalFixture: Goal = {
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

describe('GoalFormComponent', () => {
  let fixture: ComponentFixture<GoalFormComponent>;
  let component: GoalFormComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalFormComponent>>;

  const savedGoal = savedGoalFixture;

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

  describe('the currency of a funded goal', () => {
    it('is fixed once money is against the goal', async () => {
      await create({ mode: 'edit', goal: savedGoal });

      expect(component.currencyLocked()).toBeTrue();
      expect(component.form.get('currency')?.disabled).toBeTrue();
    });

    it('still travels on submit, so the stored code is what the service sees', async () => {
      await create({ mode: 'edit', goal: savedGoal });

      component.onSubmit();

      const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
      expect(dto.currency).toBe('USD');
    });

    it('is fixed by linked transactions alone, with nothing contributed', async () => {
      await create({
        mode: 'edit',
        goal: { ...savedGoal, contributedAmount: 0, linkedAmount: 420 }
      });

      expect(component.currencyLocked()).toBeTrue();
    });

    it('stays editable on a goal that holds no money yet', async () => {
      await create({
        mode: 'edit',
        goal: { ...savedGoal, contributedAmount: 0, linkedAmount: 0 }
      });

      expect(component.currencyLocked()).toBeFalse();
      expect(component.form.get('currency')?.enabled).toBeTrue();
    });

    it('stays editable on a new goal', async () => {
      await create({ mode: 'add' });

      expect(component.currencyLocked()).toBeFalse();
      expect(component.form.get('currency')?.enabled).toBeTrue();
    });
  });
});

/**
 * The cases above override the template to `<div></div>`, so they exercise
 * the FormGroup and never the form: the validation messages, the item rows
 * the FormArray is supposed to render, the clear-date button that only
 * exists once a date is set, the currency-locked note, and the submit
 * button's own label all live in the template alone.
 */
describe('GoalFormComponent, through its own template', () => {
  let fixture: ComponentFixture<GoalFormComponent>;
  let component: GoalFormComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<GoalFormComponent>>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const errors = () =>
    Array.from(el().querySelectorAll('mat-error')).map(n => n.textContent?.trim());
  const action = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('mat-dialog-actions button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );
  const button = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  /** The datepicker renders into the CDK overlay, outside the fixture. */
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  async function render(data: GoalFormDialogData): Promise<void> {
    // Two cases render twice to compare add mode against edit mode, and the
    // dialog data is an injection token rather than an input — so the module
    // has to be torn down between them.
    TestBed.resetTestingModule();
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const currency = jasmine.createSpyObj('CurrencyService', ['getSupportedCurrencies']);
    currency.getSupportedCurrencies.and.returnValue([
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'EUR', name: 'Euro', symbol: '€' },
    ]);

    await TestBed.configureTestingModule({
      imports: [GoalFormComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ preferences: { baseCurrency: 'USD' } }) },
        },
        { provide: CurrencyService, useValue: currency },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GoalFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('titles and labels itself for a new goal', async () => {
    await render({ mode: 'add' });

    expect(text('.dialog-header-text')).toContain('goal.createGoal');
    expect(action('common.add')).toBeDefined();
    expect(action('common.save')).toBeUndefined();
  });

  it('titles and labels itself for an edit', async () => {
    await render({ mode: 'edit', goal: savedGoalFixture });

    expect(text('.dialog-header-text')).toContain('goal.editGoal');
    expect(action('common.save')).toBeDefined();
    expect((el().querySelector('input[formControlName="name"]') as HTMLInputElement).value)
      .toBe('Japan trip');
  });

  it('says why the name is required, but only once the field has been touched', async () => {
    await render({ mode: 'add' });
    expect(errors()).toEqual([]);

    const name = el().querySelector('input[formControlName="name"]') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(errors()).toContain('goal.nameRequired');
  });

  it('refuses a non-positive target in the field itself', async () => {
    await render({ mode: 'add' });

    const target = el().querySelector('input[formControlName="targetAmount"]') as HTMLInputElement;
    target.value = '0';
    target.dispatchEvent(new Event('input'));
    // Material only projects `mat-error` once the field's own error state is
    // live, which needs the control touched.
    target.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(errors()).toContain('goal.targetMustBePositive');
  });

  it('renders one row per checklist item, and adds another from the button', async () => {
    await render({ mode: 'edit', goal: savedGoalFixture });

    expect(el().querySelectorAll('.item-row').length).toBe(2);
    expect((el().querySelectorAll('input[formControlName="name"]')[1] as HTMLInputElement).value)
      .toBe('Flights');

    button('goal.addItem')?.click();
    fixture.detectChanges();

    expect(el().querySelectorAll('.item-row').length).toBe(3);
  });

  it('removes the row whose own delete button was clicked', async () => {
    await render({ mode: 'edit', goal: savedGoalFixture });

    const rows = Array.from(el().querySelectorAll('.item-row')) as HTMLElement[];
    (rows[0].querySelector('[aria-label="common.delete"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el().querySelectorAll('.item-row').length).toBe(1);
    expect(component.items.at(0).get('name')?.value).toBe('Hotel');
  });

  it('offers the items total only once there is an item to total', async () => {
    await render({ mode: 'add' });
    expect(button('goal.useItemsTotal')).toBeUndefined();

    button('goal.addItem')?.click();
    fixture.detectChanges();

    expect(button('goal.useItemsTotal')).toBeDefined();
  });

  it('offers the clear-date button only once a date is set, and clears it', async () => {
    await render({ mode: 'add' });
    expect(el().querySelector('[aria-label="goal.clearDate"]')).toBeNull();

    await render({ mode: 'edit', goal: savedGoalFixture });
    const clear = el().querySelector('[aria-label="goal.clearDate"]') as HTMLButtonElement;
    expect(clear).not.toBeNull();

    clear.click();
    fixture.detectChanges();

    expect(component.form.get('targetDate')?.value).toBeNull();
    expect(el().querySelector('[aria-label="goal.clearDate"]')).toBeNull();
  });

  it('explains a locked currency under the row rather than in the field', async () => {
    await render({ mode: 'add' });
    expect(el().textContent).not.toContain('goal.currencyLocked');

    await render({ mode: 'edit', goal: savedGoalFixture });

    expect(component.currencyLocked()).toBeTrue();
    expect(el().textContent).toContain('goal.currencyLocked');
  });

  it('submits through the form rather than only through onSubmit', async () => {
    await render({ mode: 'add' });
    const name = el().querySelector('input[formControlName="name"]') as HTMLInputElement;
    name.value = 'Emergency fund';
    name.dispatchEvent(new Event('input'));
    const target = el().querySelector('input[formControlName="targetAmount"]') as HTMLInputElement;
    target.value = '3000';
    target.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (el().querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    expect(dialogRef.close).toHaveBeenCalled();
    const dto = dialogRef.close.calls.mostRecent().args[0] as CreateGoalDTO;
    expect(dto.name).toBe('Emergency fund');
    expect(dto.targetAmount).toBe(3000);
  });

  it('closes with nothing from cancel', async () => {
    await render({ mode: 'add' });

    action('common.cancel')?.click();

    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
