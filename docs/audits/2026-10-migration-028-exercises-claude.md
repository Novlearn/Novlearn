# Audit — migration 028 et `exercises_claude`

Date : 13 octobre 2026. Portée : correction locale du rejeu historique. Les projets Supabase `novlearn-staging` et `novlearn-prod` ont été consultés en lecture seule pour relever le schéma ; aucune écriture distante n’a été effectuée.

## Cause et correction locale

La migration 028 supposait que `public.exercises_claude` existait déjà. Aucune migration antérieure ne la crée : la recherche dans `supabase/migrations/001` à `027` ne trouve que les références de 028 elle-même. La migration échouait donc sur le premier `ALTER TABLE` après avoir créé la séquence.

028 crée maintenant la séquence puis la table avant ses `ALTER TABLE`. `CREATE TABLE IF NOT EXISTS` garde le script compatible avec les bases où la table existe déjà. La déclaration reproduit les 11 colonnes, leur ordre, la casse (`"Is_Flash"`, `"Need_Calculator"`), nullabilité, défauts, clé primaire, séquence séparée, RLS et privilèges observés. La séquence n’est pas déclarée `OWNED BY` la colonne, conformément au catalogue des deux environnements. Les policies admin existantes dans la suite de 028 sont conservées.

## Schéma comparé (Staging = Production)

| Colonne | Type | Null | Défaut |
|---|---|---:|---|
| `id` | bigint | non | `nextval('exercises_claude_id_seq'::regclass)` |
| `created_at` | timestamptz | non | `timezone('utc'::text, now())` |
| `title` | text | non | — |
| `chapter` | text | non | — |
| `difficulty` | text | oui | — |
| `competences` | text[] | oui | — |
| `content` | jsonb | non | — |
| `app_title` | text | oui | — |
| `"Is_Flash"` | boolean | oui | — |
| `"Need_Calculator"` | boolean | oui | — |
| `verified` | boolean | non | `false` |

Contrainte : `exercises_claude_pkey PRIMARY KEY (id)`, aucune autre contrainte observée. Séquence : `public.exercises_claude_id_seq`, bigint, départ 1, incrément 1, cache 1, sans cycle, non possédée par la colonne. RLS activée, non forcée. Policies : SELECT/INSERT/DELETE réservées aux administrateurs authentifiés (définitions dans 028). ACL de la table : privilèges complets à `anon`, `authenticated` et `service_role`; ACL de la séquence : `USAGE`, `SELECT`, `UPDATE` pour ces rôles.

## Recherche ciblée des prérequis dans les migrations suivantes

Les références de table examinées après 028 disposent d’une création antérieure ou dans le même fichier : `profiles` et `exercise_attempts` viennent de 001 ; `feedbacks` de 023 ; `push_subscriptions` est créée dans 031 avant l’activation RLS et sa policy ; `leaderboard_snapshots` est créée dans 040 avant son usage ; `user_stats` est créée dans 041 avant son trigger et le backfill. Aucune autre table seulement supposée préexistante et absente de l’historique local n’a été repérée dans 029–044.

Quelques migrations ont des `CREATE POLICY` ou `CREATE TRIGGER` sans garde pour une seconde exécution manuelle (notamment 031, 039–041). Cela n’indique pas un prérequis absent dans un rejeu linéaire sur une base vide ; ces migrations ne sont pas modifiées dans cette mission.

## Vérification et rejeu

Le binaire Docker n’est pas disponible dans l’environnement Codex ; le rejeu PostgreSQL complet n’a donc pas été exécuté ici. Vérifications statiques : la table n’est pas déclarée avant 028, la création précède les `ALTER TABLE`, et `git diff --check` est passé. Après démarrage de Docker Desktop, depuis la racine du dépôt, les commandes de rejeu strictement local sont :

```powershell
docker version
npx supabase start
npx supabase db reset --local
npx supabase status
```

Après le reset, vérifier localement colonnes, séquence, RLS, policies et ACL avant de reprendre les migrations ultérieures. Ne pas remplacer `--local` par une cible liée.

## Original exact de la migration avant correction

Fichier conservé également dans `docs/audits/028_claude_exercises.original.sql`. Empreinte Git du blob original : `3aff09522c1f6bf630a71a606d8deeb58b13bf45`.

```sql
-- Migration 028 : Sécurisation de la table exercises_claude
-- La table exercises_claude existe déjà. Cette migration :
--   1. Ajoute une séquence auto-increment sur id
--   2. Corrige le default de verified (false = en attente de validation)
--   3. Remplace les policies SELECT publiques par admin-only
--   4. Ajoute les policies INSERT/DELETE pour les admins

-- 1. Séquence auto-increment sur id
CREATE SEQUENCE IF NOT EXISTS public.exercises_claude_id_seq;
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
```
