import { TestBed } from '@angular/core/testing';
import { GlobalErrorHandler, ERROR_NOTIFY_THROTTLE_MS } from './global-error-handler';
import { NotificationService } from './notification.service';
import { TranslationService } from './translation.service';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let notifications: jasmine.SpyObj<NotificationService>;

  beforeEach(() => {
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((k: string) => k);

    TestBed.configureTestingModule({
      providers: [
        GlobalErrorHandler,
        { provide: NotificationService, useValue: notifications },
        { provide: TranslationService, useValue: translation },
      ],
    });
    handler = TestBed.inject(GlobalErrorHandler);

    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 6, 1, 12, 0, 0));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('logs the error and shows one generic notification', () => {
    spyOn(console, 'error');

    handler.handleError(new Error('boom'));

    expect(console.error).toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith('common.error');
  });

  it('unwraps zone-wrapped promise rejections for the log', () => {
    const logSpy = spyOn(console, 'error');
    const cause = new Error('the real cause');

    handler.handleError({ rejection: cause, message: 'Uncaught (in promise)' });

    expect(logSpy.calls.mostRecent().args).toContain(cause);
  });

  it('throttles the notification but never the log', () => {
    spyOn(console, 'error');

    handler.handleError(new Error('first'));
    handler.handleError(new Error('second'));
    handler.handleError(new Error('third'));

    // A broken subscription can reject on every emission; the user gets one
    // snackbar, the log gets every occurrence.
    expect(notifications.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(3);

    jasmine.clock().tick(ERROR_NOTIFY_THROTTLE_MS + 1);
    handler.handleError(new Error('later'));
    expect(notifications.error).toHaveBeenCalledTimes(2);
  });
});
