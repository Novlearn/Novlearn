// Isolated development entry point: no original .env is changed or trusted.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalEngine } from './engine-pilot-local-engine.mjs';
import { verifyEngineStaging } from './verify-engine-staging.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
assert.equal(process.argv.length, 2);
process.chdir(root);
assert(/^24\./.test(process.versions.node), 'The certified Engine requires Node 24.19 or newer within Node 24.');
assert(Number(process.versions.node.split('.')[1]) >= 19, 'The certified Engine requires Node >=24.19.0.');
await verifyEngineStaging();
const config = parseEnv(await readFile('.env.engine-staging.local', 'utf8'));
assert.equal(config.NEXT_PUBLIC_SUPABASE_URL, 'https://tksvbkvfusrnxulpahky.supabase.co');
assert.equal(config.NEXT_PUBLIC_SITE_URL, 'http://127.0.0.1:3000');
assert(config.NEXT_PUBLIC_SUPABASE_ANON_KEY?.startsWith('sb_publishable_'));
assert.equal(config.NOVLEARN_ENGINE_ENABLED, 'true');
assert(Object.keys(config).every(key => ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SITE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NOVLEARN_ENGINE_ENABLED'].includes(key)));
assert.equal(process.env.VERCEL, undefined);
const work = path.join(root, '.local/engine-staging', 'run-' + Date.now());
await mkdir(work, { recursive: true });
const engine = await startLocalEngine(work);
const server = parseEnv(await readFile('.local/engine-staging/server.env', 'utf8'));
assert.equal(server.SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_URL);
const claims=JSON.parse(Buffer.from(server.SUPABASE_SERVICE_KEY.split('.')[1],'base64url').toString());
assert.equal(claims.ref,'tksvbkvfusrnxulpahky');assert.equal(claims.role,'service_role');
// Defined empty strings override Next's existing .env.local. Only the Staging
// public key/session can be used here; no existing privileged key is inherited.
const env = { ...process.env, ...config, ...engine.environment, NODE_ENV: 'development',
  SUPABASE_SERVICE_ROLE_KEY: server.SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_KEY: server.SUPABASE_SERVICE_KEY, SUPABASE_URL: config.NEXT_PUBLIC_SUPABASE_URL,
  DATABASE_URL: '', ADMIN_API_SECRET: '', NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_COLYSEUS_URL: 'http://127.0.0.1:1',
  SCHEDULER_ENABLED: 'false', NEXT_PUBLIC_GA_ID: '', NOVLEARN_ENGINE_ENABLED:'true',NEXT_PUBLIC_ENGINE_ENABLED:'true',
  NEXT_PUBLIC_COLYSEUS_URL:'ws://127.0.0.1:2568',APP_ENV:'development',DEBUG:'False',CORS_ORIGINS:'http://127.0.0.1:3000' };
const backend=spawn(path.join(root,'backend/.venv/Scripts/python.exe'),['-m','uvicorn','main:app','--host','127.0.0.1','--port','8011'],
 {cwd:path.join(root,'backend'),env:{...env,PORT:'8011'},stdio:'inherit',windowsHide:true});
const duel=spawn(process.execPath,['-r','ts-node/register/transpile-only','src/app.config.ts'],
 {cwd:path.join(root,'duel-server'),env:{...env,PORT:'2568'},stdio:'inherit',windowsHide:true});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', '3000'],
  { cwd: path.join(root, 'frontend'), env, stdio: 'inherit', windowsHide: true });
await writeFile(path.join(work, 'runtime.json'), JSON.stringify({ projectRef: 'tksvbkvfusrnxulpahky',
  processId: child.pid, engineContainer: engine.container, backendProcessId:backend.pid,duelProcessId:duel.pid, origin: config.NEXT_PUBLIC_SITE_URL }, null, 2));
let closing = false;
const close = async () => {
  if (closing) return; closing = true;
  for(const service of [child,backend,duel]) {
    if (process.platform === 'win32' && service.exitCode === null && service.pid) {
      spawnSync('taskkill', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    } else service.kill();
  }
  await engine?.close();
};
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
child.once('error', () => void close());
child.once('exit', () => void close());
console.log('NovLearn : http://127.0.0.1:3000/entrainement — frontend, API et duels sur Staging uniquement.');
