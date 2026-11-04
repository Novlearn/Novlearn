> Document historique 0.2.0. Pour la livraison active Novlearn staging, voir [Engine 0.2.1](engine-0.2.1-integration.md).

# Engine 0.2.0 : intégration et environnements

## Ce qui est livré

Les deux applications installent `novlearn-exercise-engine` depuis leur archive
versionnée, via `npm ci`. Aucun lien vers un dossier Engine voisin n'est requis.
Archive 0.2.0 : SHA-256
`cc62b257798bda3ebffe293f49997e72ece2ee11b7f392c28e92217ceb45af91`.
Le manifeste décrit les 185 fichiers installés. Conserver les archives anciennes
pour le rejeu des tentatives historiques.

Le cœur Engine ne lit **aucune variable d'environnement**, ne choisit aucune base
et n'accède jamais à Supabase. Les applications accèdent aux données et appellent
un service Engine isolé pour les calculs. Ce service optionnel utilise un token
de transport ; ce n'est pas une clé de base de données.

## Novlearn : où mettre les variables

Dans GitHub → dépôt Novlearn → Settings → Environments, configurer séparément
`staging` (branche `develop`) et `production` (branche `main`). Le workflow refuse
un mélange de projets avant le build ou l'accès au VPS. Ne pas se reposer sur des
secrets globaux identiques pour les deux environnements.

| Nom | Environnement GitHub `staging` | Environnement GitHub `production` | Type |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tksvbkvfusrnxulpahky.supabase.co` | `https://abwipnppcrghdhwriyjp.supabase.co` | Secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique/anon du projet staging | Clé publique/anon du projet production | Secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur staging pour Next | Clé serveur production pour Next | Secret |
| `SUPABASE_SERVICE_KEY` | Même clé serveur staging pour Python/duels | Même clé serveur production pour Python/duels | Secret |
| `ENGINE_URL` | `http://127.0.0.1:3151/run` | `http://127.0.0.1:3152/run` | Secret |
| `ENGINE_TOKEN` | Token hexadécimal de 64 caractères du host staging | Autre token, propre au host production | Secret |
| `NOVLEARN_ENGINE_ENABLED` | `false`, puis `true` après qualification | `false` jusqu'à qualification production | Variable |

Conserver les autres secrets existants : VPS, SMTP, VAPID, `SECRET_KEY`, analytics,
`ADMIN_API_SECRET`, etc. `DATABASE_URL`, si utilisé par une fonctionnalité, doit
également viser la base du bon environnement ; Engine n'en a pas besoin. Le
contrôle Supabase ne vérifie pas la destination d'une URL PostgreSQL arbitraire.

Le workflow écrit les fichiers privés du VPS :

| Processus | Staging | Production | Variables principales |
| --- | --- | --- | --- |
| Next | `/opt/novlearn-staging/frontend/.env.local` | `/opt/novlearn/frontend/.env.local` | `APP_ENV`, `NOVLEARN_ENGINE_ENABLED`, `ENGINE_URL`, `ENGINE_TOKEN`, les trois clés Next du tableau |
| Python | `/opt/novlearn-staging/backend/.env` | `/opt/novlearn/backend/.env` | `APP_ENV`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Duels | `/opt/novlearn-staging/duel-server/.env` | `/opt/novlearn/duel-server/.env` | `APP_ENV`, `NOVLEARN_ENGINE_ENABLED`, `ENGINE_URL`, `ENGINE_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |

`APP_ENV=staging` ou `production` est écrit explicitement. `NODE_ENV=production`
s'applique aux deux builds hébergés : il ne permet pas de choisir une base.
Les URL de site et de duels sont générées par le workflow :
`https://staging.novlearn.fr` / `https://staging.novlearn.fr/duel-ws`, et
`https://novlearn.fr` / `https://novlearn.fr/duel-ws`. Les variables `NEXT_PUBLIC_*`
sont incorporées au build : toute modification impose un nouveau build.

En développement, utiliser `cd frontend` puis `npm run dev:engine-staging` : le
launcher lit `.env.engine-staging.local` et `.local/engine-staging/server.env`,
vérifie le projet staging et démarre les trois services avec ces valeurs.
Il ne réécrit pas les fichiers `.env` ordinaires, qui peuvent encore viser la
production. Ne pas lancer une session locale Engine contre la base production.
Le launcher Engine local requiert Docker disponible sur la machine.

## Novlearn Admin sur Vercel

Dans Vercel → projet Novlearn Admin → Settings → Environment Variables, ajouter
les valeurs ci-dessous au scope où l'Admin est déployé. Son scope Vercel
**Production utilise la base métier staging** : ce sont deux notions différentes.
Pour un scope Preview, utiliser son URL exacte comme `APP_BASE_URL` et conserver
la base et le host staging.

| Variable serveur | Valeur |
| --- | --- |
| `APP_BASE_URL` | `https://novlearn-admin.vercel.app` pour le domaine Admin principal |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tksvbkvfusrnxulpahky.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé publique du projet staging |
| `ADMIN_ENGINE_ENABLED` | `true` après migration et qualification du host, sinon `false` |
| `ENGINE_URL` | `https://staging.novlearn.fr/run` |
| `ENGINE_TOKEN` | Même token que le host staging du VPS |

`ENGINE_URL` et `ENGINE_TOKEN` ne portent jamais le préfixe `NEXT_PUBLIC_`.
Ne fournir aucune clé `service_role` à Admin pour ses parcours utilisateur : les
RPC vérifient la session administrateur. `APP_BASE_URL` doit correspondre à
l'origine utilisée pour les opérations d'écriture ; configurer également les
URL de redirection de Supabase Auth pour le domaine utilisé.

Pour signer les reçus de qualification, configurer aussi
`ADMIN_TEST_SIGNING_KEY_ID` (UUID) et `ADMIN_TEST_SIGNING_KEY` (64 caractères
hexadécimaux). Enregistrer la clé correspondante dans le registre privé prévu
par les migrations Admin avant de produire des reçus. Ces deux valeurs ne
remplacent pas la configuration distincte de promotion staging → production.

Vercel appelle le host isolé du VPS par HTTPS. Il n'exécute pas le host natif.
Le navigateur affiche les segments publics calculés par Engine et ne calcule
pas les fonctions mathématiques lui-même.

## Installer le host

Dans le dépôt Engine, avec Node 24.19.0 et npm 11.17.0 :

```sh
npm ci --ignore-scripts
python3 tools/verify-release-archive.py releases/0.2.0
node deploy/prepare-image.mjs
cp deploy/engine.env.example deploy/staging.env
```

Générer un token via `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
et le copier dans le fichier privé `deploy/staging.env` (`ENGINE_TOKEN=...`,
`ENGINE_BIND_PORT=3151`), puis :

```sh
docker compose --env-file deploy/staging.env -p novlearn-engine-staging -f deploy/compose.yaml up -d --build
```

Répéter avec `deploy/production.env`, un token différent, port 3152 et le projet
Compose `novlearn-engine-production`. Les fichiers privés et les archives de
dépendances générées ne se commitent pas. L'image est en lecture seule et bornée
en ressources ; les processus mathématiques n'héritent pas du token HTTP.

Appliquer la configuration Apache versionnée, tester `apache2ctl configtest`,
puis recharger Apache. Le chemin HTTPS `/run` du domaine staging est réservé à
l'Admin et relayé vers `127.0.0.1:3151/run`. Les applications du VPS appellent
directement leur boucle locale. Ne pas exposer un second `/run` public production.

## Bases : état et ordre d'activation

Au contrôle du 3 novembre 2026, staging contient encore l'identité 0.1.8 et Engine
est désactivé dans son registre privé. Les RPC `admin_put_preview_snapshot` et
`admin_get_preview_snapshot` sont absentes. La migration
`20261103135952_engine_0_2_0_archive.sql` prépare la rotation exacte de l'empreinte
et les aperçus privés ; elle maintient le moteur désactivé et refuse un état
source inattendu. Elle n'a pas été appliquée automatiquement.

La production n'a pas encore le socle `exercise_versions` /
`engine_exercise_sessions` contrôlé en staging. Ne pas y appliquer directement
la seule rotation 0.2.0 ni lancer un `db push` global pour combler ce manque.
Les migrations historiques proposées et les preuves de replay sont conservées
pour préparer ce déploiement séparément.

Ordre : qualifier la release, installer et tester le host staging, appliquer la
migration staging après vérification de ses préconditions, enregistrer les clés
de reçus nécessaires, déployer les branches d'intégration, tester une connexion
Admin puis valider → générer → aperçu graphique → corriger → reçu. Activer les
flags applicatifs et le registre métier seulement après ce contrôle. Préparer
ensuite le socle et les mêmes vérifications en production.

Une release GitHub ou un build vert ne signifie pas que ces actions ont été
effectuées sur le VPS ou les bases. Pour revenir en arrière, désactiver les flags,
revenir aux anciens commits/archives/host et restaurer l'identité de registre
avec la proposition `supabase/proposals/engine-0.2.0-rollback.sql`, après revue.
Elle vérifie l'empreinte du corps de fonction restauré et garde Engine désactivé.
Ne jamais réécrire les tentatives et reçus
historiques. Laisser expirer les aperçus temporaires avant leur retrait éventuel.
