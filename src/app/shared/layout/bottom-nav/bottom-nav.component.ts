import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { FitTextDirective } from '../../directives/fit-text.directive';

interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
  isAction?: boolean;
}

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatMenuModule,
    FitTextDirective,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  private quickAdd = inject(QuickAddService);
  private translationService = inject(TranslationService);

  private navItemsConfig: NavItem[] = [
    { labelKey: 'nav.dashboard', icon: 'dashboard', route: '/dashboard' },
    { labelKey: 'nav.transactions', icon: 'receipt_long', route: '/transactions' },
    { labelKey: 'nav.add', icon: 'add', route: '', isAction: true },
    { labelKey: 'nav.budgets', icon: 'savings', route: '/budgets' },
    { labelKey: 'nav.reports', icon: 'bar_chart', route: '/reports' },
  ];

  navItems = computed(() =>
    this.navItemsConfig.map((item) => ({
      ...item,
      label: this.translationService.t(item.labelKey),
    }))
  );

  openAddTransaction(): void {
    this.quickAdd.openAddTransaction();
  }

  openScanReceipt(): void {
    this.quickAdd.openScanReceipt();
  }

  openImportPhotos(): void {
    this.quickAdd.openImportPhotos();
  }
}
