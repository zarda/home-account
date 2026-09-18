import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject } from 'rxjs';

import { HeaderComponent } from './header.component';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { User } from '../../../models';

/**
 * `header.component.spec.ts` blanks the template (`overrideComponent` ->
 * `template: ''`), so it cannot host this proof: the real avatar `<img>`
 * has to be in the DOM for its error event to mean anything. Providers
 * mirror that spec's AuthService/BreakpointObserver/MatDialog shape, plus a
 * real TranslationService stub and `provideRouter([])` — the real template
 * puts a `routerLink` inside the user menu, which needs an `ActivatedRoute`
 * that spec's hand-rolled Router mock never had to supply.
 */
describe('overflow guard: the header avatar', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let host: HTMLElement;
  let mockAuth: { currentUser: ReturnType<typeof signal<User | null>> };

  const userWith = (photoURL: string): User => ({
    id: 'u1',
    displayName: 'Tester',
    photoURL,
  } as User);

  beforeEach(async () => {
    mockAuth = { currentUser: signal<User | null>(userWith('https://example.com/a.png')) };
    const viewport$ = new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} });
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    await TestBed.configureTestingModule({
      imports: [HeaderComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: mockAuth },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: BreakpointObserver, useValue: { observe: () => viewport$.asObservable() } },
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  });

  afterEach(() => {
    host?.remove();
  });

  const avatarImg = (): HTMLImageElement | null => host.querySelector('.user-menu-button img.user-avatar');
  const avatarIcon = (): Element | null => host.querySelector('.user-menu-button mat-icon');

  it('falls back to the placeholder icon when the photo fails to load, and recovers on a new URL', () => {
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img before any error').toBeTruthy();
    expect(avatarIcon()).withContext('placeholder icon before any error').toBeFalsy();

    avatarImg()!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img after the photo fails').toBeFalsy();
    expect(avatarIcon()).withContext('placeholder icon after the photo fails').toBeTruthy();

    mockAuth.currentUser.set(userWith('https://example.com/b.png'));
    fixture.detectChanges();

    expect(avatarImg()).withContext('avatar img after a new photo URL arrives').toBeTruthy();
    expect(avatarIcon()).withContext('placeholder icon after a new photo URL arrives').toBeFalsy();
  });
});
