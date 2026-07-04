import { Component, computed, input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe } from '@angular/common';

export type StatTone = 'neutral' | 'income' | 'expense' | 'positive' | 'negative';

/**
 * One stat-card anatomy (icon tile, label, value, optional delta chip and
 * detail line) replacing the three divergent per-page implementations.
 * Values arrive pre-formatted — currency/locale formatting stays with the
 * callers, this component owns layout and semantic color only.
 */
@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [MatIconModule, DecimalPipe],
  templateUrl: './stat-card.component.html',
  styleUrl: './stat-card.component.scss',
})
export class StatCardComponent {
  /** Pre-translated label text. */
  label = input.required<string>();
  /** Muted inline suffix after the label (e.g. the base currency code). */
  labelSuffix = input('');
  /** Pre-formatted value string. */
  value = input.required<string>();
  /** Material icon for the leading tile; omit to hide the tile. */
  icon = input('');
  /** Semantic tint for icon tile + value. */
  tone = input<StatTone>('neutral');
  /** Percent change vs the previous period; null hides the chip. */
  delta = input<number | null>(null);
  /** Small caption under the delta chip (e.g. "vs previous period"). */
  deltaCaption = input('');
  /**
   * Inverts delta chip colors for metrics where an increase is bad
   * (expenses): up renders as negative, down as positive.
   */
  invertDelta = input(false);
  /** Optional small third line under the value. */
  detail = input('');
  detailTone = input<'neutral' | 'positive' | 'negative'>('neutral');

  deltaIsPositive = computed(() => {
    const delta = this.delta();
    if (delta === null) return false;
    const risingIsGood = !this.invertDelta();
    return delta >= 0 ? risingIsGood : !risingIsGood;
  });
}
