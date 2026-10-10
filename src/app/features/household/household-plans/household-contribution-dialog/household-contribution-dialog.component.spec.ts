import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNativeDateAdapter } from '@angular/material/core';

import {
  HouseholdContributionDialogComponent,
  HouseholdContributionDialogData
} from './household-contribution-dialog.component';
import { HouseholdError } from '../../../../core/services/household.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { createTranslationStub, provideNoMotion } from '../../../../core/services/testing';
import { startOfDay } from '../../../../core/utils/transaction-date.utils';
import {
  PLAN_AUDIT_THEMES,
  auditPlanDialog,
  englishTranslationStub,
  measurePinnedActions,
  readAtEveryScale,
  readReservedRows,
  readSubscripts
} from '../household-plan-dialog.testing';

describe('HouseholdContributionDialogComponent', () => {
  let fixture: ComponentFixture<HouseholdContributionDialogComponent>;
  let component: HouseholdContributionDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<HouseholdContributionDialogComponent>>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error'>>;
  let save: jasmine.Spy<HouseholdContributionDialogData['save']>;

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    save = jasmine.createSpy('save').and.resolveTo(undefined);

    await TestBed.configureTestingModule({
      imports: [HouseholdContributionDialogComponent],
      providers: [
        provideNoMotion(),
        provideNativeDateAdapter(),
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { goalName: 'Holiday', currency: 'EUR', save } },
        { provide: NotificationService, useValue: notification },
        { provide: TranslationService, useValue: createTranslationStub() }
      ]
    }).compileComponents();
  });

  // Each case that renders the dialog on its own creates it. One that opens it
  // as the plans section does must not: the page injects Material's dialog
  // styles before the dialog's own, and a component created first reverses
  // that order.
  function create(): void {
    fixture = TestBed.createComponent(HouseholdContributionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it("names the goal and asks for the amount in the goal's currency, dated today", () => {
    create();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Holiday');
    expect(text).toContain('EUR');
    expect(component.form.getRawValue()).toEqual({ amount: null, date: startOfDay(new Date()) });
  });

  it('saves the amount and the date, then closes', async () => {
    create();
    const date = new Date(2026, 8, 20);
    component.form.setValue({ amount: 125.5, date });

    await component.submit();

    expect(save).toHaveBeenCalledOnceWith(125.5, date);
    expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
  });

  it('takes only an amount above zero, and needs a date', async () => {
    create();
    const { amount, date } = component.form.controls;
    for (const bad of [null, 0, -3]) {
      amount.setValue(bad);
      expect(amount.hasError('positive')).withContext(String(bad)).toBeTrue();
    }
    amount.setValue(5);
    date.setValue(null);
    expect(date.hasError('required')).toBeTrue();

    await component.submit();
    expect(save).not.toHaveBeenCalled();
  });

  it('cannot be closed while its save is on its way, and closes once it is stored', async () => {
    create();
    component.form.patchValue({ amount: 5 });
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
    component.form.patchValue({ amount: 5 });
    save.and.rejectWith(new HouseholdError('household.errors.planGone'));

    await component.submit();

    expect(notification.error).toHaveBeenCalledOnceWith('household.errors.planGone');
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.saving()).toBeFalse();
  });

  it("keeps every error inside its own field at a phone's width, at every font scale", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const readings = await readAtEveryScale(
      HouseholdContributionDialogComponent,
      { goalName: 'Holiday', currency: 'EUR', save },
      container => readSubscripts(container).filter(subscript => subscript.kind === 'error'),
      contribution => {
        contribution.form.setValue({ amount: 0, date: null });
        contribution.form.markAllAsTouched();
      }
    );
    expect(new Set(readings.map(reading => reading.text))).toEqual(
      new Set(['Enter an amount greater than zero.', 'Choose a date.'])
    );
    for (const reading of readings) {
      expect(reading.overrun)
        .withContext(`"${reading.text}" at scale ${reading.scale} runs past its own field`)
        .toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps a one-line row under every field while nothing is wrong, at every font scale', async () => {
    const readings = await readAtEveryScale(
      HouseholdContributionDialogComponent,
      { goalName: 'Holiday', currency: 'EUR', save },
      readReservedRows
    );
    expect(readings.length).toBe(3 * 2);
    for (const reading of readings) {
      expect(reading.height).withContext(`the row under ${reading.field} at scale ${reading.scale}`).toBeGreaterThanOrEqual(19.5);
    }
  });

  it('keeps Cancel and Add in view in a dialog too short for its fields, the fields scrolling between the title and them', async () => {
    const reading = await measurePinnedActions(HouseholdContributionDialogComponent, { goalName: 'Holiday', currency: 'EUR', save });
    expect(reading.contentScrolls).withContext('the fields scroll inside the content').toBeTrue();
    expect(reading.surfaceScrolls).withContext('the surface scrolls, taking the actions with it').toBeFalse();
    expect(reading.actionsOutside).withContext('actions out of view').toEqual([]);
    expect(reading.shortestAction).withContext('the 40px floor').toBeGreaterThanOrEqual(40);
  });

  for (const theme of PLAN_AUDIT_THEMES) {
    it(`opens named by its title, and gives axe nothing to report, in the ${theme}`, async () => {
      const audit = await auditPlanDialog(
        HouseholdContributionDialogComponent,
        { goalName: 'Holiday', currency: 'EUR', save },
        theme
      );
      expect(audit.labelledByTitle).toBeTrue();
      expect(audit.violations).toEqual([]);
    });
  }
});
