import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { CATEGORY_FALLBACK_COLOR, Category, CategorySource } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';
import { CategoryGlyphPipe } from '../../../../shared/pipes/category-glyph.pipe';
import { CategoryRowType, categoryFitsType } from '../../../../core/utils/categorization.utils';
import { categoryDisplayName } from '../../../../core/utils/category-display.utils';

/**
 * The dot's sentence for a grade whose source is known and is not a figure a
 * categorizer reported. None quotes a percentage: the grade behind each is
 * policy, or a measure of something other than the category.
 */
const SOURCE_SENTENCE_KEYS: Record<Exclude<CategorySource, 'reported'>, string> = {
  memory: 'import.categoryFromMemory',
  reviewer: 'import.categoryByYou',
  backup: 'import.categoryFromBackup',
  file: 'import.categoryFromFile',
  reader: 'import.categoryFromReader',
  device: 'import.categoryFromDevice',
};

@Component({
  selector: 'app-category-suggestion',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatButtonModule,
    FitTextDirective,
    CategoryGlyphPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category-suggestion.component.html',
  styleUrl: './category-suggestion.component.scss'
})
export class CategorySuggestionComponent {
  private translationService = inject(TranslationService);

  // Signal inputs, because every computed below reads them. A computed over a
  // plain @Input() has no producer, so it evaluates once and caches for the
  // life of the instance — and the review card's @for tracks rows by id, so
  // the instance outlives every replaceRow. A corrected category moved the
  // menu's selected mark and left the chip on the model's first guess.
  suggestedCategoryId = input.required<string>();
  confidence = input(0);
  // Where the grade came from, as the row carries it. It picks the dot's
  // sentence; the grade alone still picks the dot's colour. Left unset, the
  // dot says a category was suggested and quotes nothing.
  source = input<CategorySource | undefined>(undefined);
  categories = input<Category[]>([]);
  // The side the row sits on. The card files a flipped row's category on its
  // new side, so a menu still listing the other side would let the reviewer
  // pick an expense category straight back onto an income row. Left unset,
  // the menu offers every side, as it did for a host that never says.
  rowType = input<CategoryRowType | undefined>(undefined);
  @Output() categoryChanged = new EventEmitter<string>();

  // Only the menu is narrowed. The name, icon and colour below look the held
  // id up in the whole list, so a category from the other side is still named
  // on the chip until the reviewer picks another, never "Unknown".
  sortedCategories = computed(() => {
    const type = this.rowType();
    return [...this.categories()]
      .filter(c => c.isActive && !c.parentId && (!type || categoryFitsType(c, type)))
      .sort((a, b) => this.translateName(a.name).localeCompare(this.translateName(b.name)));
  });

  categoryName = computed(() =>
    categoryDisplayName(this.categories(), this.suggestedCategoryId(), name => this.translateName(name))
  );

  translateName(name: string): string {
    return this.translationService.t(name);
  }

  categoryIcon = computed(() => {
    const category = this.categories().find(c => c.id === this.suggestedCategoryId());
    return category?.icon || 'category';
  });

  categoryColor = computed(() => {
    const category = this.categories().find(c => c.id === this.suggestedCategoryId());
    return category?.color || CATEGORY_FALLBACK_COLOR;
  });

  confidenceClass = computed(() => {
    const confidence = this.confidence();
    if (confidence >= 0.8) return 'high-confidence';
    if (confidence >= 0.5) return 'medium-confidence';
    return 'low-confidence';
  });

  confidencePercent = computed(() => {
    return Math.round(this.confidence() * 100);
  });

  /**
   * The dot's tooltip and its accessible name. It chooses on where the grade
   * came from, never on the grade's value, and quotes a percentage only for
   * a categorizer answer that carried its own number: a remembered category
   * is graded 0.95 and a reviewer's pick 1.0 by policy, and a device row's
   * grade measures how clearly the text was read, so "95%", "100%" and the
   * rest were figures nothing measured about the category (ADR 0045's rule).
   */
  confidenceTooltip = computed(() => {
    const source = this.source();
    const level = this.confidenceClass();
    if (source === 'reported') {
      const key =
        level === 'high-confidence'
          ? 'import.confidenceHigh'
          : level === 'medium-confidence'
            ? 'import.confidenceMedium'
            : 'import.confidenceLow';
      return this.translationService.t(key, { percent: this.confidencePercent() });
    }
    if (source) {
      return this.translationService.t(SOURCE_SENTENCE_KEYS[source]);
    }
    return this.translationService.t(
      level === 'low-confidence' ? 'import.categoryUnresolved' : 'import.categorySuggested'
    );
  });

  selectCategory(categoryId: string): void {
    this.categoryChanged.emit(categoryId);
  }
}
