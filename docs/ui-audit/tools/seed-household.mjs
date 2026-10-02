// Seed three demo accounts and two households into the Auth and Firestore emulators.
// Usage: node seed-household.mjs <sessions.json outside the repo>
//
// Alex Chen (base USD), Sam Lee (base JPY) and Kai Moreau (base EUR): each a
// Google-linked, verified user, each given seed.mjs's data (every row of it
// private, dated May–July 2026), then their own name, address and base
// currency, and a few rows in the current month.
//
// Two households, written past the rules as the app's own commits leave them:
// Chen home (owner Alex, member Sam) and Trip fund (owner Sam, member Kai), so
// Sam holds two memberships and the household page shows its switcher. For
// each membership the household, the member document and the account's index
// entry agree: the member's `since` and the entry's `since` are the
// household's `createdAt`, and the entry carries the member's role and the
// household's name.
//
// Some of this month's rows are shared (`sharedWith` on the row), one of
// Sam's into both households, and each shared row's copy is written into its
// household's ledger with the fields the app's projection gives it
// (projectRow in src/app/core/utils/ledger-projection.utils.ts), computed
// here from BUILT_INS. Every account keeps at least one private row this
// month in a category Chen home's food budget covers, which no household
// figure may count. Chen home has a monthly food budget and a Holiday goal
// (both USD) with one contribution by Sam; Trip fund has a Summer trip goal
// (JPY) with one contribution by Kai.
//
// Any drift between a seeded copy and its row (a catalog entry or the
// projection version changed since this was written) is repaired by the
// app's sweep the first time the copy's author opens the app: the device
// holds no record of a full pass, so the sweep diffs every copy against its
// row and rewrites each one that differs.
//
// Writes the IndexedDB session records for the three to the path given, as
// { alex, sam, kai }; each record is what the Auth SDK keeps in
// firebaseLocalStorageDb/firebaseLocalStorage for the demo app, so putting
// one there and loading the app signs that user in. The web app keeps its
// session in local storage first (ADR 0163): that load carries the record
// across, and the same record goes into local storage directly as its value,
// stringified, under its fbase_key, which is how the e2e protocol swaps the
// account on a page that is already open.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH = 'http://127.0.0.1:9099';
const FSTORE = 'http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents';
const HDRS = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };
const API_KEY = 'demo-api-key';
const SESSION_KEY = `firebase:authUser:${API_KEY}:[DEFAULT]`;

// LEDGER_PROJECTION_VERSION in src/app/models/household-ledger.model.ts.
const PROJECTION_VERSION = 1;

/**
 * The built-in categories the rows use, as defaultCategories()
 * (src/app/core/utils/category-merge.utils.ts) builds them from
 * DEFAULT_EXPENSE_GROUPS (src/app/models/category.model.ts): a
 * subcategory's id is `${group}_${key}`, its name the translation key, its
 * colour its group's. A copy's category snapshot is these three strings, and
 * bucketOf maps a built-in to itself (`bucket`) and its group (`bucketGroup`).
 */
const BUILT_INS = {
  food_groceries: { group: 'food', name: 'categoryNames.groceries', icon: 'shopping_cart', color: '#FF5722' },
  food_restaurants: { group: 'food', name: 'categoryNames.restaurants', icon: 'restaurant', color: '#FF5722' },
  food_snacksAndConvenience: {
    group: 'food', name: 'categoryNames.snacksAndConvenience', icon: 'local_convenience_store', color: '#FF5722',
  },
  bills_electricity: { group: 'bills', name: 'categoryNames.electricity', icon: 'bolt', color: '#607D8B' },
  entertainment_moviesAndShows: {
    group: 'entertainment', name: 'categoryNames.moviesAndShows', icon: 'theaters', color: '#E91E63',
  },
  shopping_homeAndGarden: { group: 'shopping', name: 'categoryNames.homeAndGarden', icon: 'home', color: '#9C27B0' },
  education_booksAndSupplies: {
    group: 'education', name: 'categoryNames.booksAndSupplies', icon: 'auto_stories', color: '#3F51B5',
  },
  transport_parking: { group: 'transport', name: 'categoryNames.parking', icon: 'local_parking', color: '#2196F3' },
  transport_publicTransit: {
    group: 'transport', name: 'categoryNames.publicTransit', icon: 'directions_bus', color: '#2196F3',
  },
  transport_taxiAndRideShare: {
    group: 'transport', name: 'categoryNames.taxiAndRideShare', icon: 'local_taxi', color: '#2196F3',
  },
  travel_hotelsAndAccommodation: {
    group: 'travel', name: 'categoryNames.hotelsAndAccommodation', icon: 'hotel', color: '#00BCD4',
  },
};

/** The two households, by the id the seed gives them. Days are before the seed runs. */
const HOUSEHOLDS = {
  'chen-home': { name: 'Chen home', owner: 'alex', member: 'sam', createdDaysAgo: 21 },
  'trip-fund': { name: 'Trip fund', owner: 'sam', member: 'kai', createdDaysAgo: 14 },
};

// Each account's rows this month, all expenses in its own base. `share`
// names the households a row is shared into; a row without it is private.
const USERS = {
  alex: {
    sub: 'demo-alex', email: 'alex.chen@example.com', name: 'Alex Chen', base: 'USD',
    rows: [
      { id: 'tx-hh-1', amount: 96.3, cat: 'bills_electricity', desc: 'Electric bill', share: ['chen-home'] },
      { id: 'tx-hh-2', amount: 28, cat: 'entertainment_moviesAndShows', desc: 'Cinema tickets', share: ['chen-home'] },
      // Private, in the food budget's categories: no household figure counts it.
      { id: 'tx-hh-3', amount: 64.2, cat: 'food_groceries', desc: 'Farmers market' },
      // Private, holding what a copy never reveals, for the journey that shares it.
      {
        id: 'tx-hh-4', amount: 42.75, cat: 'shopping_homeAndGarden', desc: 'Hardware store',
        note: 'Shelf brackets for the hallway', tags: ['home', 'diy'], location: 'Ace Hardware, Valencia St',
      },
      { id: 'tx-hh-5', amount: 23.99, cat: 'education_booksAndSupplies', desc: 'Bookshop' },
      { id: 'tx-hh-6', amount: 12, cat: 'transport_parking', desc: 'Parking garage' },
    ],
  },
  sam: {
    sub: 'demo-sam', email: 'sam.lee@example.com', name: 'Sam Lee', base: 'JPY',
    rows: [
      // Shared, in the food budget's categories: the budget counts it, converted into dollars.
      { id: 'tx-hh-1', amount: 8640, cat: 'food_groceries', desc: 'Supermarket', share: ['chen-home'] },
      { id: 'tx-hh-2', amount: 6200, cat: 'transport_taxiAndRideShare', desc: 'Airport taxi', share: ['chen-home', 'trip-fund'] },
      { id: 'tx-hh-3', amount: 12800, cat: 'transport_publicTransit', desc: 'Train tickets', share: ['trip-fund'] },
      { id: 'tx-hh-4', amount: 1480, cat: 'food_snacksAndConvenience', desc: 'Convenience store' },
    ],
  },
  kai: {
    sub: 'demo-kai', email: 'kai.moreau@example.com', name: 'Kai Moreau', base: 'EUR',
    rows: [
      { id: 'tx-hh-1', amount: 120, cat: 'travel_hotelsAndAccommodation', desc: 'Hostel deposit', share: ['trip-fund'] },
      { id: 'tx-hh-2', amount: 89, cat: 'transport_publicTransit', desc: 'Rail pass', share: ['trip-fund'] },
      { id: 'tx-hh-3', amount: 14.5, cat: 'food_restaurants', desc: 'Lunch' },
    ],
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

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const now = new Date();
// Local midnight on the 1st: a monthly budget starting here counts the
// current calendar month, in this machine's time zone, which the browser
// shares.
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
// Every row falls between the month's start and now: never in the future,
// never in last month, whatever day the seed runs.
const rowDate = (i, count) =>
  new Date(monthStart.getTime() + ((now.getTime() - monthStart.getTime()) * (i + 1)) / (count + 1));

// ---- REST helpers -----------------------------------------------------------

const ts = (d) => ({ timestampValue: d.toISOString() });
const str = (s) => ({ stringValue: s });
const num = (n) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });
const bool = (b) => ({ booleanValue: b });
const list = (values) => ({ arrayValue: { values } });
const map = (fields) => ({ mapValue: { fields } });

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
  // A copy's id is `${uid}_${txId}`, and the rules read its author from the
  // part before the first underscore (ledgerCopyId).
  if (/[_/]/.test(idp.localId)) { console.error('unusable account id', user.email, idp.localId); process.exit(1); }
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
// which would give Sam and Kai Alex's name, address and currency. One PATCH
// with three mask paths sets each profile's own and leaves the rest of the
// profile, the rest of `preferences` included, as seed.mjs wrote it.
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

// ---- Memberships --------------------------------------------------------------

/**
 * One membership as HouseholdService's create (the owner) or accept (a
 * joiner) commits it: the member document and the account's index entry,
 * both of the household's generation. A joiner names the invite it came
 * through, which that commit consumed.
 */
async function seedMembership(hid, household, uid, user, role, joinedAt) {
  const member = {
    uid: str(uid), displayName: str(user.name), role: str(role),
    since: ts(household.createdAt), joinedAt: ts(joinedAt),
  };
  if (role === 'member') member.inviteId = str(`${hid}_${uid}`);
  await put(`households/${hid}/members/${uid}`, member);
  await put(`users/${uid}/households/${hid}`, {
    since: ts(household.createdAt), role: str(role), name: str(household.name), joinedAt: ts(joinedAt),
  });
}

async function seedHouseholds(uids) {
  for (const [hid, h] of Object.entries(HOUSEHOLDS)) {
    h.createdAt = new Date(now.getTime() - h.createdDaysAgo * DAY_MS);
    await put(`households/${hid}`, { name: str(h.name), ownerId: str(uids[h.owner]), createdAt: ts(h.createdAt) });
    await seedMembership(hid, h, uids[h.owner], USERS[h.owner], 'owner', h.createdAt);
    await seedMembership(hid, h, uids[h.member], USERS[h.member], 'member', new Date(h.createdAt.getTime() + 2 * HOUR_MS));
  }
}

// ---- Rows and their copies ------------------------------------------------------

/** projectRow's copy of a row in a built-in category, as the app writes it (the stamp aside). */
function copyFields(uid, row, household) {
  const category = BUILT_INS[row.cat];
  if (!category) { console.error(`${row.id}: ${row.cat} is not in BUILT_INS`); process.exit(1); }
  return {
    memberUid: str(uid), sourceId: str(row.id), gen: ts(household.createdAt), pv: num(PROJECTION_VERSION),
    type: str('expense'), amount: num(row.amount), currency: str(row.currency), date: ts(row.date),
    description: str(row.desc), categoryId: str(row.cat),
    category: map({ name: str(category.name), icon: str(category.icon), color: str(category.color) }),
    bucket: str(row.cat), bucketGroup: str(category.group),
    updatedAt: ts(now),
  };
}

async function seedRows(uid, user) {
  const rows = user.rows.map((r, i) => ({ ...r, currency: user.base, date: rowDate(i, user.rows.length) }));
  for (const r of rows) {
    // Stamped with the base, as the app writes a row today.
    const fields = {
      userId: str(uid), type: str('expense'), amount: num(r.amount), currency: str(r.currency),
      amountInBaseCurrency: num(r.amount), exchangeRate: num(1), baseCurrency: str(user.base),
      categoryId: str(r.cat), description: str(r.desc),
      date: ts(r.date), createdAt: ts(r.date), updatedAt: ts(r.date), isRecurring: bool(false),
    };
    if (r.share) fields.sharedWith = list(r.share.map((hid) => str(`households/${hid}`)));
    if (r.note) fields.note = str(r.note);
    if (r.tags) fields.tags = list(r.tags.map(str));
    if (r.location) fields.location = map({ name: str(r.location) });
    await put(`users/${uid}/transactions/${r.id}`, fields);
    for (const hid of r.share ?? []) {
      await put(`households/${hid}/ledger/${uid}_${r.id}`, copyFields(uid, r, HOUSEHOLDS[hid]));
    }
  }
}

// ---- The households' own budgets and goals ---------------------------------------

async function seedPlans(uids) {
  const chen = HOUSEHOLDS['chen-home'];
  const trip = HOUSEHOLDS['trip-fund'];
  const madeAt = (h) => new Date(h.createdAt.getTime() + DAY_MS);

  await put('households/chen-home/budgets/b-food', {
    gen: ts(chen.createdAt), name: str('Food'), categoryIds: list([str('food')]), amount: num(600),
    currency: str('USD'), period: str('monthly'), startDate: ts(monthStart), alertThreshold: num(80),
    isActive: bool(true), createdBy: str(uids.alex), createdAt: ts(madeAt(chen)), updatedAt: ts(madeAt(chen)),
  });
  await put('households/chen-home/goals/g-holiday', {
    gen: ts(chen.createdAt), name: str('Holiday'), targetAmount: num(3000), currency: str('USD'),
    targetDate: ts(new Date(now.getFullYear() + 1, 6, 1)),
    isActive: bool(true), createdBy: str(uids.alex), createdAt: ts(madeAt(chen)), updatedAt: ts(madeAt(chen)),
  });
  // In the goal's currency, whatever the contributor's base.
  const samGave = new Date(now.getTime() - 2 * DAY_MS);
  await put('households/chen-home/goals/g-holiday/contributions/c-sam-1', {
    gen: ts(chen.createdAt), memberUid: str(uids.sam), amount: num(250), date: ts(samGave), createdAt: ts(samGave),
  });

  await put('households/trip-fund/goals/g-summer-trip', {
    gen: ts(trip.createdAt), name: str('Summer trip'), targetAmount: num(400000), currency: str('JPY'),
    targetDate: ts(new Date(now.getFullYear() + 1, 5, 1)),
    isActive: bool(true), createdBy: str(uids.sam), createdAt: ts(madeAt(trip)), updatedAt: ts(madeAt(trip)),
  });
  const kaiGave = new Date(now.getTime() - DAY_MS);
  await put('households/trip-fund/goals/g-summer-trip/contributions/c-kai-1', {
    gen: ts(trip.createdAt), memberUid: str(uids.kai), amount: num(30000), date: ts(kaiGave), createdAt: ts(kaiGave),
  });
}

// ---- Run ----------------------------------------------------------------------

const seedScript = fileURLToPath(new URL('./seed.mjs', import.meta.url));
const sessions = {};
const uids = {};
for (const [key, user] of Object.entries(USERS)) {
  const idp = await signIn(user);
  const uid = idp.localId;
  execFileSync(process.execPath, [seedScript, uid], { stdio: 'inherit' });
  await patchIdentity(uid, user);
  uids[key] = uid;
  sessions[key] = sessionRecord(user, idp);
  console.log(`${key}: ${user.name} <${user.email}> ${user.base} uid=${uid}`);
}
await seedHouseholds(uids);
for (const [key, user] of Object.entries(USERS)) await seedRows(uids[key], user);
await seedPlans(uids);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
// The mode applies only when the write creates the file, so an earlier run's
// file goes first and the tokens only ever land in a fresh 0600 file; 'wx'
// fails rather than reuse a file something recreated in between.
fs.rmSync(outPath, { force: true });
fs.writeFileSync(outPath, JSON.stringify(sessions, null, 2), { mode: 0o600, flag: 'wx' });
for (const [hid, h] of Object.entries(HOUSEHOLDS)) {
  console.log(`${hid}: ${h.name}, owner ${h.owner}, member ${h.member}, created ${h.createdAt.toISOString()}`);
}
for (const [key, user] of Object.entries(USERS)) {
  const shared = user.rows.filter((r) => r.share).map((r) => `${r.desc} -> ${r.share.join(' + ')}`);
  const kept = user.rows.filter((r) => !r.share).map((r) => r.desc);
  console.log(`${key} shares ${shared.join('; ')}; keeps private ${kept.join(', ')}`);
}
console.log(`session records for ${Object.keys(sessions).join(', ')} -> ${outPath}`);
