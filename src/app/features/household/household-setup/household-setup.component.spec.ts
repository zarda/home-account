import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';

import en from '../../../../assets/i18n/en.json';
import { HouseholdSetupComponent } from './household-setup.component';
import {
  HOUSEHOLD_NAME_MAX_LENGTH,
  HouseholdError,
  HouseholdService
} from '../../../core/services/household.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { HouseholdInvite } from '../../../models';
import { HouseholdPageFocus } from '../household-focus';

const DAY = 24 * 60 * 60 * 1000;

function invite(overrides: Partial<HouseholdInvite> = {}): HouseholdInvite {
  const householdId = overrides.householdId ?? 'h1';
  return {
    id: `${householdId}_me`,
    householdId,
    householdCreatedAt: Timestamp.fromMillis(1_700_000_000_000),
    householdName: 'The Lins',
    inviterUid: 'owner-1',
    inviterName: 'Alex Lin',
    inviterEmail: 'alex@example.com',
    inviteeUid: 'me',
    inviteeEmail: 'me@example.com',
    locale: 'en',
    createdAt: Timestamp.fromMillis(Date.now() - DAY),
    expiresAt: Timestamp.fromMillis(Date.now() + 6 * DAY),
    mail: 'sent',
    ...overrides
  };
}

// Rendered throughout (ADR 0144): the form's refusal, the invite lines and
// the buttons that act on them are all template facts.
describe('HouseholdSetupComponent', () => {
  let fixture: ComponentFixture<HouseholdSetupComponent>;
  let receivedInvites: ReturnType<typeof signal<HouseholdInvite[]>>;
  let household: jasmine.SpyObj<Pick<HouseholdService, 'create' | 'accept' | 'decline'>>;
  let notification: jasmine.SpyObj<Pick<NotificationService, 'success' | 'error'>>;
  let analytics: jasmine.SpyObj<Pick<AnalyticsService, 'trackHouseholdAction'>>;
  let dialog: jasmine.SpyObj<Pick<MatDialog, 'open'>>;
  let formatDate: jasmine.Spy;
  let online: ReturnType<typeof signal<boolean>>;
  let afterSwapTo: jasmine.Spy;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const nameInput = (): HTMLInputElement => element().querySelector<HTMLInputElement>('input[name="householdName"]')!;
  const createButton = (): HTMLButtonElement => element().querySelector<HTMLButtonElement>('button.create-household')!;
  const inviteRows = (): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>('.invite'));

  function render(): void {
    fixture.detectChanges();
  }

  /** Lets afterNextRender run: it fires on the app's own tick, which detectChanges alone does not run. */
  async function settleFocus(): Promise<void> {
    render();
    await fixture.whenStable();
    TestBed.tick();
  }

  const held = (button: HTMLButtonElement | null | undefined): boolean =>
    button?.getAttribute('aria-disabled') === 'true';

  /** Settles the service call a click started, and whatever it did after. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    render();
  }

  function typeName(value: string): void {
    const input = nameInput();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    render();
  }

  async function submit(): Promise<void> {
    createButton().click();
    render();
    await settle();
  }

  beforeEach(async () => {
    receivedInvites = signal<HouseholdInvite[]>([]);
    household = jasmine.createSpyObj('HouseholdService', ['create', 'accept', 'decline']);
    household.create.and.resolveTo('h-new');
    household.accept.and.resolveTo('The Lins');
    household.decline.and.resolveTo();
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['trackHouseholdAction']);
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    dialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
    formatDate = jasmine.createSpy('formatDate').and.returnValue('Sep 30, 2026');
    online = signal(true);

    await TestBed.configureTestingModule({
      imports: [HouseholdSetupComponent, NoopAnimationsModule],
      providers: [
        { provide: HouseholdService, useValue: { ...household, receivedInvites } },
        { provide: NotificationService, useValue: notification },
        { provide: AnalyticsService, useValue: analytics },
        { provide: MatDialog, useValue: dialog },
        { provide: DateFormatService, useValue: { formatDate } },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: PwaService, useValue: { isOnline: online } },
        HouseholdPageFocus
      ]
    }).compileComponents();

    afterSwapTo = spyOn(TestBed.inject(HouseholdPageFocus), 'afterSwapTo');
    fixture = TestBed.createComponent(HouseholdSetupComponent);
    render();
  });

  describe('starting a household', () => {
    it('offers a labelled name field capped at the rules’ length', () => {
      expect(element().textContent).toContain('household.setup.createTitle');
      expect(element().querySelector('mat-label')?.textContent).toContain('household.setup.nameLabel');
      expect(nameInput().maxLength).toBe(HOUSEHOLD_NAME_MAX_LENGTH);
    });

    it('creates with a name of one character', async () => {
      typeName('A');
      await submit();

      expect(household.create).toHaveBeenCalledOnceWith('A');
    });

    it('creates with a name of sixty characters, trimmed', async () => {
      const name = 'x'.repeat(HOUSEHOLD_NAME_MAX_LENGTH);
      typeName(`  ${name}  `);
      await submit();

      expect(household.create).toHaveBeenCalledOnceWith(name);
    });

    it('hands focus to the page for the member view that replaces this setup', async () => {
      typeName('The Lins');
      await submit();

      expect(afterSwapTo).toHaveBeenCalledOnceWith('member');
    });

    it('keeps focus on the button, and asks for no swap, when the service refuses', async () => {
      household.create.and.rejectWith(new HouseholdError('household.errors.offline'));
      typeName('The Lins');
      createButton().focus();
      await submit();

      expect(afterSwapTo).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(createButton());
    });

    it('confirms the household, and clears the field', async () => {
      typeName('The Lins');
      await submit();

      expect(notification.success).toHaveBeenCalledOnceWith('household.setup.created');
      expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'create' });
      expect(nameInput().value).toBe('');
      expect(element().querySelector('mat-error')).withContext('the cleared field is not refused').toBeNull();
    });

    it('refuses a name that is only spaces inline, without asking the service', async () => {
      typeName('   ');
      await submit();

      expect(household.create).not.toHaveBeenCalled();
      expect(element().querySelector('mat-error')?.textContent).toContain(
        `household.errors.name:${JSON.stringify({ max: HOUSEHOLD_NAME_MAX_LENGTH })}`
      );
      expect(notification.error).not.toHaveBeenCalled();
      expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
    });

    it('refuses an empty name inline too', async () => {
      await submit();

      expect(household.create).not.toHaveBeenCalled();
      expect(element().querySelector('mat-error')).not.toBeNull();
    });

    it('refuses a name longer than the rules allow', async () => {
      typeName('x'.repeat(HOUSEHOLD_NAME_MAX_LENGTH + 1));
      await submit();

      expect(household.create).not.toHaveBeenCalled();
      expect(element().querySelector('mat-error')).not.toBeNull();
    });

    it('shows a refusal in the words the service gave it', async () => {
      household.create.and.rejectWith(new HouseholdError('household.errors.alreadyMember'));
      typeName('The Lins');
      await submit();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.alreadyMember');
      expect(analytics.trackHouseholdAction).withContext('only a success is counted').not.toHaveBeenCalled();
      expect(nameInput().value).withContext('the name survives a refusal').toBe('The Lins');
    });

    it('shows the offline refusal as the service words it', async () => {
      household.create.and.rejectWith(new HouseholdError('household.errors.offline'));
      typeName('The Lins');
      await submit();

      expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
    });

    it('shows any other failure as the generic copy', async () => {
      household.create.and.rejectWith(new Error('User not authenticated'));
      typeName('The Lins');
      await submit();

      expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
    });

    it('does not start a second create while one is running', async () => {
      let finish!: (id: string) => void;
      household.create.and.returnValue(new Promise<string>(resolve => (finish = resolve)));
      typeName('The Lins');
      createButton().click();
      render();

      // Held, not disabled: a disabled button would drop focus on the document.
      expect(held(createButton())).toBe(true);
      expect(createButton().disabled).toBe(false);
      createButton().click();
      element().querySelector('form')!.dispatchEvent(new Event('submit'));
      render();

      expect(household.create).toHaveBeenCalledTimes(1);
      finish('h-new');
      await settle();

      expect(held(createButton())).toBe(false);
    });
  });

  describe('invites for you', () => {
    it('says there are none', () => {
      expect(inviteRows().length).toBe(0);
      expect(element().textContent).toContain('household.setup.invitesTitle');
      expect(element().textContent).toContain('household.setup.noInvites');
    });

    it('lists each invite with its household, its inviter and its expiry', () => {
      const pending = invite();
      receivedInvites.set([pending, invite({ householdId: 'h2', householdName: 'Flat 4B', inviterName: 'Sam' })]);
      render();

      expect(inviteRows().length).toBe(2);
      const first = inviteRows()[0].textContent ?? '';
      expect(first).toContain('The Lins');
      expect(first).toContain(`household.setup.invitedBy:${JSON.stringify({ name: 'Alex Lin' })}`);
      expect(first).toContain(`household.setup.expires:${JSON.stringify({ date: 'Sep 30, 2026' })}`);
      expect(formatDate).toHaveBeenCalledWith(pending.expiresAt);
      expect(inviteRows()[1].textContent).toContain('Flat 4B');
      expect(element().textContent).not.toContain('household.setup.noInvites');
    });

    it('leaves out the inviter when the invite carries no name for them', () => {
      receivedInvites.set([invite({ inviterName: '' })]);
      render();

      expect(inviteRows()[0].textContent).not.toContain('household.setup.invitedBy');
    });

    it('names the address the inviter signs in with, which their provider verified', () => {
      receivedInvites.set([invite()]);
      render();

      const row = inviteRows()[0];
      expect(row.querySelector('.invite-from')?.textContent)
        .toContain(`household.setup.invitedFrom:${JSON.stringify({ email: 'alex@example.com' })}`);
      expect(row.textContent).not.toContain('household.setup.inviterUnverified');
    });

    it('says plainly when the inviter has no verified address, whatever name they gave', () => {
      receivedInvites.set([invite({ inviterEmail: null }), invite({ householdId: 'h2', inviterEmail: undefined })]);
      render();

      for (const row of inviteRows()) {
        expect(row.textContent).toContain(`household.setup.invitedBy:${JSON.stringify({ name: 'Alex Lin' })}`);
        expect(row.querySelector('.invite-from.is-unverified')?.textContent).toContain('household.setup.inviterUnverified');
        expect(row.textContent).not.toContain('household.setup.invitedFrom');
      }
    });

    it('says when an invite has expired, and offers only to decline it', () => {
      receivedInvites.set([invite({ expiresAt: Timestamp.fromMillis(Date.now() - DAY) })]);
      render();

      const row = inviteRows()[0];
      expect(row.textContent).toContain(`household.setup.expired:${JSON.stringify({ date: 'Sep 30, 2026' })}`);
      expect(row.querySelector('button.invite-accept')).toBeNull();
      expect(row.querySelector('button.invite-decline')).not.toBeNull();
    });

    it('ties each invite’s buttons to its household name', () => {
      receivedInvites.set([invite()]);
      render();

      const row = inviteRows()[0];
      const nameId = row.querySelector('.invite-name')?.id;
      expect(nameId).toBeTruthy();
      expect(row.querySelector('button.invite-accept')?.getAttribute('aria-describedby')).toBe(nameId!);
      expect(row.querySelector('button.invite-decline')?.getAttribute('aria-describedby')).toBe(nameId!);
    });

    describe('accepting', () => {
      beforeEach(() => {
        receivedInvites.set([invite()]);
        render();
      });

      const accept = async (): Promise<void> => {
        inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-accept')!.click();
        render();
        await settle();
      };

      const dialogData = (): ConfirmDialogData =>
        (dialog.open.calls.mostRecent().args[1] as { data: ConfirmDialogData }).data;

      it('first discloses what the other members will see', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
        await accept();

        expect(dialog.open).toHaveBeenCalledTimes(1);
        expect(dialog.open.calls.mostRecent().args[0]).toBe(ConfirmDialogComponent);
        expect(dialogData().title).toBe(`household.setup.acceptTitle:${JSON.stringify({ name: 'The Lins' })}`);
        const from = `household.setup.acceptFrom:${JSON.stringify({ email: 'alex@example.com' })}`;
        expect(dialogData().message).toBe(`household.setup.acceptDisclosure:${JSON.stringify({ from, name: 'The Lins' })}`);
        expect(dialogData().confirmLabel).toBe('household.setup.acceptConfirm');
      });

      it('says in the disclosure when the inviter has no verified address', async () => {
        receivedInvites.set([invite({ inviterEmail: null })]);
        render();
        dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
        await accept();

        const from = 'household.setup.acceptFromUnverified';
        expect(dialogData().message).toBe(`household.setup.acceptDisclosure:${JSON.stringify({ from, name: 'The Lins' })}`);
      });

      it('cannot start offline: the offline refusal comes before the disclosure', async () => {
        online.set(false);
        await accept();

        expect(dialog.open).not.toHaveBeenCalled();
        expect(household.accept).not.toHaveBeenCalled();
        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
      });

      /**
       * The disclosure is the one place a joiner learns that the receipt
       * photos open through their stored links, which no rule governs. The
       * key is asserted above; the copy under it is asserted here, in the
       * catalog every other locale is kept at parity with.
       */
      it('names every kind the others will read, the receipt links, and who can change them', () => {
        const copy = en.household.setup.acceptDisclosure;

        expect(copy).toContain('{{name}}');
        expect(copy).toMatch(/^\{\{from\}\} /);
        for (const phrase of [
          'transactions', 'past and future', 'notes', 'places', 'receipt photos', 'links',
          'after you leave', 'until you delete the receipt', 'categories', 'budgets', 'goals',
          'anyone who joins it later'
        ]) {
          expect(copy).withContext(phrase).toContain(phrase);
        }
        expect(copy).toMatch(/nobody can change/i);
      });

      it('does not join when the disclosure is dismissed', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(false) } as never);
        await accept();

        expect(household.accept).not.toHaveBeenCalled();
        expect(notification.success).not.toHaveBeenCalled();
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('does not join when the disclosure closes without an answer', async () => {
        dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
        await accept();

        expect(household.accept).not.toHaveBeenCalled();
      });

      it('joins on a confirm, and says so', async () => {
        await accept();

        expect(household.accept).toHaveBeenCalledOnceWith('h1');
        expect(notification.success).toHaveBeenCalledOnceWith(
          `household.setup.joined:${JSON.stringify({ name: 'The Lins' })}`
        );
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'accept' });
        expect(afterSwapTo).toHaveBeenCalledOnceWith('member');
      });

      it("names the household as it is called now, not as the invite was sent, in the page it joins", async () => {
        household.accept.and.resolveTo('Chen & Lee');
        await accept();

        expect(notification.success).toHaveBeenCalledOnceWith(
          `household.setup.joined:${JSON.stringify({ name: 'Chen & Lee' })}`
        );
      });

      for (const key of [
        'household.errors.expired',
        'household.errors.inviteGone',
        'household.errors.alreadyMember',
        'household.errors.offline'
      ]) {
        it(`shows ${key} when the service refuses with it`, async () => {
          household.accept.and.rejectWith(new HouseholdError(key));
          await accept();

          expect(notification.error).toHaveBeenCalledOnceWith(key);
          expect(notification.success).not.toHaveBeenCalled();
          expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
          expect(afterSwapTo).not.toHaveBeenCalled();
        });
      }

      it('shows any other failure as the generic copy', async () => {
        household.accept.and.rejectWith(new Error('boom'));
        await accept();

        expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
      });
    });

    describe('declining', () => {
      beforeEach(() => {
        receivedInvites.set([invite()]);
        render();
      });

      const decline = async (): Promise<void> => {
        inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-decline')!.click();
        render();
        await settle();
      };

      it('declines that household’s invite, and says so', async () => {
        await decline();

        expect(household.decline).toHaveBeenCalledOnceWith('h1');
        expect(dialog.open).not.toHaveBeenCalled();
        expect(notification.success).toHaveBeenCalledOnceWith('household.setup.declined');
        expect(analytics.trackHouseholdAction).toHaveBeenCalledOnceWith({ action: 'decline' });
      });

      it('shows the offline refusal as the service words it', async () => {
        household.decline.and.rejectWith(new HouseholdError('household.errors.offline'));
        await decline();

        expect(notification.error).toHaveBeenCalledOnceWith('household.errors.offline');
        expect(analytics.trackHouseholdAction).not.toHaveBeenCalled();
      });

      it('shows any other failure as the generic copy', async () => {
        household.decline.and.rejectWith(new Error('boom'));
        await decline();

        expect(notification.error).toHaveBeenCalledOnceWith('errors.generic');
      });

      it('holds both buttons while an answer is on its way', async () => {
        let finish!: () => void;
        household.decline.and.returnValue(new Promise<void>(resolve => (finish = resolve)));
        inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-decline')!.click();
        render();

        const buttons = Array.from(inviteRows()[0].querySelectorAll('button'));
        expect(buttons.length).toBe(2);
        expect(buttons.every(button => held(button))).toBe(true);
        buttons.forEach(button => button.click());
        render();
        expect(household.decline).toHaveBeenCalledTimes(1);
        expect(dialog.open).not.toHaveBeenCalled();

        finish();
        await settle();

        expect(Array.from(inviteRows()[0].querySelectorAll('button')).every(button => !held(button))).toBe(true);
      });

      it("moves focus to the list's heading once the declined invite's row goes", async () => {
        const declineButton = inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-decline')!;
        declineButton.focus();
        await decline();
        expect(document.activeElement).withContext('held, the button keeps focus until its row goes').toBe(declineButton);

        receivedInvites.set([]);
        await settleFocus();

        const heading = element().querySelector<HTMLElement>('#household-invites-title');
        expect(document.activeElement).toBe(heading);
        expect(heading?.getAttribute('tabindex')).withContext('script can focus it, Tab does not').toBe('-1');
      });

      it('keeps focus on Decline when the service refuses', async () => {
        household.decline.and.rejectWith(new HouseholdError('household.errors.offline'));
        const declineButton = inviteRows()[0].querySelector<HTMLButtonElement>('button.invite-decline')!;
        declineButton.focus();
        await decline();
        await settleFocus();

        expect(document.activeElement).toBe(declineButton);
        expect(held(declineButton)).toBe(false);
      });
    });
  });
});
