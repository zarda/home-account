import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { InsightChip, InsightChipsService } from '../../../core/services/insight-chips.service';
import { TransactionFilters } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Row of tappable quick-filter chips computed from the current month's
 * spending (unusual amounts, newly active categories, top category).
 * Renders nothing when the analysis finds nothing notable.
 */
@Component({
  selector: 'app-insight-chips',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  providers: [InsightChipsService],
  templateUrl: './insight-chips.component.html',
  styleUrl: './insight-chips.component.scss',
})
export class InsightChipsComponent implements OnInit {
  private chipsService = inject(InsightChipsService);

  @Output() chipSelected = new EventEmitter<TransactionFilters>();

  chips = this.chipsService.chips;

  ngOnInit(): void {
    this.chipsService.load();
  }

  onChipClick(chip: InsightChip): void {
    // Fresh object so re-applying the same chip still triggers ngOnChanges
    // downstream.
    this.chipSelected.emit({ ...chip.filters });
  }
}
