// Regression net for stripProviderKeys() (#424): proves the helper actually
// deletes the build-time environment's provider key, and that a real
// GeminiService constructed after it runs stays silent and unconfigured no
// matter what key the machine running this suite carries. See
// provider-keys.ts for the full mechanism this guards.
//
// Runs only under the emulators:
//   npm run smoke
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { CategoryService } from '../category.service';
import { CurrencyService } from '../currency.service';
import { TranslationService } from '../translation.service';
import { GeminiService } from '../gemini.service';
import { environment } from '../../../../environments/environment';
import { silenceFirebaseWarnings } from './silence-firebase-warnings';
import { stripProviderKeys } from './provider-keys';

silenceFirebaseWarnings();
stripProviderKeys();

describe('provider keys (emulator smoke test)', () => {
  it('deletes geminiApiKey from the build-time environment', () => {
    expect('geminiApiKey' in environment).toBeFalse();
  });

  it('constructs a real GeminiService that logs nothing and reports no provider', async () => {
    // CloudLLMProviderBase reads these three in field initializers
    // (cloud-llm-provider.base.ts:108-110), so a real injector needs all
    // three answered before GeminiService's constructor can run at all.
    const categoryService = jasmine.createSpyObj<CategoryService>('CategoryService', ['categories']);
    categoryService.categories.and.returnValue([]);
    const currencyService = jasmine.createSpyObj<CurrencyService>('CurrencyService', ['convert', 'formatAmount']);
    currencyService.convert.and.callFake((amount: number) => amount);
    currencyService.formatAmount.and.callFake((amount: number) => amount.toFixed(2));
    const translationService = jasmine.createSpyObj<TranslationService>('TranslationService', ['t', 'currentLocale']);
    translationService.t.and.callFake((key: string) => key);
    translationService.currentLocale.and.returnValue('en');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: CategoryService, useValue: categoryService },
        { provide: CurrencyService, useValue: currencyService },
        { provide: TranslationService, useValue: translationService },
      ],
    });

    const logSpy = spyOn(console, 'log');
    const gemini = TestBed.inject(GeminiService);

    // The constructor's initializeGemini() is fire-and-forget
    // (gemini.service.ts:68) — give its microtasks a turn before asserting
    // on what it did.
    await new Promise(resolve => setTimeout(resolve, 0));

    const geminiLines = logSpy.calls
      .all()
      .filter(call => call.args.some(arg => typeof arg === 'string' && arg.includes('[GeminiService]')));
    expect(geminiLines).withContext('no [GeminiService] console.log line').toEqual([]);
    expect(gemini.isAvailable()).toBeFalse();
    expect(gemini.isAvailableSignal()).toBeFalse();
  });
});
