-- Revenir au corps exact observé le 30 octobre ; grants et signature inchangés.
-- HISTORIQUE : corps d'origine utilisé pour comparaison, pas une procédure de rollback sûre.
-- L'archivage ne suffit pas : l'ancien lecteur ne filtre pas les archives.
-- Pour un retour encadré des deux fonctions, utiliser :
-- supabase/rollouts/20261101171424_exclude_unpublished_engine_pilots.rollback.sql
BEGIN;
CREATE OR REPLACE FUNCTION public.get_random_exercise(p_chapter text DEFAULT NULL,p_difficulty text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  exercise_data JSON;
BEGIN
  SELECT row_to_json(e) INTO exercise_data
  FROM public.exercises e
  WHERE (p_chapter IS NULL OR e.chapter = p_chapter)
    AND (p_difficulty IS NULL OR e.difficulty = p_difficulty)
  ORDER BY RANDOM()
  LIMIT 1;

  RETURN exercise_data;
END;
$function$;
COMMIT;
