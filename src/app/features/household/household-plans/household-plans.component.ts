import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { AuthService } from '../../../core/services/auth.service';
import { HouseholdLedgerService, LedgerBudget } from '../../../core/services/household-ledger.service';
import { PwaService } from '../../../core/services/pwa.service';
import { Category, Goal, HouseholdMemberIdentity } from '../../../models';
import { LoadingSpinnerComponent } from '../../../shared/components/loading-spinner/loading-spinner.component';
import { MemberChipComponent } from '../../../shared/components/member-chip/member-chip.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { BudgetProgressCardComponent } from '../../budgets/budget-progress-card/budget-progress-card.component';
import { GoalProgressCardComponent } from '../../budgets/goals/goal-progress-card/goal-progress-card.component';

interface BudgetView {
  budget: LedgerBudget;
  /** Resolved through the budget's own member's categories. */
  category: Category | undefined;
}

/** One member's budgets and goals, as their group shows them. */
interface MemberPlans {
  member: HouseholdMemberIdentity;
  /** Empty when the member gave no name; the template names them generically. */
  name: string;
  budgets: BudgetView[];
  goals: Goal[];
  /** Offline, and nothing of another member's cached: the group says so in place of calling them empty. */
  notLoaded: boolean;
  /**
   * Nothing to show, and one of their budgets or goals listeners failed
   * before it answered: not known to have none, so not called empty.
   */
  readFailed: boolean;
}

interface MemberNotice {
  kind: 'budgetsIncomplete' | 'goalsIncomplete';
  member: HouseholdMemberIdentity;
  /** Empty when the member gave no name; the template names them generically. */
  name: string;
}

/**
 * Every member's active budgets and goals, grouped by member, on the Budgets
 * page's own cards with nothing on them to act: only a budget's or goal's
 * owner can change it, the viewer's own included here, since the page is a
 * view of the household rather than a place to manage one's own.
 *
 * Each card keeps its own currency, as on its owner's Budgets page: a budget
 * is a limit its owner set in that currency, and converting it would show a
 * figure they never chose.
 *
 * A budget's stored spending belongs to the period it was summed for, and
 * only its owner can sum it again. One summed for another period reads 0,
 * and its card says why rather than passing the 0 off as nothing spent.
 */
@Component({
  selector: 'app-household-plans',
  standalone: true,
  imports: [
    BudgetProgressCardComponent,
    GoalProgressCardComponent,
    LoadingSpinnerComponent,
    MatIconModule,
    MemberChipComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-plans.component.html',
  styleUrl: './household-plans.component.scss'
})
export class HouseholdPlansComponent {
  private readonly ledger = inject(HouseholdLedgerService);
  private readonly auth = inject(AuthService);
  private readonly isOnline = inject(PwaService).isOnline;

  /**
   * Offline, every answer comes from what this device cached, so nothing
   * waits. Online, only the budgets, goals and categories are waited on: a
   * new period re-reads the rows, and nothing here depends on them.
   */
  readonly loading = computed(() => this.isOnline() && this.ledger.plansLoading());

  readonly groups = computed<MemberPlans[]>(() => {
    const categories = this.ledger.categoriesByMember();
    const offline = !this.isOnline();
    const me = this.auth.userId();
    const incomplete = this.ledger.incomplete();
    const failed = new Set([...incomplete.budgets, ...incomplete.goals].map(member => member.uid));

    // Both lists hold the ledger's shown members, in the same order.
    const goalsOf = new Map(this.ledger.goalsByMember().map(({ member, goals }) => [member.uid, goals]));
    return this.ledger.budgetsByMember().map(({ member, budgets }) => {
      const goals = goalsOf.get(member.uid) ?? [];
      const none = budgets.length === 0 && goals.length === 0;
      // A custom category's id means nothing in another member's categories.
      const own = categories.get(member.uid);
      return {
        member,
        name: member.displayName.trim(),
        budgets: budgets.map(budget => ({ budget, category: own?.get(budget.categoryId) })),
        goals,
        // Offline, an uncached listener answers empty, so another member
        // showing nothing is not known to have nothing. The viewer's own
        // are nearly always cached from their own Budgets page, as the
        // overview holds for their rows.
        notLoaded: offline && member.uid !== me && none,
        readFailed: failed.has(member.uid) && none
      };
    });
  });

  /**
   * Only what this section shows is spoken for: an unread budgets or goals
   * listener may leave a member's group short. Unread transactions belong to
   * the overview, and so do unread categories, though a budget card here
   * shows its category too: the overview's one note speaks for both
   * sections, which the page always shows together.
   */
  readonly notices = computed<MemberNotice[]>(() => {
    const notice = (kind: MemberNotice['kind']) => (member: HouseholdMemberIdentity): MemberNotice =>
      ({ kind, member, name: member.displayName.trim() });
    const incomplete = this.ledger.incomplete();
    return [
      ...incomplete.budgets.map(notice('budgetsIncomplete')),
      ...incomplete.goals.map(notice('goalsIncomplete'))
    ];
  });
}
