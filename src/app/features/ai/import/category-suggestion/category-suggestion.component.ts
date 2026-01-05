import { Component, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { Category } from '../../../../models';

@Component({
  selector: 'app-category-suggestion',
  standalone: true,
  imports: [
    CommonModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatButtonModule
  ],
  templateUrl: './category-suggestion.component.html',
  styleUrl: './category-suggestion.component.scss'
})
export class CategorySuggestionComponent {
  @Input() suggestedCategoryId!: string;
  @Input() confidence = 0;
  @Input() categories: Category[] = [];
  @Output() categoryChanged = new EventEmitter<string>();

  sortedCategories = computed(() => {
    return [...this.categories]
      .filter(c => c.isActive && !c.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  categoryName = computed(() => {
    const category = this.categories.find(c => c.id === this.suggestedCategoryId);
    return category?.name || 'Unknown';
  });

  categoryIcon = computed(() => {
    const category = this.categories.find(c => c.id === this.suggestedCategoryId);
    return category?.icon || 'category';
  });

  categoryColor = computed(() => {
    const category = this.categories.find(c => c.id === this.suggestedCategoryId);
    return category?.color || '#9e9e9e';
  });

  confidenceClass = computed(() => {
    if (this.confidence >= 0.8) return 'high-confidence';
    if (this.confidence >= 0.5) return 'medium-confidence';
    return 'low-confidence';
  });

  confidencePercent = computed(() => {
    return Math.round(this.confidence * 100);
  });

  confidenceTooltip = computed(() => {
    const level = this.confidenceClass();
    switch (level) {
      case 'high-confidence':
        return 'High confidence - AI is confident about this category';
      case 'medium-confidence':
        return 'Medium confidence - You may want to verify this category';
      default:
        return 'Low confidence - Please review and select the correct category';
    }
  });

  selectCategory(categoryId: string): void {
    this.categoryChanged.emit(categoryId);
  }
}
