BEGIN;
SET LOCAL lock_timeout = '5s';

-- Target-side capability. The source journal remains the only workflow state;
-- this small table is solely the durable target commit receipt.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='novlearn_catalogue_sync_writer') THEN
    CREATE ROLE novlearn_catalogue_sync_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    IF EXISTS(SELECT FROM pg_roles WHERE rolname='novlearn_catalogue_sync_writer' AND
      (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'existing target writer has unsafe attributes; reconcile first';
    END IF;
  END IF;
END;
$roles$;

-- Supabase's postgres is not a superuser. Function ownership transfer needs a
-- temporary SET membership; never retain it as an execution bypass.
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_auth_members WHERE roleid='novlearn_catalogue_sync_writer'::regrole
      AND member='postgres'::regrole AND (inherit_option OR set_option)) THEN
    RAISE EXCEPTION 'unexpected pre-existing target writer membership; reconcile first';
  END IF;
END $$;
GRANT novlearn_catalogue_sync_writer TO postgres WITH INHERIT FALSE, SET TRUE;

CREATE TABLE novlearn_admin_private.catalogue_sync_target_receipts (
  batch_id uuid PRIMARY KEY,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE novlearn_admin_private.catalogue_sync_target_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON novlearn_admin_private.catalogue_sync_target_receipts FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_executor;

GRANT USAGE ON SCHEMA public,extensions,novlearn_admin_private TO novlearn_catalogue_sync_writer;
GRANT SELECT(singleton,engine_contract,generation_version,canonicalization_version)
  ON novlearn_admin_private.publication_runtime TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_sync_writer_runtime ON novlearn_admin_private.publication_runtime
  FOR SELECT TO novlearn_catalogue_sync_writer USING (true);
GRANT SELECT,INSERT ON novlearn_admin_private.catalogue_sync_target_receipts TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_target_writer_receipts ON novlearn_admin_private.catalogue_sync_target_receipts
  FOR ALL TO novlearn_catalogue_sync_writer USING (true) WITH CHECK (true);

GRANT SELECT(id,catalog_id,name,order_index,aliases,emoji,admin_archived_at,editorial_status,synced_fingerprint_sha256)
  ON public.chapters TO novlearn_catalogue_sync_writer;
GRANT INSERT(catalog_id,name,order_index,aliases,emoji,editorial_status,admin_archived_at,synced_fingerprint_sha256,synced_at)
  ON public.chapters TO novlearn_catalogue_sync_writer;
GRANT UPDATE(name,order_index,aliases,emoji,admin_archived_at,editorial_status,ready_at,ready_by,synced_fingerprint_sha256,synced_at)
  ON public.chapters TO novlearn_catalogue_sync_writer;
GRANT UPDATE ON public.chapters TO novlearn_catalogue_sync_writer;
GRANT SELECT ON public.chapters TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_target_writer_chapters ON public.chapters
  FOR ALL TO novlearn_catalogue_sync_writer USING (catalog_id IS NOT NULL) WITH CHECK (catalog_id IS NOT NULL);

GRANT SELECT(id,catalog_id,chapter_id,name,max_points,admin_archived_at,editorial_status,synced_fingerprint_sha256)
  ON public.competences TO novlearn_catalogue_sync_writer;
GRANT INSERT(id,catalog_id,chapter_id,name,max_points,editorial_status,admin_archived_at,synced_fingerprint_sha256,synced_at)
  ON public.competences TO novlearn_catalogue_sync_writer;
GRANT UPDATE(chapter_id,name,max_points,admin_archived_at,editorial_status,ready_at,ready_by,synced_fingerprint_sha256,synced_at)
  ON public.competences TO novlearn_catalogue_sync_writer;
GRANT UPDATE ON public.competences TO novlearn_catalogue_sync_writer;
GRANT SELECT ON public.competences TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_target_writer_competences ON public.competences
  FOR ALL TO novlearn_catalogue_sync_writer USING (catalog_id IS NOT NULL) WITH CHECK (catalog_id IS NOT NULL);

GRANT SELECT(id,catalog_id,chapter,question,answer,admin_archived_at,editorial_status,synced_fingerprint_sha256)
  ON public.flashcards TO novlearn_catalogue_sync_writer;
GRANT INSERT(catalog_id,chapter,question,answer,editorial_status,admin_archived_at,synced_fingerprint_sha256,synced_at)
  ON public.flashcards TO novlearn_catalogue_sync_writer;
GRANT UPDATE(chapter,question,answer,admin_archived_at,editorial_status,ready_at,ready_by,synced_fingerprint_sha256,synced_at)
  ON public.flashcards TO novlearn_catalogue_sync_writer;
GRANT UPDATE ON public.flashcards TO novlearn_catalogue_sync_writer;
GRANT SELECT ON public.flashcards TO novlearn_catalogue_sync_writer;
-- The historical PUBLIC policy reads profiles directly. Re-express the same
-- admin-only rule through the existing SECURITY DEFINER helper so its check
-- remains valid under the bounded writer role without granting profile access.
DROP POLICY IF EXISTS "Flashcards admin write" ON public.flashcards;
CREATE POLICY "Flashcards admin write" ON public.flashcards FOR ALL TO authenticated
  USING ((SELECT public.is_novlearn_admin()))
  WITH CHECK ((SELECT public.is_novlearn_admin()));
CREATE POLICY catalogue_target_writer_flashcards ON public.flashcards
  FOR ALL TO novlearn_catalogue_sync_writer USING (catalog_id IS NOT NULL) WITH CHECK (catalog_id IS NOT NULL);

GRANT SELECT(id,catalog_id,active_version_id,admin_archived_at,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",publication_epoch)
  ON public.exercises TO novlearn_catalogue_sync_writer;
DO $exercise_content_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.exercises'::regclass
      AND attname='content' AND NOT attisdropped) THEN
    EXECUTE 'GRANT INSERT(id,catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",content) ON public.exercises TO novlearn_catalogue_sync_writer';
  ELSE
    EXECUTE 'GRANT INSERT(id,catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator") ON public.exercises TO novlearn_catalogue_sync_writer';
  END IF;
END;
$exercise_content_grant$;
GRANT UPDATE(title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",active_version_id,admin_archived_at,synced_fingerprint_sha256,synced_at)
  ON public.exercises TO novlearn_catalogue_sync_writer;
GRANT UPDATE ON public.exercises TO novlearn_catalogue_sync_writer;
GRANT SELECT ON public.exercises TO novlearn_catalogue_sync_writer;
GRANT USAGE,SELECT ON SEQUENCE public.exercises_id_seq TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_target_writer_exercises ON public.exercises
  FOR ALL TO novlearn_catalogue_sync_writer USING (catalog_id IS NOT NULL)
  WITH CHECK (catalog_id IS NOT NULL);

-- Existing Production rows retain their historical payload. RLS must admit
-- their UPDATE; a trigger prevents the bounded writer from replacing it.
CREATE FUNCTION novlearn_admin_private.preserve_target_legacy_content()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE new_row jsonb; old_row jsonb;
BEGIN
  IF current_user='novlearn_catalogue_sync_writer' THEN
    new_row:=to_jsonb(NEW);
    IF TG_OP='INSERT' THEN
      IF new_row ? 'content' AND new_row->'content' IS DISTINCT FROM '{}'::jsonb THEN
        RAISE EXCEPTION 'target writer must preserve historical content and identity' USING ERRCODE='42501';
      END IF;
    ELSIF TG_OP='UPDATE' THEN
      old_row:=to_jsonb(OLD);
      IF new_row->'content' IS DISTINCT FROM old_row->'content' OR
         new_row->'id' IS DISTINCT FROM old_row->'id' OR
         new_row->'catalog_id' IS DISTINCT FROM old_row->'catalog_id' THEN
        RAISE EXCEPTION 'target writer must preserve historical content and identity' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.preserve_target_legacy_content() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogue_target_preserve_legacy_content BEFORE INSERT OR UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.preserve_target_legacy_content();

GRANT SELECT(id,exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
  editorial_status,publication_origin,approval_fingerprint_sha256)
  ON public.exercise_versions TO novlearn_catalogue_sync_writer;
REVOKE UPDATE ON public.exercise_versions FROM novlearn_catalogue_sync_writer;
GRANT SELECT ON public.exercise_versions TO novlearn_catalogue_sync_writer;
GRANT INSERT(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
  definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
  ON public.exercise_versions TO novlearn_catalogue_sync_writer;
CREATE POLICY catalogue_target_writer_read_versions ON public.exercise_versions
  FOR SELECT TO novlearn_catalogue_sync_writer USING (true);
CREATE POLICY catalogue_target_writer_insert_versions ON public.exercise_versions
  FOR INSERT TO novlearn_catalogue_sync_writer
  WITH CHECK (publication_origin='transfer' AND editorial_status='published');

-- Keep source-local editorial edits protected while allowing only the bounded
-- target capability to replace a synced projection without demoting it.
CREATE OR REPLACE FUNCTION novlearn_catalog_sync.manage_catalog_item()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
DECLARE content_changed boolean; attestation_changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'catalogue entities are archived, never deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR (NEW.catalog_id IS DISTINCT FROM OLD.catalog_id AND NOT
      (current_user='postgres' AND OLD.catalog_id IS NULL AND NEW.catalog_id IS NOT NULL AND
       current_setting('novlearn_catalog_sync.bind_item',true)=NEW.catalog_id::text)) THEN
      RAISE EXCEPTION 'catalogue identity is immutable';
    END IF;
    content_changed:=(to_jsonb(NEW)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['admin_epoch','editorial_status','admin_archived_at','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[]);
    -- Snapshot caller-supplied attestation changes before automatic invalidation.
    attestation_changed:=NEW.ready_at IS DISTINCT FROM OLD.ready_at OR NEW.ready_by IS DISTINCT FROM OLD.ready_by;
    IF content_changed AND OLD.editorial_status IN ('ready','published') AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_user<>'novlearn_catalogue_sync_writer' THEN
      NEW.editorial_status:='draft';NEW.ready_at:=NULL;NEW.ready_by:=NULL;
    END IF;
    IF NEW.admin_archived_at IS DISTINCT FROM OLD.admin_archived_at AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition';
    END IF;
    IF OLD.editorial_status='archived' AND NEW.admin_archived_at IS NULL AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected restore transition';
    END IF;
    IF NEW.editorial_status='archived' AND OLD.editorial_status IS DISTINCT FROM 'archived' AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected archive transition';
    END IF;
    IF attestation_changed AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text AND
       current_setting('novlearn_catalog_sync.archive_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'readiness attestation is protected';
    END IF;
    IF NEW.editorial_status='ready' AND OLD.editorial_status IS DISTINCT FROM 'ready' AND
       current_setting('novlearn_catalog_sync.ready_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'use the protected readiness transition';
    END IF;
    IF NEW.editorial_status='published' AND OLD.editorial_status IS DISTINCT FROM 'published' AND
       current_setting('novlearn_catalog_sync.sync_item',true) IS DISTINCT FROM NEW.catalog_id::text THEN
      RAISE EXCEPTION 'publication follows confirmed synchronization';
    END IF;
  ELSIF NEW.editorial_status<>'draft' AND current_user<>'novlearn_catalogue_sync_writer' THEN
    RAISE EXCEPTION 'insert a draft before readiness';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION novlearn_catalog_sync.manage_catalog_item() FROM PUBLIC,anon,authenticated,service_role;



CREATE OR REPLACE FUNCTION novlearn_admin_private.catalogue_sync_target_state(p_kind text,p_catalog_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE result jsonb; row_id uuid; competence_id text; exercise_id bigint;
BEGIN
  IF p_kind NOT IN ('exercise','chapter','competence','flashcard') OR p_catalog_id IS NULL THEN
    RAISE EXCEPTION 'invalid target identity' USING ERRCODE='22023';
  END IF;
  IF p_kind='chapter' THEN
    SELECT jsonb_build_object('id',id,'catalogId',catalog_id,'name',name,'aliases',aliases,'emoji',emoji,'orderIndex',order_index,
      'archivedAt',admin_archived_at,'status',editorial_status,'fingerprint',synced_fingerprint_sha256)
      INTO result FROM public.chapters WHERE catalog_id=p_catalog_id;
  ELSIF p_kind='competence' THEN
    SELECT jsonb_build_object('id',co.id,'catalogId',co.catalog_id,'chapterId',co.chapter_id,'chapterCatalogId',ch.catalog_id,
      'name',co.name,'maxPoints',co.max_points,'archivedAt',co.admin_archived_at,'status',co.editorial_status,
      'fingerprint',co.synced_fingerprint_sha256)
      INTO result FROM public.competences co LEFT JOIN public.chapters ch ON ch.id=co.chapter_id WHERE co.catalog_id=p_catalog_id;
  ELSIF p_kind='flashcard' THEN
    SELECT jsonb_build_object('id',f.id,'catalogId',f.catalog_id,'chapter',f.chapter,'chapterCatalogId',ch.catalog_id,
      'question',f.question,'answer',f.answer,'archivedAt',f.admin_archived_at,'status',f.editorial_status,
      'fingerprint',f.synced_fingerprint_sha256)
      INTO result FROM public.flashcards f LEFT JOIN public.chapters ch ON lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases)
      WHERE f.catalog_id=p_catalog_id;
  ELSE
    SELECT id INTO exercise_id FROM public.exercises WHERE catalog_id=p_catalog_id;
    IF exercise_id IS NOT NULL THEN
      SELECT jsonb_build_object('id',e.id::text,'catalogId',e.catalog_id,'activeVersionId',e.active_version_id,
        'archivedAt',e.admin_archived_at,'title',e.title,'chapter',e.chapter,'difficulty',e.difficulty,
        'competences',e.competences,'appTitle',e.app_title,'isFlash',e."Is_Flash",'needCalculator',e."Need_Calculator",
        'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('revision',v.revision,'definition',v.definition,
          'engineContract',v.engine_contract,'generationVersion',v.generation_version,'canonicalizationVersion',v.canonicalization_version,
          'status',v.editorial_status,'origin',v.publication_origin) ORDER BY v.revision) FROM public.exercise_versions v WHERE v.exercise_id=e.id),'[]'::jsonb),
        'fingerprint',e.synced_fingerprint_sha256)
        INTO result FROM public.exercises e WHERE e.id=exercise_id;
    END IF;
  END IF;
  RETURN coalesce(result,jsonb_build_object('absent',true,'kind',p_kind,'catalogId',p_catalog_id));
END;
$function$;

CREATE OR REPLACE FUNCTION novlearn_admin_private.inspect_catalogue_sync_item(p_kind text,p_catalog_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT jsonb_build_object('stateToken',encode(extensions.digest(convert_to(novlearn_admin_private.catalogue_sync_target_state(p_kind,p_catalog_id)::text,'UTF8'),'sha256'),'hex'))
$function$;

CREATE FUNCTION novlearn_admin_private.catalogue_sync_target_contract()
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $function$
  SELECT 'atomic-catalogue-target-v1'::text
$function$;

CREATE FUNCTION novlearn_admin_private.observe_catalogue_sync_batch(p_batch_id uuid,p_payload_digest text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE saved novlearn_admin_private.catalogue_sync_target_receipts%ROWTYPE;
BEGIN
  IF p_batch_id IS NULL OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid target observation' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('novlearn-catalogue-sync-v1',0));
  SELECT * INTO saved FROM novlearn_admin_private.catalogue_sync_target_receipts WHERE batch_id=p_batch_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('batchId',p_batch_id,'payloadDigest',p_payload_digest,'state','not_applied'); END IF;
  IF saved.payload_digest IS DISTINCT FROM p_payload_digest THEN
    RAISE EXCEPTION 'batch id is already bound to another payload digest' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('batchId',p_batch_id,'payloadDigest',saved.payload_digest,'state','committed','receipt',saved.receipt);
END;
$function$;

CREATE FUNCTION novlearn_admin_private.apply_catalogue_sync_batch(p_batch_id uuid,p_payload_digest text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='30s' SET lock_timeout='5s' AS $function$
DECLARE item jsonb; payload jsonb; inspection jsonb; data_value jsonb; definition_value jsonb; mapped_definition jsonb;
  dep jsonb; source_ref text; catalog_uuid uuid; chapter_row public.chapters%ROWTYPE; competence_row public.competences%ROWTYPE;
  flashcard_row public.flashcards%ROWTYPE; exercise_row public.exercises%ROWTYPE; version_row public.exercise_versions%ROWTYPE;
  version_id uuid; revision_number integer; latest_revision integer; header jsonb; competence_ids text[];
  engine_row record; result_value text; target_id text; receipt_items jsonb:='[]'::jsonb; saved novlearn_admin_private.catalogue_sync_target_receipts%ROWTYPE;
  n integer; prior_chapter_name text; i integer; phase integer; item_kind text; action_value text; source_skill text; dep_catalog_id uuid;
  exercise_catalog_id uuid; active_ref record; operation jsonb; proposed_chapter uuid; state_token text;
BEGIN
  IF p_batch_id IS NULL OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$' OR
     jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR octet_length(p_items::text)>1048576 THEN
    RAISE EXCEPTION 'invalid target batch' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid target batch size' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('novlearn-catalogue-sync-v1',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('novlearn-catalogue-sync-batch:'||p_batch_id::text,0));
  SELECT * INTO saved FROM novlearn_admin_private.catalogue_sync_target_receipts WHERE batch_id=p_batch_id;
  IF FOUND THEN
    IF saved.payload_digest IS DISTINCT FROM p_payload_digest THEN RAISE EXCEPTION 'batch id is already bound to another digest' USING ERRCODE='40001'; END IF;
    RETURN saved.receipt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    WHERE CASE WHEN jsonb_typeof(x)='object' THEN
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM ARRAY['inspection','payload']::text[] OR
      jsonb_typeof(x->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(x->'inspection') IS DISTINCT FROM 'object' OR
      x->'inspection'->>'stateToken' IS NULL OR (x->'inspection'->>'stateToken') !~ '^[0-9a-f]{64}$'
      ELSE true END
  ) THEN RAISE EXCEPTION 'malformed catalogue transfer item' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items))<>(SELECT count(DISTINCT (x->'payload'->>'kind')||':'||(x->'payload'->>'catalogId')) FROM jsonb_array_elements(p_items) x) THEN
    RAISE EXCEPTION 'duplicate catalogue identity in target batch' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind' NOT IN ('exercise','chapter','competence','flashcard')
      OR (x->'payload'->>'catalogId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (x->'payload'->>'fingerprint') !~ '^[0-9a-f]{64}$' OR x->'payload'->>'action' NOT IN ('upsert','archive')
      OR jsonb_typeof(x->'payload'->'dependencies') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'invalid catalogue payload' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE CASE WHEN jsonb_typeof(x->'payload')='object' THEN
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x->'payload') k) IS DISTINCT FROM
        CASE WHEN x->'payload'->>'kind'='exercise' AND x->'payload'->>'action'='archive'
          THEN ARRAY['action','catalogId','definition','dependencies','fingerprint','kind','revision','versionId']::text[]
          ELSE ARRAY['action','catalogId','data','dependencies','fingerprint','kind','revision','versionId']::text[] END
      ELSE true END) THEN
    RAISE EXCEPTION 'unknown or missing catalogue payload fields' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind' IS NULL OR
      x->'payload'->>'catalogId' IS NULL OR x->'payload'->>'fingerprint' IS NULL OR x->'payload'->>'action' IS NULL OR
      (x->'payload'->>'action'='upsert' AND jsonb_typeof(x->'payload'->'data') IS DISTINCT FROM 'object')) THEN
    RAISE EXCEPTION 'incomplete catalogue payload' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE
      jsonb_array_length(x->'payload'->'dependencies')>65 OR
      jsonb_array_length(x->'payload'->'dependencies')<>(SELECT count(DISTINCT (d->>'kind')||':'||(d->>'catalogId')) FROM jsonb_array_elements(x->'payload'->'dependencies') d) OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(x->'payload'->'dependencies') d WHERE d->>'kind' IS NULL OR d->>'catalogId' IS NULL OR
        d->>'kind' NOT IN ('chapter','competence') OR
        (d->>'catalogId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
        (d ? 'sourceId' AND jsonb_typeof(d->'sourceId') NOT IN ('string','null')) OR
        (d ? 'sourceRef' AND jsonb_typeof(d->'sourceRef') NOT IN ('string','null')))) THEN
    RAISE EXCEPTION 'invalid or duplicate catalogue references' USING ERRCODE='22023';
  END IF;
  -- Every inspection is checked against the untouched target snapshot before
  -- any batch row is written, so dependent updates do not stale sibling checks.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    payload:=item->'payload';inspection:=item->'inspection';
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(inspection) k) IS DISTINCT FROM ARRAY['stateToken']::text[] THEN
      RAISE EXCEPTION 'unsupported target inspection shape' USING ERRCODE='22023';
    END IF;
    state_token:=encode(extensions.digest(convert_to(novlearn_admin_private.catalogue_sync_target_state(payload->>'kind',(payload->>'catalogId')::uuid)::text,'UTF8'),'sha256'),'hex');
    IF state_token IS DISTINCT FROM inspection->>'stateToken' THEN
      RAISE EXCEPTION 'target changed since inspection' USING ERRCODE='40001';
    END IF;
  END LOOP;
  -- References are resolved only by catalog_id. A draft source reference can
  -- be reused when the compatible stable identity already exists here; draft
  -- data itself is never imported because only the selected ready item is in
  -- the payload list.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    payload:=item->'payload';
    IF payload->>'action'='upsert' THEN
      FOR dep IN SELECT value FROM jsonb_array_elements(payload->'dependencies') LOOP
        IF dep->>'kind'='chapter' AND NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=(dep->>'catalogId')::uuid AND admin_archived_at IS NULL) AND
          NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='chapter' AND x->'payload'->>'catalogId'=dep->>'catalogId' AND x->'payload'->>'action'='upsert') THEN
          RAISE EXCEPTION 'required chapter reference is absent from target and batch' USING ERRCODE='23503';
        ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'=dep->>'kind' AND
              x->'payload'->>'catalogId'=dep->>'catalogId' AND x->'payload'->>'action'='archive') THEN
          RAISE EXCEPTION 'a dependency cannot be archived in the same batch that uses it' USING ERRCODE='23503';
        ELSIF dep->>'kind'='competence' AND NOT EXISTS(SELECT 1 FROM public.competences WHERE catalog_id=(dep->>'catalogId')::uuid AND admin_archived_at IS NULL) AND
          NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='competence' AND x->'payload'->>'catalogId'=dep->>'catalogId' AND x->'payload'->>'action'='upsert') THEN
          RAISE EXCEPTION 'required competence reference is absent from target and batch' USING ERRCODE='23503';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Chapter names are copied into exercise and flashcard metadata. A rename
  -- may update those rows only when each active reference is explicitly in
  -- this batch; exercises also need a newer immutable version whose mapped
  -- definition carries the new chapter name. Validate before the first write.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
    WHERE value->'payload'->>'kind'='chapter' AND value->'payload'->>'action'='upsert' LOOP
    payload:=item->'payload';catalog_uuid:=(payload->>'catalogId')::uuid;data_value:=payload->'data';
    SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=catalog_uuid FOR UPDATE;
    IF FOUND AND chapter_row.name IS DISTINCT FROM data_value->>'name' THEN
      FOR active_ref IN SELECT e.catalog_id,e.active_version_id
        FROM public.exercises e WHERE e.admin_archived_at IS NULL AND e.chapter=chapter_row.name LOOP
        IF active_ref.catalog_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_items) x
          WHERE x->'payload'->>'kind'='exercise' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text
            AND x->'payload'->>'action'='upsert'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(x->'payload'->'dependencies') d
              WHERE d->>'kind'='chapter' AND d->>'catalogId'=catalog_uuid::text)
            AND CASE WHEN x->'payload'->'data'->>'revision' ~ '^[1-9][0-9]{0,8}$' THEN
              (x->'payload'->'data'->>'revision')::integer > coalesce(
                (SELECT v.revision FROM public.exercise_versions v WHERE v.id=active_ref.active_version_id),0)
              ELSE false END
        ) THEN
          RAISE EXCEPTION 'chapter rename requires every active referencing exercise with a newer revision in the same batch'
            USING ERRCODE='23503';
        END IF;
      END LOOP;
      FOR active_ref IN SELECT f.catalog_id FROM public.flashcards f
        WHERE f.admin_archived_at IS NULL AND f.chapter=chapter_row.name LOOP
        IF active_ref.catalog_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_items) x
          WHERE x->'payload'->>'kind'='flashcard' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text
            AND x->'payload'->>'action'='upsert' AND x->'payload'->'data'->>'chapterCatalogId'=catalog_uuid::text
        ) THEN
          RAISE EXCEPTION 'chapter rename requires every active referencing flashcard in the same batch'
            USING ERRCODE='23503';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Reject an archive only when a relationship remains active after applying
  -- the full proposed batch. Historical references are preserved.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) WHERE value->'payload'->>'action'='archive' LOOP
    payload:=item->'payload';item_kind:=payload->>'kind';catalog_uuid:=(payload->>'catalogId')::uuid;
    IF item_kind='chapter' THEN
      SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=catalog_uuid FOR UPDATE;
      IF FOUND THEN
        FOR active_ref IN SELECT e.catalog_id FROM public.exercises e WHERE e.admin_archived_at IS NULL AND e.chapter=chapter_row.name LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='exercise' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text
            AND (x->'payload'->>'action'='archive' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x->'payload'->'dependencies') d WHERE d->>'kind'='chapter' AND d->>'catalogId'=catalog_uuid::text))) THEN
            RAISE EXCEPTION 'chapter remains referenced by an active exercise' USING ERRCODE='23503';
          END IF;
        END LOOP;
        FOR active_ref IN SELECT c.catalog_id FROM public.competences c WHERE c.chapter_id=chapter_row.id AND c.admin_archived_at IS NULL LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='competence' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text AND
            (x->'payload'->>'action'='archive' OR x->'payload'->'data'->>'chapterCatalogId' IS DISTINCT FROM catalog_uuid::text)) THEN
            RAISE EXCEPTION 'chapter remains referenced by an active competence' USING ERRCODE='23503';
          END IF;
        END LOOP;
        FOR active_ref IN SELECT f.catalog_id FROM public.flashcards f WHERE f.chapter=chapter_row.name AND f.admin_archived_at IS NULL LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='flashcard' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text
            AND (x->'payload'->>'action'='archive' OR x->'payload'->'data'->>'chapterCatalogId' IS DISTINCT FROM catalog_uuid::text)) THEN
            RAISE EXCEPTION 'chapter remains referenced by an active flashcard' USING ERRCODE='23503';
          END IF;
        END LOOP;
      END IF;
    ELSIF item_kind='competence' THEN
      SELECT * INTO competence_row FROM public.competences WHERE catalog_id=catalog_uuid FOR UPDATE;
      IF FOUND THEN
        FOR active_ref IN SELECT e.catalog_id FROM public.exercises e WHERE e.admin_archived_at IS NULL AND competence_row.id=ANY(coalesce(e.competences,'{}'::text[])) LOOP
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->'payload'->>'kind'='exercise' AND x->'payload'->>'catalogId'=active_ref.catalog_id::text
            AND (x->'payload'->>'action'='archive' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x->'payload'->'dependencies') d WHERE d->>'kind'='competence' AND d->>'catalogId'=catalog_uuid::text))) THEN
            RAISE EXCEPTION 'competence remains referenced by an active exercise' USING ERRCODE='23503';
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  -- Upsert dependencies first (chapter, competence, flashcard, exercise), then
  -- apply archives in reverse dependency order.
  FOR phase IN 1..8 LOOP
    FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      payload:=item->'payload';item_kind:=payload->>'kind';action_value:=payload->>'action';data_value:=payload->'data';
      IF (phase<=4 AND action_value='upsert' AND
          CASE item_kind WHEN 'chapter' THEN 1 WHEN 'competence' THEN 2 WHEN 'flashcard' THEN 3 ELSE 4 END=phase)
        OR (phase>=5 AND action_value='archive' AND
          CASE item_kind WHEN 'exercise' THEN 5 WHEN 'flashcard' THEN 6 WHEN 'competence' THEN 7 ELSE 8 END=phase) THEN
        catalog_uuid:=(payload->>'catalogId')::uuid;
        target_id:=catalog_uuid::text;result_value:='applied';
        IF action_value='archive' THEN
          IF item_kind='exercise' THEN
            SELECT * INTO exercise_row FROM public.exercises WHERE catalog_id=catalog_uuid FOR UPDATE;
            IF NOT FOUND THEN result_value:='unchanged';
            ELSE
              UPDATE public.exercises SET admin_archived_at=coalesce(admin_archived_at,clock_timestamp()),
                synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE id=exercise_row.id;
              target_id:=exercise_row.id::text;
            END IF;
          ELSIF item_kind='chapter' THEN
            SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=catalog_uuid FOR UPDATE;
            IF NOT FOUND THEN result_value:='unchanged';
            ELSE
              PERFORM set_config('novlearn_catalog_sync.archive_item',catalog_uuid::text,true);
              UPDATE public.chapters SET admin_archived_at=coalesce(admin_archived_at,clock_timestamp()),editorial_status='archived',
                synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE id=chapter_row.id;
              target_id:=chapter_row.id::text;
            END IF;
          ELSIF item_kind='competence' THEN
            SELECT * INTO competence_row FROM public.competences WHERE catalog_id=catalog_uuid FOR UPDATE;
            IF NOT FOUND THEN result_value:='unchanged';
            ELSE
              PERFORM set_config('novlearn_catalog_sync.archive_item',catalog_uuid::text,true);
              UPDATE public.competences SET admin_archived_at=coalesce(admin_archived_at,clock_timestamp()),editorial_status='archived',
                synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE catalog_id=catalog_uuid;
              target_id:=competence_row.id;
            END IF;
          ELSE
            SELECT * INTO flashcard_row FROM public.flashcards WHERE catalog_id=catalog_uuid FOR UPDATE;
            IF NOT FOUND THEN result_value:='unchanged';
            ELSE
              PERFORM set_config('novlearn_catalog_sync.archive_item',catalog_uuid::text,true);
              UPDATE public.flashcards SET admin_archived_at=coalesce(admin_archived_at,clock_timestamp()),editorial_status='archived',
                synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE id=flashcard_row.id;
              target_id:=flashcard_row.id::text;
            END IF;
          END IF;
          -- An absent archive has no target row. catalog_id is the existing
          -- canonical identity and is used only as its receipt key.
          receipt_items:=receipt_items||jsonb_build_array(jsonb_build_object('kind',item_kind,'catalogId',catalog_uuid,
            'fingerprint',payload->>'fingerprint','targetId',target_id,'result',CASE WHEN result_value='unchanged' THEN 'unchanged' ELSE 'archived' END));
          CONTINUE;
        END IF;

        IF item_kind='chapter' THEN
          IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_value) k) IS DISTINCT FROM ARRAY['aliases','catalogId','emoji','name','orderIndex']::text[] OR
            data_value->>'catalogId' IS DISTINCT FROM catalog_uuid::text OR jsonb_typeof(data_value->'name') IS DISTINCT FROM 'string' OR
            jsonb_typeof(data_value->'aliases') IS DISTINCT FROM 'array' OR jsonb_typeof(data_value->'orderIndex') NOT IN ('number','null') THEN
            RAISE EXCEPTION 'invalid chapter projection' USING ERRCODE='22023';
          END IF;
          SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=catalog_uuid FOR UPDATE;
          IF NOT FOUND THEN
            INSERT INTO public.chapters(catalog_id,name,aliases,emoji,order_index,editorial_status,synced_fingerprint_sha256,synced_at)
            VALUES(catalog_uuid,data_value->>'name',ARRAY(SELECT jsonb_array_elements_text(data_value->'aliases')),
              coalesce(data_value->>'emoji','📚'),coalesce(nullif(data_value->>'orderIndex','null')::integer,(SELECT coalesce(max(order_index),0)+1 FROM public.chapters)),
              'published',payload->>'fingerprint',clock_timestamp()) RETURNING * INTO chapter_row;
          ELSE
            prior_chapter_name:=chapter_row.name;
            PERFORM set_config('novlearn_catalog_sync.sync_item',catalog_uuid::text,true);
            UPDATE public.chapters SET name=data_value->>'name',aliases=ARRAY(SELECT DISTINCT alias FROM unnest(
                ARRAY(SELECT jsonb_array_elements_text(data_value->'aliases')) ||
                CASE WHEN prior_chapter_name IS DISTINCT FROM data_value->>'name' THEN ARRAY[prior_chapter_name] ELSE '{}'::text[] END
              ) AS aliases(alias) ORDER BY alias),
              emoji=coalesce(data_value->>'emoji','📚'),order_index=coalesce(nullif(data_value->>'orderIndex','null')::integer,order_index),editorial_status='published',
              admin_archived_at=NULL,ready_at=NULL,ready_by=NULL,synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp()
              WHERE id=chapter_row.id RETURNING * INTO chapter_row;
          END IF;
          target_id:=chapter_row.id::text;
        ELSIF item_kind='competence' THEN
          IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_value) k) IS DISTINCT FROM ARRAY['catalogId','chapterCatalogId','id','maxPoints','name']::text[] OR
            data_value->>'catalogId' IS DISTINCT FROM catalog_uuid::text OR data_value->>'chapterCatalogId' IS NULL OR
            jsonb_typeof(data_value->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(data_value->'name') IS DISTINCT FROM 'string' OR
            jsonb_typeof(data_value->'maxPoints') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid competence projection' USING ERRCODE='22023'; END IF;
          dep_catalog_id:=(data_value->>'chapterCatalogId')::uuid;
          SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=dep_catalog_id AND admin_archived_at IS NULL FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'competence chapter is unavailable' USING ERRCODE='23503'; END IF;
          SELECT * INTO competence_row FROM public.competences WHERE catalog_id=catalog_uuid FOR UPDATE;
          IF NOT FOUND THEN
            INSERT INTO public.competences(id,catalog_id,chapter_id,name,max_points,editorial_status,synced_fingerprint_sha256,synced_at)
            VALUES('catalog:'||catalog_uuid::text,catalog_uuid,chapter_row.id,data_value->>'name',(data_value->>'maxPoints')::integer,
              'published',payload->>'fingerprint',clock_timestamp()) RETURNING * INTO competence_row;
          ELSE
            PERFORM set_config('novlearn_catalog_sync.sync_item',catalog_uuid::text,true);
            UPDATE public.competences SET chapter_id=chapter_row.id,name=data_value->>'name',max_points=(data_value->>'maxPoints')::integer,
              editorial_status='published',admin_archived_at=NULL,ready_at=NULL,ready_by=NULL,
              synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE catalog_id=catalog_uuid RETURNING * INTO competence_row;
          END IF;
          target_id:=competence_row.id;
        ELSIF item_kind='flashcard' THEN
          IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_value) k) IS DISTINCT FROM ARRAY['answer','catalogId','chapterCatalogId','question']::text[] OR
            data_value->>'catalogId' IS DISTINCT FROM catalog_uuid::text OR data_value->>'chapterCatalogId' IS NULL OR
            jsonb_typeof(data_value->'question') IS DISTINCT FROM 'string' OR jsonb_typeof(data_value->'answer') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'invalid flashcard projection' USING ERRCODE='22023';
          END IF;
          dep_catalog_id:=(data_value->>'chapterCatalogId')::uuid;
          SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=dep_catalog_id AND admin_archived_at IS NULL FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'flashcard chapter is unavailable' USING ERRCODE='23503'; END IF;
          SELECT * INTO flashcard_row FROM public.flashcards WHERE catalog_id=catalog_uuid FOR UPDATE;
          IF NOT FOUND THEN
            INSERT INTO public.flashcards(catalog_id,chapter,question,answer,editorial_status,synced_fingerprint_sha256,synced_at)
            VALUES(catalog_uuid,chapter_row.name,data_value->>'question',data_value->>'answer','published',payload->>'fingerprint',clock_timestamp()) RETURNING * INTO flashcard_row;
          ELSE
            PERFORM set_config('novlearn_catalog_sync.sync_item',catalog_uuid::text,true);
            UPDATE public.flashcards SET chapter=chapter_row.name,question=data_value->>'question',answer=data_value->>'answer',
              editorial_status='published',admin_archived_at=NULL,ready_at=NULL,ready_by=NULL,
              synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp() WHERE id=flashcard_row.id RETURNING * INTO flashcard_row;
          END IF;
          target_id:=flashcard_row.id::text;
        ELSE
          IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_value) k) IS DISTINCT FROM ARRAY['catalogId','definition','header','revision']::text[] OR
            (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(data_value->'header') k) IS DISTINCT FROM
              ARRAY['appTitle','chapter','competences','difficulty','isFlash','needCalculator','title']::text[] OR
            data_value->>'catalogId' IS DISTINCT FROM catalog_uuid::text OR NOT (data_value ? 'revision') OR NOT (data_value ? 'definition') OR
            jsonb_typeof(data_value->'definition') IS DISTINCT FROM 'object' OR data_value->'definition'->>'id' IS DISTINCT FROM catalog_uuid::text OR
            data_value->'definition'->>'revision' IS DISTINCT FROM data_value->>'revision' OR
            data_value->'definition'->>'kind' IS DISTINCT FROM 'composed' OR
            (data_value->>'revision') !~ '^[1-9][0-9]{0,8}$' OR payload->>'revision' IS DISTINCT FROM data_value->>'revision' OR
            payload->>'versionId' IS NULL OR (payload->>'versionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'invalid exercise revision projection' USING ERRCODE='22023';
          END IF;
          revision_number:=(data_value->>'revision')::integer;
          IF revision_number<1 OR revision_number>999999999 THEN RAISE EXCEPTION 'invalid exercise revision' USING ERRCODE='22023'; END IF;
          mapped_definition:=data_value->'definition';
          n:=0;
          FOR dep IN SELECT value FROM jsonb_array_elements(payload->'dependencies') WHERE value->>'kind'='chapter' LOOP
            dep_catalog_id:=(dep->>'catalogId')::uuid;n:=n+1;
          END LOOP;
          IF n<>1 THEN RAISE EXCEPTION 'exercise must have exactly one stable primary chapter reference' USING ERRCODE='23503'; END IF;
          SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=dep_catalog_id AND admin_archived_at IS NULL FOR UPDATE;
          IF NOT FOUND THEN RAISE EXCEPTION 'exercise chapter is unavailable' USING ERRCODE='23503'; END IF;
          mapped_definition:=jsonb_set(mapped_definition,'{catalogue,chapter}',to_jsonb(chapter_row.name),true);
          IF jsonb_typeof(mapped_definition->'catalogue'->'skills') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'exercise skills must be an array' USING ERRCODE='22023';
          END IF;
          competence_ids:='{}';
          FOR source_skill IN SELECT jsonb_array_elements_text(mapped_definition->'catalogue'->'skills') LOOP
            SELECT (d->>'catalogId')::uuid INTO dep_catalog_id FROM jsonb_array_elements(payload->'dependencies') d
              WHERE d->>'kind'='competence' AND d->>'sourceId'=source_skill;
            IF dep_catalog_id IS NULL THEN RAISE EXCEPTION 'exercise skill lacks an explicit stable dependency mapping' USING ERRCODE='23503'; END IF;
            SELECT * INTO competence_row FROM public.competences WHERE catalog_id=dep_catalog_id AND admin_archived_at IS NULL FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'exercise competence is unavailable' USING ERRCODE='23503'; END IF;
            competence_ids:=array_append(competence_ids,competence_row.id);
          END LOOP;
          mapped_definition:=jsonb_set(mapped_definition,'{catalogue,skills}',to_jsonb(competence_ids),true);
          header:=novlearn_admin_private.publication_header(mapped_definition);
          SELECT * INTO exercise_row FROM public.exercises WHERE catalog_id=catalog_uuid FOR UPDATE;
          IF NOT FOUND THEN
            IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.exercises'::regclass
                AND attname='content' AND NOT attisdropped) THEN
              EXECUTE 'INSERT INTO public.exercises(id,catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator",content)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *'
                INTO exercise_row
                USING nextval('public.exercises_id_seq'),catalog_uuid,header->>'title',header->>'chapter',header->>'difficulty',
                  ARRAY(SELECT jsonb_array_elements_text(header->'competences')),header->>'app_title',(header->>'Is_Flash')::boolean,
                  (header->>'Need_Calculator')::boolean,'{}'::jsonb;
            ELSE
              EXECUTE 'INSERT INTO public.exercises(id,catalog_id,title,chapter,difficulty,competences,app_title,"Is_Flash","Need_Calculator")
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *'
                INTO exercise_row
                USING nextval('public.exercises_id_seq'),catalog_uuid,header->>'title',header->>'chapter',header->>'difficulty',
                  ARRAY(SELECT jsonb_array_elements_text(header->'competences')),header->>'app_title',(header->>'Is_Flash')::boolean,
                  (header->>'Need_Calculator')::boolean;
            END IF;
          END IF;
          -- The exercise row is locked above and a batch-wide advisory lock
          -- serializes imports. Reading an immutable version needs SELECT only;
          -- FOR UPDATE would require UPDATE privileges and hide it under RLS.
          SELECT * INTO version_row FROM public.exercise_versions WHERE exercise_id=exercise_row.id AND revision=revision_number;
          IF FOUND AND version_row.definition IS DISTINCT FROM mapped_definition THEN
            RAISE EXCEPTION 'immutable exercise revision conflicts with target content' USING ERRCODE='40001';
          END IF;
          SELECT coalesce(max(revision),0) INTO latest_revision FROM public.exercise_versions WHERE exercise_id=exercise_row.id;
          IF NOT FOUND THEN latest_revision:=0; END IF;
          IF revision_number<latest_revision THEN
            RAISE EXCEPTION 'older exercise revision cannot replace target history' USING ERRCODE='40001';
          END IF;
          IF version_row.id IS NULL THEN
            IF revision_number<=latest_revision THEN RAISE EXCEPTION 'older exercise revision cannot replace target history' USING ERRCODE='40001'; END IF;
            SELECT engine_contract,generation_version,canonicalization_version INTO engine_row
              FROM novlearn_admin_private.publication_runtime WHERE singleton;
            IF engine_row.engine_contract IS NULL THEN RAISE EXCEPTION 'target exercise runtime is not configured' USING ERRCODE='55000'; END IF;
            INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,canonicalization_version,
              definition_sha256,approval_fingerprint_sha256,editorial_status,publication_origin,published_at)
            VALUES(exercise_row.id,revision_number,mapped_definition,engine_row.engine_contract,engine_row.generation_version,
              engine_row.canonicalization_version,repeat('0',64),repeat('0',64),'published','transfer',clock_timestamp()) RETURNING * INTO version_row;
          ELSE
            result_value:='unchanged';
          END IF;
          IF exercise_row.admin_archived_at IS NOT NULL OR exercise_row.active_version_id IS NULL OR exercise_row.active_version_id=version_row.id OR
             (SELECT revision FROM public.exercise_versions WHERE id=exercise_row.active_version_id)<=revision_number THEN
            UPDATE public.exercises SET title=header->>'title',chapter=header->>'chapter',difficulty=header->>'difficulty',
              competences=ARRAY(SELECT jsonb_array_elements_text(header->'competences')),app_title=header->>'app_title',
              "Is_Flash"=(header->>'Is_Flash')::boolean,"Need_Calculator"=(header->>'Need_Calculator')::boolean,
              active_version_id=version_row.id,admin_archived_at=NULL,synced_fingerprint_sha256=payload->>'fingerprint',synced_at=clock_timestamp()
              WHERE id=exercise_row.id;
          END IF;
          target_id:=exercise_row.id::text;
        END IF;
        receipt_items:=receipt_items||jsonb_build_array(jsonb_build_object('kind',item_kind,'catalogId',catalog_uuid,
          'fingerprint',payload->>'fingerprint','targetId',target_id,'result',result_value));
      END IF;
    END LOOP;
  END LOOP;
  receipt_items:=(SELECT jsonb_agg(value ORDER BY value->>'kind',value->>'catalogId') FROM jsonb_array_elements(receipt_items));
  state_token:=encode(extensions.digest(convert_to(jsonb_build_object('batchId',p_batch_id,'payloadDigest',p_payload_digest,'items',receipt_items)::text,'UTF8'),'sha256'),'hex');
  saved.receipt:=jsonb_build_object('batchId',p_batch_id,'stateToken',state_token,'items',receipt_items);
  saved.batch_id:=p_batch_id;saved.payload_digest:=p_payload_digest;saved.committed_at:=clock_timestamp();
  INSERT INTO novlearn_admin_private.catalogue_sync_target_receipts(batch_id,payload_digest,receipt,committed_at)
    VALUES(saved.batch_id,saved.payload_digest,saved.receipt,saved.committed_at);
  RETURN saved.receipt;
END;
$function$;

-- The old trigger used this role name as the only transfer writer. The new
-- writer gets the same narrowly scoped immutable-version insertion path.
CREATE OR REPLACE FUNCTION public.manage_exercise_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE content_changed boolean:=false; approval_changed boolean:=false;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    RETURN OLD;
  END IF;
  -- Historical execution occupies revision zero, outside source numbering.
  -- Only the reviewed operator preparation can create it; never the importer.
  IF TG_OP='INSERT' AND NEW.publication_origin='historical' THEN
    IF current_user<>'postgres' OR NEW.revision<>0 OR NEW.editorial_status<>'published' THEN
      RAISE EXCEPTION 'historical execution requires operator preparation' USING ERRCODE='42501';
    END IF;
    NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
    NEW.approval_fingerprint_sha256:=NEW.definition_sha256;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND NEW.publication_origin='transfer' THEN
    IF current_user NOT IN ('novlearn_publication_writer','novlearn_catalogue_sync_writer') OR NEW.editorial_status<>'published' OR
      NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approved_fingerprint_sha256 IS NOT NULL OR
      NEW.created_by IS NOT NULL OR NEW.updated_by IS NOT NULL THEN
      RAISE EXCEPTION 'transfer insertion requires the bounded publication capability' USING ERRCODE='42501';
    END IF;
    NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
    NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object('exercise_id',NEW.exercise_id,'revision',NEW.revision,
      'definition',NEW.definition,'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
      'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
    NEW.published_at:=clock_timestamp();NEW.updated_at:=clock_timestamp();RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.publication_origin IS DISTINCT FROM OLD.publication_origin THEN RAISE EXCEPTION 'publication origin is immutable' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.editorial_status='published' THEN RAISE EXCEPTION 'published exercise versions are immutable'; END IF;
    content_changed:=NEW.exercise_id IS DISTINCT FROM OLD.exercise_id OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.definition IS DISTINCT FROM OLD.definition OR
      NEW.engine_contract IS DISTINCT FROM OLD.engine_contract OR NEW.generation_version IS DISTINCT FROM OLD.generation_version OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version;
    approval_changed:=NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_fingerprint_sha256 IS DISTINCT FROM OLD.approved_fingerprint_sha256;
    IF (content_changed OR approval_changed) AND OLD.editorial_status='approved' THEN
      NEW.editorial_status:='draft';NEW.approved_at:=NULL;NEW.approved_by:=NULL;NEW.approved_fingerprint_sha256:=NULL;NEW.published_at:=NULL;
    END IF;
    IF NEW.editorial_status='approved' AND OLD.editorial_status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'approval must be an explicit transition from draft or review'; END IF;
    IF NEW.editorial_status='published' AND (OLD.editorial_status<>'approved' OR content_changed OR approval_changed) THEN RAISE EXCEPTION 'only the unchanged approved version can be published'; END IF;
  ELSIF NEW.editorial_status<>'draft' THEN RAISE EXCEPTION 'insert a draft before review, approval, or publication';
  END IF;
  NEW.definition_sha256:=encode(extensions.digest(convert_to(NEW.definition::text,'UTF8'),'sha256'),'hex');
  NEW.approval_fingerprint_sha256:=encode(extensions.digest(convert_to(jsonb_build_object('exercise_id',NEW.exercise_id,'revision',NEW.revision,
    'definition',NEW.definition,'engine_contract',NEW.engine_contract,'generation_version',NEW.generation_version,
    'canonicalization_version',NEW.canonicalization_version)::text,'UTF8'),'sha256'),'hex');
  IF NEW.editorial_status='approved' THEN
    IF NEW.approved_at IS NULL OR NEW.approved_by IS NULL THEN RAISE EXCEPTION 'approval metadata is required'; END IF;
    NEW.approved_fingerprint_sha256:=NEW.approval_fingerprint_sha256;
  ELSIF NEW.editorial_status='draft' THEN NEW.approved_fingerprint_sha256:=NULL;NEW.approved_at:=NULL;NEW.approved_by:=NULL;
  END IF;
  IF NEW.editorial_status='published' THEN
    IF NEW.approved_fingerprint_sha256 IS DISTINCT FROM NEW.approval_fingerprint_sha256 THEN RAISE EXCEPTION 'published content must match its approval fingerprint'; END IF;
    NEW.published_at:=coalesce(NEW.published_at,now());
  END IF;
  NEW.updated_at:=now();RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.manage_exercise_version() FROM PUBLIC,anon,authenticated,service_role;

GRANT CREATE ON SCHEMA novlearn_admin_private TO novlearn_catalogue_sync_writer;
ALTER FUNCTION novlearn_admin_private.catalogue_sync_target_state(text,uuid) OWNER TO novlearn_catalogue_sync_writer;
ALTER FUNCTION novlearn_admin_private.inspect_catalogue_sync_item(text,uuid) OWNER TO novlearn_catalogue_sync_writer;
ALTER FUNCTION novlearn_admin_private.catalogue_sync_target_contract() OWNER TO novlearn_catalogue_sync_writer;
ALTER FUNCTION novlearn_admin_private.observe_catalogue_sync_batch(uuid,text) OWNER TO novlearn_catalogue_sync_writer;
ALTER FUNCTION novlearn_admin_private.apply_catalogue_sync_batch(uuid,text,jsonb) OWNER TO novlearn_catalogue_sync_writer;
REVOKE CREATE ON SCHEMA novlearn_admin_private FROM novlearn_catalogue_sync_writer;
GRANT novlearn_catalogue_sync_writer TO postgres WITH INHERIT FALSE, SET FALSE;

REVOKE ALL ON FUNCTION novlearn_admin_private.catalogue_sync_target_state(text,uuid),
  novlearn_admin_private.inspect_catalogue_sync_item(text,uuid),
  novlearn_admin_private.catalogue_sync_target_contract(),
  novlearn_admin_private.observe_catalogue_sync_batch(uuid,text),
  novlearn_admin_private.apply_catalogue_sync_batch(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,novlearn_publication_executor;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.inspect_catalogue_sync_item(text,uuid),
  novlearn_admin_private.catalogue_sync_target_contract(),
  novlearn_admin_private.observe_catalogue_sync_batch(uuid,text),
  novlearn_admin_private.apply_catalogue_sync_batch(uuid,text,jsonb)
  TO novlearn_publication_executor;
DO $publication_function_ownership$
DECLARE function_oid oid; function_owner text;
BEGIN
  FOREACH function_oid IN ARRAY ARRAY[
    to_regprocedure('public.inspect_exercise_publication(jsonb,text)')::oid,
    to_regprocedure('public.apply_exercise_publication(jsonb,text,text)')::oid
  ] LOOP
    IF function_oid IS NOT NULL THEN
      SELECT pg_get_userbyid(proowner) INTO function_owner FROM pg_proc WHERE oid=function_oid;
      IF function_owner NOT IN ('postgres','novlearn_publication_writer') THEN
        RAISE EXCEPTION 'unexpected owner for legacy publication function: %',function_owner;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS(SELECT FROM pg_auth_members WHERE roleid='novlearn_publication_writer'::regrole
      AND member='postgres'::regrole AND grantor='postgres'::regrole) THEN
    RAISE EXCEPTION 'unexpected pre-existing migration membership for novlearn_publication_writer';
  END IF;
END;
$publication_function_ownership$;

-- The legacy publication RPCs are owned by this bounded role on Supabase.
-- Use a temporary, grantor-scoped SET membership so the executor grant can be
-- revoked without depending on postgres owning those functions.
GRANT novlearn_publication_writer TO postgres WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE novlearn_publication_writer;
DO $$ BEGIN
  IF to_regprocedure('public.inspect_exercise_publication(jsonb,text)') IS NOT NULL AND
     (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.inspect_exercise_publication(jsonb,text)'))='novlearn_publication_writer' THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.inspect_exercise_publication(jsonb,text) FROM novlearn_publication_executor';
  END IF;
  IF to_regprocedure('public.apply_exercise_publication(jsonb,text,text)') IS NOT NULL AND
     (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.apply_exercise_publication(jsonb,text,text)'))='novlearn_publication_writer' THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_exercise_publication(jsonb,text,text) FROM novlearn_publication_executor';
  END IF;
END $$;
RESET ROLE;
REVOKE novlearn_publication_writer FROM postgres GRANTED BY postgres;
DO $$ BEGIN
  IF to_regprocedure('public.inspect_exercise_publication(jsonb,text)') IS NOT NULL AND
     (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.inspect_exercise_publication(jsonb,text)'))='postgres' THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.inspect_exercise_publication(jsonb,text) FROM novlearn_publication_executor';
  END IF;
  IF to_regprocedure('public.apply_exercise_publication(jsonb,text,text)') IS NOT NULL AND
     (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure('public.apply_exercise_publication(jsonb,text,text)'))='postgres' THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_exercise_publication(jsonb,text,text) FROM novlearn_publication_executor';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION novlearn_admin_private.catalogue_sync_target_state(text,uuid),
  novlearn_admin_private.publication_header(jsonb)
  TO novlearn_catalogue_sync_writer;
GRANT USAGE ON SCHEMA novlearn_admin_private TO novlearn_publication_executor;

NOTIFY pgrst,'reload schema';
COMMIT;
