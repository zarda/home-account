/**
 * Classification of a provider or pipeline failure.
 *
 * A pure function rather than a service method: AIStrategyService needs it
 * to stamp an error class onto its diagnostics, and AIImportService already
 * depends on the strategy service — so this is the one place both can reach
 * without a cycle. The sentinel codes live here for the same reason.
 */

export interface AIErrorInfo {
  /** English, for logs and for the cases only a provider can describe. */
  message: string;
  /** Present when the app raised this itself and the screen can translate it. */
  messageKey?: string;
  type: 'rate_limit' | 'auth' | 'network' | 'quota' | 'server' | 'timeout' | 'unknown';
  retryable: boolean;
}

/**
 * Thrown when no AI provider is configured at all.
 *
 * A code rather than a sentence, so the screen can say it in the user's
 * language. parseAIError used to recognize these throws by substring-matching
 * English prose, which meant rewording one silently reclassified it as an
 * unknown failure.
 */
export const AI_NO_PROVIDER = 'AI_NO_PROVIDER';

/** Thrown when an image was queued instead of processed, having no connection. */
export const AI_QUEUED_OFFLINE = 'AI_QUEUED_OFFLINE';

/**
 * Thrown when no cloud provider can be reached for a request that needs one.
 *
 * A code rather than a sentence, following the receipt-to-note errors: the
 * message used to be English prose that AIImportService recognized by
 * substring and passed straight to the screen, so it could never be
 * translated, and rewording it would silently have reclassified the error.
 */
export const AI_CLOUD_UNAVAILABLE = 'AI_CLOUD_UNAVAILABLE';

/**
 * Parse raw AI API errors into user-friendly messages with error type classification.
 */
export function parseAIError(error: unknown): AIErrorInfo {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  // Rate limit (429)
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('resource_exhausted') || lower.includes('too many requests') || lower.includes('quota exceeded')) {
    return {
      message: 'AI rate limit reached. Please wait a moment and try again.',
      type: 'rate_limit',
      retryable: true
    };
  }

  // Authentication / invalid API key (401, 403)
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid api key') || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    return {
      message: 'AI API key is invalid or expired.',
      messageKey: 'import.errorInvalidKey',
      type: 'auth',
      retryable: false
    };
  }

  // Network / connection errors
  if (lower.includes('network') || lower.includes('failed to fetch') || lower.includes('net::') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('cors') || lower.includes('dns')) {
    return {
      message: 'Network error. Please check your internet connection and try again.',
      type: 'network',
      retryable: true
    };
  }

  // Quota / billing (402)
  if (lower.includes('402') || lower.includes('billing') || lower.includes('insufficient_quota') || lower.includes('payment required') || lower.includes('credit')) {
    return {
      message: 'AI service quota exceeded or billing issue. Please check your API account.',
      type: 'quota',
      retryable: false
    };
  }

  // Server errors (500, 502, 503)
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('internal server error') || lower.includes('service unavailable') || lower.includes('bad gateway') || lower.includes('overloaded')) {
    return {
      message: 'AI service is temporarily unavailable. Please try again shortly.',
      type: 'server',
      retryable: true
    };
  }

  // Timeout, including the cancellation our own timeout fires. Every SDK
  // surfaces that as an abort ('Request was aborted', 'Request aborted when
  // fetching …') rather than as anything time-shaped, so it used to reach
  // the user as 'AI processing failed: Request was aborted' — the one
  // wording that says nothing about the ninety seconds they just waited.
  const aborted = error instanceof Error && error.name === 'AbortError';
  if (aborted || lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort') || lower.includes('deadline_exceeded')) {
    return {
      message: 'AI processing timed out. Try with a clearer image or fewer files.',
      type: 'timeout',
      retryable: true
    };
  }

  // Our own throws carry a code, not prose, so they are matched exactly and
  // handed to the screen as a key rather than as English.
  if (raw === AI_NO_PROVIDER) {
    return {
      message: 'No AI provider is configured.',
      messageKey: 'import.errorNoProvider',
      type: 'auth',
      retryable: false
    };
  }
  if (raw === AI_CLOUD_UNAVAILABLE) {
    return {
      message: 'Cloud AI is not reachable.',
      messageKey: 'import.errorCloudUnavailable',
      type: 'network',
      retryable: true
    };
  }
  if (raw === AI_QUEUED_OFFLINE) {
    return {
      message: 'Image queued for processing when back online.',
      messageKey: 'import.errorQueuedOffline',
      type: 'network',
      retryable: false
    };
  }

  // Unknown
  return {
    message: `AI processing failed: ${raw}`,
    type: 'unknown',
    retryable: true
  };
}
