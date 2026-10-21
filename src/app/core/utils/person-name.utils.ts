/** The translator a caller hands in: the translation service's `t`, or a stub's. */
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The name an account gave, trimmed; empty when it gave none or only white
 * space. Every place that shows the account holder's or a household member's
 * name, or stores one for others to see, reads it through this, so "no name"
 * is one thing for them: a fallback word is the caller's to choose and is
 * never stored in its place. A stored "User" is a name, as any other.
 * The household invite list does not: it shows the callable's `inviterName`
 * as given and hides its *Invited by* line when that name is empty.
 */
export function givenName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/**
 * The account holder as the page names them: the name the account gave, or a
 * word for an account that gave none, which sign-in providers allow. The word
 * is the catalog's, so it follows the reader's language; it is never stored,
 * so changing language changes it everywhere at once.
 */
export function accountDisplayName(name: string | null | undefined, t: Translate): string {
  return givenName(name) || t('common.unnamedAccount');
}

/**
 * A household member as the page names them: the name they gave, or a word
 * for a member who gave none, which the rules allow. The word comes in two
 * forms because a sentence can open with it or carry it mid-way ("A member
 * was removed" against "Remove a member?"); a language that does not tell
 * them apart gives both keys the same words.
 */
export function memberDisplayName(
  name: string | null | undefined,
  t: Translate,
  form: 'start' | 'inline' = 'start'
): string {
  return givenName(name) || (form === 'inline' ? t('household.unnamedMemberInline') : t('household.unnamedMember'));
}

/**
 * The welcome the dashboard opens with. The first word of the name goes into
 * one sentence the catalog writes, so a language that puts the name elsewhere
 * or adds a suffix to it says so itself; an account with no name is welcomed
 * plainly. The name is split on any white space, the ideographic space
 * (U+3000) of a Japanese or Chinese name included, so a family name written
 * first is the word that greets.
 */
export function welcomeGreeting(name: string | null | undefined, t: Translate): string {
  const first = givenName(name).split(/\s+/)[0];
  return first ? t('common.welcomeNamed', { name: first }) : t('common.welcome');
}
