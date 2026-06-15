import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CategoryChipComponent } from './category-chip.component';
import { ThemeService } from '../../../core/services/theme.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Category } from '../../../models';

describe('CategoryChipComponent', () => {
  let component: CategoryChipComponent;
  let fixture: ComponentFixture<CategoryChipComponent>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  const category: Category = {
    id: 'food',
    userId: null,
    name: 'category.food',
    icon: 'restaurant',
    color: '#3366CC',
    type: 'expense',
    order: 0,
    isActive: true,
    isDefault: true,
  };

  beforeEach(async () => {
    mockThemeService = jasmine.createSpyObj('ThemeService', ['effectiveTheme']);
    mockThemeService.effectiveTheme.and.returnValue('light');
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [CategoryChipComponent],
      providers: [
        { provide: ThemeService, useValue: mockThemeService },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryChipComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a category chip', () => {
    component.category = category;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('restaurant');
  });

  describe('getBackgroundColor', () => {
    it('uses low opacity in light mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getBackgroundColor('#3366CC')).toBe('#3366CC20');
    });

    it('uses higher opacity in dark mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      expect(component.getBackgroundColor('#3366CC')).toBe('#3366CC40');
    });
  });

  describe('getTextColor', () => {
    it('returns the original colour in light mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('light');
      expect(component.getTextColor('#3366CC')).toBe('#3366CC');
    });

    it('lightens the colour in dark mode', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      const result = component.getTextColor('#000000');
      // 0 + (255-0)*0.3 = 76.5 -> 77 (0x4d) per channel
      expect(result).toBe('#4d4d4d');
    });

    it('handles colours without a leading hash and clamps at 255', () => {
      mockThemeService.effectiveTheme.and.returnValue('dark');
      expect(component.getTextColor('ffffff')).toBe('#ffffff');
    });
  });
});
