import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { Subscription } from 'rxjs';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';

import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/components/loading-spinner/loading-spinner.component';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { FeedbackCategory, FeedbackEntry } from '../../models';
import { environment } from '../../../environments/environment';
import packageJson from '../../../../package.json';
import {
  FEEDBACK_CATEGORY_LABEL_KEYS,
  FeedbackDialogComponent,
} from './feedback-dialog/feedback-dialog.component';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    PageHeaderComponent,
    LoadingSpinnerComponent,
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
export class AboutComponent implements OnInit, OnDestroy {
  private dialog = inject(MatDialog);
  private feedbackService = inject(FeedbackService);
  private authService = inject(AuthService);
  private dateFormat = inject(DateFormatService);

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

  // This page is the stored kind's door (see STORED_DATA_KINDS), so the
  // user's own sent feedback is listed here, live from the subscription.
  feedbackEntries = signal<FeedbackEntry[]>([]);
  feedbackLoading = signal<boolean>(true);
  feedbackError = signal<boolean>(false);

  private feedbackSubscription?: Subscription;

  ngOnInit(): void {
    this.feedbackSubscription = this.feedbackService
      .watchOwn(this.authService.userId())
      .subscribe({
        next: entries => {
          this.feedbackEntries.set(entries);
          this.feedbackLoading.set(false);
        },
        error: () => {
          this.feedbackError.set(true);
          this.feedbackLoading.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.feedbackSubscription?.unsubscribe();
  }

  openFeedbackDialog(): void {
    this.dialog.open(FeedbackDialogComponent);
  }

  feedbackCategoryKey(category: FeedbackCategory): string {
    return FEEDBACK_CATEGORY_LABEL_KEYS[category];
  }

  /** Empty while the local write is still queued and createdAt unstamped. */
  feedbackSentOn(entry: FeedbackEntry): string {
    return entry.createdAt ? this.dateFormat.formatDate(entry.createdAt) : '';
  }

  openDonateLink(): void {
    if (!this.donationUrl) {
      // No donation link configured; simply return.
      return;
    }

    window.open(this.donationUrl, '_blank');
  }
}
