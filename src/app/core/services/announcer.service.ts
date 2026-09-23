import { Injectable, NgZone, inject } from '@angular/core';
import { AriaLivePoliteness, LiveAnnouncer } from '@angular/cdk/a11y';

/**
 * How long a placed announcement keeps the live region before the next one
 * goes out. The CDK announcer writes a message and resolves its promise in
 * the same timer task, and its next `announce()` begins by clearing the
 * region, so the next message must not replace this one before a rendering
 * update has exposed it to the accessibility tree. A timer rather than an
 * animation frame, which never fires in a hidden tab and would hold every
 * later message behind it.
 */
export const ANNOUNCEMENT_GAP_MS = 150;

/**
 * `'queue'` for a message that reports an event, `'replace'` for one that
 * reports current state; see `AnnouncerService`.
 */
export type AnnouncementMode = 'queue' | 'replace';

/**
 * Wrapper around the CDK LiveAnnouncer so user feedback (snackbars, list
 * updates, empty states) is announced to assistive technology.
 *
 * Announcements are placed in the live region one after another rather than
 * handed straight through. The CDK announcer places a message in its live region only after
 * a short delay, and a second call inside that delay clears the first before
 * it is ever placed — so a removal on the review card followed by the re-check
 * that answers it, or an import's notice raised right after another, would
 * leave only the last one heard. Each announcement therefore waits until the
 * one before it has been placed and has stood for `ANNOUNCEMENT_GAP_MS`; one
 * with nothing ahead of it goes out at once.
 *
 * A message that reports current state — a count, a position — is passed
 * with `'replace'`, and one that reports an event — a removal, a notice, an
 * alert — queues. A later state makes an earlier one stale, so a `'replace'`
 * message drops every waiting message that was itself queued with
 * `'replace'` and takes its place at the back of the queue. An event is
 * never stale, so a message queued with `'queue'` is never dropped. While a
 * palette search is being typed, a count therefore goes out at most once a
 * turn — the CDK's delay and then the gap — each the latest at that moment,
 * and the last count typed is the last count placed.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncerService {
  private liveAnnouncer = inject(LiveAnnouncer);
  private zone = inject(NgZone);
  /** Messages waiting for the one in progress to finish its turn, oldest first. */
  private waiting: { message: string; politeness: AriaLivePoliteness; mode: AnnouncementMode }[] = [];
  /** True from the moment a message goes to the CDK until its gap has elapsed. */
  private speaking = false;

  announce(
    message: string,
    politeness: AriaLivePoliteness = 'polite',
    mode: AnnouncementMode = 'queue'
  ): void {
    if (!message) return;
    if (mode === 'replace') this.waiting = this.waiting.filter(waiting => waiting.mode !== 'replace');
    this.waiting.push({ message, politeness, mode });
    if (!this.speaking) this.speakNext();
  }

  private speakNext(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.speaking = false;
      return;
    }
    this.speaking = true;
    // The executor runs at once, so the CDK is called in this same turn, and
    // a throw inside it becomes a rejection like any other failed announcement.
    new Promise<void>(resolve => resolve(this.liveAnnouncer.announce(next.message, next.politeness)))
      // A failed announcement must not hold every later one behind it.
      .catch(() => undefined)
      .then(() => {
        // Outside Angular, as the CDK runs its own timer: the gap changes
        // nothing a view renders, and a zone task would keep the app from
        // reporting itself stable while it runs.
        this.zone.runOutsideAngular(() => setTimeout(() => this.speakNext(), ANNOUNCEMENT_GAP_MS));
      });
  }
}
