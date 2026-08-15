/**
 * What the mail says, kept apart from how it is sent: this module has no
 * imports and no I/O, so the one part of the pipeline that renders user
 * input is the part a unit test can pin exactly. The transport (./mailer)
 * and the wiring (./index) stay thin around it.
 *
 * Inputs are typed unknown on purpose: an entry written before the rules
 * deploy turned validation on can be shaped arbitrarily, and the mail must
 * render something useful rather than throw.
 */

/** The stored cap is 2000; anything past this was written around the rules. */
const MAX_RENDERED_MESSAGE_LENGTH = 4000;

export interface FeedbackMailInput {
  feedbackId: string;
  userId: string;
  /** Resolved server-side from Auth at mail time; absent for deleted users. */
  userEmail?: string;
  category?: unknown;
  message?: unknown;
  appVersion?: unknown;
  platform?: unknown;
  locale?: unknown;
  /** Already formatted (ISO) by the caller. */
  createdAt?: string;
}

export interface ComposedMail {
  subject: string;
  text: string;
}

function shown(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

/** Subject lines must stay single-line and short; the body has the real thing. */
function subjectSafe(value: unknown): string {
  return shown(value).replace(/[\r\n]+/g, ' ').slice(0, 60);
}

export function composeFeedbackEmail(input: FeedbackMailInput): ComposedMail {
  const message = shown(input.message);
  const rendered =
    message.length > MAX_RENDERED_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_RENDERED_MESSAGE_LENGTH)}\n[truncated: ${message.length} characters stored]`
      : message;

  // The id makes an at-least-once duplicate recognisable in the inbox.
  const subject = `[home-account] feedback: ${subjectSafe(input.category)} (${input.feedbackId})`;

  const text = [
    `Category: ${shown(input.category)}`,
    '',
    rendered,
    '',
    '---',
    `App version: ${shown(input.appVersion)}`,
    `Platform: ${shown(input.platform)}`,
    `Locale: ${shown(input.locale)}`,
    `User id: ${input.userId}`,
    `Account email: ${input.userEmail ?? 'unknown'}`,
    `Created at: ${input.createdAt ?? 'unknown'}`,
  ].join('\n');

  return { subject, text };
}
