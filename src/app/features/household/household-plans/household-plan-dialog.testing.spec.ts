import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

import { provideNoMotion } from '../../../core/services/testing';
import { auditPlanDialog } from './household-plan-dialog.testing';

/**
 * A plan dialog whose content runs far below Karma's 413px frame, its last
 * line drawn white on a pale grey that no theme can rescue. A link at the top
 * keeps the scrolling content reachable by keyboard, so contrast is all axe
 * has to say about it.
 */
@Component({
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Plan</h2>
    <mat-dialog-content [style.overflow]="overflow()">
      <p><a href="#plan">Above the fold</a></p>
      <div style="height: 900px"></div>
      <p class="faint" style="color: #fff; background: #eee">Below the fold</p>
    </mat-dialog-content>
    <mat-dialog-actions><button mat-button mat-dialog-close>Close</button></mat-dialog-actions>
  `,
})
class TallPlanDialog {
  /** `visible` takes the scroll from the content, as a surface that clipped it instead would. */
  readonly overflow = signal<'auto' | 'visible'>('auto');
}

/** A plan dialog rebuilt without a content area: its words sit straight on the surface. */
@Component({
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Plan</h2>
    <p>No content area</p>
    <mat-dialog-actions><button mat-button mat-dialog-close>Close</button></mat-dialog-actions>
  `,
})
class BarePlanDialog {}

describe('auditPlanDialog', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideNoMotion()] });
  });

  it('scores a line that only a scroll through the content brings into view', async () => {
    const audit = await auditPlanDialog(TallPlanDialog, {}, 'light-theme');

    expect(audit.stops).withContext('the content is taller than the frame').toBeGreaterThan(1);
    expect(audit.violations.filter(line => line.startsWith('color-contrast')).join('\n'))
      .withContext('the faint line at the content end')
      .toContain('.faint');
  });

  it('refuses a dialog with no content area rather than audit it in one blind pass', async () => {
    await expectAsync(auditPlanDialog(BarePlanDialog, {}, 'light-theme'))
      .toBeRejectedWithError(/no \.mat-mdc-dialog-content to scroll through/);
  });

  it('refuses a content area whose last stop does not show its end', async () => {
    await expectAsync(auditPlanDialog(TallPlanDialog, {}, 'light-theme', dialog => dialog.overflow.set('visible')))
      .toBeRejectedWithError(/never showed the end of its content/);
  });
});
