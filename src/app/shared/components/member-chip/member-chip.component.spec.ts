import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MemberChipComponent } from './member-chip.component';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';
import { HouseholdMemberIdentity } from '../../../models';

/**
 * Account pictures as Google serves them, the only host a chip loads from.
 * Whether one really loads depends on the network, so a case that needs a
 * failure raises the image's error itself.
 */
const PICTURE = 'https://lh3.googleusercontent.com/a/member-chip-picture';
const OTHER_PICTURE = 'https://lh5.googleusercontent.com/a/member-chip-other-picture';

/**
 * The text a screen reader meets inside an element: what is hidden from it
 * is skipped, and an image counts by its alt.
 */
function readableText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (node.getAttribute('aria-hidden') === 'true') return '';
  if (node instanceof HTMLImageElement) return node.alt;
  return Array.from(node.childNodes).map(readableText).join('');
}

// Rendered throughout (ADR 0144): what the chip shows and what it says are
// the whole of it.
describe('MemberChipComponent', () => {
  let fixture: ComponentFixture<MemberChipComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const photo = (): HTMLImageElement | null => element().querySelector('img');
  const initial = (): string => element().querySelector('.member-initial')?.textContent?.trim() ?? '';
  const spoken = (): string => readableText(element()).replace(/\s+/g, ' ').trim();

  function show(member: HouseholdMemberIdentity): void {
    fixture.componentRef.setInput('member', member);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemberChipComponent],
      providers: [{ provide: TranslationService, useValue: createTranslationStub() }]
    }).compileComponents();

    fixture = TestBed.createComponent(MemberChipComponent);
  });

  it('shows the picture, kept from sending the page as a referrer', () => {
    show({ uid: 'kai', displayName: 'Kai Lin', photoURL: PICTURE });
    const img = photo();

    expect(img).withContext('the picture').not.toBeNull();
    expect(img?.getAttribute('src')).toBe(PICTURE);
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');

    img?.dispatchEvent(new Event('load'));
    fixture.detectChanges();

    expect(photo()).withContext('still shown once loaded').not.toBeNull();
    expect(initial()).toBe('');
  });

  it("loads no picture from any other address, showing the name's initial instead", () => {
    // Whoever serves the picture learns each viewer's address and when they
    // look: only the sign-in provider's picture hosts are trusted with that.
    for (const photoURL of [
      'https://example.test/pixel.png',
      'https://lh3.googleusercontent.com.example.test/a/x',
      'https://evil.test/https://lh3.googleusercontent.com/a/x',
      'http://lh3.googleusercontent.com/a/x',
      'data:image/png;base64,AAAA'
    ]) {
      show({ uid: 'kai', displayName: 'Kai', photoURL });

      expect(photo()).withContext(photoURL).toBeNull();
      expect(initial()).withContext(photoURL).toBe('K');
    }
  });

  it("shows the name's initial when the picture fails", () => {
    show({ uid: 'kai', displayName: 'kai Lin', photoURL: PICTURE });

    photo()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(photo()).toBeNull();
    expect(initial()).toBe('K');
  });

  it('shows the initial with no picture', () => {
    show({ uid: 'sam', displayName: 'Sam' });

    expect(photo()).toBeNull();
    expect(initial()).toBe('S');
  });

  it('tries a new picture after an old one failed', () => {
    show({ uid: 'kai', displayName: 'Kai', photoURL: PICTURE });
    photo()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    show({ uid: 'kai', displayName: 'Kai', photoURL: OTHER_PICTURE });

    expect(photo()?.getAttribute('src')).toBe(OTHER_PICTURE);
  });

  it("is read as the member's name, whether a picture or an initial is shown", () => {
    show({ uid: 'kai', displayName: 'Kai Lin', photoURL: PICTURE });

    expect(element().getAttribute('aria-hidden')).withContext('not hidden').toBeNull();
    expect(spoken()).toBe('Kai Lin');

    show({ uid: 'sam', displayName: 'Sam' });

    expect(spoken()).toBe('Sam');
  });

  it('names a member who gave no name', () => {
    show({ uid: 'anon', displayName: '  ' });

    expect(spoken()).toBe('household.unnamedMember');
    expect(initial()).toBe('');
    expect(element().querySelector('.member-avatar')).withContext('an avatar all the same').not.toBeNull();
  });

  it('keeps a long name whole, wrapping rather than cut', () => {
    const name = 'Maximiliane-Alexandra Wolfeschlegelsteinhausenbergerdorff';
    show({ uid: 'long', displayName: name });

    const text = element().querySelector('.member-name') as HTMLElement;
    expect(text.textContent?.trim()).toBe(name);
    expect(getComputedStyle(text).textOverflow).not.toBe('ellipsis');
    expect(getComputedStyle(text).overflowWrap).toBe('anywhere');
  });
});
