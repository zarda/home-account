import { Component, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Category, CategorizedImportTransaction } from '../../../../models';
import { CategorySuggestionComponent } from '../category-suggestion/category-suggestion.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-transaction-preview-table',
  standalone: true,
  imports: [
    CommonModule,
    MatCheckboxModule,
    MatIconModule,
    MatButtonModule,
    CategorySuggestionComponent,
    TranslatePipe
  ],
  templateUrl: './transaction-preview-table.component.html',
  styleUrl: './transaction-preview-table.component.scss'
})
export class TransactionPreviewTableComponent {
  @Input() transactions: CategorizedImportTransaction[] = [];
  @Input() categories: Category[] = [];
  @Output() transactionsUpdated = new EventEmitter<CategorizedImportTransaction[]>();
  @Output() selectionChanged = new EventEmitter<Set<string>>();

  selectedCount = computed(() => {
    return this.transactions.filter(t => t.selected).length;
  });

  allSelected = computed(() => {
    const nonDuplicates = this.transactions.filter(t => !t.isDuplicate);
    return nonDuplicates.length > 0 && nonDuplicates.every(t => t.selected);
  });

  someSelected = computed(() => {
    return this.transactions.some(t => t.selected);
  });

  toggleSelectAll(checked: boolean): void {
    this.transactions.forEach(t => {
      if (!t.isDuplicate) {
        t.selected = checked;
      }
    });
    this.emitChanges();
  }

  toggleSelection(transaction: CategorizedImportTransaction, checked: boolean): void {
    transaction.selected = checked;
    this.emitChanges();
  }

  toggleType(transaction: CategorizedImportTransaction): void {
    transaction.type = transaction.type === 'income' ? 'expense' : 'income';
    this.emitChanges();
  }

  updateCategory(transaction: CategorizedImportTransaction, categoryId: string): void {
    transaction.suggestedCategoryId = categoryId;
    transaction.categoryConfidence = 1.0; // User confirmed
    this.emitChanges();
  }

  private emitChanges(): void {
    this.transactionsUpdated.emit([...this.transactions]);
    const selectedIds = new Set(
      this.transactions.filter(t => t.selected).map(t => t.id)
    );
    this.selectionChanged.emit(selectedIds);
  }
}
