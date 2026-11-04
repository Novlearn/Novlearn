import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeEngine, archiveSha256, endpoint, calculation } from './probe-engine-vps-staging.mjs';

const env = { APP_ENV: 'staging', ENGINE_URL: endpoint, ENGINE_TOKEN: 'a'.repeat(64) };
test('qualifies health, authenticated bounded arithmetic and exact returned fingerprint', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (url.endsWith('/healthz')) return new Response('{}', { status: 200 });
    const body = JSON.parse(options.body);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${env.ENGINE_TOKEN}`);
    assert.equal(options.headers['x-engine-archive-sha256'], archiveSha256);
    assert.equal(body.operation, 'parseMathInput');
    assert.deepEqual(body.payload, calculation);
    return Response.json({ ok: true, requestId: body.requestId, value: { ok: true } }, { headers: { 'x-engine-archive-sha256': archiveSha256 } });
  });
  const proof = await probeEngine(env);
  assert.equal(proof.authenticatedCalculation, true);
  assert.deepEqual(calls, ['http://127.0.0.1:3151/healthz', endpoint]);
  assert(!JSON.stringify(proof).includes(env.ENGINE_TOKEN));
});
test('rejects production or public endpoints before any network access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  await assert.rejects(probeEngine({ ...env, APP_ENV: 'production' }), /APP_ENV must be staging/);
  await assert.rejects(probeEngine({ ...env, ENGINE_URL: 'http://127.0.0.1:3152/run' }), /ENGINE_URL must/);
  await assert.rejects(probeEngine({ ...env, ENGINE_URL: 'https://staging.novlearn.fr/run' }), /ENGINE_URL must/);
  assert.equal(fetch.mock.callCount(), 0);
});
test('rejects an HTTP 200 returned by another Engine archive', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/healthz') ? new Response('{}') : Response.json({}, { headers: { 'x-engine-archive-sha256': 'b'.repeat(64) } }));
  await assert.rejects(probeEngine(env), /Engine response fingerprint mismatch/);
});
test('rejects an HTTP 200 transport response when the calculation was refused', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => url.endsWith('/healthz') ? new Response('{}') : Response.json({ ok: true, requestId: JSON.parse(options.body).requestId, value: { ok: false } }, { headers: { 'x-engine-archive-sha256': archiveSha256 } }));
  await assert.rejects(probeEngine(env), /Engine parser rejected/);
});
