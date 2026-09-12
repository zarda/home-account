#!/usr/bin/env node
/**
 * Fails when a component's `imports: [...]` names a Material NgModule whose
 * template uses none of that module's selectors.
 *
 * Nothing else in the repo can see this. ESLint's no-unused-vars counts the
 * symbol as used the moment it appears inside `imports: [...]`; the other
 * guards under scripts/ read stylesheets, catalogs and prompt call sites, not
 * component metadata; and Angular's own `unusedStandaloneImports` diagnostic
 * is blind to NgModules by construction — getUnusedSymbols pushes a symbol
 * only when it is a standalone directive, component or pipe, so no NG8113 is
 * ever raised for a `Mat*Module` whatever level the check is set to. Dead
 * entries had lived through every gate before this script existed, and the
 * last of them was invisible to a grep too: `mat-button-toggle` contains
 * the string `mat-button`, so looking for a dead MatButtonModule by hand
 * turns up a live MatButtonToggleModule and stops there.
 *
 * Dead entries are not free: each one puts its module's directives in the
 * component's template scope and its providers in the component's injector,
 * and each one is a claim about the template that the next edit can falsify
 * without anything saying so.
 *
 * The table is the risk, not the parser. A selector the table misspells or
 * omits fails a component that is genuinely using the module — a false
 * failure on live code, which is worse than the dead entry the check was
 * written to catch. So the table carries each module's full exported selector
 * set verbatim from the package, and --self-test asserts every string in it
 * against the selectors the installed @angular/material actually declares: a
 * rename in a Material upgrade breaks the self-test, not the app. The traps
 * the table exists for, all of them live in 22.1.4:
 *   - MatButtonModule's selectors are `mat-button`, `mat-flat-button`,
 *     `mat-stroked-button`, `mat-icon-button`, `mat-raised-button`,
 *     `mat-fab`, `mat-mini-fab` and their camelCase forms — `mat-button`
 *     is one of them. What keeps `mat-button-toggle-group` from counting
 *     as a MatButtonModule use is the `(?![\w-])` boundary in
 *     selectorUsed, not the table's contents; the icon button is
 *     declared in _icon-button-chunk.mjs, not button.mjs.
 *   - MatTooltipModule and MatFormFieldModule declare their selectors in
 *     _tooltip-chunk.mjs / _form-field-chunk.mjs, not in their entry points,
 *     which read as selector-free files.
 *   - Three modules re-export another module's selectors: MatListModule
 *     exports MatDividerModule, MatInputModule exports MatFormFieldModule,
 *     MatSelectModule exports MatOptionModule. A template holding only
 *     `mat-divider`, `mat-form-field` or `mat-option` is using the outer
 *     module, and the edges are asserted in --self-test.
 *
 * Matching is deliberately lenient, because every direction of error but one
 * is recoverable. A selector with an attribute part is matched on the
 * attribute alone and never on the element it is declared against, so a
 * `mat-stroked-button` wrapped onto its own line, well away from its
 * `<button`, still reads as a use; both the bare and the bound spellings
 * count (`matTooltip`, `[matTooltip]="…"`); and markup inside an HTML comment
 * counts as a use. Each of those can only make the check miss a dead entry,
 * never invent one.
 *
 * What it deliberately cannot see:
 *   - A module outside the table. Skipped, counted and named in the output,
 *     so the table's coverage is a fact on screen rather than an assumption.
 *   - A provider-only module. MatNativeDateModule contributes no selector at
 *     all, so "unused in the template" says nothing about whether the
 *     component needs it; it is listed below and skipped by name.
 *   - Spec files. A test host's imports belong to the spec that declares it,
 *     and its template is usually a stub that proves nothing either way.
 *   - The standalone half of the same defect — a directive, component or pipe
 *     listed in `imports` and unused in the template. That one Angular does
 *     see: it is NG8113, raised as an error by the extendedDiagnostics block
 *     in tsconfig.json.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SOURCE_DIR = 'src/app';
const MATERIAL_DIR = 'node_modules/@angular/material/fesm2022';

/**
 * Module -> the selectors it exports, transitively, as the installed package
 * spells them. Internal host components (`mat-tooltip-component`,
 * `mat-dialog-container`) are part of the export set and are kept: nobody
 * writes them in a template, so they cost nothing, and dropping entries by
 * judgement is how a table starts drifting from the package.
 */
const MODULE_SELECTORS = {
  MatBadgeModule: ['[matBadge]'],
  MatButtonModule: [
    'button[matButton]', 'a[matButton]', 'button[mat-button]', 'a[mat-button]',
    'button[mat-raised-button]', 'a[mat-raised-button]', 'button[mat-flat-button]',
    'a[mat-flat-button]', 'button[mat-stroked-button]', 'a[mat-stroked-button]',
    'button[mat-fab]', 'a[mat-fab]', 'button[matFab]', 'a[matFab]',
    'button[mat-mini-fab]', 'a[mat-mini-fab]', 'button[matMiniFab]', 'a[matMiniFab]',
    'button[mat-icon-button]', 'a[mat-icon-button]', 'button[matIconButton]', 'a[matIconButton]'
  ],
  MatButtonToggleModule: ['mat-button-toggle', 'mat-button-toggle-group'],
  MatCardModule: [
    'mat-card', 'mat-card-actions', 'mat-card-content', 'mat-card-footer', 'mat-card-header',
    'mat-card-title-group', 'mat-card-subtitle', '[mat-card-subtitle]', '[matCardSubtitle]',
    'mat-card-title', '[mat-card-title]', '[matCardTitle]', '[mat-card-avatar]', '[matCardAvatar]',
    '[mat-card-image]', '[matCardImage]', '[mat-card-sm-image]', '[matCardImageSmall]',
    '[mat-card-md-image]', '[matCardImageMedium]', '[mat-card-lg-image]', '[matCardImageLarge]',
    '[mat-card-xl-image]', '[matCardImageXLarge]'
  ],
  MatCheckboxModule: ['mat-checkbox'],
  MatChipsModule: [
    'mat-chip', '[mat-chip]', 'mat-basic-chip', '[mat-basic-chip]',
    'mat-chip-option', '[mat-chip-option]', 'mat-basic-chip-option', '[mat-basic-chip-option]',
    'mat-chip-row', '[mat-chip-row]', 'mat-basic-chip-row', '[mat-basic-chip-row]',
    'mat-chip-set', 'mat-chip-grid', 'mat-chip-listbox',
    'mat-chip-avatar', '[matChipAvatar]', 'mat-chip-trailing-icon', '[matChipTrailingIcon]',
    '[matChipRemove]', '[matChipEdit]', 'span[matChipEditInput]', 'input[matChipInputFor]'
  ],
  MatDatepickerModule: [
    'mat-datepicker', 'mat-datepicker-content', 'mat-datepicker-toggle', 'mat-datepicker-actions',
    'mat-date-range-picker', 'mat-date-range-picker-actions', 'mat-date-range-input',
    'mat-calendar', 'mat-calendar-header', '[mat-calendar-body]',
    'mat-month-view', 'mat-year-view', 'mat-multi-year-view',
    'input[matDatepicker]', 'input[matStartDate]', 'input[matEndDate]',
    '[matDatepickerToggleIcon]', '[matDatepickerApply]', '[matDateRangePickerApply]',
    '[matDatepickerCancel]', '[matDateRangePickerCancel]'
  ],
  MatDialogModule: [
    'mat-dialog-container', 'mat-dialog-content', '[mat-dialog-content]', '[matDialogContent]',
    'mat-dialog-actions', '[mat-dialog-actions]', '[matDialogActions]',
    '[mat-dialog-title]', '[matDialogTitle]', '[mat-dialog-close]', '[matDialogClose]'
  ],
  MatDividerModule: ['mat-divider'],
  MatExpansionModule: [
    'mat-accordion', 'mat-expansion-panel', 'mat-expansion-panel-header', 'mat-action-row',
    'mat-panel-title', 'mat-panel-description', 'ng-template[matExpansionPanelContent]'
  ],
  MatFormFieldModule: [
    'mat-form-field', 'mat-label', 'mat-hint', 'mat-error', '[matError]',
    '[matPrefix]', '[matIconPrefix]', '[matTextPrefix]',
    '[matSuffix]', '[matIconSuffix]', '[matTextSuffix]'
  ],
  MatIconModule: ['mat-icon'],
  // Re-exports MatFormFieldModule, so every form-field selector counts.
  MatInputModule: [
    'input[matInput]', 'textarea[matInput]',
    'input[matNativeControl]', 'textarea[matNativeControl]', 'select[matNativeControl]',
    'mat-form-field', 'mat-label', 'mat-hint', 'mat-error', '[matError]',
    '[matPrefix]', '[matIconPrefix]', '[matTextPrefix]',
    '[matSuffix]', '[matIconSuffix]', '[matTextSuffix]'
  ],
  // Re-exports MatDividerModule, so `mat-divider` counts.
  MatListModule: [
    'mat-list', 'mat-action-list', 'mat-nav-list', 'mat-selection-list', 'mat-list-option',
    'mat-list-item', 'a[mat-list-item]', 'button[mat-list-item]',
    '[mat-subheader]', '[matSubheader]', '[matListItemAvatar]', '[matListItemIcon]',
    '[matListItemLine]', '[matListItemTitle]', '[matListItemMeta]', 'mat-divider'
  ],
  MatMenuModule: [
    'mat-menu', '[mat-menu-item]', '[mat-menu-trigger-for]', '[matMenuTriggerFor]',
    '[matContextMenuTriggerFor]', 'ng-template[matMenuContent]'
  ],
  MatOptionModule: ['mat-option', 'mat-optgroup'],
  MatProgressBarModule: ['mat-progress-bar'],
  MatProgressSpinnerModule: ['mat-progress-spinner', 'mat-spinner'],
  MatRadioModule: ['mat-radio-group', 'mat-radio-button'],
  // Re-exports MatOptionModule and MatFormFieldModule.
  MatSelectModule: [
    'mat-select', 'mat-select-trigger', 'mat-option', 'mat-optgroup',
    'mat-form-field', 'mat-label', 'mat-hint', 'mat-error', '[matError]',
    '[matPrefix]', '[matIconPrefix]', '[matTextPrefix]',
    '[matSuffix]', '[matIconSuffix]', '[matTextSuffix]'
  ],
  MatSliderModule: [
    'mat-slider', 'input[matSliderThumb]', 'input[matSliderStartThumb]', 'input[matSliderEndThumb]'
  ],
  MatSlideToggleModule: ['mat-slide-toggle'],
  MatSnackBarModule: [
    'mat-snack-bar-container', '[matSnackBarLabel]', '[matSnackBarActions]', '[matSnackBarAction]'
  ],
  MatSortModule: ['[matSort]', '[mat-sort-header]'],
  MatStepperModule: [
    'mat-stepper', 'mat-vertical-stepper', 'mat-horizontal-stepper', '[matStepper]',
    'mat-step', 'mat-step-header', '[matStepLabel]',
    'button[matStepperNext]', 'button[matStepperPrevious]',
    'ng-template[matStepContent]', 'ng-template[matStepperIcon]'
  ],
  MatTableModule: [
    'mat-table', 'table[mat-table]', 'mat-table[recycleRows]', 'table[mat-table][recycleRows]',
    'mat-row', 'tr[mat-row]', 'mat-header-row', 'tr[mat-header-row]',
    'mat-footer-row', 'tr[mat-footer-row]', 'mat-cell', 'td[mat-cell]',
    'mat-header-cell', 'th[mat-header-cell]', 'mat-footer-cell', 'td[mat-footer-cell]',
    'mat-text-column', '[matColumnDef]', '[matCellDef]', '[matHeaderCellDef]',
    '[matFooterCellDef]', '[matRowDef]', '[matHeaderRowDef]', '[matFooterRowDef]',
    'ng-template[matNoDataRow]'
  ],
  MatTabsModule: [
    'mat-tab-group', 'mat-tab', 'mat-tab-nav-panel', '[mat-tab-nav-bar]',
    '[mat-tab-label]', '[matTabLabel]', '[mat-tab-link]', '[matTabLink]', '[matTabContent]'
  ],
  MatToolbarModule: ['mat-toolbar', 'mat-toolbar-row'],
  MatTooltipModule: ['[matTooltip]', 'mat-tooltip-component']
};

/**
 * Modules that contribute providers and no selector. Absence from the
 * template is not evidence about them either way, so they are skipped by
 * name rather than left to the "outside the table" bucket, where a reader
 * would take them for a coverage gap.
 */
const PROVIDER_ONLY = new Set(['MatNativeDateModule']);

/**
 * `text` with every `//` and `/* *\/` comment blanked to spaces, newlines
 * kept, so an offset into the result still lands on the same line of `text`.
 * Quotes are tracked the same way `balanced` and `topLevelKey` track them, so
 * a `//` or `/*` inside a string or template literal — `'<a href="http://x">'`,
 * say — is copied through untouched rather than mistaken for a comment start.
 * Without this pass, an apostrophe inside a `//` comment reads as a quote
 * opener, `balanced` never finds its close, and the component it belongs to
 * silently drops out of the gate with no finding and no count; a module named
 * only inside a comment would likewise be read as a real `imports` entry.
 */
function maskComments(text) {
  const out = [];
  let quote = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\' && i + 1 < text.length) {
        out.push(ch, text[i + 1]);
        i += 2;
        continue;
      }
      out.push(ch);
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out.push(text[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < text.length) { out.push(' ', ' '); i += 2; }
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join('');
}

/** The balanced `{...}` or `[...]` starting at `open`, quotes respected, or null. */
function balanced(source, open) {
  const OPENERS = '{[(';
  const CLOSERS = '}])';
  if (!OPENERS.includes(source[open])) return null;
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** Offset of `name:` written at the top level of an object literal, or -1. */
function topLevelKey(object, name) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < object.length; i++) {
    const ch = object[i];
    if (quote !== null) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue; }
    if (depth === 1 && object.startsWith(`${name}:`, i) && !/[\w$.]/.test(object[i - 1] ?? ' ')) {
      let j = i + name.length + 1;
      while (/\s/.test(object[j])) j++;
      return j;
    }
  }
  return -1;
}

/** The contents of the string literal starting at `at`, or null. */
function stringAt(object, at) {
  const quote = object[at];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  for (let i = at + 1; i < object.length; i++) {
    if (object[i] === '\\') { i++; continue; }
    if (object[i] === quote) return object.slice(at + 1, i);
  }
  return null;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Every `@Component({...})` in a source file, with the Mat*Module entries of
 * its `imports` array (absolute offsets into `source`) and whichever of
 * `templateUrl` / `template` it declares.
 */
function readComponents(source) {
  const masked = maskComments(source);
  const blocks = [];
  const decorator = /@Component\s*\(\s*\{/g;
  let match;
  while ((match = decorator.exec(masked)) !== null) {
    const open = masked.indexOf('{', match.index);
    const object = balanced(masked, open);
    if (object === null) continue;
    decorator.lastIndex = open + 1;

    const modules = [];
    const importsAt = topLevelKey(object, 'imports');
    if (importsAt !== -1) {
      const array = balanced(object, importsAt);
      if (array !== null) {
        const name = /\bMat[A-Za-z0-9]*Module\b/g;
        let entry;
        while ((entry = name.exec(array)) !== null) {
          modules.push({ name: entry[0], index: open + importsAt + entry.index });
        }
      }
    }

    const urlAt = topLevelKey(object, 'templateUrl');
    const inlineAt = topLevelKey(object, 'template');
    blocks.push({
      modules,
      templateUrl: urlAt === -1 ? null : stringAt(object, urlAt),
      template: inlineAt === -1 ? null : stringAt(object, inlineAt)
    });
  }
  return blocks;
}

/**
 * `@Component(` occurrences in `source`, comments masked out first so a
 * decorator named only inside a comment does not count. `run()` compares
 * this against the blocks `readComponents` actually returns for the same
 * file: a higher count means some component's object literal desynced
 * `balanced`'s or `topLevelKey`'s quote tracker — an unescaped quote outside
 * a real string, a regex literal such as `/'/` being the usual source — and
 * the component dropped out of `readComponents` with nothing said about it.
 */
function componentDecoratorCount(source) {
  return [...maskComments(source).matchAll(/@Component\s*\(/g)].length;
}

/**
 * Whether a template uses a selector. A selector carrying attributes matches
 * on any one of them, ignoring the element part; an element selector matches
 * its opening tag.
 */
function selectorUsed(selector, template) {
  const attributes = [...selector.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
  if (attributes.length > 0) {
    return attributes.some(attribute => {
      const name = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\w.$-])\\[?${name}\\]?(?![\\w-])`).test(template);
    });
  }
  const tag = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<\\s*${tag}(?![\\w-])`).test(template);
}

function moduleUsed(module, template) {
  return (MODULE_SELECTORS[module] ?? []).some(selector => selectorUsed(selector, template));
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

function run() {
  const findings = [];
  const untabled = new Map();
  const providerOnly = new Map();
  const unparsed = [];
  let components = 0;
  let entries = 0;
  let templateless = 0;

  for (const file of walk(SOURCE_DIR)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('@Component')) continue;
    const blocks = readComponents(source);
    if (componentDecoratorCount(source) > blocks.length) unparsed.push(relative('.', file));
    for (const block of blocks) {
      components++;
      let template = block.template;
      if (template === null && block.templateUrl !== null) {
        const path = resolve(dirname(file), block.templateUrl);
        template = readFileSync(path, 'utf8');
      }
      if (template === null) {
        templateless++;
        continue;
      }
      for (const { name, index } of block.modules) {
        entries++;
        if (PROVIDER_ONLY.has(name)) {
          providerOnly.set(name, (providerOnly.get(name) ?? 0) + 1);
          continue;
        }
        if (!(name in MODULE_SELECTORS)) {
          untabled.set(name, (untabled.get(name) ?? 0) + 1);
          continue;
        }
        if (!moduleUsed(name, template)) {
          findings.push({
            site: `${relative('.', file)}:${lineOf(source, index)}`,
            module: name,
            selectors: MODULE_SELECTORS[name]
          });
        }
      }
    }
  }

  const named = counts =>
    [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => `${name} (${n})`).join(', ');
  const total = counts => [...counts.values()].reduce((sum, n) => sum + n, 0);

  console.log(
    `Checked ${entries} Mat*Module entries across ${components} components ` +
      `(${templateless} with no template).`
  );
  console.log(
    providerOnly.size === 0
      ? 'Skipped 0 provider-only entries.'
      : `Skipped ${total(providerOnly)} provider-only entries: ${named(providerOnly)}`
  );
  console.log(
    untabled.size === 0
      ? 'Skipped 0 entries outside the table.'
      : `Skipped ${total(untabled)} entries outside the table: ${named(untabled)}`
  );
  console.log(
    unparsed.length === 0
      ? 'No unparsed files.'
      : `${unparsed.length} file(s) unparsed: ${unparsed.join(', ')}`
  );

  if (unparsed.length > 0) {
    console.error(`\n${unparsed.length} file(s) have more @Component( decorators than readComponents resolved into blocks:\n`);
    for (const file of unparsed) console.error(`  ${file}`);
    console.error(
      '\nA component silently dropped out of every count above. The usual cause is an unescaped\n' +
        "quote outside a real string (a regex literal such as /'/) desyncing maskComments' or\n" +
        "balanced's quote tracker so the decorator's object never resolves. Fix the file so it\n" +
        'round-trips; a gate that skips a component without saying so is worse than no gate.\n'
    );
  }

  if (findings.length > 0) {
    console.error(`\n${findings.length} module(s) imported by a component whose template does not use them:\n`);
    for (const { site, module, selectors } of findings.sort((a, b) => a.site.localeCompare(b.site))) {
      const shown = selectors.slice(0, 8).join(', ');
      const rest = selectors.length > 8 ? `, +${selectors.length - 8} more` : '';
      console.error(`  ${site}  ${module}`);
      console.error(`      no ${shown}${rest}`);
    }
    console.error(
      '\nDelete the entry and its ES import. A module is declared because the template uses\n' +
        'one of its selectors; a service it also ships (MatDialog, MatSnackBar) is providedIn\n' +
        "'root' and needs no declaration.\n"
    );
  }

  if (unparsed.length > 0 || findings.length > 0) {
    process.exit(1);
  }

  console.log('Every Material module a component declares is used by its template.');
}

/** Every selector string the installed package declares, commas split out. */
function packageSelectors() {
  const found = new Set();
  const literal = /selector:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;
  for (const entry of readdirSync(MATERIAL_DIR)) {
    if (!entry.endsWith('.mjs')) continue;
    const source = readFileSync(join(MATERIAL_DIR, entry), 'utf8');
    let match;
    while ((match = literal.exec(source)) !== null) {
      for (const part of match[1].slice(1, -1).replace(/\\n/g, '\n').split(',')) {
        const selector = part.trim();
        if (selector !== '') found.add(selector);
      }
    }
  }
  return found;
}

/** Whether `entry.mjs` names `module` inside an `exports: [...]` of its own. */
function reExports(entry, module) {
  const source = readFileSync(join(MATERIAL_DIR, entry), 'utf8');
  return [...source.matchAll(/exports:\s*\[([^\]]*)\]/g)].some(match =>
    match[1].split(',').map(name => name.trim()).includes(module)
  );
}

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  // The table against the package. A Material upgrade that renames or drops a
  // selector fails here, where the fix is the table, rather than on the app,
  // where the fix would look like deleting a live import.
  const declared = packageSelectors();
  const unknown = [];
  for (const [module, selectors] of Object.entries(MODULE_SELECTORS)) {
    for (const selector of selectors) {
      if (!declared.has(selector)) unknown.push(`${module}: ${selector}`);
    }
  }
  check('every table selector is declared by the installed @angular/material', unknown, []);
  check('the package was read at all', declared.size > 100, true);

  // The re-export edges three table entries lean on.
  check('MatListModule exports MatDividerModule', reExports('list.mjs', 'MatDividerModule'), true);
  check('MatInputModule exports MatFormFieldModule', reExports('input.mjs', 'MatFormFieldModule'), true);
  check('MatSelectModule exports MatOptionModule', reExports('select.mjs', 'MatOptionModule'), true);
  check('mat-divider counts for MatListModule', moduleUsed('MatListModule', '<mat-divider></mat-divider>'), true);
  check('mat-form-field counts for MatInputModule', moduleUsed('MatInputModule', '<mat-form-field><mat-label>x</mat-label></mat-form-field>'), true);
  check('mat-option counts for MatSelectModule', moduleUsed('MatSelectModule', '<mat-option [value]="x">y</mat-option>'), true);

  // The button spellings, none of which contains `mat-button`.
  check('mat-stroked-button counts for MatButtonModule', moduleUsed('MatButtonModule', '<button mat-stroked-button>Go</button>'), true);
  check('mat-icon-button counts for MatButtonModule', moduleUsed('MatButtonModule', '<button mat-icon-button><mat-icon>x</mat-icon></button>'), true);
  check('matIconButton counts for MatButtonModule', moduleUsed('MatButtonModule', '<a matIconButton href="#">x</a>'), true);
  check('mat-fab counts for MatButtonModule', moduleUsed('MatButtonModule', '<button mat-fab>+</button>'), true);
  check('a template with no button does not count for MatButtonModule', moduleUsed('MatButtonModule', '<div class="mat-buttonish"></div>'), false);
  check('mat-icon-button does not count for MatIconModule', moduleUsed('MatIconModule', '<button mat-icon-button></button>'), false);

  // Attribute selectors, bare and bound.
  check('a bare matTooltip counts', moduleUsed('MatTooltipModule', '<span matTooltip="hi">x</span>'), true);
  check('a bound [matTooltip] counts', moduleUsed('MatTooltipModule', '<span [matTooltip]="label()">x</span>'), true);
  check('matTooltipPosition alone does not count', moduleUsed('MatTooltipModule', '<span [matTooltipPosition]="p">x</span>'), false);
  check('matMenuTriggerFor counts for MatMenuModule', moduleUsed('MatMenuModule', '<button [matMenuTriggerFor]="menu"></button>'), true);
  check('mat-menu-item counts for MatMenuModule', moduleUsed('MatMenuModule', '<button mat-menu-item>x</button>'), true);
  check('matBadge counts for MatBadgeModule', moduleUsed('MatBadgeModule', '<span [matBadge]="n()">x</span>'), true);

  // Element selectors, and the prefix traps between them.
  check('mat-card-content counts for MatCardModule', moduleUsed('MatCardModule', '<mat-card-content>x</mat-card-content>'), true);
  check('app-category-chip does not count for MatChipsModule', moduleUsed('MatChipsModule', '<app-category-chip [category]="c" />'), false);
  check('mat-chip-set counts for MatChipsModule', moduleUsed('MatChipsModule', '<mat-chip-set><mat-chip>x</mat-chip></mat-chip-set>'), true);
  check('a class name that starts with a selector does not count', moduleUsed('MatProgressBarModule', '<div class="mat-progress-barish"></div>'), false);
  check('mat-progress-bar counts for MatProgressBarModule', moduleUsed('MatProgressBarModule', '<mat-progress-bar mode="determinate" />'), true);
  check('a whitespace-separated tag counts', moduleUsed('MatIconModule', '< mat-icon>x</mat-icon>'), true);

  // The decorator parser.
  const multiline = `@Component({
  selector: 'app-x',
  imports: [
    CommonModule,
    MatChipsModule,
    MatIconModule
  ],
  templateUrl: './x.component.html'
})`;
  check('reads a multi-line imports array', readComponents(multiline)[0].modules.map(m => m.name), ['MatChipsModule', 'MatIconModule']);
  check('reads templateUrl', readComponents(multiline)[0].templateUrl, './x.component.html');
  check(
    'reads a single-line imports array and an inline template',
    (() => {
      const [block] = readComponents("@Component({ imports: [MatIconModule, MatChipsModule], template: `<mat-icon>x</mat-icon>` })");
      return { modules: block.modules.map(m => m.name), templateUrl: block.templateUrl, template: block.template };
    })(),
    { modules: ['MatIconModule', 'MatChipsModule'], templateUrl: null, template: '<mat-icon>x</mat-icon>' }
  );
  check(
    'takes the line of the array entry, not the ES import',
    (() => {
      const source = `import { MatChipsModule } from '@angular/material/chips';\n\n@Component({\n  imports: [MatChipsModule],\n  template: ''\n})`;
      return lineOf(source, readComponents(source)[0].modules[0].index);
    })(),
    4
  );
  check('does not mistake templateUrl for template', readComponents("@Component({ templateUrl: './a.html' })")[0].template, null);
  check('ignores a Mat*Module named outside the imports array', readComponents("@Component({ providers: [MatDialogModule], imports: [MatIconModule], template: '' })")[0].modules.map(m => m.name), ['MatIconModule']);
  check('finds both components in one file', readComponents("@Component({ imports: [MatIconModule], template: '' })\nclass A {}\n@Component({ imports: [MatCardModule], template: '' })").length, 2);

  // Comments inside the decorator. An apostrophe inside one must not be read
  // as a quote opener (which would desync `balanced` and drop the whole
  // component), and a Mat*Module spelled only inside a comment must not be
  // read as a real `imports` entry.
  const parseOne = source => {
    const blocks = readComponents(source);
    return blocks.length === 1
      ? { modules: blocks[0].modules.map(m => m.name), template: blocks[0].template }
      : { blockCount: blocks.length };
  };
  check(
    "an apostrophe inside a // comment does not swallow the component",
    parseOne("@Component({\n  // it's fine to keep this\n  imports: [MatIconModule],\n  template: '<mat-icon>x</mat-icon>'\n})"),
    { modules: ['MatIconModule'], template: '<mat-icon>x</mat-icon>' }
  );
  check(
    "MatIconModule still reads as used once the // comment no longer swallows the component",
    moduleUsed('MatIconModule', parseOne("@Component({\n  // it's fine to keep this\n  imports: [MatIconModule],\n  template: '<mat-icon>x</mat-icon>'\n})").template ?? ''),
    true
  );
  check(
    "an apostrophe inside a /* */ comment does not swallow the component",
    parseOne('@Component({\n  /* it\'s fine to keep this */\n  imports: [MatIconModule],\n  template: \'<mat-icon>x</mat-icon>\'\n})'),
    { modules: ['MatIconModule'], template: '<mat-icon>x</mat-icon>' }
  );
  check(
    'a // inside a string literal in the decorator is not treated as a comment',
    parseOne('@Component({ imports: [MatIconModule], template: \'<a href="http://x"><mat-icon>x</mat-icon></a>\' })'),
    { modules: ['MatIconModule'], template: '<a href="http://x"><mat-icon>x</mat-icon></a>' }
  );
  check(
    'a /* */-commented-out entry in imports is not counted',
    readComponents('@Component({ imports: [MatIconModule, /* MatCardModule, */ MatChipsModule], template: \'\' })')[0].modules.map(m => m.name),
    ['MatIconModule', 'MatChipsModule']
  );
  check(
    'a //-commented-out entry in imports is not counted',
    readComponents('@Component({\n  imports: [\n    MatIconModule,\n    // MatCardModule,\n    MatChipsModule\n  ],\n  template: \'\'\n})')[0].modules.map(m => m.name),
    ['MatIconModule', 'MatChipsModule']
  );

  // The parser-desync backstop. readComponents dropping a component and
  // saying nothing about it is worse than no gate at all: a decorator count
  // higher than the block count must be loud, not silent.
  const quoteBearingRegexFixture = `@Component({
  selector: 'app-x',
  providers: [{ provide: TOKEN, useFactory: () => { const re = /'/; return re.test('x'); } }],
  imports: [MatIconModule],
  template: '<mat-icon>x</mat-icon>'
})
class A {}
`;
  check(
    'a quote-bearing regex literal that desyncs the parser is reported as unparsed, not dropped',
    componentDecoratorCount(quoteBearingRegexFixture) > readComponents(quoteBearingRegexFixture).length,
    true
  );
  check(
    'a normal file reports no unparsed decorators',
    componentDecoratorCount(multiline) > readComponents(multiline).length,
    false
  );

  // The two skip buckets, which are what makes the table's coverage legible.
  check('a provider-only module is named, not checked', PROVIDER_ONLY.has('MatNativeDateModule') && !('MatNativeDateModule' in MODULE_SELECTORS), true);
  check('a module outside the table has no selectors to match', moduleUsed('MatSidenavModule', '<mat-sidenav></mat-sidenav>'), false);

  const failed = cases.filter(c => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    if (!c.ok) {
      console.error(`       expected ${JSON.stringify(c.expected)}`);
      console.error(`       actual   ${JSON.stringify(c.actual)}`);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} self-test failure(s) — the checker itself is broken.`);
    process.exit(1);
  }
  console.log(`check-material-imports self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
