// Waits for the traced spec to say a commit has been pending too long, then,
// once per round, takes a thread dump (SIGQUIT: the JVM prints it to its
// stdout, which is firestore-debug.log) and starts a heap dump at once, both
// while the commit is still waiting on its lock.
// Usage: node dump-sidecar.mjs <jvm-pid> <round-dir> <port>
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const [pidArg, dir, portArg] = process.argv.slice(2);
const pid = Number(pidArg);
const port = Number(portArg);
if (!pid || !dir || !port) {
  console.error('usage: dump-sidecar.mjs <jvm-pid> <round-dir> <port>');
  process.exit(2);
}
const log = record => appendFileSync(`${dir}/sidecar.ndjson`, `${JSON.stringify({ t: Date.now(), ...record })}\n`);
let fired = false;

const server = createServer((request, response) => {
  response.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  response.end();
  if (request.method !== 'POST' || !request.url?.startsWith('/dump')) return;
  const what = new URL(request.url, 'http://sidecar').searchParams.get('what') ?? '';
  log({ event: 'trigger', what, first: !fired });
  if (fired) return;
  fired = true;
  try {
    process.kill(pid, 'SIGQUIT');
    log({ event: 'thread-dump' });
  } catch (error) {
    log({ event: 'thread-dump-failed', error: String(error) });
  }
  const file = `${dir}/heap-${Date.now()}.hprof.gz`;
  const env = { ...process.env };
  delete env.JAVA_TOOL_OPTIONS;
  delete env.JDK_JAVA_OPTIONS;
  const started = Date.now();
  log({ event: 'heap-start', file });
  const child = spawn('jcmd', [String(pid), 'GC.heap_dump', '-all', '-gz=1', file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('exit', code => log({ event: 'heap-end', code, ms: Date.now() - started, output: output.trim().slice(0, 500) }));
});
server.listen(port, '127.0.0.1', () => log({ event: 'listening', port, pid }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
