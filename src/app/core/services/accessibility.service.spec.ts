import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { AccessibilityService } from './accessibility.service';
import { DEFAULT_FONT_SCALE, DEFAULT_USER_PREFERENCES, UserPreferences } from '../../models';

describe('AccessibilityService', () => {
  let service: AccessibilityService;
  let mockDocument: Document;
  let mockHtmlElement: HTMLElement;

  const prefs = (overrides: Partial<UserPreferences>): UserPreferences => ({
    ...DEFAULT_USER_PREFERENCES,
    ...overrides,
  });

  const setSystemReducedMotion = (value: boolean) =>
    (service as unknown as { _systemReducedMotion: { set(v: boolean): void } })
      ._systemReducedMotion.set(value);

  const applyFontScale = (scale: number) =>
    (service as unknown as { applyFontScale(scale: number): void }).applyFontScale(scale);

  const applyHighContrast = (enabled: boolean) =>
    (service as unknown as { applyHighContrast(enabled: boolean): void }).applyHighContrast(enabled);

  const applyReducedMotion = (enabled: boolean) =>
    (service as unknown as { applyReducedMotion(enabled: boolean): void }).applyReducedMotion(enabled);

  beforeEach(() => {
    mockHtmlElement = {
      classList: {
        add: jasmine.createSpy('add'),
        remove: jasmine.createSpy('remove')
      },
      style: {
        setProperty: jasmine.createSpy('setProperty'),
        removeProperty: jasmine.createSpy('removeProperty')
      }
    } as unknown as HTMLElement;

    mockDocument = {
      documentElement: mockHtmlElement,
      // Nothing under test calls querySelectorAll, but TestBed teardown
      // queries the injected DOCUMENT regardless — an empty list keeps
      // that harmless (see theme.service.spec.ts for the same fallback).
      querySelectorAll: jasmine.createSpy('querySelectorAll').and.returnValue([])
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        AccessibilityService,
        { provide: DOCUMENT, useValue: mockDocument }
      ]
    });

    service = TestBed.inject(AccessibilityService);
    // Neutralize whatever prefers-reduced-motion the CI machine's real
    // browser happens to report, so "stored OR system" assertions are
    // deterministic; tests that care about the system half set it back.
    setSystemReducedMotion(false);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('defaults font scale to 1', () => {
      expect(service.fontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it('defaults high contrast to off', () => {
      expect(service.highContrast()).toBeFalse();
    });

    it('defaults reduced motion to off', () => {
      expect(service.reducedMotion()).toBeFalse();
    });

    it('defaults tab animation duration to 200ms', () => {
      expect(service.tabAnimationDuration()).toBe('200ms');
    });
  });

  describe('init', () => {
    it('resolves font scale, high contrast, and reduced motion through the user-model resolvers', () => {
      service.init(prefs({ fontScale: 1.3, highContrast: true, reducedMotion: true }));

      expect(service.fontScale()).toBe(1.3);
      expect(service.highContrast()).toBeTrue();
      expect(service.reducedMotion()).toBeTrue();
    });

    it('falls back to the default scale for an out-of-range value', () => {
      service.init(prefs({ fontScale: 2 }));

      expect(service.fontScale()).toBe(DEFAULT_FONT_SCALE);
    });

    it('resets every setting when a new account has none of the keys set (account switch)', () => {
      service.init(prefs({ fontScale: 1.3, highContrast: true, reducedMotion: true }));

      service.init(prefs({}));

      expect(service.fontScale()).toBe(DEFAULT_FONT_SCALE);
      expect(service.highContrast()).toBeFalse();
      expect(service.reducedMotion()).toBeFalse();
    });

    it('resets every setting when preferences are absent entirely', () => {
      service.init(prefs({ fontScale: 1.3, highContrast: true, reducedMotion: true }));

      service.init(undefined);

      expect(service.fontScale()).toBe(DEFAULT_FONT_SCALE);
      expect(service.highContrast()).toBeFalse();
      expect(service.reducedMotion()).toBeFalse();
    });
  });

  describe('reducedMotion', () => {
    it('is true when only the stored preference asks for it', () => {
      service.init(prefs({ reducedMotion: true }));

      expect(service.reducedMotion()).toBeTrue();
    });

    it('is true when only the system preference asks for it', () => {
      setSystemReducedMotion(true);

      expect(service.reducedMotion()).toBeTrue();
    });

    it('is false when neither the stored nor the system preference asks for it', () => {
      expect(service.reducedMotion()).toBeFalse();
    });
  });

  describe('tabAnimationDuration', () => {
    it('is 0ms when reduced motion is on', () => {
      service.init(prefs({ reducedMotion: true }));

      expect(service.tabAnimationDuration()).toBe('0ms');
    });

    it('is 200ms when reduced motion is off', () => {
      service.init(prefs({ reducedMotion: false }));

      expect(service.tabAnimationDuration()).toBe('200ms');
    });
  });

  describe('applyFontScale', () => {
    it('sets the --app-font-scale variable for a non-default scale', () => {
      applyFontScale(1.15);

      expect(mockHtmlElement.style.setProperty).toHaveBeenCalledWith('--app-font-scale', '1.15');
    });

    it('removes the --app-font-scale variable for the default scale', () => {
      applyFontScale(DEFAULT_FONT_SCALE);

      expect(mockHtmlElement.style.removeProperty).toHaveBeenCalledWith('--app-font-scale');
    });
  });

  describe('applyHighContrast', () => {
    it('adds the high-contrast class when enabled', () => {
      applyHighContrast(true);

      expect(mockHtmlElement.classList.add).toHaveBeenCalledWith('high-contrast');
    });

    it('removes the high-contrast class when disabled', () => {
      applyHighContrast(false);

      expect(mockHtmlElement.classList.remove).toHaveBeenCalledWith('high-contrast');
    });
  });

  describe('applyReducedMotion', () => {
    it('adds the reduced-motion class when enabled', () => {
      applyReducedMotion(true);

      expect(mockHtmlElement.classList.add).toHaveBeenCalledWith('reduced-motion');
    });

    it('removes the reduced-motion class when disabled', () => {
      applyReducedMotion(false);

      expect(mockHtmlElement.classList.remove).toHaveBeenCalledWith('reduced-motion');
    });
  });
});
