// Real PostgreSQL/PostgREST and real isolated Engine. Only verified identity is
// injected here; auth/origin denial is covered separately by the route suite.
import {expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[],set:()=>{}})}));
const fixture=vi.hoisted(()=>({owner:process.env.TRANSITION_OWNER!,rest:process.env.TRANSITION_REST!,key:process.env.TRANSITION_SERVICE_KEY!}));
vi.mock('@supabase/supabase-js',async original=>{
 const real=await original<typeof import('@supabase/supabase-js')>();
 return {...real,createClient:()=>{
  const client=real.createClient(fixture.rest,fixture.key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}});
  client.auth.getUser=vi.fn().mockResolvedValue({data:{user:{id:fixture.owner,is_anonymous:false}},error:null});
  return client;
 }};
});
function localFetch(input:RequestInfo|URL,init?:RequestInit) {
 const url=new URL(String(input));url.pathname=url.pathname.replace(/^\/rest\/v1/,'');
 return fetch(url,init);
}
import {handleLearnerExercise} from '../app/lib/engine/learner';
import {prepareEngineRound} from '../../duel-server/src/engine';
const nativeFetch=globalThis.fetch;
vi.stubGlobal('fetch',(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input));
 if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Non-local request forbidden by rehearsal');
 return nativeFetch(input,init);
});
const sql=(q:string)=>{
 const r=spawnSync('docker',['exec','-i','novlearn-transition-20261113','psql','-X','-q','-At','-U','supabase_admin','-d',process.env.TRANSITION_DB!,'-v','ON_ERROR_STOP=1'],
 {input:'SET ROLE postgres;\n'+q,encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();
};
const literal=(v:unknown)=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const req=(body:unknown)=>new Request('https://novlearn.fr/api/exercises',{method:'PATCH',headers:{origin:'https://novlearn.fr',authorization:'Bearer synthetic-verified','content-type':'application/json'},body:JSON.stringify(body)});
it('opens unsynchronized history, persists an Engine verdict and finishes the original session after archival',async()=>{
 const content={variables:[],elements:[{id:1,type:'question',content:{question:'Synthetic question',correctAnswer:'2'}}]};
 const exercise=sql(`INSERT INTO exercises(title,chapter,difficulty,competences,content,"Is_Flash","Need_Calculator")
 VALUES('Local historical application','Local chapter','easy','{}',${literal(content)},true,false) RETURNING id`);
 const original=JSON.parse(sql(`SELECT to_jsonb(e) FROM exercises e WHERE id=${exercise}`));
 const definition=JSON.parse(readFileSync(new URL('../__tests__/fixtures/engine-pilot-definition.json',import.meta.url),'utf8'));
 definition.id=randomUUID();definition.catalogue.skills=[];definition.catalogue.chapter='Local chapter';
 definition.elements=[{id:'q',type:'question',text:'Calculer 4/2',points:1,response:{format:'latex',kind:'rational'},expectedLatex:'4/2',policy:{domain:'rational',form:'value-only'}}];
 definition.extensions={legacy:{adapterVersion:'staging-catalogue-reviewed-v1',original}};
 sql(`INSERT INTO novlearn_admin_private.historical_exercise_snapshots(exercise_id,original,fingerprint)
 SELECT id,to_jsonb(e),encode(extensions.digest(convert_to(novlearn_admin_private.historical_projection(to_jsonb(e))::text,'UTF8'),'sha256'),'hex')
 FROM exercises e WHERE id=${exercise}`);
 const version=sql(`SELECT novlearn_admin_private.prepare_historical_execution(${exercise},
 (SELECT fingerprint FROM novlearn_admin_private.historical_exercise_snapshots WHERE exercise_id=${exercise}),${literal(definition)})`);
 expect(version).toBeTruthy();
 const opened=await handleLearnerExercise(req({action:'open',exerciseId:exercise}));
 expect(opened.status,await opened.clone().text()).toBe(200);
 const body=await opened.json();expect(body.session.versionId).toBe(version);
 expect(JSON.stringify(body)).not.toMatch(/"(official|expected|policy|generation)":/);
 const duel=Number(sql(`INSERT INTO duels(player1_id,status,exercise_id,exercise_data)
 VALUES('${fixture.owner}','active',${exercise},${literal(content)}) RETURNING id`));
 sql(`INSERT INTO duel_catalog_reservations(duel_id,exercise_id,exercise_version_id) VALUES(${duel},${exercise},'${version}')`);
 const row={id:Number(exercise),title:'Local historical application',chapter:'Local chapter',difficulty:'easy'};
 const firstRound=await prepareEngineRound(row,duel,1,version);
 expect(firstRound.questionId).toBe('q');
 sql(`UPDATE exercises SET admin_archived_at=now() WHERE id=${exercise}`);
 const secondRound=await prepareEngineRound(row,duel,2,version);
 expect(secondRound.official.definition).toEqual(firstRound.official.definition);
 expect(sql(`SELECT count(*) FROM duel_exercise_instances WHERE duel_id=${duel} AND exercise_version_id='${version}'`)).toBe('2');
 expect((await handleLearnerExercise(req({action:'open',exerciseId:exercise}))).status).toBe(404);
 const resumed=await handleLearnerExercise(req({action:'resume',sessionId:body.session.sessionId}));
 expect((await resumed.json()).session.instance).toEqual(body.session.instance);
 const answer=await handleLearnerExercise(req({action:'answer',sessionId:body.session.sessionId,questionId:'q',answer:{format:'latex',source:'2'}}));
 expect(answer.status,await answer.clone().text()).toBe(200);
 const completed=await answer.json();expect(completed.session.status).toBe('completed');expect(completed.session.correct).toBe(true);
 expect(sql(`SELECT exercise_version_id FROM exercise_attempts WHERE id=(SELECT attempt_id FROM engine_exercise_sessions WHERE id='${body.session.sessionId}')`)).toBe(version);
});
it('keeps unprepared historical content out of Engine and refuses starts when disabled',async()=>{
 const exercise=sql(`INSERT INTO exercises(title,chapter,content) VALUES('Unprepared','Local chapter','{}') RETURNING id`);
 expect((await handleLearnerExercise(req({action:'open',exerciseId:exercise}))).status).toBe(404);
 vi.stubEnv('NOVLEARN_ENGINE_ENABLED','false');
 try{expect((await handleLearnerExercise(req({action:'open',exerciseId:exercise}))).status).toBe(503);}
 finally{vi.unstubAllEnvs();}
});
it('enforces the same archive availability through the public database reader',async()=>{
 const real=await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
 const anon=real.createClient(fixture.rest,process.env.TRANSITION_ANON_KEY!,{auth:{persistSession:false},global:{fetch:localFetch}});
 const result=await anon.from('exercises').select('id').not('admin_archived_at','is',null);
 expect(result.error).toBeNull();expect(result.data).toEqual([]);
});
