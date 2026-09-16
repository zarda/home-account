import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DashboardCardId, DashboardLayout, effectiveDashboardLayout } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { moveCard, sameLayout, setCardHidden } from '../../dashboard/dashboard-layout.utils';

/** The dashboard's own card titles, so a row reads as the card it arranges. */
const CARD_TITLE_KEYS: Readonly<Record<DashboardCardId, string>> = {
  recent: 'dashboard.recentTransactions',
  upcoming: 'dashboard.upcomingBills',
  chart: 'dashboard.spendingByCategory',
  insights: 'ai.insights',
  budgets: 'dashboard.budgetProgress',
};

const CARD_ICONS: Readonly<Record<DashboardCardId, string>> = {
  recent: 'receipt_long',
  upcoming: 'event_upcoming',
  chart: 'donut_large',
  insights: 'psychology',
  budgets: 'savings',
};

/** A pending write: the latest layout, or deleting the key. */
type LayoutWrite = 'update' | 'clear';

/**
 * Where the account moves and hides the dashboard's cards (#87).
 *
 * Every change is written at once; there is no Save. The rows are a local
 * copy linked to the account's layout, held while this panel is saving: an
 * earlier write of its own lands reporting an older layout than the rows
 * already show. Writes go out one at a time, each carrying the rows as they
 * stand when it is sent, so a change made mid-save joins the next write
 * rather than racing the one in flight. The account's layout is compared by
 * structure, since a preference write anywhere replaces the whole user
 * object.
 *
 * Move up / Move down are the keyboard path the drag handle does not offer.
 */
@Component({
  selector: 'app-dashboard-layout-settings',
  standalone: true,
  imports: [DragDropModule, MatSlideToggleModule, MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-layout-settings.component.html',
  styleUrl: './dashboard-layout-settings.component.scss',
})
export class DashboardLayoutSettingsComponent {
  private auth = inject(AuthService);
  private notifications = inject(NotificationService);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);

  readonly titleKeys = CARD_TITLE_KEYS;
  readonly icons = CARD_ICONS;

  private accountLayout = computed(
    () => effectiveDashboardLayout(this.auth.currentUser()?.preferences),
    { equal: sameLayout }
  );

  private readonly saving = signal(false);

  readonly layout = linkedSignal<{ account: DashboardLayout; saving: boolean }, DashboardLayout>({
    source: () => ({ account: this.accountLayout(), saving: this.saving() }),
    computation: ({ account, saving }, previous) => (saving && previous ? previous.value : account),
  });

  /** Replaced by each newer change, so a burst of changes costs one more write. */
  private queuedWrite: LayoutWrite | null = null;

  /** Switches pressed since the current run of saves began. */
  private pressedSwitches = new Map<DashboardCardId, MatSlideToggleChange['source']>();

  /** Whether a layout is stored at all — a stored default is still resettable. */
  readonly customized = computed(
    () => this.auth.currentUser()?.preferences?.dashboardLayout !== undefined
  );

  onToggle(id: DashboardCardId, event: MatSlideToggleChange): void {
    this.pressedSwitches.set(id, event.source);
    this.apply(setCardHidden(this.layout(), id, !event.checked));
  }

  move(id: DashboardCardId, delta: -1 | 1): void {
    const next = moveCard(this.layout(), id, delta);
    if (next === this.layout()) return;

    const position = next.order.indexOf(id) + 1;
    const total = next.order.length;
    this.apply(next);

    const card = this.translation.t(CARD_TITLE_KEYS[id]);
    this.announcer.announce(
      this.translation.t('settings.dashboardCardMoved', { card, position, total })
    );

    // The pressed button is disabled once its card reaches that end, and a
    // disabled button drops focus, so the card's other button takes it.
    const [pressed, other] = delta === -1 ? ['up', 'down'] : ['down', 'up'];
    const atEnd = delta === -1 ? position === 1 : position === total;
    this.focusWhenRendered(`[data-card="${id}"] [data-move="${atEnd ? other : pressed}"]`);
  }

  onDrop(event: Pick<CdkDragDrop<unknown>, 'previousIndex' | 'currentIndex'>): void {
    if (event.previousIndex === event.currentIndex) return;

    const order = [...this.layout().order];
    moveItemInArray(order, event.previousIndex, event.currentIndex);
    this.apply({ ...this.layout(), order });
  }

  /**
   * Deletes the key rather than writing today's default, so a reset account
   * follows whatever default a later build ships.
   */
  reset(): void {
    this.layout.set(effectiveDashboardLayout(undefined));
    this.save('clear');
  }

  private apply(next: DashboardLayout): void {
    this.layout.set(next);
    this.save('update');
  }

  private save(write: LayoutWrite): void {
    this.queuedWrite = write;
    if (!this.saving()) void this.drain();
  }

  private async drain(): Promise<void> {
    this.saving.set(true);
    try {
      while (this.queuedWrite) {
        const write = this.queuedWrite;
        this.queuedWrite = null;
        if (write === 'clear') {
          await this.auth.clearUserPreferences(['dashboardLayout']);
        } else {
          // Only the layout key: updateUserPreferences writes per field, so no
          // other preference this session read can be sent back over a newer one.
          await this.auth.updateUserPreferences({ dashboardLayout: this.layout() });
        }
      }
    } catch {
      // A queued change was built on the write that failed, so it goes too.
      this.queuedWrite = null;
      this.notifications.error(this.translation.t('settings.dashboardLayoutSaveFailed'));
      this.revertSwitches();
    } finally {
      // Ends the hold, so the rows become the account's layout again.
      this.saving.set(false);
      this.pressedSwitches.clear();
    }
  }

  /**
   * Put the pressed switches back where the account says they are.
   *
   * Their `[checked]` binding does follow the rows, but a rejection can land
   * before change detection has rendered the optimistic value. The binding
   * then reads the same value it last wrote and skips the DOM, leaving the
   * control where the click moved it.
   */
  private revertSwitches(): void {
    const account = this.accountLayout();
    for (const [id, toggle] of this.pressedSwitches) {
      toggle.checked = !account.hidden.includes(id);
    }
  }

  /**
   * The rows re-render after the move, which is what afterNextRender waits
   * for; registering on a destroyed injector throws NG0911, hence the guard.
   */
  private focusWhenRendered(selector: string): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector }
    );
  }
}
