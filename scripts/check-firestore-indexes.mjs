#!/usr/bin/env node
/**
 * Every filter combination the transaction query builder can emit has a
 * composite index in firestore.indexes.json.
 *
 * buildTransactionWhere() (src/app/core/utils/transaction-query.utils.ts)
 * turns the filter panel into equality conditions the user can combine
 * freely, and both consumers order by date in either direction — so Firestore
 * needs a composite index for every non-empty subset of the equality fields,
 * twice. The emulator does not enforce composite indexes, which means the
 * smoke suite passes with an incomplete index file and the deployed app
 * throws failed-precondition on the first two-field filter (#249). This
 * computes the required set from the source and refuses to let the file fall
 * short.
 *
 * Why a script rather than a spec: the emulator cannot represent the failure
 * at all, and a spec asserting against a copied field list would drift
 * exactly like the file it polices. ADR 0032: a sweep is only as wide as its
 * greps, so this one greps the query builder itself.
 *
 * What it deliberately cannot see:
 *   - Whether the entries are deployed. The file is the deploy input, not the
 *     deployment; `firebase deploy --only firestore:indexes` stays on the
 *     release checklist (docs/emulator-blind-spots.md).
 *   - A query built anywhere but buildTransactionWhere(). Other collections'
 *     one-off indexes (budgets) are listed by hand and pass through untouched.
 *   - A second range or orderBy field. The regex matches equality pushes
 *     only; the shape guard below catches the list shrinking, not a new
 *     inequality this whole contract would have to be rethought for.
 */

import { readFileSync } from 'node:fs';

const SOURCE = 'src/app/core/utils/transaction-query.utils.ts';
const INDEXES = 'firestore.indexes.json';
const DOC = 'docs/emulator-blind-spots.md';

const source = readFileSync(SOURCE, 'utf8');
const fields = [...source.matchAll(/\{\s*field:\s*'([^']+)',\s*op:\s*'=='/g)].map(m => m[1]);

// Shape guard: the day buildTransactionWhere is refactored past this regex,
// the checker must fail loudly rather than verify an empty contract.
if (fields.length < 2) {
  console.error(
    `${SOURCE}: expected at least two equality fields in buildTransactionWhere, ` +
      `found ${fields.length} (${fields.join(', ') || 'none'}).\n` +
      `The extraction regex in scripts/check-firestore-indexes.mjs no longer\n` +
      `matches the source. Fix the regex before trusting this check (${DOC}).`
  );
  process.exit(1);
}

const subsets = [];
for (let mask = 1; mask < 1 << fields.length; mask++) {
  subsets.push(fields.filter((_, i) => mask & (1 << i)));
}

const declared = JSON.parse(readFileSync(INDEXES, 'utf8')).indexes ?? [];

// Firestore accepts any order among an index's equality fields; only date
// must come last with the right direction. Set-wise match, so a valid
// permutation someone wrote by hand is not reported as missing.
function covers(entry, subset, direction) {
  if (entry.collectionGroup !== 'transactions') return false;
  const entryFields = entry.fields ?? [];
  const last = entryFields[entryFields.length - 1];
  if (!last || last.fieldPath !== 'date' || last.order !== direction) return false;
  const equalities = entryFields.slice(0, -1).map(f => f.fieldPath);
  return equalities.length === subset.length && subset.every(f => equalities.includes(f));
}

const missing = [];
for (const subset of subsets) {
  for (const direction of ['ASCENDING', 'DESCENDING']) {
    if (!declared.some(entry => covers(entry, subset, direction))) {
      missing.push({
        collectionGroup: 'transactions',
        queryScope: 'COLLECTION',
        fields: [
          ...subset.map(fieldPath => ({ fieldPath, order: 'ASCENDING' })),
          { fieldPath: 'date', order: direction },
        ],
      });
    }
  }
}

console.log(
  `Checked ${subsets.length * 2} required transaction indexes ` +
    `(${fields.length} equality fields: ${fields.join(', ')}).`
);

if (missing.length > 0) {
  console.error(`\n${INDEXES}: ${missing.length} required composite index(es) missing:\n`);
  for (const entry of missing) {
    console.error(`  ${JSON.stringify(entry)}`);
  }
  console.error(
    `\nEvery non-empty combination of buildTransactionWhere's equality fields needs an\n` +
      `index for both date directions, and the emulator will not tell you (${DOC}).\n` +
      `Add the entries above, then deploy with \`firebase deploy --only firestore:indexes\`.\n`
  );
  process.exit(1);
}

console.log('Every filter combination has its composite index, in both directions.');
