import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  paintedBackground,
  paintedColor,
  ratio,
  tokenValue,
  withTheme,
} from '../../../core/services/testing/painted-contrast';
import { expectHeadingsInOrder, provideNoMotion } from '../../../core/services/testing';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let mockAuthService: {
    signInWithGoogle: jasmine.Spy;
  };
  let mockRouter: {
    navigate: jasmine.Spy;
  };
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  beforeEach(async () => {
    mockAuthService = {
      signInWithGoogle: jasmine.createSpy('signInWithGoogle').and.returnValue(Promise.resolve())
    };

    mockRouter = {
      navigate: jasmine.createSpy('navigate')
    };

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => {
      const translations: Record<string, string> = {
        'auth.signIn': 'Sign in with Google',
        'auth.signInCancelled': 'Sign-in was cancelled. Please try again.',
        'auth.networkError': 'Network error. Please check your connection.',
        'auth.signInFailed': 'Failed to sign in. Please try again.',
        'app.title': 'Home Account'
      };
      return translations[key] || key;
    });

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
        { provide: TranslationService, useValue: mockTranslationService },
        provideNoMotion()
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display app title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    // Check for translation key or translated text
    expect(compiled.textContent?.includes('Home Account') || compiled.textContent?.includes('app.title')).toBe(true);
  });

  it('should display sign in button', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    // Check for translation key or translated text
    expect(compiled.textContent?.includes('Sign in with Google') || compiled.textContent?.includes('auth.signInWithGoogle')).toBe(true);
  });

  it('should have loading state initially false', () => {
    expect(component.isLoading()).toBe(false);
  });

  it('should have no error initially', () => {
    expect(component.error()).toBeNull();
  });

  
  describe('signInWithGoogle', () => {
    it('should set loading state when signing in', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      );

      const signInPromise = component.signInWithGoogle();

      expect(component.isLoading()).toBe(true);

      await signInPromise;
    });

    it('should call AuthService.signInWithGoogle', async () => {
      await component.signInWithGoogle();

      expect(mockAuthService.signInWithGoogle).toHaveBeenCalled();
    });

    it('should navigate to dashboard on successful sign-in', async () => {
      await component.signInWithGoogle();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should set error when sign-in is cancelled', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Sign-in was cancelled. Please try again.');
    });

    it('should set error on network failure', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/network-request-failed' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Network error. Please check your connection.');
    });

    it('should set generic error for unknown errors', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/unknown-error' })
      );

      await component.signInWithGoogle();

      expect(component.error()).toBe('Failed to sign in. Please try again.');
    });

    it('should clear previous error on new sign in attempt', async () => {
      // First, set an error
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );
      await component.signInWithGoogle();
      expect(component.error()).not.toBeNull();

      // Then try again successfully
      mockAuthService.signInWithGoogle.and.returnValue(Promise.resolve());
      await component.signInWithGoogle();

      expect(component.error()).toBeNull();
    });

    it('should reset loading state on error', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();

      expect(component.isLoading()).toBe(false);
    });
  });

  describe('UI interactions', () => {
    it('should disable button while loading', fakeAsync(() => {
      mockAuthService.signInWithGoogle.and.returnValue(
        new Promise<void>(resolve => setTimeout(() => resolve(), 100))
      );

      component.signInWithGoogle();
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button[mat-raised-button]');
      expect(button.disabled).toBe(true);
      // The visible "Loading..." label beside it already announces the
      // state, so the spinner itself stays out of the accessibility tree.
      expect(button.querySelector('mat-spinner').getAttribute('aria-hidden')).toBe('true');

      tick(100);
      fixture.detectChanges();

      // Button stays disabled because redirect doesn't reset loading in normal flow
      // Only errors reset the loading state
    }));

    it('should display error message when error exists', async () => {
      mockAuthService.signInWithGoogle.and.returnValue(
        Promise.reject({ code: 'auth/user-cancelled' })
      );

      await component.signInWithGoogle();
      fixture.detectChanges();

      const errorDiv = fixture.nativeElement.querySelector('.error-message');
      expect(errorDiv).toBeTruthy();
      expect(errorDiv.textContent).toContain('Sign-in was cancelled');
    });
  });

  /**
   * /login is a page of its own, outside the shell, and its title is the only
   * words that say where the reader is. A reader who moves by headings found
   * none there: the title was a plain mat-card-title.
   */
  describe('its heading (real template)', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const title = () => host().querySelector('.mat-mdc-card-title') as HTMLElement | null;

    /** What a reader sees of a title: its type and its spacing, and its colour. */
    function look(el: Element) {
      const style = getComputedStyle(el);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].join(' '),
        color: style.color,
      };
    }

    it("has exactly one h1, and it is the app's title", async () => {
      const h1s = Array.from(host().querySelectorAll('h1'));

      expect(h1s.length).withContext('the h1s on the page').toBe(1);
      // The page asked for the title's key, and its h1 reads the words it was
      // given for it.
      expect(mockTranslationService.t).toHaveBeenCalledWith('app.title', undefined);
      expect(h1s[0]?.textContent?.trim()).toBe(mockTranslationService.t('app.title'));
      expect(h1s[0]).withContext('the h1 is the card title').toBe(title() as HTMLHeadingElement);
      await expectHeadingsInOrder(host(), 'the sign-in page');
    });

    /** The look of a mat-card-title twin put in the heading's place, then taken out again. */
    function twinLook(heading: HTMLElement) {
      const twin = document.createElement('mat-card-title');
      for (const attr of Array.from(heading.attributes)) twin.setAttribute(attr.name, attr.value);
      twin.textContent = heading.textContent;
      heading.replaceWith(twin);
      try {
        return look(twin);
      } finally {
        twin.replaceWith(heading);
      }
    }

    /**
     * The title became its heading with nothing redrawn: an h1 draws what the
     * mat-card-title drew. That claim is read from a mat-card-title twin put in
     * the h1's place, so a rule that reaches an h1 and not the card title (an
     * element selector in the component's stylesheet, Tailwind's preflight,
     * Material's own) fails here. Mutation: an `h1 { margin-bottom: 1rem }` in
     * login.component.scss.
     *
     * The pinned figures, 24px / 700 / 32px with a 16px top margin, are what
     * Karma's sheet order gives, not what the app shows. Karma's page links the
     * global stylesheet in its body, after the sheets components add to the
     * head, so the template's utilities win over the card's own rule. The
     * built app links the global sheet in the head, before them, so the card's
     * sheet wins: there the same h1, and a twin beside it, read 22px / 400 /
     * 28px with no margin. The twin comparison holds in both orders; the next
     * case reads it in the app's.
     */
    it("keeps its title's look, in both themes", () => {
      const heading = title();
      expect(heading).withContext('the card title').toBeTruthy();
      if (!heading) return;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          const drawn = look(heading);
          expect({ ...drawn, color: undefined })
            .withContext(`${theme}: the title's type and spacing in Karma's sheet order, utilities last`)
            .toEqual({ fontSize: '24px', fontWeight: '700', lineHeight: '32px', margin: '16px 0px 0px 0px', color: undefined });
          expect(drawn.color).withContext(`${theme}: the title's colour`).toBe(tokenValue('--text-primary'));
          expect(drawn).withContext(`${theme}: the same title drawn as a mat-card-title`).toEqual(twinLook(heading));
        });
      }
    });

    /**
     * The same claim in the app's sheet order. The real sheet that holds the
     * card title's rule is moved after the one that holds the utilities, as
     * the built app orders them, both elements are read again, and the sheet
     * goes back where it was. The figures are then the card's own, as read in
     * the running app, and the h1 still draws what its twin draws. Mutations:
     * the same `h1 { margin-bottom: 1rem }`; leaving the sheet where Karma put
     * it fails the figures.
     */
    it("keeps its title's look in the app's sheet order, in both themes", () => {
      const heading = title();
      expect(heading).withContext('the card title').toBeTruthy();
      if (!heading) return;

      const sheetsHolding = (selector: string): Element[] =>
        Array.from(document.styleSheets)
          .filter(sheet => {
            try {
              return Array.from(sheet.cssRules).some(rule => rule instanceof CSSStyleRule && rule.selectorText === selector);
            } catch {
              // A sheet from another origin keeps its rules to itself.
              return false;
            }
          })
          .map(sheet => sheet.ownerNode as Element);
      const cardSheets = sheetsHolding('.mat-mdc-card-title');
      const utilitySheets = sheetsHolding('.text-2xl');
      expect(cardSheets.length).withContext("the sheets that hold the card title's rule").toBeGreaterThan(0);
      expect(utilitySheets.length).withContext('the sheets that hold the utilities').toBeGreaterThan(0);
      if (cardSheets.length === 0 || utilitySheets.length === 0) return;

      const sheetOrder = () => Array.from(document.styleSheets).map(sheet => sheet.ownerNode);
      const karmaOrder = sheetOrder();
      const places = cardSheets.map(node => ({ node, parent: node.parentNode!, next: node.nextSibling }));
      utilitySheets[utilitySheets.length - 1].after(...cardSheets);
      try {
        for (const theme of ['light', 'dark'] as const) {
          withTheme(theme, () => {
            const drawn = look(heading);
            expect({ ...drawn, color: undefined })
              .withContext(`${theme}: the title's type and spacing in the app's sheet order, the card's own`)
              .toEqual({ fontSize: '22px', fontWeight: '400', lineHeight: '28px', margin: '0px 0px 0px 0px', color: undefined });
            expect(drawn.color).withContext(`${theme}: the title's colour`).toBe(tokenValue('--text-primary'));
            expect(drawn).withContext(`${theme}: the same title drawn as a mat-card-title`).toEqual(twinLook(heading));
          });
        }
      } finally {
        for (const { node, parent, next } of places.reverse()) parent.insertBefore(node, next);
      }
      const restored = sheetOrder();
      expect(restored.length === karmaOrder.length && restored.every((node, i) => node === karmaOrder[i]))
        .withContext("the page's sheets, back in Karma's order")
        .toBeTrue();
    });
  });

  describe('colours', () => {
    /**
     * The glass card is translucent over the page's gradient, which the
     * painted-contrast walk cannot read. So the gradient's own stops, read
     * from the computed style, are laid under the card one at a time as a
     * flat fill: the text has to read wherever the gradient shows through.
     */
    function gradientStops(container: HTMLElement): string[] {
      return getComputedStyle(container).backgroundImage.match(/rgba?\([^)]*\)/g) ?? [];
    }

    function expectReadableOverEveryStop(selector: string, theme: 'light' | 'dark'): void {
      const host = fixture.nativeElement as HTMLElement;
      const container = host.querySelector('.login-container') as HTMLElement;
      const text = host.querySelector(selector) as HTMLElement;
      const stops = gradientStops(container);
      expect(stops.length).withContext(`${theme} gradient stops behind the card`).toBeGreaterThanOrEqual(2);
      for (const stop of stops) {
        container.style.backgroundColor = stop;
        try {
          expect(ratio(paintedColor(text), paintedBackground(text)))
            .withContext(`${theme} ${selector} over the glass card on ${stop}`)
            .toBeGreaterThanOrEqual(4.5);
        } finally {
          container.style.backgroundColor = '';
        }
      }
    }

    it('paints the subtitle at AA or better over the glass card, through its own fade, in both themes', () => {
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => expectReadableOverEveryStop('mat-card-subtitle', theme));
      }
    });

    it('paints the title, the sign-in line and the terms notice at AA or better over the glass card, in both themes', () => {
      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          for (const selector of ['.mat-mdc-card-title', 'mat-card-content > p', 'mat-card-footer']) {
            expectReadableOverEveryStop(selector, theme);
          }
        });
      }
    });
  });
});
