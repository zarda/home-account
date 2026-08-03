import { Component, computed, inject } from '@angular/core';

import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';
import { CameraCaptureComponent } from '../../../features/transactions/camera-capture/camera-capture.component';
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
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  private dialog = inject(MatDialog);
  private router = inject(Router);
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
    // Open dialog directly - works from any page
    this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });
  }

  openScanReceipt(): void {
    // Same dialog config as the transactions page camera entry
    this.dialog.open(CameraCaptureComponent, {
      width: '500px',
      maxWidth: '95vw',
    });
  }

  openImportPhotos(): void {
    this.router.navigate(['/import/file']);
  }
}
