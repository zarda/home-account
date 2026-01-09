import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';

import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { environment } from '../../../environments/environment';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    TranslatePipe,
  ],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  currentYear = new Date().getFullYear();
  appVersion = packageJson.version;
  donationUrl = (environment as { donationUrlPaypal?: string }).donationUrlPaypal || '';

  openDonateLink(): void {
    if (!this.donationUrl) {
      // No donation link configured; simply return.
      return;
    }

    window.open(this.donationUrl, '_blank');
  }
}
