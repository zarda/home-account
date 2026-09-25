import { TestBed, fakeAsync, flush, flushMicrotasks, tick } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ANNOUNCEMENT_GAP_MS, AnnouncerService } from './announcer.service';

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

  /**
   * The CDK announcer clears a message still waiting out its own delay when
   * the next one arrives, and it writes a message and resolves its promise in
   * the same timer task — so a next message sent on that promise alone would
   * clear the first before any rendering update exposed it. Each one here is
   * held until the one before it has been placed and has stood for the gap.
   */
  describe('back-to-back announcements', () => {
    let pending: (() => void)[];

    beforeEach(() => {
      pending = [];
      mockLiveAnnouncer.announce.and.callFake(
        () => new Promise<void>(resolve => pending.push(resolve))
      );
    });

    it('announces a lone message at once', () => {
      service.announce('Coffee removed');

      expect(mockLiveAnnouncer.announce).toHaveBeenCalledOnceWith('Coffee removed', 'polite');
    });

    it('announces the second only after the first has been placed and the gap has elapsed, in order', fakeAsync(() => {
      service.announce('Coffee removed');
      service.announce('Checked again: no duplicates', 'assertive');
      flushMicrotasks();

      expect(mockLiveAnnouncer.announce.calls.allArgs())
        .withContext('the second waits for the first')
        .toEqual([['Coffee removed', 'polite']]);

      pending[0]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS - 1);

      expect(mockLiveAnnouncer.announce.calls.allArgs())
        .withContext('placed, but the gap has not elapsed')
        .toEqual([['Coffee removed', 'polite']]);

      tick(1);

      expect(mockLiveAnnouncer.announce.calls.allArgs()).toEqual([
        ['Coffee removed', 'polite'],
        ['Checked again: no duplicates', 'assertive'],
      ]);

      pending[1]();
      flush();
    }));

    it('skips an empty message without holding up the one after it', fakeAsync(() => {
      service.announce('Coffee removed');
      service.announce('');
      service.announce('Lunch removed');

      pending[0]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);

      expect(mockLiveAnnouncer.announce.calls.allArgs()).toEqual([
        ['Coffee removed', 'polite'],
        ['Lunch removed', 'polite'],
      ]);

      pending[1]();
      flush();
    }));

    it('moves on when an announcement fails rather than holding every later one', fakeAsync(() => {
      mockLiveAnnouncer.announce.and.returnValues(Promise.reject(new Error('gone')), Promise.resolve());

      service.announce('Coffee removed');
      service.announce('Lunch removed');
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);

      expect(mockLiveAnnouncer.announce.calls.allArgs()).toEqual([
        ['Coffee removed', 'polite'],
        ['Lunch removed', 'polite'],
      ]);

      flush();
    }));

    it('announces at once again when nothing is waiting', fakeAsync(() => {
      service.announce('Coffee removed');
      pending[0]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);

      service.announce('Lunch removed');

      expect(mockLiveAnnouncer.announce).toHaveBeenCalledWith('Lunch removed', 'polite');

      pending[1]();
      flush();
    }));
  });

  /**
   * A count that changes on every keystroke would otherwise play out one
   * figure after another once the typing stops; only the latest is worth
   * hearing, and the one already in the live region still finishes its turn.
   * A later count makes an earlier one stale, but never a queued event.
   */
  describe('replace mode', () => {
    let pending: (() => void)[];

    beforeEach(() => {
      pending = [];
      mockLiveAnnouncer.announce.and.callFake(
        () => new Promise<void>(resolve => pending.push(resolve))
      );
    });

    it('keeps only the latest of rapid calls behind the one in progress', fakeAsync(() => {
      service.announce('5 results', 'polite', 'replace');
      service.announce('3 results', 'polite', 'replace');
      service.announce('1 result', 'polite', 'replace');

      pending[0]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);

      expect(mockLiveAnnouncer.announce.calls.allArgs()).toEqual([
        ['5 results', 'polite'],
        ['1 result', 'polite'],
      ]);

      pending[1]();
      flush();

      expect(mockLiveAnnouncer.announce).toHaveBeenCalledTimes(2);
    }));

    // A waiting alert or error reports something that happened, and no count
    // typed after it makes it stale.
    it('never drops a message that was queued, only an earlier count', fakeAsync(() => {
      service.announce('Coffee removed');
      service.announce('Import failed', 'assertive');
      service.announce('3 results', 'polite', 'replace');
      service.announce('1 result', 'polite', 'replace');

      pending[0]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);
      pending[1]();
      flushMicrotasks();
      tick(ANNOUNCEMENT_GAP_MS);

      expect(mockLiveAnnouncer.announce.calls.allArgs()).toEqual([
        ['Coffee removed', 'polite'],
        ['Import failed', 'assertive'],
        ['1 result', 'polite'],
      ]);

      pending[2]();
      flush();
    }));
  });
});

/**
 * The real CDK announcer, so the spec reads the live region a screen reader
 * reads rather than the calls made to it.
 */
describe('AnnouncerService through the CDK announcer', () => {
  let service: AnnouncerService;

  const liveRegionText = (): string | null =>
    document.querySelector('.cdk-live-announcer-element')?.textContent ?? null;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AnnouncerService] });
    service = TestBed.inject(AnnouncerService);
  });

  it('leaves the first message in the live region until the gap has elapsed', fakeAsync(() => {
    service.announce('Coffee removed');
    service.announce('Lunch removed');

    // The CDK writes the first message and resolves in this one timer task.
    tick(100);
    flushMicrotasks();

    expect(liveRegionText())
      .withContext('the second must not clear the first before a rendering update')
      .toBe('Coffee removed');

    tick(ANNOUNCEMENT_GAP_MS - 1);
    expect(liveRegionText()).toBe('Coffee removed');

    tick(1 + 100);
    expect(liveRegionText()).toBe('Lunch removed');

    flush();
  }));
});
