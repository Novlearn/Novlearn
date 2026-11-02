// Staging-only catalogue migration preparation. Original content stays private.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const privateRoot=path.join(root,'.local/engine-staging');
const projectRef='tksvbkvfusrnxulpahky';
const mode=process.argv[2];
assert(['export'].includes(mode),'Unknown or unsupported operation');
assert.equal(process.argv.length,3);
const configuration=parseEnv(await readFile(path.join(privateRoot,'server.env'),'utf8'));
assert.equal(configuration.SUPABASE_URL,`https://${projectRef}.supabase.co`);
const claims=JSON.parse(Buffer.from(configuration.SUPABASE_SERVICE_KEY.split('.')[1],'base64url').toString());
assert.equal(claims.ref,projectRef);assert.equal(claims.role,'service_role');
const require=createRequire(path.join(root,'frontend/package.json'));
const {createClient}=require('@supabase/supabase-js');
const client=createClient(configuration.SUPABASE_URL,configuration.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})}});
const checked=r=>{if(r.error)throw new Error('Staging catalogue operation failed: '+r.error.code);return r.data;};
if(mode==='export'){
 const [parents,chapters,competences]=await Promise.all([
  client.from('exercises').select('*').order('id').limit(1000).then(checked),
  client.from('chapters').select('*').order('order_index').limit(1000).then(checked),
  client.from('competences').select('*').order('id').limit(1000).then(checked),
 ]);
 assert(parents.length>0&&parents.length<1000);assert(chapters.length<1000&&competences.length<1000);
 const target=path.join(privateRoot,'catalogue-'+Date.now());await mkdir(target,{recursive:true});
 const snapshot=JSON.stringify({projectRef,exportedAt:new Date().toISOString(),parents,chapters,competences},null,2)+'\n';
 await writeFile(path.join(target,'source.private.json'),snapshot,{flag:'wx'});
 const proof={projectRef,directory:path.relative(root,target).replaceAll('\\','/'),sha256:createHash('sha256').update(snapshot).digest('hex'),parents:parents.length,legacy:parents.filter(r=>!r.catalog_id).length,chapters:chapters.length,competences:competences.length};
 await writeFile(path.join(privateRoot,'catalogue-current.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof,null,2));
}
