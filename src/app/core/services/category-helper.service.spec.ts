import { TestBed } from '@angular/core/testing';
import { CategoryHelperService } from './category-helper.service';
import { Category } from '../../models';

describe('CategoryHelperService', () => {
  let service: CategoryHelperService;

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
      name: 'Transportation',
      icon: 'directions_car',
      color: '#2196F3',
      type: 'expense',
      order: 2,
      isActive: true,
      isDefault: true
    },
    {
      id: 'cat3',
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

  let categoriesMap: Map<string, Category>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CategoryHelperService);

    categoriesMap = new Map<string, Category>();
    mockCategories.forEach(cat => categoriesMap.set(cat.id, cat));
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Map-based methods', () => {
    describe('getCategoryName', () => {
      it('should return category name for valid id', () => {
        expect(service.getCategoryName('cat1', categoriesMap)).toBe('Food & Drinks');
        expect(service.getCategoryName('cat2', categoriesMap)).toBe('Transportation');
        expect(service.getCategoryName('cat3', categoriesMap)).toBe('Salary');
      });

      // No catalog is loaded here, so the translation answers with its key:
      // the fallback is the reader's word for unknown, not English.
      it('names an unknown id in the reader\'s language', () => {
        expect(service.getCategoryName('invalid', categoriesMap)).toBe('common.unknownCategory');
      });

      it('names every id unknown in an empty map', () => {
        expect(service.getCategoryName('cat1', new Map())).toBe('common.unknownCategory');
      });
    });

    describe('getCategoryIcon', () => {
      it('should return category icon for valid id', () => {
        expect(service.getCategoryIcon('cat1', categoriesMap)).toBe('restaurant');
        expect(service.getCategoryIcon('cat2', categoriesMap)).toBe('directions_car');
        expect(service.getCategoryIcon('cat3', categoriesMap)).toBe('payments');
      });

      it('should return "category" for invalid id', () => {
        expect(service.getCategoryIcon('invalid', categoriesMap)).toBe('category');
      });

      it('should return "category" for empty map', () => {
        expect(service.getCategoryIcon('cat1', new Map())).toBe('category');
      });
    });

    describe('getCategoryColor', () => {
      it('should return category color for valid id', () => {
        expect(service.getCategoryColor('cat1', categoriesMap)).toBe('#FF5722');
        expect(service.getCategoryColor('cat2', categoriesMap)).toBe('#2196F3');
        expect(service.getCategoryColor('cat3', categoriesMap)).toBe('#4CAF50');
      });

      it('should return default gray for invalid id', () => {
        expect(service.getCategoryColor('invalid', categoriesMap)).toBe('#9E9E9E');
      });

      it('should return default gray for empty map', () => {
        expect(service.getCategoryColor('cat1', new Map())).toBe('#9E9E9E');
      });
    });
  });

  describe('Array-based methods', () => {
    describe('getCategoryNameFromArray', () => {
      it('should return category name for valid id', () => {
        expect(service.getCategoryNameFromArray('cat1', mockCategories)).toBe('Food & Drinks');
        expect(service.getCategoryNameFromArray('cat2', mockCategories)).toBe('Transportation');
      });

      it('names an unknown id in the reader\'s language', () => {
        expect(service.getCategoryNameFromArray('invalid', mockCategories)).toBe('common.unknownCategory');
      });

      it('names every id unknown in an empty array', () => {
        expect(service.getCategoryNameFromArray('cat1', [])).toBe('common.unknownCategory');
      });
    });

    describe('getCategoryIconFromArray', () => {
      it('should return category icon for valid id', () => {
        expect(service.getCategoryIconFromArray('cat1', mockCategories)).toBe('restaurant');
        expect(service.getCategoryIconFromArray('cat2', mockCategories)).toBe('directions_car');
      });

      it('should return "category" for invalid id', () => {
        expect(service.getCategoryIconFromArray('invalid', mockCategories)).toBe('category');
      });

      it('should return "category" for empty array', () => {
        expect(service.getCategoryIconFromArray('cat1', [])).toBe('category');
      });
    });

    describe('getCategoryColorFromArray', () => {
      it('should return category color for valid id', () => {
        expect(service.getCategoryColorFromArray('cat1', mockCategories)).toBe('#FF5722');
        expect(service.getCategoryColorFromArray('cat2', mockCategories)).toBe('#2196F3');
      });

      it('should return default gray for invalid id', () => {
        expect(service.getCategoryColorFromArray('invalid', mockCategories)).toBe('#9E9E9E');
      });

      it('should return default gray for empty array', () => {
        expect(service.getCategoryColorFromArray('cat1', [])).toBe('#9E9E9E');
      });
    });
  });
});
