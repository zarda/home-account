import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  ValidationErrors
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService
} from '../../../core/services/household.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { HouseholdInvite } from '../../../models';

/** The rules' bounds on a household name, judged after trimming as the service does. */
function householdName(control: AbstractControl<string>): ValidationErrors | null {
  const length = control.value.trim().length;
  return length > 0 && length <= HOUSEHOLD_NAME_MAX_LENGTH ? null : { householdName: true };
}

interface InviteView {
  invite: HouseholdInvite;
  /** The DOM id of the household's name, which describes the invite's buttons. */
  nameId: string;
  expired: boolean;
  expiry: string;
}

/**
 * What an account without a live membership can do: start a household, or
 * answer an invite addressed to it.
 *
 * Joining discloses first, in a confirm: from the moment it commits, every
 * member reads the joiner's records, and the receipt photos go with them
 * through links no rule governs.
 */
@Component({
  selector: 'app-household-setup',
  standalone: true,
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, ReactiveFormsModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-setup.component.html',
  styleUrl: './household-setup.component.scss'
})
export class HouseholdSetupComponent {
  private readonly household = inject(HouseholdService);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);
  private readonly dateFormat = inject(DateFormatService);
  private readonly dialog = inject(MatDialog);

  readonly maxLength = HOUSEHOLD_NAME_MAX_LENGTH;
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [householdName] })
  });
  /**
   * The submit marked the directive submitted, and Material shows an invalid
   * control's error for a submitted form: only the directive's reset clears
   * that flag, so an emptied field is not refused.
   */
  private readonly formDirective = viewChild.required(FormGroupDirective);
  readonly creating = signal(false);
  /** The invite whose answer is on its way; every invite waits for it. */
  readonly answering = signal<string | null>(null);

  /**
   * Expiry is judged when the list last changed, which is close enough to
   * hide a button: the rules judge it again, by the server's clock, when an
   * invite is accepted.
   */
  readonly invites = computed<InviteView[]>(() => {
    const now = Date.now();
    return this.household.receivedInvites().map(invite => ({
      invite,
      nameId: `household-invite-${invite.id}`,
      expired: invite.expiresAt.toMillis() <= now,
      expiry: this.dateFormat.formatDate(invite.expiresAt)
    }));
  });

  async create(): Promise<void> {
    if (this.creating()) return;
    const name = this.form.controls.name;
    name.markAsTouched();
    if (name.invalid) return;

    this.creating.set(true);
    try {
      await this.household.create(name.value.trim());
      this.formDirective().resetForm();
      this.notification.success(this.translation.t('household.setup.created'));
    } catch (error) {
      this.notification.error(this.messageOf(error));
    } finally {
      this.creating.set(false);
    }
  }

  accept(invite: HouseholdInvite): void {
    if (this.answering()) return;
    const data: ConfirmDialogData = {
      title: this.translation.t('household.setup.acceptTitle', { name: invite.householdName }),
      message: this.translation.t('household.setup.acceptDisclosure', { name: invite.householdName }),
      confirmLabel: this.translation.t('household.setup.acceptConfirm'),
      icon: 'groups'
    };
    this.dialog
      .open(ConfirmDialogComponent, { data })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed === true) void this.join(invite);
      });
  }

  async decline(invite: HouseholdInvite): Promise<void> {
    await this.answer(invite, async () => {
      await this.household.decline(invite.householdId);
      this.notification.success(this.translation.t('household.setup.declined'));
    });
  }

  private async join(invite: HouseholdInvite): Promise<void> {
    await this.answer(invite, async () => {
      await this.household.accept(invite.householdId);
      this.notification.success(this.translation.t('household.setup.joined', { name: invite.householdName }));
    });
  }

  private async answer(invite: HouseholdInvite, work: () => Promise<void>): Promise<void> {
    if (this.answering()) return;
    this.answering.set(invite.id);
    try {
      await work();
    } catch (error) {
      this.notification.error(this.messageOf(error));
    } finally {
      this.answering.set(null);
    }
  }

  /** The service words every refusal in the reader's language already. */
  private messageOf(error: unknown): string {
    return error instanceof HouseholdError ? error.message : this.translation.t('errors.generic');
  }
}
