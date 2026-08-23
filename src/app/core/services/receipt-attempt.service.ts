import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AnalyticsService } from './analytics.service';
import { ImportHistoryService } from './import-history.service';
import { AuthService } from './auth.service';
import { ReceiptAttemptDiagnostics } from './ai-types';
import { AnalyticsEventParams } from '../config/analytics-events';
import { AI_NO_PROVIDER, ReceiptProcessingError, parseAIError } from '../utils/ai-error.utils';
import {
  ImportHistory,
  ImportProvenance,
  ReceiptDoor,
  ReceiptFailureClass,
} from '../../models';

/** The three failures the pipeline decides itself, with no error to classify. */
export type ReceiptFailureReason = 'no_provider' | 'nothing_extracted' | 'queue_write';

const REASON_MESSAGES: Record<ReceiptFailureReason, string> = {
  no_provider: 'No AI provider is configured.',
  nothing_extracted: 'No transaction could be read from the image.',
  queue_write: 'The image could not be saved for later processing.',
};

function isReason(value: unknown): value is ReceiptFailureReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REASON_MESSAGES, value);
}

type ReceiptImportPayload = AnalyticsEventParams<'receipt_import'>;

/**
 * One receipt attempt, from the moment a door decides to run it to the one
 * branch that settles it.
 *
 * `succeeded` and `queued` send the event; `failed` sends it and writes the
 * failed record. Only the first call does anything — the camera dialog has
 * five terminal branches, two of them inside helpers, and the guard is what
 * makes counting an attempt twice structurally impossible rather than a
 * thing each door has to be careful about.
 */
export interface ReceiptAttempt {
  succeeded(result: { diagnostics?: ReceiptAttemptDiagnostics }): void;
  failed(errorOrReason: unknown): void;
  queued(): void;
}

/**
 * The analytics payload for one settled attempt — every dimension filled.
 *
 * `door` excludes 'queue' in its type, not just its convention: the queue
 * door never sends (ReceiptAttemptService.begin's `send` returns before
 * building a payload), and the only caller passes the cast that makes that
 * true, not a decorative one.
 */
export function buildReceiptImportPayload(
  door: Exclude<ReceiptDoor, 'queue'>,
  outcome: ReceiptImportPayload['outcome'],
  diagnostics: ReceiptAttemptDiagnostics | null,
  failure: ReceiptFailureClass | null
): ReceiptImportPayload {
  return {
    outcome,
    path: door,
    engine: engineOf(diagnostics),
    provider: diagnostics?.provider ?? 'none',
    failure: failure ?? 'none',
    duration: durationBucket(diagnostics?.durationMs),
  };
}

function engineOf(diagnostics: ReceiptAttemptDiagnostics | null): ReceiptImportPayload['engine'] {
  if (!diagnostics) return 'none';
  if (diagnostics.fellBackFrom === 'native') return 'cloud_after_native';
  if (diagnostics.fellBackFrom === 'cloud') return 'native_after_cloud';
  return diagnostics.engine;
}

function durationBucket(durationMs: number | undefined): ReceiptImportPayload['duration'] {
  if (durationMs === undefined) return 'none';
  if (durationMs < 5000) return 'under_5s';
  if (durationMs < 15000) return '5s_to_15s';
  if (durationMs < 60000) return '15s_to_60s';
  return 'over_60s';
}

/**
 * What a failure was, from whichever shape the door caught.
 *
 * The no-provider sentinel is filed as `no_provider` here even though
 * parseAIError calls it `auth` — that classification exists so the wizard
 * can offer the key hint; for the record and the report the honest class is
 * that nothing was configured.
 */
export function classifyReceiptFailure(errorOrReason: unknown): {
  failure: ReceiptFailureClass;
  diagnostics: ReceiptAttemptDiagnostics | null;
  message: string;
} {
  if (isReason(errorOrReason)) {
    return { failure: errorOrReason, diagnostics: null, message: REASON_MESSAGES[errorOrReason] };
  }
  const diagnostics = errorOrReason instanceof ReceiptProcessingError ? errorOrReason.diagnostics : null;
  const raw = errorOrReason instanceof Error ? errorOrReason.message : String(errorOrReason);
  const parsed = parseAIError(errorOrReason);
  const failure: ReceiptFailureClass = raw === AI_NO_PROVIDER
    ? 'no_provider'
    : (diagnostics?.errorType ?? parsed.type);
  return { failure, diagnostics, message: parsed.message };
}

/** The record slots for an attempt — absent where nothing is known (ADR 0059). */
export function provenanceOf(
  door: ReceiptDoor,
  diagnostics: ReceiptAttemptDiagnostics | null | undefined,
  failure?: ReceiptFailureClass
): ImportProvenance {
  return {
    door,
    ...(diagnostics ? { engine: diagnostics.engine, durationMs: diagnostics.durationMs } : {}),
    ...(diagnostics?.fellBackFrom ? { fellBackFrom: diagnostics.fellBackFrom } : {}),
    ...(diagnostics?.provider ? { provider: diagnostics.provider } : {}),
    ...(failure ? { errorType: failure } : {}),
  };
}

/**
 * Records a receipt attempt where it runs.
 *
 * The only caller of AnalyticsService.trackReceiptImport, and the only
 * writer of a failed-attempt record: four doors run the same pipeline and
 * each used to report differently or not at all. The queue door records and
 * never sends — `queued_offline` was terminal for the attempt when the image
 * was captured, and a second event on the drain would double the denominator
 * (docs/analytics.md). Nothing here throws: an attempt record is never a
 * precondition for the user's receipt.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptAttemptService {
  private analytics = inject(AnalyticsService);
  private importHistory = inject(ImportHistoryService);
  private authService = inject(AuthService);

  begin(door: ReceiptDoor, kind: 'receipt_image' | 'screenshot', files: File[]): ReceiptAttempt {
    let settled = false;
    const once = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      settle();
    };
    const send = (
      outcome: ReceiptImportPayload['outcome'],
      diagnostics: ReceiptAttemptDiagnostics | null,
      failure: ReceiptFailureClass | null
    ): void => {
      if (door === 'queue') return;
      this.analytics.trackReceiptImport(
        buildReceiptImportPayload(door as Exclude<ReceiptDoor, 'queue'>, outcome, diagnostics, failure)
      );
    };

    return {
      succeeded: result => once(() => {
        send('ok', result.diagnostics ?? null, null);
      }),
      queued: () => once(() => {
        send('queued_offline', null, null);
      }),
      failed: errorOrReason => once(() => {
        const { failure, diagnostics, message } = classifyReceiptFailure(errorOrReason);
        send('failed', diagnostics, failure);
        void this.recordFailure(door, kind, files, provenanceOf(door, diagnostics, failure), message);
      }),
    };
  }

  private async recordFailure(
    door: ReceiptDoor,
    kind: 'receipt_image' | 'screenshot',
    files: File[],
    provenance: ImportProvenance,
    message: string
  ): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) return;

    const record: Omit<ImportHistory, 'id'> = {
      userId,
      importedAt: Timestamp.now(),
      source: 'image',
      fileType: kind,
      fileName: files[0]?.name ?? '',
      fileSize: files.reduce((sum, f) => sum + f.size, 0),
      transactionCount: 0,
      successCount: 0,
      skippedCount: 0,
      errorCount: 1,
      totalIncome: 0,
      totalExpenses: 0,
      status: 'failed',
      duplicatesSkipped: 0,
      errors: [{ message }],
      ...provenance,
    };

    try {
      await this.importHistory.saveImportHistory(record);
    } catch (error) {
      console.warn(`[ReceiptAttempt] Could not record a failed ${door} attempt:`, error);
    }
  }
}
