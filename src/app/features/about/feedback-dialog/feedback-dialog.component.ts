import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';

import { FeedbackService, MAX_FEEDBACK_MESSAGE_LENGTH } from '../../../core/services/feedback.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { FeedbackCategory } from '../../../models';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** Shared with the About page's sent list, so both name a category the same way. */
export const FEEDBACK_CATEGORY_LABEL_KEYS: Record<FeedbackCategory, string> = {
  bug: 'about.feedback.categoryBug',
  idea: 'about.feedback.categoryIdea',
  other: 'about.feedback.categoryOther',
};

/**
 * Category + message, nothing else: the app version, platform and locale
 * ride along automatically (FeedbackService), and the dialog says so
 * instead of asking. A failed send keeps the dialog open with the text
 * intact — the message is the one thing that must not be lost.
 */
@Component({
  selector: 'app-feedback-dialog',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './feedback-dialog.component.html',
  styleUrl: './feedback-dialog.component.scss',
})
export class FeedbackDialogComponent {
  private dialogRef = inject(MatDialogRef<FeedbackDialogComponent>);
  private feedbackService = inject(FeedbackService);
  private notification = inject(NotificationService);
  private translationService = inject(TranslationService);

  readonly maxLength = MAX_FEEDBACK_MESSAGE_LENGTH;
  readonly categories: FeedbackCategory[] = ['bug', 'idea', 'other'];

  category: FeedbackCategory = 'bug';
  message = '';
  isSubmitting = signal(false);

  categoryLabelKey(category: FeedbackCategory): string {
    return FEEDBACK_CATEGORY_LABEL_KEYS[category];
  }

  async submit(): Promise<void> {
    if (!this.message.trim() || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    try {
      await this.feedbackService.add(this.category, this.message);
      this.notification.success(this.translationService.t('about.feedback.sent'));
      this.dialogRef.close(true);
    } catch {
      this.notification.error(this.translationService.t('about.feedback.sendFailed'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
