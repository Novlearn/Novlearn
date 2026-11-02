\set ON_ERROR_STOP on
-- Isolated synthetic DB. Includes exact reviewed Admin RPC and its rollback.
CREATE TABLE public.exercises(id bigint PRIMARY KEY,title text,chapter text,difficulty text,catalog_id uuid,active_version_id uuid);
INSERT INTO public.exercises VALUES
 (1,'Historical','Chapter','Facile',NULL,NULL),
 (2,'Canonical draft','Only draft','Facile','10000000-0000-4000-8000-000000000002',NULL),
 (3,'Canonical published','Chapter','Moyen','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003');
CREATE TEMP TABLE before_rows AS SELECT * FROM public.exercises;
\ir ../docs/sql-proposals/20261101-exclude-unpublished-pilots-rollback.sql
DO $$ BEGIN
 IF public.get_random_exercise('Only draft',NULL)->>'id' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Original leak not reproduced'; END IF;
END $$;
\ir ../docs/sql-proposals/20261101-exclude-unpublished-pilots.sql
DO $$ DECLARE value json; i integer; BEGIN
 IF public.get_random_exercise('Only draft',NULL) IS NOT NULL THEN RAISE EXCEPTION 'Draft served'; END IF;
 IF public.get_random_exercise('Chapter','Facile')->>'id' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Historical filter changed'; END IF;
 IF public.get_random_exercise('Chapter','Moyen')->>'id' IS DISTINCT FROM '3' THEN RAISE EXCEPTION 'Published canonical missing'; END IF;
 IF public.get_random_exercise('Missing',NULL) IS NOT NULL THEN RAISE EXCEPTION 'Chapter filter lost'; END IF;
 FOR i IN 1..1000 LOOP
  value:=public.get_random_exercise(NULL,NULL);
  IF value->>'id' IS NULL OR value->>'id' NOT IN ('1','3') THEN RAISE EXCEPTION 'Random draft leak'; END IF;
 END LOOP;
END $$;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.exercises TO service_role;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_only ON public.exercises FOR SELECT USING (catalog_id IS NULL);
SET ROLE service_role;
DO $$ BEGIN
 -- RLS cannot protect this role: reproduce that before testing explicit filters.
 IF (SELECT count(*) FROM public.exercises)<>3 THEN RAISE EXCEPTION 'Not a privileged test'; END IF;
 IF (SELECT array_agg(id ORDER BY id) FROM public.exercises WHERE catalog_id IS NULL OR active_version_id IS NOT NULL)
    IS DISTINCT FROM ARRAY[1,3]::bigint[] THEN RAISE EXCEPTION 'Privileged eligibility failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.exercises WHERE (catalog_id IS NULL OR active_version_id IS NOT NULL) AND id=2)
 THEN RAISE EXCEPTION 'Draft accepted by ID'; END IF;
 IF (SELECT array_agg(id) FROM public.exercises WHERE (catalog_id IS NULL OR active_version_id IS NOT NULL) AND chapter='Chapter' AND difficulty='Facile')
    IS DISTINCT FROM ARRAY[1]::bigint[] THEN RAISE EXCEPTION 'Privileged filters changed'; END IF;
END $$;
RESET ROLE;
-- Additional definer count leak found in Staging: exercise-only equivalent.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.exercises WHERE chapter='Only draft')<>1 THEN RAISE EXCEPTION 'Count leak not reproduced'; END IF;
 IF (SELECT count(*) FROM public.exercises WHERE (catalog_id IS NULL OR active_version_id IS NOT NULL) AND chapter='Only draft')<>0
 THEN RAISE EXCEPTION 'Count proposal failed'; END IF;
END $$;
\ir ../docs/sql-proposals/20261101-exclude-unpublished-pilots-rollback.sql
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.get_random_exercise(text,text)'::regprocedure))<>'14fac9361afb35bb7fa64df3649551eb'
 THEN RAISE EXCEPTION 'Rollback not exact'; END IF;
 IF EXISTS((TABLE public.exercises EXCEPT TABLE before_rows) UNION ALL (TABLE before_rows EXCEPT TABLE public.exercises))
 THEN RAISE EXCEPTION 'Exercise data changed'; END IF;
END $$;
SELECT 'PASS: legacy, canonical draft/published, chapter/difficulty, 1000 draws, BYPASSRLS, exact rollback, unchanged data; count leak reproduced separately' AS proof;
