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
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { filter, Subscription } from 'rxjs';

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
  private lastScrollY = 0;
  private routerSubscription?: Subscription;
  private scrollContainer: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;

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
      this.scrollHandler = () => {
        this.ngZone.run(() => this.onScroll());
      };
      this.scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });
    }
  }

  private onScroll(): void {
    if (!this.scrollContainer) return;

    const currentScrollY = this.scrollContainer.scrollTop;

    // Always show at top of page
    if (currentScrollY < 10) {
      this.isVisible.set(true);
    } else if (currentScrollY > this.lastScrollY && currentScrollY > 64) {
      // Scrolling down and past header height - hide
      this.isVisible.set(false);
    } else if (currentScrollY < this.lastScrollY) {
      // Scrolling up - show
      this.isVisible.set(true);
    }

    this.lastScrollY = currentScrollY;
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    if (this.scrollContainer && this.scrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
    }
  }

  async logout(): Promise<void> {
    await this.authService.signOut();
    this.router.navigate(['/login']);
  }
}
