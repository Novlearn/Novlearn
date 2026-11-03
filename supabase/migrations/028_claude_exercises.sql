-- Migration 028 : Sécurisation de la table exercises_claude
-- La table exercises_claude existe déjà. Cette migration :
--   1. Ajoute une séquence auto-increment sur id
--   2. Corrige le default de verified (false = en attente de validation)
--   3. Remplace les policies SELECT publiques par admin-only
--   4. Ajoute les policies INSERT/DELETE pour les admins

-- 1. Séquence auto-increment sur id
CREATE SEQUENCE IF NOT EXISTS public.exercises_claude_id_seq;

-- La table n'est créée par aucune migration antérieure. Son schéma est aligné
-- sur celui observé en lecture seule sur Staging et Production.
CREATE TABLE IF NOT EXISTS public.exercises_claude (
  id              BIGINT NOT NULL DEFAULT nextval('public.exercises_claude_id_seq'::regclass),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  title           TEXT NOT NULL,
  chapter         TEXT NOT NULL,
  difficulty      TEXT,
  competences     TEXT[],
  content         JSONB NOT NULL,
  app_title       TEXT,
  "Is_Flash"      BOOLEAN,
  "Need_Calculator" BOOLEAN,
  verified        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT exercises_claude_pkey PRIMARY KEY (id)
);

-- Reproduire les ACL observées (RLS reste chargée de filtrer les lignes).
GRANT ALL PRIVILEGES ON TABLE public.exercises_claude
  TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON SEQUENCE public.exercises_claude_id_seq
  TO anon, authenticated, service_role;

ALTER TABLE public.exercises_claude ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exercises_claude
  ALTER COLUMN id SET DEFAULT nextval('public.exercises_claude_id_seq');
SELECT setval('public.exercises_claude_id_seq', COALESCE((SELECT MAX(id) FROM public.exercises_claude), 0) + 1, false);

-- 2. verified = false par défaut (exercice en attente de validation)
ALTER TABLE public.exercises_claude
  ALTER COLUMN verified SET DEFAULT false;

-- 3. Supprimer les policies SELECT trop permissives
DROP POLICY IF EXISTS "Tout le monde peut voir les exercices" ON public.exercises_claude;
DROP POLICY IF EXISTS "Utilisateurs authentifiés peuvent voir les exercices" ON public.exercises_claude;

-- 4. Policies admin-only
CREATE POLICY "Admins peuvent lire les exercices Claude"
  ON public.exercises_claude FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Admins peuvent insérer des exercices Claude"
  ON public.exercises_claude FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Admins peuvent supprimer des exercices Claude"
  ON public.exercises_claude FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );
