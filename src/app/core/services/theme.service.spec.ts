import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let mockDocument: Document;
  let mockHtmlElement: HTMLElement;

  beforeEach(() => {
    mockHtmlElement = {
      classList: {
        add: jasmine.createSpy('add'),
        remove: jasmine.createSpy('remove')
      }
    } as unknown as HTMLElement;

    mockDocument = {
      documentElement: mockHtmlElement
    } as Document;

    TestBed.configureTestingModule({
      providers: [
        ThemeService,
        { provide: DOCUMENT, useValue: mockDocument }
      ]
    });

    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should default to system theme', () => {
      expect(service.theme()).toBe('system');
    });

    it('should have an effective theme', () => {
      const theme = service.effectiveTheme();
      expect(['light', 'dark']).toContain(theme);
    });
  });

  describe('setTheme', () => {
    it('should set theme to light', () => {
      service.setTheme('light');
      expect(service.theme()).toBe('light');
      expect(service.effectiveTheme()).toBe('light');
    });

    it('should set theme to dark', () => {
      service.setTheme('dark');
      expect(service.theme()).toBe('dark');
      expect(service.effectiveTheme()).toBe('dark');
    });

    it('should set theme to system', () => {
      service.setTheme('dark');
      service.setTheme('system');
      expect(service.theme()).toBe('system');
    });
  });

  describe('init', () => {
    it('should initialize with saved theme', () => {
      service.init('dark');
      expect(service.theme()).toBe('dark');
    });

    it('should keep default if no saved theme', () => {
      service.init(undefined);
      expect(service.theme()).toBe('system');
    });
  });

  describe('toggle', () => {
    it('should toggle from light to dark', () => {
      service.setTheme('light');
      service.toggle();
      expect(service.theme()).toBe('dark');
    });

    it('should toggle from dark to light', () => {
      service.setTheme('dark');
      service.toggle();
      expect(service.theme()).toBe('light');
    });
  });

  describe('isDark', () => {
    it('should return true when dark theme', () => {
      service.setTheme('dark');
      expect(service.isDark()).toBeTrue();
    });

    it('should return false when light theme', () => {
      service.setTheme('light');
      expect(service.isDark()).toBeFalse();
    });
  });

});
