import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { provideNativeDateAdapter } from '@angular/material/core';

import {
  RecurringFormDialogComponent,
  RecurringFormDialogData
} from './recurring-form-dialog.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CategoryService } from '../../../../core/services/category.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { Category, MAX_REMINDER_LEAD_DAYS, RecurringTransaction } from '../../../../models';
import {
  AUDIT_SCHEMES,
  GLYPH_PROBE_COLOURS,
  chooseOption,
  createCategory,
  eachOptionState,
  paintedBackground,
  paintedColor,
  provideAppDatepickerForTests,
  ratio,
  withScheme,
  provideNoMotion,
} from '../../../../core/services/testing';

describe('RecurringFormDialogComponent', () => {
  let component: RecurringFormDialogComponent;
  let fixture: ComponentFixture<RecurringFormDialogComponent>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<RecurringFormDialogComponent>>;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockCurrencyService: jasmine.SpyObj<CurrencyService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  const mockCategories: Category[] = [
    {
      id: 'cat1',
      userId: null,
      name: 'Food & Drinks',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      order: 1,
      isActive: true,
      isDefault: true
    },
    {
      id: 'cat2',
      userId: null,
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      order: 1,
      isActive: true,
      isDefault: true
    }
  ];

  const mockCurrencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' }
  ];

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      currentUser: signal({
        preferences: { baseCurrency: 'USD', theme: 'light', language: 'en', dateFormat: 'MM/DD/YYYY' }
      })
    });

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories']);
    mockCategoryService.loadCategories.and.returnValue(of(mockCategories));

    mockCurrencyService = jasmine.createSpyObj('CurrencyService', [], {
      currencies: signal(mockCurrencies)
    });

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'frequency.daily': 'Daily',
        'frequency.weekly': 'Weekly',
        'frequency.monthly': 'Monthly',
        'frequency.yearly': 'Yearly',
        'settings.everyDay': 'Every day',
        'settings.everyNDays': `Every ${params?.['n']} days`,
        'settings.everyMonthOn': `Every month on the ${params?.['day']}${params?.['suffix']}`,
        'settings.everyWeekday': `Every ${params?.['day']}`,
        'settings.everyYear': 'Every year',
        'settings.addRecurring': 'Add Recurring Transaction',
        'settings.editRecurring': 'Edit Recurring Transaction',
        'days.sunday': 'Sunday',
        'days.monday': 'Monday',
        'days.tuesday': 'Tuesday',
        'days.wednesday': 'Wednesday',
        'days.thursday': 'Thursday',
        'days.friday': 'Friday',
        'days.saturday': 'Saturday'
      };
      return translations[key] || key;
    });

    await TestBed.configureTestingModule({
      imports: [RecurringFormDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: AuthService, useValue: mockAuthService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: CurrencyService, useValue: mockCurrencyService },
        { provide: TranslationService, useValue: mockTranslationService },
        provideNoMotion()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(RecurringFormDialogComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load categories on init', () => {
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should default to expense type', () => {
      expect(component.type).toBe('expense');
    });

    it('should default to monthly frequency', () => {
      expect(component.frequencyType).toBe('monthly');
    });

    it('should default interval to 1', () => {
      expect(component.interval).toBe(1);
    });

    it('should default currency to USD', () => {
      expect(component.currency).toBe('USD');
    });
  });

  describe('isEdit', () => {
    it('should return false when no recurring data', () => {
      expect(component.isEdit).toBeFalse();
    });

    it('should return true when recurring data provided', async () => {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: {
            recurring: {
              id: 'rec1',
              name: 'Test',
              type: 'expense',
              amount: 100,
              currency: 'USD',
              categoryId: 'cat1',
              description: '',
              frequency: { type: 'monthly', interval: 1 },
              startDate: Timestamp.now(),
              isActive: true
            } as RecurringTransaction
          }},
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      const editComponent = editFixture.componentInstance;
      editFixture.detectChanges();

      expect(editComponent.isEdit).toBeTrue();
    });
  });

  describe('prefill', () => {
    async function createWithPrefill(): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              prefill: {
                name: 'NETFLIX.COM',
                type: 'expense',
                amount: 15.99,
                currency: 'USD',
                categoryId: 'cat1',
                description: '',
                frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 },
                startDate: new Date(2026, 6, 15)
              }
            } satisfies RecurringFormDialogData
          },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const prefillFixture = TestBed.createComponent(RecurringFormDialogComponent);
      prefillFixture.detectChanges();
      return prefillFixture.componentInstance;
    }

    it('populates the form from a prefill', async () => {
      const prefilled = await createWithPrefill();

      expect(prefilled.name).toBe('NETFLIX.COM');
      expect(prefilled.amount).toBe(15.99);
      expect(prefilled.currency).toBe('USD');
      expect(prefilled.categoryId).toBe('cat1');
      expect(prefilled.frequencyType).toBe('monthly');
      expect(prefilled.interval).toBe(1);
      expect(prefilled.dayOfMonth).toBe(15);
      expect(prefilled.startDate).toEqual(new Date(2026, 6, 15));
    });

    it('stays in create mode with a prefill', async () => {
      const prefilled = await createWithPrefill();

      expect(prefilled.isEdit).toBeFalse();
    });
  });

  // `?? 1` read an unset day as the 1st, so an unrelated edit to a rule that
  // never named a day rewrote its schedule. The null option carries that
  // "unset" state all the way to the stored frequency map.
  describe('day of month defaults', () => {
    async function createEditComponent(
      recurring: RecurringTransaction
    ): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { recurring } },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      editFixture.detectChanges();
      return editFixture.componentInstance;
    }

    it('prefills no day for a rule that names none', async () => {
      const noDayRule = {
        id: 'rec1',
        name: 'Test',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: '',
        frequency: { type: 'monthly', interval: 1 },
        startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
        isActive: true
      } as RecurringTransaction;

      const editComponent = await createEditComponent(noDayRule);

      expect(editComponent.dayOfMonth).toBeNull();
    });

    it('omits dayOfMonth from the saved frequency for the same-day option', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      component.dayOfMonth = null;

      component.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as { frequency: Record<string, unknown> };
      expect('dayOfMonth' in result.frequency).toBeFalse();
    });

    it('switching to monthly leaves the day unset', () => {
      component.dayOfMonth = null;
      component.frequencyType = 'monthly';

      component.onFrequencyTypeChange();

      expect(component.dayOfMonth).toBeNull();
    });

    it("previews the start date's day when none is chosen", () => {
      component.frequencyType = 'monthly';
      component.interval = 1;
      component.dayOfMonth = null;
      component.startDate = new Date(2026, 6, 15);

      expect(component.frequencyPreview).toBe('Every month on the 15th');
    });

    it("a new rule defaults to the start date's day", () => {
      expect(component.dayOfMonth).toBeNull();
    });
  });

  // A stored date need not honour its declared type, and the readers refuse
  // such a rule and name this form as the place it gets put right — so this
  // is the one surface that has to open it rather than throw on it.
  describe('a rule whose stored dates cannot be read', () => {
    /** What a Timestamp field holds after a restore or a hand edit. */
    const notATimestamp = { seconds: 1, nanoseconds: 0 } as unknown as Timestamp;

    function ruleWith(dates: Partial<RecurringTransaction>): RecurringTransaction {
      return {
        id: 'rec1',
        name: 'Test',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: '',
        frequency: { type: 'monthly', interval: 1 },
        startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
        isActive: true,
        ...dates
      } as RecurringTransaction;
    }

    async function createEditComponent(
      recurring: RecurringTransaction
    ): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { recurring } },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      editFixture.detectChanges();
      return editFixture.componentInstance;
    }

    it('opens a rule whose start date cannot be read, on today', async () => {
      // Frozen, because the component reads the clock and so does the
      // assertion: a run that straddles local midnight between the two would
      // fail on the date rolling over rather than on the behaviour.
      const today = new Date(2026, 8, 19);
      jasmine.clock().install();
      try {
        jasmine.clock().mockDate(today);
        const editComponent = await createEditComponent(
          ruleWith({ startDate: notATimestamp })
        );

        expect(editComponent.startDate?.toDateString()).toBe(today.toDateString());
        // The rest of the rule still arrives, so the user is editing their own
        // rule rather than a blank form.
        expect(editComponent.name).toBe('Test');
        expect(editComponent.amount).toBe(100);
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('reads an unreadable end date as no end date', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ endDate: notATimestamp })
      );

      expect(editComponent.startDate).toEqual(new Date(2024, 0, 1));
      expect(editComponent.hasEndDate).toBeFalse();
      expect(editComponent.endDate).toBeNull();
    });
  });

  // The services refuse a day, weekday or month outside its range on every
  // path, and a refused resume names this form as the place the rule is put
  // right. A day of -60 or a weekday of 9 is what an older build, a restore or
  // a hand edit can leave behind, and a select holding a value none of its
  // options carries shows nothing while the old value rides along to the save.
  // So the form opens such a field on its fallback, and the save no longer
  // sends the stored value back.
  describe('a rule stored outside its ranges', () => {
    // 1 January 2024 fell on a Monday, which is neither the stored weekday
    // below nor the weekday that stored value wraps to.
    const START = new Date(2024, 0, 1);

    function ruleWith(frequency: RecurringTransaction['frequency']): RecurringTransaction {
      return {
        id: 'rec1',
        name: 'Test',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: '',
        frequency,
        startDate: Timestamp.fromDate(START),
        isActive: true
      } as RecurringTransaction;
    }

    async function createEditComponent(
      recurring: RecurringTransaction
    ): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { recurring } },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      editFixture.detectChanges();
      return editFixture.componentInstance;
    }

    function savedFrequency(): Record<string, unknown> {
      expect(mockDialogRef.close).toHaveBeenCalledTimes(1);
      return (mockDialogRef.close.calls.mostRecent().args[0] as { frequency: Record<string, unknown> })
        .frequency;
    }

    for (const stored of [-60, 0, 32]) {
      it(`opens a monthly rule stored on day ${stored} on the start date's day, and saves without it`, async () => {
        const editComponent = await createEditComponent(
          ruleWith({ type: 'monthly', interval: 1, dayOfMonth: stored })
        );

        expect(editComponent.dayOfMonth).toBeNull();
        expect(editComponent.frequencyPreview).toBe('Every month on the 1st');

        editComponent.save();

        expect(savedFrequency()).toEqual({ type: 'monthly', interval: 1 });
      });
    }

    it('opens a yearly rule stored on day 32 on the start date too', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'yearly', interval: 1, dayOfMonth: 32 })
      );

      expect(editComponent.dayOfMonth).toBeNull();
    });

    it('opens a day that is not a whole number on the start date too', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'monthly', interval: 1, dayOfMonth: 15.5 })
      );

      expect(editComponent.dayOfMonth).toBeNull();
    });

    it("opens a weekly rule stored on weekday 9 on the start date's weekday, and saves it", async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'weekly', interval: 1, dayOfWeek: 9 })
      );

      expect(editComponent.dayOfWeek).toBe(START.getDay());
      expect(editComponent.frequencyPreview).toContain('Monday');

      editComponent.save();

      expect(savedFrequency()).toEqual({ type: 'weekly', interval: 1, dayOfWeek: 1 });
    });

    it('opens a weekday that is not a whole number on the start date too', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'weekly', interval: 1, dayOfWeek: 2.5 })
      );

      expect(editComponent.dayOfWeek).toBe(START.getDay());
    });

    // A stored null is a weekday that is there and out of range: the services
    // and the rules refuse it the way they refuse 9, so it is not the absent
    // key the last pin below keeps. Only a raw write made before the rules
    // deploy can have stored it.
    it("opens a weekly rule stored with a null weekday on the start date's weekday, and saves it", async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'weekly', interval: 1, dayOfWeek: null as unknown as number })
      );

      expect(editComponent.dayOfWeek).toBe(START.getDay());
      expect(editComponent.frequencyPreview).toContain('Monday');

      editComponent.save();

      expect(savedFrequency()).toEqual({ type: 'weekly', interval: 1, dayOfWeek: START.getDay() });
    });

    // Pins: a value inside its range opens as itself, the ends of the range
    // included, and a weekday of 0 (Sunday) is a value and not an absence.
    it('opens a monthly rule on day 15 as day 15 (pin)', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'monthly', interval: 1, dayOfMonth: 15 })
      );

      expect(editComponent.dayOfMonth).toBe(15);
      expect(editComponent.frequencyPreview).toBe('Every month on the 15th');
    });

    it('opens the first and last day of a month as themselves (pin)', async () => {
      expect(
        (await createEditComponent(ruleWith({ type: 'monthly', interval: 1, dayOfMonth: 1 }))).dayOfMonth
      ).toBe(1);
      expect(
        (await createEditComponent(ruleWith({ type: 'monthly', interval: 1, dayOfMonth: 31 }))).dayOfMonth
      ).toBe(31);
    });

    it('opens a weekly rule on weekday 3 as Wednesday (pin)', async () => {
      const editComponent = await createEditComponent(
        ruleWith({ type: 'weekly', interval: 1, dayOfWeek: 3 })
      );

      expect(editComponent.dayOfWeek).toBe(3);
      expect(editComponent.frequencyPreview).toContain('Wednesday');
    });

    it('opens the weekdays at both ends of the range as themselves (pin)', async () => {
      expect(
        (await createEditComponent(ruleWith({ type: 'weekly', interval: 1, dayOfWeek: 0 }))).dayOfWeek
      ).toBe(0);
      expect(
        (await createEditComponent(ruleWith({ type: 'weekly', interval: 1, dayOfWeek: 6 }))).dayOfWeek
      ).toBe(6);
    });

    // A weekly rule that never named a weekday is a valid rule, so opening it
    // is not a repair and an unrelated edit must not write a weekday into it.
    it('leaves a weekly rule that names no weekday without one (pin)', async () => {
      const editComponent = await createEditComponent(ruleWith({ type: 'weekly', interval: 1 }));

      expect(editComponent.dayOfWeek).toBeNull();

      editComponent.save();

      expect(savedFrequency()).toEqual({ type: 'weekly', interval: 1 });
    });
  });

  describe('isValid', () => {
    it('should be invalid when name is empty', () => {
      component.name = '';
      component.amount = 100;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when amount is null', () => {
      component.name = 'Test';
      component.amount = null;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when amount is zero', () => {
      component.name = 'Test';
      component.amount = 0;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when categoryId is empty', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = '';
      expect(component.isValid).toBeFalse();
    });

    // The interval floor exists in three places now — this form, the service
    // and firestore.rules — because an interval below one is a rule that can
    // never advance and hangs whichever occurrence walk reaches it. This is
    // the layer the user meets, and it had no spec.
    it('should be invalid when the interval is zero', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      component.interval = 0;
      expect(component.isValid).toBeFalse();
    });

    it('should be invalid when the interval is negative', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      component.interval = -1;
      expect(component.isValid).toBeFalse();
    });

    it('should be valid with required fields', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      expect(component.isValid).toBeTrue();
    });
  });

  describe('showDayOfWeek', () => {
    it('should be true for weekly frequency', () => {
      component.frequencyType = 'weekly';
      expect(component.showDayOfWeek).toBeTrue();
    });

    it('should be false for other frequencies', () => {
      component.frequencyType = 'monthly';
      expect(component.showDayOfWeek).toBeFalse();
    });
  });

  describe('showDayOfMonth', () => {
    it('should be true for monthly frequency', () => {
      component.frequencyType = 'monthly';
      expect(component.showDayOfMonth).toBeTrue();
    });

    it('should be true for yearly frequency', () => {
      component.frequencyType = 'yearly';
      expect(component.showDayOfMonth).toBeTrue();
    });

    it('should be false for daily frequency', () => {
      component.frequencyType = 'daily';
      expect(component.showDayOfMonth).toBeFalse();
    });
  });

  describe('frequencyPreview', () => {
    it('should show daily preview', () => {
      component.frequencyType = 'daily';
      component.interval = 1;
      expect(component.frequencyPreview).toBe('Every day');
    });

    it('should show daily preview with interval', () => {
      component.frequencyType = 'daily';
      component.interval = 3;
      expect(component.frequencyPreview).toBe('Every 3 days');
    });

    it('should show monthly preview', () => {
      component.frequencyType = 'monthly';
      component.interval = 1;
      component.dayOfMonth = 15;
      expect(component.frequencyPreview).toBe('Every month on the 15th');
    });

    it('should show yearly preview', () => {
      component.frequencyType = 'yearly';
      component.interval = 1;
      expect(component.frequencyPreview).toBe('Every year');
    });
  });

  describe('filteredCategories', () => {
    it('should filter expense categories', () => {
      component.type = 'expense';
      fixture.detectChanges();

      const filtered = component.filteredCategories();
      expect(filtered.every(c => c.type === 'expense' || c.type === 'both')).toBeTrue();
    });

    it('should filter income categories', () => {
      component.type = 'income';
      fixture.detectChanges();

      const filtered = component.filteredCategories();
      expect(filtered.every(c => c.type === 'income' || c.type === 'both')).toBeTrue();
    });
  });

  describe('onTypeChange', () => {
    it('should reset categoryId', () => {
      component.categoryId = 'cat1';
      component.onTypeChange();
      expect(component.categoryId).toBe('');
    });
  });

  describe('save', () => {
    it('should close dialog with result when valid', () => {
      component.name = 'Monthly Rent';
      component.amount = 1500;
      component.categoryId = 'cat1';
      component.type = 'expense';
      component.currency = 'USD';
      component.frequencyType = 'monthly';
      component.interval = 1;
      component.dayOfMonth = 1;
      component.startDate = new Date(2024, 0, 1);

      component.save();

      expect(mockDialogRef.close).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'Monthly Rent',
        amount: 1500,
        categoryId: 'cat1',
        type: 'expense',
        currency: 'USD'
      }));
    });

    it('should not close dialog when invalid', () => {
      component.name = '';
      component.amount = null;

      component.save();

      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('endDate handling on save', () => {
    const recurringWithEndDate = {
      id: 'rec1',
      name: 'Test',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      categoryId: 'cat1',
      description: '',
      frequency: { type: 'monthly', interval: 1 },
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      endDate: Timestamp.fromDate(new Date(2026, 11, 31)),
      isActive: true
    } as RecurringTransaction;

    async function createEditComponent(
      recurring: RecurringTransaction
    ): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { recurring } },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      editFixture.detectChanges();
      return editFixture.componentInstance;
    }

    it('omits endDate when creating without one', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';

      component.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect('endDate' in result).toBeFalse();
    });

    it('keeps the end date when editing and it stays set', async () => {
      const editComponent = await createEditComponent(recurringWithEndDate);
      expect(editComponent.hasEndDate).toBeTrue();

      editComponent.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect(result['endDate']).toEqual(new Date(2026, 11, 31));
    });

    it('sends endDate null when the end date is removed in edit mode', async () => {
      const editComponent = await createEditComponent(recurringWithEndDate);
      editComponent.toggleEndDate();
      expect(editComponent.hasEndDate).toBeFalse();

      editComponent.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect('endDate' in result).toBeTrue();
      expect(result['endDate']).toBeNull();
    });
  });

  describe('reminder lead time', () => {
    const recurringWithReminder = {
      id: 'rec1',
      name: 'Test',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      categoryId: 'cat1',
      description: '',
      frequency: { type: 'monthly', interval: 1 },
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      remindDaysBefore: 3,
      isActive: true
    } as RecurringTransaction;

    async function createEditComponent(
      recurring: RecurringTransaction
    ): Promise<RecurringFormDialogComponent> {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringFormDialogComponent],
        providers: [
          { provide: MatDialogRef, useValue: mockDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: { recurring } },
          { provide: AuthService, useValue: mockAuthService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: CurrencyService, useValue: mockCurrencyService },
          { provide: TranslationService, useValue: mockTranslationService },
          provideNoMotion()
        ],
        schemas: [NO_ERRORS_SCHEMA]
      })
        .overrideComponent(RecurringFormDialogComponent, {
          set: { template: '<div></div>' }
        })
        .compileComponents();

      const editFixture = TestBed.createComponent(RecurringFormDialogComponent);
      editFixture.detectChanges();
      return editFixture.componentInstance;
    }

    it('offers Off, the day itself and the leads up to the ceiling', () => {
      expect(component.reminderOptions.map(option => option.value))
        .toEqual([null, 0, 1, 2, 3, 7, 14, MAX_REMINDER_LEAD_DAYS]);
    });

    // One key per grammatical shape, not a count through a plural rule: only
    // en.json pluralizes, so a single counted key reads "1 days before" in the
    // other locales while i18n:check still resolves it. The mock returns an
    // unmapped key unchanged, so a label is the key the branch picked.
    it('picks a distinct label key and params per lead shape', () => {
      mockTranslationService.t.calls.reset();

      const labelFor = new Map(
        component.reminderOptions.map(option => [option.value, option.label])
      );

      expect(labelFor.get(0)).toBe('settings.reminderSameDay');
      expect(labelFor.get(1)).toBe('settings.reminderDayBefore');
      expect(labelFor.get(7)).toBe('settings.reminderDaysBefore');

      expect(mockTranslationService.t).toHaveBeenCalledWith('settings.reminderSameDay');
      expect(mockTranslationService.t).toHaveBeenCalledWith('settings.reminderDayBefore');
      expect(mockTranslationService.t)
        .toHaveBeenCalledWith('settings.reminderDaysBefore', { n: 7 });
    });

    it('defaults a new rule to no reminder', () => {
      expect(component.remindDaysBefore).toBeNull();
    });

    it('omits the lead time when creating without one', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';

      component.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect('remindDaysBefore' in result).toBeFalse();
    });

    it('emits the picked lead time', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      component.remindDaysBefore = 7;

      component.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect(result['remindDaysBefore']).toBe(7);
    });

    // Zero is a lead time the user picked, not an empty field.
    it('emits a zero lead time', () => {
      component.name = 'Test';
      component.amount = 100;
      component.categoryId = 'cat1';
      component.remindDaysBefore = 0;

      component.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect(result['remindDaysBefore']).toBe(0);
    });

    it('reads the stored lead time into the form when editing', async () => {
      const editComponent = await createEditComponent(recurringWithReminder);

      expect(editComponent.remindDaysBefore).toBe(3);
    });

    it('sends the lead time as null when it is cleared in edit mode', async () => {
      const editComponent = await createEditComponent(recurringWithReminder);
      editComponent.remindDaysBefore = null;

      editComponent.save();

      const result = mockDialogRef.close.calls.mostRecent().args[0] as Record<string, unknown>;
      expect('remindDaysBefore' in result).toBeTrue();
      expect(result['remindDaysBefore']).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should close dialog without result', () => {
      component.cancel();
      expect(mockDialogRef.close).toHaveBeenCalledWith();
    });
  });
});

/**
 * Every case above overrides the template to `<div></div>`, so none of them
 * would notice a missing `[value]` binding or a wrong option order. This is
 * the one place the real template renders and the day-of-month dropdown is
 * actually opened, the same way a user would meet the option.
 */
describe('RecurringFormDialogComponent, the day-of-month select through its own template', () => {
  let fixture: ComponentFixture<RecurringFormDialogComponent>;
  let component: RecurringFormDialogComponent;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<RecurringFormDialogComponent>>;

  /** The rule's side offers a category of each probe colour. */
  const probes = Object.entries(GLYPH_PROBE_COLOURS).map(([scheme, color]) =>
    createCategory({ id: `probe-${scheme}`, name: `probe-${scheme}`, color, type: 'expense' })
  );

  const editedRule = {
    id: 'rec1',
    name: 'Test',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    categoryId: 'cat1',
    description: '',
    frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 },
    startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
    isActive: true
  } as RecurringTransaction;

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [RecurringFormDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { recurring: editedRule } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({
              preferences: { baseCurrency: 'USD', theme: 'light', language: 'en', dateFormat: 'MM/DD/YYYY' }
            })
          }
        },
        { provide: CategoryService, useValue: { loadCategories: () => of(probes) } },
        { provide: CurrencyService, useValue: { currencies: signal([]) } },
        {
          // Echoes the key, so the null option's text is its own catalog key —
          // the same way the preview table's own real-template describe reads
          // labels without depending on English wording.
          provide: TranslationService,
          useValue: { t: (key: string) => key }
        },
        provideNoMotion(),
        provideNativeDateAdapter()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("offers the start date's day first", fakeAsync(() => {
    const compiled = fixture.nativeElement as HTMLElement;
    const dayField = Array.from(compiled.querySelectorAll('mat-form-field'))
      .find(field => field.querySelector('mat-label')?.textContent?.trim() === 'settings.onDay');
    expect(dayField).withContext('day of month field').toBeTruthy();

    // MatSelect opens on a click of its inner trigger, the same way the
    // filter panel's currency select is driven.
    const trigger = dayField!.querySelector<HTMLElement>('.mat-mdc-select-trigger');
    trigger!.click();
    fixture.detectChanges();
    flush();

    // Options render into the overlay container, outside the fixture.
    const options = Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
    expect(options[0].textContent?.trim()).toBe('settings.onDaySameAsStart');

    options[0].click();
    fixture.detectChanges();
    flush();

    expect(component.dayOfMonth).toBeNull();
  }));

  describe('its category select', () => {
    // The panel renders into the CDK overlay, outside the fixture.
    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    // A category's glyph is drawn in the panel on an option at rest, active
    // and selected, and is corrected for each. Each probe is chosen in turn,
    // so each is seen selected.
    it("draws each category's glyph at AA or better on its option at rest, active and selected, in both themes", () => {
      const select = fixture.debugElement
        .queryAll(By.directive(MatSelect))
        .map(node => node.injector.get(MatSelect))
        .find(each => each.options.some(option => option.value === probes[0].id))!;
      expect(select.options.map(option => option.value)).toEqual(probes.map(probe => probe.id));
      const flush = () => fixture.detectChanges();

      for (const scheme of AUDIT_SCHEMES) {
        withScheme(TestBed.inject(ThemeService), scheme, () => {
          for (const probe of probes) {
            chooseOption(select, probe.id, flush);
            expect(component.categoryId).withContext(`${scheme} ${probe.id} chosen`).toBe(probe.id);
            eachOptionState(select, flush, (option, state) => {
              const glyph = option._getHostElement().querySelector('mat-icon') as HTMLElement;
              expect(ratio(paintedColor(glyph), paintedBackground(glyph)))
                .withContext(`${scheme} ${probe.id} chosen, ${option.value} ${state}`)
                .toBeGreaterThanOrEqual(4.5);
            });
          }
        });
      }
    });
  });
});

/**
 * Material treats an option whose value is null or undefined as a reset
 * option unless the select sets `canSelectNullableOptions`: a model holding
 * null then shows nothing, whatever the option is labelled. Two of this
 * dialog's selects carry a null that is a real choice, "same day as the start
 * date" and "Off", so each has to show its own label with the field's label
 * floated over it. The reminder's null comes from `reminderOptions`, data the
 * `material:check` gate cannot see, so this is the cover for it.
 */
describe('RecurringFormDialogComponent, a select whose empty option is a choice', () => {
  let fixture: ComponentFixture<RecurringFormDialogComponent>;
  let component: RecurringFormDialogComponent;

  const rule = (overrides: Partial<RecurringTransaction> = {}): RecurringTransaction =>
    ({
      id: 'rec1',
      name: 'Rent',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      categoryId: 'cat1',
      description: '',
      frequency: { type: 'monthly', interval: 1 },
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      isActive: true,
      ...overrides
    }) as RecurringTransaction;

  async function render(recurring: RecurringTransaction): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [RecurringFormDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: jasmine.createSpyObj('MatDialogRef', ['close']) },
        { provide: MAT_DIALOG_DATA, useValue: { recurring } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({
              preferences: { baseCurrency: 'USD', theme: 'light', language: 'en', dateFormat: 'MM/DD/YYYY' }
            })
          }
        },
        { provide: CategoryService, useValue: { loadCategories: () => of([]) } },
        { provide: CurrencyService, useValue: { currencies: signal([]) } },
        { provide: TranslationService, useValue: { t: (key: string) => key } },
        provideNoMotion(),
        provideNativeDateAdapter()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // ngModel hands the value to the select a microtask after the first pass.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** What the field named `label` shows: its select's trigger text and whether its label floats. */
  function shown(label: string): { text: string | undefined; floated: boolean } {
    const field = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mat-form-field'))
      .find(each => each.querySelector('mat-label')?.textContent?.trim() === label);
    expect(field).withContext(`the ${label} field`).toBeTruthy();
    return {
      text: field!.querySelector('.mat-mdc-select-value')?.textContent?.trim(),
      floated: field!.querySelector('.mdc-floating-label--float-above') !== null
    };
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  it('shows "same day as the start date" for a monthly rule that names no day', async () => {
    await render(rule());

    expect(component.dayOfMonth).toBeNull();
    expect(shown('settings.onDay')).toEqual({ text: 'settings.onDaySameAsStart', floated: true });
  });

  it('shows "Off" for a rule that has no reminder', async () => {
    await render(rule());

    expect(component.remindDaysBefore).toBeNull();
    expect(shown('settings.reminder')).toEqual({ text: 'settings.reminderOff', floated: true });
  });

  it('shows the day and the lead a rule names (pin)', async () => {
    await render(rule({ frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 }, remindDaysBefore: 3 }));

    expect(shown('settings.onDay')).toEqual({ text: '15', floated: true });
    expect(shown('settings.reminder')).toEqual({ text: 'settings.reminderDaysBefore', floated: true });
  });

  it('writes null and shows the empty option once it is picked after a value', async () => {
    await render(rule({ frequency: { type: 'monthly', interval: 1, dayOfMonth: 15 }, remindDaysBefore: 3 }));
    const selectIn = (label: string) =>
      fixture.debugElement
        .queryAll(By.directive(MatSelect))
        .find(node => (node.nativeElement as HTMLElement).closest('mat-form-field')
          ?.querySelector('mat-label')?.textContent?.trim() === label)!
        .injector.get(MatSelect);
    const flush = () => fixture.detectChanges();

    chooseOption(selectIn('settings.onDay'), null, flush);
    chooseOption(selectIn('settings.reminder'), null, flush);

    expect(component.dayOfMonth).toBeNull();
    expect(component.remindDaysBefore).toBeNull();
    expect(shown('settings.onDay').text).toBe('settings.onDaySameAsStart');
    expect(shown('settings.reminder').text).toBe('settings.reminderOff');
  });
});

/**
 * The start date's control hands back null when its text is emptied or cannot
 * be read as a day, so a cleared field is a null on the model, not a Date. The
 * monthly preview read that date's day, which broke the whole dialog's render
 * the moment the field was emptied, and a save would have sent no start at
 * all. The user meets this by typing into the input, so this drives the real
 * template through it, over the app's own adapter: its strict parse is what
 * turns a half-typed date into a null.
 */
describe('RecurringFormDialogComponent, a start date the user clears', () => {
  let fixture: ComponentFixture<RecurringFormDialogComponent>;
  let component: RecurringFormDialogComponent;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<RecurringFormDialogComponent>>;

  /** Text that leaves the control without a date: emptied, only spaces, and half a date. */
  const UNREADABLE = ['', '   ', '3/'];

  beforeEach(async () => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [RecurringFormDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: CategoryService, useValue: { loadCategories: () => of([]) } },
        { provide: CurrencyService, useValue: { currencies: signal([]) } },
        // The helper's catalog echoes the key and its params, so the preview
        // reads as the sentence it chose and the day it named, and an empty
        // preview is the absence of any sentence.
        provideAppDatepickerForTests({ dateFormat: signal('MM/DD/YYYY') }),
        provideNoMotion()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // ngModel hands the start date to the input a microtask after the first pass.
    await fixture.whenStable();
    fixture.detectChanges();

    // A rule that is valid in every field but the one under test.
    component.name = 'Rent';
    component.amount = 100;
    component.categoryId = 'cat1';
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
  });

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  function startInput(): HTMLInputElement {
    const field = Array.from(root().querySelectorAll('mat-form-field'))
      .find(each => each.querySelector('mat-label')?.textContent?.trim() === 'settings.startDate');
    expect(field).withContext('the start date field').toBeTruthy();
    return field!.querySelector<HTMLInputElement>('input')!;
  }

  /** What the user does: replaces the field's text, which the picker input reads on its `input` event. */
  function typeStart(text: string): void {
    const input = startInput();
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  const preview = (): string | undefined =>
    root().querySelector('.frequency-preview span')?.textContent?.trim();

  /** The whole row: icon and sentence. A preview with nothing to say is no row at all. */
  const previewRow = (): Element | null => root().querySelector('.frequency-preview');

  /** The monthly sentence naming `day`, as the echoing catalog renders it. */
  const monthlyOn = (day: number, suffix: string): string =>
    `settings.everyMonthOn:${JSON.stringify({ day, suffix })}`;

  const saveButton = (): HTMLButtonElement =>
    Array.from(root().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'))
      .find(button => button.textContent?.includes('settings.create'))!;

  it('starts on a date, with the monthly preview naming its day and the form savable (positive control)', () => {
    expect(component.startDate).toEqual(jasmine.any(Date));
    expect(component.frequencyType).toBe('monthly');
    expect(component.dayOfMonth).toBeNull();
    expect(preview()).toContain('settings.everyMonthOn');
    expect(preview()).toContain(`"day":${component.startDate!.getDate()},`);
    expect(component.isValid).toBeTrue();
  });

  for (const text of UNREADABLE) {
    it(`still renders once the start input holds "${text}", with no preview row to show`, () => {
      expect(previewRow()).withContext('the row before the field is changed').not.toBeNull();

      typeStart(text);

      expect(component.startDate).toBeNull();
      expect(() => fixture.detectChanges()).not.toThrow();
      expect(previewRow()).toBeNull();
      expect(saveButton().disabled).toBeTrue();
    });

    it(`is not valid and does not close on a save while the start input holds "${text}"`, () => {
      expect(component.isValid).withContext('before the field is changed').toBeTrue();

      typeStart(text);

      expect(component.isValid).toBeFalse();
      component.save();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  }

  it('saves again with the date typed back in', () => {
    typeStart('3/');
    fixture.detectChanges();
    expect(previewRow()).withContext('the row while the date is half typed').toBeNull();

    typeStart('3/5/2026');

    expect(component.startDate).toEqual(new Date(2026, 2, 5));
    expect(component.isValid).toBeTrue();
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(preview()).toBe(monthlyOn(5, 'th'));
    expect(saveButton().disabled).toBeFalse();

    component.save();

    expect(mockDialogRef.close).toHaveBeenCalledWith(
      jasmine.objectContaining({ startDate: new Date(2026, 2, 5) })
    );
  });

  it('keeps the day a rule names while the start date is empty', () => {
    component.dayOfMonth = 15;

    typeStart('');

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(preview()).toBe(monthlyOn(15, 'th'));
  });
});
