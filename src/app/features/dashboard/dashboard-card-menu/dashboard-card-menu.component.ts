import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { AnnouncerService } from '../../../core/services/announcer.service';
import { TranslationService } from '../../../core/services/translation.service';
import { DashboardCardId } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { DashboardLayoutService } from '../dashboard-layout.service';
import { CARD_TITLE_KEYS } from '../dashboard-layout.utils';

/**
 * A card's own menu on the dashboard (#442): hide the card, or move it one
 * step, where it is seen. Showing a hidden card again stays in the settings
 * editor, since a hidden card has nowhere to carry a menu.
 *
 * Moves step over `visible`, the cards rendered with this menu, and the
 * position announced is counted over them, so every press changes what is
 * seen and the position said is the one on screen. The layout service shows
 * each change at once and reports a failed save itself.
 */
@Component({
  selector: 'app-dashboard-card-menu',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-card-menu.component.html',
  styleUrl: './dashboard-card-menu.component.scss',
})
export class DashboardCardMenuComponent {
  private layoutService = inject(DashboardLayoutService);
  private announcer = inject(AnnouncerService);
  private translation = inject(TranslationService);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);

  readonly card = input.required<DashboardCardId>();
  /** The cards rendered with a menu, in page order. */
  readonly visible = input.required<readonly DashboardCardId[]>();

  /**
   * The hidden card's index in `visible`. The menu goes with its card, so
   * the dashboard decides where focus lands.
   */
  readonly cardHidden = output<number>();

  private trigger = viewChild.required('trigger', { read: ElementRef<HTMLButtonElement> });

  /** The save the last move joined, and the place it announced, until it settles. */
  private pendingMove: { save: Promise<void>; position: number; total: number } | null = null;

  readonly titleKey = computed(() => CARD_TITLE_KEYS[this.card()]);
  private index = computed(() => this.visible().indexOf(this.card()));
  readonly first = computed(() => this.index() <= 0);
  readonly last = computed(() => this.index() === -1 || this.index() === this.visible().length - 1);

  hide(): void {
    const id = this.card();
    const index = this.index();
    const card = this.translation.t(this.titleKey());
    // Announced before the save settles, so a failed save, which puts the card
    // back, is announced too (accessibility.md, "Announcements"). The save
    // fails as a whole, though this hide's own write may have landed before
    // a later one failed: the card is said to be back only when it is. The
    // menu has gone with its card by then; the announcer outlives both.
    this.layoutService.hide(id).catch(() => {
      if (this.layoutService.layout().hidden.includes(id)) return;
      this.announcer.announce(this.translation.t('dashboard.cardHideReverted', { card }));
    });
    this.announcer.announce(this.translation.t('dashboard.cardHidden', { card }));
    this.cardHidden.emit(index);
  }

  move(delta: -1 | 1): void {
    const visible = this.visible();
    const index = visible.indexOf(this.card());
    const target = index + delta;
    if (index === -1 || target < 0 || target >= visible.length) return;

    const position = target + 1;
    const total = visible.length;
    const save = this.layoutService.moveVisible(this.card(), delta, visible);
    const pending = { save, position, total };
    this.pendingMove = pending;
    save.catch(() => {
      // Every press in one save shares its promise, so the correction is
      // said once, for the press that made it last.
      if (this.pendingMove !== pending) return;
      this.pendingMove = null;
      this.announceMoveReverted(pending);
    });

    // A position is current state, and the next press makes it stale.
    const card = this.translation.t(this.titleKey());
    this.announcer.announce(
      this.translation.t('settings.dashboardCardMoved', { card, position, total }),
      'polite',
      'replace'
    );

    // The grid reorders its cards by moving their hosts, and a moved element
    // loses focus, so the trigger the closing menu focused takes it again.
    // Registering on a destroyed injector throws NG0911, hence the guard.
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => this.trigger().nativeElement.focus(), { injector: this.injector });
  }

  /**
   * The moved position was announced before the save settled, and a failed
   * save puts the account's layout back, which may still hold this move, or
   * lack a hide that joined it. Once that has rendered, `visible` is the
   * cards back on the page, and this says where the card really is, unless
   * that is where it was said to be. It leads with the failed save, an
   * event, so it queues rather than replacing. A menu gone with its card,
   * hidden in the same save, says nothing: the hide's correction says the
   * card is back.
   */
  private announceMoveReverted(announced: { position: number; total: number }): void {
    if (this.destroyRef.destroyed) return;
    afterNextRender(() => {
      const visible = this.visible();
      const position = visible.indexOf(this.card()) + 1;
      const total = visible.length;
      if (position === announced.position && total === announced.total) return;
      this.announcer.announce(
        this.translation.t('settings.dashboardCardMoveReverted', {
          card: this.translation.t(this.titleKey()),
          position,
          total,
        })
      );
    }, { injector: this.injector });
  }
}
