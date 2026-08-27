import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { DialogHeaderComponent } from '../dialog-header/dialog-header.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * What a closed welcome asks the app to do next. Anything else — Done, Skip,
 * the close-X, the backdrop, Escape — closes with no result; OnboardingService
 * treats them all the same and marks the first run complete either way.
 */
export type OnboardingResult = 'add' | 'scan';

/** Panes, in order: welcome, how money gets in, get started. */
const TOTAL_STEPS = 3;

/**
 * The first-run welcome: three panes and a footer.
 *
 * A plain step signal with `@if` panes rather than a `mat-stepper`. Nothing
 * else in this app puts a stepper inside a dialog, a stepper's header would
 * duplicate the footer's own step count, and its animation is one more thing
 * to reason about on the very first surface a new account sees. The
 * computed view guards are the in-dialog idiom AiSearchDialogComponent
 * already uses.
 */
@Component({
  selector: 'app-onboarding-dialog',
  standalone: true,
  imports: [DialogHeaderComponent, MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding-dialog.component.html',
  styleUrl: './onboarding-dialog.component.scss',
})
export class OnboardingDialogComponent {
  private dialogRef = inject(MatDialogRef<OnboardingDialogComponent, OnboardingResult | undefined>);

  private stepIndex = signal(0);

  readonly totalSteps = TOTAL_STEPS;

  /** Zero-based index of the visible pane. */
  step = this.stepIndex.asReadonly();

  isFirstStep = computed(() => this.stepIndex() === 0);
  isLastStep = computed(() => this.stepIndex() === TOTAL_STEPS - 1);

  /** Skipping is only on offer while there is something left to read. */
  canSkip = computed(() => !this.isLastStep());

  next(): void {
    this.stepIndex.update(step => Math.min(step + 1, TOTAL_STEPS - 1));
  }

  back(): void {
    this.stepIndex.update(step => Math.max(step - 1, 0));
  }

  skip(): void {
    this.dialogRef.close();
  }

  done(): void {
    this.dialogRef.close();
  }

  addFirst(): void {
    this.dialogRef.close('add');
  }

  scanFirst(): void {
    this.dialogRef.close('scan');
  }
}
