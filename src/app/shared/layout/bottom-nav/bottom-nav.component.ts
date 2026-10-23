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
  // so the icon and labelKey can never drift from the sidebar's; the one
  // allowed difference is a shortLabelKey (nav-items.ts).
  private navItemsConfig: NavItem[] = [
    navItemFor('/dashboard'),
    navItemFor('/transactions'),
    { labelKey: 'nav.add', icon: 'add', route: '', isAction: true },
    navItemFor('/budgets'),
    navItemFor('/reports'),
  ];

  // The bar's room is the one place an item may read a shorter name than its
  // `labelKey` (nav-items.ts): the same label feeds the visible text and the
  // link's aria-label, so the two cannot disagree.
  navItems = computed(() =>
    this.navItemsConfig.map((item) => ({
      ...item,
      label: this.translationService.t(item.shortLabelKey ?? item.labelKey),
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
