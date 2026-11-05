// Read-only qualification. Never log configuration, HTTP bodies or errors from dependencies.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const archiveSha256 = '6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a';
export const endpoint = 'http://127.0.0.1:3151/run';
export const calculation = { source: '4/2', profile: 'school-latex-v1', context: {} };

export async function probeEngine(env) {
  assert.equal(env.APP_ENV, 'staging', 'APP_ENV must be staging');
  assert.equal(env.ENGINE_URL, endpoint, 'ENGINE_URL must be http://127.0.0.1:3151/run');
  assert.match(env.ENGINE_TOKEN ?? '', /^[a-f0-9]{64}$/, 'ENGINE_TOKEN is missing or invalid');
  const health = await fetch('http://127.0.0.1:3151/healthz', { signal: AbortSignal.timeout(10000), redirect: 'error' });
  assert.equal(health.status, 200, 'Engine healthz failed');
  const requestId = randomUUID();
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.ENGINE_TOKEN}`, 'x-engine-archive-sha256': archiveSha256 },
    body: JSON.stringify({ protocolVersion: 1, requestId, operation: 'parseMathInput', payload: calculation }),
  });
  assert.equal(response.status, 200, `Authenticated Engine calculation failed (HTTP ${response.status})`);
  assert.equal(response.headers.get('x-engine-archive-sha256'), archiveSha256, 'Engine response fingerprint mismatch');
  const result = await response.json();
  assert.equal(result.requestId, requestId, 'Engine request identity mismatch');
  assert.equal(result.ok, true, 'Engine transport rejected calculation');
  assert.equal(result.value?.ok, true, 'Engine parser rejected synthetic arithmetic');
  return { healthz: 200, authenticatedCalculation: true, requestFingerprint: archiveSha256, responseFingerprint: archiveSha256, endpoint };
}

async function processEnvironment(directory, pidFile, expectedName) {
  const pid = (await readFile(path.join(directory, pidFile), 'utf8')).trim();
  assert.match(pid, /^\d+$/, 'Invalid staging PID file');
  const { readlink } = await import('node:fs/promises');
  assert.equal(await readlink(`/proc/${pid}/cwd`), directory, 'Staging process working directory mismatch');
  const command = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
  assert(command.some(value => value.includes(expectedName)), 'Staging process command mismatch');
  const raw = await readFile(`/proc/${pid}/environ`, 'utf8');
  const env = Object.fromEntries(raw.split('\0').filter(Boolean).map(item => { const i = item.indexOf('='); return [item.slice(0, i), item.slice(i + 1)]; }));
  assert.equal(env.NOVLEARN_ENGINE_ENABLED, 'true', 'NOVLEARN_ENGINE_ENABLED must be true in running staging processes');
  assert.equal(env.APP_ENV, 'staging', 'Running process APP_ENV mismatch');
  assert.equal(env.NODE_ENV, 'production', 'Running process NODE_ENV mismatch');
  assert.equal(env.ENGINE_URL, endpoint, 'Running process ENGINE_URL mismatch');
  return { pid: Number(pid), env };
}

export async function verifyRunningStaging(root = '/opt/novlearn-staging') {
  assert.equal(root, '/opt/novlearn-staging', 'Only staging is supported');
  const proof = [];
  for (const [name, directory, pidFile, command] of [
    ['next', 'frontend', 'frontend-staging.pid', 'next'],
    ['duels', 'duel-server', 'duel-staging.pid', 'dist/app.config.js'],
  ]) {
    const running = await processEnvironment(path.join(root, directory), pidFile, command);
    const probe = await probeEngine(running.env);
    if (name === 'next') {
      assert.equal(running.env.NEXT_PUBLIC_SITE_URL, 'https://staging.novlearn.fr');
      assert.equal(running.env.NEXT_PUBLIC_SUPABASE_URL, 'https://tksvbkvfusrnxulpahky.supabase.co');
      const { createRemoteHost } = await import(pathToFileURL(path.join(root, 'frontend/node_modules/novlearn-exercise-engine/dist/remote-host/index.js')));
      const host = createRemoteHost({ url: running.env.ENGINE_URL, token: running.env.ENGINE_TOKEN, archiveSha256 });
      try {
        const result = await host.run(JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), operation: 'parseMathInput', payload: calculation }));
        assert.equal(result.ok && result.value?.ok, true, 'Deployed Next SDK transport failed');
      } finally { await host.close(); }
    } else {
      assert.equal(running.env.SUPABASE_URL, 'https://tksvbkvfusrnxulpahky.supabase.co');
      // Invoke the actual deployed duel transport with the environment inherited by its running process.
      Object.assign(process.env, running.env);
      const { engineRun } = await import(pathToFileURL(path.join(root, 'duel-server/dist/engine.js')));
      assert.equal((await engineRun('parseMathInput', calculation)).ok, true, 'Deployed duel transport failed');
    }
    proof.push({ process: name, pid: running.pid, effectiveEnvironment: 'staging', engineEnabled: true, ...probe });
  }
  const page = await fetch('https://staging.novlearn.fr', { signal: AbortSignal.timeout(20000) });
  assert.equal(page.status, 200, 'Staging application did not load');
  const html = await page.text();
  assert(html.includes('/_next/'), 'Staging response is not the Next application');
  return { processes: proof, applicationHttp: 200, browserJourneyExecuted: false, completeDuelExecuted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proof = process.argv.includes('--processes') ? await verifyRunningStaging() : await probeEngine(process.env);
    console.log(JSON.stringify({ result: 'PASS', scope: 'VPS staging read-only', ...proof }));
  } catch (error) {
    // Only assertion messages authored above are safe to expose.
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Staging verification failed; inspect access, process state and Engine availability without printing secrets.');
    process.exitCode = 1;
  }
}
