import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';
import { BudgetProgressCardComponent } from './budget-progress-card.component';
import { Budget, Category } from '../../../models';

describe('BudgetProgressCardComponent', () => {
  let component: BudgetProgressCardComponent;
  let fixture: ComponentFixture<BudgetProgressCardComponent>;

  const mockTimestamp = {
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(),
    toMillis: () => Date.now(),
    isEqual: () => false,
    toJSON: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })
  } as unknown as Timestamp;

  const mockCategory: Category = {
    id: 'cat1',
    userId: null,
    name: 'Food & Drinks',
    icon: 'restaurant',
    color: '#FF5722',
    type: 'expense',
    order: 1,
    isActive: true,
    isDefault: true
  };

  const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
    id: 'budget1',
    userId: 'user1',
    name: 'Food Budget',
    categoryId: 'cat1',
    amount: 1000,
    spent: 500,
    currency: 'USD',
    period: 'monthly',
    alertThreshold: 80,
    isActive: true,
    startDate: mockTimestamp,
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    ...overrides
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetProgressCardComponent, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(BudgetProgressCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.budget = createMockBudget();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('percentage', () => {
    it('should calculate correct percentage', () => {
      component.budget = createMockBudget({ amount: 1000, spent: 500 });
      expect(component.percentage).toBe(50);
    });

    it('should return 0 when amount is 0', () => {
      component.budget = createMockBudget({ amount: 0, spent: 100 });
      expect(component.percentage).toBe(0);
    });

    it('should cap percentage at 100', () => {
      component.budget = createMockBudget({ amount: 100, spent: 200 });
      expect(component.percentage).toBe(100);
    });

    it('should handle decimal percentages', () => {
      component.budget = createMockBudget({ amount: 300, spent: 100 });
      expect(component.percentage).toBeCloseTo(33.33, 1);
    });
  });

  describe('remaining', () => {
    it('should calculate remaining amount', () => {
      component.budget = createMockBudget({ amount: 1000, spent: 300 });
      expect(component.remaining).toBe(700);
    });

    it('should return 0 when over budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 200 });
      expect(component.remaining).toBe(0);
    });

    it('should return full amount when nothing spent', () => {
      component.budget = createMockBudget({ amount: 500, spent: 0 });
      expect(component.remaining).toBe(500);
    });
  });

  describe('isOverBudget', () => {
    it('should return true when spent exceeds amount', () => {
      component.budget = createMockBudget({ amount: 100, spent: 150 });
      expect(component.isOverBudget).toBe(true);
    });

    it('should return false when under budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 50 });
      expect(component.isOverBudget).toBe(false);
    });

    it('should return false when exactly at budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 100 });
      expect(component.isOverBudget).toBe(false);
    });
  });

  describe('progressColor', () => {
    it('should return primary for under 50%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 40 });
      expect(component.progressColor).toBe('primary');
    });

    it('should return accent for 50-79%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 60 });
      expect(component.progressColor).toBe('accent');
    });

    it('should return warn for 80% and above', () => {
      component.budget = createMockBudget({ amount: 100, spent: 85 });
      expect(component.progressColor).toBe('warn');
    });

    it('should return warn for over budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 150 });
      expect(component.progressColor).toBe('warn');
    });
  });

  describe('statusClass', () => {
    it('should return green class for under 50%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 40 });
      expect(component.statusClass).toBe('text-green-600');
    });

    it('should return yellow class for 50-79%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 60 });
      expect(component.statusClass).toBe('text-yellow-600');
    });

    it('should return orange class for 80-99%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 85 });
      expect(component.statusClass).toBe('text-orange-500');
    });

    it('should return red class with semibold for 100% and over', () => {
      component.budget = createMockBudget({ amount: 100, spent: 110 });
      expect(component.statusClass).toBe('text-red-600 font-semibold');
    });
  });

  describe('showAlert', () => {
    it('should show alert when percentage reaches threshold', () => {
      component.budget = createMockBudget({ amount: 100, spent: 80, alertThreshold: 80 });
      expect(component.showAlert).toBe(true);
    });

    it('should not show alert when under threshold', () => {
      component.budget = createMockBudget({ amount: 100, spent: 70, alertThreshold: 80 });
      expect(component.showAlert).toBe(false);
    });

    it('should show alert when over budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 150, alertThreshold: 80 });
      expect(component.showAlert).toBe(true);
    });
  });

  describe('alertSeverity', () => {
    it('should return warning for 80-89%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 85, alertThreshold: 80 });
      expect(component.alertSeverity).toBe('warning');
    });

    it('should return critical for 90-99%', () => {
      component.budget = createMockBudget({ amount: 100, spent: 95, alertThreshold: 80 });
      expect(component.alertSeverity).toBe('critical');
    });

    it('should return exceeded for 100% and over', () => {
      component.budget = createMockBudget({ amount: 100, spent: 110, alertThreshold: 80 });
      expect(component.alertSeverity).toBe('exceeded');
    });
  });

  describe('alertText', () => {
    it('should return appropriate text for warning', () => {
      component.budget = createMockBudget({ amount: 100, spent: 85, alertThreshold: 80 });
      expect(component.alertText).toBe('Approaching limit');
    });

    it('should return appropriate text for critical', () => {
      component.budget = createMockBudget({ amount: 100, spent: 95, alertThreshold: 80 });
      expect(component.alertText).toBe('Almost at limit');
    });

    it('should return appropriate text for exceeded', () => {
      component.budget = createMockBudget({ amount: 100, spent: 110, alertThreshold: 80 });
      expect(component.alertText).toBe('Budget exceeded!');
    });
  });

  describe('getPeriodLabel', () => {
    it('should return Weekly for weekly period', () => {
      component.budget = createMockBudget();
      expect(component.getPeriodLabel('weekly')).toBe('Weekly');
    });

    it('should return Monthly for monthly period', () => {
      component.budget = createMockBudget();
      expect(component.getPeriodLabel('monthly')).toBe('Monthly');
    });

    it('should return Yearly for yearly period', () => {
      component.budget = createMockBudget();
      expect(component.getPeriodLabel('yearly')).toBe('Yearly');
    });
  });

  describe('formatCurrency', () => {
    it('should format USD currency correctly', () => {
      component.budget = createMockBudget({ currency: 'USD' });
      const formatted = component.formatCurrency(1234.56);
      expect(formatted).toContain('1,234');
    });

    it('should format EUR currency correctly', () => {
      component.budget = createMockBudget({ currency: 'EUR' });
      const formatted = component.formatCurrency(1234.56);
      expect(formatted).toContain('1,234');
    });
  });

  describe('getRemainingText', () => {
    it('should show remaining amount when under budget', () => {
      component.budget = createMockBudget({ amount: 1000, spent: 300, currency: 'USD' });
      const text = component.getRemainingText();
      expect(text).toContain('700');
      expect(text).toContain('left');
    });

    it('should show over amount when over budget', () => {
      component.budget = createMockBudget({ amount: 100, spent: 150, currency: 'USD' });
      const text = component.getRemainingText();
      expect(text).toContain('50');
      expect(text).toContain('over');
    });
  });

  describe('event emitters', () => {
    beforeEach(() => {
      component.budget = createMockBudget();
      component.category = mockCategory;
      fixture.detectChanges();
    });

    it('should emit edit event', () => {
      const editSpy = spyOn(component.edit, 'emit');
      component.edit.emit();
      expect(editSpy).toHaveBeenCalled();
    });

    it('should emit delete event', () => {
      const deleteSpy = spyOn(component.delete, 'emit');
      component.delete.emit();
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  describe('UI rendering', () => {
    beforeEach(() => {
      component.budget = createMockBudget();
      component.category = mockCategory;
      fixture.detectChanges();
    });

    it('should display budget name', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('Food Budget');
    });

    it('should display category icon', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('restaurant');
    });

    it('should display progress bar', () => {
      const progressBar = fixture.nativeElement.querySelector('mat-progress-bar');
      expect(progressBar).toBeTruthy();
    });

    it('should display menu button', () => {
      const menuButton = fixture.nativeElement.querySelector('[mat-icon-button]');
      expect(menuButton).toBeTruthy();
    });
  });
});
