// Seed the Firestore emulator with realistic demo data for screenshots.
// Usage: node seed.mjs <uid>
const uid = process.argv[2];
if (!uid) { console.error('usage: node seed.mjs <uid>'); process.exit(1); }

const BASE = `http://127.0.0.1:8080/v1/projects/demo-home-account/databases/(default)/documents`;
const HDRS = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };

const ts = (iso) => ({ timestampValue: iso });
const str = (s) => ({ stringValue: s });
const num = (n) => (Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n });
const bool = (b) => ({ booleanValue: b });

async function put(path, fields) {
  const res = await fetch(`${BASE}/${path}`, { method: 'PATCH', headers: HDRS, body: JSON.stringify({ fields }) });
  if (!res.ok) { console.error('FAIL', path, res.status, await res.text()); process.exit(1); }
}

const now = '2026-07-03T09:00:00Z';

function txFields(t) {
  const f = {
    userId: str(uid),
    type: str(t.type),
    amount: num(t.amount),
    currency: str(t.currency || 'USD'),
    amountInBaseCurrency: num(t.base ?? t.amount),
    exchangeRate: num(t.rate ?? 1),
    categoryId: str(t.cat),
    description: str(t.desc),
    date: ts(t.date),
    createdAt: ts(t.date),
    updatedAt: ts(t.date),
    isRecurring: bool(!!t.recurring),
  };
  if (t.tags) f.tags = { arrayValue: { values: t.tags.map((x) => ({ stringValue: x })) } };
  if (t.note) f.note = str(t.note);
  if (t.location) f.location = { mapValue: { fields: { name: str(t.location) } } };
  return f;
}

const txs = [
  // July 2026 (current month)
  { type: 'expense', amount: 6.4, cat: 'food_coffeeAndDrinks', desc: 'Blue Bottle Coffee', date: '2026-07-03T08:15:00Z', tags: ['coffee'] },
  { type: 'expense', amount: 54.2, cat: 'food_groceries', desc: 'Whole Foods Market', date: '2026-07-02T18:40:00Z', location: 'Whole Foods, Market St' },
  { type: 'expense', amount: 32.5, cat: 'food_restaurants', desc: 'Dinner at Nopa', date: '2026-07-02T20:10:00Z' },
  { type: 'expense', amount: 15.99, cat: 'subscriptions', desc: 'Netflix', date: '2026-07-01T12:00:00Z', recurring: true },
  { type: 'expense', amount: 2200, cat: 'bills', desc: 'Rent - July', date: '2026-07-01T09:00:00Z', recurring: true },
  { type: 'income', amount: 6800, cat: 'employment', desc: 'Salary - July', date: '2026-07-01T08:00:00Z', recurring: true },
  { type: 'expense', amount: 48, cat: 'transport', desc: 'Clipper card top-up', date: '2026-07-01T08:30:00Z' },
  { type: 'expense', amount: 89.99, cat: 'shopping', desc: 'Uniqlo - summer clothes', date: '2026-07-02T15:00:00Z' },
  { type: 'expense', cat: 'travel_flights', desc: 'Shinjuku ramen (trip)', date: '2026-07-02T10:00:00Z', currency: 'JPY', amount: 3800, base: 26.05, rate: 0.006855, note: 'Summer trip' },
  // June 2026
  { type: 'income', amount: 6800, cat: 'employment', desc: 'Salary - June', date: '2026-06-01T08:00:00Z', recurring: true },
  { type: 'income', amount: 420, cat: 'self_employment', desc: 'Freelance design invoice', date: '2026-06-18T10:00:00Z' },
  { type: 'expense', amount: 2200, cat: 'bills', desc: 'Rent - June', date: '2026-06-01T09:00:00Z', recurring: true },
  { type: 'expense', amount: 15.99, cat: 'subscriptions', desc: 'Netflix', date: '2026-06-01T12:00:00Z', recurring: true },
  { type: 'expense', amount: 11.99, cat: 'subscriptions', desc: 'Spotify', date: '2026-06-03T12:00:00Z', recurring: true },
  { type: 'expense', amount: 132.4, cat: 'bills_electricity', desc: 'PG&E June bill', date: '2026-06-12T12:00:00Z' },
  { type: 'expense', amount: 68.2, cat: 'food_groceries', desc: 'Trader Joes', date: '2026-06-05T18:00:00Z' },
  { type: 'expense', amount: 41.7, cat: 'food_groceries', desc: 'Safeway', date: '2026-06-13T18:00:00Z' },
  { type: 'expense', amount: 75.5, cat: 'food_restaurants', desc: 'Team dinner - Ramen Nagi', date: '2026-06-14T20:00:00Z' },
  { type: 'expense', amount: 28.9, cat: 'food_delivery', desc: 'DoorDash - Thai', date: '2026-06-20T19:30:00Z' },
  { type: 'expense', amount: 22, cat: 'entertainment_moviesAndShows', desc: 'AMC - Dune Part 3', date: '2026-06-21T21:00:00Z' },
  { type: 'expense', amount: 65, cat: 'entertainment', desc: 'Concert tickets', date: '2026-06-27T19:00:00Z' },
  { type: 'expense', amount: 120, cat: 'health', desc: 'Dentist copay', date: '2026-06-09T14:00:00Z' },
  { type: 'expense', amount: 35, cat: 'health_gymAndFitness', desc: 'Gym membership', date: '2026-06-02T07:00:00Z', recurring: true },
  { type: 'expense', amount: 52.3, cat: 'transport_fuelAndGas', desc: 'Shell gas', date: '2026-06-16T17:00:00Z' },
  { type: 'expense', amount: 18.5, cat: 'transport_taxiAndRideShare', desc: 'Uber to SFO', date: '2026-06-25T06:30:00Z' },
  { type: 'expense', amount: 149, cat: 'shopping_electronics', desc: 'AirPods case + charger', date: '2026-06-22T13:00:00Z' },
  { type: 'expense', amount: 45.8, cat: 'personal', desc: 'Haircut', date: '2026-06-11T11:00:00Z' },
  { type: 'expense', amount: 89, cat: 'education_booksAndSupplies', desc: "O'Reilly annual books", date: '2026-06-07T10:00:00Z' },
  { type: 'expense', amount: 60, cat: 'gifts', desc: "Mom's birthday gift", date: '2026-06-15T12:00:00Z' },
  { type: 'expense', amount: 26.4, cat: 'pets', desc: 'Cat food + litter', date: '2026-06-08T16:00:00Z' },
  // May 2026
  { type: 'income', amount: 6800, cat: 'employment', desc: 'Salary - May', date: '2026-05-01T08:00:00Z', recurring: true },
  { type: 'expense', amount: 2200, cat: 'bills', desc: 'Rent - May', date: '2026-05-01T09:00:00Z', recurring: true },
  { type: 'expense', amount: 15.99, cat: 'subscriptions', desc: 'Netflix', date: '2026-05-01T12:00:00Z', recurring: true },
  { type: 'expense', amount: 305.7, cat: 'food_groceries', desc: 'Groceries (month)', date: '2026-05-15T18:00:00Z' },
  { type: 'expense', amount: 210.4, cat: 'food_restaurants', desc: 'Restaurants (month)', date: '2026-05-20T20:00:00Z' },
  { type: 'expense', amount: 98.6, cat: 'transport', desc: 'Transit + fuel', date: '2026-05-18T17:00:00Z' },
  { type: 'expense', amount: 185, cat: 'entertainment', desc: 'Weekend in Napa', date: '2026-05-24T12:00:00Z' },
  { type: 'expense', amount: 132.9, cat: 'bills_electricity', desc: 'PG&E May bill', date: '2026-05-12T12:00:00Z' },
  { type: 'expense', amount: 240, cat: 'shopping', desc: 'IKEA shelving', date: '2026-05-10T14:00:00Z' },
  { type: 'expense', amount: 78.4, cat: 'health_pharmacyAndMedicine', desc: 'CVS pharmacy', date: '2026-05-06T10:00:00Z' },
];

const budgets = [
  { id: 'b-food', name: 'Food & Dining', cat: 'food', amount: 600, spent: 93.1, threshold: 80 },
  { id: 'b-transport', name: 'Transport', cat: 'transport', amount: 150, spent: 48, threshold: 80 },
  { id: 'b-shopping', name: 'Shopping', cat: 'shopping', amount: 300, spent: 350.49, threshold: 80 },
  { id: 'b-entertainment', name: 'Entertainment', cat: 'entertainment', amount: 200, spent: 170, threshold: 75 },
  { id: 'b-subscriptions', name: 'Subscriptions', cat: 'subscriptions', amount: 60, spent: 15.99, threshold: 90 },
];

const recurring = [
  { id: 'r-rent', name: 'Rent', type: 'expense', amount: 2200, cat: 'bills', desc: 'Monthly rent', day: 1 },
  { id: 'r-salary', name: 'Salary', type: 'income', amount: 6800, cat: 'employment', desc: 'Monthly salary', day: 1 },
  { id: 'r-netflix', name: 'Netflix', type: 'expense', amount: 15.99, cat: 'subscriptions', desc: 'Netflix subscription', day: 1 },
  { id: 'r-gym', name: 'Gym', type: 'expense', amount: 35, cat: 'health', desc: 'Gym membership', day: 2 },
];

// User profile doc (so the app's getOrCreateUser treats this as an existing user)
await put(`users/${uid}`, {
  email: str('alex.chen@example.com'),
  displayName: str('Alex Chen'),
  createdAt: ts('2026-01-15T08:00:00Z'),
  lastLoginAt: ts(now),
  preferences: { mapValue: { fields: {
    baseCurrency: str('USD'),
    language: str('en'),
    dateFormat: str('MM/DD/YYYY'),
    theme: str('light'),
    defaultCategories: { arrayValue: {} },
  } } },
});

let i = 0;
for (const t of txs) {
  await put(`users/${uid}/transactions/tx-${String(++i).padStart(3, '0')}`, txFields(t));
}
for (const b of budgets) {
  await put(`users/${uid}/budgets/${b.id}`, {
    userId: str(uid), categoryId: str(b.cat), name: str(b.name), amount: num(b.amount),
    currency: str('USD'), period: str('monthly'), startDate: ts('2026-07-01T00:00:00Z'),
    spent: num(b.spent), isActive: bool(true), alertThreshold: num(b.threshold),
    createdAt: ts(now), updatedAt: ts(now),
  });
}
for (const r of recurring) {
  await put(`users/${uid}/recurring/${r.id}`, {
    userId: str(uid), name: str(r.name), type: str(r.type), amount: num(r.amount),
    currency: str('USD'), categoryId: str(r.cat), description: str(r.desc),
    frequency: { mapValue: { fields: { type: str('monthly'), interval: num(1), dayOfMonth: num(r.day) } } },
    startDate: ts('2026-01-01T00:00:00Z'), nextOccurrence: ts('2026-08-01T00:00:00Z'),
    lastProcessed: ts('2026-07-01T00:00:00Z'), isActive: bool(true),
    createdAt: ts(now), updatedAt: ts(now),
  });
}
console.log(`Seeded ${txs.length} transactions, ${budgets.length} budgets, ${recurring.length} recurring for ${uid}`);
