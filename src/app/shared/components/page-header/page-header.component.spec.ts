import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageHeaderComponent } from './page-header.component';
import { TranslationService } from '../../../core/services/translation.service';

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <app-page-header titleKey="reports.title" subtitleKey="reports.subtitle">
      <span header-title-suffix class="count">(42)</span>
      <button header-actions class="action">Export</button>
    </app-page-header>
  `,
})
class HostComponent {}

describe('PageHeaderComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: TranslationService, useValue: translation }],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('renders the translated title as the page h1', () => {
    const h1: HTMLElement = fixture.nativeElement.querySelector('h1.page-title');
    expect(h1.textContent).toContain('t:reports.title');
  });

  it('renders the translated subtitle when a key is given', () => {
    const subtitle: HTMLElement = fixture.nativeElement.querySelector('.page-subtitle');
    expect(subtitle.textContent).toContain('t:reports.subtitle');
  });

  it('projects the title suffix inline with the title', () => {
    const h1: HTMLElement = fixture.nativeElement.querySelector('h1.page-title');
    expect(h1.querySelector('.count')?.textContent).toBe('(42)');
  });

  it('projects actions into the actions slot', () => {
    const actions: HTMLElement = fixture.nativeElement.querySelector('.page-header-actions');
    expect(actions.querySelector('button.action')).not.toBeNull();
  });

  it('omits the subtitle element without a subtitle key', async () => {
    @Component({
      standalone: true,
      imports: [PageHeaderComponent],
      template: `<app-page-header titleKey="budget.title" />`,
    })
    class BareHostComponent {}

    const bare = TestBed.createComponent(BareHostComponent);
    bare.detectChanges();
    expect(bare.nativeElement.querySelector('.page-subtitle')).toBeNull();
  });
});
