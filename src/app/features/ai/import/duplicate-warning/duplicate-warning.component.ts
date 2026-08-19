import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { CategorizedImportTransaction, DuplicateCheck } from '../../../../models';
import { LocaleDatePipe } from '../../../../shared/pipes/locale-date.pipe';
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
    LocaleDatePipe,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      case 'within_batch':
        return 'content_copy';
      default:
        return 'info';
    }
  }

  /**
   * Translation key for a match type.
   *
   * Returning a key rather than a string is what lets `check-i18n.mjs` see
   * these at all — it matches keys next to the translate pipe, so the English
   * literals this used to return were invisible to every i18n check the repo
   * has, and stayed untranslated in ja and tc without anything noticing.
   */
  getMatchLabelKey(matchType: DuplicateCheck['matchType']): string {
    switch (matchType) {
      case 'exact':
        return 'import.matchExact';
      case 'likely':
        return 'import.matchLikely';
      case 'possible':
        return 'import.matchPossible';
      case 'within_batch':
        return 'import.matchWithinBatch';
      default:
        return 'import.matchUnknown';
    }
  }

  onExcludeAll(): void {
    this.excludeAll.emit();
  }

  onIncludeAll(): void {
    this.includeAll.emit();
  }
}
