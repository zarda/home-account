import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChartThemeService } from './chart-theme.service';
import { ThemeService } from './theme.service';
import { AccessibilityService } from './accessibility.service';

describe('ChartThemeService', () => {
  let service: ChartThemeService;
  let themeService: ThemeService;
  let reducedMotion: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    reducedMotion = signal(false);

    TestBed.configureTestingModule({
      providers: [{ provide: AccessibilityService, useValue: { reducedMotion } }],
    });
    service = TestBed.inject(ChartThemeService);
    themeService = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('palette', () => {
    it('should provide non-empty colors and the PT Sans stack', () => {
      const palette = service.palette();

      expect(palette.text).not.toBe('');
      expect(palette.textMuted).not.toBe('');
      expect(palette.grid).not.toBe('');
      expect(palette.fontFamily).toContain('PT Sans');
    });

    it('should recompute when the effective theme flips', () => {
      themeService.setTheme('light');
      const before = service.palette();

      themeService.setTheme('dark');
      const after = service.palette();

      // New snapshot object per flip — ng2-charts sees an options change.
      expect(after).not.toBe(before);
    });

    it('should not recompute while the theme is unchanged', () => {
      themeService.setTheme('light');
      const first = service.palette();
      const second = service.palette();

      expect(second).toBe(first);
    });
  });

  describe('option partials', () => {
    it('axis() should color ticks and grid from the palette', () => {
      const palette = service.palette();
      const axis = service.axis();

      expect(axis.ticks.color).toBe(palette.textMuted);
      expect(axis.ticks.font.family).toBe(palette.fontFamily);
      expect(axis.grid.color).toBe(palette.grid);
    });

    it('legendLabels() should color legend text from the palette', () => {
      const palette = service.palette();
      const labels = service.legendLabels();

      expect(labels.color).toBe(palette.text);
      expect(labels.font.family).toBe(palette.fontFamily);
    });
  });

  describe('animation', () => {
    it('runs a 400ms animation when the accessibility signal is not reduced', () => {
      reducedMotion.set(false);

      expect(service.animation()).toEqual({ duration: 400 });
    });

    it('disables animation when the accessibility signal prefers reduced motion', () => {
      reducedMotion.set(true);

      expect(service.animation()).toBeFalse();
    });
  });
});
