BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.admin_export_catalogue_sync_item(p_kind text,p_catalog_id uuid,p_expected_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE data_value jsonb; source_value jsonb; dependencies jsonb:='[]'::jsonb; fingerprint text; action_value text:='upsert';
  e public.exercises; v public.exercise_versions; f public.flashcards; chapter_row public.chapters; skill text; dependency_catalog_id uuid; chapter_name text; n integer;
  status_value text; archived_at timestamptz;
BEGIN
  IF NOT public.is_novlearn_admin() THEN RAISE EXCEPTION 'administrator access required' USING ERRCODE='42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('exercise','chapter','competence','flashcard') OR p_catalog_id IS NULL OR
     p_expected_fingerprint IS NULL OR p_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid sync identity' USING ERRCODE='22023'; END IF;
  IF p_kind='exercise' THEN
    SELECT * INTO e FROM public.exercises WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'exercise not found' USING ERRCODE='P0002'; END IF;
    IF e.admin_archived_at IS NOT NULL THEN
      fingerprint:=encode(extensions.digest(convert_to((to_jsonb(e)-ARRAY['id','created_at','publication_epoch','synced_fingerprint_sha256','synced_at']::text[])::text,'UTF8'),'sha256'),'hex');
      IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'archive changed since review' USING ERRCODE='40001'; END IF;
      SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND id=e.active_version_id;
      RETURN jsonb_build_object('kind','exercise','catalogId',p_catalog_id,'action','archive','fingerprint',fingerprint,
        'versionId',v.id,'revision',v.revision,'definition',v.definition,'dependencies','[]'::jsonb);
    END IF;
    SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND editorial_status='ready' ORDER BY revision DESC LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN
      SELECT * INTO v FROM public.exercise_versions WHERE exercise_id=e.id AND id=e.active_version_id AND editorial_status='published' FOR SHARE;
    END IF;
    IF NOT FOUND OR (v.editorial_status='ready' AND v.ready_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint) OR
       (v.editorial_status='published' AND e.active_version_id IS DISTINCT FROM v.id) OR
       v.approval_fingerprint_sha256 IS DISTINCT FROM p_expected_fingerprint THEN
      RAISE EXCEPTION 'ready or restored revision changed or missing' USING ERRCODE='40001'; END IF;
    chapter_name:=v.definition->'catalogue'->>'chapter';
    IF chapter_name IS NOT NULL AND chapter_name<>'' THEN
      SELECT count(*) INTO n FROM public.chapters ch WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases);
      SELECT ch.catalog_id INTO dependency_catalog_id FROM public.chapters ch WHERE ch.id::text=chapter_name OR lower(ch.name)=lower(chapter_name) OR chapter_name=ANY(ch.aliases) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=dependency_catalog_id AND editorial_status IN ('draft','ready','published') AND admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'chapter dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',dependency_catalog_id,'sourceRef',chapter_name));
    END IF;
    FOR skill IN SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v.definition->'catalogue'->'skills')='array' THEN v.definition->'catalogue'->'skills' ELSE '[]'::jsonb END) LOOP
      SELECT count(*) INTO n FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill);
      SELECT c.catalog_id INTO dependency_catalog_id FROM public.competences c WHERE c.id=skill OR lower(c.name)=lower(skill) LIMIT 1;
      IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.competences co WHERE co.catalog_id=dependency_catalog_id AND co.editorial_status IN ('draft','ready','published') AND co.admin_archived_at IS NULL) THEN
        RAISE EXCEPTION 'competence dependency is absent, ambiguous, or not ready' USING ERRCODE='23503'; END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_build_object('kind','competence','catalogId',dependency_catalog_id,'sourceId',skill));
    END LOOP;
    data_value:=jsonb_build_object('catalogId',e.catalog_id,'revision',v.revision,'definition',v.definition,
      'header',jsonb_build_object('title',e.title,'chapter',e.chapter,'difficulty',e.difficulty,'competences',e.competences,
        'appTitle',e.app_title,'isFlash',e."Is_Flash",'needCalculator',e."Need_Calculator"));
    fingerprint:=v.approval_fingerprint_sha256;
  ELSIF p_kind='chapter' THEN
    SELECT * INTO chapter_row FROM public.chapters WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chapter not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN c.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',chapter_row.catalog_id,'name',chapter_row.name,'aliases',chapter_row.aliases,'emoji',chapter_row.emoji,'orderIndex',chapter_row.order_index);
    source_value:=to_jsonb(chapter_row)-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
  ELSIF p_kind='competence' THEN
    SELECT (to_jsonb(co)||jsonb_build_object('chapter_catalog_id',ch.catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[],
      jsonb_build_object('catalogId',co.catalog_id,'id',co.id,'name',co.name,'chapterCatalogId',ch.catalog_id,'maxPoints',co.max_points),co.editorial_status,ch.editorial_status,co.admin_archived_at
      INTO source_value,data_value,status_value,skill,archived_at FROM public.competences co JOIN public.chapters ch ON ch.id=co.chapter_id WHERE co.catalog_id=p_catalog_id FOR SHARE OF co;
    IF data_value IS NULL THEN RAISE EXCEPTION 'competence or chapter reference not found' USING ERRCODE='P0002'; END IF;
    action_value:=CASE WHEN archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',data_value->'chapterCatalogId','sourceId',source_value->>'chapter_id'));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND skill NOT IN ('draft','ready','published') THEN RAISE EXCEPTION 'chapter dependency is not ready' USING ERRCODE='23503'; END IF;
  ELSE
    SELECT * INTO f FROM public.flashcards WHERE catalog_id=p_catalog_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'flashcard not found' USING ERRCODE='P0002'; END IF;
    SELECT count(*) INTO n FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases);
    SELECT ch.catalog_id INTO dependency_catalog_id FROM public.chapters ch WHERE lower(ch.name)=lower(f.chapter) OR f.chapter=ANY(ch.aliases) LIMIT 1;
    IF n<>1 THEN RAISE EXCEPTION 'flashcard chapter is missing or ambiguous' USING ERRCODE='23503'; END IF;
    action_value:=CASE WHEN f.admin_archived_at IS NULL THEN 'upsert' ELSE 'archive' END;
    data_value:=jsonb_build_object('catalogId',f.catalog_id,'question',f.question,'answer',f.answer,'chapterCatalogId',dependency_catalog_id);
    source_value:=(to_jsonb(f)||jsonb_build_object('chapter_catalog_id',dependency_catalog_id))-ARRAY['admin_epoch','editorial_status','ready_at','ready_by','synced_fingerprint_sha256','synced_at']::text[];
    dependencies:=jsonb_build_array(jsonb_build_object('kind','chapter','catalogId',dependency_catalog_id,'sourceRef',f.chapter));
    fingerprint:=encode(extensions.digest(convert_to(source_value::text,'UTF8'),'sha256'),'hex');
    IF action_value='upsert' AND NOT EXISTS(SELECT 1 FROM public.chapters WHERE catalog_id=dependency_catalog_id AND editorial_status IN ('draft','ready','published') AND admin_archived_at IS NULL) THEN
      RAISE EXCEPTION 'flashcard chapter dependency is not ready' USING ERRCODE='23503'; END IF;
  END IF;
  IF fingerprint IS DISTINCT FROM p_expected_fingerprint THEN RAISE EXCEPTION 'catalogue item changed since review' USING ERRCODE='40001'; END IF;
  IF action_value='upsert' AND p_kind<>'exercise' AND NOT EXISTS(
    SELECT 1 FROM (SELECT editorial_status,ready_at,ready_by FROM public.chapters WHERE p_kind='chapter' AND catalog_id=p_catalog_id
      UNION ALL SELECT editorial_status,ready_at,ready_by FROM public.competences WHERE p_kind='competence' AND catalog_id=p_catalog_id
      UNION ALL SELECT editorial_status,ready_at,ready_by FROM public.flashcards WHERE p_kind='flashcard' AND catalog_id=p_catalog_id) s
    WHERE s.editorial_status='ready' AND s.ready_at IS NOT NULL AND s.ready_by IS NOT NULL) THEN
    RAISE EXCEPTION 'catalogue item is not ready' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('kind',p_kind,'catalogId',p_catalog_id,'action',action_value,'fingerprint',fingerprint,
    'versionId',CASE WHEN p_kind='exercise' THEN v.id END,'revision',CASE WHEN p_kind='exercise' THEN v.revision END,
    'data',data_value,'dependencies',dependencies);
END;
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
