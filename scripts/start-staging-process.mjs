// Load private configuration before exec-style spawning, so /proc exposes the
// actual inherited configuration for verification. No configuration is logged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const service = process.argv[2];
assert(['frontend', 'duel-server'].includes(service));
assert.equal(process.cwd(), `/opt/novlearn-staging/${service}`);
// Clear inherited application settings; the staging file is authoritative.
for (const key of Object.keys(process.env)) {
  if (/^(ENGINE_|NOVLEARN_|NEXT_PUBLIC_|SUPABASE_|APP_ENV$|NODE_ENV$)/.test(key)) delete process.env[key];
}
process.loadEnvFile(service === 'frontend' ? '.env.local' : '.env');
assert.equal(process.env.APP_ENV, 'staging');
assert.equal(process.env.ENGINE_URL, 'http://127.0.0.1:3151/run');
assert.equal(process.env.NOVLEARN_ENGINE_ENABLED, 'true');
process.env.NODE_ENV = 'production';
const args = service === 'frontend' ? ['node_modules/next/dist/bin/next', 'start', '-p', '3001'] : ['dist/app.config.js'];
const child = spawn(process.execPath, args, { env: process.env, stdio: 'inherit' });
await writeFile(path.join(process.cwd(), service === 'frontend' ? 'frontend-staging.pid' : 'duel-staging.pid'), String(child.pid));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
