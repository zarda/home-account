import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';

import { RecurringListComponent } from './recurring-list.component';
import { CategoryService } from '../../../../core/services/category.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { RecurringService } from '../../../../core/services/recurring.service';
import { NotificationService } from '../../../../core/services/notification.service';
import {
  CreateRecurringDTO,
  RecurringFrequency,
  RecurringTransaction,
  StorableRecurringGroup,
  StorableRecurringSummary
} from '../../../../models';

describe('RecurringListComponent', () => {
  let component: RecurringListComponent;
  let fixture: ComponentFixture<RecurringListComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockRecurringService: jasmine.SpyObj<RecurringService>;
  let notifications: jasmine.SpyObj<NotificationService>;

  function group(overrides: Partial<StorableRecurringGroup> = {}): StorableRecurringGroup {
    return {
      key: 'rec:detected:entertainment:netflix',
      source: 'detected',
      categoryId: 'entertainment',
      label: 'NETFLIX.COM',
      cadence: 'monthly',
      medianIntervalDays: 30,
      occurrenceCount: 4,
      medianAmount: 15.99,
      monthlyEquivalent: 15.99,
      firstSeen: '2026-03-15',
      lastSeen: '2026-07-15',
      priceIncreased: false,
      userFlaggedCount: 0,
      ...overrides
    };
  }

  function summaryOf(groups: StorableRecurringGroup[]): StorableRecurringSummary {
    return {
      groups,
      groupCount: groups.length,
      declaredGroupCount: groups.filter(g => g.source === 'declared').length,
      detectedGroupCount: groups.filter(g => g.source === 'detected').length,
      totalMonthlyEquivalent: 0,
      declaredMonthlyEquivalent: 0,
      detectedMonthlyEquivalent: 0,
      newGroupCount: 0,
      increasedGroupCount: 0
    };
  }

  function rule(name: string, frequency: RecurringFrequency): RecurringTransaction {
    return { name, frequency, isActive: true } as RecurringTransaction;
  }

  beforeEach(async () => {
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockRecurringService = jasmine.createSpyObj('RecurringService', ['createRecurring']);
    mockRecurringService.createRecurring.and.resolveTo('new-rule-id');
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error']);

    const mockCategoryService = jasmine.createSpyObj('CategoryService', [], {
      categories: signal([])
    });
    const mockTranslation = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [RecurringListComponent, NoopAnimationsModule],
      providers: [
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: TranslationService, useValue: mockTranslation },
        { provide: RecurringService, useValue: mockRecurringService },
        { provide: NotificationService, useValue: notifications },
        { provide: MatDialog, useValue: mockDialog }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(RecurringListComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('summary', summaryOf([group()]));
    fixture.componentRef.setInput('currency', 'USD');
    fixture.detectChanges();
  });

  describe('suppression', () => {
    it('hides detected groups covered by an active rule', () => {
      fixture.componentRef.setInput('activeRules', [
        rule('Netflix', { type: 'monthly', interval: 1 })
      ]);
      fixture.detectChanges();

      expect(component.visibleDetected()).toEqual([]);
    });

    it('keeps uncovered groups visible', () => {
      fixture.componentRef.setInput('activeRules', [
        rule('Gym Membership', { type: 'monthly', interval: 1 })
      ]);
      fixture.detectChanges();

      expect(component.visibleDetected().map(g => g.key)).toEqual([
        'rec:detected:entertainment:netflix'
      ]);
    });

    it('never suppresses archived snapshots, which receive no rules', () => {
      fixture.componentRef.setInput('archived', true);
      fixture.detectChanges();

      expect(component.visibleDetected().length).toBe(1);
    });
  });

  describe('conversion', () => {
    it('is unavailable on archived snapshots', () => {
      fixture.componentRef.setInput('archived', true);
      fixture.detectChanges();

      expect(component.canConvert()).toBeFalse();
    });

    it('opens the recurring dialog prefilled from the group', () => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

      component.convert(group());

      expect(mockDialog.open).toHaveBeenCalled();
      const config = mockDialog.open.calls.mostRecent().args[1] as {
        data: { prefill: { name: string; frequency: RecurringFrequency } };
      };
      expect(config.data.prefill.name).toBe('NETFLIX.COM');
      expect(config.data.prefill.frequency).toEqual({
        type: 'monthly',
        interval: 1,
        dayOfMonth: 15
      });
    });

    it('creates the rule from the dialog result', fakeAsync(() => {
      const dto = { name: 'Netflix' } as CreateRecurringDTO;
      mockDialog.open.and.returnValue({ afterClosed: () => of(dto) } as never);

      component.convert(group());
      tick();

      expect(mockRecurringService.createRecurring).toHaveBeenCalledWith(dto);
      expect(notifications.success).toHaveBeenCalled();
    }));

    it('does not create anything when the dialog is dismissed', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);

      component.convert(group());
      tick();

      expect(mockRecurringService.createRecurring).not.toHaveBeenCalled();
    }));
  });
});
