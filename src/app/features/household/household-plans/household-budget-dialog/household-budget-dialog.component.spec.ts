import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatSelect } from '@angular/material/select';
import { Timestamp } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import {
  HouseholdBudgetDialogComponent,
  HouseholdBudgetDialogData
} from './household-budget-dialog.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { HouseholdError } from '../../../../core/services/household.service';
import { HouseholdBudgetInput } from '../../../../core/services/household-plans.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { createTranslationStub } from '../../../../core/services/testing';
import { defaultCategories } from '../../../../core/utils/category-merge.utils';
import { defaultBudgetStart } from '../../../../core/utils/transaction-date.utils';
import { HouseholdBudget } from '../../../../models';
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
  readSubscripts
} from '../household-plan-dialog.testing';
import { PLAN_DIALOG_CONFIG } from '../household-plan-form';

const GEN = Timestamp.fromMillis(1_700_000_000_000);

const STORED: HouseholdBudget = {
  id: 'b1',
  gen: GEN,
  name: 'Groceries',
  categoryIds: ['food', 'shopping_clothingAndFashion'],
  amount: 400,
  currency: 'EUR',
  period: 'weekly',
  startDate: Timestamp.fromDate(new Date(2026, 8, 6)),
  endDate: Timestamp.fromDate(new Date(2026, 11, 31)),
  alertThreshold: 75,
  isActive: true,
  createdBy: 'kai',
  createdAt: GEN,
  updatedAt: GEN
};

const EXPENSE_IDS = defaultCategories().filter(category => category.type === 'expense').map(category => category.id);
const INCOME_ID = defaultCategories().find(category => category.type === 'income')!.id;

describe('HouseholdBudgetDialogComponent', () => {
  let fixture: ComponentFixture<HouseholdBudgetDialogComponent>;
  let component: HouseholdBudgetDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<HouseholdBudgetDialogComponent>>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error'>>;
  let save: jasmine.Spy<(input: HouseholdBudgetInput) => Promise<void>>;

  function create(data: Partial<HouseholdBudgetDialogData> = {}): void {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { currency: 'USD', save, ...data } });
    fixture = TestBed.createComponent(HouseholdBudgetDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** A budget every control accepts. */
  function fillValid(): void {
    component.form.patchValue({
      name: '  Food for the house  ',
      categoryIds: ['food', 'bills_electricity'],
      amount: 600
    });
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    save = jasmine.createSpy('save').and.resolveTo(undefined);

    await TestBed.configureTestingModule({
      imports: [HouseholdBudgetDialogComponent],
      providers: [
        provideNoopAnimations(),
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
              { code: 'EUR', nameKey: 'currencies.eur', symbol: '€' },
              { code: 'JPY', nameKey: 'currencies.jpy', symbol: '¥' }
            ]
          }
        }
      ]
    }).compileComponents();
  });

  describe('a new budget', () => {
    beforeEach(() => create());

    it("starts in the viewer's base currency, monthly, from the start of this month, with no category", () => {
      const value = component.form.getRawValue();
      expect(value.currency).toBe('USD');
      expect(component.form.controls.currency.enabled).toBeTrue();
      expect(value.period).toBe('monthly');
      expect(value.startDate).toEqual(defaultBudgetStart('monthly', new Date()));
      expect(value.endDate).toBeNull();
      expect(value.alertThreshold).toBeNull();
      expect(value.categoryIds).toEqual([]);
    });

    it('saves exactly what was entered, the name trimmed and an empty end date and threshold as none, then closes', async () => {
      fillValid();
      component.form.patchValue({ currency: 'JPY', alertThreshold: 90 });

      await component.submit();

      expect(save).toHaveBeenCalledOnceWith({
        name: 'Food for the house',
        categoryIds: ['food', 'bills_electricity'],
        amount: 600,
        currency: 'JPY',
        period: 'monthly',
        startDate: defaultBudgetStart('monthly', new Date()),
        endDate: null,
        alertThreshold: 90
      });
      expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
    });

    it("moves an untouched start date to the chosen period's own start", () => {
      component.form.controls.period.setValue('yearly');
      expect(component.form.controls.startDate.value).toEqual(defaultBudgetStart('yearly', new Date()));

      const chosen = new Date(2026, 4, 3);
      component.form.controls.startDate.setValue(chosen);
      component.form.controls.startDate.markAsDirty();
      component.form.controls.period.setValue('weekly');
      expect(component.form.controls.startDate.value).toEqual(chosen);
    });

    it('offers every built-in expense category, groups included, and nothing else', () => {
      expect(component.categories.map(option => option.id)).toEqual(EXPENSE_IDS);
      expect(component.categories.find(option => option.id === 'food')?.group).toBeTrue();
      expect(component.categories.find(option => option.id === 'food_groceries')?.group).toBeFalse();
    });

    it('says an empty threshold warns at the default the section applies, 80%', () => {
      // The section warns at 80% for a budget that names no threshold
      // (household-plans.component.spec, "from the default threshold").
      const hints = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-hint'))
        .map(each => each.textContent?.trim());
      expect(hints).toContain('household.planForm.thresholdHint:{"default":80}');
    });
  });

  describe('its category options', () => {
    const categorySelect = (): MatSelect =>
      fixture.debugElement.queryAll(By.directive(MatSelect))
        .find(node => (node.nativeElement as HTMLElement).getAttribute('formControlName') === 'categoryIds')!
        .injector.get(MatSelect);

    /** The element that paints an option's name: the parent of its text. */
    function nameNode(option: HTMLElement, name: string): HTMLElement {
      const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim() === name) return node.parentElement!;
      }
      throw new Error(`no text "${name}" in the option`);
    }

    function openPanel(): void {
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLElement>('mat-select[formControlName="categoryIds"] .mat-mdc-select-trigger')!
        .click();
      fixture.detectChanges();
    }

    beforeEach(() => create());

    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    // The viewValue is what typeahead matches in the open list; an icon nested
    // in a wrapper put its ligature in front of every name.
    it('names each option by its category alone', () => {
      const options = categorySelect().options.toArray();
      expect(options.length).toBe(EXPENSE_IDS.length);
      expect(options.map(option => option.viewValue))
        .toEqual(options.map(option => component.names().get(option.value as string)!));
    });

    it('sets a group in bold and its categories in the regular weight', () => {
      // A pin: `.category-group` still bolds the name now that it sits on the option, not the wrapper.
      openPanel();
      const option = (id: string): HTMLElement =>
        categorySelect().options.find(each => each.value === id)!._getHostElement();

      const group = nameNode(option('food'), component.names().get('food')!);
      const category = nameNode(option('food_groceries'), component.names().get('food_groceries')!);
      expect(getComputedStyle(group).fontWeight).toBe('600');
      expect(getComputedStyle(category).fontWeight).not.toBe('600');
    });

    it('sizes each option icon at --text-lg, a square of it', () => {
      // A pin: `mat-option > mat-icon` keeps the size the icon had inside its old wrapper.
      openPanel();
      const probe = document.createElement('span');
      probe.style.fontSize = 'var(--text-lg)';
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).fontSize;
      probe.remove();

      const icons = Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-select-panel mat-option mat-icon'));
      expect(icons.length).toBe(EXPENSE_IDS.length);
      for (const icon of icons) {
        const style = getComputedStyle(icon);
        expect(style.fontSize).toBe(expected);
        expect(style.width).toBe(expected);
        expect(style.height).toBe(expected);
      }
    });
  });

  it('cannot be closed while its save is on its way, and closes once it is stored', async () => {
    create();
    fillValid();
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

  it('keeps focus on its save while the save is on its way, and once it is refused', async () => {
    create();
    fillValid();
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    try {
      let refuse!: (error: unknown) => void;
      save.and.returnValue(new Promise<void>((_, reject) => (refuse = reject)));
      const saveButton = element.querySelector<HTMLButtonElement>('.plan-dialog-save')!;
      saveButton.focus();

      const saving = component.submit();
      fixture.detectChanges();
      // Focus fixup runs as the page next renders.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(document.activeElement).withContext('while the save is on its way').toBe(saveButton);

      refuse(new HouseholdError('household.errors.refused'));
      await saving;
      fixture.detectChanges();
      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.refused');
      expect(document.activeElement).withContext('once it is refused').toBe(saveButton);
    } finally {
      element.remove();
    }
  });

  it('names the chosen categories joined as the language joins a list', () => {
    TestBed.overrideProvider(TranslationService, {
      useValue: createTranslationStub({
        t: (key: string, params?: Record<string, string | number>) =>
          key === 'transactions.share.separator' ? '、' : params ? `${key}:${JSON.stringify(params)}` : key
      })
    });
    create();
    component.form.controls.categoryIds.setValue(['food', 'bills_electricity']);

    const names = component.names();
    expect(component.chosenNames()).toBe(`${names.get('food')}、${names.get('bills_electricity')}`);
  });

  it("keeps focus inside the dialog, on the end date's own input, once its clear button has gone with the date", () => {
    create({ budget: STORED });
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    try {
      const clear = element.querySelector<HTMLButtonElement>('.plan-dialog-clear-date')!;
      clear.focus();
      // A key press on it is a click too, and the click reaches its form
      // field, which focuses the field's input before the button goes.
      clear.click();
      fixture.detectChanges();

      expect(component.form.controls.endDate.value).toBeNull();
      expect(element.querySelector('.plan-dialog-clear-date')).withContext('the clear button goes').toBeNull();
      expect(document.activeElement).toBe(element.querySelector('input[formcontrolname=endDate]'));
    } finally {
      element.remove();
    }
  });

  describe('its checks', () => {
    beforeEach(() => {
      create();
      fillValid();
    });

    it('takes a name of 1 to 100 characters once trimmed', () => {
      const name = component.form.controls.name;
      name.setValue('   ');
      expect(name.hasError('required')).toBeTrue();
      name.setValue('N'.repeat(101));
      expect(name.hasError('tooLong')).toBeTrue();
      name.setValue(` ${'N'.repeat(100)} `);
      expect(name.valid).toBeTrue();
    });

    it('takes only a limit above zero', () => {
      const amount = component.form.controls.amount;
      for (const bad of [null, 0, -5]) {
        amount.setValue(bad);
        expect(amount.hasError('positive')).withContext(String(bad)).toBeTrue();
      }
      amount.setValue(0.01);
      expect(amount.valid).toBeTrue();
    });

    it('takes 1 to 10 categories, each a built-in expense category', () => {
      const categories = component.form.controls.categoryIds;
      categories.setValue([]);
      expect(categories.hasError('required')).toBeTrue();
      categories.setValue(EXPENSE_IDS.slice(0, 11));
      expect(categories.hasError('tooMany')).toBeTrue();
      categories.setValue(EXPENSE_IDS.slice(0, 10));
      expect(categories.valid).toBeTrue();
      categories.setValue(['food', 'my-tea-shop']);
      expect(categories.hasError('builtInOnly')).toBeTrue();
      categories.setValue(['food', INCOME_ID]);
      expect(categories.hasError('builtInOnly')).toBeTrue();
    });

    it('takes an end date only on or after the start, and a threshold of 1 to 100 percent', () => {
      const { startDate, endDate, alertThreshold } = component.form.controls;
      startDate.setValue(new Date(2026, 8, 10));
      endDate.setValue(new Date(2026, 8, 9));
      expect(endDate.hasError('endBeforeStart')).toBeTrue();
      endDate.setValue(new Date(2026, 8, 10));
      expect(endDate.valid).toBeTrue();
      // A later start judges the end again.
      startDate.setValue(new Date(2026, 8, 11));
      expect(endDate.hasError('endBeforeStart')).toBeTrue();

      for (const bad of [0, 101]) {
        alertThreshold.setValue(bad);
        expect(alertThreshold.valid).withContext(String(bad)).toBeFalse();
      }
      alertThreshold.setValue(100);
      expect(alertThreshold.valid).toBeTrue();
    });

    it('sends nothing while anything is wrong, and shows why', async () => {
      component.form.controls.categoryIds.setValue([]);

      await component.submit();
      fixture.detectChanges();

      expect(save).not.toHaveBeenCalled();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('household.errors.planCategories');
    });
  });

  describe('editing', () => {
    beforeEach(() => create({ budget: STORED }));

    it('opens on the budget as stored, its currency fixed', () => {
      expect(component.form.getRawValue()).toEqual({
        name: 'Groceries',
        categoryIds: ['food', 'shopping_clothingAndFashion'],
        amount: 400,
        currency: 'EUR',
        period: 'weekly',
        startDate: STORED.startDate.toDate(),
        endDate: STORED.endDate!.toDate(),
        alertThreshold: 75
      });
      expect(component.form.controls.currency.disabled).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('household.planForm.currencyFixed');
    });

    it('keeps its start date when the period changes', () => {
      component.form.controls.period.setValue('monthly');
      expect(component.form.controls.startDate.value).toEqual(STORED.startDate.toDate());
    });

    it('saves its stored currency, a cleared end date and threshold as none', async () => {
      component.form.patchValue({ endDate: null, alertThreshold: null });

      await component.submit();

      expect(save).toHaveBeenCalledOnceWith(jasmine.objectContaining({ currency: 'EUR', endDate: null, alertThreshold: null }));
    });
  });

  describe('when the save is refused', () => {
    beforeEach(() => {
      create();
      fillValid();
    });

    it("stays open with what was entered, saying the service's own words", async () => {
      save.and.rejectWith(new HouseholdError('household.errors.planCategories'));

      await component.submit();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.planCategories');
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(component.form.controls.name.value).toBe('  Food for the house  ');
      expect(component.saving()).toBeFalse();
    });

    it('says something went wrong for a failure the service did not word', async () => {
      save.and.rejectWith(new Error('boom'));

      await component.submit();

      expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  it("keeps every field inside the dialog at a phone's width, the chosen categories wrapping", async () => {
    // 375px less the page's 16px gutters. Karma serves none of the app's
    // fonts, so the face is pinned to the runner's (docs/testing.md).
    const ref = TestBed.inject(MatDialog).open(HouseholdBudgetDialogComponent, {
      ...PLAN_DIALOG_CONFIG,
      maxWidth: '343px',
      data: { currency: 'USD', save }
    });
    try {
      ref.componentInstance.form.patchValue({ categoryIds: EXPENSE_IDS.slice(0, 10) });
      TestBed.tick();
      await firstValueFrom(ref.afterOpened());
      const container = document.querySelector<HTMLElement>('.mat-mdc-dialog-container') as HTMLElement;
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      container.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        container.style.setProperty(token, face);
      }
      TestBed.tick();

      const content = container.querySelector('.plan-dialog-content') as HTMLElement;
      const box = content.getBoundingClientRect();
      expect(box.width).toBeLessThanOrEqual(343);
      expect(content.scrollWidth).withContext('the content scrolls sideways').toBeLessThanOrEqual(content.clientWidth);
      const parts = Array.from(container.querySelectorAll<HTMLElement>('mat-form-field, .plan-dialog-row, .mat-mdc-dialog-actions button'));
      expect(parts.length).toBeGreaterThan(8);
      for (const part of parts) {
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${part.className} starts inside`).toBeGreaterThanOrEqual(box.left - 0.5);
        expect(rect.right).withContext(`${part.className} ends inside`).toBeLessThanOrEqual(box.right + 0.5);
      }
      const chosen = container.querySelector('.plan-dialog-categories .mat-mdc-select-value-text') as HTMLElement;
      expect(chosen.textContent).toContain('categoryNames.food');
      expect(getComputedStyle(chosen).whiteSpace).withContext('the names wrap, never ending in an ellipsis').toBe('normal');
      expect(chosen.getBoundingClientRect().right).toBeLessThanOrEqual(box.right + 0.5);
    } finally {
      ref.close();
      TestBed.tick();
    }
  });

  it("keeps each hint inside its own field at a phone's width, a wrapped hint pushing the next row down", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const dialog = await openPlanDialog(HouseholdBudgetDialogComponent, { currency: 'USD', save }, { maxWidth: PLAN_PHONE_WIDTH });
    try {
      const hints = readSubscripts(dialog.container);
      expect(hints.map(hint => hint.text)).toEqual([
        'Up to 10. A group counts every category in it.',
        'A percentage of the limit. Leave it empty to warn at 80%.'
      ]);
      expect(hints[0].lines).withContext('the Categories hint wraps at this width').toBeGreaterThan(1);
      for (const hint of hints) {
        expect(hint.overrun).withContext(`"${hint.text}" runs past its own field`).toBeLessThanOrEqual(0.5);
      }
      const categories = dialog.container.querySelector('.plan-dialog-categories mat-hint') as HTMLElement;
      const row = dialog.container.querySelector('.plan-dialog-row') as HTMLElement;
      expect(categories.getBoundingClientRect().bottom)
        .withContext('the Categories hint ends above the limit and its currency')
        .toBeLessThanOrEqual(row.getBoundingClientRect().top + 0.5);
    } finally {
      dialog.close();
    }
  });

  it("keeps every error inside its own field at a phone's width, at every font scale", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const data = { currency: 'USD', save };
    const errors = (container: HTMLElement) => readSubscripts(container).filter(subscript => subscript.kind === 'error');
    const readings = [
      // Every field with a check of its own wrong at once, the end before the start.
      ...(await readAtEveryScale(HouseholdBudgetDialogComponent, data, errors, budget => {
        budget.form.patchValue({ name: '', categoryIds: [], amount: 0, endDate: new Date(2000, 0, 1), alertThreshold: 150 });
        budget.form.markAllAsTouched();
      })),
      // What the first cannot show beside it: no start, and a category no budget counts.
      ...(await readAtEveryScale(HouseholdBudgetDialogComponent, data, errors, budget => {
        budget.form.patchValue({ categoryIds: [INCOME_ID], startDate: null });
        budget.form.markAllAsTouched();
      }))
    ];
    expect(new Set(readings.map(reading => reading.text))).toEqual(
      new Set([
        'Enter a name of up to 100 characters.',
        'Choose from 1 to 10 categories.',
        'Enter an amount greater than zero.',
        "The end can't be before the start.",
        'Enter a percentage from 1 to 100.',
        'Choose the date it starts on.',
        'Choose only from the categories listed.'
      ])
    );
    for (const reading of readings) {
      expect(reading.overrun)
        .withContext(`"${reading.text}" at scale ${reading.scale} runs past its own field`)
        .toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps a one-line row under every field while nothing is wrong, at every font scale', async () => {
    const readings = await readAtEveryScale(HouseholdBudgetDialogComponent, { currency: 'USD', save }, readReservedRows);
    expect(readings.length).toBe(3 * 8);
    for (const reading of readings) {
      expect(reading.height).withContext(`the row under ${reading.field} at scale ${reading.scale}`).toBeGreaterThanOrEqual(19.5);
    }
  });

  it("draws the limit's outline at the currency's height beside it while nothing is wrong", async () => {
    const dialog = await openPlanDialog(HouseholdBudgetDialogComponent, { currency: 'USD', save }, { maxWidth: PLAN_PHONE_WIDTH });
    try {
      const row = readAmountRow(dialog.container);
      expect(Math.abs(row.amountOutline - row.currencyOutline))
        .withContext(`the limit's outline (${row.amountOutline}px) against the currency's (${row.currencyOutline}px)`)
        .toBeLessThanOrEqual(0.5);
    } finally {
      dialog.close();
    }
  });

  it("keeps the limit's error inside its own field at a phone's width, the wrapped error pushing the period down", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const dialog = await openPlanDialog(
      HouseholdBudgetDialogComponent,
      { currency: 'USD', save },
      { maxWidth: PLAN_PHONE_WIDTH },
      {
        prepare: budget => {
          budget.form.controls.amount.setValue(0);
          budget.form.controls.amount.markAsTouched();
        }
      }
    );
    try {
      const error = readSubscripts(dialog.container).find(subscript => subscript.text === 'Enter an amount greater than zero.');
      const row = readAmountRow(dialog.container);
      expect(error?.lines).withContext('the error wraps beside the currency').toBeGreaterThan(1);
      expect(error?.overrun).withContext('the error runs past the limit').toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.amountOutline - row.currencyOutline))
        .withContext(`the limit's outline (${row.amountOutline}px) against the currency's (${row.currencyOutline}px)`)
        .toBeLessThanOrEqual(0.5);
      // The row's own height holds this whether or not the currency stretches
      // with it; checked so the period stays below the error.
      expect(error?.bottom).withContext('the error ends above the period').toBeLessThanOrEqual(row.nextFieldTop + 0.5);
    } finally {
      dialog.close();
    }
  });

  it("shows the limit's and the currency's floated labels whole at a phone's width, at every font scale", async () => {
    TestBed.overrideProvider(TranslationService, { useValue: englishTranslationStub() });
    const readings = await measureAmountRowLabels(HouseholdBudgetDialogComponent, { currency: 'USD', save }, dialog =>
      dialog.form.patchValue({ amount: 600 })
    );
    expect(readings.length).toBe(6);
    for (const reading of readings) {
      const where = `the ${reading.field} label at scale ${reading.scale}`;
      expect(reading.floated).withContext(`${where} floats`).toBeTrue();
      expect(reading.scrollWidth).withContext(`${where} is cut`).toBeLessThanOrEqual(reading.clientWidth);
    }
  });

  it('keeps Cancel and Create in view in a dialog too short for its fields, the fields scrolling between the title and them', async () => {
    const reading = await measurePinnedActions(HouseholdBudgetDialogComponent, { currency: 'USD', save });
    expect(reading.contentScrolls).withContext('the fields scroll inside the content').toBeTrue();
    expect(reading.surfaceScrolls).withContext('the surface scrolls, taking the actions with it').toBeFalse();
    expect(reading.actionsOutside).withContext('actions out of view').toEqual([]);
    expect(reading.shortestAction).withContext('the 40px floor').toBeGreaterThanOrEqual(40);
  });

  for (const theme of PLAN_AUDIT_THEMES) {
    it(`opens named by its title, and gives axe nothing to report with a field in error, in the ${theme}`, async () => {
      const audit = await auditPlanDialog(HouseholdBudgetDialogComponent, { currency: 'USD', save }, theme, dialog => {
        dialog.form.controls.name.setValue('');
        dialog.form.controls.name.markAsTouched();
      });
      expect(audit.labelledByTitle).toBeTrue();
      expect(audit.violations).toEqual([]);
    });
  }
});
