BEGIN;
ALTER TABLE public.chapters ADD COLUMN admin_epoch bigint NOT NULL DEFAULT 0 CHECK(admin_epoch>=0);
ALTER TABLE public.competences ADD COLUMN admin_epoch bigint NOT NULL DEFAULT 0 CHECK(admin_epoch>=0);
CREATE FUNCTION novlearn_admin_private.taxonomy_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'taxonomy identity is immutable' USING ERRCODE='22023'; END IF;
    NEW.admin_epoch:=OLD.admin_epoch+1;
  ELSE NEW.admin_epoch:=0; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.taxonomy_epoch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER admin_chapter_epoch BEFORE INSERT OR UPDATE ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.taxonomy_epoch();
CREATE TRIGGER admin_competence_epoch BEFORE INSERT OR UPDATE ON public.competences FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.taxonomy_epoch();

CREATE TABLE public.admin_taxonomy_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entity_kind text NOT NULL CHECK(entity_kind IN ('chapter','competence')),entity_id text NOT NULL,
  action text NOT NULL CHECK(action IN ('created','updated','deleted')),
  before_value jsonb, after_value jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_taxonomy_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_taxonomy_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.admin_taxonomy_events TO authenticated;
CREATE POLICY admin_read_taxonomy_events ON public.admin_taxonomy_events FOR SELECT TO authenticated USING((SELECT public.is_novlearn_admin()));
CREATE INDEX admin_taxonomy_events_entity_idx ON public.admin_taxonomy_events(entity_kind,entity_id,occurred_at DESC);
-- Keep API writes behind the checked functions; no new table write grant.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.chapters,public.competences FROM PUBLIC,anon,authenticated;

-- Count dependencies only; never return student identities or answer definitions.
CREATE FUNCTION novlearn_admin_private.taxonomy_usage(p_kind text,p_id text,p_tokens text[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
WITH exercise_refs AS (
 SELECT e.id FROM public.exercises e WHERE
 (p_kind='chapter' AND e.chapter=ANY(p_tokens)) OR
 (p_kind='competence' AND (e.competence_id=ANY(p_tokens) OR e.competences && p_tokens)) OR
 EXISTS(SELECT 1 FROM unnest(p_tokens) t WHERE jsonb_path_exists(e.content,'$.** ? (@ == $token)',jsonb_build_object('token',t)))
), version_refs AS (
 SELECT v.exercise_id FROM public.exercise_versions v WHERE
 (p_kind='chapter' AND v.definition->'catalogue'->>'chapter'=ANY(p_tokens)) OR
 (p_kind='competence' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) s WHERE s=ANY(p_tokens)))
), all_exercises AS (SELECT id FROM exercise_refs UNION SELECT exercise_id FROM version_refs)
SELECT jsonb_build_object(
 'exercises',(SELECT count(*) FROM all_exercises),'revisions',(SELECT count(*) FROM version_refs),
 'competences',(SELECT count(*) FROM public.competences WHERE p_kind='chapter' AND chapter_id::text=p_id),
 'flashcards',(SELECT count(*) FROM public.flashcards WHERE p_kind='chapter' AND chapter=ANY(p_tokens)),
 'scores',(SELECT count(*) FROM public.user_competence_scores WHERE p_kind='competence' AND competence_id=p_id)+(SELECT count(*) FROM public.ds_competence_scores WHERE p_kind='competence' AND competence_id=p_id),
 'exerciseIds',COALESCE((SELECT jsonb_agg(id::text ORDER BY id) FROM (SELECT id FROM all_exercises ORDER BY id LIMIT 25) sample),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION novlearn_admin_private.taxonomy_usage(text,text,text[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION novlearn_admin_private.taxonomy_item(p_kind text,p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE value jsonb; tokens text[];
BEGIN
 IF p_kind='chapter' THEN
  SELECT to_jsonb(c),ARRAY[c.id::text,c.name]||coalesce(c.aliases,'{}') INTO value,tokens FROM public.chapters c WHERE c.id::text=p_id;
 ELSIF p_kind='competence' THEN
  SELECT to_jsonb(c),ARRAY[c.id,c.name] INTO value,tokens FROM public.competences c WHERE c.id=p_id;
 ELSE RAISE EXCEPTION 'invalid taxonomy kind' USING ERRCODE='22023'; END IF;
 IF value IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('id',p_id,'value',value-'admin_epoch','fingerprint',encode(extensions.digest(value::text,'sha256'),'hex'),'usage',novlearn_admin_private.taxonomy_usage(p_kind,p_id,tokens));
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.taxonomy_item(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.admin_list_taxonomy(p_kind text,p_query text DEFAULT '',p_chapter uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; total bigint; choices jsonb;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('chapter','competence') OR p_kind IS NULL OR length(p_query)>120 OR p_query IS NULL OR p_offset<0 OR p_offset>100000 OR p_offset IS NULL THEN RAISE EXCEPTION 'invalid filter' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY order_index,name,id),'[]'::jsonb) INTO choices FROM public.chapters;
 IF p_kind='chapter' THEN
  SELECT count(*) INTO total FROM public.chapters c WHERE position(lower(p_query) IN lower(c.name||' '||c.id::text||' '||coalesce(array_to_string(c.aliases,' '),'')))>0 OR p_query='';
  SELECT coalesce(jsonb_agg(novlearn_admin_private.taxonomy_item('chapter',c.id::text) ORDER BY c.order_index,c.name,c.id),'[]'::jsonb) INTO rows FROM
   (SELECT * FROM public.chapters WHERE p_query='' OR position(lower(p_query) IN lower(name||' '||id::text||' '||coalesce(array_to_string(aliases,' '),'')))>0 ORDER BY order_index,name,id LIMIT 25 OFFSET p_offset) c;
 ELSE
  SELECT count(*) INTO total FROM public.competences WHERE (p_chapter IS NULL OR chapter_id=p_chapter) AND (p_query='' OR position(lower(p_query) IN lower(name||' '||id))>0);
  SELECT coalesce(jsonb_agg(novlearn_admin_private.taxonomy_item('competence',c.id) ORDER BY c.name,c.id),'[]'::jsonb) INTO rows FROM
   (SELECT * FROM public.competences WHERE (p_chapter IS NULL OR chapter_id=p_chapter) AND (p_query='' OR position(lower(p_query) IN lower(name||' '||id))>0) ORDER BY name,id LIMIT 25 OFFSET p_offset) c;
 END IF;
 RETURN jsonb_build_object('items',rows,'total',total,'chapters',choices);
END; $$;

CREATE FUNCTION public.admin_mutate_taxonomy(p_kind text,p_action text,p_id text,p_expected text,p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_item jsonb; after_item jsonb; old_value jsonb; new_id text; tokens text[]; removed text[]; dependencies jsonb; chapter uuid; event_action text;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('chapter','competence') OR p_action IS NULL OR p_action NOT IN ('save','delete') THEN RAISE EXCEPTION 'invalid action' USING ERRCODE='22023'; END IF;
 -- Rare administrative changes serialize with all writers of non-FK references.
 -- No student tables are modified. Their locks only close the delete/count race.
 LOCK TABLE public.chapters,public.competences,public.exercises,public.exercise_versions,public.flashcards,public.user_competence_scores,public.ds_competence_scores IN SHARE ROW EXCLUSIVE MODE;
 IF p_id IS NOT NULL THEN
  before_item:=novlearn_admin_private.taxonomy_item(p_kind,p_id);
  IF before_item IS NULL THEN RAISE EXCEPTION 'taxonomy row not found' USING ERRCODE='P0002'; END IF;
  IF p_expected IS DISTINCT FROM before_item->>'fingerprint' THEN RAISE EXCEPTION 'taxonomy state changed' USING ERRCODE='40001'; END IF;
  old_value:=before_item->'value';
 ELSIF p_expected IS NOT NULL OR p_action='delete' THEN RAISE EXCEPTION 'invalid new identity' USING ERRCODE='22023'; END IF;
 IF p_action='delete' THEN
  dependencies:=before_item->'usage';
  IF (dependencies->>'exercises')::bigint+(dependencies->>'revisions')::bigint+(dependencies->>'competences')::bigint+(dependencies->>'flashcards')::bigint+(dependencies->>'scores')::bigint>0 THEN RAISE EXCEPTION 'taxonomy is referenced' USING ERRCODE='23503'; END IF;
  IF p_kind='chapter' THEN DELETE FROM public.chapters WHERE id::text=p_id; ELSE DELETE FROM public.competences WHERE id=p_id; END IF;
  new_id:=p_id; event_action:='deleted';
 ELSE
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR jsonb_typeof(p_value->'name') IS DISTINCT FROM 'string' OR length(btrim(p_value->>'name')) NOT BETWEEN 1 AND 120 OR octet_length(p_value::text)>16384 THEN RAISE EXCEPTION 'invalid taxonomy value' USING ERRCODE='22023'; END IF;
  IF p_kind='chapter' THEN
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('name','aliases','emoji','order_index')) OR jsonb_typeof(p_value->'aliases') IS DISTINCT FROM 'array' OR jsonb_array_length(p_value->'aliases')>32 OR jsonb_typeof(p_value->'emoji') IS DISTINCT FROM 'string' OR length(p_value->>'emoji')>16 OR jsonb_typeof(p_value->'order_index') IS DISTINCT FROM 'number' OR (p_value->>'order_index') !~ '^-?[0-9]{1,10}$' THEN RAISE EXCEPTION 'invalid chapter fields' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'aliases') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(btrim(v#>>'{}')) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'invalid alias' USING ERRCODE='22023'; END IF;
   SELECT coalesce(array_agg(DISTINCT btrim(v)),'{}') INTO tokens FROM jsonb_array_elements_text(p_value->'aliases') v;
   IF old_value IS NOT NULL AND old_value->>'name'<>btrim(p_value->>'name') THEN tokens:=array_append(tokens,old_value->>'name'); END IF;
   IF cardinality(tokens)>32 THEN RAISE EXCEPTION 'too many retained aliases' USING ERRCODE='22023'; END IF;
   new_id:=coalesce(p_id,gen_random_uuid()::text);
   IF EXISTS(SELECT 1 FROM public.chapters c WHERE c.id::text<>new_id AND (ARRAY[c.id::text,c.name]||coalesce(c.aliases,'{}')) && (ARRAY[new_id,btrim(p_value->>'name')]||tokens)) THEN RAISE EXCEPTION 'ambiguous chapter identity' USING ERRCODE='23505'; END IF;
   SELECT coalesce(array_agg(v),'{}') INTO removed FROM jsonb_array_elements_text(coalesce(old_value->'aliases','[]')) v WHERE NOT v=ANY(tokens||ARRAY[btrim(p_value->>'name')]);
   dependencies:=novlearn_admin_private.taxonomy_usage('chapter',NULL,removed);
   IF (dependencies->>'exercises')::bigint+(dependencies->>'revisions')::bigint+(dependencies->>'flashcards')::bigint>0 THEN RAISE EXCEPTION 'alias is referenced' USING ERRCODE='23503'; END IF;
   IF p_id IS NULL THEN INSERT INTO public.chapters(id,name,aliases,emoji,order_index) VALUES(new_id::uuid,btrim(p_value->>'name'),tokens,p_value->>'emoji',(p_value->>'order_index')::integer);
   ELSE UPDATE public.chapters SET name=btrim(p_value->>'name'),aliases=tokens,emoji=p_value->>'emoji',order_index=(p_value->>'order_index')::integer WHERE id::text=p_id; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('id','name','chapter_id','max_points')) OR jsonb_typeof(p_value->'id') IS DISTINCT FROM 'string' OR (p_value->>'id') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' OR jsonb_typeof(p_value->'chapter_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_value->'max_points') IS DISTINCT FROM 'number' OR (p_value->>'max_points') !~ '^[0-9]{1,7}$' OR (p_value->>'max_points')::integer NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'invalid competence fields' USING ERRCODE='22023'; END IF;
   new_id:=p_value->>'id'; chapter:=(p_value->>'chapter_id')::uuid;
   IF p_id IS NOT NULL AND new_id<>p_id THEN RAISE EXCEPTION 'competence identity is immutable' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.chapters WHERE id=chapter) THEN RAISE EXCEPTION 'chapter not found' USING ERRCODE='23503'; END IF;
   IF EXISTS(SELECT 1 FROM public.competences WHERE id<>new_id AND (id=btrim(p_value->>'name') OR name=btrim(p_value->>'name') OR name=new_id)) OR (p_id IS NULL AND EXISTS(SELECT 1 FROM public.competences WHERE id=new_id)) THEN RAISE EXCEPTION 'ambiguous competence identity' USING ERRCODE='23505'; END IF;
   IF old_value IS NOT NULL AND old_value->>'name'<>btrim(p_value->>'name') THEN
    dependencies:=novlearn_admin_private.taxonomy_usage('competence',NULL,ARRAY[old_value->>'name']);
    IF (dependencies->>'exercises')::bigint+(dependencies->>'revisions')::bigint>0 THEN RAISE EXCEPTION 'competence name is referenced' USING ERRCODE='23503'; END IF;
   END IF;
   IF old_value IS NOT NULL AND old_value->>'chapter_id'<>chapter::text THEN
    dependencies:=before_item->'usage';
    IF (dependencies->>'exercises')::bigint+(dependencies->>'revisions')::bigint+(dependencies->>'scores')::bigint>0 THEN RAISE EXCEPTION 'referenced competence cannot move chapters' USING ERRCODE='23503'; END IF;
   END IF;
   IF p_id IS NULL THEN INSERT INTO public.competences(id,name,chapter_id,max_points) VALUES(new_id,btrim(p_value->>'name'),chapter,(p_value->>'max_points')::integer);
   ELSE UPDATE public.competences SET name=btrim(p_value->>'name'),chapter_id=chapter,max_points=(p_value->>'max_points')::integer WHERE id=p_id; END IF;
  END IF;
  after_item:=novlearn_admin_private.taxonomy_item(p_kind,new_id);event_action:=CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END;
 END IF;
 INSERT INTO public.admin_taxonomy_events(actor_id,entity_kind,entity_id,action,before_value,after_value) VALUES(auth.uid(),p_kind,new_id,event_action,old_value,after_item->'value');
 RETURN jsonb_build_object('action',event_action,'item',after_item,'id',new_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_taxonomy(text,text,uuid,integer),public.admin_mutate_taxonomy(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_taxonomy(text,text,uuid,integer),public.admin_mutate_taxonomy(text,text,text,text,jsonb) TO authenticated;
COMMIT;
