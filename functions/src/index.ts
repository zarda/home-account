import { setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { composeFeedbackEmail } from './compose-feedback-email';
import { sendMail } from './mailer';

// Firestore lives in asia-east1 (firebase.json), so the trigger runs beside
// it. maxInstances bounds cost: feedback volume is human-scale by definition.
setGlobalOptions({ region: 'asia-east1', maxInstances: 1 });

initializeApp();

const smtpHost = defineSecret('FEEDBACK_SMTP_HOST');
const smtpPort = defineSecret('FEEDBACK_SMTP_PORT');
const smtpUser = defineSecret('FEEDBACK_SMTP_USER');
const smtpPass = defineSecret('FEEDBACK_SMTP_PASS');
const emailTo = defineSecret('FEEDBACK_EMAIL_TO');

/**
 * Mails each stored feedback entry to the operator.
 *
 * The app's contract ends at the Firestore write: nothing client-side calls,
 * waits on, or observes this function, so a mail failure loses nothing — the
 * entry stays readable in the console. That is also why failures log and
 * never rethrow: a rethrow would only hammer a broken SMTP config with
 * retries while the record it exists to deliver is already safe.
 */
export const onFeedbackCreated = onDocumentCreated(
  {
    document: 'users/{userId}/feedback/{feedbackId}',
    secrets: [smtpHost, smtpPort, smtpUser, smtpPass, emailTo],
  },
  async event => {
    const data = event.data?.data();
    if (!data) return;

    // Best-effort: the reply address is a nicety, not a precondition.
    let userEmail: string | undefined;
    try {
      userEmail = (await getAuth().getUser(event.params.userId)).email ?? undefined;
    } catch (error) {
      logger.warn('could not resolve the account email', error);
    }

    const createdAt: unknown = data['createdAt'];
    const mail = composeFeedbackEmail({
      feedbackId: event.params.feedbackId,
      userId: event.params.userId,
      userEmail,
      category: data['category'],
      message: data['message'],
      appVersion: data['appVersion'],
      platform: data['platform'],
      locale: data['locale'],
      createdAt:
        createdAt instanceof Object && 'toDate' in createdAt
          ? (createdAt as { toDate(): Date }).toDate().toISOString()
          : undefined,
    });

    try {
      await sendMail(
        {
          host: smtpHost.value(),
          port: Number(smtpPort.value()),
          user: smtpUser.value(),
          pass: smtpPass.value(),
        },
        {
          to: emailTo.value(),
          from: smtpUser.value(),
          subject: mail.subject,
          text: mail.text,
        }
      );
    } catch (error) {
      logger.error('feedback mail failed', error);
    }
  }
);
