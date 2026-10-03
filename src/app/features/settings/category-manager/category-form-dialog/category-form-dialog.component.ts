import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { CATEGORY_PALETTE, Category } from '../../../../models';
import { CategoryChipComponent } from '../../../../shared/components/category-chip/category-chip.component';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { CategoryGlyphPipe } from '../../../../shared/pipes/category-glyph.pipe';
import { ReadableOnPipe } from '../../../../shared/pipes/readable-on.pipe';

interface DialogData {
  category?: Category;
  type: 'expense' | 'income';
}

const CATEGORY_ICONS = [
  'restaurant', 'local_cafe', 'fastfood', 'shopping_cart', 'shopping_bag',
  'local_gas_station', 'directions_car', 'flight', 'hotel', 'home',
  'apartment', 'payments', 'attach_money', 'credit_card', 'account_balance',
  'medical_services', 'fitness_center', 'school', 'work', 'movie',
  'sports_esports', 'pets', 'child_care', 'card_giftcard', 'celebration',
];

@Component({
  selector: 'app-category-form-dialog',
  standalone: true,
  imports: [
    CategoryChipComponent,
    DialogHeaderComponent,
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    CategoryGlyphPipe,
    ReadableOnPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category-form-dialog.component.html',
  styleUrl: './category-form-dialog.component.scss',
})
export class CategoryFormDialogComponent {
  private dialogRef = inject(MatDialogRef<CategoryFormDialogComponent>);
  private data = inject<DialogData>(MAT_DIALOG_DATA);

  icons = CATEGORY_ICONS;
  colors = CATEGORY_PALETTE;

  name = this.data.category?.name || '';
  selectedIcon = this.data.category?.icon || 'category';
  selectedColor = this.data.category?.color || '#3b82f6'; // colors:allow(category-data) a new category's colour until one is picked

  get isEdit(): boolean {
    return !!this.data.category;
  }

  get isValid(): boolean {
    return this.name.trim().length > 0;
  }

  selectIcon(icon: string): void {
    this.selectedIcon = icon;
  }

  selectColor(color: string): void {
    this.selectedColor = color;
  }

  save(): void {
    if (this.isValid) {
      this.dialogRef.close({
        name: this.name.trim(),
        icon: this.selectedIcon,
        color: this.selectedColor,
      });
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
