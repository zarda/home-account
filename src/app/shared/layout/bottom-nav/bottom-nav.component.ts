import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { FitTextDirective } from '../../directives/fit-text.directive';
import { NavItem as SharedNavItem, navItemFor } from '../nav-items';

interface NavItem extends SharedNavItem {
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

  // Five slots, centre action included — membership here is a surface
  // decision (a sixth item crowds the labels on a phone), but every real
  // destination's label and icon come from the shared list via navItemFor,
  // so this can never drift from what the sidebar shows for the same route.
  private navItemsConfig: NavItem[] = [
    navItemFor('/dashboard'),
    navItemFor('/transactions'),
    { labelKey: 'nav.add', icon: 'add', route: '', isAction: true },
    navItemFor('/budgets'),
    navItemFor('/reports'),
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
