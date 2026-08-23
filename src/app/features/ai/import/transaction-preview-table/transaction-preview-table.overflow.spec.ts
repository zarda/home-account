import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { CategorizedImportTransaction } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { FitTextRegistry } from '../../../../shared/directives/fit-text.registry';

/**
 * The review card at the narrowest width the app supports, carrying
 * everything a receipt import can put on it.
 *
 * Every other spec on this component overrides the template away, so this is
 * the only place its own stylesheet is measured — and the card just grew a
 * currency menu, a fallen-back marker, a row of suggestion chips and a bulk
 * currency button on the header, all of which compete for room that was
 * already spoken for. Same shape as overflow-guard.spec.ts: real global
 * styles, the probe attached to the document because only an attached element
 * has a layout box, and a fixed container width so nothing depends on the
 * size of the browser window running the test.
 *
 * Containment is asserted on width alone. `.transactions-list` is a
 * deliberate vertical scroller, so a card taller than its 70dvh fold is
 * reachable by scrolling and hides nothing — and the card's height here is an
 * artefact anyway, since the media query that stacks it reads the Karma
 * window, not this 288px box. The one height that is asserted is a tap
 * target, which does not depend on either.
 */
@Component({
  standalone: true,
  imports: [TransactionPreviewTableComponent],
  template: `
    <!-- 320px, the narrowest phone still in use, less the page's own padding. -->
    <div class="narrow">
      <app-transaction-preview-table [transactions]="rows" [categories]="[]" />
    </div>
  `,
  styles: ['.narrow { width: 288px; overflow: hidden; }'],
})
class PreviewOverflowProbeComponent {
  readonly rows: CategorizedImportTransaction[] = [
    {
      id: 'r1',
      description: 'Weekly grocery run at the farmers market plus pantry staples',
      amount: 1234567,
      currency: 'JPY',
      currencyFellBack: true,
      date: new Date('2026-06-01'),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      isDuplicate: false,
      selected: true,
      location: { name: '東京都渋谷区道玄坂一丁目二番三号 渋谷マークシティ店' },
      tags: ['coffee', 'work', 'reimbursable'],
      recurringMatch: { id: 'rule-1', name: 'Netflix' },
      currencySuggestion: { code: 'KRW', country: 'KR', reason: 'receipt' },
    },
  ];
}

describe('overflow guard: the import review card', () => {
  let fixture: ComponentFixture<PreviewOverflowProbeComponent>;
  let host: HTMLElement;
  let clip: HTMLElement;
  let card: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreviewOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        // t() alone: TranslatePipe, LocaleDatePipe, LocaleFormatService and
        // CategorySuggestionComponent all guard their signal reads for exactly
        // this mock. Keys render in place of the strings, and a key is both
        // longer than the English it stands for and a single unbreakable word,
        // so every width here is the pessimistic one.
        { provide: TranslationService, useValue: { t: (key: string) => key } },
        {
          provide: CurrencyService,
          useValue: {
            getSupportedCurrencies: () => [
              { code: 'USD', nameKey: 'currencies.usd', symbol: '$' },
              { code: 'JPY', nameKey: 'currencies.jpy', symbol: '¥' },
            ],
            getCurrencyInfo: (code: string) =>
              code === 'MXN' ? { code, nameKey: 'currencies.mxn', symbol: '$' } : undefined,
            // Symbol and grouping, because the width of the amount is what
            // decides how much room the description gets — a bare
            // "JPY 1234567" stand-in measures a number no user ever sees.
            formatCurrency: (amount: number, code: string) =>
              new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount),
          },
        },
        { provide: CurrencyChoiceSessionService, useValue: { remember: () => undefined, current: () => null, clear: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PreviewOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    TestBed.inject(FitTextRegistry).flush();
    clip = host.querySelector('.narrow') as HTMLElement;
    card = host.querySelector('.transaction-card') as HTMLElement;
  });

  afterEach(() => host.remove());

  function el(selector: string): HTMLElement {
    return host.querySelector(selector) as HTMLElement;
  }

  /**
   * True when `inner` sits within `outer`'s horizontal span, to the nearest
   * pixel. Horizontal only: the clipping container really does cut off the
   * bottom of a long card, and that is the scroller doing its job.
   */
  function withinWidthOf(outer: HTMLElement, inner: HTMLElement): boolean {
    const o = outer.getBoundingClientRect();
    const i = inner.getBoundingClientRect();
    return i.left >= o.left - 1 && i.right <= o.right + 1;
  }

  it('keeps the card inside the 288px it was given', () => {
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge')
      .toBeLessThanOrEqual(card.clientWidth + 1);
    expect(card.getBoundingClientRect().width)
      .withContext('card no wider than its container')
      .toBeLessThanOrEqual(288);
  });

  it('shows the amount in full rather than a shortened version of it', () => {
    // A clipped amount is not a shortened number, it is a different one:
    // nothing on screen distinguishes ¥1,234 from ¥1,234,567.
    const amount = el('.amount-text');
    expect(amount.textContent?.trim()).toBe('-¥1,234,567');
    expect(withinWidthOf(clip, amount)).withContext('amount inside the clip').toBeTrue();
  });

  it('keeps the currency chip and its fallen-back marker on the card', () => {
    // The chip is a control, so being inside the card is the whole point:
    // a currency the source never read is corrected from here or nowhere.
    const chip = el('.currency-chip');
    expect(chip.querySelector('.verify-flag'))
      .withContext('a fallen-back currency wears the marker')
      .not.toBeNull();
    expect(withinWidthOf(clip, chip)).withContext('currency chip inside the clip').toBeTrue();
    expect(chip.getBoundingClientRect().bottom)
      .withContext('chip inside the card it belongs to')
      .toBeLessThanOrEqual(card.getBoundingClientRect().bottom + 1);
  });

  it('says the currency was not read in the chip\'s own accessible name', () => {
    // The label on a button replaces the name its content would compute, so
    // the marker icon cannot carry the news itself — it would never be
    // announced. The mark leads the chip's name instead, and the icon is
    // hidden so it adds nothing twice.
    const chip = el('.currency-chip');
    expect(chip.getAttribute('aria-label'))
      .withContext('the marker leads the chip name')
      .toMatch(/^import\.currencyFellBack\. /);
    expect(chip.getAttribute('aria-label'))
      .withContext('and the chip still says what it does')
      .toContain('import.setCurrency');
    expect(chip.querySelector('.verify-flag')?.getAttribute('aria-hidden'))
      .withContext('the marker icon is decorative')
      .toBe('true');
  });

  it('keeps every suggestion chip, and its remove button, inside the card', () => {
    // A 27-character place name and three tags on a 288px card is the case
    // that would push the remove buttons out of reach — the chips wrap and
    // their text breaks mid-word rather than the row growing sideways.
    const extras = el('.card-extras');
    const chips = Array.from(host.querySelectorAll<HTMLElement>('.extra-chip'));
    expect(chips.length).withContext('currency offer, location plus three tags').toBe(5);
    for (const chip of chips) {
      const remove = chip.querySelector('.extra-remove') as HTMLElement;
      expect(withinWidthOf(clip, chip))
        .withContext(`${chip.textContent?.trim()} inside the clip`)
        .toBeTrue();
      expect(withinWidthOf(clip, remove))
        .withContext(`remove button for ${chip.textContent?.trim()} reachable`)
        .toBeTrue();
      // Per chip rather than the strip's scrollWidth, which reads 1px over:
      // the remove button's tap target is a pseudo-element that overhangs its
      // 20px glyph on purpose, and a transparent hit area sticking out is not
      // a chip hiding past the edge.
      expect(withinWidthOf(extras, chip))
        .withContext(`${chip.textContent?.trim()} inside the strip`)
        .toBeTrue();
    }

    // The offer is the one chip with two controls; both must be reachable.
    // The accept button is chip-sized (no ≥26px floor — the chip must not
    // fatten); its 40px hit area is the ::after overhang, measured below.
    const accept = el('.currency-offer .extra-accept');
    expect(withinWidthOf(clip, accept)).withContext('accept inside the clip').toBeTrue();
    const hit = getComputedStyle(accept, '::after');
    expect(accept.getBoundingClientRect().height - parseFloat(hit.top) - parseFloat(hit.bottom))
      .withContext('accept hit area, glyph plus overhang')
      .toBeGreaterThanOrEqual(40);
  });

  it('wraps a long rule name rather than carrying it past the card', () => {
    // Material's form field is inline-flex, so it is shrink-to-fit and floors
    // at its label's min-content — and the rule name in that label is whatever
    // the user called the rule. The label here is one unbroken token, the
    // shape that used to hang over the card's edge and hide in its padding
    // where only a narrower font could expose it.
    const field = el('.recurring-link .mdc-form-field');
    const box = card.getBoundingClientRect();
    const contentRight = box.right - parseFloat(getComputedStyle(card).paddingRight);
    expect(field.getBoundingClientRect().right)
      .withContext('the link label stays inside the card\'s content box')
      .toBeLessThanOrEqual(contentRight + 1);
  });

  it('gives every new control a 40px tap target without fattening the chips', () => {
    // The repo has been here before: .type-toggle carries a comment recording
    // that it shipped at 26px, below the accessible minimum. The two menu
    // triggers reach the minimum with their own height. The remove button
    // cannot — the chip has to stay chip-sized — so it lays a 40x32 hit area
    // over its 20px glyph instead, and that is the thing worth pinning.
    expect(el('.currency-chip').getBoundingClientRect().height)
      .withContext('currency chip tap target')
      .toBeGreaterThanOrEqual(40);
    expect(el('.bulk-currency').getBoundingClientRect().height)
      .withContext('bulk currency button tap target')
      .toBeGreaterThanOrEqual(40);

    const remove = el('.extra-remove');
    const box = remove.getBoundingClientRect();
    const hit = getComputedStyle(remove, '::after');
    expect(box.height - parseFloat(hit.top) - parseFloat(hit.bottom))
      .withContext('remove button hit area, glyph plus overhang')
      .toBeGreaterThanOrEqual(40);
    // 32 wide, not 40, and that is a decision rather than a lowered bar: the
    // button sits 4px inside the chip's own right edge, so the 6px of overhang
    // reaches only 2px into `.card-extras`'s 6px column gap and stops short of
    // the neighbouring chip. Widening it further would not.
    expect(box.width - parseFloat(hit.left) - parseFloat(hit.right))
      .withContext('remove button hit area is wider than the glyph')
      .toBeGreaterThanOrEqual(32);

    // And the chip it sits in is still one line of --text-xs: the hit area
    // grew outside the box precisely so this number would not move.
    expect(host.querySelectorAll<HTMLElement>('.extra-chip')[2].getBoundingClientRect().height)
      .withContext('tag chip stays chip-sized')
      .toBeLessThanOrEqual(28);
    expect(el('.currency-offer').getBoundingClientRect().height)
      .withContext('offer chip stays chip-sized too')
      .toBeLessThanOrEqual(28);
  });

  it('never lets one chip\'s tap target reach into the row below', () => {
    // The chips wrap at 288px, and a hit box 14px taller than its chip is
    // exactly how a tap on the bottom edge of one tag ends up removing the
    // tag under it. `.card-extras` pays for the overhang in row-gap, so the
    // boxes meet and never overlap.
    const hits = Array.from(host.querySelectorAll<HTMLElement>('.extra-remove, .extra-accept')).map(button => {
      const r = button.getBoundingClientRect();
      const after = getComputedStyle(button, '::after');
      return {
        top: r.top + parseFloat(after.top),
        bottom: r.bottom - parseFloat(after.bottom),
        left: r.left + parseFloat(after.left),
        right: r.right - parseFloat(after.right),
      };
    });

    expect(new Set(hits.map(h => Math.round(h.top))).size)
      .withContext('the chips really did wrap, so there are rows to collide')
      .toBeGreaterThan(1);

    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i];
        const b = hits[j];
        // Two boxes overlap only when they overlap on both axes, so the
        // smaller of the two spans is what has to come out non-positive.
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        expect(Math.min(overlapX, overlapY))
          .withContext(`hit areas ${i} and ${j} are disjoint`)
          .toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('marks the code the row is already on in the currency menu', () => {
    // The mark is why the menu is worth opening: without it the list gives no
    // sign of what the row is changing from. It has to sit on an element of
    // ours, because MatMenuItem projects the label into its own
    // .mat-mdc-menu-item-text and that span declares its own font-weight —
    // a weight on the button inherits down and loses.
    (el('.currency-chip')).click();
    fixture.detectChanges();

    const panel = document.querySelector('.mat-mdc-menu-panel') as HTMLElement;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('.mat-mdc-menu-item'));
    const current = items.find(item => item.classList.contains('current'));
    const other = items.find(item => !item.classList.contains('current'));

    expect(current?.textContent).withContext('the row is on JPY').toContain('JPY');
    const weightOf = (item: HTMLElement | undefined) =>
      getComputedStyle(item?.querySelector('.option-label') as HTMLElement).fontWeight;
    expect(Number(weightOf(current)))
      .withContext('current code is weighted')
      .toBeGreaterThan(Number(weightOf(other)));
  });

  it('keeps the bulk currency button and the count badge on the header', () => {
    // The button only appears once something is selected, which is exactly
    // when the header line is at its longest. Unwrapped, it shoved the count
    // badge 150px past the right edge of the table.
    const header = el('.table-header');
    expect(header.scrollWidth)
      .withContext('nothing hiding past the header\'s right edge')
      .toBeLessThanOrEqual(header.clientWidth + 1);
    expect(withinWidthOf(clip, el('.bulk-currency')))
      .withContext('bulk currency button inside the clip')
      .toBeTrue();
    expect(withinWidthOf(clip, el('.selected-badge')))
      .withContext('count badge inside the clip')
      .toBeTrue();
  });
});
