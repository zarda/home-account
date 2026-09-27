import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * The household's budgets and goals. A member's own budgets and goals are
 * private to them and are never read here: a household's plans are its own,
 * and this section reads none yet, so it says there are none.
 */
@Component({
  selector: 'app-household-plans',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-plans.component.html',
  styleUrl: './household-plans.component.scss'
})
export class HouseholdPlansComponent {}
