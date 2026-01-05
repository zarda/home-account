import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { CategorySuggestionComponent } from './category-suggestion.component';
import { Category } from '../../../../models';

describe('CategorySuggestionComponent', () => {
  let component: CategorySuggestionComponent;
  let fixture: ComponentFixture<CategorySuggestionComponent>;

  const mockCategories: Category[] = [
    {
      id: 'food',
      name: 'Food & Dining',
      icon: 'restaurant',
      color: '#FF5722',
      type: 'expense',
      isActive: true,
      isDefault: true,
      userId: 'user1',
      order: 0
    },
    {
      id: 'transport',
      name: 'Transportation',
      icon: 'directions_car',
      color: '#2196F3',
      type: 'expense',
      isActive: true,
      isDefault: true,
      userId: 'user1',
      order: 1
    },
    {
      id: 'salary',
      name: 'Salary',
      icon: 'payments',
      color: '#4CAF50',
      type: 'income',
      isActive: true,
      isDefault: true,
      userId: 'user1',
      order: 2
    },
    {
      id: 'inactive',
      name: 'Inactive Category',
      icon: 'block',
      color: '#9E9E9E',
      type: 'expense',
      isActive: false,
      isDefault: false,
      userId: 'user1',
      order: 3
    },
    {
      id: 'subcategory',
      name: 'Sub Category',
      icon: 'subdirectory_arrow_right',
      color: '#9E9E9E',
      type: 'expense',
      isActive: true,
      isDefault: false,
      parentId: 'food',
      userId: 'user1',
      order: 4
    }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategorySuggestionComponent, NoopAnimationsModule],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(CategorySuggestionComponent, {
        set: { template: '<div></div>' }
      })
      .compileComponents();

    fixture = TestBed.createComponent(CategorySuggestionComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('sortedCategories', () => {
    it('should filter out inactive categories', () => {
      component.categories = mockCategories;
      fixture.detectChanges();

      const sorted = component.sortedCategories();
      expect(sorted.find(c => c.id === 'inactive')).toBeUndefined();
    });

    it('should filter out subcategories', () => {
      component.categories = mockCategories;
      fixture.detectChanges();

      const sorted = component.sortedCategories();
      expect(sorted.find(c => c.id === 'subcategory')).toBeUndefined();
    });

    it('should sort categories by name', () => {
      component.categories = mockCategories;
      fixture.detectChanges();

      const sorted = component.sortedCategories();
      expect(sorted.length).toBe(3);
      expect(sorted[0].name).toBe('Food & Dining');
      expect(sorted[1].name).toBe('Salary');
      expect(sorted[2].name).toBe('Transportation');
    });
  });

  describe('categoryName', () => {
    it('should return category name when found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'food';
      fixture.detectChanges();

      expect(component.categoryName()).toBe('Food & Dining');
    });

    it('should return Unknown when category not found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'nonexistent';
      fixture.detectChanges();

      expect(component.categoryName()).toBe('Unknown');
    });
  });

  describe('categoryIcon', () => {
    it('should return category icon when found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'food';
      fixture.detectChanges();

      expect(component.categoryIcon()).toBe('restaurant');
    });

    it('should return default icon when category not found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'nonexistent';
      fixture.detectChanges();

      expect(component.categoryIcon()).toBe('category');
    });
  });

  describe('categoryColor', () => {
    it('should return category color when found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'food';
      fixture.detectChanges();

      expect(component.categoryColor()).toBe('#FF5722');
    });

    it('should return default color when category not found', () => {
      component.categories = mockCategories;
      component.suggestedCategoryId = 'nonexistent';
      fixture.detectChanges();

      expect(component.categoryColor()).toBe('#9e9e9e');
    });
  });

  describe('confidenceClass', () => {
    it('should return high-confidence for >= 0.8', () => {
      component.confidence = 0.8;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('high-confidence');
    });

    it('should return high-confidence for > 0.8', () => {
      component.confidence = 0.95;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('high-confidence');
    });

    it('should return medium-confidence for >= 0.5 and < 0.8', () => {
      component.confidence = 0.5;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('medium-confidence');
    });

    it('should return medium-confidence for 0.7', () => {
      component.confidence = 0.7;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('medium-confidence');
    });

    it('should return low-confidence for < 0.5', () => {
      component.confidence = 0.4;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('low-confidence');
    });

    it('should return low-confidence for 0', () => {
      component.confidence = 0;
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('low-confidence');
    });
  });

  describe('confidencePercent', () => {
    it('should return rounded percentage', () => {
      component.confidence = 0.756;
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(76);
    });

    it('should handle 0', () => {
      component.confidence = 0;
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(0);
    });

    it('should handle 1', () => {
      component.confidence = 1;
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(100);
    });
  });

  describe('confidenceTooltip', () => {
    it('should return high confidence message', () => {
      component.confidence = 0.9;
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('High confidence');
    });

    it('should return medium confidence message', () => {
      component.confidence = 0.6;
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('Medium confidence');
    });

    it('should return low confidence message', () => {
      component.confidence = 0.3;
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('Low confidence');
    });
  });

  describe('selectCategory', () => {
    it('should emit categoryChanged event', () => {
      fixture.detectChanges();
      spyOn(component.categoryChanged, 'emit');

      component.selectCategory('transport');

      expect(component.categoryChanged.emit).toHaveBeenCalledWith('transport');
    });
  });
});
