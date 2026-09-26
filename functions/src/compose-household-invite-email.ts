/**
 * What the household invite mail says, kept apart from how it is sent, as
 * ./compose-feedback-email is: no imports and no I/O, so a unit test pins
 * every language exactly.
 *
 * The mail carries no text the owner typed. The inviter is named only by the
 * sign-in address their provider verified; the household name and every
 * display name stay in-app, where the invitee sees them after signing in. A
 * mail that relayed owner-typed text would let anyone who can create a
 * household send arbitrary words from the operator's sender, which also
 * carries the feedback mail.
 */

/** Where an invite is accepted or declined. Fixed: nothing in the link comes from the request. */
export const HOUSEHOLD_PAGE_URL = 'https://home-accounter.web.app/household';

/**
 * Only these fields are read. A caller may pass a wider object — the whole
 * invite record, say — and nothing else in it reaches the mail.
 */
export interface HouseholdInviteMailInput {
  /** The inviter's verified sign-in address. */
  inviterEmail: string;
  expiresAt: Date;
  /** The inviter's app language; anything unsupported reads as en. */
  locale: unknown;
}

export interface ComposedInviteMail {
  subject: string;
  text: string;
}

type Compose = (inviter: string, expires: string) => ComposedInviteMail;

const MAILS: Record<'en' | 'ja' | 'tc', Compose> = {
  en: (inviter, expires) => ({
    subject: `${inviter} invited you to a household on Home Account`,
    text: [
      `${inviter} invited you to join their household on Home Account.`,
      '',
      "Household members can see each other's transactions, categories, budgets and goals.",
      '',
      'To accept or decline, sign in with this email address and open:',
      HOUSEHOLD_PAGE_URL,
      '',
      `This invitation expires on ${expires} (UTC).`,
      '',
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n'),
  }),
  ja: (inviter, expires) => ({
    subject: `${inviter} さんから家計簿の世帯への招待が届いています`,
    text: [
      `${inviter} さんが、家計簿の世帯にあなたを招待しました。`,
      '',
      '世帯のメンバーは、お互いの取引、カテゴリ、予算、目標を閲覧できます。',
      '',
      '承諾または辞退するには、このメールアドレスでログインして、次のページを開いてください。',
      HOUSEHOLD_PAGE_URL,
      '',
      `この招待の有効期限は ${expires}（UTC）です。`,
      '',
      'お心当たりがない場合は、このメールを無視してください。',
    ].join('\n'),
  }),
  tc: (inviter, expires) => ({
    subject: `${inviter} 邀請你加入家庭記帳的家庭`,
    text: [
      `${inviter} 邀請你加入他們在家庭記帳的家庭。`,
      '',
      '家庭成員可以互相查看彼此的交易、類別、預算與目標。',
      '',
      '如要接受或拒絕，請使用此電子郵件地址登入，並開啟：',
      HOUSEHOLD_PAGE_URL,
      '',
      `此邀請將於 ${expires}（UTC）到期。`,
      '',
      '如果你並未預期收到此邀請，可以忽略這封郵件。',
    ].join('\n'),
  }),
};

export function composeHouseholdInviteEmail(input: HouseholdInviteMailInput): ComposedInviteMail {
  const compose = input.locale === 'ja' || input.locale === 'tc' ? MAILS[input.locale] : MAILS.en;
  // A verified address carries no line break, but the subject is a header and
  // a break there would start another one.
  const inviter = input.inviterEmail.replace(/[\r\n]+/g, ' ');
  return compose(inviter, input.expiresAt.toISOString().slice(0, 10));
}
