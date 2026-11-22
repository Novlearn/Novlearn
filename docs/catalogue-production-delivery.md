# Lot de transition Production historique — 13 novembre 2026

Le code et les propositions SQL sont préparés sur `feat/content-catalog-sync`,
en poursuivant les modifications déjà présentes. Aucun commit, push, merge,
déploiement, changement de workflow ou écriture hébergée n'a été effectué.
Les deux dépôts voisins ont seulement été lus. **Le lot est révisable ; son
activation Production reste bloquée par les conditions ci-dessous.**

## Décisions de compatibilité

Les six fichiers sous [`supabase/proposals/catalogue-production/`](../supabase/proposals/catalogue-production/)
constituent une route spécifique au schéma observé. Ils sont volontairement
hors de la chaîne automatique des migrations. La capacité atomique existante
`20261112123000_catalogue_sync_target.sql` est réutilisée entre `003` et `004`.
Ne pas lancer `db push` pour installer ce lot.

| Ordre | Artefact | Effet |
| --- | --- | --- |
| 1 | `001_prepare.sql` | Identités nullable, versions, FK composites, colonne de tentative nullable, runtime Production désactivé et instantanés privés de toutes les lignes historiques. Aucun UUID catalogue attribué automatiquement. |
| 2 | `002_bind.sql` | Fonctions réservées à l'opérateur pour rattacher un manifeste explicitement revu et préparer une définition historique. Aucun appel automatique. |
| 3 | `003_runtime.sql` | Tables de replay, sessions et corrections serveur, instances de duel, garde de version active et projection des références déjà résolues. DDL sélectionné des contrats existants, sans journal source. |
| 4 | `20261112123000_catalogue_sync_target.sql` | Import atomique, dépendances, inspections concurrentes, reçus et observation de reprise. |
| 5 | `004_readers.sql` | Réservations, garde des nouvelles sessions, versions privées, disponibilité/archives et droits serveur. |
| 6 | `005_statistics.sql` | Statistiques versionnées sur la difficulté figée ; parcours historique sans version conservé ; pas de récompense pour les invités Engine. |
| 7 | `006_legacy_readers.sql` | Conservation des deux RPC historiques avec filtre d'archive explicite, nécessaire pour ces fonctions `SECURITY DEFINER`. |

Prérequis réels : les tables historiques documentées dans l'audit, `auth.users`,
les rôles Supabase et `extensions.digest` de pgcrypto. Le précontrôle doit
revérifier leurs types, contraintes, politiques, propriétaires et le corps du
trigger de statistiques. La fixture reproduit les lecteurs et les deux triggers
de tentative observés. Elle est un sous-ensemble synthétique du schéma métier,
pas une restauration de toutes les fonctionnalités Supabase.

Les anciennes migrations de workflow Admin, journaux, reçus de tests Engine,
rotation d'archives, import technique Staging et suppression de `content` ne sont
pas des prérequis cible. En particulier, **ne pas appliquer**
`20261102203458`, `20261102210109`, `20261106103509`, ni la chaîne source
`20261112100908`–`20261112122207` sur Production. Staging conserve sa capacité
source ; aucun importateur cible n'y a été installé pendant cette mission.

L'original est conservé dans `historical_exercise_snapshots`, sans toucher à
`exercises.content`. Sa définition de compatibilité, issue de la première
adaptation source dont la provenance est vérifiée, occupe **la révision SQL 0**
avec l'origine `historical`. Elle conserve la révision interne Engine d'origine
et son UUID SQL explicite. Les révisions source restent positives : une révision
source 1 différente peut donc être importée sans conflit. `legacy_version_id`
est distinct de `active_version_id` ; préparer l'exécution historique ne publie
aucune nouvelle révision Staging.

Le rattachement exige `approved=true`, un réviseur, des justificatifs par entrée,
l'unicité des clés, la provenance d'exercice et une empreinte historique
revérifiée sous verrou. Les registres candidats restent tous `approved=false`.
Le rejeu identique est accepté ; une empreinte périmée ou une autre association
échoue. Les fonctions ne sont accordées ni à l'application, ni à Admin, ni au
rôle de synchronisation. Avant de déployer le nouveau lecteur, le responsable
doit préparer toutes les définitions historiques nécessaires : un historique
sans adaptation revue reste volontairement indisponible dans Engine.

L'importateur admet désormais la mise à jour d'une ligne dont le contenu est
rempli. Son trigger refuse la modification du contenu ou de l'identité par le
writer. La conservation ne repose donc plus sur la contrainte RLS incorrecte
`content = '{}'`. Le transfert de propriété des fonctions est aussi compatible
avec `postgres` non superutilisateur : son droit temporaire `SET` est retiré
dans la transaction. Le rôle writer reste sans login, héritage ni bypass RLS.

## Lecteurs et activités

En Production non durcie, backend, route de métadonnées, entraînement et duels
acceptent la version active ou la version historique préparée. Le catalogue
historique reste présent avant confirmation. Après import, le lecteur utilise
uniquement `active_version_id`. Une nouvelle révision brouillon source ne le
remplace pas. Les lectures Staging n'interrogent pas la colonne cible
`legacy_version_id`, absente de la source.

Les archives sont exclues des nouveaux démarrages même avec
`PRODUCTION_CATALOG_SYNC_ENFORCED=false`. Sessions et rounds déjà réservés
terminent sur leur version et leur contenu sauvegardés. Le serveur de duels ne
relit plus la version active du parent pour remplacer une réservation.
Les définitions complètes, les réponses et les instantanés privés ne sont pas
accordés aux lecteurs publics du nouveau modèle.

Les anciennes tentatives restent à `exercise_version_id=NULL`. Aucune ancienne
tentative n'est rattachée à la nouvelle version active. Les nouveaux résultats
seuls portent la version effectivement utilisée. Les PK, `duels.exercise_data`
et les liens d'activité sont conservés. Les anciennes rooms déjà en mémoire
doivent être drainées sur leur processus d'origine avant son remplacement :
on ne sait pas reconstituer une ancienne génération sans seed ni version connue.
Ne pas transformer un vieil instantané inconnu en instance de la version active.

## Registres privés et exceptions

Fichiers ignorés par Git, à conserver dans un espace de revue privé :

| Registre | État constaté |
| --- | --- |
| Admin `.local/catalogue-production-exercise-correspondences.json` | 111 propositions historiques, inchangées, `approved=false`. |
| NovLearn `.local/catalogue-production-historical-execution-candidates.json` | 111 premières définitions, provenance vérifiée dans Staging ; aucune dernière révision sélectionnée automatiquement. |
| `.local/catalogue-production-historical-definition-validation.json` | 111 empreintes pédagogiques conformes au registre et 111 définitions conformes au contrat Engine 0.2.1. Aucune approbation éditoriale déduite. |
| `.local/catalogue-production-reference-correspondences.json` | 8 chapitres, 28 compétences, 27 flashcards candidats par même PK et empreinte complète ; revue de provenance requise. Aucune recherche de correspondance par nom. |
| `.local/catalogue-production-reference-exceptions.json` | 27 références d'exercice non résolues, 2 flashcards sans chapitre, 3 scores sans compétence, 2 tentatives sans exercice. |
| `.local/catalogue-production-transition-manifest-candidate.json` | 174 propositions réunies pour la revue ; toutes `approved=false`, les deux flashcards sans chapitre marquées bloquées au transfert. |

Les 27 références restent dans les instantanés historiques. Les scores orphelins
restent sur leur clé d'origine ; les tentatives sans exercice restent nulles.
Les deux flashcards ont une identité candidate mais **pas de dépendance chapitre
prouvée** : leur transfert est bloqué jusqu'à décision explicite. La comparaison
diagnostique des noms sert seulement à quantifier ces anomalies. Elle ne produit
aucune association exécutable. Aucun compte ni aucune activité individuelle n'a
été exporté dans les fixtures ou les artefacts publics.

## Versions Engine et paramètres

| Composant observé | Version / contrat |
| --- | --- |
| NovLearn frontend, archive et lock | Engine 0.2.1, archive SHA-256 `6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a` ; 189 fichiers installés vérifiés. |
| Duels | Même empreinte attendue sur chaque requête/réponse du host. |
| Backend Python | Sélection et orchestration ; les calculs restent dans Engine. |
| NovLearn Admin, archive et lock | Engine 0.1.8, SHA-256 `82e499726db2da454627903ed65802eaa2ab3e7185f7f6cb3c84c1cbdbde3cea`. Aucune modification. |
| Registre Staging lu le 13 novembre | Même archive 0.1.8 ; `enabled=false`. |
| Contrat de données commun | Schéma 5, `engine-0.1.0`, `mulberry32-rejection-v1`, `pg-jsonb-text-v1` ; protocole de transport 1. |

Le numéro de pipeline `0.1.0` n'est pas la version du paquet. Le contrat de données
compatible ne rend pas les empreintes de transport interchangeables. Un host
0.2.1 ne peut pas être annoncé comme un host Admin 0.1.8. Le responsable doit
qualifier un host NovLearn 0.2.1 séparé si le host Admin Staging reste 0.1.8 ;
aucune rotation Staging n'est demandée par ce lot. Le host Production 0.2.1 doit
être installé et testé avant toute activation des parcours.

Paramètres serveur à configurer **séparément** :

| Paramètre | Staging | Production |
| --- | --- | --- |
| `APP_ENV` | `staging` | `production` |
| URL Supabase Next et backend/duels | projet `tksvbkvfusrnxulpahky` | projet `abwipnppcrghdhwriyjp` |
| Clés serveur Next / Python / duels | clés Staging | clés Production, distinctes |
| `ENGINE_URL`, `ENGINE_TOKEN` | host NovLearn 0.2.1 qualifié ; conserver le host Admin 0.1.8 distinct | host privé 0.2.1 qualifié, token distinct |
| `NOVLEARN_ENGINE_ENABLED` | activation indépendante après qualification | `false` jusqu'à la recette et la préparation des historiques |
| `PRODUCTION_CATALOG_SYNC_ENFORCED` | non utilisé pour sélectionner les brouillons | `false` pendant la coexistence ; `true` seulement quand le catalogue visé est synchronisé et contrôlé |
| Runtime SQL `enforce_production_sync` | source inchangée | `false` pendant la coexistence ; aligner avec les trois processus au durcissement |

Seules l'URL Supabase, la clé publique et l'origine du site utilisent les variables
publiques prévues. Aucun token Engine ou clé de service ne doit être public.
Engine désactivé ou host inaccessible produit une indisponibilité explicite ;
aucune correction mathématique de secours n'est exécutée dans le navigateur.
Désactiver la sélection durcie conserve le chemin historique préparé, pas les
archives. Le host reçoit les définitions nécessaires aux calculs, jamais les
identifiants de connexion aux bases.

Ces tests de release ne deviennent pas une condition à chaque synchronisation.
**« À publier » reste la validation humaine suffisante** ; aucun reçu Engine ni
test automatique de génération n'a été ajouté au parcours d'export/import.

## Vérifications exécutées

PostgreSQL **17.11**, PostgREST **14.18**, archive Engine 0.2.1 réellement installée
dans un conteneur Linux borné, identités aléatoires neuves. Les tests n'ont utilisé
aucune ligne personnelle de Production. La source locale est une copie isolée
du socle de recette Admin, avec propriétaires de la configuration alignés sur
l'état Staging observé ; ce n'est pas une nouvelle base Supabase hébergée.

| Vérification | Résultat |
| --- | --- |
| Ancien contrat SQL + préparation | Deux RPC historiques réels chargés ; contenu et décompte conservés, tentatives anciennes sans version. L'ancien navigateur complet n'a pas été lancé. |
| Lecteur et correction nouveaux sur historique | Route Next réelle, PostgreSQL/PostgREST réels, génération et correction par le vrai host ; reprise après archive et tentative sur la version initiale. Seule l'identité authentifiée est injectée dans cette recette. |
| Duels | Sélection historique, version active explicite, brouillon suivant ignoré, archive refusée pour nouveau départ ; réservation conservée pour les rounds suivants et replay privé. |
| Premier lot mixte | Exercice, chapitre, compétence et flashcard sur des PK existantes ; même ligne exercice, aucun doublon, contenu conservé et projection modifiée après confirmation uniquement. |
| Historique / statistiques | Révision SQL 0 et source 1 différentes, anciens liens préservés ; difficulté initiale encore utilisée après changement de difficulté du parent. |
| Atomicité | Rejeu identique, digest divergent, inspection périmée, conflits immuables et rollback des premières écritures du lot. |
| Reprise source après RLS | « À publier », préparation, claim, COMMIT cible réel avec réponse ignorée, observation puis finalisation source sans nouvel import ni nouveau reçu. |
| Reprise négative | `uncertain → failed` refusé avec `target_rejected` ; clôture après observation réelle `not_applied` seulement. |
| Sauvegarde / restauration | `pg_dump` avant préparation, restauration dans une autre base locale, comparaison exacte des exercices, tentatives, duels et scores de la fixture. |
| RLS | Les 22 assertions pgTAP après `20261113101533` passent sur PostgreSQL ; source sans importateur cible ; rôles élève/service sans capacité privée cible. |
| Backend | 184 tests passent. Le lancement Windows restreint bloquait la boucle locale `asyncio` ; relance avec accès local réussie. |
| Frontend | 117 tests, TypeScript, vérification des 189 fichiers Engine et build Next passent. |
| Duels | 66 tests et build TypeScript passent ; test supplémentaire de correction avec host réel réussi. |

Les preuves détaillées sont dans `.local/production-transition/<identifiant>/`
(`proof.json`, `runtime-rls.tap`, `before.sql`, `application-proof.json`) et
`.local/production-transition/latest.json`. Elles ne sont pas publiques.
Les scripts reproductibles sont `supabase/tests/run_production_transition.mjs`,
`run_production_application.mjs` et `verify_historical_candidates.mjs`. Ils visent
uniquement les conteneurs locaux nommés dans le script et créent de nouvelles
bases/identités ; aucun `.env` hébergé n'est chargé par ces scénarios. Le premier
script requiert le socle source local Admin `admin_local` déjà qualifié et les
images locales indiquées ; il ne prétend pas reconstruire toute cette source
depuis un PostgreSQL vide.

## Procédure réservée au responsable

1. Confirmer le périmètre, les lecteurs et le traitement conservatoire des
   exceptions. Faire revoir le diff, les registres privés, les corps de fonctions
   Production et les empreintes des artefacts. Les associations approuvées doivent
   être un manifeste distinct ; ne pas retourner automatiquement les booléens
   des candidats. Aucun lancement de transfert n'est autorisé par ce document.
2. Établir une sauvegarde cohérente chiffrée, son point de restauration et son
   délai de conservation. Répéter sa restauration dans un environnement isolé
   autorisé, avec contrôle des PK/FK, séquences, ACL/RLS, fonctions, comptes Auth,
   stockage et volumes d'activité. La sauvegarde synthétique locale ne remplace
   pas cette preuve propre à la Production.
3. Dans une fenêtre dédiée approuvée, appliquer uniquement la séquence SQL du
   tableau. Vérifier qu'elle s'arrête sur un état imprévu. Les flags et le runtime
   restent désactivés. Contrôler immédiatement contenu, PK, anciennes tentatives,
   snapshots et anciens lecteurs ; arrêter si une valeur historique diverge.
4. Revérifier les preuves source et cible sous verrou, rattacher les identités
   explicitement approuvées, préparer les définitions historiques via la fonction
   opérateur et contrôler la couverture avant de remplacer un lecteur. Conserver
   toutes les lignes non rapprochées ; aucun effacement de `content`.
5. Installer/qualifier les hosts de release avec tokens distincts et vérifier
   santé, empreinte, génération, projection, correction, indisponibilité et
   isolation réseau. Déployer le code sans sélection durcie ; drainer les anciennes
   rooms sur leur processus d'origine, conserver les hosts nécessaires aux sessions
   en cours. Cette mission ne réalise aucune de ces interventions distantes.
6. Recetter de vrais JWT élève/invité/Admin et les parcours navigateur entraînement,
   DS, flashcards et duels, dont formats nouveaux, clavier, mobile et thèmes. La
   recette de route locale a une identité injectée : elle ne remplace pas Auth
   et la recette navigateur sur l'environnement livré.
7. Présenter un petit lot pilote revu, comprenant toutes ses dépendances prouvées.
   Vérifier inspection et empreintes, confirmer explicitement, observer le reçu,
   finaliser la source et contrôler mêmes PK, historique intact, bonne version,
   archives et métriques. Après timeout, observer avant toute nouvelle tentative.
8. Augmenter le lot progressivement avec seuils d'arrêt sur conflit, indisponibilité,
   version inattendue, variation d'activité ou doublon. N'activer la sélection
   durcie qu'après couverture et revue des exceptions ; aligner SQL, Next, Python
   et duels. Les deux flashcards sans chapitre restent exclues des lots concernés.
9. Au retour arrière, suspendre les nouveaux imports et démarrages ; laisser finir
   les activités épinglées et conserver reçus, snapshots et journaux. Avant le premier
   import, le précédent code peut reprendre les lignes historiques intactes.
   Après import, ne pas simplement relancer l'ancienne application sur des en-têtes
   nouveaux et un vieux `content` : restaurer le point cohérent validé dans la
   fenêtre approuvée. Décider du RPO et conserver séparément l'activité postérieure
   pour rapprochement explicite, sans la réattribuer à une version active. Ne jamais
   supprimer un reçu pour forcer un nouvel import.

## Conditions encore nécessaires avant fusion Production

- Revue humaine du lot et validation des manifests séparés ; décision documentée
  sur les exceptions et couverture des adaptations historiques avant déploiement.
- Sauvegarde/restauration Production autorisée et vérification de ses ACL, Auth,
  séquences et contraintes ; comparaison finale du schéma et du trigger observés.
- Installation/qualification du host Production exact et résolution du partage de
  hosts Staging entre Admin 0.1.8 et NovLearn 0.2.1, sans modification implicite d'Admin.
- Configuration des trois processus et du runtime SQL, recette avec vrais JWT et
  navigateur, drainage des anciennes rooms, validation du pilote et du retour arrière.
- Autorisation dédiée du responsable pour toute opération distante. **Aucune fusion
  vers `main` ici : elle peut déclencher le déploiement.** La contribution suit la
  revue vers `develop` ; aucune PR n'a été créée puisque le push est interdit dans
  cette mission.
