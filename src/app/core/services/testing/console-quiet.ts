/// <reference types="jasmine" />

/** The prefixes each spy `quietConsole` made holds back. */
const heldPrefixes = new WeakMap<jasmine.Spy, readonly string[]>();

/** The calls a `consoleLines` read has returned. */
const readCalls = new WeakSet<jasmine.CallInfo<jasmine.Func>>();

const startsWithOneOf = (args: readonly unknown[], prefixes: readonly string[]): boolean => {
  const first = String(args[0]);
  return prefixes.some(prefix => first.startsWith(prefix));
};

/**
 * A spy on `console.warn` or `console.error` that holds back every line
 * starting with a named prefix, expected or not, and prints every other line
 * as before.
 *
 * A case that makes the code under test warn on purpose spies the method so
 * it can expect the line. A bare spy hides any other line along with it, and
 * `callThrough` prints the expected ones into the run's output, where a run
 * of the spec alone reads as noise (#545). This spy holds back a line whose
 * first argument starts with one of `prefixes`, for the case to read with
 * `consoleLines`, and hands any other line to the method the console had
 * before the spy. That method is read before `spyOn` replaces it: read after,
 * it would be the spy itself, and a line passed on would come straight back.
 *
 * A held line prints nothing, so a spec that holds lines in every case calls
 * `expectEveryHeldLineRead` in its `afterEach`: a held line no case read
 * fails the case that caused it, as a printed one would have been noticed.
 *
 * Called in a `beforeEach` or a case; jasmine removes the spy after the case.
 */
export function quietConsole(method: 'warn' | 'error', prefixes: readonly string[]): jasmine.Spy {
  const original = console[method];
  const spy = spyOn(console, method).and.callFake((...args: unknown[]) => {
    if (startsWithOneOf(args, prefixes)) return;
    original.apply(console, args);
  });
  heldPrefixes.set(spy, prefixes);
  return spy;
}

/**
 * The calls `spy` took whose first argument starts with `prefix`, each as its
 * arguments, so lines another service printed cannot fail a case. Each call
 * returned counts as read for `expectEveryHeldLineRead`.
 */
export function consoleLines(spy: jasmine.Spy, prefix: string): unknown[][] {
  const calls = spy.calls.all().filter(call => startsWithOneOf(call.args, [prefix]));
  for (const call of calls) readCalls.add(call);
  return calls.map(call => call.args);
}

/** The lines `spy` held back that no `consoleLines` read has returned, each as its arguments. */
export function unreadLines(spy: jasmine.Spy): unknown[][] {
  const prefixes = heldPrefixes.get(spy);
  if (!prefixes) throw new Error('unreadLines reads only a spy quietConsole made');
  return spy.calls.all()
    .filter(call => !readCalls.has(call) && startsWithOneOf(call.args, prefixes))
    .map(call => call.args);
}

/**
 * Fails the running case on any line `spy` held back that the case never
 * read with `consoleLines`. Called in an `afterEach`, after any teardown that
 * can still print.
 */
export function expectEveryHeldLineRead(spy: jasmine.Spy): void {
  expect(unreadLines(spy))
    .withContext('a line held back that the case never read with consoleLines')
    .toEqual([]);
}
