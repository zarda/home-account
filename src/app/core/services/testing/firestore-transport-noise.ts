/**
 * The Firestore SDK's own lines about reaching the backend. It prints them
 * at error level, whatever the code under test does: once per client before
 * it first goes online (a failed first watch stream, or ten seconds with no
 * answer), and when the backend answers RESOURCE_EXHAUSTED. A loaded machine
 * or a slow emulator is enough to bring one on, in whichever case happens to
 * open a client's first stream.
 */
const SDK_TRANSPORT = /Could not reach Cloud Firestore backend|Using maximum backoff delay|RESOURCE_EXHAUSTED/;

/**
 * The console.error calls a smoke spec asserting a quiet console fails on:
 * every call but the SDK's transport lines, each call's arguments as strings
 * so a failure names itself. Matched on the joined arguments, because the SDK
 * puts its prefix in the first and the message in a later one.
 */
export function unexpectedConsoleErrors(calls: readonly (readonly unknown[])[]): string[][] {
  return calls
    .map(args => args.map(arg => String(arg)))
    .filter(args => !SDK_TRANSPORT.test(args.join(' ')));
}
