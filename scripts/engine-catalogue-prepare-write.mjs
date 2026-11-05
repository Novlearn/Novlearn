// Prepare an atomic import; never connect to a database from this script.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const pointer=JSON.parse(await readFile('.local/engine-staging/catalogue-current.json','utf8'));
assert.equal(pointer.projectRef,'tksvbkvfusrnxulpahky');
const work=path.resolve(pointer.directory);assert(work.startsWith(path.resolve('.local/engine-staging')+path.sep));
const digest=b=>createHash('sha256').update(b).digest('hex');
const sourceBytes=await readFile(path.join(work,'source.private.json'));
assert.equal(digest(sourceBytes),pointer.sha256);
const source=JSON.parse(sourceBytes);
const qualifiedBytes=await readFile(path.join(work,'qualified-final.private.json'));
const qualified=JSON.parse(qualifiedBytes);
const candidates=JSON.parse(await readFile(path.join(work,'candidates.private.json'),'utf8'));
assert.equal(qualified.sourceHash,pointer.sha256);assert.equal(qualified.projectRef,pointer.projectRef);
assert.equal(qualified.archiveSha256,'791c6472fc87ba0559d8889cf3f4482ab5466def49eec9e418ddbc2c7278f3ea');
assert.equal(qualified.rows.length,111);
const payload=qualified.rows.map(row=>{
 assert(row.ok&&row.instantiated&&row.qualified);
 assert.deepEqual(row.tests.map(t=>t.seed),[0,1,42,123,4294967295]);
 assert(row.tests.every(t=>t.generated&&t.publicProjection&&(t.seed!==42||t.replay)&&t.questions.every(q=>q.correct==='correct'&&q.wrong==='incorrect'&&q.empty==='invalid')));
 assert.deepEqual(row.definition,candidates.rows.find(c=>c.id===row.id).definition);
 const original=source.parents.find(p=>p.id===row.id);assert(original&&!original.catalog_id&&!original.active_version_id);
 assert.deepEqual(row.definition.extensions.legacy.original,original);
 return {exercise_id:row.id,original,definition:row.definition};
});
assert.equal(new Set(payload.map(p=>p.exercise_id)).size,111);
const body=JSON.stringify(payload),delimiter='$novlearn_staging_catalogue_20261102$';assert(!body.includes(delimiter));
const sql=`-- Qualified technical import of existing content, without editorial approval.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
LOCK TABLE public.exercises,public.exercise_versions,novlearn_admin_private.engine_legacy_imports IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE novlearn_admin_private.publication_operations IN SHARE ROW EXCLUSIVE MODE;
DO $checked$
DECLARE payload jsonb:=${delimiter}${body}${delimiter}::jsonb;
 item jsonb; parent public.exercises; version_id uuid; header jsonb; changed integer:=0;
BEGIN
 IF current_user<>'postgres' OR jsonb_array_length(payload)<>111 OR
   (SELECT count(DISTINCT (value->>'exercise_id')::bigint) FROM jsonb_array_elements(payload))<>111 OR
   (SELECT count(*) FROM public.exercises WHERE catalog_id IS NULL)<>111 THEN
   RAISE EXCEPTION 'Expected original Staging catalogue and database migration role';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM novlearn_admin_private.publication_runtime WHERE singleton AND NOT enabled
   AND engine_archive_sha256='${qualified.archiveSha256}') OR
   EXISTS(SELECT 1 FROM novlearn_admin_private.publication_operations WHERE state IN ('executing','uncertain')) OR
   EXISTS(SELECT 1 FROM public.duels WHERE status='active') THEN
   RAISE EXCEPTION 'Qualified disabled runtime, no pending publication or active duel required';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
   SELECT * INTO parent FROM public.exercises WHERE id=(item->>'exercise_id')::bigint FOR UPDATE;
   IF NOT FOUND OR parent.catalog_id IS NOT NULL OR parent.active_version_id IS NOT NULL OR parent.admin_archived_at IS NOT NULL
      OR (to_jsonb(parent)-'created_at') IS DISTINCT FROM ((item->'original')-'created_at')
      OR EXISTS(SELECT 1 FROM public.exercise_versions WHERE exercise_id=parent.id) THEN
     RAISE EXCEPTION 'Original changed or already converted: %',item->>'exercise_id';
   END IF;
   IF item->'definition'->'extensions'->'legacy'->'original' IS DISTINCT FROM item->'original' THEN
     RAISE EXCEPTION 'Private source provenance mismatch';
   END IF;
   header:=novlearn_admin_private.publication_header(item->'definition');
   INSERT INTO novlearn_admin_private.engine_legacy_imports(exercise_id,project_ref,source_sha256,original_sha256,
     definition_sha256,engine_archive_sha256,qualification_sha256,qualified_seeds)
   VALUES(parent.id,'${pointer.projectRef}','${pointer.sha256}',
     encode(extensions.digest(convert_to((item->'original')::text,'UTF8'),'sha256'),'hex'),
     encode(extensions.digest(convert_to((item->'definition')::text,'UTF8'),'sha256'),'hex'),
     '${qualified.archiveSha256}','${digest(qualifiedBytes)}',ARRAY[0,1,42,123,4294967295]::bigint[]);
   INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,
     canonicalization_version,definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
   VALUES(parent.id,1,item->'definition','schema-5;engine-0.1.0','mulberry32-rejection-v1','pg-jsonb-text-v1',
     repeat('0',64),repeat('0',64),'published','transfer',clock_timestamp()) RETURNING id INTO version_id;
   UPDATE public.exercises SET catalog_id=(item->'definition'->>'id')::uuid,active_version_id=version_id,content='{}'::jsonb,
     title=header->>'title',app_title=header->>'app_title',chapter=header->>'chapter',difficulty=header->>'difficulty',
     competences=ARRAY(SELECT jsonb_array_elements_text(header->'competences')),
     "Is_Flash"=(header->>'Is_Flash')::boolean,"Need_Calculator"=(header->>'Need_Calculator')::boolean WHERE id=parent.id;
   changed:=changed+1;
 END LOOP;
 IF changed<>111 OR EXISTS(SELECT 1 FROM public.exercises WHERE catalog_id IS NULL) OR
   (SELECT count(*) FROM public.exercises p JOIN novlearn_admin_private.engine_legacy_imports m ON m.exercise_id=p.id
    JOIN public.exercise_versions v ON v.id=p.active_version_id AND v.exercise_id=p.id
    WHERE p.content='{}'::jsonb AND v.editorial_status='published' AND v.publication_origin='transfer'
    AND v.definition_sha256=m.definition_sha256 AND v.approved_by IS NULL)<>111 THEN
   RAISE EXCEPTION 'Canonical activation verification failed';
 END IF;
END;
$checked$;
COMMIT;
SELECT count(*) AS converted_exercises FROM novlearn_admin_private.engine_legacy_imports;
`;
await writeFile(path.join(work,'activate.private.sql'),sql);
const proof={projectRef:pointer.projectRef,sourceHash:pointer.sha256,qualificationSha256:digest(qualifiedBytes),exercises:111,sqlSha256:digest(sql),archiveSha256:qualified.archiveSha256,status:'prepared',activation:'technical import; same identities; private originals; no human approval or signed receipt'};
await writeFile(path.join(work,'activation-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));
