import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Signal,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { NoteTranslation } from '../../../core/services/llm-provider.interface';
import { ReceiptTranslationService } from '../../../core/services/receipt-translation.service';
import { DialogHeaderComponent } from '../../../shared/components/dialog-header/dialog-header.component';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { Transaction, receiptImageSlots } from '../../../models';

export interface ReceiptViewerDialogData {
  transaction: Transaction;
  /**
   * Storage slot to open on. Absent — or naming a slot that has since been
   * removed — opens on the transaction's first stored image.
   */
  slot?: number;
}

/**
 * Open the receipt viewer for one transaction.
 *
 * Every door into this dialog goes through here rather than calling
 * `dialog.open` itself, so the width is decided once: three call sites —
 * serving five doors between them — each passing their own would be three
 * chances for one of them to open a photo into a 480px default.
 *
 * Callers open this only for a transaction with at least one live image —
 * the doors gate on `receiptUrl` — so the empty-slots state the template
 * guards against is defensive, not a path any door takes on purpose.
 */
export function openReceiptViewer(
  dialog: MatDialog,
  data: ReceiptViewerDialogData
): MatDialogRef<ReceiptViewerDialogComponent> {
  return dialog.open(ReceiptViewerDialogComponent, {
    // Wider than the app-wide default, because the content is a photograph of
    // a receipt and the point is to read what is printed on it.
    width: 'min(720px, calc(100vw - 32px))',
    data,
  });
}

/**
 * One transaction's receipt photos, read inside the app.
 *
 * A stored receipt is otherwise reachable only as a browser tab, which hands
 * the reader to the browser's image viewer and loses every piece of context
 * with them: which transaction the photo belongs to, which of its images
 * this is, and any way to read a receipt printed in a language the reader
 * does not have. All three stay here, and the reading is offered on demand.
 *
 * The lens state lives here rather than in a reusable component like the
 * note's. The note lens stands its answer *in for* the text it translates
 * and moves focus as it swaps them; this one adds a panel beside an image
 * that never goes away, and it resets per image rather than per edit. Those
 * are different enough behaviours that sharing one component would mean a
 * component with two modes.
 *
 * Nothing here writes: the transaction, its images and its slots are read
 * exactly as they are stored.
 */
@Component({
  selector: 'app-receipt-viewer-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    DialogHeaderComponent,
    LoadingSpinnerComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-viewer-dialog.component.html',
  styleUrl: './receipt-viewer-dialog.component.scss',
})
export class ReceiptViewerDialogComponent {
  private dialogRef = inject(MatDialogRef<ReceiptViewerDialogComponent>);
  private receiptTranslation = inject(ReceiptTranslationService);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private host = inject(ElementRef<HTMLElement>);
  readonly data: ReceiptViewerDialogData = inject(MAT_DIALOG_DATA);

  // Read as elements, not as the MatButton/MatIconButton directives the refs
  // would otherwise resolve to — focus() lives on the DOM node.
  private previousButton = viewChild('previousButton', { read: ElementRef<HTMLElement> });
  private nextButton = viewChild('nextButton', { read: ElementRef<HTMLElement> });
  private translateButton = viewChild('translateButton', { read: ElementRef<HTMLElement> });
  private hideTranslationButton = viewChild('hideTranslationButton', {
    read: ElementRef<HTMLElement>,
  });
  private retryButton = viewChild('retryButton', { read: ElementRef<HTMLElement> });

  /** Live images with the slots they are stored at; tombstones are not images. */
  readonly slots = receiptImageSlots(this.data.transaction);
  readonly total = this.slots.length;

  readonly index = signal(
    // A slot is not a position — a removed image leaves a gap — and a caller
    // can be holding a slot that has since been cleared, so an unknown slot
    // opens on the first image rather than on nothing.
    Math.max(0, this.slots.findIndex(image => image.slot === this.data.slot))
  );
  readonly current = computed(() => this.slots[this.index()]);

  readonly translation = signal<NoteTranslation | null>(null);
  readonly isLoading = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** Whether any configured provider could read a photo at all. */
  readonly available = this.receiptTranslation.available;

  /**
   * Bumped by every request that starts and by every move between images, so
   * an `await` resuming after either can tell whether it is still the one
   * anyone asked for. Two images of the same transaction are otherwise
   * indistinguishable to a resumed request.
   */
  private requestToken = 0;

  previous(): void {
    const target = this.index() - 1;
    this.show(target);
    // Reaching the first image disables this same button (a browser drops
    // focus from an element that becomes disabled) — the other arrow is
    // always there to take it, since both render whenever the row does.
    if (target === 0) {
      this.focusWhenRendered(this.nextButton);
    }
  }

  next(): void {
    const target = this.index() + 1;
    this.show(target);
    if (target === this.total - 1) {
      this.focusWhenRendered(this.previousButton);
    }
  }

  /** Read this image back in the app's language. */
  async translateReceipt(): Promise<void> {
    if (this.isLoading()) {
      return;
    }

    const slot = this.current().slot;
    const token = ++this.requestToken;
    this.errorKey.set(null);
    this.isLoading.set(true);
    try {
      const translated = await this.receiptTranslation.translate(this.data.transaction, slot);
      if (token !== this.requestToken) {
        return;
      }
      this.translation.set(translated);
      this.focusWhenRendered(this.hideTranslationButton);
    } catch (error) {
      if (token !== this.requestToken) {
        return;
      }
      this.errorKey.set(this.receiptTranslation.failureKey(error));
      this.focusWhenRendered(this.retryButton);
    } finally {
      // Guarded like the two branches above: a move between images already
      // cleared this flag, and a request started for the new image may be
      // running by now — clearing it again would take that one's spinner
      // down with it.
      if (token === this.requestToken) {
        this.isLoading.set(false);
      }
    }
  }

  /**
   * Put the panel away. The answer itself is not kept here: the service
   * caches it for the session, so asking again costs a lookup, not a call.
   */
  hideTranslation(): void {
    this.translation.set(null);
    this.focusWhenRendered(this.translateButton);
  }

  close(): void {
    this.dialogRef.close();
  }

  /** Show another image, and take its own reading with it. */
  private show(index: number): void {
    this.index.set(index);
    // Bumping the token orphans a request still in flight for the image just
    // left, so its answer lands as a no-op rather than under another photo.
    this.requestToken++;
    this.translation.set(null);
    this.errorKey.set(null);
    this.isLoading.set(false);
  }

  /**
   * Put focus on the control that takes the place of the one just pressed.
   *
   * Translate is gone as soon as a request starts, Hide translation goes with
   * the panel holding it, and an end arrow disables itself the moment it is
   * pressed — each leaves focus on `<body>` with no way back to the dialog
   * short of tabbing through it again. afterNextRender is the first moment
   * the replacement exists to receive it.
   */
  private focusWhenRendered(target: Signal<ElementRef<HTMLElement> | undefined>): void {
    // A translation can arrive after the dialog is closed mid-request.
    // Registering on the destroyed injector throws NG0911, and there is
    // nothing left to focus anyway.
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => {
        // Only focus this dialog abandoned — on <body> because the pressed
        // control was just removed, or still somewhere inside this host —
        // is focus this dialog may move. A pointer user's focus is never
        // yanked from wherever they last put it.
        const active = document.activeElement;
        const abandoned =
          active === null ||
          active === document.body ||
          this.host.nativeElement.contains(active);
        if (!abandoned) return;
        target()?.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }
}
