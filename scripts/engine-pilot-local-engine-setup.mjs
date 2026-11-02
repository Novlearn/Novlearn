import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { copyFile, writeFile } from 'node:fs/promises';
await writeFile(
  '/consumer/package.json',
  JSON.stringify({ name: 'admin-local-engine', private: true, type: 'module' }),
);
const installed = spawnSync(
  process.execPath,
  [
    '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    '/consumer/npm-cache',
    '/archives/engine.tgz',
    '/archives/cortex.tgz',
    '/archives/colors.tgz',
    '/archives/complex.tgz',
  ],
  { cwd: '/consumer', encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 },
);
assert.equal(installed.status, 0, installed.stderr);
await copyFile('/inputs/worker.mjs', '/consumer/worker.mjs');
const child = spawn(process.execPath, ['/consumer/worker.mjs'], {
  cwd: '/consumer',
  stdio: 'inherit',
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
