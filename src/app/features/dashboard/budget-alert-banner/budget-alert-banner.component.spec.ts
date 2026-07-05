import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BudgetAlertBannerComponent } from './budget-alert-banner.component';
import { BudgetService } from '../../../core/services/budget.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { BudgetAlert } from '../../../models';

describe('BudgetAlertBannerComponent', () => {
  let fixture: ComponentFixture<BudgetAlertBannerComponent>;
  let component: BudgetAlertBannerComponent;
  let budgetAlerts: ReturnType<typeof signal<BudgetAlert[]>>;
  let announcer: jasmine.SpyObj<AnnouncerService>;

  const warningAlert: BudgetAlert = {
    budgetId: 'b1',
    budgetName: 'Food',
    percentUsed: 85,
    remaining: 75,
    severity: 'warning',
  };
  const exceededAlert: BudgetAlert = {
    budgetId: 'b2',
    budgetName: 'Travel',
    percentUsed: 110,
    remaining: 0,
    severity: 'exceeded',
  };

  beforeEach(async () => {
    budgetAlerts = signal<BudgetAlert[]>([]);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [BudgetAlertBannerComponent],
      providers: [
        provideRouter([]),
        { provide: BudgetService, useValue: { budgetAlerts } },
        { provide: TranslationService, useValue: translation },
        { provide: AnnouncerService, useValue: announcer },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetAlertBannerComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when no budget crosses a threshold', () => {
    fixture.detectChanges();
    expect(component.visible()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.alert-banner')).toBeNull();
    expect(announcer.announce).not.toHaveBeenCalled();
  });

  it('shows the worst alert with severity styling and announces it once', () => {
    budgetAlerts.set([exceededAlert, warningAlert]);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.alert-banner');
    expect(banner).not.toBeNull();
    expect(banner.classList).toContain('severity-exceeded');
    expect(banner.textContent).toContain('budget.alertSnackbarExceeded');
    // +N more suffix for the second alert
    expect(banner.textContent).toContain('budget.alertSnackbarMore');
    expect(announcer.announce).toHaveBeenCalledTimes(1);
  });

  it('uses warning styling for a warning-severity alert', () => {
    budgetAlerts.set([warningAlert]);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.alert-banner');
    expect(banner.classList).toContain('severity-warning');
  });

  it('offers a View budgets action linking to /budgets', () => {
    budgetAlerts.set([warningAlert]);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.view-link');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/budgets');
  });

  it('dismiss hides the banner for the rest of the visit', () => {
    budgetAlerts.set([warningAlert]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button.dismiss-button').click();
    fixture.detectChanges();

    expect(component.visible()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.alert-banner')).toBeNull();

    // New alerts do not resurrect a dismissed banner mid-visit.
    budgetAlerts.set([exceededAlert]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.alert-banner')).toBeNull();
  });
});
