import { ANIMATION_MODULE_TYPE, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoMotion } from './index';

@Component({ selector: 'app-no-motion-host', template: '<p>host</p>' })
class HostComponent {}

@Component({ selector: 'app-no-motion-dialog', template: '<p>dialog body</p>' })
class DialogBodyComponent {}

const panes = (): number => document.querySelectorAll('.cdk-overlay-pane').length;

describe('provideNoMotion', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideNoMotion()] });
  });

  it('answers the animation token with NoopAnimations', () => {
    expect(TestBed.inject(ANIMATION_MODULE_TYPE)).toBe('NoopAnimations');
  });

  it('lets a dialog leave the DOM as soon as the app is stable, with no animationend', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    const ref = TestBed.inject(MatDialog).open(DialogBodyComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panes()).toBe(1);

    ref.close();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(panes()).toBe(0);
  });

  it('opens a snackbar without its animation class and lets it leave the DOM once the app is stable', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    const ref = TestBed.inject(MatSnackBar).open('Saved');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panes()).toBe(1);
    // In zone mode the exit fallback timer is a task the app waits for, so settling alone cannot tell the two
    // apart; the container's own class is what Material reads the token into.
    const container = document.querySelector('.mat-mdc-snack-bar-container');
    expect(container).not.toBeNull();
    expect(container?.classList.contains('mat-snack-bar-container-animations-enabled')).toBe(false);

    ref.dismiss();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(panes()).toBe(0);
  });
});
