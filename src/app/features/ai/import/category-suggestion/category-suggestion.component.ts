import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { Category } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';

@Component({
  selector: 'app-category-suggestion',
  standalone: true,
  imports: [
    CommonModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatButtonModule,
    FitTextDirective
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
  categories = input<Category[]>([]);
  @Output() categoryChanged = new EventEmitter<string>();

  sortedCategories = computed(() => {
    return [...this.categories()]
      .filter(c => c.isActive && !c.parentId)
      .sort((a, b) => this.translateName(a.name).localeCompare(this.translateName(b.name)));
  });

  categoryName = computed(() => {
    const category = this.categories().find(c => c.id === this.suggestedCategoryId());
    return category?.name ? this.translateName(category.name) : 'Unknown';
  });

  translateName(name: string): string {
    return this.translationService.t(name);
  }

  categoryIcon = computed(() => {
    const category = this.categories().find(c => c.id === this.suggestedCategoryId());
    return category?.icon || 'category';
  });

  categoryColor = computed(() => {
    const category = this.categories().find(c => c.id === this.suggestedCategoryId());
    return category?.color || '#9e9e9e';
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

  confidenceTooltip = computed(() => {
    const percent = this.confidencePercent();
    const level = this.confidenceClass();
    const key =
      level === 'high-confidence'
        ? 'import.confidenceHigh'
        : level === 'medium-confidence'
          ? 'import.confidenceMedium'
          : 'import.confidenceLow';
    return this.translationService.t(key, { percent });
  });

  selectCategory(categoryId: string): void {
    this.categoryChanged.emit(categoryId);
  }
}
