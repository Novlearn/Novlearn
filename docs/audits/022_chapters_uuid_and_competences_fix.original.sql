-- Migration 022 : Correction du schéma chapters + competences
-- Migration 010 créait chapters avec SERIAL INT + db_aliases TEXT[].
-- En production la table a été recréée avec UUID + aliases TEXT[].
-- On corrige ici de façon idempotente.

-- ============================================================
-- 1. Recréer chapters avec UUID si la PK est encore INT/SERIAL
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chapters'
      AND column_name  = 'id'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE IF EXISTS public.competences DROP CONSTRAINT IF EXISTS competences_chapter_id_fkey;
    DROP TABLE IF EXISTS public.chapters CASCADE;

    CREATE TABLE public.chapters (
      id          UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
      name        TEXT UNIQUE NOT NULL,
      order_index INT  NOT NULL,
      aliases     TEXT[] DEFAULT '{}',
      emoji       TEXT NOT NULL DEFAULT '📚'
    );

    ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Lecture publique des chapitres"
      ON public.chapters FOR SELECT
      USING (true);
  END IF;
END $$;

-- Renommer db_aliases → aliases si l'ancienne colonne existe encore
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chapters'
      AND column_name  = 'db_aliases'
  ) THEN
    ALTER TABLE public.chapters RENAME COLUMN db_aliases TO aliases;
  END IF;
END $$;

-- ============================================================
-- 2. Reseed des 8 chapitres (idempotent via ON CONFLICT)
-- ============================================================
INSERT INTO public.chapters (name, order_index, aliases, emoji) VALUES
  ('Suites numériques',        1, ARRAY['Suites numériques', 'Suites et limites'], '🔢'),
  ('Limites et continuité',    2, '{}',                                             '➡️'),
  ('Dérivation et Fonctions',  3, '{}',                                             '📈'),
  ('Logarithme néperien',      4, '{}',                                             '🌿'),
  ('Primitives et équadiff',   5, '{}',                                             '∫'),
  ('Convexité',                6, '{}',                                             '∪'),
  ('Stats',                    7, '{}',                                             '📊'),
  ('Probas',                   8, '{}',                                             '🎲')
ON CONFLICT (name) DO UPDATE
  SET order_index = EXCLUDED.order_index,
      aliases     = EXCLUDED.aliases,
      emoji       = EXCLUDED.emoji;

-- ============================================================
-- 3. Corriger competences.chapter_id : INT → UUID (nullable)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'competences'
      AND column_name  = 'chapter_id'
      AND data_type    = 'integer'
  ) THEN
    ALTER TABLE public.competences DROP CONSTRAINT IF EXISTS competences_chapter_id_fkey;
    ALTER TABLE public.competences ALTER COLUMN chapter_id TYPE UUID USING NULL;
  END IF;
END $$;

-- Recréer la FK vers chapters(id) si absente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'competences'
      AND constraint_name   = 'competences_chapter_id_fkey'
  ) THEN
    ALTER TABLE public.competences
      ADD CONSTRAINT competences_chapter_id_fkey
      FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 4. Reseed des 13 compétences avec chapter_id UUID résolu
-- ============================================================
INSERT INTO public.competences (id, name, chapter_id, max_points)
SELECT v.comp_id, v.comp_name, ch.id, v.mp
FROM (VALUES
  ('definir_une_suite',               'Définir une suite',                                   'Suites numériques',     40),
  ('calculer_des_termes',             'Calculer des termes',                                 'Suites numériques',     30),
  ('etudier_variations_suite',        'Étudier les variations (croissance/décroissance)',    'Suites numériques',     70),
  ('determiner_une_limite_suite',     'Déterminer une limite',                               'Suites numériques',     80),
  ('reconnaitre_suites_arith_geo',    'Reconnaître des suites arithmétiques/géométriques',  'Suites numériques',     30),
  ('modeliser_situation_suite',       'Modéliser une situation par une suite',               'Suites numériques',     30),
  ('interpreter_graphiquement_suite', 'Interpréter graphiquement une suite',                 'Suites numériques',     20),
  ('savoir_si_fonction_continue',     'Savoir si une fonction est continue',                 'Limites et continuité', 30),
  ('calculer_limite_point',           'Calculer une limite en un point',                     'Limites et continuité', 40),
  ('identifier_asymptote',            'Identifier une asymptote horizontale/verticale',      'Limites et continuité', 30),
  ('utiliser_limites_usuelles',       'Utiliser les limites usuelles',                       'Limites et continuité', 50),
  ('dresser_tableau_signes_variations','Dresser un tableau de signes et variations',         'Limites et continuité', 80),
  ('determiner_max_min',              'Déterminer des maximums et minimums',                 'Limites et continuité', 70)
) AS v(comp_id, comp_name, chapter_name, mp)
JOIN public.chapters ch ON ch.name = v.chapter_name
ON CONFLICT (id) DO UPDATE
  SET name       = EXCLUDED.name,
      chapter_id = EXCLUDED.chapter_id,
      max_points = EXCLUDED.max_points;
