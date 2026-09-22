import { signal } from '@angular/core';
import type { LocaleDateStyle } from '../locale-format.service';

/**
 * Stubs for the two services every rendered template reaches.
 *
 * `TranslatePipe` is imported by every component template in the app, and it
 * injects `TranslationService`, which injects `HttpClient`. A describe that
 * renders a real template and provides neither throws `NullInjectorError`
 * before the first binding resolves, which is why the stubbed-template
 * describes exist at all.
 *
 * A `jasmine.createSpyObj('TranslationService', ['t'])` is not enough:
 * `translate.pipe.ts:38-44` reads `currentLocale` and `translationsVersion`
 * as part of its memo key. The reads are guarded, so a spy object does not
 * throw — but the pipe then memoizes under `undefined` for both, and a spec
 * that switches locale mid-render sees the stale value. These stubs hand the
 * pipe real signals so the cache key behaves the way production's does.
 */

/** The half of `TranslationService` a rendering template touches. */
export interface TranslationStub {
  t: (key: string, params?: Record<string, string | number>) => string;
  currentLocale: ReturnType<typeof signal<string>>;
  translationsVersion: ReturnType<typeof signal<number>>;
}

/**
 * A `TranslationService` a real template can render against.
 *
 * `t` echoes the key, and echoes the params beside it when there are any, so
 * an assertion can name the whole rendered label rather than a prefix — the
 * shape `transaction-preview-table.component.spec.ts:1043-1050` hand-rolled
 * first. Pass `overrides` to pin a specific key's copy, or to swap `t`
 * outright for a spy.
 */
export function createTranslationStub(overrides: Partial<TranslationStub> = {}): TranslationStub {
  return {
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    currentLocale: signal('en'),
    translationsVersion: signal(0),
    ...overrides,
  };
}

/** The half of `LocaleFormatService` the two locale pipes call. */
export interface LocaleFormatStub {
  formatDate: (value: unknown, style?: LocaleDateStyle) => string;
  formatRange: (start: unknown, end: unknown, style?: LocaleDateStyle) => string;
  formatNumber: (value: number | null | undefined, digitsInfo?: string) => string;
}

/**
 * A `LocaleFormatService` for templates carrying `localeDate` or
 * `localeNumber` — a third of the templates this suite renders.
 *
 * Deliberately not `Intl`: the output is stable text a spec can assert
 * whole, and it does not move when a Node or ICU upgrade changes a
 * separator. A date formats as its ISO day, a range as the two joined by an
 * en dash, and a number as `String(value)`. An absent or unparseable value
 * formats as the empty string, which is the real service's contract
 * (`locale-format.service.ts:80-85`) and the one behaviour a template can
 * actually depend on.
 */
export function createLocaleFormatStub(overrides: Partial<LocaleFormatStub> = {}): LocaleFormatStub {
  const asDate = (value: unknown): Date | null => {
    if (value === null || value === undefined) return null;
    const date =
      (value as { toDate?: () => Date })?.toDate?.() ??
      (value instanceof Date ? value : new Date(value as string | number));
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const formatDate = (value: unknown): string => asDate(value)?.toISOString().slice(0, 10) ?? '';

  return {
    formatDate,
    formatRange: (start: unknown, end: unknown) => {
      const a = asDate(start);
      const b = asDate(end);
      if (!a || !b) return '';
      const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
      return `${formatDate(from)}–${formatDate(to)}`;
    },
    formatNumber: (value: number | null | undefined) =>
      value === null || value === undefined || !Number.isFinite(value) ? '' : String(value),
    ...overrides,
  };
}
