import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
} from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';

import { AnnouncerService } from '../../../core/services/announcer.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DashboardCardId } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DashboardLayoutService } from '../../dashboard/dashboard-layout.service';
import { CARD_ICONS, CARD_TITLE_KEYS } from '../../dashboard/dashboard-layout.utils';

/**
 * Where the account moves and hides the dashboard's cards (#87).
 *
 * Every change is saved at once; there is no Save. The rows are the layout
 * DashboardLayoutService holds, which shows a change before its write lands,
 * saves one write at a time and reports a failed save itself. What is left
 * here is what only this panel did: a switch it must turn back, and a move
 * position it announced that a failed save made untrue.
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
  private layoutService = inject(DashboardLayoutService);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);

  readonly titleKeys = CARD_TITLE_KEYS;
  readonly icons = CARD_ICONS;

  readonly layout = this.layoutService.layout;

  /** Switches pressed and not yet settled, each with the save it joined. */
  private pressedSwitches = new Map<
    DashboardCardId,
    { toggle: MatSlideToggleChange['source']; save: Promise<void> }
  >();

  /** Set only by a move, so a rejected toggle never gets a second announcement. */
  private pendingMove: { id: DashboardCardId; save: Promise<void> } | null = null;

  /**
   * Whether anything is stored to reset. A switch turned off and on again
   * deletes the field it wrote, leaving a map that holds neither.
   */
  readonly customized = computed(() => {
    const stored = this.auth.currentUser()?.preferences?.dashboardLayout;
    return Boolean(stored?.order || stored?.hidden);
  });

  onToggle(id: DashboardCardId, event: MatSlideToggleChange): void {
    const save = event.checked ? this.layoutService.show(id) : this.layoutService.hide(id);
    this.pressedSwitches.set(id, { toggle: event.source, save });
    this.settle(save);
  }

  move(id: DashboardCardId, delta: -1 | 1): void {
    const before = this.layout();
    // Every card is a row here, so a move steps over the whole order.
    const save = this.layoutService.moveVisible(id, delta, before.order);
    const next = this.layout();
    if (next === before) return;

    const position = next.order.indexOf(id) + 1;
    const total = next.order.length;
    this.pendingMove = { id, save };
    this.settle(save);

    // A position is current state, and the next press makes it stale, so it
    // replaces any position still waiting rather than queueing behind it.
    const card = this.translation.t(CARD_TITLE_KEYS[id]);
    this.announcer.announce(
      this.translation.t('settings.dashboardCardMoved', { card, position, total }),
      'polite',
      'replace'
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
    this.settle(this.layoutService.setOrder(order));
  }

  reset(): void {
    this.settle(this.layoutService.reset());
  }

  /**
   * Every change made during one save shares its promise, so each settles
   * only what joined that save; the service has already shown the snackbar
   * and put the rows back by the time a rejection arrives.
   */
  private settle(save: Promise<void>): void {
    save.then(
      () => this.settled(save, false),
      () => this.settled(save, true)
    );
  }

  private settled(save: Promise<void>, failed: boolean): void {
    if (this.pendingMove?.save === save) {
      // Landed, the announced position is the truth again; failed, it never was.
      if (failed) this.announceMoveReverted(this.pendingMove.id);
      this.pendingMove = null;
    }
    for (const [id, pressed] of this.pressedSwitches) {
      if (pressed.save !== save) continue;
      // The switch's `[checked]` binding follows the rows, but a rejection
      // can land before change detection has rendered the optimistic value.
      // The binding then reads the value it last wrote and skips the DOM,
      // leaving the control where the click moved it.
      if (failed) pressed.toggle.checked = !this.layout().hidden.includes(id);
      this.pressedSwitches.delete(id);
    }
  }

  /**
   * The optimistic move announcement said a position that a failed write
   * never made true, so a screen-reader user is told where the card really
   * landed once the rows fall back to the account's order. It leads with the
   * failed save, an event, so it queues: a later move's position must not
   * drop it before it is heard.
   */
  private announceMoveReverted(id: DashboardCardId): void {
    const order = this.layout().order;
    const card = this.translation.t(CARD_TITLE_KEYS[id]);
    const position = order.indexOf(id) + 1;
    const total = order.length;
    this.announcer.announce(
      this.translation.t('settings.dashboardCardMoveReverted', { card, position, total })
    );
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
