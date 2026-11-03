import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentEnvironment } from './validate-deployment-env.mjs';
const refs = { staging: 'tksvbkvfusrnxulpahky', production: 'abwipnppcrghdhwriyjp' };
const key = (ref, role) => `header.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.signature`;
const config = (APP_ENV = 'staging') => ({ APP_ENV, NEXT_PUBLIC_SUPABASE_URL: `https://${refs[APP_ENV]}.supabase.co`, NEXT_PUBLIC_SITE_URL: APP_ENV === 'staging' ? 'https://staging.novlearn.fr' : 'https://novlearn.fr', NEXT_PUBLIC_SUPABASE_ANON_KEY: key(refs[APP_ENV], 'anon'), SUPABASE_SERVICE_KEY: key(refs[APP_ENV], 'service_role'), SUPABASE_SERVICE_ROLE_KEY: key(refs[APP_ENV], 'service_role') });
test('accepts matching staging and production projects', () => { for (const e of Object.keys(refs)) assert.equal(validateDeploymentEnvironment(config(e)).projectRef, refs[e]); });
test('refuses cross-project URLs, missing credentials and privileged public keys', () => {
  assert.throws(() => validateDeploymentEnvironment({ ...config(), NEXT_PUBLIC_SUPABASE_URL: config('production').NEXT_PUBLIC_SUPABASE_URL }));
  assert.throws(() => validateDeploymentEnvironment({ ...config(), SUPABASE_SERVICE_KEY: config('production').SUPABASE_SERVICE_KEY }));
  assert.throws(() => validateDeploymentEnvironment({ ...config(), SUPABASE_SERVICE_ROLE_KEY: '' }));
  assert.throws(() => validateDeploymentEnvironment({ ...config(), NEXT_PUBLIC_SUPABASE_ANON_KEY: config().SUPABASE_SERVICE_KEY }));
});
test('refuses accidentally sharing the production Engine host with staging', () => {
  const env = { ...config(), NOVLEARN_ENGINE_ENABLED: 'true', ENGINE_TOKEN: 'a'.repeat(64), ENGINE_URL: 'http://127.0.0.1:3152/run' };
  assert.throws(() => validateDeploymentEnvironment(env));
  assert.equal(validateDeploymentEnvironment({ ...env, ENGINE_URL: 'http://127.0.0.1:3151/run' }).engineEnabled, true);
});
