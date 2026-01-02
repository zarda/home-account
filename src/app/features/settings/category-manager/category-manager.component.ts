import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';

import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Category } from '../../../models';
import { CategoryFormDialogComponent } from './category-form-dialog/category-form-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-category-manager',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    TranslatePipe,
  ],
  templateUrl: './category-manager.component.html',
  styleUrl: './category-manager.component.scss',
})
export class CategoryManagerComponent implements OnInit {
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  selectedType: 'expense' | 'income' = 'expense';
  categories = signal<Category[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadCategories();
  }

  private loadCategories(): void {
    this.categoryService.loadCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false)
    });
  }

  get filteredCategories(): Category[] {
    return this.categories()
      .filter(c => c.type === this.selectedType || c.type === 'both')
      .filter(c => c.isActive)
      .sort((a, b) => a.order - b.order);
  }

  onDrop(event: CdkDragDrop<Category[]>): void {
    const categories = [...this.filteredCategories];
    moveItemInArray(categories, event.previousIndex, event.currentIndex);

    // Update order for all categories
    const ids = categories.map(c => c.id);
    this.categoryService.reorderCategories(ids).then(() => {
      this.snackBar.open(this.translationService.t('settings.categoriesReordered'), this.translationService.t('common.close'), { duration: 2000 });
      this.loadCategories();
    });
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(CategoryFormDialogComponent, {
      width: '400px',
      data: { type: this.selectedType }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.categoryService.addCategory({
          name: result.name,
          icon: result.icon,
          color: result.color,
          type: this.selectedType,
        }).then(() => {
          this.snackBar.open(this.translationService.t('settings.categoryCreated'), this.translationService.t('common.close'), { duration: 2000 });
          this.loadCategories();
        });
      }
    });
  }

  openEditDialog(category: Category): void {
    const dialogRef = this.dialog.open(CategoryFormDialogComponent, {
      width: '400px',
      data: { category, type: this.selectedType }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.categoryService.updateCategory(category.id, {
          name: result.name,
          icon: result.icon,
          color: result.color,
        }).then(() => {
          this.snackBar.open(this.translationService.t('settings.categoryUpdated'), this.translationService.t('common.close'), { duration: 2000 });
          this.loadCategories();
        });
      }
    });
  }

  deleteCategory(category: Category): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.translationService.t('settings.deleteCategory'),
        message: this.translationService.t('settings.deleteCategoryConfirm', { name: this.translationService.t(category.name) }),
        confirmText: this.translationService.t('common.delete'),
        confirmColor: 'warn',
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.categoryService.deleteCategory(category.id).then(() => {
          this.snackBar.open(this.translationService.t('settings.categoryDeleted'), this.translationService.t('common.close'), { duration: 2000 });
          this.loadCategories();
        });
      }
    });
  }
}
