import { EnvironmentProviders, Provider, WritableSignal, computed, signal } from '@angular/core';
import { provideAppDatepicker } from '../../config/datepicker.config';
import { User } from '../../../models';
import { AuthService } from '../auth.service';
import { DATE_FORMAT_AUTO } from '../date-format.service';
import { SupportedLocale, TranslationService } from '../translation.service';
import { createMockUser } from './mock-auth.service';
import { TranslationStub, createTranslationStub } from './translation-stub';

/** The reader a spec's pickers follow, as signals the spec owns and writes. */
export interface AppDatepickerReader {
  /** The date format the signed-in account stored. `auto`, the default, follows the language. */
  dateFormat?: WritableSignal<string>;
  /** The language the reader chose. English by default. */
  locale?: WritableSignal<SupportedLocale>;
  /** The catalog's text, for a spec that pins its own labels. Echoes the key by default. */
  t?: TranslationStub['t'];
}

/**
 * The app's datepicker providers, over a reader a spec can change mid-case:
 * write `locale` or `dateFormat`, then flush the adapter's effect to let it
 * follow, as it follows the real services in the app. `TestBed.tick()`
 * flushes it for an adapter the spec injected itself. Once a picker has
 * rendered, it built the adapter inside the Angular zone, and
 * `fixture.detectChanges()` flushes the effect there; `TestBed.tick()` from
 * the spec body would enter the zone mid-tick and report NG0101.
 *
 * The adapter reads the account's format through `DateFormatService`, which
 * injects `AuthService`, and the language through `TranslationService`; both
 * real services need Firebase or HTTP, so this hands each a stub. The signed-in
 * user is a premium account, which leaves usage analytics off by default, so a
 * real `AnalyticsService` that a rendered component brings in stays quiet. The
 * stub's `getIntlLocale` is the real method run against the spec's signal, so
 * the table from a language to its Intl tag keeps one copy.
 */
export function provideAppDatepickerForTests({
  dateFormat = signal(DATE_FORMAT_AUTO),
  locale = signal<SupportedLocale>('en'),
  t,
}: AppDatepickerReader = {}): (Provider | EnvironmentProviders)[] {
  const translation = createTranslationStub({ currentLocale: locale, ...(t ? { t } : {}) });
  const currentUser = computed<User>(() => {
    const user = createMockUser();
    return { ...user, subscription: { tier: 'premium' }, preferences: { ...user.preferences, dateFormat: dateFormat() } };
  });

  return [
    provideAppDatepicker(),
    { provide: AuthService, useValue: { currentUser, isLoading: signal(false) } },
    {
      provide: TranslationService,
      useValue: {
        ...translation,
        getIntlLocale: () => TranslationService.prototype.getIntlLocale.call(translation as unknown as TranslationService),
      },
    },
  ];
}
