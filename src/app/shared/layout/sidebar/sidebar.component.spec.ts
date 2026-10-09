import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SidebarComponent } from './sidebar.component';
import { TranslationService } from '../../../core/services/translation.service';
import {
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../core/services/testing';

/** Somewhere for the test router to land; the nav is what is under test. */
@Component({ standalone: true, template: '' })
class StubPage {}

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  beforeEach(async () => {
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, NoopAnimationsModule],
      providers: [
        provideRouter([
          { path: 'dashboard', component: StubPage },
          { path: 'dashboard/detail', component: StubPage },
          { path: 'budgets', component: StubPage },
          { path: 'reports', component: StubPage },
          { path: 'data', component: StubPage },
        ]),
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('builds translated nav items for every route', () => {
    const items = component.navItems();
    expect(items.length).toBe(9);
    expect(items.map((i) => i.route)).toContain('/dashboard');
    expect(items[0].label).toBe('t:nav.dashboard');
    expect(mockTranslationService.t).toHaveBeenCalledWith('nav.dashboard');
  });

  // The label comes from the shared nav-items list (nav-items.ts), not a
  // copy local to this component — nav.budgets is the standardized key;
  // nav.budget was the sidebar's own drifted key and no longer exists.
  it('labels the budgets item from the shared list, under the standardized key', () => {
    const items = component.navItems();
    const budgets = items.find((i) => i.route === '/budgets');
    expect(budgets?.labelKey).toBe('nav.budgets');
    expect(budgets?.label).toBe('t:nav.budgets');
    expect(mockTranslationService.t).toHaveBeenCalledWith('nav.budgets');
  });

  // The bottom nav deliberately does not carry this one: it is at five slots
  // including the centre action, and a sixth crowds the labels on a phone.
  it('is the only nav that reaches the data hub', () => {
    expect(component.navItems().map((i) => i.route)).toContain('/data');
  });

  // The phone layout renders the bottom nav beside this one, and two
  // unnamed navigation landmarks announce identically in a landmark list.
  it('names its landmark, apart from the bottom nav', () => {
    const nav = fixture.nativeElement.querySelector('nav') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('t:nav.landmarkMain');
    expect(mockTranslationService.t).toHaveBeenCalledWith('nav.landmarkMain');
  });

  /**
   * The active route reached assistive tech as a CSS class and nothing else,
   * so every link announced identically (#274, ADR 0055). Here the attribute
   * comes from MatListItem's own host binding, driven by [activated] — which
   * is why binding [attr.aria-current] in the template would not have worked.
   */
  describe('the current route', () => {
    async function goTo(url: string): Promise<void> {
      await TestBed.inject(Router).navigateByUrl(url);
      fixture.detectChanges();
    }

    /** Routes rather than label text: the row's text carries the icon
     *  ligature too, and the route is what the mark is actually about. */
    function marked(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('a.nav-item[aria-current="page"]'),
        (el) => (el as HTMLAnchorElement).getAttribute('href') ?? '',
      );
    }

    it('marks the current link, and only it', async () => {
      await goTo('/budgets');
      expect(marked()).toEqual(['/budgets']);

      // Moving the mark is the part a static attribute would fail.
      await goTo('/data');
      expect(marked()).toEqual(['/data']);
    });

    it('marks nothing on a route no link owns', async () => {
      await goTo('/dashboard/detail');
      expect(marked()).toEqual([]);
    });

    it('emits the attribute as page rather than true', async () => {
      // MatListItem only answers 'page' when the host is an anchor; these
      // rows are anchors, and a plain boolean would be the wrong token.
      await goTo('/reports');
      const active = fixture.nativeElement.querySelector('a.nav-item[aria-current]') as HTMLElement;
      expect(active.getAttribute('aria-current')).toBe('page');
    });
  });

  // The current page's row is the marker on every desktop route: its label
  // and icon sit on --surface-active, a mid indigo in dark.
  describe('colours, as painted', () => {
    /** What `color: var(token)` computes to under the theme on <html> now. */
    function tokenValue(token: string): string {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      try {
        return getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
    }

    /** `node` is painted in `token`, and reads at `floor` or better on what is painted behind it. */
    function expectPainted(node: Element | null, token: string, label: string, floor = 4.5): void {
      expect(node).withContext(label).toBeTruthy();
      if (!node) return;
      settleAnimations(document);
      expect(getComputedStyle(node).color).withContext(label).toBe(tokenValue(token));
      expect(ratio(paintedColor(node), paintedBackground(node)))
        .withContext(`${label} on what it sits on`)
        .toBeGreaterThanOrEqual(floor);
    }

    it("paints the current page's label and icon in --color-primary-text, the label at AA and the icon at 3:1 on its row, in both themes", async () => {
      await TestBed.inject(Router).navigateByUrl('/budgets');
      fixture.detectChanges();
      const row = fixture.nativeElement.querySelector('a.nav-item.active') as HTMLElement | null;
      expect(row).withContext('the current page row').toBeTruthy();

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          expectPainted(row?.querySelector('span[matListItemTitle]') ?? null, '--color-primary-text', `${theme} current page label`);
          expectPainted(row?.querySelector('mat-icon') ?? null, '--color-primary-text', `${theme} current page icon`, 3);
        });
      }
    });
  });

  it('emits when a nav item is clicked', () => {
    const spy = jasmine.createSpy('navItemClicked');
    component.navItemClicked.subscribe(spy);
    component.onNavClick();
    expect(spy).toHaveBeenCalled();
  });
});
