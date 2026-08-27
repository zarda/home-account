import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TranslationService } from '../../../core/services/translation.service';
import { NAV_ITEMS } from '../nav-items';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatListModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private translationService = inject(TranslationService);

  @Input() isExpanded = true;
  @Output() navItemClicked = new EventEmitter<void>();

  navItems = computed(() =>
    NAV_ITEMS.map(item => ({
      ...item,
      label: this.translationService.t(item.labelKey)
    }))
  );

  onNavClick(): void {
    this.navItemClicked.emit();
  }
}
