import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';

import { FeedbackDialogComponent } from './feedback-dialog.component';
import { FeedbackService } from '../../../core/services/feedback.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';

describe('FeedbackDialogComponent', () => {
  let component: FeedbackDialogComponent;
  let fixture: ComponentFixture<FeedbackDialogComponent>;
  let mockFeedback: jasmine.SpyObj<FeedbackService>;
  let mockNotification: jasmine.SpyObj<NotificationService>;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<FeedbackDialogComponent>>;

  beforeEach(async () => {
    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    mockFeedback = jasmine.createSpyObj<FeedbackService>('FeedbackService', ['add']);
    mockNotification = jasmine.createSpyObj<NotificationService>('NotificationService', [
      'success', 'error', 'info'
    ]);
    mockDialogRef = jasmine.createSpyObj<MatDialogRef<FeedbackDialogComponent>>('MatDialogRef', [
      'close'
    ]);

    await TestBed.configureTestingModule({
      imports: [FeedbackDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: FeedbackService, useValue: mockFeedback },
        { provide: NotificationService, useValue: mockNotification },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('never sends a whitespace-only message', async () => {
    component.message = '   ';

    await component.submit();

    expect(mockFeedback.add).not.toHaveBeenCalled();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('sends the chosen category and message, confirms, and closes', async () => {
    mockFeedback.add.and.resolveTo('entry-1');
    component.category = 'idea';
    component.message = 'a widget would be nice';

    await component.submit();

    expect(mockFeedback.add).toHaveBeenCalledWith('idea', 'a widget would be nice');
    expect(mockNotification.success).toHaveBeenCalledWith('about.feedback.sent');
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  // The message is the one thing that must not be lost: a failed send
  // reports and keeps the dialog open with the text intact.
  it('stays open with the message intact when sending fails', async () => {
    mockFeedback.add.and.rejectWith(new Error('offline'));
    component.message = 'still here';

    await component.submit();

    expect(mockNotification.error).toHaveBeenCalledWith('about.feedback.sendFailed');
    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(component.message).toBe('still here');
    expect(component.isSubmitting()).toBeFalse();
  });

  it('ignores a second submit while the first is in flight', async () => {
    let release!: (id: string) => void;
    mockFeedback.add.and.returnValue(new Promise<string>(resolve => (release = resolve)));
    component.message = 'once only';

    const first = component.submit();
    const second = component.submit();
    release('entry-1');
    await Promise.all([first, second]);

    expect(mockFeedback.add).toHaveBeenCalledTimes(1);
  });

  it('closes without a result when cancelled', () => {
    component.cancel();

    expect(mockDialogRef.close).toHaveBeenCalledWith(false);
    expect(mockFeedback.add).not.toHaveBeenCalled();
  });
});
