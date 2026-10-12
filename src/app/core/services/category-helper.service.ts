import { inject, Injectable } from '@angular/core';
import { CATEGORY_FALLBACK_COLOR, Category } from '../../models';
import { categoryDisplayName, categoryNameOrUnknown } from '../utils/category-display.utils';
import { TranslationService } from './translation.service';

@Injectable({ providedIn: 'root' })
export class CategoryHelperService {
  private translationService = inject(TranslationService);

  /**
   * Gets the category name from a categories map (translated), or Unknown in
   * the reader's language for an id the map does not hold.
   */
  getCategoryName(categoryId: string, categories: Map<string, Category>): string {
    return categoryNameOrUnknown(categories.get(categoryId)?.name, key => this.translationService.t(key));
  }

  /**
   * Gets the category icon from a categories map
   */
  getCategoryIcon(categoryId: string, categories: Map<string, Category>): string {
    return categories.get(categoryId)?.icon || 'category';
  }

  /**
   * Gets the category color from a categories map
   */
  getCategoryColor(categoryId: string, categories: Map<string, Category>): string {
    return categories.get(categoryId)?.color || CATEGORY_FALLBACK_COLOR;
  }

  /**
   * Gets the category name from a categories array (translated), or Unknown in
   * the reader's language for an id the array does not hold.
   */
  getCategoryNameFromArray(categoryId: string, categories: Category[]): string {
    return categoryDisplayName(categories, categoryId, key => this.translationService.t(key));
  }

  /**
   * Gets the category icon from a categories array
   */
  getCategoryIconFromArray(categoryId: string, categories: Category[]): string {
    const category = categories.find(c => c.id === categoryId);
    return category?.icon || 'category';
  }

  /**
   * Gets the category color from a categories array
   */
  getCategoryColorFromArray(categoryId: string, categories: Category[]): string {
    const category = categories.find(c => c.id === categoryId);
    return category?.color || CATEGORY_FALLBACK_COLOR;
  }
}
