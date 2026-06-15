import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SidebarComponent } from './sidebar.component';
import { TranslationService } from '../../../core/services/translation.service';

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;

  beforeEach(async () => {
    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('builds translated nav items for every route', () => {
    const items = component.navItems();
    expect(items.length).toBe(7);
    expect(items.map((i) => i.route)).toContain('/dashboard');
    expect(items[0].label).toBe('t:nav.dashboard');
    expect(mockTranslationService.t).toHaveBeenCalledWith('nav.dashboard');
  });

  it('emits when a nav item is clicked', () => {
    const spy = jasmine.createSpy('navItemClicked');
    component.navItemClicked.subscribe(spy);
    component.onNavClick();
    expect(spy).toHaveBeenCalled();
  });
});
