// Private stdin channel only; no network, database or Auth credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNodeHost } from 'novlearn-exercise-engine/node-host';
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const cgroup = Object.fromEntries(
  await Promise.all(
    ['memory.max', 'memory.swap.max', 'pids.max'].map(async (name) => [
      name,
      (await readFile('/sys/fs/cgroup/' + name, 'utf8')).trim(),
    ]),
  ),
);
assert.deepEqual(cgroup, {
  'memory.max': '402653184',
  'memory.swap.max': '0',
  'pids.max': '64',
});
const host = createNodeHost({ maxConcurrent: 1, maxQueued: 4 });
const definition = JSON.parse(
  await readFile('/inputs/definition.json', 'utf8'),
);
const request = (id, definition) =>
  JSON.stringify({
    protocolVersion: 1,
    requestId: id,
    operation: 'validateDefinition',
    payload: { definition },
  });
const valid = await host.run(request('preflight_valid', definition));
assert.equal(valid.ok, true);
assert.equal(valid.value.ok, true);
const invalid = await host.run(
  request('preflight_invalid', { ...definition, schemaVersion: 999 }),
);
assert.equal(invalid.ok, true);
assert.equal(invalid.value.ok, false);
const aborted = new AbortController();
aborted.abort();
assert.equal(
  (
    await host.run(request('preflight_abort', definition), {
      signal: aborted.signal,
    })
  ).error,
  'aborted',
);
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
send({
  ready: true,
  cgroup,
  validDefinition: true,
  invalidDefinitionRejected: true,
  abortedRequestRejected: true,
});
const active = new Map();
let buffer = Buffer.alloc(0);
const accept = async (line) => {
  const frame = JSON.parse(line);
  if (frame.cancel) {
    active.get(frame.cancel)?.abort();
    return;
  }
  const id = frame.requestId;
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || active.has(id))
    throw Error('Invalid private request');
  if (active.size >= 5) {
    send({
      requestId: id,
      ok: false,
      error: 'busy',
      metrics: { elapsedMs: 0, queuedMs: 0 },
    });
    return;
  }
  const controller = new AbortController();
  active.set(id, controller);
  try {
    send(await host.run(JSON.stringify(frame), { signal: controller.signal }));
  } finally {
    active.delete(id);
  }
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf(10);
    if (end < 0) break;
    if (end > 1048576) {
      process.exitCode = 1;
      process.stdin.destroy();
      break;
    }
    const line = buffer.subarray(0, end).toString('utf8');
    buffer = buffer.subarray(end + 1);
    void accept(line).catch(async () => {
      process.exitCode = 1;
      process.stdin.destroy();
      await host.close();
    });
  }
  if (buffer.length > 1048576) {
    process.exitCode = 1;
    process.stdin.destroy();
  }
});
const close = async () => {
  for (const controller of active.values()) controller.abort();
  await host.close();
};
process.stdin.on('close', () => void close());
process.stdin.on('end', () => void close());
process.on('SIGTERM', () => {
  void close().then(() => process.exit());
});
