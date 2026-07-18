import { Component, OnInit, inject, signal, computed } from '@angular/core';
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
} from '../../../core/services/receipt-to-note.service';
import { TranslationService } from '../../../core/services/translation.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Transaction } from '../../../models';

/**
 * Lists every transaction with a stored receipt image so the user can
 * free up quota: view the image, remove it from the item, or convert it
 * into detailed note text (which also removes the image).
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
    TranslatePipe,
  ],
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
  transactions = signal<Transaction[]>([]);
  /** Transaction ids with an in-flight remove/convert action. */
  busyIds = signal<Set<string>>(new Set());

  usageText = computed(() => {
    const used = this.quota.imageCount() ?? this.transactions().length;
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
      this.transactions.set(transactions);
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.isLoading.set(false);
    }
  }

  isBusy(id: string): boolean {
    return this.busyIds().has(id);
  }

  dateOf(transaction: Transaction): Date {
    return transaction.date.toDate();
  }

  async removeImage(transaction: Transaction): Promise<void> {
    const data: ConfirmDialogData = {
      title: this.translationService.t('receiptImages.removeConfirmTitle'),
      message: this.translationService.t('receiptImages.removeConfirmMessage'),
      confirmLabel: this.translationService.t('common.remove'),
      confirmColor: 'warn',
      icon: 'delete',
    };
    const confirmed = await firstValueFrom(
      this.dialog.open(ConfirmDialogComponent, { data }).afterClosed()
    );
    if (!confirmed) return;

    this.setBusy(transaction.id, true);
    try {
      await this.transactionService.removeReceipt(transaction.id);
      this.dropFromList(transaction.id);
      this.notifications.success(this.translationService.t('receiptImages.removed'));
    } catch {
      this.notifications.error(this.translationService.t('common.error'));
    } finally {
      this.setBusy(transaction.id, false);
    }
  }

  async convertToNote(transaction: Transaction): Promise<void> {
    this.setBusy(transaction.id, true);
    try {
      await this.receiptToNote.convertReceiptToNote(transaction);
      this.dropFromList(transaction.id);
      this.notifications.success(this.translationService.t('receiptImages.converted'));
    } catch (error) {
      this.notifications.error(this.convertErrorMessage(error));
    } finally {
      this.setBusy(transaction.id, false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  private convertErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    if (message === RECEIPT_TO_NOTE_AI_UNAVAILABLE) {
      return this.translationService.t('receiptImages.convertFailedNoAi');
    }
    if (message === RECEIPT_TO_NOTE_NO_DETAILS) {
      return this.translationService.t('receiptImages.convertFailedNoDetails');
    }
    return this.translationService.t('receiptImages.convertFailed');
  }

  private dropFromList(id: string): void {
    this.transactions.update(list => list.filter(t => t.id !== id));
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update(ids => {
      const next = new Set(ids);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
