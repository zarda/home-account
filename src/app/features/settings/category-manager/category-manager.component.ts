import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';

import { CategoryService } from '../../../core/services/category.service';
import { TranslationService } from '../../../core/services/translation.service';
import { Category } from '../../../models';
import { CategoryFormDialogComponent } from './category-form-dialog/category-form-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { CategoryChipComponent } from '../../../shared/components/category-chip/category-chip.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-category-manager',
  standalone: true,
  imports: [
    EmptyStateComponent,
    CategoryChipComponent,
    CommonModule,
    FormsModule,
    DragDropModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDialogModule,
    MatMenuModule,
    TranslatePipe,
  ],
  templateUrl: './category-manager.component.html',
  styleUrl: './category-manager.component.scss',
})
export class CategoryManagerComponent implements OnInit {
  private notifications = inject(NotificationService);
  private categoryService = inject(CategoryService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);

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
      const message = this.translationService.t('settings.categoriesReordered');
      this.notifications.success(message);
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
          const message = this.translationService.t('settings.categoryCreated');
          this.notifications.success(message);
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
          const message = this.translationService.t('settings.categoryUpdated');
          this.notifications.success(message);
          this.loadCategories();
        });
      }
    });
  }

  deleteCategory(category: Category): void {
    // Typed as ConfirmDialogData so wrong keys (the old confirmText typo,
    // which silently fell back to a hardcoded English label) fail to compile.
    const data: ConfirmDialogData = {
      title: this.translationService.t('settings.deleteCategory'),
      message: this.translationService.t('settings.deleteCategoryConfirm', { name: this.translationService.t(category.name) }),
      confirmLabel: this.translationService.t('common.delete'),
      cancelLabel: this.translationService.t('common.cancel'),
      confirmColor: 'warn',
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, { data });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.categoryService.deleteCategory(category.id).then(() => {
          const message = this.translationService.t('settings.categoryDeleted');
          this.notifications.success(message);
          this.loadCategories();
        });
      }
    });
  }
}
