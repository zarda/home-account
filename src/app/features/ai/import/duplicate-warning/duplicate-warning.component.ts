import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { CategorizedImportTransaction, DuplicateCheck } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

export interface DuplicateInfo {
  transaction: CategorizedImportTransaction;
  check: DuplicateCheck;
}

@Component({
  selector: 'app-duplicate-warning',
  standalone: true,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    TranslatePipe
  ],
  templateUrl: './duplicate-warning.component.html',
  styleUrl: './duplicate-warning.component.scss'
})
export class DuplicateWarningComponent {
  @Input() duplicates: DuplicateInfo[] = [];
  @Output() excludeAll = new EventEmitter<void>();
  @Output() includeAll = new EventEmitter<void>();

  getMatchIcon(matchType: DuplicateCheck['matchType']): string {
    switch (matchType) {
      case 'exact':
        return 'error';
      case 'likely':
        return 'warning';
      case 'possible':
        return 'help';
      default:
        return 'info';
    }
  }

  getMatchLabel(matchType: DuplicateCheck['matchType']): string {
    switch (matchType) {
      case 'exact':
        return 'Exact Match';
      case 'likely':
        return 'Likely Match';
      case 'possible':
        return 'Possible Match';
      default:
        return 'Unknown';
    }
  }

  onExcludeAll(): void {
    this.excludeAll.emit();
  }

  onIncludeAll(): void {
    this.includeAll.emit();
  }
}
