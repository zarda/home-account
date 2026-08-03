import {
  Component,
  computed,
  EventEmitter,
  HostBinding,
  inject,
  Input,
  Output,
  signal,
  OnInit,
  OnDestroy,
  AfterViewInit,
  NgZone
} from '@angular/core';

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
import { APP_BREAKPOINTS } from '../../../core/layout/breakpoints';
import { AiSearchDialogComponent } from '../../components/ai-search-dialog/ai-search-dialog.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { FitTextDirective } from '../../directives/fit-text.directive';
import { filter, map, Subscription } from 'rxjs';

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

  currentUser = computed(() => this.authService.currentUser());
  isVisible = signal(true);

  @HostBinding('class.hidden')
  get isHidden(): boolean {
    return !this.isVisible();
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
