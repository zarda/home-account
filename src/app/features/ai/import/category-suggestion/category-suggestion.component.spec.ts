import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { CategorySuggestionComponent } from './category-suggestion.component';
import { Category } from '../../../../models';

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

describe('CategorySuggestionComponent', () => {
  let component: CategorySuggestionComponent;
  let fixture: ComponentFixture<CategorySuggestionComponent>;

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
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.detectChanges();

      const sorted = component.sortedCategories();
      expect(sorted.find(c => c.id === 'inactive')).toBeUndefined();
    });

    it('should filter out subcategories', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.detectChanges();

      const sorted = component.sortedCategories();
      expect(sorted.find(c => c.id === 'subcategory')).toBeUndefined();
    });

    it('should sort categories by name', () => {
      fixture.componentRef.setInput('categories', mockCategories);
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
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'food');
      fixture.detectChanges();

      expect(component.categoryName()).toBe('Food & Dining');
    });

    it('should return Unknown when category not found', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'nonexistent');
      fixture.detectChanges();

      expect(component.categoryName()).toBe('Unknown');
    });
  });

  describe('categoryIcon', () => {
    it('should return category icon when found', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'food');
      fixture.detectChanges();

      expect(component.categoryIcon()).toBe('restaurant');
    });

    it('should return default icon when category not found', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'nonexistent');
      fixture.detectChanges();

      expect(component.categoryIcon()).toBe('category');
    });
  });

  describe('categoryColor', () => {
    it('should return category color when found', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'food');
      fixture.detectChanges();

      expect(component.categoryColor()).toBe('#FF5722');
    });

    it('should return default color when category not found', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'nonexistent');
      fixture.detectChanges();

      expect(component.categoryColor()).toBe('#9e9e9e');
    });
  });

  describe('a correction after the first check', () => {
    // The review card's @for tracks rows by id and reuses this instance when
    // a row is replaced, so the chip has to follow a changed id on the same
    // instance — a computed over a plain @Input() evaluated once and stayed on
    // the model's first guess for the rest of the review.
    it('moves the name, the icon and the colour to the corrected category', () => {
      fixture.componentRef.setInput('categories', mockCategories);
      fixture.componentRef.setInput('suggestedCategoryId', 'food');
      fixture.detectChanges();
      expect(component.categoryName()).toBe('Food & Dining');

      fixture.componentRef.setInput('suggestedCategoryId', 'transport');
      fixture.detectChanges();

      expect(component.categoryName()).toBe('Transportation');
      expect(component.categoryIcon()).toBe('directions_car');
      expect(component.categoryColor()).toBe('#2196F3');
    });

    it('re-grades the dot when the confidence changes', () => {
      fixture.componentRef.setInput('confidence', 0.4);
      fixture.detectChanges();
      expect(component.confidenceClass()).toBe('low-confidence');

      fixture.componentRef.setInput('confidence', 1);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('high-confidence');
      expect(component.confidencePercent()).toBe(100);
    });
  });

  describe('confidenceClass', () => {
    it('should return high-confidence for >= 0.8', () => {
      fixture.componentRef.setInput('confidence', 0.8);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('high-confidence');
    });

    it('should return high-confidence for > 0.8', () => {
      fixture.componentRef.setInput('confidence', 0.95);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('high-confidence');
    });

    it('should return medium-confidence for >= 0.5 and < 0.8', () => {
      fixture.componentRef.setInput('confidence', 0.5);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('medium-confidence');
    });

    it('should return medium-confidence for 0.7', () => {
      fixture.componentRef.setInput('confidence', 0.7);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('medium-confidence');
    });

    it('should return low-confidence for < 0.5', () => {
      fixture.componentRef.setInput('confidence', 0.4);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('low-confidence');
    });

    it('should return low-confidence for 0', () => {
      fixture.componentRef.setInput('confidence', 0);
      fixture.detectChanges();

      expect(component.confidenceClass()).toBe('low-confidence');
    });
  });

  describe('confidencePercent', () => {
    it('should return rounded percentage', () => {
      fixture.componentRef.setInput('confidence', 0.756);
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(76);
    });

    it('should handle 0', () => {
      fixture.componentRef.setInput('confidence', 0);
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(0);
    });

    it('should handle 1', () => {
      fixture.componentRef.setInput('confidence', 1);
      fixture.detectChanges();

      expect(component.confidencePercent()).toBe(100);
    });
  });

  describe('confidenceTooltip', () => {
    // The tooltip is now translated; the real TranslationService returns the
    // key when the locale bundle isn't loaded in unit tests, so assert on the
    // per-level key the component picks.
    it('should return the high confidence key', () => {
      fixture.componentRef.setInput('confidence', 0.9);
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('confidenceHigh');
    });

    it('should return the medium confidence key', () => {
      fixture.componentRef.setInput('confidence', 0.6);
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('confidenceMedium');
    });

    it('should return the low confidence key', () => {
      fixture.componentRef.setInput('confidence', 0.3);
      fixture.detectChanges();

      expect(component.confidenceTooltip()).toContain('confidenceLow');
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

/**
 * Every case above blanks the template and reads the computeds directly, so
 * none of them can tell whether the rendered chip follows what they read.
 * This is the one place the chip's own template is rendered and the DOM is
 * asserted after the inputs move — what the review card does to this
 * component every time a category is corrected.
 */
describe('CategorySuggestionComponent, the chip through its own template', () => {
  let fixture: ComponentFixture<CategorySuggestionComponent>;

  const name = () => (fixture.nativeElement.querySelector('.category-name') as HTMLElement).textContent?.trim();
  const icon = () => fixture.nativeElement.querySelector('.category-icon') as HTMLElement;
  const dot = () => fixture.nativeElement.querySelector('.confidence-dot') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CategorySuggestionComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(CategorySuggestionComponent);
    fixture.componentRef.setInput('categories', mockCategories);
    fixture.componentRef.setInput('suggestedCategoryId', 'food');
    fixture.componentRef.setInput('confidence', 0.4);
    fixture.detectChanges();
  });

  it('renders the suggested category', () => {
    expect(name()).toBe('Food & Dining');
    expect(icon().textContent?.trim()).toBe('restaurant');
    expect(icon().style.color).toBe('rgb(255, 87, 34)');
  });

  it('moves the rendered name, icon and colour to a corrected category', () => {
    fixture.componentRef.setInput('suggestedCategoryId', 'transport');
    fixture.detectChanges();

    expect(name()).toBe('Transportation');
    expect(icon().textContent?.trim()).toBe('directions_car');
    expect(icon().style.color).toBe('rgb(33, 150, 243)');
  });

  it('turns the dot green once the reviewer has confirmed the category', () => {
    // updateCategory on the card stamps 1.0 on a corrected row.
    expect(dot().classList.contains('low-confidence')).withContext('the model\'s own grade').toBeTrue();

    fixture.componentRef.setInput('confidence', 1);
    fixture.detectChanges();

    expect(dot().classList.contains('high-confidence')).toBeTrue();
    expect(dot().classList.contains('low-confidence')).toBeFalse();
    expect(dot().getAttribute('aria-label')).toContain('confidenceHigh');
  });
});
