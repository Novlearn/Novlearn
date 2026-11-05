-- Migration 022 : Correction du schéma chapters + competences
-- Migration 010 créait chapters avec SERIAL INT + db_aliases TEXT[].
-- En production la table a été recréée avec UUID + aliases TEXT[].
-- La définition enregistrée avant correction est archivée dans
-- This migration is the canonical record of the chapter UUID and competence fix.
-- On corrige ici sans supprimer les chapitres ni leurs associations.

-- ============================================================
-- 1. Convertir la PK INT/SERIAL en UUID en conservant les lignes et les liens
-- ============================================================
DO $$
DECLARE
  unmapped_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'chapters'
      AND column_name  = 'id'
      AND data_type    = 'integer'
  ) THEN
    -- Garder une correspondance explicite de chaque ancien ID vers son UUID.
    ALTER TABLE public.chapters
      ADD COLUMN id_uuid UUID;
    UPDATE public.chapters
      SET id_uuid = extensions.uuid_generate_v4()
      WHERE id_uuid IS NULL;

    -- Remapper toutes les compétences avant de retirer la colonne entière.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'competences'
        AND column_name = 'chapter_id'
        AND data_type = 'integer'
    ) THEN
      ALTER TABLE public.competences ADD COLUMN chapter_id_uuid UUID;
      UPDATE public.competences c
        SET chapter_id_uuid = ch.id_uuid
        FROM public.chapters ch
        WHERE c.chapter_id = ch.id;

      SELECT COUNT(*) INTO unmapped_count
        FROM public.competences
        WHERE chapter_id_uuid IS NULL;
      IF unmapped_count > 0 THEN
        RAISE EXCEPTION
          '022: % compétence(s) sans chapitre correspondant; conversion annulée',
          unmapped_count;
      END IF;

      ALTER TABLE public.competences
        DROP CONSTRAINT IF EXISTS competences_chapter_id_fkey;
      ALTER TABLE public.competences DROP COLUMN chapter_id;
      ALTER TABLE public.competences RENAME COLUMN chapter_id_uuid TO chapter_id;
      ALTER TABLE public.competences ALTER COLUMN chapter_id SET NOT NULL;
    ELSE
      RAISE EXCEPTION
        '022: chapters.id est entier mais competences.chapter_id n’est pas entier; mapping non vérifiable';
    END IF;

    ALTER TABLE public.chapters DROP CONSTRAINT chapters_pkey;
    ALTER TABLE public.chapters DROP COLUMN id;
    ALTER TABLE public.chapters RENAME COLUMN id_uuid TO id;
    ALTER TABLE public.chapters ALTER COLUMN id SET DEFAULT extensions.uuid_generate_v4();
    ALTER TABLE public.chapters ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);
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
-- 3. Vérifier que chapter_id est UUID et reste obligatoire
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
    RAISE EXCEPTION
      '022: competences.chapter_id est entier sans table chapters entière permettant un mapping; conversion annulée';
  END IF;

  ALTER TABLE public.competences ALTER COLUMN chapter_id SET NOT NULL;
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
