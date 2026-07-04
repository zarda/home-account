import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NotificationService } from './notification.service';
import { AnnouncerService } from './announcer.service';
import { TranslationService } from './translation.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let snackBar: jasmine.SpyObj<MatSnackBar>;
  let announcer: jasmine.SpyObj<AnnouncerService>;

  beforeEach(() => {
    snackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AnnouncerService, useValue: announcer },
        { provide: TranslationService, useValue: translation },
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  it('opens a success snackbar with the Close action and announces politely', () => {
    service.success('Saved');

    expect(snackBar.open).toHaveBeenCalledWith('Saved', 't:common.close', {
      duration: 3000,
      panelClass: 'snackbar-success',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Saved', 'polite');
  });

  it('gives errors a longer duration and an assertive announcement', () => {
    service.error('Failed');

    expect(snackBar.open).toHaveBeenCalledWith('Failed', 't:common.close', {
      duration: 5000,
      panelClass: 'snackbar-error',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Failed', 'assertive');
  });

  it('treats info like success but with its own panel class', () => {
    service.info('Heads up');

    expect(snackBar.open).toHaveBeenCalledWith('Heads up', 't:common.close', {
      duration: 3000,
      panelClass: 'snackbar-info',
    });
    expect(announcer.announce).toHaveBeenCalledWith('Heads up', 'polite');
  });

  it('does nothing for an empty message', () => {
    service.success('');
    expect(snackBar.open).not.toHaveBeenCalled();
    expect(announcer.announce).not.toHaveBeenCalled();
  });
});
