-- PROPOSITION. Autorisation distincte requise avant application distante.
-- Ne modifie aucune ligne, ni compte, tentative, score ou version active.
BEGIN;
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
COMMIT;
