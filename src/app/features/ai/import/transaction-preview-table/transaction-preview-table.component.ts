import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
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
    FormsModule,
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

  // Plain methods, not computed(): `transactions` is a regular @Input array
  // (mutated in place), not a signal — a computed would evaluate once and
  // cache stale selection state forever
  selectedCount(): number {
    return this.transactions.filter(t => t.selected).length;
  }

  allSelected(): boolean {
    const nonDuplicates = this.transactions.filter(t => !t.isDuplicate);
    return nonDuplicates.length > 0 && nonDuplicates.every(t => t.selected);
  }

  someSelected(): boolean {
    return this.transactions.some(t => t.selected);
  }

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

  updateNotes(): void {
    this.emitChanges();
  }

  initNotes(transaction: CategorizedImportTransaction): void {
    transaction.notes = '';
    // Focus will happen naturally since the textarea appears via @if
  }

  getRowCount(notes: string): number {
    if (!notes) return 1;
    const lineCount = notes.split('\n').length;
    return Math.min(Math.max(lineCount, 1), 20);
  }

  private emitChanges(): void {
    this.transactionsUpdated.emit([...this.transactions]);
    const selectedIds = new Set(
      this.transactions.filter(t => t.selected).map(t => t.id)
    );
    this.selectionChanged.emit(selectedIds);
  }
}
