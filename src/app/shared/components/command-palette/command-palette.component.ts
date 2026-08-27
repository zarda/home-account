import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { AnnouncerService } from '../../../core/services/announcer.service';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import { isImeComposition } from '../../../core/utils/keyboard.utils';
import { NAV_ITEMS, PALETTE_ONLY_ITEMS } from '../../layout/nav-items';
import { DialogHeaderComponent } from '../dialog-header/dialog-header.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/** What a palette row does when it is chosen. */
export type PaletteAction = 'add' | 'scan';

export interface PaletteCommand {
  /** Which section the row belongs to, and which branch `select` takes. */
  kind: 'nav' | 'action';
  labelKey: string;
  icon: string;
  /** Set on nav commands only. */
  route?: string;
  /** Set on action commands only. */
  action?: PaletteAction;
}

/** A command with its label resolved against the loaded catalog. */
export interface LabelledPaletteCommand extends PaletteCommand {
  label: string;
}

/**
 * The quick actions the palette offers beside the destinations. Both keys are
 * the ones the bottom nav's add menu already uses, so the palette can never
 * call the same thing by a different name.
 */
const ACTION_COMMANDS: readonly PaletteCommand[] = [
  { kind: 'action', labelKey: 'transactions.addTransaction', icon: 'add', action: 'add' },
  { kind: 'action', labelKey: 'ai.scanReceipt', icon: 'photo_camera', action: 'scan' },
];

/**
 * The command palette (#80): Ctrl/Cmd+K, type a few letters, press Enter.
 * Every destination in the shared nav list — including the three that no
 * navigation surface shows — plus the two quick actions, in one filterable
 * list. KeyboardShortcutService owns opening and closing it.
 *
 * Three decisions worth stating:
 *
 *  - Rows are `<button>`, not `<a routerLink>`. Anchors would be the obvious
 *    spelling for navigation, but app.smoke.spec's aria-current invariant
 *    asserts that exactly one `a.nav-item` marks itself current on every
 *    route; a second set of route links living in a dialog would join that
 *    count. Buttons also keep Enter activation on a *focused row* native —
 *    the only Enter handler of ours is on the search box, where there is no
 *    native activation to preserve and Enter would otherwise be inert.
 *  - Filtering matches the *translated* label, and the memo folds
 *    `translationsVersion()` for the reason TranslatePipe does: the catalog
 *    arrives (and is replaced on a language switch) under a signal the query
 *    knows nothing about, so without that read an open palette would keep
 *    filtering the previous locale's words.
 *  - Arrow keys move real DOM focus between rows rather than tracking an
 *    active index and painting it. Focus is what a screen reader follows,
 *    and it is the pattern transaction-filters already uses to step from its
 *    search box into the suggestion list.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
  private dialogRef = inject(MatDialogRef<CommandPaletteComponent>);
  private elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private router = inject(Router);
  private quickAdd = inject(QuickAddService);
  private announcer = inject(AnnouncerService);
  private translationService = inject(TranslationService);

  /** Every command the palette knows, destinations first. */
  private readonly commands: readonly PaletteCommand[] = [
    ...[...NAV_ITEMS, ...PALETTE_ONLY_ITEMS].map<PaletteCommand>(item => ({
      kind: 'nav',
      labelKey: item.labelKey,
      icon: item.icon,
      route: item.route,
    })),
    ...ACTION_COMMANDS,
  ];

  query = signal('');

  /** Latched by the first `select()`; see the comment there. */
  private selected = false;

  private labelled = computed<LabelledPaletteCommand[]>(() => {
    // Read, not used: the catalog version is what tells this memo the labels
    // it resolved are stale (see the class comment).
    this.translationService.translationsVersion();
    return this.commands.map(command => ({
      ...command,
      label: this.translationService.t(command.labelKey),
    }));
  });

  filtered = computed<LabelledPaletteCommand[]>(() => {
    const needle = this.query().trim().toLocaleLowerCase();
    const all = this.labelled();
    if (!needle) return all;
    return all.filter(command => command.label.toLocaleLowerCase().includes(needle));
  });

  navResults = computed(() => this.filtered().filter(command => command.kind === 'nav'));
  actionResults = computed(() => this.filtered().filter(command => command.kind === 'action'));

  onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    // No debounce: LiveAnnouncer is polite, so each message replaces the one
    // before it in the live region rather than queueing behind it.
    this.announcer.announce(
      this.translationService.t('palette.resultCount', { count: this.filtered().length })
    );
  }

  /**
   * Enter in the search box runs the first result, which is what the palette
   * promises ("type a few letters, press Enter") and what docs/shortcuts.md
   * documents. `filtered()` is in render order — every nav command precedes
   * every action command — so its head is the row the user can see at the
   * top. An IME composition committing the key is text, not a command, and
   * an empty result list leaves Enter inert rather than guessing.
   */
  onInputEnter(event: Event): void {
    if (isImeComposition(event)) return;
    const first = this.filtered()[0];
    if (!first) return;
    event.preventDefault();
    this.select(first);
  }

  /** ArrowDown out of the search box hands focus to the first row. */
  onInputArrowDown(event: Event): void {
    const first = this.rows()[0];
    if (!first) return;
    event.preventDefault();
    first.focus();
  }

  onRowArrowDown(event: Event): void {
    this.moveRowFocus(event, 1);
  }

  onRowArrowUp(event: Event): void {
    this.moveRowFocus(event, -1);
  }

  /**
   * Runs the chosen command — after the palette has finished closing, never
   * beside it. Both action branches open a dialog of their own, and starting
   * one while this dialog is still animating out stacks two dialogs whose
   * focus restoration then fights: the palette's would land last and pull
   * focus out of the form the user just asked for.
   *
   * First call wins. The rows stay hit-testable for the whole exit
   * transition, so a fast double-click — or a click landing on the Enter
   * that already chose — would otherwise queue a second `run` on the one
   * close: two stacked add-transaction dialogs, both `disableClose: true`.
   */
  select(command: PaletteCommand): void {
    if (this.selected) return;
    this.selected = true;
    this.dialogRef.afterClosed().subscribe(() => this.run(command));
    this.dialogRef.close();
  }

  close(): void {
    this.dialogRef.close();
  }

  private run(command: PaletteCommand): void {
    if (command.kind === 'nav' && command.route) {
      void this.router.navigate([command.route]);
      return;
    }
    if (command.action === 'add') {
      this.quickAdd.openAddTransaction();
      return;
    }
    if (command.action === 'scan') {
      this.quickAdd.openScanReceipt();
    }
  }

  private rows(): HTMLElement[] {
    return Array.from(
      this.elementRef.nativeElement.querySelectorAll<HTMLElement>('.palette-item')
    );
  }

  /** Stops at both ends: no wrap, so the list has a top and a bottom. */
  private moveRowFocus(event: Event, delta: number): void {
    const rows = this.rows();
    const next = rows[rows.indexOf(event.currentTarget as HTMLElement) + delta];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
}
