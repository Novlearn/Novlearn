# Réception Engine — entraînement pilote Staging, 1er novembre 2026

> Réception historique de la route éphémère. Le 2 novembre, cette route et son
> API ont été supprimées au profit des [parcours existants](2026-11-engine-existing-routes.md).
> Les preuves ci-dessous restent celles du 1er novembre.

Premier lot progressif réalisé sur `codex/integration-engine-staging`, depuis
`74381ee3989375bd563386b73ed55f88f952da46`. Cinq brouillons ont été créés par
l'interface Admin existante, puis utilisés dans NovLearn avec le véritable host
Linux Engine. Les modifications antérieures des deux dépôts sont conservées.
Aucune écriture Production, publication de pilote ou mise en production.

## Périmètre reçu

- Parcours local réservé aux administrateurs :
  `http://127.0.0.1:3000/entrainement/pilotes`.
- Données et Auth du seul projet `novlearn-staging` / `tksvbkvfusrnxulpahky`.
  La session Admin existante est vérifiée côté serveur, y compris son cookie
  HttpOnly, sans rendre son jeton lisible par le navigateur.
- Génération et correction par Engine 0.1.1, archive SHA256
  `c7116f9310da49478deb43ca64e04b974efd34765b45a22294c13b5235bdf927`.
  Le vérificateur contrôle les 157 fichiers installés, les exports, le verrou
  des dépendances et leurs versions. Aucun nouvel algorithme mathématique.
- Le navigateur reçoit la projection publique officielle, une référence opaque
  de session et les verdicts. La définition et les attendus restent côté serveur.
  La soumission est reconstruite à partir de l'instance officielle conservée ;
  un verdict ou un champ `is_correct` fourni par le navigateur est refusé.
- Rendu des textes, expressions LaTeX, questions, QCM à identifiants stables,
  sections et tableaux de valeurs des pilotes. Les états correct, incorrect,
  invalide, indéterminé et erreur restent distincts.

Les lecteurs historiques Python, frontend et Colyseus appliquent explicitement
`catalog_id IS NULL OR active_version_id IS NOT NULL`, y compris les lectures
privilégiées et les relectures par identifiant. Voir l'[audit initial](2026-11-engine-staging-safety.md)
pour l'inventaire et la qualification sur copie. Cela conserve les anciens
exercices sans identité canonique et exclut les brouillons canoniques.

## Protection distante appliquée avant création

Après autorisation du second correctif, la migration ciblée
`20261101171424_exclude_unpublished_engine_pilots` a modifié les deux fonctions
Staging suivantes, sans modifier leurs signatures, droits ni lignes du catalogue.

| Fonction | MD5 du corps initial | MD5 constaté après application |
| --- | --- | --- |
| `get_random_exercise(text,text)` | `14fac9361afb35bb7fa64df3649551eb` | `9c741f73d4d49670c88d7f5bb0939338` |
| `get_chapters_with_count(uuid)` | `887bc36f41086cb5ec3647782cd42d04` | `d8d84f81b6ad579af275f0d9ad2d1b57` |

Le [SQL réellement appliqué](../../supabase/rollouts/20261101171424_exclude_unpublished_engine_pilots.applied.sql)
contrôle les empreintes initiales. La qualification locale PostgreSQL en mémoire
couvre 1 000 tirages, les filtres, un rôle BYPASSRLS, les compteurs et le retour
aux corps exacts. Aucune migration générale ni `db:push` n'a été lancé.

Contrôles distants après création : 1 000 tirages sans filtre, zéro pilote ;
100 tirages `Suites numériques` / `Facile`, zéro pilote, zéro résultat hors filtre
et zéro tirage vide. Les deux empreintes et ACL ont été relues après ces tests.
Une lecture REST avec la seule clé publique, sans session, renvoie HTTP 200 et
zéro ligne pour les identifiants 122 à 126.
Les cinq parents pilotes ont tous `active_version_id = NULL` et leurs versions
restent `draft`. Le pool classique contient 111 exercices éligibles et zéro pilote.

Le [retour arrière encadré](../../supabase/rollouts/20261101171424_exclude_unpublished_engine_pilots.rollback.sql)
est fourni pour revue, **non exécuté à distance**. Il refuse un corps modifié
depuis la réception et la présence de parents canoniques sans version active.
L'archivage seul ne rendrait pas les anciennes fonctions sûres. Conserver les
protections tant que ces parents existent ; aucune suppression ni publication
n'est autorisée par ce document.
Son refus en présence du brouillon synthétique et la restauration exacte des
deux empreintes initiales ont aussi été vérifiés dans la base en mémoire.

## Cinq créations Admin et preuve navigateur

Chaque création a été précédée d'une recherche de doublon marqueur/empreinte,
effectuée par le formulaire Admin puis relue dans sa page de détail. Les cinq
définitions correspondent aux sources après attribution de l'identité canonique.
Le [manifeste](2026-11-engine-pilot-manifest.json) contient les UUID et SHA256 exacts,
sans attendus privés ni faux reçu de publication.

| Pilote | Exercice Staging | Révision | Statut |
| --- | --- | --- | --- |
| M1-01 | 122 | 1 | Brouillon, non actif |
| M1-02 | 123 | 1 | Brouillon, non actif |
| M1-03 | 124 | 1 | Brouillon, non actif |
| M1-04 | 125 | 1 | Brouillon, non actif |
| M1-05 | 126 | 1 | Brouillon, non actif |

Les cinq pilotes ont été testés dans le navigateur sur les graines **0, 1 et 42** :
15 instances, **54 corrections** réelles (réponse correcte, incorrecte et invalide,
sur chacune des deux questions de M1-05). Le QCM et l'équivalence symbolique sont
inclus. Pour chaque instance, le rechargement a restauré la même identité,
version, empreinte et les derniers verdicts, sans nouvelle génération.

Les [15 lignes de preuve](2026-11-engine-staging-browser-proof.json) conservent
les identités et résultats, sans les réponses. La [capture finale](2026-11-engine-staging-browser.png)
montre M1-05 après reprise. Le libellé « Dernière correction » distingue les
verdicts restaurés des champs de saisie qui sont vidés au rechargement.

Le [host effectivement utilisé](2026-11-engine-staging-host-proof.json) exécute
l'API officielle dans l'image Node 24.19.0 épinglée, sans réseau, en lecture seule,
utilisateur 65534, 384 Mio de mémoire, sans swap, 64 processus maximum,
une exécution et quatre demandes en attente. Prétests valides, invalides et
annulés réussis. Aucun secret Auth ou base n'est transmis au worker.

## Vérifications et reproduction

- Suite frontend finale : **234 tests réussis, 9 TODO**, 14 fichiers. Ce total
  inclut des tests historiques documentant des défauts connus de l'ancien moteur ;
  il ne certifie pas toute la correction historique.
- Dont 48 tests pilotes : orchestration avec le vrai cœur Engine et transport
  simulé ; API avec Auth/base simulées ; composants avec saisie simulée.
  Ces tests se distinguent de la réception navigateur/host/base réelle ci-dessus.
- TypeScript sans émission, lint des nouveaux modules et `git diff --check` : OK.
- Protections historiques déjà vérifiées dans ce lot : backend 184 tests,
  serveur duel 66 tests. Aucun autre changement Python/duel dans l'intégration.
- Archive Engine et dépendances vérifiées : OK.

Prérequis locaux : Node 24.19.x, npm 11.17.x, Docker Desktop Linux opérationnel.
Le fichier racine ignoré `.env.engine-staging.local` contient uniquement l'URL
et la clé publique Staging, l'origine `http://127.0.0.1:3000` et le drapeau pilote.
Les fichiers `.env` existants visant Production sont conservés. Ne pas lancer
le démarrage général pour recevoir ce parcours.

Depuis `frontend`, lancer `npm run verify:engine`, puis
`npm run dev:engine-staging`. Le lanceur vérifie la cible, démarre le host isolé,
neutralise les paramètres privilégiés et le proxy vers l'ancien backend,
puis démarre NovLearn sur 127.0.0.1:3000. Se connecter à l'Admin Staging existant
sur 127.0.0.1:3150 avec le compte autorisé, puis ouvrir le parcours pilote.
`Ctrl+C` arrête uniquement les processus et le conteneur de ce lanceur.
L'option explicite `--ui-only` ne permet aucune génération/correction.

## Limites et prochain lot

Ce lot est un parcours d'entraînement pilote Admin en développement. Il ne
remplace pas encore l'entraînement élève général, le positionnement, les DS ou
les duels. Il n'écrit ni tentatives, ni scores, ni progression. Les instantanés
officiels restent en mémoire privée pendant dix minutes, au plus deux par Admin
et 32 globalement ; un redémarrage les expire au lieu de les régénérer.

Le prochain lot doit établir le stockage durable des instances/tentatives et
l'attribution des scores côté serveur, puis raccorder progressivement
l'entraînement élève, le positionnement, les DS et les duels. La publication
Admin et ses reçus restent un chantier distinct : aucun pilote n'a été publié,
aucune compatibilité de reçu ancien avec Engine 0.1.1 n'est supposée. Aucun
hébergement distant du host Engine ni déploiement applicatif n'a été qualifié.
