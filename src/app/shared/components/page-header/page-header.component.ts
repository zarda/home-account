import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * One page-header anatomy for every feature page: translated title,
 * optional translated subtitle, and projection slots for the pieces
 * pages legitimately vary —
 *
 *   [header-leading]      leading affordance (e.g. a back button)
 *   [header-title-suffix] inline suffix after the title (e.g. a count)
 *   [header-subtitle]     custom subtitle content (e.g. "Welcome, X")
 *   [header-actions]      right-aligned controls (buttons, period pickers)
 *
 * Replaces the per-page copies that had drifted in hierarchy and spacing.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss',
})
export class PageHeaderComponent {
  titleKey = input.required<string>();
  subtitleKey = input<string | null>(null);
}
