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
import { Observable, firstValueFrom } from 'rxjs';

import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService,
  householdNameValidator,
  inviteEmailValid
} from '../../../core/services/household.service';
import { INVITE_MAIL_DEADLINE_MS } from '../../../core/services/household-invite-callable';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnalyticsEventParams } from '../../../core/config/analytics-events';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { MemberChipComponent } from '../../../shared/components/member-chip/member-chip.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { HouseholdInvite, HouseholdInviteMail, HouseholdMember } from '../../../models';
import { FocusContext, HouseholdPageFocus, focusWhenRendered } from '../household-focus';

/**
 * What an invite's age is allowed beyond the callable's mail deadline
 * (INVITE_MAIL_DEADLINE_MS) before a `failed` reads as final: the callable
 * charges the mail budget before it sends and records the outcome after, and
 * the two clocks compared here, the server's stamp and this device's, need
 * not agree.
 */
export const INVITE_MAIL_MARGIN_MS = 30_000;

const INVITE_MAIL_SETTLE_MS = INVITE_MAIL_DEADLINE_MS + INVITE_MAIL_MARGIN_MS;

/**
 * The word a dissolve's typed confirmation asks for. Kept literal in every
 * language, as the account deletion's is, and named to the reader through the
 * message rather than translated.
 */
const DISSOLVE_CONFIRM_TEXT = 'DELETE';

/** An empty field asks for an address; anything else the callable would refuse is malformed. */
function inviteEmail(control: AbstractControl<string>): ValidationErrors | null {
  if (!control.value.trim()) return { required: true };
  return inviteEmailValid(control.value) ? null : { inviteEmail: true };
}

type HouseholdAction = AnalyticsEventParams<'household_action'>['action'];

/** What became of an invite's mail, as the pending list says it. */
type InviteMailView = 'sent' | 'sending' | 'failed' | 'held';

interface MemberView {
  member: HouseholdMember;
  /** The DOM id of the member's name, which describes their Remove. */
  nameId: string;
  /** The DOM id of their Remove, where focus goes when a neighbour's row is removed. */
  removeId: string;
  owner: boolean;
  self: boolean;
  removable: boolean;
}

interface InviteView {
  invite: HouseholdInvite;
  /** The DOM id of the invitee's address, which describes the Revoke. */
  emailId: string;
  expired: boolean;
  expiry: string;
  mail: InviteMailView;
  /** When a `sending` stops being read as one; 0 for every other status. */
  settlesAt: number;
}

/** A row an action removed, and where focus goes once the row has gone. */
interface Departure {
  /** `member:{uid}` or `invite:{id}`. */
  key: string;
  landings: string[];
}

/**
 * What the invite callable answered about the invite it wrote. That invite
 * is the first document under its id whose createdAt is not the one that
 * stood there before the call, so a document the call replaced keeps its own
 * status, and so does one a later invite to the same address writes.
 */
interface MailAnswer {
  mail: HouseholdInviteMail;
  /** The createdAt of the document standing under the id before the call; null when none did. */
  replaced: number | null;
  /** The createdAt of the document the call wrote; null until the list has shown it. */
  createdAt: number | null;
}

/**
 * The household's members, and what each can do about the household: the
 * owner invites by email, withdraws a pending invite, renames the household,
 * removes a member and dissolves it; a member can only leave.
 *
 * Every refusal comes from the service already in the reader's language,
 * the offline one included, and is shown as it came. Every message goes
 * through NotificationService, which announces it: nothing here speaks for
 * itself as well.
 *
 * One action runs at a time. Each is a server round trip whose outcome
 * changes what the others would act on, and a dissolve begun while an
 * invite is in flight could leave that invite standing.
 *
 * Focus is never dropped on the document. Every button stays focusable while
 * an action runs, held rather than disabled, and the action in flight refuses
 * a second press. Remove and Revoke take their own row away, so focus goes on
 * once the row has gone: to a neighbouring member's Remove, or to the
 * heading of what is left. Leave and Dissolve take the whole view away; the
 * page moves focus into the setup that replaces it.
 */
@Component({
  selector: 'app-household-members',
  standalone: true,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MemberChipComponent,
    ReactiveFormsModule,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './household-members.component.html',
  styleUrl: './household-members.component.scss'
})
export class HouseholdMembersComponent {
  private readonly household = inject(HouseholdService);
  private readonly notification = inject(NotificationService);
  private readonly translation = inject(TranslationService);
  private readonly dateFormat = inject(DateFormatService);
  private readonly analytics = inject(AnalyticsService);
  private readonly dialog = inject(MatDialog);
  private readonly isOnline = inject(PwaService).isOnline;
  private readonly pageFocus = inject(HouseholdPageFocus);
  private readonly focus: FocusContext = {
    host: inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    injector: inject(Injector),
    destroyRef: inject(DestroyRef)
  };
  private readonly departing = signal<Departure | null>(null);

  readonly isOwner = this.household.isOwner;
  readonly maxLength = HOUSEHOLD_NAME_MAX_LENGTH;

  /** Whether an action is on its way; every control waits for it. */
  readonly pending = signal(false);

  readonly inviteForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [inviteEmail] })
  });
  readonly renameForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [householdNameValidator] })
  });
  /**
   * A submit marks its directive submitted, and Material shows an invalid
   * control's error for a submitted form; only the directive's reset clears
   * that, so an emptied field is not refused.
   */
  private readonly inviteDirective = viewChild<FormGroupDirective>('inviteDirective');
  private readonly renameDirective = viewChild<FormGroupDirective>('renameDirective');

  /**
   * Bumped when a `sending` invite's window closes or the callable answers,
   * so the list reads again: neither is a signal of its own.
   */
  private readonly reread = signal(0);

  /**
   * When this page first saw each provisional `failed`, by this device's
   * clock, keyed by invite id and createdAt: a document rewritten under the
   * same id is another invite.
   */
  private readonly firstSeen = new Map<string, number>();

  /** The callable's answers this session, by invite id. */
  private readonly answers = new Map<string, MailAnswer>();

  readonly memberViews = computed<MemberView[]>(() => {
    const me = this.household.ownMember()?.uid;
    const owner = this.isOwner();
    return this.household.members().map(member => ({
      member,
      nameId: `household-member-${member.uid}`,
      removeId: `household-member-remove-${member.uid}`,
      owner: member.role === 'owner',
      self: member.uid === me,
      removable: owner && member.uid !== me && member.role !== 'owner'
    }));
  });

  /**
   * The callable writes an invite as `failed` before it mails and corrects it
   * once the mail settles, so a `failed` younger than the mail's deadline
   * and its margin is still sending, unless the callable has already said
   * what became of it. Its age runs from the earlier of the server's stamp
   * and this page's first sight of it: a device clock running behind the
   * server's would otherwise keep it sending for as long as it runs behind.
   * Expiry is judged when the list last changed, as the setup judges it.
   */
  readonly invites = computed<InviteView[]>(() => {
    this.reread();
    const now = Date.now();
    const invites = this.household.sentInvites();
    const provisional = new Set<string>();
    const views = invites.map((invite): InviteView => {
      const createdAt = invite.createdAt.toMillis();
      const answered = this.answeredMail(invite.id, createdAt);
      let settlesAt = 0;
      if (!answered && invite.mail === 'failed') {
        const key = `${invite.id}:${createdAt}`;
        provisional.add(key);
        const firstSeen = this.firstSeen.get(key) ?? now;
        this.firstSeen.set(key, firstSeen);
        const settles = Math.min(createdAt, firstSeen) + INVITE_MAIL_SETTLE_MS;
        if (settles > now) settlesAt = settles;
      }
      return {
        invite,
        emailId: `household-invite-${invite.id}`,
        expired: invite.expiresAt.toMillis() <= now,
        expiry: this.dateFormat.formatDate(invite.expiresAt),
        mail: settlesAt ? 'sending' : (answered ?? invite.mail),
        settlesAt
      };
    });

    // Forget what no listed invite can be read by again. An answer waiting
    // for the document its call wrote is kept until the list shows it.
    for (const key of this.firstSeen.keys()) {
      if (!provisional.has(key)) this.firstSeen.delete(key);
    }
    const listed = new Set(invites.map(invite => `${invite.id}:${invite.createdAt.toMillis()}`));
    for (const [id, answer] of this.answers) {
      if (answer.createdAt !== null && !listed.has(`${id}:${answer.createdAt}`)) this.answers.delete(id);
    }
    return views;
  });

  constructor() {
    // A `sending` that nothing corrects has to become `failed` on its own;
    // the list is read again the moment the first such window closes.
    effect(onCleanup => {
      const settles = this.invites().map(view => view.settlesAt).filter(at => at > 0);
      if (settles.length === 0) return;
      // Never more than one window away, so no reading of either clock can
      // ask setTimeout for a delay past its range, which it would fire at once.
      const delay = Math.min(INVITE_MAIL_SETTLE_MS, Math.max(0, Math.min(...settles) - Date.now()));
      const timer = setTimeout(() => this.reread.update(n => n + 1), delay);
      onCleanup(() => clearTimeout(timer));
    });

    effect(() => {
      const departure = this.departing();
      if (!departure) return;
      const listed = new Set([
        ...this.memberViews().map(view => `member:${view.member.uid}`),
        ...this.invites().map(view => `invite:${view.invite.id}`)
      ]);
      if (listed.has(departure.key)) return;
      untracked(() => {
        this.departing.set(null);
        focusWhenRendered(this.focus, departure.landings);
      });
    });

    // The field follows the household's name until the owner starts editing
    // it, so a rename made on another device shows here too.
    effect(() => {
      const name = this.household.household()?.name ?? '';
      untracked(() => {
        const control = this.renameForm.controls.name;
        if (!control.dirty) control.setValue(name);
      });
    });
  }

  async invite(): Promise<void> {
    if (this.pending()) return;
    const email = this.inviteForm.controls.email;
    email.markAsTouched();
    if (email.invalid) return;

    const address = email.value.trim();
    const standing = new Map(
      this.household.sentInvites().map(invite => [invite.id, invite.createdAt.toMillis()])
    );
    await this.run('invite', async () => {
      const { inviteId, mail } = await this.household.invite(address);
      this.answers.set(inviteId, { mail, replaced: standing.get(inviteId) ?? null, createdAt: null });
      this.reread.update(n => n + 1);
      // The field stays open while the call is out: whatever was typed since
      // is kept.
      if (email.value.trim() === address) this.inviteDirective()?.resetForm();
      this.notification.success(
        mail === 'sent'
          ? this.t('household.members.inviteSent', { email: address })
          : this.t('household.members.inviteWaiting', { email: address })
      );
    });
  }

  /**
   * Focus goes to the list's heading, never to another Revoke: nothing asks
   * before a revoke, so a repeated Enter would withdraw a second invite.
   */
  async revoke(invite: HouseholdInvite): Promise<void> {
    await this.run('revoke', async () => {
      await this.household.revoke(invite.id);
      this.departing.set({ key: `invite:${invite.id}`, landings: ['#household-pending-title'] });
      this.notification.success(this.t('household.members.revoked'));
    });
  }

  async rename(): Promise<void> {
    if (this.pending()) return;
    const control = this.renameForm.controls.name;
    control.markAsTouched();
    if (control.invalid) return;

    const name = control.value.trim();
    if (name === this.currentHouseholdName()) {
      this.renameDirective()?.resetForm({ name });
      return;
    }
    await this.run('rename', async () => {
      await this.household.rename(name);
      // Pristine again, so the field follows the name the listener brings,
      // unless the owner typed on while the rename was out.
      if (control.value.trim() === name) this.renameDirective()?.resetForm({ name });
      this.notification.success(this.t('household.members.renamed'));
    });
  }

  async remove(view: MemberView): Promise<void> {
    if (this.pending() || this.refusedOffline()) return;
    const given = view.member.displayName.trim();
    // The title asks about the member mid-sentence; the rest begin with them.
    const name = given || this.t('household.unnamedMember');
    const confirmed = await this.confirm({
      title: this.t('household.members.removeTitle', { name: given || this.t('household.unnamedMemberInline') }),
      message: this.t('household.members.removeMessage', { name }),
      confirmLabel: this.t('household.members.removeConfirm'),
      confirmColor: 'warn',
      icon: 'group_remove'
    });
    if (!confirmed) return;

    // A confirm stands in front of every Remove, so focus may go on to the
    // next one: pressing it asks again.
    const removable = this.memberViews().filter(each => each.removable);
    const at = removable.findIndex(each => each.member.uid === view.member.uid);
    const landings = [removable[at + 1], removable[at - 1]]
      .filter((each): each is MemberView => each !== undefined)
      .map(each => `#${each.removeId}`);

    await this.run('remove', async () => {
      await this.household.remove(view.member.uid);
      this.departing.set({ key: `member:${view.member.uid}`, landings: [...landings, '#household-members-title'] });
      this.notification.success(this.t('household.members.removed', { name }));
    });
  }

  async leave(): Promise<void> {
    if (this.pending() || this.refusedOffline()) return;
    const name = this.currentHouseholdName();
    const confirmed = await this.confirm({
      title: this.t('household.members.leaveTitle', { name }),
      message: this.t('household.members.leaveMessage'),
      confirmLabel: this.t('household.members.leaveConfirm'),
      confirmColor: 'warn',
      icon: 'logout'
    });
    if (!confirmed) return;

    await this.run('leave', async () => {
      await this.household.leave();
      this.pageFocus.afterSwapTo('none');
      this.notification.success(this.t('household.members.left', { name }));
    });
  }

  /**
   * Gated twice, as the account deletion is: a warning, then the typed word.
   * Nobody's own records go, but every member loses every other's at once,
   * and nothing brings the household back.
   */
  async dissolve(): Promise<void> {
    if (this.pending() || this.refusedOffline()) return;
    const name = this.currentHouseholdName();
    const warned = await this.confirm({
      title: this.t('household.members.dissolveTitle', { name }),
      message: this.t('household.members.dissolveMessage'),
      confirmLabel: this.t('household.members.dissolveContinue'),
      confirmColor: 'warn',
      icon: 'warning'
    });
    if (!warned) return;
    const typed = await this.confirm({
      title: this.t('household.members.finalTitle'),
      message: this.t('household.members.dissolveTypeConfirm', { text: DISSOLVE_CONFIRM_TEXT, name }),
      confirmLabel: this.t('household.members.dissolveConfirm'),
      confirmColor: 'warn',
      requireText: DISSOLVE_CONFIRM_TEXT
    });
    if (!typed) return;

    await this.run('dissolve', async () => {
      await this.household.dissolve();
      this.pageFocus.afterSwapTo('none');
      this.notification.success(this.t('household.members.dissolved'));
    });
  }

  /** Runs one action, counting it only once it succeeded. */
  private async run(action: HouseholdAction, work: () => Promise<void>): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    try {
      await work();
      this.analytics.trackHouseholdAction({ action });
    } catch (error) {
      this.notification.error(this.messageOf(error));
    } finally {
      this.pending.set(false);
    }
  }

  /**
   * Refuses offline before the first question. The service refuses too, but
   * only once it is called, which for these is after every confirm has been
   * answered; it still catches a connection lost while one is open.
   */
  private refusedOffline(): boolean {
    if (this.isOnline()) return false;
    this.notification.error(this.t('household.errors.offline'));
    return true;
  }

  /**
   * What the callable answered about this document, if it is the one the
   * call wrote. The first document other than the one it replaced is taken
   * as that one, and remembered.
   */
  private answeredMail(inviteId: string, createdAt: number): HouseholdInviteMail | null {
    const answer = this.answers.get(inviteId);
    if (!answer) return null;
    if (answer.createdAt === null && createdAt !== answer.replaced) answer.createdAt = createdAt;
    return answer.createdAt === createdAt ? answer.mail : null;
  }

  private confirm(data: ConfirmDialogData): Promise<boolean> {
    const closed: Observable<unknown> = this.dialog.open(ConfirmDialogComponent, { data }).afterClosed();
    return firstValueFrom(closed, { defaultValue: undefined }).then(answer => answer === true);
  }

  private currentHouseholdName(): string {
    return this.household.household()?.name ?? '';
  }

  /** The service words every refusal in the reader's language already. */
  private messageOf(error: unknown): string {
    return error instanceof HouseholdError ? error.message : this.t('errors.generic');
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.translation.t(key, params);
  }
}
