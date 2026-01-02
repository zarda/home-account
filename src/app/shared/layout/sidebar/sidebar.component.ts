import { Component, EventEmitter, Input, Output, inject, computed } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TranslationService } from '../../../core/services/translation.service';

interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatListModule, MatIconModule, MatTooltipModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private translationService = inject(TranslationService);

  @Input() isExpanded = true;
  @Output() navItemClicked = new EventEmitter<void>();

  private navItemsConfig: NavItem[] = [
    { labelKey: 'nav.dashboard', icon: 'dashboard', route: '/dashboard' },
    { labelKey: 'nav.transactions', icon: 'receipt_long', route: '/transactions' },
    { labelKey: 'nav.budget', icon: 'savings', route: '/budgets' },
    { labelKey: 'nav.reports', icon: 'bar_chart', route: '/reports' },
    { labelKey: 'nav.settings', icon: 'settings', route: '/settings' },
  ];

  navItems = computed(() =>
    this.navItemsConfig.map(item => ({
      ...item,
      label: this.translationService.t(item.labelKey)
    }))
  );

  onNavClick(): void {
    this.navItemClicked.emit();
  }
}
