import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService,
  householdNameValidator
} from '../../../core/services/household.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { HouseholdInvite } from '../../../models';
import { FocusContext, HouseholdPageFocus, focusWhenRendered } from '../household-focus';

interface InviteView {
  invite: HouseholdInvite;
  /** The DOM id of the household's name, which describes the invite's buttons. */
  nameId: string;
  /** The inviter's verified address; null when their provider vouched for none. */
  inviterEmail: string | null;
  expired: boolean;
  expiry: string;
}

/**
 * What an account without a live membership can do: start a household, or
 * answer an invite addressed to it.
 *
 * Joining discloses first, in a confirm: from the moment it commits, every
 * member reads the joiner's records, and the receipt photos go with them
 * through links no rule governs. The confirm names the inviter by the address
 * their provider verified, or says there is none: the name on the invite is
 * one the inviter chose.
 *
 * Each button stays focusable while an answer is on its way, so focus is not
 * dropped on the document; the answer in flight is what refuses a second
 * press. Declining takes the invite's row, and focus, away, so focus goes on to
 * the list's heading.
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
  private readonly analytics = inject(AnalyticsService);
  private readonly isOnline = inject(PwaService).isOnline;
  private readonly pageFocus = inject(HouseholdPageFocus);
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: inject(DestroyRef)
  };
  /** A declined invite whose row, and the focus on it, has yet to go. */
  private readonly declined = signal<string | null>(null);

  readonly maxLength = HOUSEHOLD_NAME_MAX_LENGTH;
  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [householdNameValidator] })
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
      inviterEmail: invite.inviterEmail || null,
      expired: invite.expiresAt.toMillis() <= now,
      expiry: this.dateFormat.formatDate(invite.expiresAt)
    }));
  });

  constructor() {
    effect(() => {
      const declined = this.declined();
      if (declined === null || this.invites().some(view => view.invite.id === declined)) return;
      untracked(() => {
        this.declined.set(null);
        focusWhenRendered(this.focus, ['#household-invites-title']);
      });
    });
  }

  async create(): Promise<void> {
    if (this.creating()) return;
    const name = this.form.controls.name;
    name.markAsTouched();
    if (name.invalid) return;

    this.creating.set(true);
    try {
      await this.household.create(name.value.trim());
      this.formDirective().resetForm();
      this.pageFocus.afterSwapTo('member');
      this.notification.success(this.translation.t('household.setup.created'));
      this.analytics.trackHouseholdAction({ action: 'create' });
    } catch (error) {
      this.notification.error(this.messageOf(error));
    } finally {
      this.creating.set(false);
    }
  }

  accept(invite: HouseholdInvite): void {
    if (this.answering()) return;
    // The service refuses offline too, but only once it is called, which is
    // after the whole disclosure has been read and confirmed; it still
    // catches a connection lost while the dialog is open.
    if (!this.isOnline()) {
      this.notification.error(this.translation.t('household.errors.offline'));
      return;
    }
    const from = invite.inviterEmail
      ? this.translation.t('household.setup.acceptFrom', { email: invite.inviterEmail })
      : this.translation.t('household.setup.acceptFromUnverified');
    const data: ConfirmDialogData = {
      title: this.translation.t('household.setup.acceptTitle', { name: invite.householdName }),
      message: this.translation.t('household.setup.acceptDisclosure', { from, name: invite.householdName }),
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
      this.declined.set(invite.id);
      this.notification.success(this.translation.t('household.setup.declined'));
      this.analytics.trackHouseholdAction({ action: 'decline' });
    });
  }

  /** The page the join lands on is headed by the household's current name, so the toast says that one too. */
  private async join(invite: HouseholdInvite): Promise<void> {
    await this.answer(invite, async () => {
      const name = await this.household.accept(invite.householdId);
      this.pageFocus.afterSwapTo('member');
      this.notification.success(this.translation.t('household.setup.joined', { name }));
      this.analytics.trackHouseholdAction({ action: 'accept' });
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
