import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReadableOnPipe } from './readable-on.pipe';
import { readableOn } from '../../core/utils/color-contrast.utils';
import { paintedBackground, paintedColor, ratio } from '../../core/services/testing';
import {
  CATEGORY_FALLBACK_COLOR,
  CATEGORY_PALETTE,
  DEFAULT_EXPENSE_GROUPS,
  DEFAULT_INCOME_GROUPS,
} from '../../models';

/** The sixteen seeded colours, the picker's fifteen and the fallback grey among them. */
const CATEGORY_COLOURS = [
  ...new Set(
    [
      ...[...DEFAULT_EXPENSE_GROUPS, ...DEFAULT_INCOME_GROUPS].map(group => group.color),
      ...CATEGORY_PALETTE,
      CATEGORY_FALLBACK_COLOR,
    ].map(color => color.toLowerCase())
  ),
];

describe('ReadableOnPipe', () => {
  const pipe = new ReadableOnPipe();

  it('answers readableOn for every colour a category can carry', () => {
    expect(CATEGORY_COLOURS.length).toBe(31);
    for (const fill of CATEGORY_COLOURS) {
      expect(pipe.transform(fill)).withContext(fill).toBe(readableOn(fill));
      expect(['#000000', '#ffffff']).withContext(fill).toContain(pipe.transform(fill));
    }
  });

  it('is white on a fill it cannot read, and on none', () => {
    for (const fill of ['', 'rebeccapurple', '#ff980080', null, undefined]) {
      expect(pipe.transform(fill)).withContext(String(fill)).toBe('#ffffff');
    }
  });
});

@Component({
  selector: 'app-readable-on-host',
  standalone: true,
  imports: [ReadableOnPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tile" [style.background-color]="fill()" [attr.data-n]="n()">
      <span class="glyph" [style.color]="fill() | readableOn">restaurant</span>
    </span>
  `,
})
class ReadableOnHostComponent {
  readonly fill = signal('#8BC34A');
  /** Runs the OnPush template again without touching the fill. */
  readonly n = signal(0);
}

describe('ReadableOnPipe in a template', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReadableOnHostComponent] });
  });

  it('paints the glyph at 4.58:1 or more on its fill, for every colour a category can carry', () => {
    const fixture = TestBed.createComponent(ReadableOnHostComponent);
    fixture.autoDetectChanges();
    const glyph = () => fixture.nativeElement.querySelector('.glyph') as HTMLElement;

    for (const fill of CATEGORY_COLOURS) {
      fixture.componentInstance.fill.set(fill);
      TestBed.tick();
      expect(ratio(paintedColor(glyph()), paintedBackground(glyph())))
        .withContext(fill)
        .toBeGreaterThanOrEqual(4.58);
    }
  });

  it('is pure: an unchanged fill is not worked out again', () => {
    const transform = spyOn(ReadableOnPipe.prototype, 'transform').and.callThrough();
    const fixture = TestBed.createComponent(ReadableOnHostComponent);
    const tile = () => fixture.nativeElement.querySelector('.tile') as HTMLElement;

    fixture.detectChanges();
    const first = transform.calls.count();
    expect(first).toBeGreaterThan(0);
    fixture.componentInstance.n.update(n => n + 1);
    fixture.detectChanges();
    expect(tile().getAttribute('data-n')).withContext('the template ran again').toBe('1');
    expect(transform.calls.count()).withContext('a check with the same fill').toBe(first);

    fixture.componentInstance.fill.set('#3F51B5');
    fixture.detectChanges();
    expect(transform.calls.count()).withContext('a new fill').toBeGreaterThan(first);
  });
});
