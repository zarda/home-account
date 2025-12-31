import { Component, Input, Output, EventEmitter } from '@angular/core';
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
  @Input({ required: true }) budgets: Budget[] = [];
  @Input({ required: true }) categories = new Map<string, Category>();

  @Output() edit = new EventEmitter<Budget>();
  @Output() delete = new EventEmitter<Budget>();

  getCategory(categoryId: string): Category | undefined {
    return this.categories.get(categoryId);
  }
}
