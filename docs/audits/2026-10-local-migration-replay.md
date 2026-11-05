# Rejeu local des migrations Supabase

État au 13 octobre 2026. Ce correctif ne cible que le dossier Git local. Aucune
connexion ni écriture distante n'a été effectuée pendant cette vérification.

## Cause de l'échec en 010

`004_competences_and_scores.sql` crée les trois policies de
`user_competence_scores` avec les prédicats `auth.uid() = user_id`.
`005_competences_from_settings.sql` supprime `competences` et ses clés
étrangères, mais ne supprime pas `user_competence_scores` ni ses policies.
`006_fix_exercise_attempts_and_scores.sql` recrée la table au besoin, puis
remplace ces trois policies avec des `DROP POLICY IF EXISTS` ciblés et recrée
les mêmes règles. Ainsi, après 006, les policies existent encore.

`010_taxonomy_chapters.sql` déclare `CREATE TABLE IF NOT EXISTS` pour
`user_competence_scores`, ce qui ne change pas cette table existante, puis
tente de créer à nouveau `Users can read own competence scores` (et les deux
policies INSERT/UPDATE). PostgreSQL interdit deux policies de même nom sur la
même table et renvoie SQLSTATE 42710. La migration s'arrête sur la première.

Les trois définitions d'origine de 010 étaient :

```sql
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
```

Le patch local de 010 ajoute uniquement un `DROP POLICY IF EXISTS` par nom,
sur `public.user_competence_scores`, immédiatement avant leur recréation. Les
prédicats et les droits finaux sont inchangés. Ce remplacement explicite
conserve la dernière définition de 010 comme source de l'état final.

## Autres répétitions constatées dans 001–010

- Les tables/index de `competences` et le score sont déclarés dans 004, 006 et
  010. Les `IF NOT EXISTS` les rendent tolérants à leur présence, mais ne
  réconcilient pas leur structure. 005 retire la table `competences`, puis 010
  la réintroduit avec `chapter_id` et une FK vers `chapters`.
- Les trois policies de scores sont créées dans 004, 006 et 010. 006 et le
  nouveau 010 font un remplacement ciblé; 004 est la première définition.
- La policy de leaderboard de 007 est protégée par un test `pg_policies`.
  008 remplace explicitement ses cinq policies par `DROP POLICY IF EXISTS`.
- Les fonctions des classements sont remplacées avec `CREATE OR REPLACE`; 009
  supprime explicitement l'ancienne signature mensuelle. Les triggers de 001
  et 002 ne sont pas idempotents sur des tables déjà présentes, mais ne sont
  créés qu'une fois lors d'un rejeu linéaire sur une base vide.
- Aucun autre doublon de nom de policy ne se produit entre les seules
  migrations 001–010. Le remplacement a été recherché dans tout l'historique;
  025 supprime aussi explicitement les trois policies de scores avant de les
  redéfinir avec le prédicat `auth.uid()` encapsulé dans un SELECT.

## Vérification d'exécution

Le binaire local Supabase CLI répond `2.98.2`. Docker n'est pas disponible
dans l'environnement Codex (commande `docker` absente); le CLI avertit aussi
qu'il ne peut pas lire `%USERPROFILE%\\.docker\\config.json`. Aucun conteneur,
rejeu PostgreSQL, test RLS ni diff Staging n'a donc été exécuté ici. Le
changement historique local est documenté ci-dessus; la migration distante
010 n'a pas été modifiée.

Dans PowerShell Windows, depuis la racine du dépôt, vérifier le moteur Docker
Desktop puis exécuter uniquement ces commandes locales :

```powershell
docker version
npx supabase start
npx supabase db reset --local
npx supabase status
```

`db reset --local` reconstruit la base Supabase locale à partir de zéro et
rejoue les migrations; ne pas remplacer `--local` par une cible liée. Pour
vérifier la policy finale après le rejeu, exécuter dans le SQL Editor local ou
avec `psql` sur le port Database affiché par `supabase status` :

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'user_competence_scores'
order by policyname;
```

Attendu après toutes les migrations : une policy de refus des invités et les
trois policies SELECT/INSERT/UPDATE définies en 025. Pour une comparaison avec
Staging, ne lancer aucune commande de reset ou de push sur le projet lié;
reprendre seulement après que le rejeu local soit passé et faire un inventaire
en lecture seule séparé.

## Réconciliation et lot Admin

L'audit `2026-10-migrations-exercises-admin.md` reste la preuve disponible pour
l'inventaire distant. Il établit cinq équivalences de contenu à confirmer dans
une archive durable des statements : 037/`20260515095611`,
038/`20260515100450`, 039/`20260515100934`, 043/`20260520131524` et
044/`20260910122045`. Les cinq fichiers locaux sans correspondance démontrée
sont 035, 036, 040, 041 et 042. Les effets de ces cinq scripts ne doivent pas
être présentés comme appliqués à distance.

La création de migrations canoniques Admin et leurs tests restent bloqués
jusqu'au rejeu complet PostgreSQL/Supabase demandé. La proposition existante
dans `docs/sql-proposals/20261013-exercise-versioning.proposal.sql.txt` n'est
donc pas convertie ni déclarée valide; elle requiert notamment un test de hash,
d'immuabilité, de contraintes et d'ACL/RLS. Aucune migration Admin n'a été
ajoutée à `supabase/migrations/`.
