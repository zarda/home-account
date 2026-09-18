import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SidebarComponent } from './sidebar.component';
import { TranslationService } from '../../../core/services/translation.service';

/** Somewhere for the test router to land; the nav is what is under test. */
@Component({ standalone: true, template: '' })
class StubPage {}

/**
 * Material's `.mat-mdc-list-item` sets `width: 100%` on the row, and
 * `.nav-item`'s own `margin: 0 8px 4px 8px` sits outside that full-width box
 * rather than inside it — the row is 100% of the nav plus 16px, and the nav
 * carries it past its own edge. 255px is the drawer's own rendered width
 * (Task 8), narrow enough that 16px of overflow is not lost in the scrollbar
 * gutter.
 */
const SIDEBAR_WIDTH = 255;

describe('overflow guard: the sidebar nav', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, NoopAnimationsModule],
      providers: [
        provideRouter([
          { path: 'dashboard', component: StubPage },
          { path: 'dashboard/detail', component: StubPage },
          { path: 'budgets', component: StubPage },
          { path: 'reports', component: StubPage },
          { path: 'data', component: StubPage },
        ]),
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    host = fixture.nativeElement as HTMLElement;
    host.style.width = `${SIDEBAR_WIDTH}px`;
    host.style.display = 'block';
    document.body.appendChild(host);
    fixture.detectChanges();
  });

  afterEach(() => {
    host?.remove();
  });

  it('never scrolls the drawer sideways to reach a nav row', () => {
    const nav = host.querySelector('nav') as HTMLElement;
    expect(nav.scrollWidth)
      .withContext('nav scrollWidth vs clientWidth at the drawer width')
      .toBeLessThanOrEqual(nav.clientWidth + 1);
  });
});
