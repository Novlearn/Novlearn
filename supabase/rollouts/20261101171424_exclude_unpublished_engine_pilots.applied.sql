-- Applied only to verified novlearn-staging tksvbkvfusrnxulpahky.
-- Supabase migration 20261101171424; 2026-11-01; no catalogue data changes.
DO $$ BEGIN IF md5(pg_get_functiondef('public.get_chapters_with_count(uuid)'::regprocedure)) <> '887bc36f41086cb5ec3647782cd42d04' THEN RAISE EXCEPTION 'chapter count changed; reconcile before applying'; END IF; END $$;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.get_random_exercise(text,text)'::regprocedure)) <> '14fac9361afb35bb7fa64df3649551eb' THEN
  RAISE EXCEPTION 'get_random_exercise changed; reconcile before applying';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_random_exercise(p_chapter text DEFAULT NULL,p_difficulty text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE exercise_data json;
BEGIN
 SELECT row_to_json(e) INTO exercise_data FROM public.exercises e
 WHERE (e.catalog_id IS NULL OR e.active_version_id IS NOT NULL)
   AND (p_chapter IS NULL OR e.chapter=p_chapter)
   AND (p_difficulty IS NULL OR e.difficulty=p_difficulty)
 ORDER BY random() LIMIT 1;
 RETURN exercise_data;
END $$;
CREATE OR REPLACE FUNCTION public.get_chapters_with_count(target_user_id uuid)
 RETURNS TABLE(chapter_name text, total_exercises bigint, completed_exercises bigint, progress_percentage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM target_user_id OR
    COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RAISE EXCEPTION 'own permanent identity required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT e.chapter,COUNT(DISTINCT e.id),
    COUNT(DISTINCT ea.exercise_id) FILTER(WHERE ea.user_id=target_user_id AND ea.is_correct=true),
    CASE WHEN COUNT(DISTINCT e.id)=0 THEN 0 ELSE ROUND(
      (COUNT(DISTINCT ea.exercise_id) FILTER(WHERE ea.user_id=target_user_id AND ea.is_correct=true)::numeric /
        COUNT(DISTINCT e.id)::numeric)*100,1) END
    FROM public.exercises e LEFT JOIN public.exercise_attempts ea
      ON e.id=ea.exercise_id AND ea.user_id=target_user_id
    WHERE (e.catalog_id IS NULL OR e.active_version_id IS NOT NULL)
    GROUP BY e.chapter ORDER BY e.chapter;
END;
$function$;
