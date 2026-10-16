// Records the Firestore emulator's /requests feed (one event per rules
// evaluation) as NDJSON, without the rules text every event repeats.
// Usage: node requests-recorder.mjs ws://127.0.0.1:9150/requests out.ndjson
import { createWriteStream } from 'node:fs';

const [url, outPath] = process.argv.slice(2);
if (!url || !outPath) {
  console.error('usage: requests-recorder.mjs <ws-url> <out.ndjson>');
  process.exit(2);
}
const out = createWriteStream(outPath, { flags: 'a' });
const write = record => out.write(`${JSON.stringify(record)}\n`);
let stopping = false;

function connect() {
  const socket = new WebSocket(url);
  socket.onopen = () => write({ received: Date.now(), event: 'open' });
  socket.onmessage = message => {
    const received = Date.now();
    let payload;
    try {
      payload = JSON.parse(String(message.data));
    } catch {
      write({ received, unparsed: String(message.data).slice(0, 500) });
      return;
    }
    const backlog = Array.isArray(payload);
    for (const item of backlog ? payload : [payload]) {
      // The rules text and the documents' data are most of each event; the
      // timeline needs only what was asked, of what, by whom, and the verdict.
      const context = item?.rulesContext ?? {};
      write({
        received,
        backlog,
        time: item?.time,
        requestId: item?.requestId,
        outcome: item?.outcome,
        granularAllowOutcomes: item?.granularAllowOutcomes,
        rulesContext: { method: context.method, path: context.path, time: context.time, uid: context.request?.auth?.uid }
      });
    }
  };
  socket.onclose = () => {
    write({ received: Date.now(), event: 'close' });
    if (!stopping) setTimeout(connect, 200);
  };
  socket.onerror = () => undefined;
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    out.end(() => process.exit(0));
  });
}
connect();
