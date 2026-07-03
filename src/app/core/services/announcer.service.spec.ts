import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { AnnouncerService } from './announcer.service';

describe('AnnouncerService', () => {
  let service: AnnouncerService;
  let mockLiveAnnouncer: jasmine.SpyObj<LiveAnnouncer>;

  beforeEach(() => {
    mockLiveAnnouncer = jasmine.createSpyObj('LiveAnnouncer', ['announce']);
    mockLiveAnnouncer.announce.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        AnnouncerService,
        { provide: LiveAnnouncer, useValue: mockLiveAnnouncer }
      ]
    });

    service = TestBed.inject(AnnouncerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('announces with polite politeness by default', () => {
    service.announce('Saved');
    expect(mockLiveAnnouncer.announce).toHaveBeenCalledWith('Saved', 'polite');
  });

  it('passes assertive politeness through', () => {
    service.announce('Failed', 'assertive');
    expect(mockLiveAnnouncer.announce).toHaveBeenCalledWith('Failed', 'assertive');
  });

  it('ignores empty messages', () => {
    service.announce('');
    expect(mockLiveAnnouncer.announce).not.toHaveBeenCalled();
  });
});
