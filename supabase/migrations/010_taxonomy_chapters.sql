-- ============================================
-- Taxonomie : tables chapters + competences
-- Source de vérité déplacée du JSON → Supabase
-- ============================================

-- Table: chapters (chapitres ordonnés du programme)
CREATE TABLE IF NOT EXISTS public.chapters (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  order_index INT NOT NULL
);

-- Ajout défensif de db_aliases (table peut exister sans cette colonne)
ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS db_aliases TEXT[] DEFAULT '{}';

ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read chapters"
  ON public.chapters FOR SELECT
  USING (true);

-- Seed des chapitres (ordre du programme)
INSERT INTO public.chapters (name, order_index, db_aliases) VALUES
  ('Suites numériques',       1, ARRAY['Suites numériques', 'Suites et limites']),
  ('Limites et continuité',   2, '{}'),
  ('Dérivation et Fonctions', 3, '{}'),
  ('Logarithme néperien',     4, '{}'),
  ('Primitives et équadiff',  5, '{}'),
  ('Convexité',               6, '{}'),
  ('Stats',                   7, '{}'),
  ('Probas',                  8, '{}')
ON CONFLICT (name) DO UPDATE
  SET order_index = EXCLUDED.order_index,
      db_aliases  = EXCLUDED.db_aliases;

-- Table: competences (compétences liées à chaque chapitre)
CREATE TABLE IF NOT EXISTS public.competences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chapter_id INT NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  max_points INT NOT NULL CHECK (max_points > 0)
);

ALTER TABLE public.competences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read competences"
  ON public.competences FOR SELECT
  USING (true);

-- Re-création du lien dans user_competence_scores (était supprimé par migration 005)
CREATE TABLE IF NOT EXISTS public.user_competence_scores (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  competence_id TEXT REFERENCES public.competences(id) ON DELETE CASCADE NOT NULL,
  points INT NOT NULL DEFAULT 0 CHECK (points >= 0),
  streak INT NOT NULL DEFAULT 0 CHECK (streak >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, competence_id)
);

ALTER TABLE public.user_competence_scores ENABLE ROW LEVEL SECURITY;

-- La migration 006 a déjà créé ces politiques sur cette table persistante.
-- Leur remplacement ciblé conserve exactement les prédicats attendus ici.
DROP POLICY IF EXISTS "Users can read own competence scores" ON public.user_competence_scores;
DROP POLICY IF EXISTS "Users can insert own competence scores" ON public.user_competence_scores;
DROP POLICY IF EXISTS "Users can update own competence scores" ON public.user_competence_scores;

CREATE POLICY "Users can read own competence scores"
  ON public.user_competence_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own competence scores"
  ON public.user_competence_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own competence scores"
  ON public.user_competence_scores FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_competence_scores_user_id
  ON public.user_competence_scores(user_id);

-- Seed des compétences (données issues de shared/competences.json)
-- Suites numériques (chapter_id = 1)
INSERT INTO public.competences (id, name, chapter_id, max_points) VALUES
  ('definir_une_suite',           'Définir une suite',                                      1, 40),
  ('calculer_des_termes',         'Calculer des termes',                                    1, 30),
  ('etudier_variations_suite',    'Étudier les variations (croissance/décroissance)',        1, 70),
  ('determiner_une_limite_suite', 'Déterminer une limite',                                  1, 80),
  ('reconnaitre_suites_arith_geo','Reconnaître des suites arithmétiques/géométriques',      1, 30),
  ('modeliser_situation_suite',   'Modéliser une situation par une suite',                  1, 30),
  ('interpreter_graphiquement_suite','Interpréter graphiquement une suite',                 1, 20)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, chapter_id = EXCLUDED.chapter_id, max_points = EXCLUDED.max_points;

-- Limites et continuité (chapter_id = 2)
INSERT INTO public.competences (id, name, chapter_id, max_points) VALUES
  ('savoir_si_fonction_continue',    'Savoir si une fonction est continue',                2, 30),
  ('calculer_limite_point',          'Calculer une limite en un point',                    2, 40),
  ('identifier_asymptote',           'Identifier une asymptote horizontale/verticale',     2, 30),
  ('utiliser_limites_usuelles',      'Utiliser les limites usuelles',                      2, 50),
  ('dresser_tableau_signes_variations','Dresser un tableau de signes et variations',       2, 80),
  ('determiner_max_min',             'Déterminer des maximums et minimums',                2, 70)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, chapter_id = EXCLUDED.chapter_id, max_points = EXCLUDED.max_points;
