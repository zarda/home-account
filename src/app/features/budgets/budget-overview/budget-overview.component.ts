import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Budget, Category } from '../../../models';
import { BudgetProgressCardComponent } from '../budget-progress-card/budget-progress-card.component';

@Component({
  selector: 'app-budget-overview',
  standalone: true,
  imports: [CommonModule, BudgetProgressCardComponent],
  templateUrl: './budget-overview.component.html',
  styleUrl: './budget-overview.component.scss'
})
export class BudgetOverviewComponent {
  // Modern Angular 21: signal-based inputs/outputs
  budgets = input.required<Budget[]>();
  categories = input.required<Map<string, Category>>();

  edit = output<Budget>();
  delete = output<Budget>();

  getCategory(categoryId: string): Category | undefined {
    return this.categories().get(categoryId);
  }
}
