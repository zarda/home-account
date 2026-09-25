import { WritableSignal, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { HouseholdMembersComponent, INVITE_MAIL_MARGIN_MS } from './household-members.component';
import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService
} from '../../../core/services/household.service';
import {
  HouseholdInviteResponse,
  INVITE_MAIL_DEADLINE_MS
} from '../../../core/services/household-invite-callable';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { Household, HouseholdInvite, HouseholdMember } from '../../../models';
import { HouseholdPageFocus } from '../household-focus';

const DAY = 24 * 60 * 60 * 1000;
const CREATED = Timestamp.fromMillis(1_700_000_000_000);

const HOUSEHOLD: Household = { id: 'h1', name: 'The Lins', ownerId: 'alex', createdAt: CREATED };

function member(uid: string, displayName: string, role: HouseholdMember['role'] = 'member'): HouseholdMember {
  return { uid, displayName, role, since: CREATED, joinedAt: CREATED };
}

const alex = member('alex', 'Alex Lin', 'owner');
const sam = member('sam', 'Sam Ito');
const kai = member('kai', 'Kai');

function sentInvite(overrides: Partial<HouseholdInvite> = {}): HouseholdInvite {
  const inviteeUid = overrides.inviteeUid ?? 'robin';
  return {
    id: `h1_${inviteeUid}`,
    householdId: 'h1',
    householdCreatedAt: CREATED,
    householdName: 'The Lins',
    inviterUid: 'alex',
    inviterName: 'Alex Lin',
    inviteeUid,
    inviteeEmail: `${inviteeUid}@example.com`,
    locale: 'en',
    createdAt: Timestamp.fromMillis(Date.now() - DAY),
    expiresAt: Timestamp.fromMillis(Date.now() + 6 * DAY),
    mail: 'sent',
    ...overrides
  };
}

type Actions = Pick<HouseholdService, 'invite' | 'revoke' | 'rename' | 'remove' | 'leave' | 'dissolve'>;

// Rendered throughout (ADR 0144): who sees which control, what each invite
// line says and which dialogs stand between a click and the service are all
// template facts.
describe('HouseholdMembersComponent', () => {
  let fixture: ComponentFixture<HouseholdMembersComponent>;
  let household: WritableSignal<Household | null>;
  let members: WritableSignal<HouseholdMember[]>;
  let ownMember: WritableSignal<HouseholdMember | null>;
  let sentInvites: WritableSignal<HouseholdInvite[]>;
  let online: WritableSignal<boolean>;
  let service: jasmine.SpyObj<Actions>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error' | 'info'>>;
  let announcer: jasmine.SpyObj<Pick<AnnouncerService, 'announce'>>;
  let analytics: jasmine.SpyObj<Pick<AnalyticsService, 'trackHouseholdAction'>>;
  let dialog: jasmine.SpyObj<Pick<MatDialog, 'open'>>;
  let formatDate: jasmine.Spy;
  let afterSwapTo: jasmine.Spy;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';
  const memberRows = (): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>('.member'));
  const memberRow = (name: string): HTMLElement | undefined =>
    memberRows().find(row => row.querySelector('app-member-chip')?.textContent?.includes(name));
  const inviteRows = (): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>('.invite'));
  const mailStatus = (): string => inviteRows()[0]?.querySelector('.invite-mail')?.textContent ?? '';
  const emailInput = (): HTMLInputElement | null => element().querySelector<HTMLInputElement>('input[name="inviteEmail"]');
  const sendButton = (): HTMLButtonElement => element().querySelector<HTMLButtonElement>('button.invite-send')!;
  const renameInput = (): HTMLInputElement | null => element().querySelector<HTMLInputElement>('input[name="householdRename"]');
  const renameButton = (): HTMLButtonElement => element().querySelector<HTMLButtonElement>('button.rename-save')!;
  const button = (selector: string): HTMLButtonElement | null => element().querySelector<HTMLButtonElement>(selector);

  const dialogData = (call = dialog.open.calls.mostRecent()): ConfirmDialogData =>
    (call.args[1] as { data: ConfirmDialogData }).data;

  /** Each dialog in turn answers with the next of these. */
  function answerDialogs(...answers: unknown[]): void {
    const queue = [...answers];
    dialog.open.and.callFake((() => ({ afterClosed: () => of(queue.shift()) })) as never);
  }

  function render(): void {
    fixture.detectChanges();
  }

  /** Lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
  async function settleFocus(): Promise<void> {
    render();
    await fixture.whenStable();
    TestBed.tick();
  }

  /** Held while an action runs: marked unavailable, and still focusable. */
  const held = (target: HTMLButtonElement | null | undefined): boolean =>
    target?.getAttribute('aria-disabled') === 'true' && !target.disabled;

  /** Settles the service call a click started, and whatever it did after. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    render();
  }

  /**
   * Settles a chain begun in a callback, past every continuation of its
   * awaits: a macrotask. whenStable answers too early for a chain begun in a
   * dialog's callback, and waits out a `sending` invite's timer, which only
   * the render after the call's answer clears.
   */
  async function drain(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve));
    render();
  }

  async function click(target: HTMLButtonElement | null | undefined): Promise<void> {
    expect(target).withContext('the button is there').toBeTruthy();
    target!.click();
    render();
    await settle();
  }

  function type(input: HTMLInputElement | null, value: string): void {
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    render();
  }

  function viewAs(viewer: HouseholdMember): void {
    ownMember.set(viewer);
    render();
  }

  beforeEach(async () => {
    household = signal<Household | null>(HOUSEHOLD);
    members = signal<HouseholdMember[]>([alex, sam, kai]);
    ownMember = signal<HouseholdMember | null>(alex);
    sentInvites = signal<HouseholdInvite[]>([]);
    online = signal(true);
    service = jasmine.createSpyObj('HouseholdService', ['invite', 'revoke', 'rename', 'remove', 'leave', 'dissolve']);
    service.invite.and.resolveTo({ inviteId: 'h1_robin', mail: 'sent' });
    service.revoke.and.resolveTo();
    service.rename.and.resolveTo();
    service.remove.and.resolveTo();
    service.leave.and.resolveTo();
    service.dissolve.and.resolveTo();
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    announcer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    answerDialogs(true, true);
    formatDate = jasmine.createSpy('formatDate').and.returnValue('Oct 2, 2026');

    await TestBed.configureTestingModule({
      imports: [HouseholdMembersComponent, NoopAnimationsModule],
      providers: [
        {
          provide: HouseholdService,
          useValue: {
            ...service,
            household,
            members,
            ownMember,
            isOwner: computed(() => ownMember()?.role === 'owner'),
            sentInvites
          }
        },
        { provide: NotificationService, useValue: notification },
        { provide: AnnouncerService, useValue: announcer },
        { provide: AnalyticsService, useValue: analytics },
        { provide: MatDialog, useValue: dialog },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: DateFormatService, useValue: { formatDate } },
        { provide: TranslationService, useValue: createTranslationStub() },
        HouseholdPageFocus
      ]
    }).compileComponents();

    afterSwapTo = spyOn(TestBed.inject(HouseholdPageFocus), 'afterSwapTo');
    fixture = TestBed.createComponent(HouseholdMembersComponent);
    render();
  });

  describe('the members', () => {
    it('lists every member with their name and role, the owner marked as such', () => {
      expect(element().querySelector('h2')?.textContent).toContain('household.members.title');
      expect(memberRows().length).toBe(3);

      const owner = memberRow('Alex Lin')!;
      expect(owner.querySelector('.member-role')?.textContent).toContain('household.members.roleOwner');
      expect(owner.classList).toContain('is-owner');
      for (const name of ['Sam Ito', 'Kai']) {
        const row = memberRow(name)!;
        expect(row.querySelector('.member-role')?.textContent).withContext(name).toContain('household.members.roleMember');
        expect(row.classList).withContext(name).not.toContain('is-owner');
      }
    });

    it("marks the viewer's own row", () => {
      viewAs(sam);

      expect(memberRow('Sam Ito')?.querySelector('.member-self')?.textContent).toContain('household.members.you');
      expect(memberRow('Alex Lin')?.querySelector('.member-self')).toBeNull();
      expect(memberRow('Kai')?.querySelector('.member-self')).toBeNull();
    });

    it("offers the owner Remove on every other member's row, never on its own", () => {
      expect(memberRow('Alex Lin')?.querySelector('button.member-remove')).toBeNull();
      expect(memberRow('Sam Ito')?.querySelector('button.member-remove')).not.toBeNull();
      expect(memberRow('Kai')?.querySelector('button.member-remove')).not.toBeNull();
    });

    it('offers a member no Remove at all', () => {
      viewAs(sam);

      expect(element().querySelectorAll('button.member-remove').length).toBe(0);
    });

    it("ties each Remove to its member's name", () => {
      const row = memberRow('Sam Ito')!;
      const describedBy = row.querySelector('button.member-remove')?.getAttribute('aria-describedby');

      expect(describedBy).toBeTruthy();
      expect(element().querySelector(`#${describedBy}`)?.textContent).toContain('Sam Ito');
    });

    describe('removing one', () => {
      const remove = () => click(memberRow('Sam Ito')?.querySelector<HTMLButtonElement>('button.member-remove'));

      it('asks first, in a warning naming them', async () => {
        answerDialogs(false);
        await remove();

        expect(dialog.open).toHaveBeenCalledTimes(1);
        expect(dialog.open.calls.mostRecent().args[0]).toBe(ConfirmDialogComponent);
        expect(dialogData().title).toBe(`household.members.removeTitle:${JSON.stringify({ name: 'Sam Ito' })}`);
        expect(dialogData().message).toBe(`household.members.removeMessage:${JSON.stringify({ name: 'Sam Ito' })}`);
        expect(dialogData().confirmLabel).toBe('household.members.removeConfirm');
        expect(dialogData().confirmColor).toBe('warn');
        expect(service.remove).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('removes that member on a confirm, says so, and counts it once', async () => {
        await remove();

        expect(service.remove).toHaveBeenCalledOnceWith('sam');
        expect(notification.success).toHaveBeenCalledOnceWith(
          `household.members.removed:${JSON.stringify({ name: 'Sam Ito' })}`
        );
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'remove' });
      });

      it('names a member without a name generically, in the form each sentence needs', async () => {
        members.set([alex, member('sam', '  ')]);
        render();
        await click(element().querySelector<HTMLButtonElement>('button.member-remove'));

        expect(dialogData().title).toBe(
          `household.members.removeTitle:${JSON.stringify({ name: 'household.unnamedMemberInline' })}`
        );
        expect(dialogData().message).toBe(
          `household.members.removeMessage:${JSON.stringify({ name: 'household.unnamedMember' })}`
        );
        expect(notification.success).toHaveBeenCalledOnceWith(
          `household.members.removed:${JSON.stringify({ name: 'household.unnamedMember' })}`
        );
      });

      describe('where focus goes', () => {
        const removeOf = (name: string): HTMLButtonElement =>
          memberRow(name)!.querySelector<HTMLButtonElement>('button.member-remove')!;

        async function removeWithFocus(name: string, left: HouseholdMember[]): Promise<void> {
          const target = removeOf(name);
          target.focus();
          await click(target);
          expect(document.activeElement).withContext('held, Remove keeps focus until its row goes').toBe(target);
          members.set(left);
          await settleFocus();
        }

        it("moves on to the next member's Remove once the removed member's row goes", async () => {
          await removeWithFocus('Sam Ito', [alex, kai]);

          expect(document.activeElement).toBe(removeOf('Kai'));
        });

        it('moves back to the one before when the last is removed', async () => {
          await removeWithFocus('Kai', [alex, sam]);

          expect(document.activeElement).toBe(removeOf('Sam Ito'));
        });

        it("moves to the section's heading when no other member can be removed", async () => {
          members.set([alex, sam]);
          render();
          await removeWithFocus('Sam Ito', [alex]);

          const heading = element().querySelector<HTMLElement>('#household-members-title');
          expect(document.activeElement).toBe(heading);
          expect(heading?.getAttribute('tabindex')).withContext('script can focus it, Tab does not').toBe('-1');
        });

        it('stays on Remove, no longer held, when the service refuses', async () => {
          service.remove.and.rejectWith(new HouseholdError('household.errors.notOwner'));
          const target = removeOf('Sam Ito');
          target.focus();
          await click(target);
          await settleFocus();

          expect(document.activeElement).toBe(target);
          expect(target.getAttribute('aria-disabled')).not.toBe('true');
        });

        it('leaves focus where the owner moved it while the row was going', async () => {
          const target = removeOf('Sam Ito');
          target.focus();
          await click(target);
          const kaiRemove = removeOf('Kai');
          kaiRemove.focus();
          members.set([alex, kai]);
          await settleFocus();

          expect(document.activeElement).toBe(kaiRemove);
        });
      });

      it("shows a refusal in the service's words, and nothing else", async () => {
        service.remove.and.rejectWith(new HouseholdError('household.errors.notOwner'));
        await remove();

        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.notOwner');
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('cannot start offline: the offline refusal comes before any question', async () => {
        online.set(false);
        await remove();

        expect(dialog.open).not.toHaveBeenCalled();
        expect(service.remove).not.toHaveBeenCalled();
        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('shows the offline refusal the service gives for a connection lost while the owner was asked', async () => {
        service.remove.and.rejectWith(new HouseholdError('household.errors.offline'));
        await remove();

        expect(service.remove).toHaveBeenCalledTimes(1);
        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });
    });
  });

  describe('the invite form', () => {
    it('is not offered to a member', () => {
      viewAs(sam);

      expect(emailInput()).toBeNull();
      expect(text()).not.toContain('household.members.inviteTitle');
    });

    it('asks for an email address the browser can fill in', () => {
      const input = emailInput()!;

      expect(text()).toContain('household.members.inviteTitle');
      expect(input.type).toBe('email');
      expect(input.getAttribute('autocomplete')).toBe('email');
      expect(input.closest('mat-form-field')?.querySelector('mat-label')?.textContent).toContain('household.members.emailLabel');
    });

    for (const bad of ['robin', 'robin@', '@example.com', 'robin@@example.com', 'rob in@example.com', `${'r'.repeat(250)}@x.io`]) {
      it(`refuses ${JSON.stringify(bad.length > 40 ? `${bad.slice(0, 12)}…` : bad)} inline, without asking the service`, async () => {
        type(emailInput(), bad);
        await click(sendButton());

        expect(service.invite).not.toHaveBeenCalled();
        expect(element().querySelector('mat-error')?.textContent).toContain('household.errors.email');
        expect(notification.error).not.toHaveBeenCalled();
      });
    }

    it('asks for an address when there is none', async () => {
      await click(sendButton());

      expect(service.invite).not.toHaveBeenCalled();
      expect(element().querySelector('mat-error')?.textContent).toContain('household.members.emailRequired');
    });

    it('invites the trimmed address, and clears the form', async () => {
      type(emailInput(), '  Robin@Example.com ');
      await click(sendButton());

      expect(service.invite).toHaveBeenCalledOnceWith('Robin@Example.com');
      expect(emailInput()!.value).toBe('');
      expect(element().querySelector('mat-error')).withContext('the cleared field is not refused').toBeNull();
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'invite' });
    });

    it('says the invite was emailed when it was', async () => {
      type(emailInput(), 'robin@example.com');
      await click(sendButton());

      expect(notification.success).toHaveBeenCalledOnceWith(
        `household.members.inviteSent:${JSON.stringify({ email: 'robin@example.com' })}`
      );
    });

    for (const mail of ['failed', 'held'] as const) {
      it(`says the invite is waiting in the app when its mail ${mail === 'held' ? 'was held' : 'failed'}`, async () => {
        service.invite.and.resolveTo({ inviteId: 'h1_robin', mail } satisfies HouseholdInviteResponse);
        type(emailInput(), 'robin@example.com');
        await click(sendButton());

        expect(notification.success).toHaveBeenCalledOnceWith(
          `household.members.inviteWaiting:${JSON.stringify({ email: 'robin@example.com' })}`
        );
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'invite' });
      });
    }

    it("shows a refusal in the service's words, keeps the address, and counts nothing", async () => {
      service.invite.and.rejectWith(new HouseholdError('household.errors.noAccount'));
      type(emailInput(), 'robin@example.com');
      await click(sendButton());

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.noAccount');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      expect(emailInput()!.value).toBe('robin@example.com');
    });

    /**
     * The service words each of the callable's reasons, and gives a code
     * without one the generic copy (household.service.spec.ts covers every
     * case); the form shows whichever message comes. So one reason stands
     * for all of them above, and here the no-reason default as the service
     * sends it.
     */
    it("shows the service's no-reason default as it came, keeping the address", async () => {
      service.invite.and.rejectWith(new HouseholdError('errors.generic'));
      type(emailInput(), 'robin@example.com');
      await click(sendButton());

      expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      expect(emailInput()!.value).toBe('robin@example.com');
    });

    it('shows any other failure as the generic copy', async () => {
      service.invite.and.rejectWith(new Error('User not authenticated'));
      type(emailInput(), 'robin@example.com');
      await click(sendButton());

      expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
    });

    it('keeps an address typed while the invite was on its way', async () => {
      let finish!: (response: HouseholdInviteResponse) => void;
      service.invite.and.returnValue(new Promise(resolve => (finish = resolve)));
      type(emailInput(), 'robin@example.com');
      sendButton().click();
      render();
      type(emailInput(), 'jo@example.com');

      finish({ inviteId: 'h1_robin', mail: 'sent' });
      await settle();

      expect(service.invite).toHaveBeenCalledOnceWith('robin@example.com');
      expect(emailInput()!.value).toBe('jo@example.com');
      expect(notification.success).toHaveBeenCalledOnceWith(
        `household.members.inviteSent:${JSON.stringify({ email: 'robin@example.com' })}`
      );
    });

    it('does not send a second invite while one is on its way', async () => {
      let finish!: (response: HouseholdInviteResponse) => void;
      service.invite.and.returnValue(new Promise(resolve => (finish = resolve)));
      type(emailInput(), 'robin@example.com');
      sendButton().click();
      render();

      expect(held(sendButton())).toBe(true);
      sendButton().click();
      element().querySelector('form.invite-form')!.dispatchEvent(new Event('submit'));
      render();

      expect(service.invite).toHaveBeenCalledTimes(1);
      finish({ inviteId: 'h1_robin', mail: 'sent' });
      await settle();

      expect(held(sendButton())).toBe(false);
    });
  });

  describe('the pending invites', () => {
    it('are not shown to a member', () => {
      sentInvites.set([sentInvite()]);
      viewAs(sam);

      expect(inviteRows().length).toBe(0);
      expect(text()).not.toContain('household.members.pendingTitle');
    });

    it('say there are none', () => {
      expect(text()).toContain('household.members.pendingTitle');
      expect(text()).toContain('household.members.noPending');
    });

    it('list each invite with its address, its expiry and what became of its mail', () => {
      const emailed = sentInvite();
      sentInvites.set([
        emailed,
        sentInvite({ inviteeUid: 'jo', mail: 'held' }),
        sentInvite({ inviteeUid: 'lee', mail: 'failed' })
      ]);
      render();

      expect(inviteRows().length).toBe(3);
      const [first, second, third] = inviteRows();
      expect(first.querySelector('.invite-email')?.textContent).toContain('robin@example.com');
      expect(first.textContent).toContain(`household.members.expires:${JSON.stringify({ date: 'Oct 2, 2026' })}`);
      expect(formatDate).toHaveBeenCalledWith(emailed.expiresAt);
      expect(first.querySelector('.invite-mail')?.textContent).toContain('household.members.mailSent');
      expect(second.querySelector('.invite-mail')?.textContent).toContain('household.members.mailHeld');
      expect(third.querySelector('.invite-mail')?.textContent).toContain('household.members.mailFailed');
      expect(text()).not.toContain('household.members.noPending');
    });

    it('say when an invite has expired', () => {
      sentInvites.set([sentInvite({ expiresAt: Timestamp.fromMillis(Date.now() - DAY) })]);
      render();

      expect(inviteRows()[0].textContent).toContain(`household.members.expired:${JSON.stringify({ date: 'Oct 2, 2026' })}`);
    });

    /**
     * The callable writes the invite as `failed` before it mails, and
     * corrects it once the mail settles, which its own deadline bounds.
     */
    it('read a failed invite younger than the mail deadline as still sending', () => {
      sentInvites.set([sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(Date.now() - 2_000) })]);
      render();

      const status = inviteRows()[0].querySelector('.invite-mail')?.textContent ?? '';
      expect(status).toContain('household.members.mailSending');
      expect(status).not.toContain('household.members.mailFailed');
    });

    it('allow the mail deadline a margin before calling a failed invite not mailed', () => {
      expect(INVITE_MAIL_DEADLINE_MS).toBe(10_000);
      expect(INVITE_MAIL_MARGIN_MS).toBe(30_000);
      const inside = Date.now() - INVITE_MAIL_DEADLINE_MS - INVITE_MAIL_MARGIN_MS + 5_000;
      sentInvites.set([sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(inside) })]);
      render();

      expect(inviteRows()[0].querySelector('.invite-mail')?.textContent).toContain('household.members.mailSending');
    });

    it('stop calling it sending once the deadline and its margin have passed', fakeAsync(() => {
      const sendingWindowMs = INVITE_MAIL_DEADLINE_MS + INVITE_MAIL_MARGIN_MS;
      sentInvites.set([
        sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(Date.now() - sendingWindowMs + 3_000) })
      ]);
      render();

      expect(mailStatus()).toContain('household.members.mailSending');

      tick(3_500);
      render();

      expect(mailStatus()).toContain('household.members.mailFailed');
    }));

    /**
     * The server stamps createdAt and this device judges it: a device clock
     * running behind would otherwise read a failed invite as sending for as
     * long as it runs behind, and one a month behind would arm a timer
     * past setTimeout's range.
     */
    for (const [lag, lagMs] of [['a minute', 60_000], ['a month', 30 * DAY]] as const) {
      it(`stop calling it sending one window after it was first seen, on a clock ${lag} behind`, fakeAsync(() => {
        const sendingWindowMs = INVITE_MAIL_DEADLINE_MS + INVITE_MAIL_MARGIN_MS;
        sentInvites.set([sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(Date.now() + lagMs) })]);
        render();

        expect(mailStatus()).toContain('household.members.mailSending');

        tick(sendingWindowMs - 1_000);
        render();
        expect(mailStatus()).toContain('household.members.mailSending');

        tick(1_000);
        render();
        expect(mailStatus()).toContain('household.members.mailFailed');
      }));
    }

    it("follow the callable's correction from sending to emailed", () => {
      const young = sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(Date.now() - 1_000) });
      sentInvites.set([young]);
      render();
      sentInvites.set([{ ...young, mail: 'sent' }]);
      render();

      expect(mailStatus()).toContain('household.members.mailSent');
    });

    describe("after the callable's own answer", () => {
      const young = (createdAt = Date.now() - 1_000) =>
        sentInvite({ mail: 'failed', createdAt: Timestamp.fromMillis(createdAt) });

      /** Invites robin@example.com; `whileOut` runs while the call is on its way. */
      async function inviteRobin(mail: HouseholdInviteResponse['mail'], whileOut?: () => void): Promise<void> {
        let finish!: (response: HouseholdInviteResponse) => void;
        service.invite.and.returnValue(new Promise(resolve => (finish = resolve)));
        type(emailInput(), 'robin@example.com');
        sendButton().click();
        render();
        whileOut?.();
        finish({ inviteId: 'h1_robin', mail });
        await drain();
      }

      for (const mail of ['failed', 'held', 'sent'] as const) {
        it(`read the invite it wrote as ${mail}, not as sending`, async () => {
          await inviteRobin(mail, () => {
            // The list brings the provisional invite before the call answers.
            sentInvites.set([young()]);
            render();
            expect(mailStatus()).toContain('household.members.mailSending');
          });

          const status = mailStatus();
          expect(status).not.toContain('household.members.mailSending');
          expect(status).toContain(
            { failed: 'household.members.mailFailed', held: 'household.members.mailHeld', sent: 'household.members.mailSent' }[mail]
          );
        });
      }

      it('read it so once the list brings the invite after the answer', async () => {
        await inviteRobin('failed');
        sentInvites.set([young()]);
        render();

        expect(mailStatus()).toContain('household.members.mailFailed');
      });

      it('leave the invite standing before a re-invite to its own status until the list brings the new one', async () => {
        const standing = sentInvite({ createdAt: Timestamp.fromMillis(Date.now() - DAY), mail: 'sent' });
        sentInvites.set([standing]);
        render();

        await inviteRobin('failed');
        expect(mailStatus()).withContext('the invite the call replaces').toContain('household.members.mailSent');

        sentInvites.set([young()]);
        render();
        expect(mailStatus()).withContext('the invite the call wrote').toContain('household.members.mailFailed');
      });

      it('read a later invite to the same address by its own clock', async () => {
        await inviteRobin('failed', () => {
          sentInvites.set([young(Date.now() - 2_000)]);
          render();
        });
        expect(mailStatus()).toContain('household.members.mailFailed');

        // Sent again from elsewhere: a new document under the same id.
        sentInvites.set([young(Date.now() - 500)]);
        render();

        expect(mailStatus()).toContain('household.members.mailSending');
      });
    });

    it("tie each Revoke to its invite's address", () => {
      sentInvites.set([sentInvite()]);
      render();

      const describedBy = inviteRows()[0].querySelector('button.invite-revoke')?.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(element().querySelector(`#${describedBy}`)?.textContent).toContain('robin@example.com');
    });

    describe('revoking one', () => {
      beforeEach(() => {
        sentInvites.set([sentInvite()]);
        render();
      });

      const revoke = () => click(inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-revoke'));

      it('withdraws it, says so, and counts it once', async () => {
        await revoke();

        expect(service.revoke).toHaveBeenCalledOnceWith('h1_robin');
        expect(notification.success).toHaveBeenCalledOnceWith('household.members.revoked');
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'revoke' });
      });

      it("shows a refusal in the service's words, and nothing else", async () => {
        service.revoke.and.rejectWith(new HouseholdError('household.errors.offline'));
        await revoke();

        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it("moves focus to the pending list's heading once the invite's row goes, never to another Revoke", async () => {
        sentInvites.set([sentInvite(), sentInvite({ inviteeUid: 'jo' })]);
        render();
        const target = inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-revoke')!;
        target.focus();
        await click(target);
        expect(document.activeElement).toBe(target);

        sentInvites.set([sentInvite({ inviteeUid: 'jo' })]);
        await settleFocus();

        const heading = element().querySelector<HTMLElement>('#household-pending-title');
        expect(heading?.textContent).toContain('household.members.pendingTitle');
        expect(document.activeElement).toBe(heading);
        expect(heading?.getAttribute('tabindex')).toBe('-1');
      });
    });
  });

  describe('renaming', () => {
    it('is not offered to a member', () => {
      viewAs(sam);

      expect(renameInput()).toBeNull();
    });

    it("offers the owner a field holding the household's name, capped at the rules' length", () => {
      expect(renameInput()!.value).toBe('The Lins');
      expect(renameInput()!.maxLength).toBe(HOUSEHOLD_NAME_MAX_LENGTH);
    });

    it('follows a rename made elsewhere while the field is untouched', () => {
      household.set({ ...HOUSEHOLD, name: 'Flat 4B' });
      render();

      expect(renameInput()!.value).toBe('Flat 4B');
    });

    it('keeps what the owner is typing when the name changes elsewhere', () => {
      type(renameInput(), 'Our flat');
      household.set({ ...HOUSEHOLD, name: 'Flat 4B' });
      render();

      expect(renameInput()!.value).toBe('Our flat');
    });

    it('renames with the trimmed name, says so, and counts it once', async () => {
      type(renameInput(), '  Our flat  ');
      await click(renameButton());

      expect(service.rename).toHaveBeenCalledOnceWith('Our flat');
      expect(notification.success).toHaveBeenCalledOnceWith('household.members.renamed');
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'rename' });
      expect(element().querySelector('mat-error')).toBeNull();
    });

    it('keeps a name typed while the rename was on its way', async () => {
      let finish!: () => void;
      service.rename.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
      type(renameInput(), 'Our flat');
      renameButton().click();
      render();
      type(renameInput(), 'Our flat, 4B');

      finish();
      await settle();

      expect(service.rename).toHaveBeenCalledOnceWith('Our flat');
      expect(renameInput()!.value).toBe('Our flat, 4B');
      expect(notification.success).toHaveBeenCalledOnceWith('household.members.renamed');
    });

    it('asks nothing of the service for an unchanged name', async () => {
      type(renameInput(), ' The Lins ');
      await click(renameButton());

      expect(service.rename).not.toHaveBeenCalled();
      expect(notification.success).not.toHaveBeenCalled();
    });

    for (const bad of ['   ', 'x'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1)]) {
      it(`refuses ${bad.trim() ? 'an over-long' : 'a blank'} name inline, without asking the service`, async () => {
        type(renameInput(), bad);
        await click(renameButton());

        expect(service.rename).not.toHaveBeenCalled();
        expect(element().querySelector('mat-error')?.textContent).toContain(
          `household.errors.name:${JSON.stringify({ max: HOUSEHOLD_NAME_MAX_LENGTH })}`
        );
      });
    }

    it("shows a refusal in the service's words, and keeps the name typed", async () => {
      service.rename.and.rejectWith(new HouseholdError('household.errors.offline'));
      type(renameInput(), 'Our flat');
      await click(renameButton());

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      expect(renameInput()!.value).toBe('Our flat');
    });
  });

  describe('leaving', () => {
    beforeEach(() => viewAs(sam));

    const leave = () => click(button('button.household-leave'));

    it('is offered to a member, who is offered no dissolve', () => {
      expect(button('button.household-leave')).not.toBeNull();
      expect(button('button.household-dissolve')).toBeNull();
    });

    it('asks first, in a warning', async () => {
      answerDialogs(false);
      await leave();

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(dialogData().title).toBe(`household.members.leaveTitle:${JSON.stringify({ name: 'The Lins' })}`);
      expect(dialogData().message).toBe('household.members.leaveMessage');
      expect(dialogData().confirmLabel).toBe('household.members.leaveConfirm');
      expect(dialogData().confirmColor).toBe('warn');
      expect(service.leave).not.toHaveBeenCalled();
    });

    it('hands focus to the page for the setup that replaces this view, and only once it has left', async () => {
      service.leave.and.rejectWith(new HouseholdError('household.errors.offline'));
      await leave();
      expect(afterSwapTo).not.toHaveBeenCalled();

      service.leave.and.resolveTo();
      answerDialogs(true);
      await leave();
      expect(afterSwapTo).toHaveBeenCalledOnceWith('none');
    });

    it('offers no heading of its own for leaving, which sits under the members', () => {
      expect(element().querySelector('.members-end h3')).toBeNull();
    });

    it('leaves on a confirm, says so, and counts it once', async () => {
      await leave();

      expect(service.leave).toHaveBeenCalledTimes(1);
      expect(notification.success).toHaveBeenCalledOnceWith(`household.members.left:${JSON.stringify({ name: 'The Lins' })}`);
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'leave' });
    });

    it("shows a refusal in the service's words, and nothing else", async () => {
      service.leave.and.rejectWith(new HouseholdError('household.errors.offline'));
      await leave();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it('cannot start offline: the offline refusal comes before any question', async () => {
      online.set(false);
      await leave();

      expect(dialog.open).not.toHaveBeenCalled();
      expect(service.leave).not.toHaveBeenCalled();
      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });
  });

  describe('dissolving', () => {
    const dissolve = () => click(button('button.household-dissolve'));

    it('is offered to the owner, who is offered no leave', () => {
      expect(button('button.household-dissolve')).not.toBeNull();
      expect(button('button.household-leave')).toBeNull();
    });

    it('is headed on its own, not filed under renaming', () => {
      const headings = Array.from(element().querySelectorAll('h2, h3')).map(h => `${h.tagName}:${h.textContent?.trim()}`);
      expect(headings.at(-1)).toBe('H3:household.members.dissolveHeading');
      expect(headings.at(-2)).toBe('H3:household.members.renameTitle');
      expect(element().querySelector('.members-end h3 + p')?.textContent).toContain('household.members.dissolveDescription');
    });

    it('hands focus to the page for the setup that replaces this view', async () => {
      await dissolve();

      expect(afterSwapTo).toHaveBeenCalledOnceWith('none');
    });

    it('asks twice: a warning, then a typed confirmation', async () => {
      answerDialogs(true, false);
      await dissolve();

      expect(dialog.open).toHaveBeenCalledTimes(2);
      const [first, second] = dialog.open.calls.all().map(call => dialogData(call));
      expect(first.title).toBe(`household.members.dissolveTitle:${JSON.stringify({ name: 'The Lins' })}`);
      expect(first.message).toBe('household.members.dissolveMessage');
      expect(first.confirmColor).toBe('warn');
      expect(first.requireText).toBeUndefined();
      expect(second.title).toBe('household.members.finalTitle');
      expect(second.message).toBe(
        `household.members.dissolveTypeConfirm:${JSON.stringify({ text: 'DELETE', name: 'The Lins' })}`
      );
      expect(second.confirmLabel).toBe('household.members.dissolveConfirm');
      expect(second.confirmColor).toBe('warn');
      expect(second.requireText).toBe('DELETE');
      expect(service.dissolve).not.toHaveBeenCalled();
    });

    it('stops at a dismissed warning, without the typed confirmation', async () => {
      answerDialogs(false);
      await dissolve();

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(service.dissolve).not.toHaveBeenCalled();
    });

    it('dissolves after both, says so, and counts it once', async () => {
      await dissolve();

      expect(service.dissolve).toHaveBeenCalledTimes(1);
      expect(notification.success).toHaveBeenCalledOnceWith('household.members.dissolved');
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'dissolve' });
    });

    it('cannot start offline: the offline refusal comes before either question', async () => {
      online.set(false);
      await dissolve();

      expect(dialog.open).not.toHaveBeenCalled();
      expect(service.dissolve).not.toHaveBeenCalled();
      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it('shows the offline refusal the service gives for a connection lost while the owner was asked', async () => {
      service.dissolve.and.rejectWith(new HouseholdError('household.errors.offline'));
      await dissolve();

      expect(service.dissolve).toHaveBeenCalledTimes(1);
      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      expect(notification.success).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });
  });

  describe('while an action is on its way', () => {
    it('holds every other action', async () => {
      sentInvites.set([sentInvite()]);
      render();
      let finish!: () => void;
      service.remove.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
      memberRow('Sam Ito')!.querySelector<HTMLButtonElement>('button.member-remove')!.click();
      // The confirm answers first; the remove starts once it has.
      await settle();

      const actions = Array.from(element().querySelectorAll<HTMLButtonElement>(
        'button.member-remove, button.invite-send, button.invite-revoke, button.rename-save, button.household-dissolve'
      ));
      expect(actions.length).toBe(6);
      expect(actions.every(action => held(action))).toBe(true);
      // Held, a press reaches the component, which refuses it.
      actions.forEach(action => action.click());
      render();
      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(service.revoke).not.toHaveBeenCalled();
      expect(service.rename).not.toHaveBeenCalled();

      finish();
      await drain();

      expect(actions.every(action => !held(action) && !action.disabled)).toBe(true);
    });
  });

  /** NotificationService announces every message it shows; a second voice would say it twice. */
  describe('announcements', () => {
    it('leaves every message to the notifications, and announces nothing itself', async () => {
      sentInvites.set([sentInvite()]);
      render();
      type(emailInput(), 'jo@example.com');
      await click(sendButton());
      await click(inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-revoke'));
      service.remove.and.rejectWith(new HouseholdError('household.errors.offline'));
      await click(memberRow('Kai')?.querySelector<HTMLButtonElement>('button.member-remove'));

      expect(notification.success).toHaveBeenCalledTimes(2);
      expect(notification.error).toHaveBeenCalledTimes(1);
      expect(announcer.announce).not.toHaveBeenCalled();
      // A form field's own region speaks only its inline error, never a notification.
      const regions = Array.from(element().querySelectorAll('[aria-live], [role="status"], [role="alert"]'))
        .filter(region => !region.closest('mat-form-field'));
      expect(regions.length).toBe(0);
    });
  });

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.width = '311px';
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it("starts each member's tags level with their name", () => {
      for (const name of ['Alex Lin', 'Sam Ito']) {
        const row = memberRow(name)!;
        const nameLeft = row.querySelector('app-member-chip .member-name')!.getBoundingClientRect().left;
        const roleLeft = row.querySelector('.member-role')!.getBoundingClientRect().left;
        expect(Math.abs(roleLeft - nameLeft)).withContext(name).toBeLessThanOrEqual(1);
      }
    });

    it('keeps a long name, a long address and every control inside the section', () => {
      const longName = 'W'.repeat(100);
      const longEmail = `${'e'.repeat(64)}@${'d'.repeat(180)}.example`;
      members.set([alex, member('long', longName), sam]);
      household.set({ ...HOUSEHOLD, name: 'N'.repeat(HOUSEHOLD_NAME_MAX_LENGTH) });
      sentInvites.set([
        sentInvite({ inviteeEmail: longEmail, mail: 'held' }),
        sentInvite({ inviteeUid: 'jo', mail: 'failed', createdAt: Timestamp.fromMillis(Date.now() - 1_000) })
      ]);
      render();
      type(emailInput(), longEmail);

      const section = (element().querySelector('.members') as HTMLElement).getBoundingClientRect();
      const parts = Array.from(element().querySelectorAll<HTMLElement>(
        '.members-title, .member, app-member-chip, .member-role, button.member-remove, ' +
        '.members-subtitle, .members-text, mat-form-field, button.invite-send, .invite, .invite-email, ' +
        '.invite-meta, button.invite-revoke, button.rename-save, button.household-dissolve'
      ));
      // A title; three members, each with a chip and a role, and two Removes;
      // four subtitles (the Dissolve's own among them) and two lines of text;
      // two fields and their two buttons; two invites, each with an address,
      // an expiry, a mail status and a Revoke; the Dissolve.
      expect(parts.length).toBe(1 + 3 * 3 + 2 + 4 + 2 + 2 + 2 + 2 * 5 + 1);
      expect(memberRow(longName)?.textContent).withContext('the whole name is shown').toContain(longName);
      expect(inviteRows()[0].textContent).withContext('the whole address is shown').toContain(longEmail);
      for (const part of parts) {
        const label = `${part.tagName.toLowerCase()}.${part.className}`;
        expect(getComputedStyle(part).textOverflow).withContext(`${label} is not cut`).not.toBe('ellipsis');
        expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth + 1);
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
      }
    });
  });
});
