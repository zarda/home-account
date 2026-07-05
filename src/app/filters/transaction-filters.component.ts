import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { TransactionFilters } from '../../app/models/transaction.model';

@Component({
  selector: 'app-transaction-filters',
  templateUrl: './transaction-filters.component.html'
})
export class TransactionFiltersComponent implements OnInit, OnDestroy {
  filters: TransactionFilters = { searchQuery: '' };
  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(250),
      takeUntil(this.destroy$)
    ).subscribe(query => {
      this.filters.searchQuery = query;
      this.onFiltersChanged();
    });
  }

  onSearchInput(value: string): void {
    this.searchSubject.next(value);
  }

  onFiltersChanged(): void {
    // Emit or call service to update transactions list
    // This could be via an @Output or directly calling a service method
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
