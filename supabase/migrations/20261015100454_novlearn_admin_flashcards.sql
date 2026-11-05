BEGIN;
ALTER TABLE public.flashcards ADD COLUMN admin_epoch bigint NOT NULL DEFAULT 0 CHECK(admin_epoch>=0);
CREATE INDEX flashcards_admin_list_idx ON public.flashcards(created_at DESC,id);
CREATE INDEX flashcards_chapter_admin_idx ON public.flashcards(chapter);
-- The current learner uses exact chapter names for flashcards. Keep that link.
CREATE FUNCTION novlearn_admin_private.keep_flashcard_chapter_name() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.name IS DISTINCT FROM OLD.name AND EXISTS(SELECT 1 FROM public.flashcards WHERE chapter=OLD.name) THEN
  RAISE EXCEPTION 'chapter name is referenced by flashcards' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.keep_flashcard_chapter_name() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER keep_flashcard_chapter_name BEFORE UPDATE OF name ON public.chapters FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.keep_flashcard_chapter_name();
CREATE FUNCTION novlearn_admin_private.flashcard_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'flashcard identity is immutable' USING ERRCODE='22023'; END IF;
  NEW.admin_epoch:=OLD.admin_epoch+1;
 ELSE NEW.admin_epoch:=0; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION novlearn_admin_private.flashcard_epoch() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER admin_flashcard_epoch BEFORE INSERT OR UPDATE ON public.flashcards FOR EACH ROW EXECUTE FUNCTION novlearn_admin_private.flashcard_epoch();
CREATE TABLE public.admin_flashcard_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 flashcard_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('created','updated','deleted')),
 before_value jsonb,after_value jsonb,occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_flashcard_events_entity_idx ON public.admin_flashcard_events(flashcard_id,occurred_at DESC);
ALTER TABLE public.admin_flashcard_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_flashcard_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.admin_flashcard_events TO authenticated;
CREATE POLICY admin_read_flashcard_events ON public.admin_flashcard_events FOR SELECT TO authenticated USING((SELECT public.is_novlearn_admin()));
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.flashcards FROM PUBLIC,anon,authenticated;

CREATE FUNCTION novlearn_admin_private.flashcard_item(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',f.id,'chapter',f.chapter,'chapterId',CASE WHEN matches.n=1 THEN matches.id ELSE NULL END,
  'question',f.question,'answer',f.answer,'createdAt',f.created_at,
  'fingerprint',encode(extensions.digest(to_jsonb(f)::text,'sha256'),'hex'))
 FROM public.flashcards f CROSS JOIN LATERAL(
  SELECT count(*) n,min(c.id::text) id FROM public.chapters c WHERE c.id::text=f.chapter OR c.name=f.chapter OR f.chapter=ANY(c.aliases)
 ) matches WHERE f.id=p_id;
$$;
REVOKE ALL ON FUNCTION novlearn_admin_private.flashcard_item(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.admin_list_flashcards(p_query text DEFAULT '',p_chapter uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tokens text[]; items jsonb; choices jsonb; total bigint;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
 IF p_query IS NULL OR length(p_query)>120 OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'invalid filter' USING ERRCODE='22023'; END IF;
 IF p_chapter IS NOT NULL THEN SELECT ARRAY[c.id::text,c.name]||coalesce(c.aliases,'{}') INTO tokens FROM public.chapters c WHERE id=p_chapter; END IF;
 SELECT count(*) INTO total FROM public.flashcards WHERE (p_chapter IS NULL OR chapter=ANY(tokens)) AND
  (p_query='' OR position(lower(p_query) IN lower(question||' '||answer||' '||id::text))>0);
 SELECT coalesce(jsonb_agg(novlearn_admin_private.flashcard_item(f.id) ORDER BY f.created_at DESC NULLS LAST,f.id DESC),'[]'::jsonb) INTO items FROM
  (SELECT id,created_at FROM public.flashcards WHERE (p_chapter IS NULL OR chapter=ANY(tokens)) AND
   (p_query='' OR position(lower(p_query) IN lower(question||' '||answer||' '||id::text))>0) ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 25 OFFSET p_offset) f;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY order_index,name,id),'[]'::jsonb) INTO choices FROM public.chapters;
 RETURN jsonb_build_object('items',items,'total',total,'chapters',choices);
END; $$;

CREATE FUNCTION public.admin_mutate_flashcard(p_action text,p_id uuid,p_expected text,p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row public.flashcards; after_row public.flashcards; chapter_row public.chapters; action_name text; chosen uuid; matches bigint;
BEGIN
 IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator required' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('save','delete') THEN RAISE EXCEPTION 'invalid action' USING ERRCODE='22023'; END IF;
 -- Serialize name mapping with taxonomy edits/deletes; unrelated cards use row locks.
 LOCK TABLE public.chapters IN SHARE MODE;
 IF p_id IS NULL THEN
  IF p_action='delete' OR p_expected IS NOT NULL THEN RAISE EXCEPTION 'invalid new identity' USING ERRCODE='22023'; END IF;
 ELSE
  SELECT * INTO before_row FROM public.flashcards WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'flashcard not found' USING ERRCODE='P0002'; END IF;
  IF p_expected IS DISTINCT FROM encode(extensions.digest(to_jsonb(before_row)::text,'sha256'),'hex') THEN RAISE EXCEPTION 'flashcard state changed' USING ERRCODE='40001'; END IF;
 END IF;
 IF p_action='delete' THEN
  IF p_value IS NOT NULL THEN RAISE EXCEPTION 'delete cannot contain replacement content' USING ERRCODE='22023'; END IF;
  DELETE FROM public.flashcards WHERE id=p_id;chosen:=p_id;action_name:='deleted';
 ELSE
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR octet_length(p_value::text)>65536 THEN RAISE EXCEPTION 'invalid flashcard value' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_value))<>3 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('chapterId','question','answer')) OR
    jsonb_typeof(p_value->'chapterId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_value->'question') IS DISTINCT FROM 'string' OR jsonb_typeof(p_value->'answer') IS DISTINCT FROM 'string' OR
    length(p_value->>'question') NOT BETWEEN 1 AND 4000 OR length(btrim(p_value->>'question'))=0 OR length(p_value->>'answer') NOT BETWEEN 1 AND 4000 OR length(btrim(p_value->>'answer'))=0
  THEN RAISE EXCEPTION 'invalid flashcard fields' USING ERRCODE='22023'; END IF;
  SELECT * INTO chapter_row FROM public.chapters WHERE id=(p_value->>'chapterId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'chapter not found' USING ERRCODE='23503'; END IF;
  SELECT count(*) INTO matches FROM public.chapters WHERE id::text=chapter_row.name OR name=chapter_row.name OR chapter_row.name=ANY(aliases);
  IF matches<>1 THEN RAISE EXCEPTION 'ambiguous chapter name' USING ERRCODE='23505'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO public.flashcards(chapter,question,answer) VALUES(chapter_row.name,p_value->>'question',p_value->>'answer') RETURNING * INTO after_row; action_name:='created';
  ELSE
   UPDATE public.flashcards SET chapter=chapter_row.name,question=p_value->>'question',answer=p_value->>'answer' WHERE id=p_id RETURNING * INTO after_row; action_name:='updated';
  END IF;
  chosen:=after_row.id;
 END IF;
 INSERT INTO public.admin_flashcard_events(actor_id,flashcard_id,action,before_value,after_value) VALUES(auth.uid(),chosen,action_name,
  CASE WHEN p_id IS NULL THEN NULL ELSE to_jsonb(before_row)-'admin_epoch' END,
  CASE WHEN p_action='delete' THEN NULL ELSE to_jsonb(after_row)-'admin_epoch' END);
 RETURN jsonb_build_object('id',chosen,'action',action_name,'item',novlearn_admin_private.flashcard_item(chosen));
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_flashcards(text,uuid,integer),public.admin_mutate_flashcard(text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_flashcards(text,uuid,integer),public.admin_mutate_flashcard(text,uuid,text,jsonb) TO authenticated;
COMMIT;
