import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { Transaction, TransactionFilters } from '../../app/models/transaction.model';
import { CategoryService } from './category.service';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private transactionsSubject = new BehaviorSubject<Transaction[]>([]);
  private categoriesMap: Map<string, string> = new Map();

  constructor(private categoryService: CategoryService) {
    this.loadCategories();
  }

  private loadCategories(): void {
    this.categoryService.getCategories().subscribe(categories => {
      categories.forEach(cat => this.categoriesMap.set(cat.id, cat.name));
    });
  }

  getTransactions(filters?: TransactionFilters): Transaction[] {
    let result = this.transactionsSubject.getValue();

    if (filters?.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(t => {
        const matchesDescription = t.description.toLowerCase().includes(query);
        const matchesNote = t.note?.toLowerCase().includes(query);
        const matchesTags = t.tags?.some(tag => tag.toLowerCase().includes(query));
        const categoryName = this.categoriesMap.get(t.categoryId) || '';
        const matchesCategory = categoryName.toLowerCase().includes(query);
        const locationName = t.location?.name || '';
        const matchesLocation = locationName.toLowerCase().includes(query);

        return matchesDescription || matchesNote || matchesTags || matchesCategory || matchesLocation;
      });
    }

    return result;
  }

  searchTransactions(query: string): Observable<Transaction[]> {
    console.warn('searchTransactions is deprecated, use getTransactions with filters');
    return this.transactionsSubject.pipe(
      map(transactions => {
        const lowerQuery = query.toLowerCase();
        return transactions.filter(t =>
          t.description.toLowerCase().includes(lowerQuery) ||
          t.note?.toLowerCase().includes(lowerQuery) ||
          t.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
          (this.categoriesMap.get(t.categoryId) || '').toLowerCase().includes(lowerQuery) ||
          (t.location?.name || '').toLowerCase().includes(lowerQuery)
        );
      }),
      shareReplay(1)
    );
  }
}
