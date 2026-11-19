#!/usr/bin/env node
/**
 * Fails when src/test-main.ts parts from the Karma builder's own test-bed init.
 *
 * angular.json names src/test-main.ts as the test target's `main`, and a named main replaces the
 * `angular:test-bed-init` module the builder otherwise generates, in
 * node_modules/@angular/build/src/builders/karma/application_builder.js. The copy exists for one
 * statement of its own, jasmine's failSpecWithNoExpectations (ADR 0187), and is otherwise meant to be
 * the builder's init: an upgrade that adds an option, a provider or a statement there would leave the
 * copy without it, and no spec would turn red (#545).
 *
 * The builder writes its init as an array of source lines, some chosen by two arms it works out for
 * the project: `usesZoneJS`, whether the test polyfills (less `zone.js/testing`, which it moves to a
 * cleanup entry) hold exactly `zone.js`, and `hasLocalize`, whether `@angular/localize` resolves from
 * the project's source root. This reads that array out of the builder's source with TypeScript's
 * parser, evaluates it for this project's arms, and compares every top-level statement of the result
 * with the copy's, in order. Each statement is printed by TypeScript's printer with its comments
 * removed, its trailing commas dropped and the named imports of an import read as a set, then compared
 * token by token, so line breaks and quote style do not count either.
 *
 * Two differences are allowed, each for a stated reason:
 *   - one `jasmine.getEnv().configure(...)` statement in the copy, the reason the copy exists; a
 *     second is a difference like any other;
 *   - the builder's `import '@angular/localize/init'`, which the copy leaves out because the test
 *     polyfills load it. That holds only while they do: the day `@angular/localize/init` leaves
 *     angular.json's test polyfills, the missing import fails like any other difference.
 *
 * A builder whose init this script can no longer find or read, or that works out its arms another way,
 * is a shape failure: fix the extraction before trusting the check. `--self-test` runs the evaluator
 * against canned builder and copy sources; npm's test-main:check chains it first, as i18n:check does.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SELF = 'scripts/check-test-main.mjs';
const ANGULAR_JSON = 'angular.json';
const KARMA_BUILDER = '@angular/build:karma';
const BUILDER_PACKAGE = 'node_modules/@angular/build/package.json';
const BUILDER_SOURCE = 'node_modules/@angular/build/src/builders/karma/application_builder.js';
const INIT_NAMESPACE = 'angular:test-bed-init';
const LOCALIZE_INIT = '@angular/localize/init';
const ZONE_JS = 'zone.js';
const ZONE_TESTING = 'zone.js/testing';

/** The builder's own way of working out its zone arm, as its source spells it. */
const USES_ZONE_JS = "buildOptions.polyfills?.includes('zone.js')";

/** Thrown where the builder's source no longer has the shape this script reads. */
class ShapeError extends Error {}

/**
 * Shape guard: the day the builder moves or rewrites its init, this must fail loudly rather than
 * pass a copy it never compared.
 */
function shapeFailure(file, detail) {
  return {
    ok: false,
    kind: 'shape',
    message:
      `${file}: ${detail}\n` +
      `The extraction in ${SELF} no longer matches it. Fix the extraction before trusting this check.`,
  };
}

// ---------------------------------------------------------------------------
// Reading the builder's init
// ---------------------------------------------------------------------------

function isNamed(node, name) {
  return Boolean(node.name) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name;
}

/** The first node under `root`, depth first, that `test` accepts. */
function findNode(root, test) {
  let found;
  const visit = node => {
    if (found) return;
    if (test(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The arms only mean what this script thinks while the builder still works them out as it reads:
 * `usesZoneJS` from the normalised polyfills' `includes('zone.js')`, and `hasLocalize` set by a
 * `projectResolve('@angular/localize')` that does not throw.
 */
function assertArms(sourceFile) {
  const usesZoneJS = findNode(sourceFile, node => ts.isVariableDeclaration(node) && isNamed(node, 'usesZoneJS'));
  if (!usesZoneJS?.initializer) {
    throw new ShapeError('no `usesZoneJS` declaration with an initializer.');
  }
  if (oneLine(usesZoneJS.initializer.getText()) !== USES_ZONE_JS) {
    throw new ShapeError(
      `\`usesZoneJS\` is now \`${oneLine(usesZoneJS.initializer.getText())}\`, not \`${USES_ZONE_JS}\`; ` +
        `the zone arm this script works out from angular.json no longer mirrors it.`,
    );
  }
  // `let hasLocalize = false`, and its one assignment `hasLocalize = true` placed after a
  // `projectResolve('@angular/localize')` in the same try block, so that only a resolve that does
  // not throw sets it.
  const hasLocalize = findNode(sourceFile, node => ts.isVariableDeclaration(node) && isNamed(node, 'hasLocalize'));
  const assignments = [];
  const collect = node => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isIdentifier(node.left) &&
      node.left.text === 'hasLocalize'
    ) {
      assignments.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  const resolvesLocalize = statement =>
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    ts.isIdentifier(statement.expression.expression) &&
    statement.expression.expression.text === 'projectResolve' &&
    statement.expression.arguments.length === 1 &&
    ts.isStringLiteralLike(statement.expression.arguments[0]) &&
    statement.expression.arguments[0].text === '@angular/localize';
  const assignment = assignments.length === 1 ? assignments[0] : undefined;
  const statement = assignment?.parent;
  const tryBlock = statement?.parent;
  const tied =
    Boolean(assignment) &&
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    assignment.right.kind === ts.SyntaxKind.TrueKeyword &&
    ts.isExpressionStatement(statement) &&
    ts.isBlock(tryBlock) &&
    ts.isTryStatement(tryBlock.parent) &&
    tryBlock.parent.tryBlock === tryBlock &&
    tryBlock.statements.slice(0, tryBlock.statements.indexOf(statement)).some(resolvesLocalize);
  if (hasLocalize?.initializer?.kind !== ts.SyntaxKind.FalseKeyword || !tied) {
    throw new ShapeError(
      "no `hasLocalize` set by `projectResolve('@angular/localize')`; the localize arm this script " +
        'works out no longer mirrors it.',
    );
  }
}

/** The value of one piece of the init's `contents` array, for the given arms. */
function evaluateNode(node, arms) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce((text, span) => {
      const value = evaluateNode(span.expression, arms);
      if (typeof value !== 'string') {
        throw new ShapeError(`the substitution \`${oneLine(span.expression.getText())}\` is not a string.`);
      }
      return text + value + span.literal.text;
    }, node.head.text);
  }
  if (ts.isParenthesizedExpression(node)) return evaluateNode(node.expression, arms);
  if (ts.isConditionalExpression(node)) {
    return evaluateNode(node.condition, arms) ? evaluateNode(node.whenTrue, arms) : evaluateNode(node.whenFalse, arms);
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return !evaluateNode(node.operand, arms);
  }
  if (ts.isIdentifier(node) && Object.hasOwn(arms, node.text)) return arms[node.text];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(element => {
      if (!ts.isSpreadElement(element)) return [evaluateNode(element, arms)];
      const spread = evaluateNode(element.expression, arms);
      if (!Array.isArray(spread)) {
        throw new ShapeError(`the spread \`${oneLine(element.getText())}\` is not an array.`);
      }
      return spread;
    });
  }
  throw new ShapeError(
    `cannot evaluate the ${ts.SyntaxKind[node.kind]} \`${oneLine(node.getText())}\` in the init's contents.`,
  );
}

/**
 * Whether an identifier only names something, a declaration, a property or a member, rather than
 * reading the variable of that name.
 */
function isNameOnly(identifier) {
  const { parent } = identifier;
  return (
    ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name === identifier) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
  );
}

/**
 * The `contents.join('\n')` call that `loadContent` hands back as the module's `contents`: the
 * property's whole value, from the one return it has. Undefined when it is anything else.
 */
function joinedContents(loadContent) {
  const returns = [];
  const visit = node => {
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(loadContent, visit);
  const returned = returns.length === 1 ? returns[0].expression : undefined;
  if (!returned || !ts.isObjectLiteralExpression(returned)) return undefined;
  const value = returned.properties.find(
    property => ts.isPropertyAssignment(property) && isNamed(property, 'contents'),
  )?.initializer;
  const isJoin =
    Boolean(value) &&
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    ts.isIdentifier(value.expression.expression) &&
    value.expression.expression.text === 'contents' &&
    value.expression.name.text === 'join' &&
    value.arguments.length === 1 &&
    ts.isStringLiteralLike(value.arguments[0]) &&
    value.arguments[0].text === '\n';
  return isJoin ? value : undefined;
}

/** The builder's test-bed init for the given arms, as the source text it hands esbuild. */
function builderInit(builderSource, arms) {
  const sourceFile = ts.createSourceFile(
    'application_builder.js',
    builderSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const plugin = findNode(
    sourceFile,
    node =>
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        property =>
          ts.isPropertyAssignment(property) &&
          isNamed(property, 'namespace') &&
          ts.isStringLiteralLike(property.initializer) &&
          property.initializer.text === INIT_NAMESPACE,
      ),
  );
  if (!plugin) {
    throw new ShapeError(`no virtual module with \`namespace: '${INIT_NAMESPACE}'\`.`);
  }
  const loadContent = plugin.properties.find(property => isNamed(property, 'loadContent'));
  if (!loadContent) {
    throw new ShapeError(`the '${INIT_NAMESPACE}' module has no \`loadContent\`.`);
  }
  const contents = findNode(
    loadContent,
    node =>
      ts.isVariableDeclaration(node) &&
      isNamed(node, 'contents') &&
      Boolean(node.initializer) &&
      ts.isArrayLiteralExpression(node.initializer),
  );
  if (!contents) {
    throw new ShapeError(`the '${INIT_NAMESPACE}' module's \`loadContent\` builds no \`contents\` array.`);
  }
  const joined = joinedContents(loadContent);
  if (!joined) {
    throw new ShapeError(
      "`loadContent` no longer hands back `contents: contents.join('\\n')` from its one return.",
    );
  }
  // The array literal is the whole init only while nothing else touches `contents` on the way to
  // the join: a push, an unshift, a splice or a reassignment each read as one more reference.
  const references = [];
  const collect = node => {
    if (ts.isIdentifier(node) && node.text === 'contents' && !isNameOnly(node)) references.push(node);
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(loadContent, collect);
  if (references.length !== 1 || references[0] !== joined.expression.expression) {
    throw new ShapeError(
      '`contents` is changed after it is built; the init is no longer the array literal alone.',
    );
  }
  assertArms(sourceFile);
  const lines = evaluateNode(contents.initializer, arms);
  const notText = lines.find(line => typeof line !== 'string');
  if (notText !== undefined) {
    throw new ShapeError(`the init's contents hold ${JSON.stringify(notText)}, not a line of source.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Comparing statements
// ---------------------------------------------------------------------------

const printer = ts.createPrinter({ removeComments: true });

function specifierKey(specifier) {
  return `${specifier.isTypeOnly ? 'type ' : ''}${specifier.propertyName?.text ?? ''} ${specifier.name.text}`;
}

/** Drops every trailing comma and puts each import's named imports in one order. */
function normalizer(context) {
  const { factory } = context;
  const nodesVisitor = (nodes, visitor, test, start, count) => {
    const visited = ts.visitNodes(nodes, visitor, test, start, count);
    return visited?.hasTrailingComma ? factory.createNodeArray([...visited], false) : visited;
  };
  const visit = node => {
    const visited = ts.visitEachChild(node, visit, context, nodesVisitor);
    if (ts.isNamedImports(visited)) {
      const sorted = [...visited.elements].sort((a, b) => specifierKey(a).localeCompare(specifierKey(b)));
      return factory.updateNamedImports(visited, sorted);
    }
    return visited;
  };
  return node => ts.visitNode(node, visit);
}

/** The printed text's tokens, a string literal by its value, so layout and quote style drop out. */
function tokensOf(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push(
      kind === ts.SyntaxKind.StringLiteral ? JSON.stringify(scanner.getTokenValue()) : scanner.getTokenText(),
    );
  }
  return tokens.join(' ');
}

/**
 * Each top-level statement of a TypeScript source, with the key it is compared by and the line it is
 * shown as; null when the source does not parse.
 */
function statementsOf(fileName, text) {
  const { diagnostics } = ts.transpileModule(text, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
  });
  const syntax = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntax.length > 0) {
    return { errors: syntax.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')) };
  }
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return {
    statements: sourceFile.statements.map(statement => {
      const result = ts.transform(statement, [normalizer]);
      const printed = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0], sourceFile);
      result.dispose();
      return { node: statement, key: tokensOf(printed), shown: oneLine(printed) };
    }),
  };
}

/** `jasmine.getEnv().configure(...)`: the statement the copy exists to add. */
function isJasmineConfigure(node) {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
  const configure = node.expression.expression;
  if (!ts.isPropertyAccessExpression(configure) || configure.name.text !== 'configure') return false;
  const getEnv = configure.expression;
  return (
    ts.isCallExpression(getEnv) &&
    getEnv.arguments.length === 0 &&
    ts.isPropertyAccessExpression(getEnv.expression) &&
    getEnv.expression.name.text === 'getEnv' &&
    ts.isIdentifier(getEnv.expression.expression) &&
    getEnv.expression.expression.text === 'jasmine'
  );
}

function isSideEffectImport(node, specifier) {
  return (
    ts.isImportDeclaration(node) &&
    !node.importClause &&
    ts.isStringLiteralLike(node.moduleSpecifier) &&
    node.moduleSpecifier.text === specifier
  );
}

/** The two statement lists side by side, in order: ' ' both, '-' the builder's only, '+' the copy's only. */
function diffStatements(builder, copy) {
  const lengths = Array.from({ length: builder.length + 1 }, () => new Array(copy.length + 1).fill(0));
  for (let i = builder.length - 1; i >= 0; i--) {
    for (let j = copy.length - 1; j >= 0; j--) {
      lengths[i][j] =
        builder[i].key === copy[j].key ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < builder.length || j < copy.length) {
    if (i < builder.length && j < copy.length && builder[i].key === copy[j].key) {
      rows.push(`    ${builder[i].shown}`);
      i++;
      j++;
    } else if (i < builder.length && (j === copy.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      rows.push(`  - ${builder[i].shown}`);
      i++;
    } else {
      rows.push(`  + ${copy[j].shown}`);
      j++;
    }
  }
  return rows;
}

function allowancesNote(copyPath) {
  return (
    `Two differences are allowed: one \`jasmine.getEnv().configure(...)\` statement of ${copyPath}'s own, and\n` +
    `leaving out the builder's \`import '${LOCALIZE_INIT}'\` while ${ANGULAR_JSON}'s test polyfills load it.\n` +
    `Comments, trailing commas, layout, quote style and the order of an import's named imports do not count.`
  );
}

/**
 * Pure evaluator over the two sources and what the project says, so selfTest() needs no disk I/O.
 *
 * `polyfills` is the test target's polyfills list from angular.json; `hasLocalize` is whether
 * `@angular/localize` resolves from the project's source root, as the builder asks it.
 */
function evaluateTestMain({ builderSource, copySource, copyPath, polyfills, hasLocalize, builderVersion }) {
  if (!Array.isArray(polyfills) || polyfills.some(polyfill => typeof polyfill !== 'string')) {
    return shapeFailure(ANGULAR_JSON, "the test target's polyfills are not a list of module names.");
  }
  // The builder takes zone.js/testing out of the list before it asks, and asks for the exact name.
  const usesZoneJS = polyfills.filter(polyfill => polyfill !== ZONE_TESTING).includes(ZONE_JS);
  const arms = { usesZoneJS, hasLocalize };
  const armsShown =
    `zone.js ${usesZoneJS ? 'in' : 'not in'} the test polyfills, ` +
    `@angular/localize ${hasLocalize ? 'installed' : 'not installed'}`;
  const builderShown = `${BUILDER_SOURCE}${builderVersion ? ` (@angular/build ${builderVersion})` : ''}`;

  let init;
  try {
    init = builderInit(builderSource, arms);
  } catch (error) {
    if (error instanceof ShapeError) return shapeFailure(BUILDER_SOURCE, error.message);
    throw error;
  }
  const builder = statementsOf('angular-test-bed-init.ts', init);
  if (builder.errors) {
    return shapeFailure(
      BUILDER_SOURCE,
      `its init does not parse for these arms (${armsShown}): ${builder.errors.join('; ')}`,
    );
  }
  const copy = statementsOf(copyPath, copySource);
  if (copy.errors) {
    return { ok: false, kind: 'copy', message: `${copyPath} does not parse: ${copy.errors.join('; ')}` };
  }

  // One configure statement is the copy's reason to exist; a second is a difference like any other.
  const jasmineConfigure = copy.statements.find(statement => isJasmineConfigure(statement.node));
  const copyKept = copy.statements.filter(statement => statement !== jasmineConfigure);
  let builderKept = builder.statements;
  const localizeImport = builder.statements.find(statement => isSideEffectImport(statement.node, LOCALIZE_INIT));
  const copyImportsLocalize = copy.statements.some(statement => isSideEffectImport(statement.node, LOCALIZE_INIT));
  const localizeLeftToPolyfills = Boolean(localizeImport) && !copyImportsLocalize;
  if (localizeLeftToPolyfills) {
    if (!polyfills.includes(LOCALIZE_INIT)) {
      return {
        ok: false,
        kind: 'localize',
        message:
          `${copyPath} leaves out the builder's \`import '${LOCALIZE_INIT}'\`, which is allowed only while\n` +
          `${ANGULAR_JSON}'s test polyfills load it, and they no longer do (${JSON.stringify(polyfills)}).\n` +
          `Put the import back at the top of ${copyPath}, as ${builderShown} has it,\n` +
          `or put '${LOCALIZE_INIT}' back in the test polyfills.`,
      };
    }
    builderKept = builder.statements.filter(statement => statement !== localizeImport);
  }

  const same =
    builderKept.length === copyKept.length &&
    builderKept.every((statement, index) => statement.key === copyKept[index].key);
  if (!same) {
    return {
      ok: false,
      kind: 'drift',
      message:
        `${copyPath} has drifted from the Karma builder's test-bed init in\n` +
        `${builderShown}, read for this project (${armsShown}).\n\n` +
        `Top-level statements, in order ('-' only the builder's init has it, '+' only the copy does):\n` +
        `${diffStatements(builderKept, copyKept).join('\n')}\n\n` +
        `Carry what the builder's init gained over into ${copyPath}, and drop what it lost.\n` +
        allowancesNote(copyPath),
    };
  }

  return {
    ok: true,
    kind: 'match',
    statements: builderKept.length,
    armsShown,
    builderShown,
    allowed: [
      ...(jasmineConfigure ? ['`jasmine.getEnv().configure(...)`'] : []),
      ...(localizeLeftToPolyfills ? [`\`import '${LOCALIZE_INIT}'\` left to the test polyfills`] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// The real run
// ---------------------------------------------------------------------------

/** Whether a package resolves from the project's source root, the way the builder asks. */
function resolvesFrom(sourceRoot, packageName) {
  try {
    createRequire(join(sourceRoot, 'package.json')).resolve(packageName, { paths: [sourceRoot] });
    return true;
  } catch {
    return false;
  }
}

/** The source root the builder works from: `sourceRoot`, or `<root>/src` when the project has none. */
function sourceRootOf(project) {
  return project.sourceRoot === undefined ? resolve(project.root ?? '', 'src') : resolve(project.sourceRoot);
}

function run() {
  const angular = JSON.parse(readFileSync(ANGULAR_JSON, 'utf8'));
  const targets = Object.entries(angular.projects ?? {}).filter(
    ([, project]) => project?.architect?.test?.builder === KARMA_BUILDER,
  );
  const failures = [];
  if (targets.length === 0) {
    failures.push(shapeFailure(ANGULAR_JSON, `no project's test target uses ${KARMA_BUILDER}.`));
  }
  if (!existsSync(BUILDER_SOURCE)) {
    failures.push(shapeFailure(BUILDER_SOURCE, 'not found; run npm ci, or find where the builder moved its init.'));
  }
  const builderSource = failures.length === 0 ? readFileSync(BUILDER_SOURCE, 'utf8') : '';
  const builderVersion = existsSync(BUILDER_PACKAGE)
    ? JSON.parse(readFileSync(BUILDER_PACKAGE, 'utf8')).version
    : undefined;

  for (const [name, project] of failures.length === 0 ? targets : []) {
    const options = project.architect.test.options ?? {};
    if (typeof options.main !== 'string') {
      failures.push(
        shapeFailure(
          ANGULAR_JSON,
          `project "${name}"'s test target names no \`main\`, so the builder's own init runs and the ` +
            'copy it would replace is not loaded.',
        ),
      );
      continue;
    }
    const result = evaluateTestMain({
      builderSource,
      copySource: readFileSync(options.main, 'utf8'),
      copyPath: options.main,
      polyfills: options.polyfills ?? [],
      hasLocalize: resolvesFrom(sourceRootOf(project), '@angular/localize'),
      builderVersion,
    });
    if (!result.ok) {
      failures.push(result);
      continue;
    }
    const allowed = result.allowed.length > 0 ? `; allowed: ${result.allowed.join(', ')}` : '';
    console.log(
      `${options.main} matches the Karma builder's test-bed init in ${result.builderShown}: ` +
        `${result.statements} top-level statements, read with ${result.armsShown}${allowed}.`,
    );
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`${failure.message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/** The init lines of @angular/build 22.1.6, as its source writes them. */
const BUILDER_LINES = [
  "...(hasLocalize ? [`import '@angular/localize/init';`] : [])",
  "// Initialize the Angular testing environment\n                `import { NgModule${usesZoneJS ? ', provideZoneChangeDetection' : ''} } from '@angular/core';`",
  "`import { getTestBed } from '@angular/core/testing';`",
  "`import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';`",
  "`@NgModule({ providers: [${usesZoneJS ? 'provideZoneChangeDetection(), ' : ''}], })`",
  '`export class TestModule {}`',
  '`getTestBed().initTestEnvironment([BrowserTestingModule, TestModule], platformBrowserTesting(), {`',
  '`  errorOnUnknownElements: true,`',
  '`  errorOnUnknownProperties: true,`',
  '`});`',
];

/** How 22.1.6 works out `hasLocalize`. */
const LOCALIZE_ARM = `let hasLocalize = false;
    try {
        const projectResolve = (0, resolve_project_1.createProjectResolver)(projectSourceRoot);
        projectResolve('@angular/localize');
        hasLocalize = true;
    }
    catch { }`;

/**
 * The builder's runEsbuild around a set of init lines, shaped as 22.1.6 ships it. `localize` is the
 * source that works out `hasLocalize`; `loadContent` is the name the module's hook goes by;
 * `afterContents` is source put between the `contents` array and the return; `init` is what the
 * hook hands back as the module's `contents`.
 */
function builderWith(
  lines,
  {
    namespace = INIT_NAMESPACE,
    usesZoneJS = USES_ZONE_JS,
    localize = LOCALIZE_ARM,
    loadContent = 'loadContent',
    afterContents = '',
    init = String.raw`contents.join('\n')`,
  } = {},
) {
  return `async function runEsbuild(buildOptions, context, projectSourceRoot) {
    const usesZoneJS = ${usesZoneJS};
    ${localize}
    const virtualTestBedInit = (0, virtual_module_plugin_1.createVirtualModulePlugin)({
        namespace: '${namespace}',
        ${loadContent}: async () => {
            const contents = [
${lines.map(line => `                ${line}`).join(',\n')},
            ];${afterContents ? `\n            ${afterContents}` : ''}
            return {
                contents: ${init},
                loader: 'js',
                resolveDir: projectSourceRoot,
            };
        },
    });
}
`;
}

/** src/test-main.ts as it stands. */
const COPY = `// Copies the virtual test-bed init.
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

// A spec that sets no expectation fails.
jasmine.getEnv().configure({ failSpecWithNoExpectations: true });

@NgModule({ providers: [provideZoneChangeDetection()] })
export class TestModule {}

getTestBed().initTestEnvironment([BrowserTestingModule, TestModule], platformBrowserTesting(), {
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
`;

const POLYFILLS = [ZONE_JS, ZONE_TESTING, LOCALIZE_INIT];

function selfTest() {
  const cases = [];
  function check(name, actual, expected) {
    cases.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected });
  }

  const evaluate = ({
    lines = BUILDER_LINES,
    builder = {},
    copy = COPY,
    polyfills = POLYFILLS,
    hasLocalize = true,
  } = {}) =>
    evaluateTestMain({
      builderSource: builderWith(lines, builder),
      copySource: copy,
      copyPath: 'src/test-main.ts',
      polyfills,
      hasLocalize,
    });
  const replacing = (lines, from, to) => lines.map(line => (line === from ? to : line));
  const inserting = (lines, before, ...added) => lines.flatMap(line => (line === before ? [...added, line] : [line]));

  const asItStands = evaluate();
  check('accepts the copy as it stands against the builder as it stands', asItStands.kind, 'match');

  // Every difference here is a comment or a trailing comma; the copy carries the localize import
  // itself, and the polyfills do not hold it, so no allowance is in play.
  const twin = evaluate({
    copy: `import '@angular/localize/init'; // loads $localize
/* the zone arm */
import { NgModule, provideZoneChangeDetection, } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
@NgModule({ providers: [/* zone */ provideZoneChangeDetection()], })
export class TestModule {}
getTestBed().initTestEnvironment([BrowserTestingModule, TestModule,], platformBrowserTesting(), {
  errorOnUnknownElements: true, // an unknown element throws
  errorOnUnknownProperties: true
});
`,
    polyfills: [ZONE_JS, ZONE_TESTING],
  });
  check('accepts a pair that differs only in comments and trailing commas', twin.kind, 'match');

  // The printer keeps a list's own line breaks, so only the token comparison reads these as one.
  const relaidOut = evaluate({
    copy: COPY.replace(
      `getTestBed().initTestEnvironment([BrowserTestingModule, TestModule], platformBrowserTesting(), {
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});`,
      `getTestBed().initTestEnvironment(
  [
    BrowserTestingModule,
    TestModule,
  ],
  platformBrowserTesting(),
  { errorOnUnknownElements: true, errorOnUnknownProperties: true },
);`,
    ),
  });
  check('accepts a copy laid out over other lines', relaidOut.kind, 'match');

  const doubleQuoted = evaluate({ copy: COPY.replaceAll("'", '"') });
  check('accepts a copy that quotes its module names with double quotes', doubleQuoted.kind, 'match');

  const reordered = evaluate({
    copy: COPY.replace(
      '{ BrowserTestingModule, platformBrowserTesting }',
      '{ platformBrowserTesting, BrowserTestingModule }',
    ),
  });
  check("reads an import's named imports as a set", reordered.kind, 'match');

  const teardown = evaluate({
    lines: inserting(BUILDER_LINES, '`});`', '`  teardown: { destroyAfterEach: true },`'),
  });
  check("fails when the builder's init gains a teardown option", teardown.kind, 'drift');
  check(
    'a drift failure names the builder, the copy and the allowances',
    [BUILDER_SOURCE, 'src/test-main.ts', 'jasmine.getEnv().configure', LOCALIZE_INIT, 'teardown'].every(needle =>
      (teardown.message ?? '').includes(needle),
    ),
    true,
  );

  const provider = evaluate({
    lines: replacing(
      BUILDER_LINES,
      "`@NgModule({ providers: [${usesZoneJS ? 'provideZoneChangeDetection(), ' : ''}], })`",
      "`@NgModule({ providers: [${usesZoneJS ? 'provideZoneChangeDetection(), ' : ''}provideCheckNoChangesConfig({ exhaustive: true }), ], })`",
    ),
  });
  check("fails when the builder's init gains a provider", provider.kind, 'drift');

  const statement = evaluate({ lines: [...BUILDER_LINES, '`getTestBed().resetTestingModule();`'] });
  check("fails when the builder's init gains a top-level statement", statement.kind, 'drift');

  const namespaceGone = evaluate({ builder: { namespace: 'angular:test-init' } });
  check('flags a builder whose test-bed namespace is gone as a shape failure', namespaceGone.kind, 'shape');

  const loadContentGone = evaluate({ builder: { loadContent: 'load' } });
  check('flags a test-bed module with no loadContent as a shape failure', loadContentGone.kind, 'shape');

  const notALine = evaluate({ lines: [...BUILDER_LINES, 'usesZoneJS'] });
  check('flags an init line that is not source text as a shape failure', notALine.kind, 'shape');

  const otherSeparator = evaluate({ builder: { init: String.raw`contents.join('\r\n')` } });
  check('flags an init joined by something other than a line feed as a shape failure', otherSeparator.kind, 'shape');

  const wrappedJoin = evaluate({ builder: { init: String.raw`"import 'x';\n" + contents.join('\n')` } });
  check('flags an init that adds to the joined lines as a shape failure', wrappedJoin.kind, 'shape');

  const pushedLater = evaluate({
    builder: { afterContents: 'contents.push(`getTestBed().resetTestingModule();`);' },
  });
  check('flags a builder that adds to its init after the array as a shape failure', pushedLater.kind, 'shape');

  const unreadable = evaluate({ lines: [...BUILDER_LINES, '...extraLines'] });
  check('flags an init line it cannot evaluate as a shape failure', unreadable.kind, 'shape');

  const otherArm = evaluate({ builder: { usesZoneJS: "buildOptions.polyfills?.some(p => p.startsWith('zone.js'))" } });
  check('flags a builder that works out its zone arm another way as a shape failure', otherArm.kind, 'shape');

  const otherLocalize = evaluate({
    builder: { localize: 'const hasLocalize = buildOptions.i18nOptions?.shouldInline ?? false;' },
  });
  check(
    'flags a builder that works out its localize arm another way as a shape failure',
    otherLocalize.kind,
    'shape',
  );

  const localizeSetFirst = evaluate({
    builder: {
      localize: LOCALIZE_ARM.replace(
        "        projectResolve('@angular/localize');\n        hasLocalize = true;",
        "        hasLocalize = true;\n        projectResolve('@angular/localize');",
      ),
    },
  });
  check(
    'flags a builder that sets its localize arm before it resolves @angular/localize as a shape failure',
    localizeSetFirst.kind,
    'shape',
  );

  const droppedOption = evaluate({ copy: COPY.replace('  errorOnUnknownProperties: true,\n', '') });
  check('fails when the copy drops an option', droppedOption.kind, 'drift');

  const JASMINE_CONFIGURE = 'jasmine.getEnv().configure({ failSpecWithNoExpectations: true });\n';
  const copyAdding = statement => COPY.replace(JASMINE_CONFIGURE, `${JASMINE_CONFIGURE}${statement}\n`);
  const addedStatement = evaluate({ copy: copyAdding('getTestBed().resetTestingModule();') });
  check('fails when the copy adds a statement of its own', addedStatement.kind, 'drift');

  const secondConfigure = evaluate({ copy: copyAdding('jasmine.getEnv().configure({ random: false });') });
  check('fails when the copy adds a second jasmine configuration', secondConfigure.kind, 'drift');

  const otherReceiver = evaluate({ copy: copyAdding('env.getEnv().configure({ random: false });') });
  check('fails when the copy configures something other than jasmine', otherReceiver.kind, 'drift');

  const swapped = evaluate({
    copy: COPY.replace(
      "import { NgModule, provideZoneChangeDetection } from '@angular/core';\nimport { getTestBed } from '@angular/core/testing';",
      "import { getTestBed } from '@angular/core/testing';\nimport { NgModule, provideZoneChangeDetection } from '@angular/core';",
    ),
  });
  check('fails a copy whose statements stand in another order', swapped.kind, 'drift');

  const localizeGone = evaluate({ polyfills: [ZONE_JS, ZONE_TESTING] });
  check(
    'fails a copy that leaves the localize import out once the test polyfills no longer load it',
    localizeGone.kind,
    'localize',
  );

  const noLocalize = evaluate({ polyfills: [ZONE_JS, ZONE_TESTING], hasLocalize: false });
  check('accepts a copy without the localize import when @angular/localize is not installed', noLocalize.kind, 'match');

  const zoneTestingOnly = evaluate({ polyfills: [ZONE_TESTING, LOCALIZE_INIT] });
  check(
    'fails a copy that keeps the zone provider when only zone.js/testing is left in the polyfills',
    zoneTestingOnly.kind,
    'drift',
  );

  const unparsable = evaluate({ copy: COPY.replace('export class TestModule {}', 'export class TestModule {') });
  check('fails a copy that does not parse', unparsable.kind, 'copy');

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
  console.log(`check-test-main self-test: ${cases.length} passed`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run();
}
