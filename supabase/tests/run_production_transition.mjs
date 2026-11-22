// Local PostgreSQL rehearsal only. Uses two named, isolated Docker databases.
// No environment files, hosted URLs, production data or Admin source edits.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tag = randomUUID().replaceAll('-', '').slice(0, 12);
const targetContainer = 'novlearn-transition-20261113';
const sourceContainer = 'novlearn-catalogue-final-source';
const targetDB = `transition_target_${tag}`, sourceDB = `transition_source_${tag}`;
const work = path.resolve('.local/production-transition', tag);
mkdirSync(work, { recursive: true });
const proof = { tag, targetDB, sourceDB, postgres: '17.11', passed: [], limitations: [] };
const pass = name => { proof.passed.push(name); console.log(`PASS ${name}`); };
function docker(args, input) {
 const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
 if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Docker exit ${result.status}`);
 return result.stdout.trim();
}
const sql = (where, query, role = 'postgres') => docker(['exec','-i',where === 'source' ? sourceContainer : targetContainer,
 'psql','-X','-q','-At','-U','supabase_admin','-d',where === 'source' ? sourceDB : targetDB,'-v','ON_ERROR_STOP=1'],
 `SET ROLE ${role};\n${query}`);
const file = name => readFileSync(name, 'utf8');
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${lit(JSON.stringify(value))}::jsonb`;
const value = (where, query, role) => JSON.parse(sql(where, query, role).split('\n').at(-1));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function denied(where, query, role) { assert.throws(() => sql(where, query, role)); }
const inspect = (kind, id) => value('target',`SELECT novlearn_admin_private.inspect_catalogue_sync_item(${lit(kind)},${lit(id)})`,'novlearn_publication_executor');
const apply = (batch, hash, items) => value('target',`SELECT novlearn_admin_private.apply_catalogue_sync_batch(${lit(batch)},${lit(hash)},${json(items)})`,'novlearn_publication_executor');
const observe = (batch, hash) => value('target',`SELECT novlearn_admin_private.observe_catalogue_sync_batch(${lit(batch)},${lit(hash)})`,'novlearn_publication_executor');

try {
 docker(['exec',targetContainer,'createdb','-U','supabase_admin','-O','postgres',targetDB]);
 docker(['exec',sourceContainer,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',
  `CREATE DATABASE ${sourceDB} TEMPLATE admin_local OWNER postgres`]);
 sql('target',file('supabase/tests/fixtures/production_historical.sql'));
 sql('target',file('supabase/tests/fixtures/production_historical_statistics.sql'));
 sql('target',file('supabase/tests/fixtures/production_historical_readers.sql'));
 const owner=randomUUID(), chapter=randomUUID(), flashcard=randomUUID();
 const catalog={chapter:randomUUID(),competence:randomUUID(),flashcard:randomUUID(),exercise:randomUUID()};
 const legacyContent={variables:[],elements:[{id:1,type:'question',content:{question:'Calcul synthétique',correctAnswer:'2',answerFormat:'number'}}]};
 sql('target',`INSERT INTO auth.users VALUES(${lit(owner)});
 INSERT INTO profiles(id,role,email,first_name,birth_date) VALUES(${lit(owner)},'user','fixture@example.invalid','Fixture','2000-01-01');
 INSERT INTO chapters(id,name,order_index) VALUES(${lit(chapter)},'Synthetic historical chapter',1);
 INSERT INTO competences(id,chapter_id,name,max_points) VALUES('historical-skill',${lit(chapter)},'Synthetic skill',10);
 INSERT INTO exercises(title,chapter,difficulty,competences,content,"Is_Flash","Need_Calculator")
 VALUES('Historical synthetic exercise','Synthetic historical chapter','easy',ARRAY(SELECT 'unresolved-'||n FROM generate_series(1,27) n),${json(legacyContent)},true,false);
 INSERT INTO flashcards(id,chapter,question,answer) VALUES(${lit(flashcard)},'Synthetic historical chapter','Old question','Old answer'),
 (gen_random_uuid(),'missing chapter A','Preserve A','A'),(gen_random_uuid(),'missing chapter B','Preserve B','B');
 INSERT INTO exercise_attempts(user_id,exercise_id) VALUES(${lit(owner)},1),(${lit(owner)},NULL),(${lit(owner)},NULL);
 INSERT INTO user_competence_scores(user_id,competence_id) VALUES(${lit(owner)},'orphan-a'),(${lit(owner)},'orphan-b'),(${lit(owner)},'orphan-c');
 INSERT INTO duels(player1_id,status,exercise_id,exercise_data) VALUES(${lit(owner)},'active',1,${json(legacyContent)});`);
 const before = sql('target',`SELECT jsonb_build_object('exercises',(SELECT jsonb_agg(to_jsonb(e)) FROM exercises e),
 'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM exercise_attempts a),'duels',(SELECT jsonb_agg(to_jsonb(d)) FROM duels d),
 'scores',(SELECT jsonb_agg(to_jsonb(s)) FROM user_competence_scores s))`);
 const backup = docker(['exec',targetContainer,'pg_dump','-U','supabase_admin','-d',targetDB,'--no-owner']);
 writeFileSync(path.join(work,'before.sql'),backup);
 for (const name of ['001_prepare.sql','002_bind.sql','003_runtime.sql']) sql('target',file(`supabase/proposals/catalogue-production/${name}`));
 sql('target',file('supabase/migrations/20261112123000_catalogue_sync_target.sql'));
 sql('target',file('supabase/proposals/catalogue-production/004_readers.sql'));
 sql('target',file('supabase/proposals/catalogue-production/005_statistics.sql'));
 sql('target',file('supabase/proposals/catalogue-production/006_legacy_readers.sql'));
 assert.deepEqual(value('target',`SELECT public.get_random_exercise('Synthetic historical chapter','easy')->'content'`),legacyContent);
 assert.equal(sql('target',`SELECT set_config('request.jwt.claim.sub',${lit(owner)},false); SELECT total_exercises FROM get_chapters_with_count(${lit(owner)})`).split('\n').at(-1),'1');
 assert.equal(sql('target',`SELECT count(*) FROM exercise_attempts WHERE exercise_version_id IS NOT NULL`),'0');
 pass('old SQL reader + additive preparation + unchanged old attempts');

 const rows=value('target',`SELECT jsonb_build_object('exercise',to_jsonb(e),'chapter',to_jsonb(c),'competence',to_jsonb(co),'flashcard',to_jsonb(f))
 FROM exercises e CROSS JOIN chapters c CROSS JOIN competences co CROSS JOIN flashcards f WHERE e.id=1 AND f.id=${lit(flashcard)}`);
 const fpExpr=(kind,r)=>kind==='exercise'?`novlearn_admin_private.historical_projection(${json(r)})`:
  kind==='chapter'?`jsonb_build_object('name',${json(r)}->'name','aliases',${json(r)}->'aliases','emoji',${json(r)}->'emoji','order_index',${json(r)}->'order_index')`:
  kind==='competence'?`jsonb_build_object('chapter_id',${json(r)}->'chapter_id','name',${json(r)}->'name','max_points',${json(r)}->'max_points')`:
  `jsonb_build_object('chapter',${json(r)}->'chapter','question',${json(r)}->'question','answer',${json(r)}->'answer')`;
 const mapping=Object.entries(rows).map(([kind,r])=>({kind,productionId:String(r.id),stagingCatalogId:catalog[kind],approved:true,
  evidence:'Synthetic exact provenance, operator review for this test only',sourceProvenanceVerified:true,originalId:String(r.id),
  historicalFingerprint:sql('target',`SELECT encode(extensions.digest(convert_to((${fpExpr(kind,r)})::text,'UTF8'),'sha256'),'hex')`)}));
 const manifest={approved:true,reviewer:'synthetic-local-reviewer',sourceProject:'tksvbkvfusrnxulpahky',targetProject:'abwipnppcrghdhwriyjp',items:mapping};
 denied('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json({...manifest,approved:false})})`);
 denied('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json({...manifest,items:[...mapping,{...mapping[0]}]})})`);
 denied('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json({...manifest,items:[{...mapping[0],historicalFingerprint:'0'.repeat(64)}]})})`);
 sql('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json(manifest)})`);
 sql('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json(manifest)})`);
 pass('review-only manifest rejected; stale/duplicate rejected; explicit binding idempotent');
 const def=JSON.parse(file('frontend/__tests__/fixtures/engine-pilot-definition.json'));
 def.id=catalog.exercise; def.catalogue={...def.catalogue,chapter:'Synthetic historical chapter',skills:['historical-skill'],exerciseType:'flash'};
 def.extensions={legacy:{adapterVersion:'staging-catalogue-reviewed-v1',original:rows.exercise}};
 const historicalVersion=sql('target',`SELECT novlearn_admin_private.prepare_historical_execution(1,${lit(mapping.find(x=>x.kind==='exercise').historicalFingerprint)},${json(def)})`);
 assert.equal(sql('target',`SELECT revision FROM exercise_versions WHERE id=${lit(historicalVersion)}`),'0');
 sql('target',`INSERT INTO duel_catalog_reservations(duel_id,exercise_id,exercise_version_id) VALUES(1,1,${lit(historicalVersion)})`,'service_role');
 const session=randomUUID();
 sql('target',`INSERT INTO engine_exercise_sessions(id,owner_id,exercise_id,exercise_version_id,definition_sha256,official,public_instance,metadata)
 VALUES(${lit(session)},${lit(owner)},1,${lit(historicalVersion)},repeat('a',64),'{"generation":{"seed":"42","version":"mulberry32-rejection-v1"}}','{}','{"mode":"practice"}')`,'service_role');
 pass('historical execution revision 0 and duel reservation before synchronization');
 const dependencies=[{kind:'chapter',catalogId:catalog.chapter,sourceRef:'source-chapter'},
 {kind:'competence',catalogId:catalog.competence,sourceId:'source-skill'}];
 const sourceDef=structuredClone(def); sourceDef.title='Explicit source revision one';
 sourceDef.catalogue.difficulty=3;
 sourceDef.catalogue.chapter='source-chapter'; sourceDef.catalogue.skills=['source-skill'];
 const payload=(kind,data,deps=[])=>({kind,catalogId:catalog[kind],fingerprint:digest(data),action:'upsert',
 versionId:kind==='exercise'?randomUUID():null,revision:kind==='exercise'?1:null,dependencies:deps,data});
 const payloads=[payload('exercise',{catalogId:catalog.exercise,revision:1,definition:sourceDef,
 header:{title:'ignored',chapter:'ignored',difficulty:'easy',competences:[],appTitle:'ignored',isFlash:true,needCalculator:false}},dependencies),
 payload('flashcard',{catalogId:catalog.flashcard,question:'Confirmed question',answer:'Confirmed answer',chapterCatalogId:catalog.chapter},[dependencies[0]]),
 payload('competence',{catalogId:catalog.competence,id:'source-skill',name:'Confirmed skill',chapterCatalogId:catalog.chapter,maxPoints:12},[dependencies[0]]),
 payload('chapter',{catalogId:catalog.chapter,name:'Synthetic historical chapter',aliases:[],emoji:'📚',orderIndex:1})];
 const items=payloads.map(p=>({payload:p,inspection:inspect(p.kind,p.catalogId)}));
 const batch=randomUUID(),hash=digest(items);
 assert.equal(sql('target','SELECT title FROM exercises WHERE id=1'),'Historical synthetic exercise');
 assert.equal(sql('target',`SELECT question FROM flashcards WHERE id=${lit(flashcard)}`),'Old question');
 const receipt=apply(batch,hash,items);
 assert.deepEqual(apply(batch,hash,items),receipt);
 assert.equal(observe(batch,hash).state,'committed');
 assert.equal(sql('target','SELECT count(*) FROM exercises'),'1');
 assert.equal(sql('target','SELECT title FROM exercises WHERE id=1'),'Explicit source revision one');
 assert.equal(sql('target',`SELECT question FROM flashcards WHERE id=${lit(flashcard)}`),'Confirmed question');
 assert.deepEqual(value('target','SELECT content FROM exercises WHERE id=1'),legacyContent);
 assert.equal(sql('target','SELECT count(*) FROM exercise_versions'),'2');
 assert.equal(sql('target','SELECT count(*) FROM exercise_attempts WHERE exercise_version_id IS NOT NULL'),'0');
 assert.equal(sql('target','SELECT count(*) FROM user_competence_scores'),'3');
 pass('mixed first import on existing PKs, preserved payload/activity, source revision 1 differs from history');
 const activeVersion=sql('target','SELECT active_version_id FROM exercises WHERE id=1');
 sql('target',`INSERT INTO exercise_attempts(user_id,exercise_id,exercise_version_id) VALUES(${lit(owner)},1,${lit(activeVersion)})`,'service_role');
 assert.equal(sql('target','SELECT count(*) FROM exercise_attempts WHERE exercise_version_id IS NULL'),'3');
 pass('only new attempts reference explicit synchronized version');
 denied('target',`SELECT novlearn_admin_private.apply_catalogue_sync_batch(${lit(batch)},repeat('0',64),${json(items)})`,'novlearn_publication_executor');
 const conflict=structuredClone(items); conflict[0].payload.data.definition.title='Conflicting source revision';
 for(const item of conflict)item.inspection=inspect(item.payload.kind,item.payload.catalogId);
 const conflictBatch=randomUUID(),conflictHash=digest(conflict);
 denied('target',`SELECT novlearn_admin_private.apply_catalogue_sync_batch(${lit(conflictBatch)},${lit(conflictHash)},${json(conflict)})`,'novlearn_publication_executor');
 assert.equal(observe(conflictBatch,conflictHash).state,'not_applied');
 assert.equal(sql('target','SELECT count(*) FROM novlearn_admin_private.catalogue_sync_target_receipts'),'1');
 pass('idempotence, divergent digest, immutable revision conflict and atomic rollback');
 const archive={kind:'exercise',catalogId:catalog.exercise,fingerprint:'b'.repeat(64),action:'archive',versionId:randomUUID(),revision:1,definition:sourceDef,dependencies:[]};
 apply(randomUUID(),'c'.repeat(64),[{payload:archive,inspection:inspect('exercise',catalog.exercise)}]);
 assert.equal(sql('target','SELECT count(*) FROM exercises','anon'),'0');
 assert.equal(sql('target',`SELECT public.get_random_exercise('Synthetic historical chapter','easy') IS NULL`),'t');
 denied('target','SELECT definition FROM exercise_versions','anon');
 sql('target',`INSERT INTO duel_exercise_instances(duel_id,round_number,exercise_id,exercise_version_id,instance_seed,generation_version,replay_data)
 VALUES(1,1,1,${lit(historicalVersion)},'42','mulberry32-rejection-v1','{"official":"initial snapshot"}')`,'service_role');
 sql('target',`SELECT engine_transition_session(${lit(session)},${lit(owner)},0,'{"questions":{},"correct":true}','completed')`,'service_role');
 assert.equal(sql('target',`SELECT exercise_version_id FROM exercise_attempts WHERE id=(SELECT attempt_id FROM engine_exercise_sessions WHERE id=${lit(session)})`),historicalVersion);
 assert.equal(sql('target',`SELECT score FROM monthly_scores WHERE user_id=${lit(owner)}`),'1');
 assert.equal(sql('target',`SELECT total_attempts FROM user_stats WHERE user_id=${lit(owner)}`),'5');
 denied('target',`INSERT INTO duel_catalog_reservations VALUES(1,1,${lit(activeVersion)},now())`,'service_role');
 pass('archive blocks new starts; pre-transition session and duel finish on initial snapshot/version');
 for(const role of ['anon','authenticated','service_role']) {
  denied('target','SELECT * FROM novlearn_admin_private.catalogue_sync_target_receipts',role);
  denied('target',`SELECT novlearn_admin_private.bind_historical_catalogue(${json(manifest)})`,role);
  denied('target',`SELECT novlearn_admin_private.apply_catalogue_sync_batch(${lit(randomUUID())},repeat('a',64),'[]')`,role);
 }
 assert.equal(sql('target','SELECT novlearn_catalog_is_staging()'),'f');
 pass('target RLS, private capabilities and Production environment separation');
 sql('target',file('supabase/tests/catalogue_historical_guards.sql'),'supabase_admin');
 pass('writer cannot erase content, change PK or insert legacy payload; no retained SET/bypass privilege');
 // Existing comprehensive target contract regression, using fresh identities.
 let qualification=file('supabase/tests/catalogue_sync_target_qualification.sql');
 const replaced=new Map();
 qualification=qualification.replace(/f[1-7]000000-[0-9a-f-]{27}/g,s=>{if(!replaced.has(s))replaced.set(s,randomUUID());return replaced.get(s);});
 sql('target',qualification);
 pass('canonical target qualification: dependency order, stale state, rollback and permissions');
 const restoreDB=`transition_restore_${tag}`;
 docker(['exec',targetContainer,'createdb','-U','supabase_admin',restoreDB]);
 docker(['exec','-i',targetContainer,'psql','-X','-q','-U','supabase_admin','-d',restoreDB,'-v','ON_ERROR_STOP=1'],backup);
 const restored=docker(['exec',targetContainer,'psql','-X','-q','-At','-U','supabase_admin','-d',restoreDB,'-c',
 `SELECT jsonb_build_object('exercises',(SELECT jsonb_agg(to_jsonb(e)) FROM exercises e),'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM exercise_attempts a),
 'duels',(SELECT jsonb_agg(to_jsonb(d)) FROM duels d),'scores',(SELECT jsonb_agg(to_jsonb(s)) FROM user_competence_scores s))`]);
 assert.deepEqual(JSON.parse(restored),JSON.parse(before));
 pass('pg_dump restored into separate database; exact historical rows and activity rollback');
 // Local clone retains canonical source contracts; no target capability added.
 // The old local fixture was restored as supabase_admin. Normalize only this
 // disposable clone to the ownership observed on managed Staging.
 sql('source',`ALTER SCHEMA novlearn_catalog_sync OWNER TO postgres;
 ALTER TABLE novlearn_catalog_sync.runtime OWNER TO postgres;
 ALTER FUNCTION public.novlearn_catalog_is_staging() OWNER TO postgres;`,'supabase_admin');
 sql('source',file('supabase/migrations/20261113101533_catalogue_sync_runtime_rls.sql'));
 sql('source','CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions');
 const tap=sql('source',`SET search_path=public,extensions;\n${file('supabase/tests/catalogue_sync_runtime_rls.sql')}`);
 writeFileSync(path.join(work,'runtime-rls.tap'),tap);
 assert(!tap.includes('not ok'),tap); assert(tap.includes('1..22'),tap);
 assert.equal(sql('source',`SELECT to_regprocedure('novlearn_admin_private.apply_catalogue_sync_batch(uuid,text,jsonb)') IS NULL`),'t');
 pass('real PostgreSQL pgTAP 22 assertions after 20261113101533; source has no target importer');
 // Source -> target -> journal, with the actual canonical RPCs and role ACLs.
 const admin=randomUUID(), sourceChapter=randomUUID(), sourceCatalog=randomUUID();
 sql('source',`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${lit(admin)},${lit(`fixture-${tag}@example.invalid`)},
 '{"first_name":"Synthetic","last_name":"Fixture","birth_date":"2000-01-01"}');
 UPDATE profiles SET role='admin' WHERE id=${lit(admin)};
 INSERT INTO chapters(id,catalog_id,name,order_index) VALUES(${lit(sourceChapter)},${lit(sourceCatalog)},${lit(`Source fixture ${tag}`)},9977);`,'supabase_admin');
 const actor=(query,role='authenticated')=>sql('source',`SELECT set_config('request.jwt.claim.sub',${lit(admin)},false);
 SELECT set_config('request.jwt.claims','{"iss":"https://tksvbkvfusrnxulpahky.supabase.co/auth/v1"}',false);
 ${query}`,role).split('\n').at(-1);
 let ready=JSON.parse(actor(`SELECT public.admin_get_catalog_item_readiness('chapter',${lit(sourceCatalog)})`));
 actor(`SELECT public.admin_set_catalog_item_ready('chapter',${lit(sourceCatalog)},${lit(ready.fingerprint)})`);
 ready=JSON.parse(actor(`SELECT public.admin_get_catalog_item_readiness('chapter',${lit(sourceCatalog)})`));
 const sourceBatch=randomUUID();
 actor(`SELECT public.admin_prepare_catalogue_sync_operation(${lit(sourceBatch)},'chapter',${lit(sourceCatalog)},${lit(ready.fingerprint)},'local-transition',${json(inspect('chapter',sourceCatalog))})`);
 const batchDigest=actor(`SELECT novlearn_admin_private.catalogue_sync_batch_digest(${lit(sourceBatch)})`,'novlearn_publication_journal_executor');
 actor(`SELECT novlearn_admin_private.claim_catalogue_sync_batch(${lit(admin)},${lit(sourceBatch)},${lit(batchDigest)})`,'novlearn_publication_journal_executor');
 const sourceItem=value('source',`SELECT jsonb_build_object('payload',payload,'inspection',inspection) FROM novlearn_admin_private.publication_operations WHERE batch_id=${lit(sourceBatch)}`,'supabase_admin');
 const sourceHash=digest([sourceItem]);
 apply(sourceBatch,sourceHash,[sourceItem]); // COMMIT really occurred; discard response.
 const countBefore=sql('target','SELECT count(*) FROM novlearn_admin_private.catalogue_sync_target_receipts');
 const observation=observe(sourceBatch,sourceHash);
 assert.equal(observation.state,'committed');
 actor(`SELECT novlearn_admin_private.record_catalogue_sync_batch(${lit(admin)},${lit(sourceBatch)},${lit(batchDigest)},'executing','committed',${json(observation.receipt)},NULL)`,'novlearn_publication_journal_executor');
 assert.equal(sql('target','SELECT count(*) FROM novlearn_admin_private.catalogue_sync_target_receipts'),countBefore);
 assert.equal(sql('source',`SELECT state FROM novlearn_admin_private.publication_operations WHERE batch_id=${lit(sourceBatch)}`,'supabase_admin'),'committed');
 pass('source integration after RLS: human ready, claim, real COMMIT response loss, observation/finalization without reimport');
 sql('source',`UPDATE chapters SET emoji='🧪' WHERE catalog_id=${lit(sourceCatalog)}`,'supabase_admin');
 assert.equal(sql('source',`SELECT editorial_status FROM chapters WHERE catalog_id=${lit(sourceCatalog)}`,'supabase_admin'),'draft');
 assert.equal(sql('target',`SELECT emoji FROM chapters WHERE catalog_id=${lit(sourceCatalog)}`),'📚');
 ready=JSON.parse(actor(`SELECT public.admin_get_catalog_item_readiness('chapter',${lit(sourceCatalog)})`));
 actor(`SELECT public.admin_set_catalog_item_ready('chapter',${lit(sourceCatalog)},${lit(ready.fingerprint)})`);
 ready=JSON.parse(actor(`SELECT public.admin_get_catalog_item_readiness('chapter',${lit(sourceCatalog)})`));
 const neverBatch=randomUUID(),neverHash='d'.repeat(64);
 actor(`SELECT public.admin_prepare_catalogue_sync_operation(${lit(neverBatch)},'chapter',${lit(sourceCatalog)},${lit(ready.fingerprint)},'local-transition',${json(inspect('chapter',sourceCatalog))})`);
 const neverDigest=actor(`SELECT novlearn_admin_private.catalogue_sync_batch_digest(${lit(neverBatch)})`,'novlearn_publication_journal_executor');
 actor(`SELECT novlearn_admin_private.claim_catalogue_sync_batch(${lit(admin)},${lit(neverBatch)},${lit(neverDigest)})`,'novlearn_publication_journal_executor');
 actor(`SELECT novlearn_admin_private.record_catalogue_sync_batch(${lit(admin)},${lit(neverBatch)},${lit(neverDigest)},'executing','uncertain',NULL,NULL)`,'novlearn_publication_journal_executor');
 assert.throws(()=>actor(`SELECT novlearn_admin_private.record_catalogue_sync_batch(${lit(admin)},${lit(neverBatch)},${lit(neverDigest)},'uncertain','failed',NULL,'target_rejected')`,'novlearn_publication_journal_executor'));
 assert.equal(observe(neverBatch,neverHash).state,'not_applied');
 actor(`SELECT novlearn_admin_private.record_catalogue_sync_batch(${lit(admin)},${lit(neverBatch)},${lit(neverDigest)},'uncertain','failed',NULL,'not_applied')`,'novlearn_publication_journal_executor');
 pass('source draft leaves target untouched; uncertain closes negatively only after target not_applied observation');
 proof.limitations.push('Managed Production Engine host and approved historical definitions are separate activation prerequisites.');
 proof.result='passed';
} catch(error) {
 proof.result='failed'; proof.error=String(error.message); throw error;
} finally {
 writeFileSync(path.join(work,'proof.json'),JSON.stringify(proof,null,2)+'\n');
 writeFileSync('.local/production-transition/latest.json',JSON.stringify({work,...proof},null,2)+'\n');
}
