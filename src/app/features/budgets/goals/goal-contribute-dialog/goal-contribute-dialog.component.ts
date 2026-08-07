import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';

import { Goal } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { DialogHeaderComponent } from '../../../../shared/components/dialog-header/dialog-header.component';

export interface GoalContributeDialogData {
  goal: Goal;
}

/**
 * One amount in, one signed number out: positive to add, negative to take
 * back. The service enforces the below-zero floor transactionally; this
 * dialog only shapes the intent.
 */
@Component({
  selector: 'app-goal-contribute-dialog',
  standalone: true,
  imports: [
    DialogHeaderComponent,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    TranslatePipe
  ],
  templateUrl: './goal-contribute-dialog.component.html',
  styleUrl: './goal-contribute-dialog.component.scss'
})
export class GoalContributeDialogComponent {
  private dialogRef = inject(MatDialogRef<GoalContributeDialogComponent>);
  data: GoalContributeDialogData = inject(MAT_DIALOG_DATA);

  direction: 'add' | 'withdraw' = 'add';
  amount: number | null = null;

  get isValid(): boolean {
    return this.amount !== null && this.amount > 0;
  }

  onConfirm(): void {
    if (!this.isValid) return;
    const amount = this.amount as number;
    this.dialogRef.close(this.direction === 'withdraw' ? -amount : amount);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
