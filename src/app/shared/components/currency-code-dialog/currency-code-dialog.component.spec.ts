import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';

import { CurrencyCodeDialogComponent } from './currency-code-dialog.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing/translation-stub';

// Rendered from the start (ADR 0144): the refusals are template facts — a
// mat-error only shows once the field is in its error state — so a suite
// that blanked the template would prove the validator and nothing a
// reviewer sees.
describe('CurrencyCodeDialogComponent', () => {
  let fixture: ComponentFixture<CurrencyCodeDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CurrencyCodeDialogComponent, string>>;
  let canRepresentCurrency: jasmine.Spy<(code: string) => boolean>;

  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector('input') as HTMLInputElement;
  const confirmButton = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;
  const cancelButton = () => el().querySelector('.cancel-button') as HTMLButtonElement;
  const errors = () =>
    Array.from(el().querySelectorAll('mat-error')).map(node => node.textContent?.trim());

  /** Types a code and presses the dialog's own confirm. */
  function enter(value: string): void {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    confirmButton().click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    canRepresentCurrency = jasmine.createSpy('canRepresentCurrency').and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CurrencyCodeDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: CurrencyService, useValue: { canRepresentCurrency } },
        { provide: TranslationService, useValue: createTranslationStub() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CurrencyCodeDialogComponent);
    fixture.detectChanges();
  });

  it('titles itself and names its field', () => {
    expect(el().querySelector('[mat-dialog-title]')?.textContent?.trim()).toBe('currency.enterCode');
    expect(el().querySelector('mat-label')?.textContent?.trim()).toBe('settings.currency');
    expect(errors()).withContext('nothing refused before anything is entered').toEqual([]);
  });

  it('accepts ISK and closes with it', () => {
    enter('ISK');

    expect(dialogRef.close).toHaveBeenCalledOnceWith('ISK');
    expect(canRepresentCurrency).toHaveBeenCalledWith('ISK');
    expect(errors()).toEqual([]);
  });

  it('closes with the code in capitals, whatever case it was typed in', () => {
    enter(' isk ');

    expect(dialogRef.close).toHaveBeenCalledOnceWith('ISK');
  });

  it('refuses XYZ, which is shaped like a code but is not in the runtime\'s ISO table', () => {
    enter('XYZ');

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(errors()).toEqual(['currency.invalidCode']);
    expect(canRepresentCurrency)
      .withContext('the rate table is not asked about a code that is not one')
      .not.toHaveBeenCalledWith('XYZ');
  });

  it('refuses isk1, which is not code-shaped at all', () => {
    enter('isk1');

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(errors()).toEqual(['currency.invalidCode']);
  });

  it('refuses a real code the loaded rates cannot convert, and says so', () => {
    // getExchangeRate's `?? 1` would book an unknown code 1:1 against the
    // base currency, so a valid code with no rate is refused, not stored.
    canRepresentCurrency.and.callFake(code => code !== 'ISK');

    enter('ISK');

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(errors()).toEqual(['currency.noRateYet:{"code":"ISK"}']);
  });

  it('asks the rate table again on confirm, so rates that landed while it was open count', () => {
    canRepresentCurrency.and.returnValue(false);
    enter('ISK');
    expect(dialogRef.close).not.toHaveBeenCalled();

    canRepresentCurrency.and.returnValue(true);
    confirmButton().click();
    fixture.detectChanges();

    expect(dialogRef.close).toHaveBeenCalledOnceWith('ISK');
  });

  it('closes with nothing from cancel', () => {
    input().value = 'ISK';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    cancelButton().click();

    expect(dialogRef.close).toHaveBeenCalledOnceWith(undefined);
  });
});
