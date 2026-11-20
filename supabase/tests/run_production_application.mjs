// Local application qualification against the latest isolated rehearsal DB.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID,createHmac} from 'node:crypto';
import path from 'node:path';
import {startLocalEngine} from '../../scripts/engine-pilot-local-engine.mjs';
const rehearsal=JSON.parse(readFileSync('.local/production-transition/latest.json','utf8'));
assert.equal(rehearsal.result,'passed');
assert.match(rehearsal.targetDB,/^transition_target_[a-f0-9]{12}$/);
const owner=randomUUID(),tag=randomUUID().replaceAll('-','').slice(0,12),role=`transition_rest_${tag}`;
const container=`novlearn-transition-rest-${tag}`;
const work=path.resolve('.local/engine-staging',`production-transition-${tag}`);mkdirSync(work,{recursive:true});
const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
run(['exec','-i','novlearn-transition-20261113','psql','-X','-q','-U','supabase_admin','-d',rehearsal.targetDB,'-v','ON_ERROR_STOP=1'],
 `CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD 'synthetic-local-only'; GRANT anon,authenticated,service_role TO ${role};
 SET ROLE postgres; INSERT INTO auth.users VALUES('${owner}');
 INSERT INTO profiles(id,email,first_name,birth_date) VALUES('${owner}','application@example.invalid','Fixture','2000-01-01');`);
const secret='synthetic-isolated-rehearsal-jwt-secret-20261113';
const jwt=role=>{const prefix=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+
 Buffer.from(JSON.stringify({role,ref:'abwipnppcrghdhwriyjp',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 return prefix+'.'+createHmac('sha256',secret).update(prefix).digest('base64url');};
let host;
try {
 run(['run','-d','--name',container,'--link','novlearn-transition-20261113:db','-p','127.0.0.1:55446:3000',
  '-e',`PGRST_DB_URI=postgresql://${role}:synthetic-local-only@db:5432/${rehearsal.targetDB}`,
  '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,
  'public.ecr.aws/supabase/postgrest:v14.18']);
 let ready=false;
 for(let i=0;i<40;i++){
  try{const r=await fetch('http://127.0.0.1:55446/');if(r.ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert(ready,'local PostgREST unavailable');
 host=await startLocalEngine(work,{port:3155});
 const env={...process.env,APP_ENV:'production',NODE_ENV:'test',NOVLEARN_ENGINE_ENABLED:'true',PRODUCTION_CATALOG_SYNC_ENFORCED:'false',
 NEXT_PUBLIC_SUPABASE_URL:'https://abwipnppcrghdhwriyjp.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:jwt('anon'),
 NEXT_PUBLIC_SITE_URL:'https://novlearn.fr',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),
 SUPABASE_URL:'https://abwipnppcrghdhwriyjp.supabase.co',SUPABASE_SERVICE_KEY:jwt('service_role'),
 ENGINE_URL:host.environment.NOVLEARN_ENGINE_LOCAL_URL,ENGINE_TOKEN:host.environment.NOVLEARN_ENGINE_LOCAL_CAPABILITY,
 TRANSITION_OWNER:owner,TRANSITION_DB:rehearsal.targetDB,TRANSITION_REST:'http://127.0.0.1:55446',
 TRANSITION_SERVICE_KEY:jwt('service_role'),TRANSITION_ANON_KEY:jwt('anon')};
 const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','vitest.transition.config.ts'],
  {cwd:path.resolve('frontend'),env,stdio:'inherit',windowsHide:true});
 const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 writeFileSync(path.join(rehearsal.work,'application-proof.json'),JSON.stringify({status,tag,targetDB:rehearsal.targetDB,
  engineArchive:'6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a',
  database:'real PostgreSQL 17.11 + PostgREST 14.18',identity:'injected verified identity; no hosted request'},null,2));
 assert.equal(status,0,'application qualification failed');
} finally {
 if(host)await host.close();
 run(['rm','-f',container]);
}
