#!/usr/bin/env node
/**
 * Enforces G3 in docs/ui-overflow.md: nothing in the app truncates.
 *
 * ADR 0010 decided this and swept the transaction row. The rule was written
 * down and the check was written down with it — as a grep, in the doc, that
 * the reader was invited to run. Thirteen `text-overflow: ellipsis`
 * declarations went on living through two releases anyway, because a check
 * nobody runs is a check that quietly stops being one. This is that grep,
 * wired into CI so it runs whether or not anybody remembers it.
 *
 * Why a script rather than a spec: these are component-scoped styles, so a
 * Karma assertion has to instantiate the component to see them, and thirteen
 * TestBed configurations would test the thirteen sites we already know about
 * and nothing about the fourteenth. Reading the source catches every site,
 * including ones added tomorrow.
 *
 * What it deliberately cannot see:
 *   - A truncation built some other way: `-webkit-line-clamp`, a fixed height
 *     over `overflow: hidden`, a slice() in a template. Geometry is what
 *     catches those, and shared/overflow-guard.spec.ts is where that lives.
 *   - `text-overflow` arriving through a third-party stylesheet. Material sets
 *     it on its own internals, which is not ours to police here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIR = 'src';
const EXTENSIONS = ['.scss', '.css', '.ts', '.html'];
const DOC = 'docs/ui-overflow.md';

/**
 * Blanks comments while preserving every byte offset, so a line number taken
 * from the masked text still points at the real line. Prose *about*
 * truncation is not a truncation: several stylesheets explain at length why
 * their `text-overflow` was deleted, and those notes are the reason the next
 * person does not put it back.
 */
function maskComments(source) {
  const out = source.split('');
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '*') { state = 'block'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === '/' && next === '/') { state = 'line'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out[i] = out[i + 1] = ' '; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
    } else if (state === 'line') {
      if (c === '\n') state = 'code';
      else out[i] = ' ';
    } else if (state === 'single' && c === "'" && source[i - 1] !== '\\') state = 'code';
    else if (state === 'double' && c === '"' && source[i - 1] !== '\\') state = 'code';
    else if (state === 'template' && c === '`' && source[i - 1] !== '\\') state = 'code';
    i += 1;
  }
  return out.join('');
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(path);
  }
  return found;
}

const files = walk(SOURCE_DIR);
const offences = [];

for (const file of files) {
  const masked = maskComments(readFileSync(file, 'utf8'));
  const lines = masked.split('\n');
  lines.forEach((line, index) => {
    // The declaration, not the word. `text-overflow` appears in prose in half
    // a dozen comments explaining why it is gone, and those are masked above,
    // but requiring the colon costs nothing and makes the intent obvious.
    if (/text-overflow\s*:/.test(line)) {
      offences.push({ file, line: index + 1, text: line.trim() });
    }
  });
}

console.log(`Checked ${files.length} source files for truncation.`);

if (offences.length > 0) {
  console.error(`\n${offences.length} truncation(s) found:\n`);
  for (const { file, line, text } of offences) {
    console.error(`  ${file}:${line}  ${text}`);
  }
  console.error(
    `\nG3 in ${DOC}: nothing truncates. Text wraps — with \`overflow-wrap: anywhere\`\n` +
      `where the content may contain an unbreakable run — and a value that must stay on\n` +
      `one line carries appFitText and scales to the 12px floor instead.\n`
  );
  process.exit(1);
}

console.log('Nothing truncates.');
