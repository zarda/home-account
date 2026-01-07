import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface SpeedDialAction {
  id: string;
  icon: string;
  label: string;
  color?: 'primary' | 'accent' | 'warn';
  visible?: boolean;
}

@Component({
  selector: 'app-speed-dial-fab',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './speed-dial-fab.component.html',
  styleUrl: './speed-dial-fab.component.scss',
})
export class SpeedDialFabComponent {
  @Input() actions: SpeedDialAction[] = [];
  @Input() mainIcon = 'add';
  @Input() mainIconOpen = 'close';
  @Input() mainColor: 'primary' | 'accent' | 'warn' = 'primary';
  @Output() actionClick = new EventEmitter<string>();

  isOpen = signal(false);

  toggle(): void {
    this.isOpen.update(v => !v);
  }

  close(): void {
    this.isOpen.set(false);
  }

  onActionClick(actionId: string): void {
    this.actionClick.emit(actionId);
    this.close();
  }

  get visibleActions(): SpeedDialAction[] {
    return this.actions.filter(a => a.visible !== false);
  }
}
