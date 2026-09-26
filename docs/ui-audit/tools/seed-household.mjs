// Seed two household-ready demo accounts into the Auth and Firestore emulators.
// Usage: node seed-household.mjs <sessions.json outside the repo>
//
// Alex Chen (base USD) and Sam Lee (base JPY): each a Google-linked, verified
// user, each given seed.mjs's data, then one custom category, one budget, one
// goal and two rows in the current month, so a household view of the two has
// fresh figures in two currencies. Writes the IndexedDB session records for
// both to the path given, as { alex, sam }; each record is what the Auth SDK
// keeps in firebaseLocalStorageDb/firebaseLocalStorage for the demo app, so
// putting one there and loading the app signs that user in.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH = 'http://127.0.0.1:9099';
const FSTORE = 'http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents';
const HDRS = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };
const API_KEY = 'demo-api-key';
const SESSION_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`;

const USERS = {
  alex: {
    sub: 'demo-alex', email: 'alex.chen@example.com', name: 'Alex Chen', base: 'USD',
    category: { id: 'c-board-games', name: 'Board games', icon: 'casino', color: '#7E57C2' },
    rows: [
      // A converted row from before rows carried their base: see seedHousehold.
      {
        amount: 3200, currency: 'JPY', inBase: 21.94, rate: 0.006855, unstamped: true,
        cat: 'c-board-games', desc: 'Board game café (Tokyo trip)',
      },
      { amount: 64.2, cat: 'food_groceries', desc: 'Farmers market' },
    ],
    budget: { name: 'Groceries', cat: 'food_groceries', amount: 400 },
    goal: { kind: 'saving', name: 'Kitchen renovation', target: 5000, contributed: 1200 },
  },
  sam: {
    sub: 'demo-sam', email: 'sam.lee@example.com', name: 'Sam Lee', base: 'JPY',
    category: { id: 'c-pottery', name: 'Pottery', icon: 'palette', color: '#26A69A' },
    rows: [
      { amount: 4500, cat: 'c-pottery', desc: 'Pottery class' },
      { amount: 8640, cat: 'food_groceries', desc: 'Supermarket' },
    ],
    budget: { name: 'Groceries', cat: 'food_groceries', amount: 60000 },
    goal: { kind: 'project', name: 'Hokkaido trip', target: 300000, contributed: 45000 },
  },
};

// ---- The output path: checked before anything is written anywhere ----------

/**
 * The real path of `p`, or of its nearest existing ancestor with the rest
 * appended. The native call returns the on-disk case: on a case-insensitive
 * volume the JS realpath keeps the case as typed, so a differently-cased path
 * into the repository would not start with the repository's root.
 */
function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  while (!fs.existsSync(cur)) {
    rest.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  return path.join(fs.realpathSync.native(cur), ...rest);
}

/** This checkout, and the main checkout when this one is a git worktree. */
function repoRoots() {
  const own = fileURLToPath(new URL('../../../', import.meta.url));
  const roots = [own];
  try {
    const common = execFileSync('git', ['-C', own, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    roots.push(path.dirname(common));
  } catch { /* not a git checkout: the script's own tree is still refused */ }
  return roots.map(realish);
}

const outArg = process.argv[2];
if (!outArg) { console.error('usage: node seed-household.mjs <sessions.json outside the repo>'); process.exit(1); }
const outPath = realish(outArg);
// The records carry live refresh tokens for the emulator accounts; inside a
// checkout they are one `git add` away from being committed.
const holder = repoRoots().find((root) => outPath === root || outPath.startsWith(root + path.sep));
if (holder) { console.error(`refusing to write sessions inside the repository (${holder}): ${outPath}`); process.exit(1); }

// ---- Dates: the current month, computed now --------------------------------

const pad = (n) => String(n).padStart(2, '0');
// transaction-date.utils.ts dayKey: yyyy-MM-dd in local time.
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
// budget.service.ts stamps `spent` with dayKey(budgetPeriodWindow(period,
// startDate, now).start). A monthly budget anchored on the 1st starts its
// window on the 1st of the current month, so this stamp reads as current —
// in this machine's time zone, which the browser shares.
const spentPeriod = dayKey(monthStart);
// Both rows fall between the month's start and now: never in the future,
// never in last month, whatever day the seed runs.
const rowDate = (i, count) =>
  new Date(monthStart.getTime() + ((now.getTime() - monthStart.getTime()) * (i + 1)) / (count + 1));

// ---- REST helpers -----------------------------------------------------------

const ts = (d) => ({ timestampValue: d.toISOString() });
const str = (s) => ({ stringValue: s });
const num = (n) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });
const bool = (b) => ({ booleanValue: b });

async function put(docPath, fields) {
  const res = await fetch(`${FSTORE}/${docPath}`, { method: 'PATCH', headers: HDRS, body: JSON.stringify({ fields }) });
  if (!res.ok) { console.error('FAIL', docPath, res.status, await res.text()); process.exit(1); }
}

async function signIn(user) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: user.sub, email: user.email, email_verified: true, name: user.name }))}&providerId=google.com`,
      requestUri: 'http://127.0.0.1',
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  const idp = await res.json();
  if (!idp.localId) { console.error('auth precreate failed', user.email, idp); process.exit(1); }
  return idp;
}

/** The capture.mjs authRecord, as the IndexedDB row that holds it. */
function sessionRecord(user, idp) {
  return {
    fbase_key: SESSION_KEY,
    value: {
      uid: idp.localId,
      email: user.email,
      emailVerified: true,
      displayName: user.name,
      isAnonymous: false,
      photoURL: null,
      providerData: [{
        providerId: 'google.com', uid: user.sub, displayName: user.name,
        email: user.email, phoneNumber: null, photoURL: null,
      }],
      stsTokenManager: {
        refreshToken: idp.refreshToken,
        accessToken: idp.idToken,
        expirationTime: Date.now() + 55 * 60 * 1000,
      },
      createdAt: String(Date.now()),
      lastLoginAt: String(Date.now()),
      apiKey: API_KEY,
      appName: '[DEFAULT]',
    },
  };
}

// seed.mjs writes Alex's identity and a USD base onto every profile it seeds,
// which would give Sam Alex's name, address and currency. One PATCH with three
// mask paths sets each profile's own and leaves the rest of the profile, the
// rest of `preferences` included, as seed.mjs wrote it.
async function patchIdentity(uid, user) {
  const mask = ['email', 'displayName', 'preferences.baseCurrency']
    .map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const res = await fetch(`${FSTORE}/users/${uid}?${mask}`, {
    method: 'PATCH',
    headers: HDRS,
    body: JSON.stringify({ fields: {
      email: str(user.email),
      displayName: str(user.name),
      preferences: { mapValue: { fields: { baseCurrency: str(user.base) } } },
    } }),
  });
  if (!res.ok) { console.error('profile patch failed', user.email, res.status, await res.text()); process.exit(1); }
}

async function seedHousehold(uid, user) {
  const c = user.category;
  await put(`users/${uid}/categories/${c.id}`, {
    userId: str(uid), name: str(c.name), icon: str(c.icon), color: str(c.color), type: str('expense'),
    order: num(100), isActive: bool(true), isDefault: bool(false),
  });

  // Rows in the base are stamped with it, as the app writes rows today. Alex's
  // JPY row is the older kind: converted, with no stamp. It is dated in the
  // current period because that is the one the household page opens on
  // (seed.mjs's unstamped rows are May–July). A member on another base counts
  // it right only when the ledger makes an unstamped peer row convert live:
  // taken as stored, Sam's JPY view would count its USD snapshot as yen. That
  // shows in the member and combined totals, not on the row, which shows no
  // converted figure when its currency is the viewer's base. It stays out of
  // the budget's category, whose `spent` is in the owner's base.
  const rows = user.rows.map((r, i) => ({ ...r, date: rowDate(i, user.rows.length) }));
  for (const [i, r] of rows.entries()) {
    const fields = {
      userId: str(uid), type: str('expense'), amount: num(r.amount), currency: str(r.currency ?? user.base),
      amountInBaseCurrency: num(r.inBase ?? r.amount), exchangeRate: num(r.rate ?? 1),
      categoryId: str(r.cat), description: str(r.desc),
      date: ts(r.date), createdAt: ts(r.date), updatedAt: ts(r.date), isRecurring: bool(false),
    };
    if (!r.unstamped) fields.baseCurrency = str(user.base);
    await put(`users/${uid}/transactions/tx-household-${i + 1}`, fields);
  }

  const b = user.budget;
  const spent = rows.filter((r) => r.cat === b.cat).reduce((sum, r) => sum + (r.inBase ?? r.amount), 0);
  await put(`users/${uid}/budgets/b-household`, {
    userId: str(uid), categoryId: str(b.cat), name: str(b.name), amount: num(b.amount),
    currency: str(user.base), period: str('monthly'), startDate: ts(monthStart),
    spent: num(spent), spentPeriod: str(spentPeriod), isActive: bool(true), alertThreshold: num(80),
    createdAt: ts(monthStart), updatedAt: ts(now),
  });

  const g = user.goal;
  await put(`users/${uid}/goals/g-household`, {
    userId: str(uid), kind: str(g.kind), name: str(g.name), targetAmount: num(g.target),
    contributedAmount: num(g.contributed), linkedAmount: num(0), currency: str(user.base),
    targetDate: ts(new Date(now.getFullYear() + 1, 11, 31)), isActive: bool(true),
    createdAt: ts(monthStart), updatedAt: ts(now),
  });
}

// ---- Run ----------------------------------------------------------------------

const seedScript = fileURLToPath(new URL('./seed.mjs', import.meta.url));
const sessions = {};
for (const [key, user] of Object.entries(USERS)) {
  const idp = await signIn(user);
  const uid = idp.localId;
  execFileSync(process.execPath, [seedScript, uid], { stdio: 'inherit' });
  await patchIdentity(uid, user);
  await seedHousehold(uid, user);
  sessions[key] = sessionRecord(user, idp);
  console.log(`${key}: ${user.name} <${user.email}> ${user.base} uid=${uid}`);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
// The mode applies only when the write creates the file, so an earlier run's
// file goes first and the tokens only ever land in a fresh 0600 file; 'wx'
// fails rather than reuse a file something recreated in between.
fs.rmSync(outPath, { force: true });
fs.writeFileSync(outPath, JSON.stringify(sessions, null, 2), { mode: 0o600, flag: 'wx' });
console.log(`period ${spentPeriod}; session records for ${Object.keys(sessions).join(', ')} -> ${outPath}`);
