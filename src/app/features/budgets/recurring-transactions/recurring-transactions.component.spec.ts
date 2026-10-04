import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RecurringTransactionsComponent } from './recurring-transactions.component';
import { RecurringFormDialogComponent } from './recurring-form-dialog/recurring-form-dialog.component';
import { RecurringService, INVALID_FREQUENCY_ERROR, RULE_ENDED_ERROR } from '../../../core/services/recurring.service';
import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { CurrencyService } from '../../../core/services/currency.service';
import { ThemeService } from '../../../core/services/theme.service';
import {
  CATEGORY_FALLBACK_COLOR,
  CATEGORY_PALETTE,
  Category,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
  RecurringTransaction,
} from '../../../models';
import { NotificationService } from '../../../core/services/notification.service';
import type { Rgb } from '../../../core/utils/color-contrast.utils';
import {
  AUDIT_SCHEMES,
  channels,
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withScheme,
  withTheme,
} from '../../../core/services/testing';

describe('RecurringTransactionsComponent', () => {
  let component: RecurringTransactionsComponent;
  let fixture: ComponentFixture<RecurringTransactionsComponent>;
  let mockRecurringService: jasmine.SpyObj<RecurringService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockCategoryService: jasmine.SpyObj<CategoryService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;

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
    }
  ];

  const mockRecurring: RecurringTransaction[] = [
    {
      id: 'rec1',
      userId: 'user1',
      name: 'Monthly Rent',
      type: 'expense',
      amount: 1500,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Apartment rent',
      frequency: { type: 'monthly', interval: 1, dayOfMonth: 1 },
      startDate: Timestamp.fromDate(new Date(2024, 0, 1)),
      isActive: true,
      lastProcessed: Timestamp.fromDate(new Date(2024, 5, 1)),
      nextOccurrence: Timestamp.fromDate(new Date(2024, 6, 1)),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }
  ];

  beforeEach(async () => {
    mockRecurringService = jasmine.createSpyObj('RecurringService', [
      'getRecurring',
      'createRecurring',
      'updateRecurring',
      'deleteRecurring',
      'pauseRecurring',
      'resumeRecurring',
      'getFrequencyText'
    ]);
    mockRecurringService.getRecurring.and.returnValue(of(mockRecurring));
    mockRecurringService.createRecurring.and.returnValue(Promise.resolve('new-id'));
    mockRecurringService.updateRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.deleteRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.pauseRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.resumeRecurring.and.returnValue(Promise.resolve());
    mockRecurringService.getFrequencyText.and.returnValue('Every month on the 1st');

    mockCategoryService = jasmine.createSpyObj('CategoryService', ['loadCategories']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    mockCategoryService.loadCategories.and.returnValue(of(mockCategories));

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'settings.recurringPaused': 'Recurring transaction paused',
        'settings.recurringResumed': 'Recurring transaction resumed',
        'settings.recurringCreated': 'Recurring transaction created',
        'settings.recurringUpdated': 'Recurring transaction updated',
        'settings.recurringUpdateFailed': 'Failed to update recurring transaction',
        'settings.recurringResumeFailed': 'Failed to resume recurring transaction',
        'settings.recurringResumeInvalidFrequency':
          "Cannot resume: this rule's interval cannot advance. Edit the rule and set an interval of at least 1.",
        'settings.recurringResumeEnded':
          "Cannot resume: this rule's end date has passed. Edit the end date first.",
        'settings.recurringDeleted': 'Recurring transaction deleted',
        'settings.deleteRecurringTitle': 'Delete Recurring Transaction',
        'settings.deleteRecurringMessage': 'Are you sure?',
        'common.close': 'Close',
        'common.delete': 'Delete',
        'common.moreActionsFor': `More actions for ${params?.['description']}`,
        'Food & Drinks': 'Food & Drinks'
      };
      return translations[key] || key;
    });

    await TestBed.configureTestingModule({
      imports: [RecurringTransactionsComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: RecurringService, useValue: mockRecurringService },
        { provide: CategoryService, useValue: mockCategoryService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        {
          provide: CurrencyService,
          useValue: {
            formatCurrency: (amount: number, code: string) => `${code} ${amount.toFixed(2)}`,
          },
        }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(RecurringTransactionsComponent, {
        set: {
          template: '<div></div>',
          providers: [
            { provide: NotificationService, useValue: notifications },
            { provide: TranslationService, useValue: mockTranslationService }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(RecurringTransactionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load recurring transactions on init', () => {
      expect(mockRecurringService.getRecurring).toHaveBeenCalled();
    });

    it('should load categories on init', () => {
      expect(mockCategoryService.loadCategories).toHaveBeenCalled();
    });

    it('should set isLoading to false after loading', () => {
      expect(component.isLoading()).toBeFalse();
    });

    it('should store loaded recurring transactions', () => {
      expect(component.recurringTransactions().length).toBe(1);
    });
  });

  describe('listener lifecycle', () => {
    it('releases both live streams when the component is destroyed', () => {
      const recurring$ = new Subject<never[]>();
      const categories$ = new Subject<never[]>();
      mockRecurringService.getRecurring.and.returnValue(recurring$);
      mockCategoryService.loadCategories.and.returnValue(categories$);

      const freshFixture = TestBed.createComponent(RecurringTransactionsComponent);
      freshFixture.detectChanges();
      expect(recurring$.observed).toBeTrue();
      expect(categories$.observed).toBeTrue();

      freshFixture.destroy();
      expect(recurring$.observed).toBeFalse();
      expect(categories$.observed).toBeFalse();
    });
  });

  describe('category helpers', () => {
    it('should get category name', () => {
      const name = component.getCategoryName('cat1');
      expect(name).toBe('Food & Drinks');
    });

    it('should return Unknown for missing category', () => {
      const name = component.getCategoryName('nonexistent');
      expect(name).toBe('Unknown');
    });

    it('should get category icon', () => {
      const icon = component.getCategoryIcon('cat1');
      expect(icon).toBe('restaurant');
    });

    it('should return default icon for missing category', () => {
      const icon = component.getCategoryIcon('nonexistent');
      expect(icon).toBe('category');
    });

    it('should get category color', () => {
      const color = component.getCategoryColor('cat1');
      expect(color).toBe('#FF5722');
    });

    it('should return default color for missing category', () => {
      const color = component.getCategoryColor('nonexistent');
      expect(color).toBe('#9E9E9E');
    });
  });

  describe('getFrequencyText', () => {
    it('should call service to get frequency text', () => {
      const text = component.getFrequencyText(mockRecurring[0]);
      expect(mockRecurringService.getFrequencyText).toHaveBeenCalledWith(mockRecurring[0].frequency);
      expect(text).toBe('Every month on the 1st');
    });
  });

  describe('toggleActive', () => {
    it('should pause active recurring transaction', fakeAsync(() => {
      const activeRecurring = { ...mockRecurring[0], isActive: true };

      component.toggleActive(activeRecurring);
      tick();

      expect(mockRecurringService.pauseRecurring).toHaveBeenCalledWith('rec1');
      expect(notifications.success).toHaveBeenCalledWith('Recurring transaction paused');
    }));

    it('should resume paused recurring transaction', fakeAsync(() => {
      const pausedRecurring = { ...mockRecurring[0], isActive: false };

      component.toggleActive(pausedRecurring);
      tick();

      expect(mockRecurringService.resumeRecurring).toHaveBeenCalledWith('rec1');
      expect(notifications.success).toHaveBeenCalledWith('Recurring transaction resumed');
    }));

    it('tells the user when a resume is refused for its interval', fakeAsync(() => {
      const pausedRecurring = { ...mockRecurring[0], isActive: false };
      mockRecurringService.resumeRecurring.and.rejectWith(new Error(INVALID_FREQUENCY_ERROR));

      component.toggleActive(pausedRecurring);
      tick();

      expect(notifications.error).toHaveBeenCalledWith(
        "Cannot resume: this rule's interval cannot advance. Edit the rule and set an interval of at least 1."
      );
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    it('tells the user when a resume is refused because the rule has ended', fakeAsync(() => {
      const pausedRecurring = { ...mockRecurring[0], isActive: false };
      mockRecurringService.resumeRecurring.and.rejectWith(new Error(RULE_ENDED_ERROR));

      component.toggleActive(pausedRecurring);
      tick();

      expect(notifications.error).toHaveBeenCalledWith(
        "Cannot resume: this rule's end date has passed. Edit the end date first."
      );
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    it('tells the user when a resume fails for any other reason', fakeAsync(() => {
      const pausedRecurring = { ...mockRecurring[0], isActive: false };
      mockRecurringService.resumeRecurring.and.rejectWith(new Error('x'));

      component.toggleActive(pausedRecurring);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to resume recurring transaction');
      expect(notifications.success).not.toHaveBeenCalled();
    }));
  });

  describe('deleteRecurring', () => {
    it('should open confirm dialog', () => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should delete when confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(true) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);
      tick();

      expect(mockRecurringService.deleteRecurring).toHaveBeenCalledWith('rec1');
    }));

    it('reports a failed delete instead of stopping at the confirm dialog', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      mockRecurringService.deleteRecurring.and.rejectWith(new Error('nope'));

      component.deleteRecurring(mockRecurring[0]);
      tick();

      expect(notifications.error).toHaveBeenCalled();
      expect(notifications.success).not.toHaveBeenCalled();
    }));

    it('should not delete when not confirmed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(false) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.deleteRecurring(mockRecurring[0]);
      tick();

      expect(mockRecurringService.deleteRecurring).not.toHaveBeenCalled();
    }));
  });

  describe('openAddDialog', () => {
    it('should open add dialog', () => {
      const mockDialogRef = { afterClosed: () => of(null) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();

      expect(mockDialog.open).toHaveBeenCalled();
    });

    it('should create recurring when dialog returns result', fakeAsync(() => {
      const result = {
        name: 'New Recurring',
        type: 'expense' as const,
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: 'Test',
        frequency: { type: 'monthly' as const, interval: 1 },
        startDate: new Date()
      };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openAddDialog();
      tick();

      expect(mockRecurringService.createRecurring).toHaveBeenCalledWith(result);
      expect(notifications.success).toHaveBeenCalledWith('Recurring transaction created');
    }));

    it('should announce assertively when creation fails', fakeAsync(() => {
      const result = {
        name: 'New Recurring',
        type: 'expense' as const,
        amount: 100,
        currency: 'USD',
        categoryId: 'cat1',
        description: 'Test',
        frequency: { type: 'monthly' as const, interval: 1 },
        startDate: new Date()
      };
      const mockDialogRef = { afterClosed: () => of(result) };
      mockDialog.open.and.returnValue(mockDialogRef as never);
      mockRecurringService.createRecurring.and.returnValue(Promise.reject(new Error('fail')));

      component.openAddDialog();
      tick();

      expect(notifications.error).toHaveBeenCalledWith('settings.recurringCreateFailed');
    }));
  });

  describe('openEditDialog', () => {
    const editResult = {
      name: 'Updated Rent',
      type: 'expense' as const,
      amount: 1600,
      currency: 'USD',
      categoryId: 'cat1',
      description: 'Updated apartment rent',
      frequency: { type: 'monthly' as const, interval: 1 },
      startDate: new Date()
    };

    it('should open edit dialog with the recurring transaction as data', () => {
      const mockDialogRef = { afterClosed: () => of(undefined) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openEditDialog(mockRecurring[0]);

      expect(mockDialog.open).toHaveBeenCalledWith(RecurringFormDialogComponent, {
        width: '100%',
        maxWidth: '500px',
        data: { recurring: mockRecurring[0] }
      });
    });

    it('should update recurring when dialog returns result', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(editResult) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openEditDialog(mockRecurring[0]);
      tick();

      expect(mockRecurringService.updateRecurring).toHaveBeenCalledWith('rec1', editResult);
      expect(notifications.success).toHaveBeenCalledWith('Recurring transaction updated');
    }));

    it('should not update when dialog is dismissed', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(undefined) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      component.openEditDialog(mockRecurring[0]);
      tick();

      expect(mockRecurringService.updateRecurring).not.toHaveBeenCalled();
    }));

    it('should show error snackbar when update fails', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(editResult) };
      mockDialog.open.and.returnValue(mockDialogRef as never);
      mockRecurringService.updateRecurring.and.returnValue(Promise.reject(new Error('fail')));

      component.openEditDialog(mockRecurring[0]);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('Failed to update recurring transaction');
    }));
  });

  describe('rendered card template', () => {
    // The shared TestBed above swaps the template out for '<div></div>', so
    // it cannot catch a regression that removes the Edit action from the
    // card menu. These tests re-configure the TestBed WITHOUT the template
    // override and drive the real markup.
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [RecurringTransactionsComponent, NoopAnimationsModule],
        providers: [
        { provide: NotificationService, useValue: notifications },
          { provide: RecurringService, useValue: mockRecurringService },
          { provide: CategoryService, useValue: mockCategoryService },
          { provide: MatDialog, useValue: mockDialog },
          { provide: MatSnackBar, useValue: mockSnackBar },
          { provide: TranslationService, useValue: mockTranslationService },
          { provide: AnnouncerService, useValue: mockAnnouncer },
          {
            // The shared app-amount-display inside the card formats
            // through CurrencyService; keep the real (Firestore-backed)
            // service out of the suite.
            provide: CurrencyService,
            useValue: {
              formatCurrency: (amount: number, code: string) => `${code} ${amount.toFixed(2)}`,
            },
          }
        ]
      })
        .overrideComponent(RecurringTransactionsComponent, {
          add: {
            providers: [
              { provide: NotificationService, useValue: notifications },
              { provide: TranslationService, useValue: mockTranslationService }
            ]
          }
        })
        .compileComponents();

      fixture = TestBed.createComponent(RecurringTransactionsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    // Opens the first card's action menu and returns its items (the menu
    // content renders lazily into the overlay, so it must be opened first).
    function openCardMenu(): HTMLElement[] {
      const trigger = (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.recurring-card .action-btn');
      expect(trigger).withContext('card action menu trigger').toBeTruthy();
      trigger!.click();
      fixture.detectChanges();
      return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]'));
    }

    function findEditItem(items: HTMLElement[]): HTMLElement | undefined {
      // The TranslationService mock returns the key for 'common.edit'.
      return items.find(item => item.textContent?.includes('common.edit'));
    }

    // Re-renders the card grid over a given set of rules; the TestBed is
    // already configured, so only the component is built again.
    function renderRules(rules: RecurringTransaction[]): HTMLElement {
      mockRecurringService.getRecurring.and.returnValue(of(rules));
      fixture = TestBed.createComponent(RecurringTransactionsComponent);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows the next date of a rule whose pointer reads', () => {
      expect(renderRules(mockRecurring).querySelector('.recurring-next')).toBeTruthy();
    });

    // This page is the manual route back for a rule the catch-up skipped, so
    // a pointer a restore or a hand edit left unreadable has to leave the row
    // standing without its next date rather than take the grid down.
    it('shows no next date when the stored pointer is not a timestamp', () => {
      const host = renderRules([{
        ...mockRecurring[0],
        nextOccurrence: { seconds: 1, nanoseconds: 0 } as unknown as Timestamp
      }]);

      expect(host.querySelector('.recurring-card')).toBeTruthy();
      expect(host.querySelector('.recurring-next')).toBeNull();
    });

    // One card per rule, so a menu button named only "More actions" would
    // repeat across the grid with nothing to say which rule it pauses,
    // edits or deletes.
    it("names each card's menu button after its own rule", () => {
      const host = renderRules([mockRecurring[0], { ...mockRecurring[0], id: 'rec2', name: 'Gym Membership' }]);

      const triggers = Array.from(host.querySelectorAll<HTMLElement>('.recurring-card .action-btn'));
      expect(triggers.map(trigger => trigger.getAttribute('aria-label'))).toEqual([
        'More actions for Monthly Rent',
        'More actions for Gym Membership',
      ]);
    });

    it('should offer an Edit action in the card menu', fakeAsync(() => {
      const editItem = findEditItem(openCardMenu());

      expect(editItem).withContext('Edit menu item').toBeTruthy();
      flush();
    }));

    it('should open the edit dialog for that card when Edit is clicked', fakeAsync(() => {
      const mockDialogRef = { afterClosed: () => of(undefined) };
      mockDialog.open.and.returnValue(mockDialogRef as never);

      const editItem = findEditItem(openCardMenu());
      expect(editItem).withContext('Edit menu item').toBeTruthy();
      editItem!.click();
      fixture.detectChanges();
      flush();

      expect(mockDialog.open).toHaveBeenCalledWith(RecurringFormDialogComponent, {
        width: '100%',
        maxWidth: '500px',
        data: { recurring: mockRecurring[0] }
      });
    }));

    describe('colours, as painted', () => {
      const THEMES = ['light', 'dark'] as const;
      const el = () => fixture.nativeElement as HTMLElement;
      const part = (selector: string) => el().querySelector(selector) as HTMLElement;

      /** What `<property>: var(token)` computes to under the theme on <html> now. */
      function tokenValue(token: string, property = 'color'): string {
        const probe = document.createElement('span');
        probe.style.setProperty(property, `var(${token})`);
        document.body.appendChild(probe);
        try {
          settleAnimations(document);
          return getComputedStyle(probe).getPropertyValue(property);
        } finally {
          probe.remove();
        }
      }

      /** `node` is `token`, and reads at `floor` or better on what is painted behind it. */
      function expectPainted(node: HTMLElement, token: string, label: string, floor = 4.5): void {
        expect(node).withContext(label).toBeTruthy();
        expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
        expect(ratio(paintedColor(node), paintedBackground(node)))
          .withContext(`${label} on what it sits on`)
          .toBeGreaterThanOrEqual(floor);
      }

      /** `fill` with the icon button's hover state layer (its `::before`) laid over it. */
      function underHoverLayer(button: HTMLElement, fill: Rgb): Rgb {
        const layer = button.querySelector('.mat-mdc-button-persistent-ripple') as HTMLElement;
        const { rgb } = channels(getComputedStyle(layer, '::before').backgroundColor);
        const probe = document.createElement('span');
        probe.style.opacity = hoverValue(layer, '.mat-mdc-icon-button', 'opacity', '::before');
        layer.appendChild(probe);
        const alpha = Number(getComputedStyle(probe).opacity);
        probe.remove();
        const mix = (i: 0 | 1 | 2) => Math.round(rgb[i] * alpha + fill[i] * (1 - alpha));
        return [mix(0), mix(1), mix(2)];
      }

      // The list sits on the page itself, under the budgets tab.
      beforeEach(() => {
        el().style.backgroundColor = 'var(--surface-background)';
      });

      // The card menu renders in the CDK overlay, outside the fixture.
      afterEach(() => {
        document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
      });

      it('reads the description on the page and the meta line on its card and pill at AA or better, in both themes', () => {
        for (const theme of THEMES) {
          withTheme(theme, () => {
            expect(paintedBackground(part('.section-description')))
              .withContext(`${theme} the page`)
              .toEqual(channels(tokenValue('--surface-background', 'background-color')).rgb);
            expectPainted(part('.section-description'), '--text-muted', `${theme} description`);
            expectPainted(part('.recurring-meta'), '--text-muted', `${theme} meta`);
            // The frequency carries the meta colour onto its own pill.
            expectPainted(part('.recurring-frequency'), '--text-muted', `${theme} frequency`);
          });
        }
      });

      it('sits each rule on --surface-card behind an edge in --border-primary, its name and category in the text tokens, in both themes', () => {
        const card = getComputedStyle(part('.recurring-card'));
        for (const theme of THEMES) {
          withTheme(theme, () => {
            expect(paintedBackground(part('.recurring-card')))
              .withContext(`${theme} card`)
              .toEqual(channels(tokenValue('--surface-card', 'background-color')).rgb);
            expect(card.borderTopStyle).withContext(`${theme} the edge is drawn`).toBe('solid');
            expect(card.borderTopColor).withContext(`${theme} edge`).toBe(tokenValue('--border-primary'));
            expectPainted(part('.recurring-name'), '--text-primary', `${theme} name`);
            expectPainted(part('.recurring-category'), '--text-muted', `${theme} category`);
            expectPainted(part('.recurring-next'), '--color-primary', `${theme} next date`);
          });
        }
      });

      // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11).
      it('paints the menu button in --text-muted at rest and --text-secondary hovered, its glyph at 3:1 or better, in both themes', () => {
        const button = part('.action-btn');
        const glyph = button.querySelector('mat-icon') as HTMLElement;
        const hovered = hoverValue(button, '.action-btn', 'color');
        expect(hovered).withContext('the hover rule').toBe('var(--text-secondary)');

        for (const theme of THEMES) {
          withTheme(theme, () => {
            expectPainted(glyph, '--text-muted', `${theme} menu glyph at rest`, 3);

            button.style.color = hovered;
            try {
              expect(getComputedStyle(glyph).color)
                .withContext(`${theme} menu glyph hovered`)
                .toBe(tokenValue('--text-secondary'));
              expect(ratio(paintedColor(glyph), underHoverLayer(button, paintedBackground(button))))
                .withContext(`${theme} menu glyph hovered, under the state layer`)
                .toBeGreaterThanOrEqual(3);
            } finally {
              button.style.color = '';
            }
          });
        }
      });

      /**
       * The category glyph in `card`'s header, at AA or better on the tile it
       * is drawn on, and the tile redrawn for `scheme`, so the dark pass is
       * not the light one again.
       */
      function expectGlyphOnTile(card: HTMLElement, scheme: 'light' | 'dark', label: string): void {
        const glyph = card.querySelector('.card-header mat-icon') as HTMLElement;
        expect(glyph).withContext(label).toBeTruthy();
        const tile = paintedBackground(glyph.parentElement as HTMLElement);
        expect(scheme === 'dark' ? Math.max(...tile) < 128 : Math.min(...tile) > 128)
          .withContext(`${label} tile drawn for the scheme`)
          .toBeTrue();
        expect(ratio(paintedColor(glyph), tile))
          .withContext(`${label} glyph on its tile`)
          .toBeGreaterThanOrEqual(4.5);
      }

      // Every colour a category can take: the seeded ones, the picker's
      // palette and the fallback for a missing category.
      it('draws every category glyph at AA or better on its own tile, in both themes', () => {
        const colours = [
          ...new Set(
            [
              ...[...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color),
              ...CATEGORY_PALETTE,
              CATEGORY_FALLBACK_COLOR,
            ].map(color => color.toLowerCase())
          ),
        ];
        expect(colours.length).toBe(31);
        const categories = colours.map((color, i) => ({ ...mockCategories[0], id: `cat${i}`, color }));
        mockCategoryService.loadCategories.and.returnValue(of(categories));
        const host = renderRules(
          categories.map((category, i) => ({ ...mockRecurring[0], id: `rec${i}`, categoryId: category.id }))
        );
        host.style.backgroundColor = 'var(--surface-background)';

        const cards = Array.from(host.querySelectorAll('.recurring-card')) as HTMLElement[];
        expect(cards.length).toBe(colours.length);
        for (const scheme of AUDIT_SCHEMES) {
          withScheme(TestBed.inject(ThemeService), scheme, () => {
            fixture.detectChanges();
            cards.forEach((card, i) => expectGlyphOnTile(card, scheme, `${scheme} ${colours[i]}`));
          });
        }
      });

      // The Paused chip already says the rule is paused. Faded as well, the
      // whole card falls under AA, the category glyph included.
      it('leaves a paused rule unfaded, its category glyph at AA or better on its tile, in both themes', () => {
        mockCategoryService.loadCategories.and.returnValue(of([{ ...mockCategories[0], color: '#FF9800' }]));
        const host = renderRules([{ ...mockRecurring[0], isActive: false }]);
        host.style.backgroundColor = 'var(--surface-background)';
        const card = host.querySelector('.recurring-card') as HTMLElement;
        expect(card.querySelector('.status-chip')).withContext('the rule is shown as paused').toBeTruthy();

        for (const scheme of AUDIT_SCHEMES) {
          withScheme(TestBed.inject(ThemeService), scheme, () => {
            fixture.detectChanges();
            settleAnimations(document);
            expect(getComputedStyle(card).opacity).withContext(`${scheme} the paused card`).toBe('1');
            expectGlyphOnTile(card, scheme, `${scheme} paused`);
          });
        }
      });

      // Material paints a chip's label from its own token, not from the
      // colour set on the chip, so the label is read where it is painted.
      it('paints the Paused chip as a warning, --color-warning-text on --color-warning-light at AA or better, in both themes', () => {
        const host = renderRules([{ ...mockRecurring[0], isActive: false }]);
        host.style.backgroundColor = 'var(--surface-background)';
        const label = host.querySelector('.status-chip .mdc-evolution-chip__text-label') as HTMLElement;
        expect(label).withContext('the rule is shown as paused').toBeTruthy();

        for (const theme of THEMES) {
          withTheme(theme, () => {
            expect(paintedBackground(label))
              .withContext(`${theme} the chip's container`)
              .toEqual(channels(tokenValue('--color-warning-light', 'background-color')).rgb);
            expectPainted(label, '--color-warning-text', `${theme} Paused label`);
          });
        }
      });

      /**
       * Material paints a menu item's label and icon from its own tokens, so
       * both are read where they are painted, in the overlay.
       */
      it('paints the delete item of the card menu red, label and icon, at AA or better on the menu, in both themes', fakeAsync(() => {
        const items = openCardMenu();
        expect(items.length).withContext('edit, pause and delete').toBe(3);
        const remove = items[2];
        // The TranslationService mock reads 'common.delete' as 'Delete'.
        expect(remove.querySelector('.mat-mdc-menu-item-text')?.textContent?.trim())
          .withContext('the last item deletes')
          .toBe('Delete');

        for (const theme of THEMES) {
          withTheme(theme, () => {
            expectPainted(remove.querySelector('.mat-mdc-menu-item-text') as HTMLElement, '--color-error-text', `${theme} delete label`);
            expectPainted(remove.querySelector('mat-icon') as HTMLElement, '--color-error-text', `${theme} delete icon`);
            for (const other of items.slice(0, 2)) {
              expect(getComputedStyle(other.querySelector('.mat-mdc-menu-item-text') as HTMLElement).color)
                .withContext(`${theme} ${other.textContent?.trim()} stays as Material paints it`)
                .not.toBe(tokenValue('--color-error-text'));
            }
          });
        }
        flush();
      }));
    });
  });
});
