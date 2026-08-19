import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';

import { TransactionService } from '../../../core/services/transaction.service';
import { ReceiptQuotaService } from '../../../core/services/receipt-quota.service';
import {
  ReceiptToNoteService,
  RECEIPT_TO_NOTE_AI_UNAVAILABLE,
  RECEIPT_TO_NOTE_NO_DETAILS,
  RECEIPT_TO_NOTE_DOWNLOAD_FAILED,
} from '../../../core/services/receipt-to-note.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { LocaleDatePipe } from '../../../shared/pipes/locale-date.pipe';
import { LocaleNumberPipe } from '../../../shared/pipes/locale-number.pipe';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Transaction } from '../../../models';

/** One stored image of a transaction, addressed by its storage slot. */
interface ReceiptImage {
  url: string;
  slot: number;
}

/** A transaction and every image it holds — one group in the manager. */
interface ReceiptGroup {
  transaction: Transaction;
  images: ReceiptImage[];
}

/**
 * Lists every stored receipt image, grouped by transaction, so the user can
 * free up quota one image at a time: view an image, remove it, or convert it
 * into detailed note text (which also removes it). The quota counts images,
 * not transactions, so the housekeeping acts on images too — a per-group
 * remove-all keeps the bulk path for clearing a whole transaction.
 */
@Component({
  selector: 'app-receipt-image-manager',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    DialogHeaderComponent,
    LoadingSpinnerComponent,
    LocaleDatePipe,
    LocaleNumberPipe,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-image-manager.component.html',
  styleUrl: './receipt-image-manager.component.scss',
})
export class ReceiptImageManagerComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<ReceiptImageManagerComponent>);
  private dialog = inject(MatDialog);
  private transactionService = inject(TransactionService);
  private receiptToNote = inject(ReceiptToNoteService);
  private translationService = inject(TranslationService);
  private notifications = inject(NotificationService);
  quota = inject(ReceiptQuotaService);

  isLoading = signal(true);
  groups = signal<ReceiptGroup[]>([]);
  /** `${transactionId}:${slot}` keys with an in-flight remove/convert, plus
   * `${transactionId}:*` while a whole group is being cleared. Per-image so
   * converting one image does not lock its siblings. */
  busyKeys = signal<Set<string>>(new Set());

  usageText = computed(() => {
    const used = this.quota.imageCount()
      ?? this.groups().reduce((total, group) => total + group.images.length, 0);
    if (this.quota.hasUnlimitedImages()) {
      return this.translationService.t('receiptImages.usageUnlimited', { used });
    }
    return this.translationService.t('receiptImages.usage', {
      used,
      limit: this.quota.imageLimit(),
    });
  });

  async ngOnInit(): Promise<void> {
    try {
      const [transactions] = await Promise.all([
        firstValueFrom(this.transactionService.getTransactionsWithReceipts()),
        this.quota.refreshCount().catch(() => null),
      ]);
      this.groups.set(transactions.map(transaction => ({
        transaction,
        images: this.imagesOf(transaction),
      })));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.isLoading.set(false);
    }
  }

  isBusy(transactionId: string, slot?: number): boolean {
    const keys = this.busyKeys();
    return keys.has(`${transactionId}:*`)
      || (slot !== undefined && keys.has(`${transactionId}:${slot}`));
  }

  dateOf(group: ReceiptGroup): Date {
    return group.transaction.date.toDate();
  }

  async removeImage(group: ReceiptGroup, image: ReceiptImage): Promise<void> {
    const data: ConfirmDialogData = {
      title: this.translationService.t('receiptImages.removeOneConfirmTitle'),
      message: this.translationService.t('receiptImages.removeOneConfirmMessage'),
      confirmLabel: this.translationService.t('common.remove'),
      confirmColor: 'warn',
      icon: 'delete',
    };
    const confirmed = await firstValueFrom(
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
    );
    if (!confirmed) return;

    const id = group.transaction.id;
    this.setBusy(`${id}:${image.slot}`, true);
    try {
      await this.transactionService.removeReceiptAt(id, image.slot);
      this.dropImage(id, image.slot);
      this.notifications.success(this.translationService.t('receiptImages.removed'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.setBusy(`${id}:${image.slot}`, false);
    }
  }

  async removeAllImages(group: ReceiptGroup): Promise<void> {
    const count = group.images.length;
    const data: ConfirmDialogData = {
      title: this.translationService.t('receiptImages.removeAllConfirmTitle'),
      message: this.translationService.t('receiptImages.removeAllConfirmMessage', { count }),
      confirmLabel: this.translationService.t('common.remove'),
      confirmColor: 'warn',
      icon: 'delete',
    };
    const confirmed = await firstValueFrom(
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
    );
    if (!confirmed) return;

    const id = group.transaction.id;
    this.setBusy(`${id}:*`, true);
    try {
      await this.transactionService.removeAllReceipts(id);
      this.groups.update(list => list.filter(g => g.transaction.id !== id));
      this.notifications.success(
        this.translationService.t('receiptImages.removedAll', { count })
      );
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.setBusy(`${id}:*`, false);
    }
  }

  async convertToNote(group: ReceiptGroup, image: ReceiptImage): Promise<void> {
    const id = group.transaction.id;
    this.setBusy(`${id}:${image.slot}`, true);
    try {
      const note = await this.receiptToNote.convertReceiptToNote(
        group.transaction,
        image.slot
      );
      // Carry the appended note on the local row: converting a second image
      // of the same transaction must build on this note, not the stale one.
      this.groups.update(list => list.map(g =>
        g.transaction.id === id
          ? { ...g, transaction: { ...g.transaction, note } }
          : g
      ));
      this.dropImage(id, image.slot);
      this.notifications.success(this.translationService.t('receiptImages.converted'));
    } catch (error) {
      this.notifications.error(this.convertErrorMessage(error));
    } finally {
      this.setBusy(`${id}:${image.slot}`, false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  /**
   * A transaction's images as {url, slot} pairs: the slot is the entry's
   * index in receiptUrls (a legacy row's single receiptUrl is slot 0);
   * tombstones are skipped but survivors keep their original slots.
   */
  private imagesOf(transaction: Transaction): ReceiptImage[] {
    const slots = transaction.receiptUrls
      ?? (transaction.receiptUrl ? [transaction.receiptUrl] : []);
    return slots.map((url, slot) => ({ url, slot })).filter(image => !!image.url);
  }

  private convertErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message === RECEIPT_TO_NOTE_AI_UNAVAILABLE) {
      return this.translationService.t('receiptImages.convertFailedNoAi');
    }
    if (message === RECEIPT_TO_NOTE_NO_DETAILS) {
      return this.translationService.t('receiptImages.convertFailedNoDetails');
    }
    if (message === RECEIPT_TO_NOTE_DOWNLOAD_FAILED) {
      return this.translationService.t('receiptImages.convertFailedDownload');
    }
    return this.translationService.t('receiptImages.convertFailed');
  }

  /** Drop one image from its group; a group with no images left leaves the list. */
  private dropImage(transactionId: string, slot: number): void {
    this.groups.update(list => list
      .map(group => group.transaction.id === transactionId
        ? { ...group, images: group.images.filter(image => image.slot !== slot) }
        : group)
      .filter(group => group.images.length > 0));
  }

  private setBusy(key: string, busy: boolean): void {
    this.busyKeys.update(keys => {
      const next = new Set(keys);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }
}
