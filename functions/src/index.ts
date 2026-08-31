import { setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/firestore';
import { onObjectDeleted, onObjectFinalized } from 'firebase-functions/storage';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getRemoteConfig } from 'firebase-admin/remote-config';
import { getStorage } from 'firebase-admin/storage';

import { composeFeedbackEmail } from './compose-feedback-email';
import { sendMail } from './mailer';
import {
  FALLBACK_FREE_LIMIT,
  FALLBACK_PREMIUM_LIMIT,
  TierLimits,
  limitForTier,
  limitsFromTemplate,
  receiptOwnerOf,
  receiptPrefixFor,
} from './receipt-quota';

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

/**
 * The receipt bucket. Named explicitly rather than left to the default-bucket
 * lookup so the region below can be justified against something visible.
 */
const RECEIPT_BUCKET = 'home-accounter.firebasestorage.app';

/**
 * The bucket's own location — NOT the asia-east1 of the global options above.
 * Eventarc requires a storage trigger to run in its bucket's region, so the
 * two triggers below must override the global region; left on asia-east1 they
 * do not merely run far away, they fail to deploy. Do not "tidy" either of
 * these constants back into the global setting.
 */
const RECEIPT_BUCKET_REGION = 'us-west1';

/**
 * How long a resolved set of limits is reused before the template is read
 * again. Short enough that publishing a template takes effect on its own, long
 * enough that a burst of object events costs one Remote Config round trip
 * rather than one per event.
 */
const LIMITS_TTL_MS = 5 * 60 * 1000;

let cachedLimits: { limits: TierLimits; expiresAt: number } | null = null;

/**
 * The limits in force, cached per instance.
 *
 * getTemplate() is a cross-region RPC, and with no template published for this
 * project it is one that always fails — so uncached it would add a failed call
 * and a warning to every upload and every delete, on the path the triggers
 * below deliberately serialize. The fallbacks are cached alongside a success
 * for that reason: caching only the happy path would leave the failing call
 * running on every event, which is the cost this exists to remove.
 */
async function resolveTierLimits(): Promise<TierLimits> {
  const now = Date.now();
  if (cachedLimits && cachedLimits.expiresAt > now) return cachedLimits.limits;

  let limits: TierLimits = { free: FALLBACK_FREE_LIMIT, premium: FALLBACK_PREMIUM_LIMIT };
  try {
    limits = limitsFromTemplate((await getRemoteConfig().getTemplate()).parameters);
  } catch (error) {
    // No template is published for this project today; the parameters live
    // only in the console. Falling back keeps the quota enforced.
    logger.warn('remote config template unavailable, using fallback limits', error);
  }

  cachedLimits = { limits, expiresAt: now + LIMITS_TTL_MS };
  return limits;
}

/**
 * Rewrite the authoritative receipt-image count for one user.
 *
 * The count comes from listing the bucket prefix rather than from
 * incrementing a stored figure. That is self-healing — a missed or duplicated
 * event corrects itself on the next one — and it counts the objects that
 * actually exist, which closes the hole the client's Firestore-based count
 * left open: an object no transaction references was invisible to it and
 * still occupied the user's storage.
 *
 * Failures log and never rethrow, for the same reason onFeedbackCreated's do:
 * a retry storm against a broken dependency would rewrite nothing the next
 * object event will not rewrite anyway, and the quota's failure mode without
 * a fresh count is the one that already shipped.
 */
async function recountReceiptQuota(objectName: string | undefined): Promise<void> {
  if (!objectName) return;

  // Mandatory, not defensive: a v2 storage trigger has no server-side path
  // filter, so every object event in the bucket lands here.
  const userId = receiptOwnerOf(objectName);
  if (!userId) return;

  try {
    const firestore = getFirestore();

    const [files] = await getStorage()
      .bucket(RECEIPT_BUCKET)
      .getFiles({ prefix: receiptPrefixFor(userId) });

    // Entitlements are never read from Remote Config — only the tunable
    // numbers are. The tier itself lives on the user's document.
    const user = await firestore.doc(`users/${userId}`).get();
    const quota = firestore.doc(`users/${userId}/quota/receiptImages`);

    // Account deletion sweeps every receipt object and only then deletes the
    // user document, so these deletes keep arriving after the account is gone.
    // Writing here would recreate users/{uid} as a ghost holding a quota
    // subcollection, and the deletion cascade has no step that would ever
    // sweep it: the recount must erase its own document instead.
    if (!user.exists) {
      await quota.delete();
      return;
    }

    const tier: unknown = user.get('subscription.tier');
    const limits = await resolveTierLimits();

    // A full set, not a merge: the document states the result of one recount,
    // so a stale field can never survive alongside a fresh count. storage.rules
    // reads both fields off this document and denies when either is missing,
    // so a partial write here would lock the account out of uploading rather
    // than leave a stale figure behind.
    await quota.set({
      count: files.length,
      limit: limitForTier(tier, limits),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    // The error goes positionally: the logger only reads a stack off an
    // argument that is an Error, and an Error nested in the structured payload
    // serializes to {} because message and stack are non-enumerable. The
    // trailing plain object is what reaches jsonPayload.
    logger.error('receipt quota recount failed', error, { userId, objectName });
  }
}

/**
 * concurrency: 1 is load-bearing, not a cost control. The inherited
 * maxInstances: 1 caps how many instances run; on its own it leaves each
 * instance serving the Cloud Run default of 80 requests at once, so two
 * uploads would interleave their list-then-write inside one instance and the
 * older count could land last. Only concurrency: 1 makes an instance handle
 * one event at a time; the two options together give a single serialized
 * worker. Do not drop either.
 */
export const onReceiptImageFinalized = onObjectFinalized(
  { bucket: RECEIPT_BUCKET, region: RECEIPT_BUCKET_REGION, concurrency: 1 },
  event => recountReceiptQuota(event.data.name)
);

export const onReceiptImageDeleted = onObjectDeleted(
  { bucket: RECEIPT_BUCKET, region: RECEIPT_BUCKET_REGION, concurrency: 1 },
  event => recountReceiptQuota(event.data.name)
);
