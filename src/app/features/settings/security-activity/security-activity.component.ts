import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

import { MatIconModule } from '@angular/material/icon';

import { SecurityLogService } from '../../../core/services/security-log.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SecurityEvent } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

const PLATFORM_LABEL_KEYS: Record<string, string> = {
  ios: 'settings.platformIos',
  android: 'settings.platformAndroid',
  web: 'settings.platformWeb',
};

@Component({
  selector: 'app-security-activity',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    LoadingSpinnerComponent,
    EmptyStateComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './security-activity.component.html',
  styleUrl: './security-activity.component.scss',
})
export class SecurityActivityComponent implements OnInit, OnDestroy {
  private securityLog = inject(SecurityLogService);
  private authService = inject(AuthService);
  private dateFormat = inject(DateFormatService);
  private translation = inject(TranslationService);

  events = signal<SecurityEvent[]>([]);
  isLoading = signal<boolean>(true);
  hasError = signal<boolean>(false);

  private subscription?: Subscription;

  ngOnInit(): void {
    this.subscription = this.securityLog.watchRecent(this.authService.userId()).subscribe({
      next: events => {
        this.events.set(events);
        this.isLoading.set(false);
      },
      error: () => {
        this.hasError.set(true);
        this.isLoading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** Relative day plus clock time, joined through a translated pattern. */
  formatWhen(event: SecurityEvent): string {
    const date = this.dateFormat.formatRelativeDate(event.occurredAt);
    const time = event.occurredAt
      .toDate()
      .toLocaleTimeString(this.translation.getIntlLocale(), {
        hour: '2-digit',
        minute: '2-digit',
      });
    return this.translation.t('settings.activityAt', { date, time });
  }

  /** Exact timestamp, for the row tooltip. */
  absoluteWhen(event: SecurityEvent): string {
    return this.dateFormat.formatDate(event.occurredAt);
  }

  platformLabelKey(platform: string): string {
    return PLATFORM_LABEL_KEYS[platform] ?? 'settings.platformUnknown';
  }
}
