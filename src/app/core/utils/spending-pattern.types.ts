/**
 * Shared vocabulary for the spending-pattern detectors.
 *
 * The window is passed in rather than derived from the clock inside a detector.
 * That is the whole determinism contract in one sentence: an insight snapshot
 * has to be reproducible from the same transactions months later, so no detector
 * may read `Date.now()` or construct an argument-less `Date`.
 */

/** Inclusive window a detector runs over. Never derived from the current time. */
export interface DetectorWindow {
  start: Date;
  end: Date;
}
