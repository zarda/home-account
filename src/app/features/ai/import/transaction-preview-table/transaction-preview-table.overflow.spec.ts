import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { TransactionPreviewTableComponent } from './transaction-preview-table.component';
import { Category, CategorizedImportTransaction } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { CurrencyChoiceSessionService } from '../../../../core/services/currency-choice-session.service';
import { FitTextRegistry } from '../../../../shared/directives/fit-text.registry';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';

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
 * has a layout box, and a container width the case sets rather than the
 * runner's window — 288px throughout, save for the one case that widens it to
 * 900px because what it measures only happens with a chip beside the trigger.
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
      <app-transaction-preview-table [transactions]="rows" [categories]="categories()" [dateAttentionIds]="attention" />
    </div>
  `,
  styles: ['.narrow { width: 288px; overflow: hidden; }'],
})
class PreviewOverflowProbeComponent {
  // Empty by default, so every case but the one below still renders
  // Unknown — the shape the fixture shipped with.
  categories = signal<Category[]>([]);
  // r2 is the receipt row: dated on another day and under attention, so the
  // not-today question is measured at this width alongside r1's assumed one.
  readonly attention: ReadonlySet<string> = new Set(['r2']);
  readonly rows: CategorizedImportTransaction[] = [
    {
      id: 'r1',
      description: 'Weekly grocery run at the farmers market plus pantry staples',
      amount: 1234567,
      currency: 'JPY',
      currencyFellBack: true,
      date: new Date('2026-06-01'),
      dateAssumed: true,
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
    // The session and locale rungs offer a code with no country — "Use
    // {{currency}}?" — which is one line at any width, unlike r1's
    // with-country sentence above. The accept button's hit area has to
    // reach 40px in this shape too, not only the one where the label wraps.
    {
      id: 'r2',
      description: 'Coffee',
      amount: 500,
      currency: 'USD',
      currencyFellBack: true,
      date: new Date('2026-06-02'),
      type: 'expense',
      suggestedCategoryId: 'food',
      categoryConfidence: 0.8,
      // Flagged, so the overrule renders on this row: the badge and its
      // button sit on the top row above the description trigger, and the
      // two are measured apart.
      isDuplicate: true,
      selected: true,
      currencySuggestion: { code: 'EUR', reason: 'session' },
      // A country the reader concluded with no printed address renders as a
      // chip of its own, and r2 is the row with no location to stand in front
      // of it.
      receiptCountry: 'KR',
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
        // this mock. A key with no params renders bare, still longer than the
        // English it stands for and still one unbreakable word. A key called
        // with params — the offer chip's own case — appends the real values
        // (a real country name off Intl.DisplayNames, a real currency code)
        // rather than dropping them, because a bare key under-measures a
        // chip that interpolates: the rendered sentence runs about a third
        // longer than the key alone, which is exactly the width this probe
        // exists to catch.
        //
        // `import.currencySuggested` is the one key this pessimism would
        // mislead on: r2's whole point is the shape where the label never
        // wraps, and the bare key "import.currencySuggested" is one long
        // unbroken token that would wrap regardless of what r2 is actually
        // testing. Standing in its real, short translation ("Use
        // {{currency}}?") is what makes r2 the one-line case it needs to be.
        {
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, string | number>) =>
              key === 'import.currencySuggested' && params
                ? `Use ${params['currency']}?`
                : params
                  ? `${key} ${Object.values(params).join(' ')}`
                  : key,
          },
        },
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

  /**
   * A chip's tap target, expanded by its own `::after` overhang — the box a
   * tap actually lands in, not just the button's own border box. Only
   * `.extra-remove`/`.extra-accept`/`.extra-country` carry that overhang, so
   * this is not something every chip-like control on the card can share —
   * `.extra-add` reads its plain `getBoundingClientRect()` instead.
   */
  function chipHitBoxes(): { top: number; bottom: number; left: number; right: number }[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.extra-remove, .extra-accept, .extra-country')).map(button => {
      const r = button.getBoundingClientRect();
      const after = getComputedStyle(button, '::after');
      return {
        top: r.top + parseFloat(after.top),
        bottom: r.bottom - parseFloat(after.bottom),
        left: r.left + parseFloat(after.left),
        right: r.right - parseFloat(after.right),
      };
    });
  }

  /**
   * Fails unless every pair in `boxes` is disjoint on at least one axis.
   * `label(i, j)` builds the failure message — the pair's own indices say
   * nothing on their own about which two controls collided.
   */
  function expectDisjoint(
    boxes: { top: number; bottom: number; left: number; right: number }[],
    label: (i: number, j: number) => string,
  ): void {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Two boxes overlap only when they overlap on both axes, so the
        // smaller of the two spans is what has to come out non-positive.
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        expect(Math.min(overlapX, overlapY)).withContext(label(i, j)).toBeLessThanOrEqual(0.5);
      }
    }
  }

  /**
   * Fails unless every one of `triggers` stays disjoint from every box in
   * `hits`. Kept apart from `expectDisjoint` rather than sharing it: a
   * trigger is not one of the hits, so there is no self-pairing to skip.
   */
  function expectClearOf(
    triggers: { top: number; bottom: number; left: number; right: number }[],
    hits: { top: number; bottom: number; left: number; right: number }[],
  ): void {
    for (const trigger of triggers) {
      for (const hit of hits) {
        const overlapX = Math.min(trigger.right, hit.right) - Math.max(trigger.left, hit.left);
        const overlapY = Math.min(trigger.bottom, hit.bottom) - Math.max(trigger.top, hit.top);
        expect(Math.min(overlapX, overlapY))
          .withContext('add trigger and a chip\'s hit area below it are disjoint')
          .toBeLessThanOrEqual(0.5);
      }
    }
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
    expect(chips.length)
      .withContext('r1\'s assumed-date question, two currency offers (r1 with-country, r2 country-less), location plus three tags, r2\'s not-today question and r2\'s receipt country')
      .toBe(9);
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

    // r2's offer carries no country — "Use {{currency}}?" — which never
    // wraps, at any width. That is the shape a fixed overhang derived from
    // r1's two-line label gets wrong: the button renders far shorter here,
    // so the hit area has to reach 40px from a much smaller starting height.
    const shortAccept = host.querySelectorAll<HTMLElement>('.currency-offer .extra-accept')[1];
    expect(withinWidthOf(clip, shortAccept)).withContext('country-less accept inside the clip').toBeTrue();
    const shortHit = getComputedStyle(shortAccept, '::after');
    expect(shortAccept.getBoundingClientRect().height - parseFloat(shortHit.top) - parseFloat(shortHit.bottom))
      .withContext('country-less accept hit area, glyph plus overhang')
      .toBeGreaterThanOrEqual(40);

    // Every check above measures element *boxes*, which shrink to fit —
    // `.transaction-card` shrinks the accept button rather than growing past
    // its row, and an overflowing label paints straight through that shrunk
    // box. That does not escape uncounted: `scrollWidth` reports an
    // element's full rendered extent whether or not the element itself
    // establishes a scroll container, so `card.scrollWidth`, asserted
    // earlier in this file, already catches it geometrically — this file's
    // own red run once measured it at 360 against a 257 clientWidth, from a
    // label that had gone back to overflowing. What that number does not
    // say is whether the escape becomes a *visible* problem: the first
    // ancestor whose `overflow` actually computes to a scrolling value is
    // `.transactions-list` (`overflow-y: auto` computes its `overflow-x` to
    // `auto` too), which is where an overflow would show up as a real
    // scrollbar on the review list.
    const list = host.querySelector('.transactions-list') as HTMLElement;
    expect(list.scrollWidth)
      .withContext('review list does not scroll sideways for the offer chip\'s label')
      .toBeLessThanOrEqual(list.clientWidth + 1);
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
    // Rendered because r2 is a selected receipt row dated another day.
    expect(el('.keep-dates').getBoundingClientRect().height)
      .withContext('keep all dates button tap target')
      .toBeGreaterThanOrEqual(40);

    // The first `.extra-remove` in the strip is the date question's change
    // button now; it carries both classes, so it wears exactly this box.
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

    // And the tag chip is still one line of --text-xs: the hit area grew
    // outside the box precisely so this number would not move. By class, not
    // index: the strip's order moves whenever a chip is added ahead of it.
    expect(el('.extra-chip.tag-chip').getBoundingClientRect().height)
      .withContext('tag chip stays chip-sized')
      .toBeLessThanOrEqual(28);

    // The offer chip is the one exception, and on purpose: its label is a
    // full sentence rather than a single word, and at 288px the real
    // sentence needs a second line. Taller here is the label wrapping, not
    // the chip fattening — the accept button still floors its own hit area
    // at 40px on top of the taller box, with a smaller overhang than the
    // 18px-tall single line this shipped with first.
    const offerChip = el('.currency-offer');
    expect(offerChip.getBoundingClientRect().height)
      .withContext('offer chip taller than a one-line chip because its label wrapped')
      .toBeGreaterThan(28);
    const acceptText = el('.currency-offer .extra-accept .extra-text');
    expect(acceptText.getBoundingClientRect().height)
      .withContext('the label really did take a second line rather than spilling past the chip')
      .toBeGreaterThan(20);
  });

  it('keeps both of the location chip\'s controls reachable, and its editor inside the card', () => {
    // The chip carries three controls now — the name, the country and the
    // removal — where it used to carry one, and it is the widest chip on the
    // card. Each of the two new ones has to reach 40px through an overhang
    // rather than by fattening the chip, exactly as the removal beside them
    // does; the disjointness of those overhangs is measured below.
    const hitHeight = (control: HTMLElement) => {
      const after = getComputedStyle(control, '::after');
      return control.getBoundingClientRect().height - parseFloat(after.top) - parseFloat(after.bottom);
    };
    const name = host.querySelector('[data-row-id="r1"] .place-name') as HTMLElement;
    const country = host.querySelector('[data-row-id="r1"] .extra-country') as HTMLElement;
    for (const control of [name, country]) {
      expect(withinWidthOf(clip, control))
        .withContext(`${control.className} inside the clip`)
        .toBeTrue();
      expect(hitHeight(control))
        .withContext(`${control.className} hit area, glyph plus overhang`)
        .toBeGreaterThanOrEqual(40);
    }
    // r2 has no printed address, so its chip is the nameless shape — the one
    // the card spec finds by this class and clears through the removal.
    expect(host.querySelector('[data-row-id="r2"] .extra-chip.country-chip'))
      .withContext('a country with no name is still a chip of its own')
      .not.toBeNull();

    name.click();
    fixture.detectChanges();

    const input = host.querySelector('[data-row-id="r1"] .place-input') as HTMLElement;
    expect(input).withContext('the trigger opened an input').not.toBeNull();
    expect(withinWidthOf(clip, input)).withContext('the place editor inside the clip').toBeTrue();
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge while a place name is being typed')
      .toBeLessThanOrEqual(card.clientWidth + 1);
  });

  it('carries the add trigger on every row, and its editor, inside the 288px', () => {
    // The trigger is on every card now — a row with nothing suggested still
    // has a tag to add — so it is what the strip is measured with. It is a
    // control rather than a chip, so it takes the 40px floor in its own box
    // instead of an overhang, and the chips beside it must not fatten to
    // match: the tag chip's own height is pinned above. Split joined it as a
    // second trigger once both fixture rows carry an amount to take off, and
    // remove is the third — unconditional, the same as add tag, so a flagged
    // row carries it too.
    const adds = Array.from(host.querySelectorAll<HTMLElement>('.extra-add'));
    expect(adds.length).withContext('three per row: add tag, split and remove').toBe(6);
    for (const add of adds) {
      expect(add.getBoundingClientRect().height)
        .withContext('add trigger tap target')
        .toBeGreaterThanOrEqual(40);
      expect(withinWidthOf(clip, add)).withContext('add trigger inside the clip').toBeTrue();
    }
    // r2 is flagged (isDuplicate), and unlike merge and split, remove is
    // offered whether or not the badge's own control has overruled it.
    expect(host.querySelector('[data-row-id="r1"] .remove-trigger')).not.toBeNull();
    expect(host.querySelector('[data-row-id="r2"] .remove-trigger')).withContext('flagged too').not.toBeNull();

    (host.querySelector('[data-row-id="r1"] .tag-add') as HTMLElement).click();
    fixture.detectChanges();
    const input = host.querySelector('[data-row-id="r1"] .tag-input') as HTMLElement;
    expect(input).withContext('the trigger opened an input').not.toBeNull();
    expect(withinWidthOf(clip, input)).withContext('the tag input inside the clip').toBeTrue();
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge while a tag is being typed')
      .toBeLessThanOrEqual(card.clientWidth + 1);
  });

  it('does not carry the chips beside it up to its own height', () => {
    // A flex item stretches to its line, and the trigger stands 40px where a
    // chip is 26 — so every chip sharing its line takes 40 as well, which the
    // strip's row-gap (derived from a 26px chip) then under-pays for. This is
    // the one measurement in this file taken at a desktop width rather than
    // at 288px, and it has to be: at 288px the chips wrap onto lines of their
    // own and never stand beside the trigger at all, which is exactly why the
    // chip height pinned above cannot see this. The width is not a desktop's
    // but one that holds the whole strip on a single line whatever font the
    // browser has: at 900px the last line's composition was the fonts' to
    // decide, and once Remove joined the strip, Linux Chrome's wider fallback
    // face wrapped the trigger onto a line of its own — a precondition
    // failing, not the stretch it guards.
    clip.style.width = '2400px';
    fixture.detectChanges();

    const trigger = host.querySelector('[data-row-id="r1"] .tag-add') as HTMLElement;
    const beside = Array.from(host.querySelectorAll<HTMLElement>('[data-row-id="r1"] .extra-chip.tag-chip'))
      .filter(chip => Math.abs(chip.getBoundingClientRect().top - trigger.getBoundingClientRect().top) < 1);
    expect(beside.length)
      .withContext('the trigger really does share a line with a chip here, so there is something to stretch')
      .toBeGreaterThan(0);
    for (const chip of beside) {
      expect(chip.getBoundingClientRect().height)
        .withContext(`tag chip "${chip.textContent?.trim()}" stays chip-sized beside the trigger`)
        .toBeLessThanOrEqual(28);
    }

    // Caret order is read only here and in the RTL case beside it: the next
    // pass hides the caret behind a container query below phone width, which
    // would make a reading in the 288px or 262px cases above wrong on
    // arrival. r1's categories are empty here, so its chip reads the Unknown
    // fallback — fine for an order/geometry reading, and short enough that
    // appFitText never engages, so there is nothing to flush.
    const label = host.querySelector('[data-row-id="r1"] .category-name') as HTMLElement;
    const caret = host.querySelector('[data-row-id="r1"] .dropdown-icon') as HTMLElement;
    expect(!!(label.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING))
      .withContext('caret after the category label in DOM order')
      .toBeTrue();
    expect(caret.getBoundingClientRect().left)
      .withContext('caret paints after the label')
      .toBeGreaterThanOrEqual(label.getBoundingClientRect().right - 1);
  });

  it('the caret trails the name under RTL too', () => {
    // Same reading as above, flipped: the caret fix relies on a logical
    // margin and Material's own trailing-icon rule under [dir=rtl], and this
    // is the one place that direction is exercised.
    clip.style.width = '2400px';
    clip.setAttribute('dir', 'rtl');
    fixture.detectChanges();

    const label = host.querySelector('[data-row-id="r1"] .category-name') as HTMLElement;
    const caret = host.querySelector('[data-row-id="r1"] .dropdown-icon') as HTMLElement;
    const labelRect = label.getBoundingClientRect();
    const caretRect = caret.getBoundingClientRect();
    // Finite first, the way the hit-box RTL case above guards it: a missing
    // inset reads as NaN, and NaN comparisons fail without naming a side.
    expect([labelRect.left, caretRect.right].every(Number.isFinite))
      .withContext('label and caret both resolve to real edges under rtl')
      .toBeTrue();
    expect(caretRect.right)
      .withContext('caret trails the name under rtl too')
      .toBeLessThanOrEqual(labelRect.left + 1);
  });

  it('puts the date on a control of its own without wedging the picker between the chips', () => {
    // The date was a span; as a button it has to meet the 40px floor the
    // currency chip meets, stay inside the clip, and leave the meta row
    // wrapping rather than widening. The picker it opens from is a hidden
    // input and an empty host, and both stay out of the row: unhidden, an
    // empty host inside a `gap: 6px` flex row is a zero-width item that
    // still costs a gap, which would read as 12px between the date and the
    // currency.
    const dates = Array.from(host.querySelectorAll<HTMLElement>('.date-chip'));
    expect(dates.map(date => date.tagName)).withContext('one button per row').toEqual(['BUTTON', 'BUTTON']);
    expect(dates[0].classList.contains('not-today')).withContext('r1 is outside the attention set').toBeFalse();
    expect(dates[1].classList.contains('not-today')).withContext('r2 is the receipt row dated another day').toBeTrue();
    for (const date of dates) {
      expect(date.getBoundingClientRect().height).withContext('date button tap target').toBeGreaterThanOrEqual(40);
      expect(withinWidthOf(clip, date)).withContext('date button inside the clip').toBeTrue();
    }

    const meta = el('.meta-info');
    for (const selector of ['.date-chip', '.currency-chip', '.type-toggle']) {
      expect(withinWidthOf(clip, meta.querySelector(selector) as HTMLElement))
        .withContext(`${selector} inside the clip`)
        .toBeTrue();
    }
    expect(meta.scrollWidth)
      .withContext('the meta row wraps rather than overflowing')
      .toBeLessThanOrEqual(meta.clientWidth + 1);

    // The pair is guarded directly rather than through the gap alone: a
    // hidden host generates no box and costs no gap (the same way the
    // `mat-menu` host in this row already gets away with it), so what has
    // to hold is that the pair stays hidden and stays out of the row.
    expect(meta.querySelector('.picker-anchor, mat-datepicker'))
      .withContext('the picker pair sits after the meta row, not in it')
      .toBeNull();
    for (const selector of ['.picker-anchor', 'mat-datepicker']) {
      expect((card.querySelector(selector) as HTMLElement).getClientRects().length)
        .withContext(`${selector} has no box`)
        .toBe(0);
    }
    // Measured at this width: the row is 174px once the list's and the
    // card's own chrome and the checkbox column are paid for, the date
    // button 104px (icon, date, 40px of chrome, no caret) and the currency
    // chip 80px — 190 with the gap between them — so the two wrap here and
    // the 6px is the row gap; on a wider card they sit side by side and
    // the gap is horizontal. Whichever axis the wrap chose, nothing else
    // fits in it: an unhidden picker host between them would read as 12.
    const dateBox = dates[0].getBoundingClientRect();
    const currencyBox = (meta.querySelector('.currency-chip') as HTMLElement).getBoundingClientRect();
    const gap = currencyBox.top >= dateBox.bottom - 0.5
      ? currencyBox.top - dateBox.bottom
      : currencyBox.left - dateBox.right;
    expect(gap).withContext('date and currency chips 6px apart, nothing between them').toBeCloseTo(6, 0);
  });

  it('puts the description and the amount on controls without widening the card', () => {
    // Both were spans; as triggers they have to meet the same 40px floor the
    // chips meet and stay inside the clip — the description while wrapped to
    // several lines, the amount while `appFitText` is still holding every
    // digit of ¥1,234,567 on one.
    const description = el('.description-section .inline-edit');
    const amount = el('.amount-section .inline-edit');
    for (const [name, trigger] of [['description', description], ['amount', amount]] as const) {
      expect(trigger.tagName).withContext(`${name} is a control`).toBe('BUTTON');
      expect(trigger.getBoundingClientRect().height)
        .withContext(`${name} trigger tap target`)
        .toBeGreaterThanOrEqual(40);
      expect(withinWidthOf(clip, trigger)).withContext(`${name} trigger inside the clip`).toBeTrue();
    }
  });

  it('puts the overrule on the badge as a 40px control that stays clear of the description', () => {
    // The badge is on the top row, where the height exists, so the button
    // reaches 40px with a box of its own. It is the one control on the card
    // without an ::after overhang, and on purpose: a hit area hanging 10px
    // below a 20px glyph here would land on the description trigger beneath
    // the badge — which is why the two boxes are measured apart directly.
    // The strip's row-below probe never sees this button; it is not in
    // `.card-extras`.
    const clear = host.querySelector('[data-row-id="r2"] .duplicate-clear') as HTMLElement;
    expect(clear).withContext('r2 is the flagged row').not.toBeNull();
    expect(getComputedStyle(clear, '::after').content)
      .withContext('the box is the whole hit area')
      .toBe('none');
    // The badge sizes its own glyph, and the overrule's rule is nested under
    // it on purpose: at equal specificity a reorder alone would hand this
    // glyph the badge's size.
    expect(getComputedStyle(clear.querySelector('mat-icon')!).fontSize)
      .withContext('the overrule\'s glyph keeps its own size')
      .toBe('16px');
    const box = clear.getBoundingClientRect();
    expect(box.height).withContext('overrule tap target height').toBeGreaterThanOrEqual(40);
    expect(box.width).withContext('overrule tap target width').toBeGreaterThanOrEqual(40);
    expect(withinWidthOf(clip, clear)).withContext('overrule inside the clip').toBeTrue();

    const description = (host.querySelector('[data-row-id="r2"] .description-text') as HTMLElement).getBoundingClientRect();
    const overlapX = Math.min(box.right, description.right) - Math.max(box.left, description.left);
    const overlapY = Math.min(box.bottom, description.bottom) - Math.max(box.top, description.top);
    expect(Math.min(overlapX, overlapY))
      .withContext('the overrule and the description trigger are disjoint')
      .toBeLessThanOrEqual(0.5);
  });

  it('marks both triggers as controls without waiting for a pointer', () => {
    // Receipt import is the touch-first flow — the camera hands straight over
    // to this card — and a touch device has neither :hover nor
    // :focus-visible. Revealing the underline on those alone left the two
    // fields pixel-identical to the spans they replaced on the very device
    // the card is used on, while the chips beside them read as chips.
    for (const selector of ['.description-section .inline-edit', '.amount-section .inline-edit']) {
      const style = getComputedStyle(el(selector));
      expect(style.borderBlockEndStyle).withContext(`${selector} underline`).toBe('dotted');
      expect(style.borderBlockEndColor)
        .withContext(`${selector} underline is visible before anything is hovered`)
        .not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  it('keeps the card inside its 288px with either editor open', () => {
    // The description editor is a full-width input and the amount editor a
    // fixed 7em one on the row that already carries the widest figure this
    // fixture has; either could push the top row past the card's edge.
    // Split is a fixed 7em field too, opened on r1 — the first of each
    // selector's matches, this probe's own widest row.
    for (const selector of ['.description-section .inline-edit', '.amount-section .inline-edit', '.split-trigger']) {
      el(selector).click();
      fixture.detectChanges();

      const box = host.querySelector('.transaction-card .inline-input') as HTMLElement;
      expect(box).withContext(`${selector} opened an input`).not.toBeNull();
      expect(withinWidthOf(clip, box)).withContext(`${selector}'s input inside the clip`).toBeTrue();
      expect(card.scrollWidth)
        .withContext(`nothing hiding past the card's right edge while editing via ${selector}`)
        .toBeLessThanOrEqual(card.clientWidth + 1);

      // Escape rather than leaving it open: the next pass needs the other
      // trigger back, and one row edits one field at a time.
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
    }
  });

  it('keeps the refusal under the split editor inside the 288px', () => {
    // A refused figure holds the split editor open and writes why next to
    // it — inside the strip that wraps chips, not the amount section the
    // message's rule was written for. Measured as the bare key: one
    // unbreakable token, longer than the English it stands for.
    el('.split-trigger').click();
    fixture.detectChanges();
    const box = host.querySelector('.transaction-card .split-input') as HTMLInputElement;
    box.value = '9999999';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();

    const message = host.querySelector('.transaction-card .amount-error') as HTMLElement | null;
    expect(box.getAttribute('aria-invalid')).withContext('more than r1 carries, refused').toBe('true');
    expect(message).withContext('the refusal is standing').not.toBeNull();
    expect(withinWidthOf(clip, message!)).withContext('the message inside the clip').toBeTrue();
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge with the refusal showing')
      .toBeLessThanOrEqual(card.clientWidth + 1);
  });

  it('never lets one chip\'s tap target reach into the row below', () => {
    // The chips wrap at 288px, and a hit box 14px taller than its chip is
    // exactly how a tap on the bottom edge of one tag ends up removing the
    // tag under it. `.card-extras` pays for the overhang in row-gap, so the
    // boxes meet and never overlap. The date question's change button
    // carries `.extra-remove` too, so both of its controls are in this set —
    // and the country picker is the one control that borrows that hit area
    // without carrying the class, so it is named here directly. Its chip is
    // where a sideways collision shows up first: three controls stand side
    // by side on it, close enough that the overhangs meet exactly.
    const hits = chipHitBoxes();

    expect(new Set(hits.map(h => Math.round(h.top))).size)
      .withContext('the chips really did wrap, so there are rows to collide')
      .toBeGreaterThan(1);

    expectDisjoint(hits, (i, j) => `hit areas ${i} and ${j} are disjoint`);
  });

  it('keeps the add-tag and split triggers clear of the chip row below them', () => {
    // .extra-add has no ::after overhang — its own box is the whole 40px hit
    // area, pinned above — so it cannot join the pass above over
    // .extra-remove/.extra-accept/.extra-country: getComputedStyle(button,
    // '::after').top on an element with no such pseudo-element is 'auto',
    // and parseFloat('auto') is NaN, which every comparison below would
    // fail on with a bare "Expected NaN to be less than or equal to 0.5"
    // that names no control. This measures the same collision the way the
    // trigger, not the chip, sees it: its own full box.
    const chipHits = chipHitBoxes();
    const triggers = Array.from(host.querySelectorAll<HTMLElement>('.extra-add')).map(add => add.getBoundingClientRect());
    expect(chipHits.length).withContext('there are chips here to stay clear of').toBeGreaterThan(0);
    expect(triggers.length).withContext('there are add triggers here to keep clear').toBeGreaterThan(0);

    expectClearOf(triggers, chipHits);
  });

  it('keeps every hit box apart under RTL too', () => {
    // Everything above is measured in LTR, where the card actually ships —
    // this is the one case that flips the fixture instead, since the
    // stylesheet's logical properties are what is under test here, not the
    // card's own layout.
    clip.setAttribute('dir', 'rtl');
    fixture.detectChanges();
    // Marked before the flush for the reason the 262px case below spells
    // out: the directive's own observers never land inside a plain
    // (non-fakeAsync) spec, so a flush over an empty dirty set re-measures
    // nothing and the line would be protection this case is not getting.
    const registry = TestBed.inject(FitTextRegistry);
    fixture.debugElement
      .queryAll(By.directive(FitTextDirective))
      .forEach(d => registry.markDirty(d.injector.get(FitTextDirective)));
    registry.flush();

    const hits = chipHitBoxes();
    // chipHitBoxes() reads back whichever spelling the stylesheet used, as a
    // physical top/bottom/left/right — so a control missing the inset the
    // reconstruction needs on a given side reads 'auto' there just as
    // `.extra-add` would above, and parseFloat('auto') is NaN. Finite first,
    // so that failure names the box it is about instead of surfacing as a
    // bare "Expected NaN to be less than or equal to 0.5" from whichever
    // comparison below meets it first.
    for (const hit of hits) {
      expect([hit.top, hit.bottom, hit.left, hit.right].every(Number.isFinite))
        .withContext('every hit box inset resolves to a real value under rtl too')
        .toBeTrue();
    }

    expectDisjoint(hits, (i, j) => `hit areas ${i} and ${j} are disjoint`);
    const triggers = Array.from(host.querySelectorAll<HTMLElement>('.extra-add')).map(add => add.getBoundingClientRect());
    expectClearOf(triggers, hits);

    // The location chip's own three controls are where this matters
    // concretely: .place-name's big overhang faces away from
    // .extra-country under LTR, and stays that way under RTL only because
    // the inset is logical now — a physical spelling would leave it facing
    // .extra-country instead, the 9 + 6 across the chip's 4px gap the
    // stylesheet's own comment measures as an 11px overlap.
    const hitBox = (control: HTMLElement) => {
      const r = control.getBoundingClientRect();
      const after = getComputedStyle(control, '::after');
      return {
        top: r.top + parseFloat(after.top),
        bottom: r.bottom - parseFloat(after.bottom),
        left: r.left + parseFloat(after.left),
        right: r.right - parseFloat(after.right),
      };
    };
    const placeName = hitBox(host.querySelector('[data-row-id="r1"] .place-name') as HTMLElement);
    const country = hitBox(host.querySelector('[data-row-id="r1"] .extra-country') as HTMLElement);
    expectDisjoint([placeName, country], () => 'the location chip\'s place name and its country control are disjoint');
  });

  it('carries a merge trigger on every row once they share a currency, inside the 288px', () => {
    // r1 and r2 are JPY and USD everywhere else in this file, so canMerge is
    // false on both and nothing above ever sees a `.merge-trigger` — the
    // `.extra-add` count pinned above stays three per row. Correcting
    // r2's own currency to JPY through its own menu (the same click this
    // file's currency-menu case above already drives) is what gives the two
    // a shared currency here, a real edit rather than a fixture rewrite, so
    // every other case's r2 — and the offer chips whose count and shape they
    // pin — stays exactly as it was. r2 is flagged as well, and a flagged
    // row takes no part in a merge until the badge's own control overrules
    // it (mergeableRow), so that click comes first, the same real edit the
    // overrule case above measures.
    (host.querySelector('[data-row-id="r2"] .duplicate-clear') as HTMLElement).click();
    fixture.detectChanges();
    (host.querySelector('[data-row-id="r2"] .currency-chip') as HTMLElement).click();
    fixture.detectChanges();
    const jpyOption = Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel .mat-mdc-menu-item'))
      .find(item => item.textContent?.includes('JPY'));
    jpyOption!.click();
    fixture.detectChanges();

    const chipHits = chipHitBoxes();
    const triggers = Array.from(host.querySelectorAll<HTMLElement>('.merge-trigger'));
    expect(chipHits.length).withContext('there are chips here to stay clear of').toBeGreaterThan(0);
    expect(triggers.length).withContext('one per row now both are JPY').toBe(2);

    for (const trigger of triggers) {
      const box = trigger.getBoundingClientRect();
      expect(withinWidthOf(clip, trigger)).withContext('merge trigger inside the clip').toBeTrue();
      expect(box.height).withContext('merge trigger tap target').toBeGreaterThanOrEqual(40);
      for (const hit of chipHits) {
        const overlapX = Math.min(box.right, hit.right) - Math.max(box.left, hit.left);
        const overlapY = Math.min(box.bottom, hit.bottom) - Math.max(box.top, hit.top);
        expect(Math.min(overlapX, overlapY))
          .withContext('merge trigger and a chip\'s hit area are disjoint')
          .toBeLessThanOrEqual(0.5);
      }
    }

    // The menu is a CDK overlay outside the card, like the country menu —
    // closed here, so this is the card's own width with nothing borrowed
    // from an overlay that would not count against it anyway.
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge with the merge trigger showing')
      .toBeLessThanOrEqual(card.clientWidth + 1);
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

  it('carries the add-a-row control under the list, inside the 288px', () => {
    // One control for the whole card rather than one per row: it adds a row,
    // it does not edit one, so it is not in `.card-extras` and takes its 40px
    // in its own box the way the strip's triggers do.
    const add = el('.add-row');
    expect(host.querySelectorAll('.add-row').length).withContext('one for the list').toBe(1);
    expect(add.getBoundingClientRect().height)
      .withContext('add a row tap target')
      .toBeGreaterThanOrEqual(40);
    expect(withinWidthOf(clip, add)).withContext('add a row inside the clip').toBeTrue();

    // Under the list, and outside the scroller the rows sit in: the list caps
    // at 70dvh, so a control inside it is one a reviewer with twenty rows has
    // to scroll to find — and the truncation notice points straight at it.
    const list = host.querySelector('.transactions-list') as HTMLElement;
    expect(list.contains(add)).withContext('not inside the rows\' scroller').toBeFalse();
    expect(add.getBoundingClientRect().top)
      .withContext('under the list rather than inside a card')
      .toBeGreaterThanOrEqual(list.getBoundingClientRect().bottom - 1);
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
    expect(withinWidthOf(clip, el('.keep-dates')))
      .withContext('keep all dates button inside the clip')
      .toBeTrue();
    expect(withinWidthOf(clip, el('.selected-badge')))
      .withContext('count badge inside the clip')
      .toBeTrue();
  });

  it('lets a long category name yield at the width the wizard leaves the card', () => {
    // 262: .table-container's 1px border takes the clip to 260, then
    // .transactions-list's 10px padding on both sides takes it to 240 — the
    // width a stretched flex item in that column list is handed regardless
    // of what overflows inside it. A driven run once measured exactly this
    // shape, 240 wide with a 238 clientWidth once the card's own 1px border
    // is paid too, against a category chip reading Groceries (#393).
    //
    // This fixture's two rows are always taller than 70dvh of Karma's own
    // window, so .transactions-list always carries a real vertical
    // scrollbar here (never on the touch devices this card ships to, which
    // overlay theirs) — a fixed cost of this file's shared rows, not of the
    // width being asserted. Reading it back rather than hard-coding it is
    // what keeps 240 the number that drifts loudly when the padding or
    // border above it does, instead of one that is also wrong by whatever a
    // future browser's scrollbar happens to cost.
    fixture.componentInstance.categories.set([
      {
        id: 'food',
        userId: null,
        name: 'Groceries & household supplies',
        icon: 'shopping_cart',
        color: '#2e7d32',
        type: 'expense',
        order: 0,
        isActive: true,
        isDefault: true,
      },
    ]);
    clip.style.width = '262px';
    // The wizard hands this input down as a signal read
    // (import-wizard.component.html, [categories]="categories()"), and this
    // probe's host does the same: a component that declares no
    // changeDetection strategy is OnPush by default in this Angular, so a
    // plain field reassignment would never re-run the host's own template
    // to re-evaluate the [categories] binding below.
    fixture.detectChanges();
    // The directive's own MutationObserver is what would normally notice
    // this row's text changed, but it runs outside the zone and fires from
    // a real browser callback rather than synchronously — nothing in a
    // plain (non-fakeAsync) spec waits long enough for that callback to
    // land. Re-marking every appFitText host directly is what makes the
    // flush below see them all — the amounts and r2's own category label
    // carry the directive too, and would otherwise keep the scaling they
    // computed at 288px while the card here is measured at 262.
    const registry = TestBed.inject(FitTextRegistry);
    fixture.debugElement
      .queryAll(By.directive(FitTextDirective))
      .forEach(d => registry.markDirty(d.injector.get(FitTextDirective)));
    registry.flush();

    const label = host.querySelector('[data-row-id="r1"] .category-name') as HTMLElement;
    expect(label.textContent?.trim())
      .withContext('the long category name actually reached the chip rather than the Unknown fallback')
      .toBe('Groceries & household supplies');

    const list = host.querySelector('.transactions-list') as HTMLElement;
    const scrollbarWidth = list.getBoundingClientRect().width - list.clientWidth;
    expect(getComputedStyle(list).borderInlineStartWidth)
      .withContext('the scrollbar subtraction below only equals the scrollbar when the list has no border')
      .toBe('0px');
    expect(Math.abs(card.getBoundingClientRect().width - (240 - scrollbarWidth)))
      .withContext('card at the width the arithmetic above predicts, so drift is visible')
      .toBeLessThanOrEqual(1);
    expect(card.scrollWidth)
      .withContext('nothing hiding past the card\'s right edge for a long category name')
      .toBeLessThanOrEqual(card.clientWidth + 1);
    expect(withinWidthOf(clip, el('[data-row-id="r1"] .category-button')))
      .withContext('category chip inside the clip')
      .toBeTrue();

    expect(label.scrollWidth)
      .withContext('the label\'s own box, appFitText\'s contract')
      .toBeLessThanOrEqual(label.clientWidth + 1);
    expect(parseFloat(getComputedStyle(label).fontSize))
      .withContext('scaled no further than the 12px floor')
      .toBeGreaterThanOrEqual(12);
  });
});

/**
 * Regression for 05a235d: `.extra-accept .extra-text` used to carry
 * `overflow-wrap: normal`. That did not leave the label's *box* refusing to
 * shrink — every ancestor from `.card-extras` down to here already carries
 * `min-width: 0`, so the box really did shrink to the room the strip left it
 * — it let the *ink* paint straight through that shrunk box and out past the
 * card's edge, which a box measurement (`getBoundingClientRect`,
 * `scrollWidth`) cannot see happen.
 *
 * That is exactly why the 288px guard above did not catch it: at that width
 * the pre-fix label overflowed the card by a single pixel on the machine it
 * was written on (`card.scrollWidth` 257 against a `clientWidth` of 256,
 * inside that assertion's own +1 tolerance) and only went red in CI, where a
 * font fallback renders the same string about 9px wider. Reverting the fix
 * would go green again locally and red again in CI — the same round trip.
 *
 * A single unbreakable token sidesteps the font dependency rather than
 * chasing it: no spaces for `normal` to wrap at even by accident, and long
 * enough that `normal` overflows by hundreds of pixels under any font
 * metrics. The assertion reads the painted text itself via
 * `Range.getClientRects()`, not any element's box, so this fails on
 * `overflow-wrap: normal` and passes on `break-word` regardless of which
 * platform renders it.
 */
describe('overflow guard: the currency offer label\'s ink, not just its box', () => {
  @Component({
    standalone: true,
    imports: [TransactionPreviewTableComponent],
    template: `
      <!-- Same 288px probe as the guard above; a narrower one would trip on
           the category button's min-content, a different component's floor. -->
      <div class="narrow">
        <app-transaction-preview-table [transactions]="rows" [categories]="[]" />
      </div>
    `,
    styles: ['.narrow { width: 288px; overflow: hidden; }'],
  })
  class InkOverflowProbeComponent {
    readonly rows: CategorizedImportTransaction[] = [
      {
        id: 'r1',
        description: 'Coffee',
        amount: 500,
        currency: 'USD',
        currencyFellBack: true,
        date: new Date('2026-06-01'),
        type: 'expense',
        suggestedCategoryId: 'food',
        categoryConfidence: 0.8,
        isDuplicate: false,
        selected: true,
        // No country: the same country-less shape as r2 above, which keeps
        // this fixture to the one chip the test cares about.
        currencySuggestion: { code: 'EUR', reason: 'session' },
      },
    ];
  }

  // 88 characters, no spaces or hyphens anywhere in it — the same technique
  // 05a235d's own diagnosis used. Unbroken, this is hundreds of pixels wide
  // in any font, far past the ~250px the card's content box leaves once
  // padding and the chip's own furniture are accounted for, so `normal`
  // fails by a wide margin rather than by the one pixel that let it hide.
  const UNBREAKABLE_LABEL = 'unbreakable'.repeat(8);

  let fixture: ComponentFixture<InkOverflowProbeComponent>;
  let host: HTMLElement;
  let card: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InkOverflowProbeComponent, NoopAnimationsModule],
      providers: [
        // Same shape as the mock above, with one substitution: the
        // country-less offer key renders the unbreakable token in place of
        // its usual short "Use {{currency}}?" stand-in.
        {
          provide: TranslationService,
          useValue: {
            t: (key: string, params?: Record<string, string | number>) =>
              key === 'import.currencySuggested' && params
                ? UNBREAKABLE_LABEL
                : params
                  ? `${key} ${Object.values(params).join(' ')}`
                  : key,
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            getSupportedCurrencies: () => [{ code: 'USD', nameKey: 'currencies.usd', symbol: '$' }],
            getCurrencyInfo: () => undefined,
            formatCurrency: (amount: number, code: string) =>
              new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount),
          },
        },
        { provide: CurrencyChoiceSessionService, useValue: { remember: () => undefined, current: () => null, clear: () => undefined } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InkOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    TestBed.inject(FitTextRegistry).flush();
    card = host.querySelector('.transaction-card') as HTMLElement;
  });

  afterEach(() => host.remove());

  it('keeps the offer label\'s painted ink inside the card, not just its box', () => {
    const textEl = host.querySelector('.currency-offer .extra-accept .extra-text') as HTMLElement;
    expect(textEl.textContent?.trim())
      .withContext('the unbreakable token actually rendered, so a failure below is the wrap setting and nothing else')
      .toBe(UNBREAKABLE_LABEL);

    // Range.getClientRects() over the text node is the painted extent,
    // independent of whatever box the element around it reports — the box
    // can and did shrink to fit while the ink kept going.
    const textNode = textEl.firstChild as Text;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const inkRight = Math.max(...Array.from(range.getClientRects()).map(r => r.right));

    const box = card.getBoundingClientRect();
    const contentRight = box.right - parseFloat(getComputedStyle(card).paddingRight);

    expect(inkRight)
      .withContext('the label\'s painted text stays inside the card\'s content edge, not just its own box')
      .toBeLessThanOrEqual(contentRight + 1);
  });
});
