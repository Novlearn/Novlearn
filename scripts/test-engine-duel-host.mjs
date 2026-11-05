// Real private Engine transport and duel authority, with synthetic users and DB writes mocked.
import {mkdir} from 'node:fs/promises';import {spawn} from 'node:child_process';import path from 'node:path';import {startLocalEngine} from './engine-pilot-local-engine.mjs';
const work=path.resolve('.local/engine-staging/duel-host-'+Date.now());await mkdir(work,{recursive:true});
const host=await startLocalEngine(work);
try{
 const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','vitest.engine-host.config.ts'],{cwd:path.resolve('duel-server'),env:{...process.env,...host.environment,SUPABASE_URL:'https://tksvbkvfusrnxulpahky.supabase.co',NOVLEARN_ENGINE_ENABLED:'true'},stdio:'inherit',windowsHide:true});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{await host.close();}
