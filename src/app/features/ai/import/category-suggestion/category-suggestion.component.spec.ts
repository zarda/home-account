import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { CategorySuggestionComponent } from './category-suggestion.component';
import { Category } from '../../../../models';
import {
  channels,
  paintedBackground,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../../core/services/testing';
import type { Rgb } from '../../../../core/utils/color-contrast.utils';

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

  describe('the row\'s side', () => {
    // A category the user made can serve either side; no default does.
    const sides: Category[] = [
      ...mockCategories,
      {
        id: 'shared',
        name: 'Shared',
        icon: 'swap_horiz',
        color: '#607D8B',
        type: 'both',
        isActive: true,
        isDefault: false,
        userId: 'user1',
        order: 5
      }
    ];
    const offered = () => component.sortedCategories().map(c => c.id);

    beforeEach(() => {
      fixture.componentRef.setInput('categories', sides);
      fixture.componentRef.setInput('suggestedCategoryId', 'food');
    });

    it('offers only the categories that fit an income row, and those that fit both', () => {
      // The card's flip moves a category that no longer fits to the income
      // side's catch-all; a menu that still listed food would let the
      // reviewer pick it straight back.
      fixture.componentRef.setInput('rowType', 'income');
      TestBed.tick();

      expect(offered()).toEqual(['salary', 'shared']);
    });

    it('offers only the categories that fit an expense row', () => {
      fixture.componentRef.setInput('rowType', 'expense');
      TestBed.tick();

      expect(offered()).toEqual(['food', 'shared', 'transport']);
    });

    it('offers every side when the row\'s type is not given', () => {
      // A pin: a host that never says which side its row is on gets the menu
      // it always had.
      TestBed.tick();

      expect(offered()).toEqual(['food', 'salary', 'shared', 'transport']);
    });

    it('still names a held category that does not fit, rather than calling it Unknown', () => {
      // A pin: only the menu is narrowed. A category the row already holds is
      // looked up in the whole list, so one from the other side is still
      // named on the chip, never "Unknown", until the reviewer picks another.
      fixture.componentRef.setInput('rowType', 'income');
      TestBed.tick();

      expect(component.categoryName()).toBe('Food & Dining');
      expect(component.categoryIcon()).toBe('restaurant');
      expect(component.categoryColor()).toBe('#FF5722');
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
  const label = () => fixture.nativeElement.querySelector('.mdc-button__label') as HTMLElement;
  const caret = () => fixture.nativeElement.querySelector('.dropdown-icon') as HTMLElement;

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

  // The dot is a graphic with a name of its own, not decoration beside a
  // label that says the same, so it owes 3:1 to the review card around it
  // (WCAG 1.4.11). The success and warning fills measure about 2.1:1 and
  // 1.8:1 on the light cards, so those two levels draw in their text steps.
  // An unchecked card is the page's own fill; a checked or flagged one has a
  // surface of its own.
  it('draws each confidence level\'s dot in its token at 3:1 or better on an unchecked, a checked and a flagged card, in both themes', () => {
    const host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    const levels = [
      [0.9, 'high-confidence', '--color-success-text'],
      [0.6, 'medium-confidence', '--color-warning-text'],
      [0.4, 'low-confidence', '--color-error'],
    ] as const;
    const cards = ['--surface-background', '--surface-review-selected', '--surface-review-duplicate'];

    /** What `background-color: var(token)` computes to under the theme on <html> now. */
    const fill = (token: string) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(${token})`;
      document.body.appendChild(probe);
      try {
        return getComputedStyle(probe).backgroundColor;
      } finally {
        probe.remove();
      }
    };

    for (const [confidence, level, token] of levels) {
      fixture.componentRef.setInput('confidence', confidence);
      fixture.detectChanges();
      expect(dot().classList.contains(level)).withContext(level).toBeTrue();
      for (const card of cards) {
        host.style.backgroundColor = `var(${card})`;
        for (const theme of ['light', 'dark'] as const) {
          withTheme(theme, () => {
            settleAnimations(document);
            expect(getComputedStyle(dot()).backgroundColor).withContext(`${theme} ${level}`).toBe(fill(token));
            expect(ratio(paintedBackground(dot()), paintedBackground(dot().parentElement!)))
              .withContext(`${theme} ${level} dot on ${card}`)
              .toBeGreaterThanOrEqual(3);
          });
        }
      }
    }
  });

  it('projects the caret after the name', () => {
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(icon(), label())).withContext('label after the category icon').toBeTrue();
    expect(follows(label(), caret())).withContext('caret after the label').toBeTrue();
  });

  describe('the open menu', () => {
    // The panel renders in the CDK overlay, outside the fixture.
    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    /** What `background-color: var(token)` computes to under the theme on <html> now. */
    function surface(token: string): string {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(${token})`;
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).backgroundColor;
      } finally {
        probe.remove();
      }
    }

    /** A computed colour as the whole channels it is painted in. */
    function rounded(computed: string): Rgb {
      const [r, g, b] = channels(computed).rgb;
      return [Math.round(r), Math.round(g), Math.round(b)];
    }

    // A category's glyph owes contrast to the surface it sits on, so the
    // current item has to paint a surface the stylesheet declares. The menu
    // focuses its first item on opening, whose state layer would cover the
    // fill under test, so the current category here is the last one.
    it('marks the current category on --surface-menu-current, in both themes', () => {
      fixture.componentRef.setInput('suggestedCategoryId', 'transport');
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.category-button') as HTMLElement).click();
      fixture.detectChanges();

      const items = Array.from(
        document.querySelectorAll('.category-menu .mat-mdc-menu-item')
      ) as HTMLElement[];
      const current = items.find(item => item.classList.contains('selected'));
      expect(current?.textContent).withContext('the current item').toContain('Transportation');

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          settleAnimations(document);
          expect(getComputedStyle(current!).backgroundColor)
            .withContext(`${theme} the item's own fill`)
            .toBe(surface('--surface-menu-current'));
          expect(paintedBackground(current!))
            .withContext(`${theme} the item as painted`)
            .toEqual(rounded(surface('--surface-menu-current')));
        });
      }
    });
  });
});
