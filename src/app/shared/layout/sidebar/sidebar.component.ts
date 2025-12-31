import { Component, EventEmitter, Input, Output } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

interface NavItem {
  label: string;
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
  @Input() isExpanded = true;
  @Output() navItemClicked = new EventEmitter<void>();

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
    { label: 'Transactions', icon: 'receipt_long', route: '/transactions' },
    { label: 'Budgets', icon: 'savings', route: '/budgets' },
    { label: 'Reports', icon: 'bar_chart', route: '/reports' },
    { label: 'Settings', icon: 'settings', route: '/settings' },
  ];

  onNavClick(): void {
    this.navItemClicked.emit();
  }
}
