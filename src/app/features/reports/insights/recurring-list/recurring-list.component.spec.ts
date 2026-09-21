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
  StorableRecurringGroup,
  StorableRecurringSummary
} from '../../../../models';
import { createCategory, createTranslationStub } from '../../../../core/services/testing';

function groupFor(overrides: Partial<StorableRecurringGroup> = {}): StorableRecurringGroup {
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

function summaryFor(groups: StorableRecurringGroup[]): StorableRecurringSummary {
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

describe('RecurringListComponent', () => {
  let component: RecurringListComponent;
  let fixture: ComponentFixture<RecurringListComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockRecurringService: jasmine.SpyObj<RecurringService>;
  let notifications: jasmine.SpyObj<NotificationService>;

  const group = groupFor;
  const summaryOf = summaryFor;

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

  // Suppression moved into the detector (ADR 0042), so what is asserted here is
  // that the list filters nothing: the rows have to be exactly the groups the
  // summary carries, or they stop agreeing with the figures taken from it.
  describe('rendering the summary it was given', () => {
    it('renders every detected group the summary carries, live or archived', () => {
      const groups = [
        group(),
        group({ key: 'rec:detected:entertainment:spotify', label: 'SPOTIFY' }),
        group({ key: 'rec:declared:utilities:rent', source: 'declared', label: 'Rent' })
      ];
      fixture.componentRef.setInput('summary', summaryOf(groups));
      fixture.detectChanges();

      const detectedKeys = [
        'rec:detected:entertainment:netflix',
        'rec:detected:entertainment:spotify'
      ];
      expect(component.detected().map(item => item.key)).toEqual(detectedKeys);
      expect(component.declared().map(item => item.key)).toEqual(['rec:declared:utilities:rent']);

      fixture.componentRef.setInput('archived', true);
      fixture.detectChanges();

      expect(component.detected().map(item => item.key)).toEqual(detectedKeys);
    });

    it('counts only what the cap dropped as hidden', () => {
      const summary = summaryOf([group()]);
      fixture.componentRef.setInput('summary', { ...summary, groupCount: 3 });
      fixture.detectChanges();

      expect(component.hasHiddenGroups()).toBeTrue();
      expect(component.hiddenCount()).toBe(2);
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

/**
 * The cases above override the template to `<div></div>`, so the whole point
 * of this component — two sections that only exist when their side has rows,
 * and a per-row control set gated three different ways — is unproven by them.
 * The rows themselves render through an `ngTemplateOutlet` with a context
 * object, which is the one construct in this template that can silently
 * render nothing if its context key is renamed.
 */
describe('RecurringListComponent, through its own template', () => {
  let fixture: ComponentFixture<RecurringListComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;

  function render(
    groups: StorableRecurringGroup[],
    options: {
      drillDownIds?: Record<string, string[]>;
      archived?: boolean;
      summary?: StorableRecurringSummary;
    } = {},
  ): void {
    fixture.componentRef.setInput('summary', options.summary ?? summaryFor(groups));
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('drillDownIds', options.drillDownIds ?? {});
    fixture.componentRef.setInput('archived', options.archived ?? false);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const sections = () => Array.from(el().querySelectorAll('.recurring-section')) as HTMLElement[];
  const rows = () => Array.from(el().querySelectorAll('.recurring-row')) as HTMLElement[];
  const cell = (row: HTMLElement, selector: string) =>
    row.querySelector(selector)?.textContent?.trim() ?? null;

  beforeEach(async () => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    const recurring = jasmine.createSpyObj('RecurringService', ['createRecurring']);
    recurring.createRecurring.and.resolveTo('new-rule-id');

    await TestBed.configureTestingModule({
      imports: [RecurringListComponent, NoopAnimationsModule],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            categories: signal([
              createCategory({
                id: 'entertainment',
                name: 'categoryNames.entertainment',
                icon: 'movie',
                color: '#FF0000',
              }),
            ]),
          },
        },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: RecurringService, useValue: recurring },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error']) },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringListComponent);
  });

  it('keeps a section out entirely when its side has no group', () => {
    render([groupFor({ source: 'detected' })]);

    expect(sections().length).toBe(1);
    expect(sections()[0].querySelector('.section-label')?.textContent?.trim())
      .toBe('insights.recurringDetected');
    expect(el().textContent).not.toContain('insights.recurringDeclared');
  });

  it('separates declared from detected, declared first, and only notes the detected side', () => {
    render([
      groupFor({ key: 'a', source: 'detected', label: 'NETFLIX.COM' }),
      groupFor({ key: 'b', source: 'declared', label: 'Rent' }),
    ]);

    const labels = sections().map(s => s.querySelector('.section-label')?.textContent?.trim());
    expect(labels).toEqual(['insights.recurringDeclared', 'insights.recurringDetected']);
    expect(sections()[0].querySelector('.section-note')).toBeNull();
    expect(sections()[1].querySelector('.section-note')?.textContent?.trim())
      .toBe('insights.recurringDetectedNote');
    expect(rows().length).toBe(2);
  });

  it('reads a row as its label, cadence, occurrences and monthly cost', () => {
    render([groupFor({ occurrenceCount: 4, monthlyEquivalent: 15.99 })]);

    const row = rows()[0];
    expect(cell(row, '.row-label')).toBe('NETFLIX.COM');
    expect(cell(row, '.row-meta')).toContain('insights.cadenceMonthly');
    expect(cell(row, '.row-meta')).toContain('insights.occurrences:{"count":4}');
    expect(cell(row, '.row-monthly')).toBe('$15.99');
    expect(cell(row, '.row-monthly-label')).toBe('insights.perMonth');
  });

  it('carries the category\'s own icon and colour into the chip', () => {
    render([groupFor()]);

    const chip = rows()[0].querySelector('app-category-chip') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('movie');
  });

  it('flags a price rise only on the group that had one', () => {
    render([
      groupFor({ key: 'a', priceIncreased: true }),
      groupFor({ key: 'b', priceIncreased: false }),
    ]);

    expect(rows()[0].querySelector('.row-flag')?.textContent).toContain('insights.priceIncreased');
    expect(rows()[1].querySelector('.row-flag')).toBeNull();
  });

  it('expands a row in place and collapses it again', () => {
    render([groupFor({ key: 'k1' })], {
      drillDownIds: { 'recurring:k1': ['t1', 't2'] },
    });

    const toggle = rows()[0].querySelector('.row-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent?.trim()).toBe('expand_more');
    expect(rows()[0].querySelector('app-insight-transaction-list')).toBeNull();

    toggle.click();
    fixture.detectChanges();

    const open = rows()[0].querySelector('.row-toggle') as HTMLButtonElement;
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.textContent?.trim()).toBe('expand_less');
    expect(rows()[0].querySelector('app-insight-transaction-list')).not.toBeNull();

    open.click();
    fixture.detectChanges();
    expect(rows()[0].querySelector('app-insight-transaction-list')).toBeNull();
  });

  it('offers no toggle for a group with no drill-down ids', () => {
    render([groupFor({ key: 'k1' })]);

    expect(rows()[0].querySelector('.row-toggle')).toBeNull();
  });

  it('offers convert on a detected row and opens the prefilled dialog', () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    render([groupFor({ source: 'detected' })]);

    const convert = rows()[0].querySelector('.row-convert') as HTMLButtonElement;
    expect(convert.getAttribute('aria-label')).toBe('insights.convertToRule');
    expect(convert.getAttribute('title')).toBe('insights.convertToRule');

    convert.click();

    expect(dialog.open).toHaveBeenCalled();
  });

  it('offers no convert on a declared row — the user already made that rule', () => {
    render([groupFor({ source: 'declared' })]);

    expect(rows()[0].querySelector('.row-convert')).toBeNull();
  });

  it('strips both row controls from a frozen snapshot', () => {
    render([groupFor({ key: 'k1', source: 'detected' })], {
      drillDownIds: { 'recurring:k1': ['t1'] },
      archived: true,
    });

    expect(rows()[0].querySelector('.row-convert')).toBeNull();
    expect(rows()[0].querySelector('.row-toggle')).toBeNull();
  });

  it('counts what the display cap left out', () => {
    render([], { summary: { ...summaryFor([groupFor()]), groupCount: 9 } });

    const note = Array.from(el().querySelectorAll('mat-card-content > .section-note'));
    expect(note.length).toBe(1);
    expect(note[0].textContent?.trim()).toBe('insights.recurringMore:{"count":8}');
  });
});
