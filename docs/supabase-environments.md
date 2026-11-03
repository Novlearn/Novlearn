# Deux projets Supabase : production et staging

La production reste le projet existant. Créer un projet vide `novlearn-staging`, de préférence dans la même région et avec une version PostgreSQL compatible. Les schémas applicatifs, fonctions, contraintes, permissions et politiques RLS doivent correspondre ; les comptes et données utilisateur restent indépendants. Ce guide ne suppose pas que la base distante a déjà été inspectée.

## 1. Initialiser le schéma staging depuis la production réelle

Ne pas lancer toutes les anciennes migrations à l'aveugle sur le nouveau projet : `028_claude_exercises.sql` attend une table `exercises_claude` dont la création n'est pas dans le dépôt. Une copie du schéma réel couvre aussi les modifications réalisées directement dans le dashboard.

Prérequis : dépendances racine installées, Docker Desktop démarré pour les dumps Supabase CLI, et `psql` installé. Depuis **Connect**, relever les deux connexions PostgreSQL **Session pooler, port 5432**, avec leurs mots de passe de base percent-encodés. Ne pas utiliser les clés API comme mots de passe.

Les commandes ci-dessous visent un **staging neuf**. Exécuter les étapes une par une et arrêter au premier échec. Suspendre les changements de schéma pendant l'export. Les exports sont rangés hors du dépôt ; les commandes ne copient pas les lignes des tables applicatives.

Dans PowerShell, saisir les URLs sans les enregistrer dans l'historique :

```powershell
$prodDbUrl = [System.Net.NetworkCredential]::new('', (Read-Host 'URL PostgreSQL PROD' -AsSecureString)).Password
$stagingDbUrl = [System.Net.NetworkCredential]::new('', (Read-Host 'URL PostgreSQL STAGING' -AsSecureString)).Password
$bootstrapDir = Join-Path $env:TEMP 'novlearn-staging-bootstrap'
New-Item -ItemType Directory -Path $bootstrapDir -Force
```

Exporter le schéma applicatif et l'historique de migrations :

```powershell
npx supabase db dump --db-url "$prodDbUrl" --file "$bootstrapDir/schema.sql"
npx supabase db dump --db-url "$prodDbUrl" --schema supabase_migrations --file "$bootstrapDir/history-schema.sql"
npx supabase db dump --db-url "$prodDbUrl" --schema supabase_migrations --data-only --use-copy --file "$bootstrapDir/history-data.sql"
```

Le dump de schéma inclut les objets applicatifs, dont les policies RLS et fonctions, mais exclut les schémas gérés par Supabase tels que `auth` et `storage`. Le second export de données concerne uniquement l'historique technique des migrations. Si la prod ne possède pas cet historique, ne pas importer des fichiers vides : vérifier quels changements ont réellement été appliqués et établir une baseline avant les futurs `db push`.

Les triggers personnalisés sur `auth.users` doivent être ajoutés séparément. Exporter leurs définitions actuelles, plutôt que rejouer les anciennes versions des fonctions :

```powershell
$authTriggerQuery = @'
SELECT pg_get_triggerdef(t.oid) || ';'
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
  AND n.nspname = 'public'
ORDER BY t.tgname;
'@
psql --dbname "$prodDbUrl" --no-psqlrc --tuples-only --no-align --variable ON_ERROR_STOP=1 --command "$authTriggerQuery" --output "$bootstrapDir/auth-triggers.sql"
```

Relire les exports. Vérifier notamment que les fonctions des triggers sont présentes dans `schema.sql`, que les extensions nécessaires existent sur le staging et que les fonctions/webhooks n'embarquent pas d'URL ou de secret de production. Si des rôles PostgreSQL personnalisés sont référencés, exporter et réviser les rôles séparément avant restauration ; ne pas remplacer les rôles internes du nouveau projet.

Restaurer **sur le staging** uniquement :

```powershell
psql --dbname "$stagingDbUrl" --no-psqlrc --single-transaction --variable ON_ERROR_STOP=1 --file "$bootstrapDir/schema.sql" --file "$bootstrapDir/auth-triggers.sql" --file "$bootstrapDir/history-schema.sql" --file "$bootstrapDir/history-data.sql"
```

Puis comparer les historiques et examiner les migrations que la CLI veut encore appliquer :

```powershell
npx supabase migration list --db-url "$prodDbUrl"
npx supabase migration list --db-url "$stagingDbUrl"
npx supabase db push --db-url "$stagingDbUrl" --dry-run
```

Si le dry-run propose d'anciennes migrations alors que leurs effets sont déjà dans le schéma restauré, réconcilier l'historique avant de continuer. `migration repair --status applied` ne modifie que cet historique : à utiliser pour une version vérifiée, pas pour masquer une erreur SQL. Ne pas lancer de reset distant sur la production.

Références : [restauration avec la CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [gestion des migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## 2. Vérifier les triggers d'inscription

Le dépôt prévoit deux triggers sur `auth.users` :

- `on_auth_user_created`, qui appelle `public.handle_new_user()` pour créer le profil ;
- `on_user_created_generate_friend_code`, pour le code ami.

La migration `044_fix_handle_new_user_birth_date.sql` corrige une conversion TEXT vers DATE qui faisait échouer les inscriptions. Vérifier la définition réellement présente en production et en staging : copier le schéma ne corrige pas une ancienne version encore déployée. Les comptes anonymes ne doivent pas obtenir de profil via `handle_new_user()`.

Ne pas recréer les tables internes de Supabase Auth : le nouveau projet les possède déjà. Créer ensuite des comptes de test via l'application staging. Une même adresse peut avoir des comptes indépendants sur les deux projets ; les UUID, sessions et clés de signature restent propres à chaque projet.

## 3. Configurer Supabase Auth dans chaque dashboard

Les migrations SQL ne recopient pas automatiquement les paramètres Auth distants.

| Réglage | Production | Staging |
| --- | --- | --- |
| Site URL | `https://novlearn.fr` | `https://staging.novlearn.fr` |
| Retour OAuth | `https://novlearn.fr/auth/callback` | `https://staging.novlearn.fr/auth/callback` |
| Retour mot de passe oublié | `https://novlearn.fr/auth/callback?next=/auth/update-password` | `https://staging.novlearn.fr/auth/callback?next=/auth/update-password` |
| Développement local | Selon besoin | Ajouter les deux mêmes callbacks sur `http://localhost:3000` |
| Providers | Email, Google selon configuration actuelle | Les mêmes, avec les paramètres staging |
| Anonymous sign-ins | Selon usage du mode invité | Activer pour tester le mode invité |

Ajouter aussi les callbacks de `www.novlearn.fr` si cette origine sert l'application. Le code utilise l'origine du navigateur pour Google et la récupération de mot de passe. Garder des URLs explicites pour les domaines publics.

Pour **Google**, configurer un client OAuth pour staging, puis renseigner son Client ID et son secret dans le provider Google de Supabase staging. Son URI de redirection autorisée côté Google est :

```text
https://<STAGING_PROJECT_REF>.supabase.co/auth/v1/callback
```

C'est le callback Supabase ; le callback du frontend est configuré dans les Redirect URLs Supabase. Ajouter l'origine staging dans les origines JavaScript autorisées du client Google et déclarer les utilisateurs test si le consentement OAuth est en mode test. Le client de production conserve le callback de son propre projet.

Pour **email/mot de passe**, aligner la confirmation d'email et les templates pour tester le même parcours. Configurer le SMTP dans **Supabase Auth**, en plus du SMTP éventuel du backend : ce sont deux configurations distinctes. Le SMTP Supabase par défaut est réservé aux adresses autorisées de l'équipe et actuellement limité à deux messages par heure. Pour des testeurs externes et des utilisateurs de production, utiliser un SMTP personnalisé et vérifier ses propres quotas.

Références : [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 4. Relier frontend, backend et Colyseus au même projet

Dans **GitHub > Settings > Environments**, créer `staging` et `production`. Le workflow de déploiement associe désormais chaque job à son environnement. Définir les secrets Supabase suivants dans **chacun** :

| Secret GitHub | Valeur pour l'environnement choisi |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé `anon` du projet pour le frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé `service_role` utilisée par les routes serveur Next.js |
| `SUPABASE_SERVICE_KEY` | La même clé `service_role`, pour FastAPI et Colyseus |

Définir aussi ces variables non sensibles dans **Settings → Secrets and variables → Actions → Variables** au niveau du dépôt :

| Variable GitHub | Valeur |
| --- | --- |
| `SUPABASE_STAGING_PROJECT_REF` | Référence du projet staging, tirée de son URL Supabase |
| `SUPABASE_PRODUCTION_PROJECT_REF` | Référence du projet production, tirée de son URL Supabase |

Le contrôle initial du workflow exige les quatre secrets Supabase, ces deux références distinctes et les trois secrets SSH. Il bloque avant tout transfert si l'URL ne correspond pas à l'environnement sélectionné. Les secrets SMTP, VAPID, VPS et Analytics restent communs au dépôt. Ne pas changer les clés du projet production pour créer staging.

En local, renseigner les valeurs staging dans `frontend/.env.local`, `backend/.env` et `duel-server/.env`. N'exposer aucune clé `service_role` dans une variable `NEXT_PUBLIC_*`.

Les trois services d'un environnement doivent utiliser la même URL Supabase et les clés correspondantes. Le frontend staging doit aussi avoir sa propre `NEXT_PUBLIC_SITE_URL`, son URL Colyseus et son backend/API staging. Les `NEXT_PUBLIC_*` sont intégrées au build : reconstruire et redéployer après modification, puis se reconnecter.

Le workflow existant reste un déploiement VPS. Il prépare le fichier d'environnement Colyseus staging, mais son étape de démarrage staging ne lance pas Colyseus : prévoir le processus staging dédié sur le port 2568 et vérifier le proxy `/duel-ws`. La migration d'hébergement Vercel/Render reste un chantier séparé ; le proxy API de production dépend encore d'Apache.

## 5. Realtime, Storage et effets externes

Dans les publications Database/Realtime des deux projets, activer `public.duels` dans `supabase_realtime` : le frontend écoute ses changements pour rediriger vers un duel accepté. Supabase Realtime et le serveur de match Colyseus remplissent deux rôles différents.

Si des buckets Storage sont utilisés, recréer leurs noms, options et policies sur staging. Les fichiers ne sont pas copiés par un dump de schéma. Reconfigurer également les secrets Edge Functions, webhooks ou tâches planifiées utilisés dans la vraie prod ; leur présence ne peut pas être déduite uniquement du dépôt.

Garder `SCHEDULER_ENABLED=false` sur le backend staging. Plusieurs liens email du backend pointent encore explicitement vers `https://novlearn.fr` : prévoir leur configuration avant de tester des notifications staging destinées à des testeurs.

## 6. Copier le catalogue

Après l'initialisation du schéma, suivre [catalog-sync.md](catalog-sync.md). Copier `.env.catalog-sync.example` vers `.env.catalog-sync.local`, remplir les deux références de projet et connexions PostgreSQL, puis :

```powershell
npm run db:sync:catalog
npm run db:sync:catalog -- --apply
```

L'outil ajoute/met à jour `chapters`, `competences`, `exercises`, et éventuellement `flashcards`. Il conserve les exercices propres au staging, bloque les collisions non reconnues et n'importe pas les utilisateurs, scores ou historiques.

Pour l'action GitHub manuelle, ajouter les quatre secrets `CATALOG_*` documentés dans l'environnement `staging`. Ils sont différents des clés API des applications. Un rôle PostgreSQL en lecture seule sur le catalogue peut servir de source production.

## 7. Maintenir les schémas ensuite

Créer une migration pour chaque évolution et versionner le même fichier pour les deux projets. Après vérification de la baseline et de l'historique, appliquer les nouvelles migrations au staging, tester, puis les appliquer à la production au moment de la release :

```powershell
npx supabase db push --db-url "$stagingDbUrl" --dry-run
npx supabase db push --db-url "$stagingDbUrl"
# Après validation et avant le déploiement de la version compatible en production :
npx supabase db push --db-url "$prodDbUrl" --dry-run
npx supabase db push --db-url "$prodDbUrl"
```

Les migrations peuvent transformer des données : relire le SQL avant application en prod. Adapter la compatibilité avec la version applicative encore en service. Le déploiement actuel de l'application n'applique pas automatiquement ces migrations.

Le staging peut temporairement contenir la prochaine évolution de schéma. Pour reprendre un catalogue prod dans ce cas, l'outil accepte les colonnes staging supplémentaires avec défaut ou nullable, mais refuse les différences de types incompatibles.

## 8. Vérification finale

Tester avec des comptes dédiés : inscription email et création de profil, connexion Google, mot de passe oublié, mode invité, entraînement et enregistrement d'une tentative. Avec deux navigateurs, tester l'invitation, la redirection Realtime, le match Colyseus et son historique.

Vérifier que chaque nouvelle donnée apparaît uniquement dans le dashboard staging. Comparer aussi les policies RLS, fonctions et contraintes ; la seule égalité des noms de tables ne suffit pas. Relancer le backend staging après synchronisation des compétences pour rafraîchir son cache.

Aucune des commandes distantes de ce guide n'a été exécutée par Codex.
