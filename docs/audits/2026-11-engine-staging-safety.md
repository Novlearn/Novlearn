# Pilotes Engine — audit et sécurisation locale du 1er novembre 2026

> État historique de la première phase, avant autorisation du second correctif RPC.
> La suite autorisée est décrite dans la [réception Staging](2026-11-engine-staging-reception.md) :
> protections appliquées, cinq brouillons Admin créés et parcours Engine testé.
> Les constats « aucune écriture » et « bloquée » ci-dessous concernent cette première phase.

Mission **partiellement réalisée, réception de bout en bout bloquée**. Les lecteurs
du code local sont protégés et qualifiés sur données synthétiques. Aucune écriture
Staging ou Production, aucun pilote créé, aucune activation, aucun déploiement,
aucune infrastructure installée. Aucun calcul mathématique modifié.

## Ordre et porte d'arrêt

| Étape demandée | Résultat réel |
| --- | --- |
| 1. Inventorier/protéger les lecteurs | Inventaire du code et des objets SQL Staging ; protections locales ajoutées. Le compteur RPC privilégié reste non protégé à distance. L'état des processus déjà déployés n'a pas été reçu. |
| 2. Vérifier sur copie | Réussi sur PostgreSQL/WASM 18.3 en mémoire, données synthétiques, sans URL ni clé. Tests applicatifs séparés ci-dessous. |
| 3. Protéger Staging | Cible, empreintes et retours arrière contrôlés ; **aucune application**, car un second corps RPC doit être corrigé, hors périmètre distant autorisé. |
| 4. Créer les cinq pilotes par Admin | Non exécuté : porte de sécurité non franchie. Zéro identifiant distant inventé. |
| 5. Configurer/lancer NovLearn contre Staging et tester | Non exécuté : dépend des étapes précédentes. Les trois configurations existantes visent Production ; aucun service démarré avec ces valeurs. |
| 6. Compte rendu | Ce document, manifeste sans attendus privés et propositions de revue. |

Le texte de mission impose : « Si le changement nécessaire dépasse la correction
ciblée et son périmètre autorisé, arrêter avant application et présenter le diff
précis. » Le changement autorisé à distance concerne seulement
`get_random_exercise(text,text)`. `get_chapters_with_count(uuid)`, également
`SECURITY DEFINER`, agrège tous les parents sans filtre et laisse apparaître un
chapitre contenant seulement un brouillon canonique. Sa correction exige aussi le
prédicat d'éligibilité. Le [diff supplémentaire exact](../sql-proposals/20261101-chapter-count.diff)
est prêt ; **il n'est pas une migration autorisée**. La
[définition d'origine](../sql-proposals/20261101-chapter-count-original.sql)
permet la comparaison et le retour au corps observé.

## Dépôts, état initial et préservation

- Dépôt réellement ouvert : `C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn`, branche
  `refactor/exercise-engine`, HEAD `74381ee3989375bd563386b73ed55f88f952da46`.
- Admin réellement trouvé dans le dossier parent : `../Novlearn-admin`, branche
  `main`, HEAD `6f590aea96d19641bee74b28c69690c9b72aa7ef`.
- Consignes lues dans les deux dépôts ; CDC Admin, roadmap, mission, réception,
  décision d'hôte et propositions SQL relus. Côté NovLearn : README, documentation
  des environnements, inventaire Engine et roadmap de correction/état L0 consultés.
  La présente demande autorise les modifications ciblées de NovLearn qui étaient
  exclues dans la mission Admin précédente ; elle n'autorise aucune conversion globale.
- NovLearn était déjà modifié : `.gitignore`, `README.md`,
  `frontend/app/api/exercises/route.ts`, pages duel/feedback et migrations
  `010`, `022`, `028`, plus des audits/tests/scripts/propositions non suivis.
  Ces travaux restent présents. Dans la route déjà modifiée, seuls l'import et le
  filtre de la liste ont été ajoutés à l'état de départ de cette mission.
- Admin présentait de nombreuses modifications et quatre exemples `.env` déjà
  supprimés. Son état Git final est identique à celui relevé au début ; aucun
  fichier Admin ou Engine modifié ici. Aucun reset, nettoyage, formatage global,
  commit, push ou changement de branche.

## Règle retenue

```sql
(e.catalog_id IS NULL OR e.active_version_id IS NOT NULL)
```

Historique : préserver les parents sans identité canonique, y compris les valeurs
de difficulté historiques et l'archivage déjà présent. Canonique sans actif :
exclure, quel que soit son titre, contenu vide ou état éditorial non actif.
Canonique actif : préserver l'éligibilité. Le trigger distant
`require_published_active_exercise_version` exige que l'actif appartienne au parent
et soit publié. Cela ne qualifie pas le rendu canonique par les anciens composants.
Les filtres existants de chapitre, alias, compétence, difficulté et Flash/calculatrice
s'ajoutent au prédicat ; aucune réécriture de référence pédagogique.

Le prédicat est appliqué **avant** le tirage, le comptage ou la pagination, aussi
avec une clé serveur. Dans TrainingPage, la difficulté utilise `in(...)` afin
d'éviter de remplacer le filtre `or(...)` d'éligibilité par un second `or(...)`.
Les relectures serveur ne reconstruisent pas un résultat depuis un identifiant
devenu indisponible. Les écrans élèves restent filtrés même ouverts par un Admin.
La [documentation Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
confirme que les rôles privilégiés peuvent contourner la RLS.

## Inventaire des consommateurs applicatifs

Les chemins de ce tableau sont relatifs à NovLearn. Les appels FastAPI proviennent
des routers montés dans `backend/main.py`, et non d'anciennes définitions dans ce fichier.

| Chemin / fonction | Identité et rôle | Filtres et traitement |
| --- | --- | --- |
| `backend/recommandation.py` : `recommander_exercice`, `_fallback_random_exercise` | FastAPI, client `SUPABASE_SERVICE_KEY` ; choix adaptatif et secours aléatoire | Prédicat explicite, chapitre/alias existants, classement par compétences/difficultés inchangé. |
| Même fichier : `_get_exercise_result` | Même accès privilégié ; relecture d'un ID choisi | Prédicat + ID ; retour `None` si disparu/non disponible. |
| `backend/chapter_selection.py` : `_get_chapters_with_exercises` | FastAPI privilégié ; chapitres candidats | Prédicat avant construction de l'ensemble des chapitres ; alias inchangés. |
| `backend/chapter_placement_test.py` : `fetch_or_start_test`, `get_next_test_exercise` | FastAPI privilégié ; pools de positionnement | Prédicat avant pools par chapitre/alias, compétence et difficulté. |
| Même fichier : `_get_first_test_exercise`, `_restore_test_exercise_from_state`, relectures de difficulté/compétences dans `get_next_test_exercise` | FastAPI privilégié ; premier exercice et reprise d'état | Prédicat + ID ; absence refusée, aucun retour de l'ID filtré. Reprise Engine non implémentée/reçue. |
| `backend/ds.py` : `recommander_exercice_ds`, `build_result` | FastAPI privilégié ; pool DS et relecture | Prédicat explicite ; correspondances compétence/nom, difficulté, streak préservées ; relecture indisponible refusée. |
| `backend/streak.py` | FastAPI privilégié ; métadonnées `id,chapter` de tentatives déjà enregistrées | Pas une livraison/sélection d'exercice. Inchangé pour préserver l'interprétation de l'historique. |
| `duel-server/src/db.ts` : `getRandomExercise` | Colyseus, service key ; exercice du match | Prédicat explicite + `Is_Flash=true`, `Need_Calculator=false`, exclusions QCM existantes. Génération/correction historiques inchangées, aucune réception Engine duel. |
| `frontend/app/components/TrainingPage.tsx` : trois lectures | Navigateur anon/session Auth ; présence de chapitre, catalogue et tirage par difficulté | Prédicat explicite sur les trois lectures, chapitre, difficulté à deux libellés via `in`. |
| `frontend/app/components/Exercise/ExerciseLoader.tsx` : trois lectures | Navigateur anon/session Auth ; chargement par ID ou comptage + offset | Prédicat explicite sur ID, compte et ligne ; brouillon invisible même avec rôle Admin. Rendu/génération/correction historiques inchangés. |
| `frontend/app/api/exercises/route.ts` : GET liste | Next.js, service role après Auth | Métadonnées seulement ; prédicat ajouté pour tous les appelants de la liste. |
| Même route : GET par ID | Next.js, service role ; uniquement Admin vérifié | Lecture privée d'édition, conservée afin qu'un Admin puisse relire les brouillons. Refus élève préexistant préservé ; aucune livraison publique de définition. POST/DELETE administratifs inchangés et non utilisés. |
| `frontend/app/components/useProgressData.ts` | Navigateur Auth ; rattachement des tentatives à leur chapitre | Métadonnées d'historique, pas un sélecteur ; inchangé. |
| `frontend/app/feedback/page.tsx` | Navigateur Auth ; titres des exercices référencés dans les feedbacks | Métadonnées, pas un chargeur ; modifications préexistantes préservées. |
| `frontend/app/admin/dashboard/useDashboardData.ts` : trois lectures | Navigateur, session Admin, politiques Auth | Comptage/catalogue administratifs, pas de parcours élève ; brouillons accessibles à l'Admin intentionnellement. |
| `frontend/app/api/admin/claude-exercises/route.ts` | Next.js service role après vérification Admin | Lit le catalogue historique séparé `exercises_claude` et peut transférer un exercice historique ; ce chemin ne sélectionne pas les pilotes canoniques, n'a pas été utilisé/modifié. |
| `frontend/app/validation/page.tsx`, anciennes pages de gestion | API administratives ci-dessus | Pas de lecteur Supabase supplémentaire d'exercice ; parcours de gestion non utilisé pour les pilotes. |

Les routers DS/duels/friends et pages de match consultent aussi sessions/tentatives/
scores. Leurs sélections d'exercices repassent par les chemins ci-dessus ; aucune
lecture applicative de `exercise_versions` ni intégration Engine serveur NovLearn
n'a été trouvée. Les scripts de synchronisation/export et tests sont des outils
opérateur, pas des parcours élèves ; aucun export/catalog-sync/migration distante
n'a été lancé. Le scheduler FastAPI traite les notifications ; aucun lecteur de
définition supplémentaire trouvé. Aucune garantie donnée sur un ancien binaire ou
processus VPS non inspecté : le code local corrigé n'a pas été déployé.

## Inventaire SQL Staging et preuve de cible

Source de cible : `list_projects` du connecteur Supabase authentifié identifie
`novlearn-staging`, région `eu-west-3`, PostgreSQL 17.11, référence
`tksvbkvfusrnxulpahky`. Production est le projet distinct
`novlearn-prod` / `abwipnppcrghdhwriyjp`. Toutes les requêtes SQL de cette mission
ont explicitement utilisé la seule référence Staging ; aucune requête SQL Production.

Recherche distante dans `pg_proc`, définitions lues pour les fonctions élèves,
triggers et entrées privilégiées pertinentes ; `pg_policies`, vues, vues
matérialisées, triggers, ACL et `cron.job` vérifiés. Aucun SQL dynamique `EXECUTE`
dans les fonctions des schémas `public`/`novlearn_admin_private`, aucune vue ou vue
matérialisée référençant les tables, zéro tâche cron et zéro Edge Function.

| Groupe | Fonctions / comportement |
| --- | --- |
| Tirage élève | `get_random_exercise(text,text)` : postgres definer, exécutable par PUBLIC/anon/authenticated/service_role ; chapitre/difficulté, **pas de filtre de publication**. Corps attendu et constaté : MD5 `14fac9361afb35bb7fa64df3649551eb`. |
| Compteurs élève | `get_chapters_with_count(uuid)` : postgres definer, authenticated/service_role ; identité permanente propre exigée, mais agrégation sans éligibilité. MD5 `887bc36f41086cb5ec3647782cd42d04`. |
| Catalogue Admin / références | `admin_list_exercises`, `admin_content_overview`, `admin_save_exercise_draft`, `admin_duplicate_exercise`, `admin_archive_exercise`, `admin_mutate_taxonomy`, `novlearn_admin_private.taxonomy_usage` : gestion/usage du catalogue, brouillons nécessaires à l'Admin ; invoker/RLS ou contrôle Admin explicite. Aucun appelé en écriture. |
| Tests/relecture Admin | `admin_record_exercise_test`, `admin_review_exercise_version` : contrôle `is_novlearn_admin`, révision/empreinte/état exacts ; aucune sélection élève. Le premier attend encore l'archive 0.1.0 `d4d3abc4…` et un rapport `engineVersion=0.1.0` : une qualification locale 0.1.1 ne prouve pas l'acceptation d'un reçu distant. |
| Publication | `admin_export_exercise_publication`, `apply_exercise_publication`, `publish_exercise_version`, `novlearn_admin_private.publication_target_state`, `record_publication_outcome`, `guard_pending_publication_source` : circuit de publication distinct ; `apply_exercise_publication` réservé aux rôles publication writer/executor, les entrées Admin vérifient le rôle. Aucun appel d'activation/publication effectué. |
| Versions et tentatives | `require_published_active_exercise_version`, `require_published_attempt_version`, `require_published_duel_exercise_version`, `require_novlearn_attempt_instance_version` : contrôles de version publiée ; pas des sélecteurs. Les tentatives historiques sans version restent sans version ; aucun rattachement arbitraire ajouté. |
| Scores historiques | `handle_exercise_completion` : lit la difficulté par ID pour comptabiliser une tentative, ne livre pas d'exercice ; inchangé. Aucun test de score distant. |
| Autres triggers sur parents/versions | `manage_exercise_version`, `advance_exercise_test_epoch`, `manage_exercise_publication_epoch` et garde de publication : métadonnées, intégrité/immutabilité ; pas de tirage d'exercice. |

Les politiques anon/authenticated de `exercises` sont permissives pour la lecture
mais complétées par une politique **restrictive** portant le même prédicat ;
authenticated bénéficie d'une exception Admin. Les versions sont réservées à
l'Admin et au circuit de publication. Cela ne protège ni le service role ni la
RPC postgres definer. Les ACL ont été lues, jamais changées.

Lecture finale : **112 parents, 111 historiques, un canonique sans actif, une
version, zéro actif, zéro titre pilote**. Les deux MD5 sont toujours ceux
ci-dessus. Aucun compte, tentative ou score extrait pour cet inventaire.

## Changements préparés, copie et retour arrière

- [RPC aléatoire proposée](../sql-proposals/20261101-exclude-unpublished-pilots.sql)
  et [retour au corps exact](../sql-proposals/20261101-exclude-unpublished-pilots-rollback.sql) :
  copies des propositions Admin, inchangées ; garde MD5 avant remplacement.
- [Compteur supplémentaire](../sql-proposals/20261101-chapter-count.diff) :
  une seule ligne `WHERE`, sans changer identité, compte de succès, permissions,
  tables ou pointeur actif. Toute future application doit revérifier le MD5 et
  utiliser le corps courant ; le diff n'est pas appliqué ici.
- `node scripts/test-engine-pilot-exclusion-embedded.mjs` lit uniquement les
  fichiers SQL locaux et ouvre une base **en mémoire**. PostgreSQL/WASM 18.3,
  pas une copie complète de Supabase 17.11. Les rôles, la table et les données
  sont synthétiques ; aucun dump de données distantes.
- Le test reproduit la fuite d'origine, conserve historique et canonique actif,
  exclut le brouillon, contrôle chapitre/difficulté/chapitre absent et **1 000
  tirages**. Un vrai rôle SQL `BYPASSRLS` voit initialement les trois parents,
  puis seulement les deux éligibles avec le filtre ; l'ID du brouillon est exclu.
  Les lignes avant/après sont identiques et le corps aléatoire est restauré au
  MD5 exact. Le compteur complet d'origine est aussi exécuté avec Auth synthétique,
  la ligne proposée retire le chapitre brouillon, puis son MD5 original est restauré.
- Docker a été inventorié localement, puis son moteur a cessé d'être disponible
  avant la création d'une copie. Aucun conteneur de mission créé. La copie WASM
  équivalente évite une installation ou un redémarrage d'infrastructure.
- Le rollback non filtré **réouvre la fuite** si des pilotes existent. Archiver un
  parent seul ne suffit pas, puisque l'ancien lecteur ignore aussi l'archivage.
  Ne jamais utiliser ce retour en présence de pilotes exposables sans mesure de
  confinement approuvée ; aucune suppression/archivage automatique n'est prévu.

## Vérifications réellement exécutées

| Niveau | Résultat et limites |
| --- | --- |
| Backend Python ciblé | 68 tests passent, dont la nouvelle matrice historique/brouillon/actif sur recommandations, secours, DS, premier positionnement et reprise. Transport/persistance simulés. |
| Backend complet | **184 tests passent** sous Python 3.12.14 ; boucle réseau de test forcée vers `127.0.0.1:1`, fausse clé, scheduler désactivé, plugins explicites. Deux essais restreints restaient bloqués au TestClient et ont été interrompus ; l'exécution locale autorisée complète passe. Six avertissements de dépendances. |
| Frontend ciblé | **17 tests passent**, quatre fichiers : permissions API, métadonnées filtrées, vrai composant Loader avec transport/enfants simulés, refus de rendu/persistance d'une lecture exclue. |
| Sérialisation des requêtes | Vrais SDK Python et JavaScript installés, HTTP intercepté sans réseau : prédicat conservé avec chapitre, difficulté, ID, compte et pagination. Ce n'est pas un service PostgREST réel. |
| Duel complet | **66 tests passent**, dont trois nouveaux cas de sélection (100 tirages sans brouillon, canonique actif, pool de brouillons refusé). Ce n'est pas une session duel distante. |
| Qualité | TypeScript frontend sans émission, lint des quatre modules frontend concernés, compilation TypeScript duel et `git diff --check` réussis. Pas de build frontend avec les secrets locaux Production. |
| Copie SQL | Réussite décrite ci-dessus ; ni Auth Supabase réelle, ni Engine, ni rendu navigateur. |
| Intégrité Engine Admin | `npm.cmd run verify:engine` repassé : archive exacte, 157 fichiers installés, exports/lock et 27 modules portables conformes. Cela ne démarre pas le host. |
| Staging | Métadonnées, fonctions, ACL/politiques/triggers et inventaire lus. **Aucun tirage distant exposant une définition privée**, aucune insertion de fixture, aucune modification SQL appliquée. |

La qualification Linux précédente de 108 appels et les 1 571 tests Admin sont
des preuves antérieures de la réception Admin, non réexécutées ni renommées en
qualification d'hébergement. Le Vercel mesuré refuse toujours le host dans le
dossier de réception ; Railway et les Functions conteneurisées restent non
qualifiés. Aucun host de remplacement installé ou déclaré fonctionnel ici.

## Pilotes et parcours non réceptionnés

Le [manifeste](2026-11-engine-pilot-manifest.json) consigne les cinq marqueurs,
les identités/révisions **locales** et les SHA256 des définitions locales en
`pg-jsonb-text-v1`. L'empreinte du fichier source est
`4082bfa02268d434e3378aa8ac77328f735899c074c8fb18a4a68da87265fd43`.
Tous les champs d'identité/révision/empreinte **Staging sont explicitement null**.
Aucun attendu, définition complète, mot de passe ou clé n'est copié dans le reçu.
L'archive visée est 0.1.1, SHA256
`c7116f9310da49478deb43ca64e04b974efd34765b45a22294c13b5235bdf927`.

| Marqueur | Référence locale déjà documentée | Création/relecture Admin Staging et parcours NovLearn |
| --- | --- | --- |
| `[PILOTE ADMIN M1-01]` | Suites numériques / `calculer_des_termes` | Non exécutés ; aucun ID distant. |
| `[PILOTE ADMIN M1-02]` | Suites numériques / `calculer_des_termes` | Non exécutés ; aucun ID distant. |
| `[PILOTE ADMIN M1-03]` | Dérivation et Fonctions / `calculer_une_derivee` | Non exécutés ; aucun ID distant. |
| `[PILOTE ADMIN M1-04]` | Suites numériques / `reconnaitre_suites_arith_geo` | Non exécutés ; aucun ID distant. |
| `[PILOTE ADMIN M1-05]` | Suites numériques / `calculer_des_termes` | Non exécutés ; aucun ID distant. |

Pour **chacun des cinq**, lecture de révision distante, génération Engine sur
seeds 0/1/42, rendu navigateur NovLearn, réponses correcte/incorrecte/invalide,
correction serveur, rejeu/reprise et exclusion observée contre Staging sont
**non testés**. Les sélecteurs sont testés localement ; cela ne reçoit ni DS,
duels, sessions réelles ni rendu canonique. Aucun verdict navigateur n'a été
accepté dans un nouveau parcours Engine : aucun tel parcours n'a été activé.

## Configuration et actions nécessaires pour reprendre

Les URLs et claims non secrets des clés ont été contrôlés, sans afficher les clés :
`frontend/.env.local`, `backend/.env`, `duel-server/.env` visent tous
`abwipnppcrghdhwriyjp` (Production). Les clés anon/service_role correspondent à
cette référence et aucune clé privilégiée n'est dans `NEXT_PUBLIC_*`. Ces trois
fichiers sont **inchangés**. Aucun accès applicatif Production exécuté. Les tests
Python ont une configuration factice explicite et les tests JS interceptent HTTP.

1. Autoriser explicitement le delta supplémentaire du compteur ci-joint ;
   réconcilier/revérifier les deux corps et leurs ACL sur Staging avant toute
   application. Le premier changement seul ne ferme pas tous les lecteurs.
2. Recevoir l'exécution des lecteurs corrigés dans le périmètre Staging utilisé,
   sans présumer qu'un code local protège un processus ancien. Aucun déploiement
   n'est autorisé par cette mission ; déterminer les lecteurs réellement actifs.
3. Après succès des protections, créer/rechercher les cinq pilotes via le parcours
   Admin authentifié existant, vérifier marqueur + empreinte avant chaque création,
   conserver IDs/révisions réellement retournés, actif nul et état non publié.
   Ne pas contourner Auth/rôle par SQL ou par une clé Production.
4. Configurer les services de développement avec de vraies capacités Staging
   vérifiées, scheduler désactivé ; ne jamais réutiliser les clés Production.
   Recevoir séparément le host Engine local autorisé et les snapshots privés.
   Réconcilier le pin 0.1.0 des reçus si ce circuit est nécessaire : aucune rotation
   distante implicite n'est incluse dans le présent diff.
5. Exécuter ensuite les cinq parcours NovLearn avec correction Engine au serveur,
   projection publique seule au navigateur, identité/révision/seed liées côté
   serveur et refus de tout verdict envoyé par le navigateur. Consigner les trois
   classes de réponse et chaque mode/reprise effectivement testé.

Les fichiers modifiés par cette mission sont les quatre consommateurs Python et
leur nouveau helper, le helper de tests et sa nouvelle matrice ; `duel-server/src/db.ts`
et son test ; les composants TrainingPage/ExerciseLoader, la route API (ajouts
ciblés), le nouveau module frontend d'éligibilité et quatre fichiers de tests ;
le banc SQL embarqué et son SQL ; les quatre propositions/snapshots SQL ; ce
rapport et son manifeste. Les migrations, mathématiques, lockfiles et documents
préexistants n'ont pas été modifiés par cette mission. Les dépôts restent non
committés dans leurs branches initiales, avec leurs travaux préexistants.
