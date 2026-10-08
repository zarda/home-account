import { AfterViewInit, ChangeDetectionStrategy, Component, EventEmitter, HostBinding, Input, NgZone, OnDestroy, OnInit, Output, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';

import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../../core/services/auth.service';
import { KeyboardShortcutService } from '../../../core/services/keyboard-shortcut.service';
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { AiSearchDialogComponent } from '../../components/ai-search-dialog/ai-search-dialog.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { FitTextDirective } from '../../directives/fit-text.directive';
import { filter, map, Subscription } from 'rxjs';

/** localStorage key: the '?' hint was retired on this device. */
const SHORTCUTS_HINT_KEY = 'homeaccount.shortcuts-hint-dismissed';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    FitTextDirective,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() isSidebarOpen = true;
  @Output() toggleSidebar = new EventEmitter<void>();

  private authService = inject(AuthService);
  private router = inject(Router);
  private ngZone = inject(NgZone);
  private breakpointObserver = inject(BreakpointObserver);
  private dialog = inject(MatDialog);
  private keyboardShortcuts = inject(KeyboardShortcutService);
  private lastScrollY = 0;
  private routerSubscription?: Subscription;
  private scrollContainer: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private rafPending = false;
  private rafId = 0;

  // Auto-hide is a mobile pattern; on tablet/desktop the header stays put.
  private isMobileViewport = toSignal(
    this.breakpointObserver.observe(APP_BREAKPOINTS.mobile).pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  // The '?' hint speaks to a keyboard, and the docked-desktop width is the
  // one where the app assumes there is one.
  private isDesktopViewport = toSignal(
    this.breakpointObserver.observe(APP_BREAKPOINTS.desktop).pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  // Per device, not per account: the hint teaches this device's keyboard.
  private shortcutsHintDismissed = signal(this.readShortcutsHintDismissed());

  showShortcutsHint = computed(() => this.isDesktopViewport() && !this.shortcutsHintDismissed());

  currentUser = computed(() => this.authService.currentUser());
  isVisible = signal(true);

  // Resets to unfailed whenever the photo URL itself changes, so a stale
  // failure never survives a sign-in as a different account.
  avatarFailed = linkedSignal({ source: () => this.currentUser()?.photoURL, computation: () => false });

  @HostBinding('class.hidden')
  get isHidden(): boolean {
    return !this.isVisible();
  }

  constructor() {
    // The palette lists every shortcut whenever its search is empty, so once
    // it has opened, by the button or by a key, the hint has said its piece.
    effect(() => {
      if (this.keyboardShortcuts.paletteOpened()) {
        untracked(() => this.dismissShortcutsHint());
      }
    });
  }

  ngOnInit(): void {
    // Reset header visibility on route change
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.isVisible.set(true);
        this.lastScrollY = 0;
        if (this.scrollContainer) {
          this.scrollContainer.scrollTop = 0;
        }
      });
  }

  ngAfterViewInit(): void {
    // Find the main-container which has the scrollable content
    this.scrollContainer = document.querySelector('.main-container');

    if (this.scrollContainer) {
      this.scrollHandler = () => this.scheduleScrollFrame();
      // Outside the zone: scroll events fire constantly and must not run
      // app-wide change detection; we re-enter only when visibility flips.
      this.ngZone.runOutsideAngular(() => {
        this.scrollContainer!.addEventListener('scroll', this.scrollHandler!, { passive: true });
      });
    }
  }

  private scheduleScrollFrame(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    this.rafId = requestAnimationFrame(() => {
      this.rafPending = false;
      this.evaluateScrollFrame();
    });
  }

  /** One hide/show decision per animation frame (public for the spec). */
  evaluateScrollFrame(): void {
    if (!this.scrollContainer) return;

    const currentScrollY = this.scrollContainer.scrollTop;
    const next = this.computeVisibility(currentScrollY);
    this.lastScrollY = currentScrollY;

    if (next !== this.isVisible()) {
      this.ngZone.run(() => this.isVisible.set(next));
    }
  }

  private computeVisibility(currentScrollY: number): boolean {
    if (!this.isMobileViewport()) {
      return true;
    }
    if (currentScrollY < 10) {
      // Always show at top of page
      return true;
    }
    if (currentScrollY > this.lastScrollY && currentScrollY > 64) {
      // Scrolling down and past header height - hide
      return false;
    }
    if (currentScrollY < this.lastScrollY) {
      // Scrolling up - show
      return true;
    }
    return this.isVisible();
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    cancelAnimationFrame(this.rafId);
    if (this.scrollContainer && this.scrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
    }
  }

  openPalette(): void {
    this.keyboardShortcuts.openPalette();
  }

  dismissShortcutsHint(): void {
    if (this.shortcutsHintDismissed()) return;
    this.shortcutsHintDismissed.set(true);
    try {
      localStorage.setItem(SHORTCUTS_HINT_KEY, 'true');
    } catch {
      // Storage refused the write: the dismissal lasts only as long as this
      // header, and a lock, which mounts a new one, shows the hint again.
      // Storage that reads but will not write is too rare to carry a
      // session-wide flag for.
    }
  }

  private readShortcutsHintDismissed(): boolean {
    try {
      return localStorage.getItem(SHORTCUTS_HINT_KEY) === 'true';
    } catch {
      // Unreadable storage could never keep a dismissal either, so the hint
      // would come back on every launch. The palette's button and its own
      // list of shortcuts still teach the keys.
      return true;
    }
  }

  openSearchDialog(): void {
    this.dialog.open(AiSearchDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
    });
  }

  async logout(): Promise<void> {
    await this.authService.signOut();
    this.router.navigate(['/login']);
  }
}
