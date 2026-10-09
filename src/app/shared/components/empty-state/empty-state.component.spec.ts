import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EmptyStateComponent } from './empty-state.component';
import {
  iconBox,
  iconSquare,
  paintedBackground,
  paintedColor,
  ratio,
  withTheme,
} from '../../../core/services/testing';

describe('EmptyStateComponent', () => {
  let component: EmptyStateComponent;
  let fixture: ComponentFixture<EmptyStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyStateComponent, NoopAnimationsModule],
    }).compileComponents();

    fixture = TestBed.createComponent(EmptyStateComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'No data');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes a polite live region', () => {
    const root = fixture.nativeElement.querySelector('div');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });

  it('renders the title inside the live region', () => {
    const root = fixture.nativeElement.querySelector('[role="status"]');
    expect(root.textContent).toContain('No data');
  });

  it('titles itself with a third-level heading unless told another level', () => {
    const headings = (): string[] =>
      Array.from(fixture.nativeElement.querySelectorAll('h1, h2, h3, h4, h5, h6') as NodeListOf<Element>)
        .map(heading => `${heading.tagName}:${heading.textContent?.trim()}`);
    expect(headings()).toEqual(['H3:No data']);

    for (const level of [2, 4] as const) {
      fixture.componentRef.setInput('headingLevel', level);
      fixture.detectChanges();
      expect(headings()).toEqual([`H${level}:No data`]);
    }
  });

  it('emits action when the button is clicked', () => {
    fixture.componentRef.setInput('actionLabel', 'Add');
    fixture.detectChanges();

    const spy = jasmine.createSpy('action');
    component.action.subscribe(spy);
    fixture.nativeElement.querySelector('button').click();
    expect(spy).toHaveBeenCalled();
  });

  it('uses md padding by default and sm padding when size=sm', () => {
    const root = (): HTMLElement => fixture.nativeElement.querySelector('[role="status"]');
    expect(root().classList).toContain('py-12');
    expect(root().classList).not.toContain('py-6');

    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();
    expect(root().classList).toContain('py-6');
    expect(root().classList).not.toContain('py-12');
  });

  // A glyph fills its box only when its line box is its font size, so the
  // circle that centres the box centres the glyph.
  it('sizes its icon at --text-4xl, and --text-2xl when size=sm, its box and line box the same', () => {
    const icon = (): HTMLElement => fixture.nativeElement.querySelector('mat-icon');
    expect(iconBox(icon())).withContext('md').toEqual(iconSquare('--text-4xl'));

    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();
    expect(iconBox(icon())).withContext('sm').toEqual(iconSquare('--text-2xl'));
  });

  describe('colours', () => {
    /**
     * A colour no token holds. A utility Tailwind never generated leaves the
     * text inheriting it, rather than the body's own --text-primary, which
     * would otherwise pass the title's row.
     */
    const SENTINEL = 'rgb(1, 2, 3)';
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      host.style.color = SENTINEL;
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    /** What `color: var(token)` computes to under the palette on <html> now. */
    function tokenColour(token: string): string {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      try {
        return getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
    }

    it('paints the icon at AA or better on its circle, at both sizes, in both themes', () => {
      for (const size of ['md', 'sm'] as const) {
        fixture.componentRef.setInput('size', size);
        fixture.detectChanges();
        const icon = host.querySelector('mat-icon') as HTMLElement;
        const circle = icon.parentElement as HTMLElement;
        for (const theme of ['light', 'dark'] as const) {
          withTheme(theme, () => {
            expect(ratio(paintedColor(icon), paintedBackground(circle)))
              .withContext(`${theme} ${size} icon on its circle`)
              .toBeGreaterThanOrEqual(4.5);
          });
        }
      }
    });

    it('paints the title and the description in the theme text tokens, in both themes', () => {
      fixture.componentRef.setInput('description', 'Nothing here yet');
      fixture.detectChanges();
      const title = host.querySelector('h3') as HTMLElement;
      const description = host.querySelector('p') as HTMLElement;
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          expect(getComputedStyle(title).color)
            .withContext(`${theme} title`)
            .toBe(tokenColour('--text-primary'));
          expect(getComputedStyle(description).color)
            .withContext(`${theme} description`)
            .toBe(tokenColour('--text-muted'));
        });
      }
    });
  });
});
