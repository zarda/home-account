import { inject, Injectable } from '@angular/core';
import { Category } from '../../models';
import { TranslationService } from './translation.service';

@Injectable({ providedIn: 'root' })
export class CategoryHelperService {
  private translationService = inject(TranslationService);

  /**
   * Gets the category name from a categories map (translated)
   */
  getCategoryName(categoryId: string, categories: Map<string, Category>): string {
    const name = categories.get(categoryId)?.name;
    return name ? this.translationService.t(name) : 'Unknown';
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
    return categories.get(categoryId)?.color || '#9E9E9E';
  }

  /**
   * Gets the category name from a categories array (translated)
   */
  getCategoryNameFromArray(categoryId: string, categories: Category[]): string {
    const category = categories.find(c => c.id === categoryId);
    return category?.name ? this.translationService.t(category.name) : 'Unknown';
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
    return category?.color || '#9E9E9E';
  }
}
