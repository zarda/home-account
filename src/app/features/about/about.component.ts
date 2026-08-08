import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { environment } from '../../../environments/environment';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    PageHeaderComponent,
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  currentYear = new Date().getFullYear();
  appVersion = packageJson.version;
  // Derived from the dependency range so the "Built With" list can't go stale
  angularMajorVersion = parseInt(
    packageJson.dependencies['@angular/core'].replace(/^[^\d]*/, ''),
    10
  );
  donationUrl = (environment as { donationUrlPaypal?: string }).donationUrlPaypal || '';

  // Hide donate link on native apps (iOS/Android) - only show on web
  showDonateSection = computed(() => !Capacitor.isNativePlatform());

  openDonateLink(): void {
    if (!this.donationUrl) {
      // No donation link configured; simply return.
      return;
    }

    window.open(this.donationUrl, '_blank');
  }
}
