-- Admin editorial operations only. No learner data conversion or deletion.
BEGIN;
ALTER TABLE public.exercises ADD COLUMN admin_archived_at timestamptz;
CREATE INDEX exercises_admin_catalogue_idx ON public.exercises (created_at DESC, id DESC);

-- Existing legacy SELECT policies must not reveal newly created draft parents.
CREATE POLICY novlearn_anon_hide_unpublished_canonical ON public.exercises
  AS RESTRICTIVE FOR SELECT TO anon USING (catalog_id IS NULL OR active_version_id IS NOT NULL);
CREATE POLICY novlearn_user_hide_unpublished_canonical ON public.exercises
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    catalog_id IS NULL OR active_version_id IS NOT NULL OR (SELECT public.is_novlearn_admin())
  );

CREATE POLICY novlearn_admin_insert_canonical_exercises ON public.exercises
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.is_novlearn_admin()) AND catalog_id IS NOT NULL AND content = '{}'::jsonb
  );
CREATE POLICY novlearn_admin_update_exercise_catalogue ON public.exercises
  FOR UPDATE TO authenticated USING ((SELECT public.is_novlearn_admin()))
  WITH CHECK ((SELECT public.is_novlearn_admin()));
GRANT SELECT, INSERT, UPDATE ON public.exercises TO authenticated;
GRANT USAGE ON SEQUENCE public.exercises_id_seq TO authenticated;

CREATE TABLE public.admin_content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  exercise_id bigint NOT NULL REFERENCES public.exercises(id) ON DELETE RESTRICT,
  version_id uuid REFERENCES public.exercise_versions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('draft_created', 'draft_saved', 'archived', 'restored')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_content_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_content_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.admin_content_events TO authenticated;
CREATE POLICY novlearn_admin_read_content_events ON public.admin_content_events
  FOR SELECT TO authenticated USING ((SELECT public.is_novlearn_admin()));
CREATE POLICY novlearn_admin_insert_content_events ON public.admin_content_events
  FOR INSERT TO authenticated WITH CHECK (
    (SELECT public.is_novlearn_admin()) AND actor_id = (SELECT auth.uid())
  );
CREATE INDEX admin_content_events_exercise_idx ON public.admin_content_events (exercise_id, occurred_at DESC);

CREATE FUNCTION public.admin_save_exercise_draft(
  p_exercise_id bigint, p_version_id uuid, p_expected_fingerprint text, p_definition jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE parent public.exercises; candidate public.exercise_versions; next_revision integer;
  canonical jsonb; event_action text;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_definition) IS DISTINCT FROM 'object'
    OR p_definition->>'schemaVersion' IS DISTINCT FROM '5'
    OR p_definition->>'kind' IS DISTINCT FROM 'composed'
    OR pg_catalog.jsonb_typeof(p_definition->'title') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_definition->>'title')) NOT BETWEEN 1 AND 160
    OR pg_catalog.octet_length(p_definition::text) > 262144
  THEN RAISE EXCEPTION 'invalid canonical draft envelope' USING ERRCODE = '22023'; END IF;

  IF p_exercise_id IS NULL THEN
    IF p_version_id IS NOT NULL OR p_expected_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'new exercise cannot target a revision' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.exercises(catalog_id,title,chapter,content)
      VALUES(gen_random_uuid(),p_definition->>'title',COALESCE(p_definition->'catalogue'->>'chapter',''),'{}')
      RETURNING * INTO parent;
  ELSE
    SELECT * INTO parent FROM public.exercises WHERE id=p_exercise_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found' USING ERRCODE = 'P0002'; END IF;
    IF parent.catalog_id IS NULL THEN
      RAISE EXCEPTION 'legacy content requires explicit migration' USING ERRCODE = '22023';
    END IF;
    IF parent.admin_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'archived exercise is read only' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF p_version_id IS NOT NULL THEN
    SELECT * INTO candidate FROM public.exercise_versions
      WHERE id=p_version_id AND exercise_id=parent.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002'; END IF;
    IF candidate.editorial_status <> 'draft' OR p_expected_fingerprint IS NULL
      OR candidate.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
      RAISE EXCEPTION 'draft changed or is no longer editable' USING ERRCODE = '40001';
    END IF;
    canonical := p_definition || pg_catalog.jsonb_build_object('id',parent.catalog_id::text,'revision',candidate.revision::text);
    UPDATE public.exercise_versions SET definition=canonical,updated_by=(SELECT auth.uid())
      WHERE id=candidate.id RETURNING * INTO candidate;
    event_action := 'draft_saved';
  ELSE
    IF p_expected_fingerprint IS NOT NULL THEN
      RAISE EXCEPTION 'new revision cannot carry an old fingerprint' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(max(revision),0)+1 INTO next_revision FROM public.exercise_versions WHERE exercise_id=parent.id;
    canonical := p_definition || pg_catalog.jsonb_build_object('id',parent.catalog_id::text,'revision',next_revision::text);
    INSERT INTO public.exercise_versions(exercise_id,revision,definition,engine_contract,generation_version,
      canonicalization_version,definition_sha256,approval_fingerprint_sha256,created_by,updated_by)
      VALUES(parent.id,next_revision,canonical,'schema-5;engine-0.1.0','mulberry32-rejection-v1',
        'pg-jsonb-text-v1',repeat('0',64),repeat('0',64),(SELECT auth.uid()),(SELECT auth.uid()))
      RETURNING * INTO candidate;
    event_action := 'draft_created';
  END IF;
  INSERT INTO public.admin_content_events(actor_id,exercise_id,version_id,action)
    VALUES((SELECT auth.uid()),parent.id,candidate.id,event_action);
  RETURN pg_catalog.jsonb_build_object('exerciseId',parent.id::text,'versionId',candidate.id,
    'revision',candidate.revision,'fingerprint',candidate.approval_fingerprint_sha256);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_save_exercise_draft(bigint,uuid,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_exercise_draft(bigint,uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.admin_duplicate_exercise(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE source jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT definition INTO source FROM public.exercise_versions WHERE id=p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version not found' USING ERRCODE = 'P0002'; END IF;
  source := source || pg_catalog.jsonb_build_object('title',left(source->>'title',151)||' (copie)');
  RETURN public.admin_save_exercise_draft(NULL,NULL,NULL,source);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_duplicate_exercise(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_duplicate_exercise(uuid) TO authenticated;

CREATE FUNCTION public.admin_archive_exercise(p_exercise_id bigint,p_expected_archived boolean,p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE parent public.exercises;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_archived IS NULL OR p_archived IS NULL THEN
    RAISE EXCEPTION 'archive state required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO parent FROM public.exercises WHERE id=p_exercise_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found' USING ERRCODE = 'P0002'; END IF;
  IF (parent.admin_archived_at IS NOT NULL) IS DISTINCT FROM p_expected_archived THEN
    RAISE EXCEPTION 'archive state changed' USING ERRCODE = '40001';
  END IF;
  IF p_expected_archived = p_archived THEN RETURN; END IF;
  UPDATE public.exercises SET admin_archived_at=CASE WHEN p_archived THEN pg_catalog.now() ELSE NULL END
    WHERE id=parent.id;
  INSERT INTO public.admin_content_events(actor_id,exercise_id,action)
    VALUES((SELECT auth.uid()),parent.id,CASE WHEN p_archived THEN 'archived' ELSE 'restored' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_archive_exercise(bigint,boolean,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_archive_exercise(bigint,boolean,boolean) TO authenticated;
CREATE FUNCTION public.admin_list_exercises(p_query text DEFAULT '',p_status text DEFAULT 'all',
  p_sort text DEFAULT 'recent',p_offset integer DEFAULT 0,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_novlearn_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_query IS NULL OR length(p_query)>120 OR p_status IS NULL
    OR p_status NOT IN ('all','draft','in_review','approved','published','legacy','archived')
    OR p_sort IS NULL OR p_sort NOT IN ('recent','title')
    OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 249975
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid catalogue filter' USING ERRCODE = '22023';
  END IF;
  WITH catalogue AS (
    SELECT e.id,e.catalog_id,e.active_version_id,e.admin_archived_at,
      COALESCE(v.definition->>'title',e.title,'Exercice sans titre') AS title,
      COALESCE(v.definition->'catalogue'->>'appTitle',e.app_title,v.definition->>'title',e.title,'') AS app_title,
      COALESCE(v.definition->'catalogue'->>'chapter',e.chapter) AS chapter,
      COALESCE(v.definition->'catalogue'->>'difficulty',e.difficulty,'') AS difficulty,
      CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array'
        THEN v.definition->'catalogue'->'skills' ELSE to_jsonb(COALESCE(e.competences,ARRAY[]::text[])) END AS skills,
      COALESCE(v.definition->'catalogue'->>'exerciseType',CASE WHEN e."Is_Flash" THEN 'flash' ELSE 'classic' END) AS exercise_type,
      COALESCE(v.definition->'catalogue'->'needsCalculator',to_jsonb(COALESCE(e."Need_Calculator",false))) AS needs_calculator,
      CASE WHEN e.admin_archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(v.editorial_status,'legacy') END AS status,
      v.id AS version_id,v.revision,COALESCE(v.updated_at,e.created_at) AS updated_at
    FROM public.exercises e LEFT JOIN LATERAL (
      SELECT id,revision,definition,editorial_status,updated_at FROM public.exercise_versions
      WHERE exercise_id=e.id ORDER BY revision DESC LIMIT 1
    ) v ON true
  ), filtered AS (
    SELECT * FROM catalogue WHERE (p_status='all' OR status=p_status)
      AND (p_query='' OR strpos(lower(title),lower(p_query))>0 OR strpos(lower(app_title),lower(p_query))>0
        OR id::text=p_query OR catalog_id::text=p_query)
  ), page AS (
    SELECT * FROM filtered ORDER BY CASE WHEN p_sort='title' THEN lower(title) END,
      CASE WHEN p_sort='recent' THEN updated_at END DESC NULLS LAST,id DESC
      OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'items',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',id::text,'catalogId',catalog_id,'title',title,'appTitle',app_title,
      'chapter',chapter,'difficulty',difficulty,'skills',skills,'exerciseType',exercise_type,
      'needsCalculator',needs_calculator,'status',status,'revision',revision,'versionId',version_id,
      'activeVersionId',active_version_id,'archived',admin_archived_at IS NOT NULL,'updatedAt',updated_at)
      ORDER BY CASE WHEN p_sort='title' THEN lower(title) END,
        CASE WHEN p_sort='recent' THEN updated_at END DESC NULLS LAST,id DESC) FROM page
  ),'[]'::jsonb)) INTO result;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_exercises(text,text,text,integer,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_exercises(text,text,text,integer,integer) TO authenticated;
COMMIT;
