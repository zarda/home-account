import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNativeDateAdapter } from '@angular/material/core';
import { Timestamp } from '@angular/fire/firestore';

import { HouseholdGoalDialogComponent, HouseholdGoalDialogData } from './household-goal-dialog.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { HouseholdError } from '../../../../core/services/household.service';
import { HouseholdGoalInput } from '../../../../core/services/household-plans.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { createTranslationStub, provideNoMotion } from '../../../../core/services/testing';
import { HouseholdGoal } from '../../../../models';
import {
  PLAN_AUDIT_THEMES,
  PLAN_PHONE_WIDTH,
  auditPlanDialog,
  englishTranslationStub,
  measureAmountRowLabels,
  measurePinnedActions,
  openPlanDialog,
  readAmountRow,
  readAtEveryScale,
  readReservedRows,
  readSubscripts,
  typeInto
} from '../household-plan-dialog.testing';

const GEN = Timestamp.fromMillis(1_700_000_000_000);

const STORED: HouseholdGoal = {
  id: 'g1',
  gen: GEN,
  name: 'Holiday',
  targetAmount: 1000,
  currency: 'EUR',
  targetDate: Timestamp.fromDate(new Date(2026, 11, 24)),
  isActive: true,
  createdBy: 'kai',
  createdAt: GEN,
  updatedAt: GEN
};

describe('HouseholdGoalDialogComponent', () => {
  let fixture: ComponentFixture<HouseholdGoalDialogComponent>;
  let component: HouseholdGoalDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<HouseholdGoalDialogComponent>>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error'>>;
  let save: jasmine.Spy<(input: HouseholdGoalInput) => Promise<void>>;

  function create(data: Partial<HouseholdGoalDialogData> = {}): void {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { currency: 'USD', save, ...data } });
    fixture = TestBed.createComponent(HouseholdGoalDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    save = jasmine.createSpy('save').and.resolveTo(undefined);

    await TestBed.configureTestingModule({
      imports: [HouseholdGoalDialogComponent],
      providers: [
        provideNoMotion(),
        provideNativeDateAdapter(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: NotificationService, useValue: notification },
        { provide: TranslationService, useValue: createTranslationStub() },
        {
          provide: CurrencyService,
          useValue: {
            getSupportedCurrencies: () => [
              { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
              { code: 'EUR', nameKey: 'currencies.eur', symbol: '€' }
            ]
          }
        }
      ]
    }).compileComponents();
  });

  describe('a new goal', () => {
    beforeEach(() => create());

    it("starts in the viewer's base currency, with no target date", () => {
      expect(component.form.getRawValue()).toEqual({ name: '', targetAmount: null, currency: 'USD', targetDate: null });
      expect(component.form.controls.currency.enabled).toBeTrue();
    });

    it('saves exactly what was entered, the name trimmed, then closes', async () => {
      const date = new Date(2027, 5, 1);
      component.form.patchValue({ name: ' Holiday ', targetAmount: 2500, currency: 'EUR', targetDate: date });

      await component.submit();

      expect(save).toHaveBeenCalledOnceWith({ name: 'Holiday', targetAmount: 2500, currency: 'EUR', targetDate: date });
      expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
    });

    it('takes a name of 1 to 100 characters once trimmed, and only a target above zero', async () => {
      const { name, targetAmount } = component.form.controls;
      name.setValue(' ');
      expect(name.hasError('required')).toBeTrue();
      name.setValue('N'.repeat(101));
      expect(name.hasError('tooLong')).toBeTrue();
      name.setValue('N'.repeat(100));
      expect(name.valid).toBeTrue();
      for (const bad of [null, 0, -1]) {
        targetAmount.setValue(bad);
        expect(targetAmount.hasError('positive')).withContext(String(bad)).toBeTrue();
      }

      await component.submit();
      expect(save).not.toHaveBeenCalled();
    });

    it('clears a target date from its own button', () => {
      component.form.controls.targetDate.setValue(new Date(2027, 0, 1));
      fixture.detectChanges();
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.plan-dialog-clear-date')!.click();
      expect(component.form.controls.targetDate.value).toBeNull();
    });

    it("keeps focus inside the dialog, on the target date's own input, once its clear button has gone with the date", () => {
      component.form.controls.targetDate.setValue(new Date(2027, 0, 1));
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;
      document.body.appendChild(element);
      try {
        const clear = element.querySelector<HTMLButtonElement>('.plan-dialog-clear-date')!;
        clear.focus();
        // A key press on it is a click too, and the click reaches its form
        // field, which focuses the field's input before the button goes.
        clear.click();
        fixture.detectChanges();

        expect(element.querySelector('.plan-dialog-clear-date')).withContext('the clear button goes').toBeNull();
        expect(document.activeElement).toBe(element.querySelector('input[formcontrolname=targetDate]'));
      } finally {
        element.remove();
      }
    });
  });

  describe('editing', () => {
    beforeEach(() => create({ goal: STORED }));

    it('opens on the goal as stored, its currency fixed, and saves that currency', async () => {
      expect(component.form.getRawValue()).toEqual({
        name: 'Holiday',
        targetAmount: 1000,
        currency: 'EUR',
        targetDate: STORED.targetDate!.toDate()
      });
      expect(component.form.controls.currency.disabled).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('household.planForm.currencyFixed');

      component.form.controls.targetDate.setValue(null);
      await component.submit();

      expect(save).toHaveBeenCalledOnceWith({ name: 'Holiday', targetAmount: 1000, currency: 'EUR', targetDate: null });
    });
  });

  it('cannot be closed while its save is on its way, and closes once it is stored', async () => {
    create();
    component.form.patchValue({ name: 'Holiday', targetAmount: 10 });
    let stored!: () => void;
    save.and.returnValue(new Promise<void>(resolve => (stored = resolve)));
    const element = fixture.nativeElement as HTMLElement;

    const saving = component.submit();
    fixture.detectChanges();
    expect(dialogRef.disableClose).withContext('Escape and the backdrop').toBeTrue();
    element.querySelector<HTMLButtonElement>('.dialog-header-close')!.click();
    component.cancel();
    expect(dialogRef.close).not.toHaveBeenCalled();
    // Said, not native: focus on either stays inside the dialog.
    expect(element.querySelector('.plan-dialog-cancel')?.getAttribute('aria-disabled')).toBe('true');
    expect(element.querySelector('.plan-dialog-save')?.getAttribute('aria-disabled')).toBe('true');
    // Both still take a press, so submit() and cancel() are what refuse it;
    // requestSubmit stands in for Enter in a field.
    element.querySelector<HTMLButtonElement>('.plan-dialog-save')!.click();
    element.querySelector<HTMLButtonElement>('.plan-dialog-cancel')!.click();
    element.querySelector('form')!.requestSubmit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).not.toHaveBeenCalled();

    stored();
    await saving;
    expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
    expect(dialogRef.disableClose).toBeFalsy();
  });

  it("stays open when the save is refused, saying the service's own words", async () => {
    create();
    component.form.patchValue({ name: 'Holiday', targetAmount: 10 });
    save.and.rejectWith(new HouseholdError('household.errors.refused'));

    await component.submit();

    expect(notification.error).toHaveBeenCalledOnceWith('household.errors.refused');
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.saving()).toBeFalse();
  });

  it("keeps every error inside its own field at a phone's width, at every font scale", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const readings = await readAtEveryScale(
      HouseholdGoalDialogComponent,
      { currency: 'USD', save },
      container => {
        typeInto(container, '[formControlName="targetDate"]', 'not a date');
        return readSubscripts(container).filter(subscript => subscript.kind === 'error');
      },
      goal => {
        goal.form.patchValue({ name: '', targetAmount: 0 });
        goal.form.markAllAsTouched();
      }
    );
    expect(new Set(readings.map(reading => reading.text))).toEqual(
      new Set(['Enter a name of up to 100 characters.', 'Enter an amount greater than zero.', 'Enter a valid date.'])
    );
    for (const reading of readings) {
      expect(reading.overrun)
        .withContext(`"${reading.text}" at scale ${reading.scale} runs past its own field`)
        .toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps a one-line row under every field while nothing is wrong, at every font scale', async () => {
    const readings = await readAtEveryScale(HouseholdGoalDialogComponent, { currency: 'USD', save }, readReservedRows);
    expect(readings.length).toBe(3 * 4);
    for (const reading of readings) {
      expect(reading.height).withContext(`the row under ${reading.field} at scale ${reading.scale}`).toBeGreaterThanOrEqual(19.5);
    }
  });

  it("draws the target's outline at the currency's height beside it while nothing is wrong", async () => {
    const dialog = await openPlanDialog(HouseholdGoalDialogComponent, { currency: 'USD', save }, { maxWidth: PLAN_PHONE_WIDTH });
    try {
      const row = readAmountRow(dialog.container);
      expect(Math.abs(row.amountOutline - row.currencyOutline))
        .withContext(`the target's outline (${row.amountOutline}px) against the currency's (${row.currencyOutline}px)`)
        .toBeLessThanOrEqual(0.5);
    } finally {
      dialog.close();
    }
  });

  it("keeps the target's error inside its own field at a phone's width, the wrapped error pushing the target date down", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const dialog = await openPlanDialog(
      HouseholdGoalDialogComponent,
      { currency: 'USD', save },
      { maxWidth: PLAN_PHONE_WIDTH },
      {
        prepare: goal => {
          goal.form.controls.targetAmount.setValue(0);
          goal.form.controls.targetAmount.markAsTouched();
        }
      }
    );
    try {
      const error = readSubscripts(dialog.container).find(subscript => subscript.text === 'Enter an amount greater than zero.');
      const row = readAmountRow(dialog.container);
      expect(error?.lines).withContext('the error wraps beside the currency').toBeGreaterThan(1);
      expect(error?.overrun).withContext('the error runs past the target').toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.amountOutline - row.currencyOutline))
        .withContext(`the target's outline (${row.amountOutline}px) against the currency's (${row.currencyOutline}px)`)
        .toBeLessThanOrEqual(0.5);
      // The row's own height holds this whether or not the currency stretches
      // with it; checked so the target date stays below the error.
      expect(error?.bottom).withContext('the error ends above the target date').toBeLessThanOrEqual(row.nextFieldTop + 0.5);
    } finally {
      dialog.close();
    }
  });

  it("shows the target's and the currency's floated labels whole at a phone's width, at every font scale", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const readings = await measureAmountRowLabels(HouseholdGoalDialogComponent, { currency: 'USD', save }, dialog =>
      dialog.form.patchValue({ targetAmount: 1000 })
    );
    expect(readings.length).toBe(6);
    for (const reading of readings) {
      const where = `the ${reading.field} label at scale ${reading.scale}`;
      expect(reading.floated).withContext(`${where} floats`).toBeTrue();
      expect(reading.scrollWidth).withContext(`${where} is cut`).toBeLessThanOrEqual(reading.clientWidth);
    }
  });

  it('keeps Cancel and Create in view in a dialog too short for its fields, the fields scrolling between the title and them', async () => {
    const reading = await measurePinnedActions(HouseholdGoalDialogComponent, { currency: 'USD', save });
    expect(reading.contentScrolls).withContext('the fields scroll inside the content').toBeTrue();
    expect(reading.surfaceScrolls).withContext('the surface scrolls, taking the actions with it').toBeFalse();
    expect(reading.actionsOutside).withContext('actions out of view').toEqual([]);
    expect(reading.shortestAction).withContext('the 40px floor').toBeGreaterThanOrEqual(40);
  });

  for (const theme of PLAN_AUDIT_THEMES) {
    it(`opens named by its title, and gives axe nothing to report, in the ${theme}`, async () => {
      const audit = await auditPlanDialog(HouseholdGoalDialogComponent, { goal: STORED, currency: 'USD', save }, theme);
      expect(audit.labelledByTitle).toBeTrue();
      expect(audit.violations).toEqual([]);
    });
  }
});
