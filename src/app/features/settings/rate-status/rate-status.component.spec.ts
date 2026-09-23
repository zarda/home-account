import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { RateStatusComponent } from './rate-status.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { LocaleFormatService } from '../../../core/services/locale-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { RateSource } from '../../../models';

describe('RateStatusComponent', () => {
  let fixture: ComponentFixture<RateStatusComponent>;
  let rateSource: ReturnType<typeof signal<RateSource | null>>;
  let lastUpdated: ReturnType<typeof signal<Date | null>>;
  let dateFormat: jasmine.SpyObj<DateFormatService>;
  let localeFormat: jasmine.SpyObj<LocaleFormatService>;
  let translation: jasmine.SpyObj<TranslationService>;

  const STAMP = new Date(2026, 11, 31);
  const FORMATTED_STAMP = '31/12/2026';
  const FORMATTED_TIME = '14:30';

  /**
   * What the panel reads off CurrencyService, and nothing else. The real
   * service is root-provided and walks the rate ladder from its constructor,
   * which reaches fetch — never let a unit spec build it.
   *
   * The two fresh rungs share a line on purpose: both mean a table under
   * the cache window, so only the two that lost the provider differ.
   */
  const RUNGS: { source: RateSource; key: string; stale: boolean; dated: boolean }[] = [
    { source: 'live', key: 'settings.ratesLive', stale: false, dated: true },
    { source: 'cached', key: 'settings.ratesLive', stale: false, dated: true },
    { source: 'expired', key: 'settings.ratesExpired', stale: true, dated: true },
    { source: 'fallback', key: 'settings.ratesBuiltIn', stale: true, dated: false },
  ];

  function render(source: RateSource | null): void {
    rateSource.set(source);
    fixture.detectChanges();
  }

  function line(): HTMLElement | null {
    return fixture.nativeElement.querySelector('.rate-line');
  }

  beforeEach(async () => {
    rateSource = signal<RateSource | null>(null);
    lastUpdated = signal<Date | null>(STAMP);

    dateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate']);
    dateFormat.formatDate.and.returnValue(FORMATTED_STAMP);

    localeFormat = jasmine.createSpyObj('LocaleFormatService', ['formatTime']);
    localeFormat.formatTime.and.returnValue(FORMATTED_TIME);

    // Echoes the key back, so an assertion names the string the template
    // asked for rather than whatever English happens to say today.
    translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [RateStatusComponent],
      providers: [
        { provide: CurrencyService, useValue: { rateSource, lastUpdated } },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: LocaleFormatService, useValue: localeFormat },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RateStatusComponent);
  });

  it('renders nothing until the ladder settles', () => {
    render(null);

    expect(fixture.nativeElement.querySelector('.rate-status')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('labels the panel once a rung is known', () => {
    render('live');

    expect(
      fixture.nativeElement.querySelector('.section-label')?.textContent?.trim()
    ).toBe('settings.ratesLabel');
  });

  for (const rung of RUNGS) {
    it(`renders the ${rung.source} rung's own line`, () => {
      render(rung.source);

      expect(line()?.textContent?.trim()).toBe(rung.key);
    });

    it(`${rung.stale ? 'warns on' : 'leaves plain'} the ${rung.source} rung`, () => {
      render(rung.source);

      expect(line()?.classList.contains('rate-line-stale')).toBe(rung.stale);
    });

    if (rung.dated) {
      it(`interpolates the update stamp and time into the ${rung.source} line`, () => {
        render(rung.source);

        expect(dateFormat.formatDate).toHaveBeenCalledWith(STAMP);
        expect(localeFormat.formatTime).toHaveBeenCalledWith(STAMP);
        expect(translation.t).toHaveBeenCalledWith(
          rung.key, { date: FORMATTED_STAMP, time: FORMATTED_TIME }
        );
      });
    }
  }

  // The constants rung has nothing real to date, which is why it gets a line
  // of its own rather than an empty interpolation. Asserted with a stamp
  // still on the signal, so what this proves is that the branch never reaches
  // for one — not merely that none was available.
  it('asks for no stamp or time on the fallback rung', () => {
    render('fallback');

    expect(dateFormat.formatDate).not.toHaveBeenCalled();
    expect(localeFormat.formatTime).not.toHaveBeenCalled();
    expect(line()?.textContent?.trim()).toBe('settings.ratesBuiltIn');
  });
});
