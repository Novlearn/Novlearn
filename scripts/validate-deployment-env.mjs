import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function validateDeploymentEnvironment(env) {
  const projects = { staging: 'tksvbkvfusrnxulpahky', production: 'abwipnppcrghdhwriyjp' };
  assert(Object.hasOwn(projects, env.APP_ENV), 'APP_ENV must explicitly select staging or production');
  const ref = projects[env.APP_ENV];
  assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).href, `https://${ref}.supabase.co/`, 'Supabase project does not match APP_ENV');
  const expectedOrigin = env.APP_ENV === 'staging' ? 'https://staging.novlearn.fr' : 'https://novlearn.fr';
  assert.equal(env.NEXT_PUBLIC_SITE_URL, expectedOrigin, 'Site origin does not match APP_ENV');
  for (const [name, role] of [['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'], ['SUPABASE_SERVICE_KEY', 'service_role'], ['SUPABASE_SERVICE_ROLE_KEY', 'service_role']]) {
    const value = env[name] ?? '';
    const prefix = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    if (value.startsWith(prefix) && value.length > prefix.length + 8 && value.length < 512 && !value.includes('replace_')) continue;
    let claims;
    try { claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); } catch { assert.fail(`${name} is missing or invalid`); }
    assert.equal(claims.ref, ref, `${name} belongs to a different project`);
    assert.equal(claims.role, role, `${name} has the wrong role`);
  }
  if (env.NOVLEARN_ENGINE_ENABLED === 'true') {
    const url = new URL(env.ENGINE_URL);
    assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/run', 'Invalid Engine endpoint');
    const port = env.APP_ENV === 'staging' ? '3151' : '3152';
    assert.equal(url.href, `http://127.0.0.1:${port}/run`, 'VPS must use its environment-specific loopback Engine host');
    assert(/^[a-f0-9]{64}$/.test(env.ENGINE_TOKEN ?? ''), 'ENGINE_TOKEN must contain 64 hexadecimal characters');
  }
  return { environment: env.APP_ENV, projectRef: ref, engineEnabled: env.NOVLEARN_ENGINE_ENABLED === 'true' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(validateDeploymentEnvironment(process.env))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
