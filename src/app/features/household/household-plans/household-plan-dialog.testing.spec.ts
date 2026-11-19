import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import axe, { type AxeResults, type IncompleteResult, type RunOptions } from 'axe-core';

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

  it('scores the same line when an earlier spec left the page scrolled far down', async () => {
    // Jasmine's report outgrows Karma's frame, and a focus() on a fixture
    // appended below it scrolls the page; the audit then runs wherever that left it.
    const page = document.scrollingElement!;
    const before = page.scrollTop;
    const tall = document.body.appendChild(document.createElement('div'));
    tall.style.height = '3000px';
    try {
      window.scrollTo({ top: 1700, behavior: 'instant' });
      expect(page.scrollTop).withContext('the page is scrolled before the audit').toBe(1700);

      const audit = await auditPlanDialog(TallPlanDialog, {}, 'light-theme');

      expect(audit.stops).withContext('the content is taller than the frame').toBeGreaterThan(1);
      expect(audit.violations.filter(line => line.startsWith('color-contrast')).join('\n'))
        .withContext('the faint line at the content end')
        .toContain('.faint');
      expect(page.scrollTop).withContext('the page is left where the audit found it').toBe(1700);
    } finally {
      tall.remove();
      window.scrollTo({ top: before, behavior: 'instant' });
    }
  });

  it('refuses a dialog with no content area rather than audit it in one blind pass', async () => {
    await expectAsync(auditPlanDialog(BarePlanDialog, {}, 'light-theme'))
      .toBeRejectedWithError(/no \.mat-mdc-dialog-content to scroll through/);
  });

  it('refuses a content area whose last stop does not show its end', async () => {
    await expectAsync(auditPlanDialog(TallPlanDialog, {}, 'light-theme', dialog => dialog.overflow.set('visible')))
      .toBeRejectedWithError(/never showed the end of its content/);
  });

  it('refuses a stop at which axe skipped a rule on an error rather than read it clean', async () => {
    // Any rule at any stop: the second stop's results gain a rule filed as
    // axe files one that threw, under `incomplete` with its error.
    const run = axe.run.bind(axe) as (context: Element, options: RunOptions) => Promise<AxeResults>;
    let calls = 0;
    spyOn(axe, 'run').and.callFake(((context: Element, options: RunOptions) =>
      run(context, options).then(results => {
        if (++calls < 2) return results;
        const skipped = { id: 'aria-allowed-attr', error: { name: 'TypeError', message: 'planted', stack: '' } };
        return { ...results, incomplete: [...results.incomplete, skipped as IncompleteResult] };
      })) as unknown as typeof axe.run);

    await expectAsync(auditPlanDialog(TallPlanDialog, {}, 'light-theme'))
      .toBeRejectedWithError(/axe skipped aria-allowed-attr \(planted\) on an error at stop 2\b/);
  });

  it('refuses the sweep when the page stays pinned above the viewport and color-contrast throws', async () => {
    // The CDK will not pin a page it finds already pinned, and the page-top
    // reset cannot scroll a pinned page, so <html> stays fixed 1700px up with
    // body wholly above the viewport: what the CDK made of a page left
    // scrolled before the reset.
    const root = document.documentElement;
    const tall = document.body.appendChild(document.createElement('div'));
    tall.style.height = '3000px';
    root.classList.add('cdk-global-scrollblock');
    root.style.top = '-1700px';
    try {
      await expectAsync(auditPlanDialog(TallPlanDialog, {}, 'light-theme'))
        .toBeRejectedWithError(/axe skipped color-contrast \(.+\) on an error at stop 1\b/);
    } finally {
      root.classList.remove('cdk-global-scrollblock');
      root.style.removeProperty('top');
      tall.remove();
    }
  });
});
