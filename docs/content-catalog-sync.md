# Contrat de synchronisation du catalogue NovLearn

Ce contrat décrit les RPC source à raccorder dans NovLearn Admin. Il ne donne aucun accès aux données élèves. Les migrations `20261112100908` à `20261112103445` les installent d’abord sur Staging; Production n’est ni migrée ni activée par cette mission.

L'audit en lecture seule du modèle historique Production et le plan de transition sont dans [catalogue-production-transition.md](catalogue-production-transition.md). La migration de durcissement `20261113101533_catalogue_sync_runtime_rls.sql` a été appliquée à Staging après qualification locale ciblée.

Le [lot de compatibilité Production historique](catalogue-production-delivery.md)
définit les prérequis cible effectivement préparés et répétés sur PostgreSQL local.
Il conserve `content`, les PK et les anciennes tentatives sans version. Cette route
ne rejoue pas la chaîne source et ne donne aucune autorisation de transfert distant.

## Identités et états source

- `exercises.catalog_id` reste l’identité stable des exercices. Une révision publiée reste immuable; une nouvelle modification crée une nouvelle révision.
- `chapters.catalog_id`, `competences.catalog_id` et `flashcards.catalog_id` sont des UUID générés à la création de la migration. Ils ne supposent aucune correspondance entre les anciennes clés locales des bases. Les identifiants historiques restent présents pour les FK, le moteur et les relations conservées.
- Les contenus éditoriaux ont `draft`, `ready`, `published` et `archived`. L’archivage conserve les lignes et leurs références. Les suppressions de chapitres, compétences et flashcards sont refusées.
- Une modification de contenu `ready` ou `published` revient à `draft`. Les opérations en cours ou incertaines verrouillent leur contenu source et ses dépendances jusqu’à leur réconciliation.
- La migration convertit les anciens `approved` en `ready` en conservant leur empreinte d’approbation. `in_review` revient à `draft`. Aucun reçu Engine n’est requis par les nouvelles transitions.

## RPC de contenu

Toutes les RPC `public.admin_*` ci-dessous exigent une session authentifiée dont le profil a `role='admin'`. Elles sont accordées à `authenticated`, pas à `anon` ou `service_role`.

| RPC | Paramètres | Résultat |
| --- | --- | --- |
| `admin_set_exercise_version_ready(uuid, text)` | version, empreinte attendue | `{id,status,fingerprint}` |
| `admin_set_catalog_item_ready(text, uuid, text)` | type (`chapter`, `competence`, `flashcard`), `catalog_id`, empreinte attendue | `{kind,catalogId,status,fingerprint}` |
| `admin_get_catalog_item_readiness(text, uuid)` | type et `catalog_id` | statut actuel, projection, empreinte et dépendances à présenter avant validation |
| `admin_export_catalogue_sync_item(text, uuid, text)` | type, `catalog_id`, empreinte attendue | projection pédagogique, action (`upsert` ou `archive`), dépendances stables |
| `admin_archive_catalog_item(text, uuid, text, boolean)` | type (chapitre, compétence ou flashcard), identité, empreinte de la ligne, archiver/restaurer | `{kind,catalogId,archived,fingerprint}` |
| `admin_list_catalogue_sync_ready(text, integer)` | curseur opaque initialement `''`, limite 1–100 | `{items,limit,next}` |
| `admin_prepare_catalogue_sync_operation(uuid,text,uuid,text,text,jsonb)` | batch, type, identité, empreinte, clé cible, inspection cible | opération du journal existant à l’état `planned` |

La liste est triée par `kind:catalog_id[:revision]`; transmettre `next` comme curseur suivant. Elle retourne les contenus `ready` non archivés et les archives, sans données de compte. Pour un exercice, la liste choisit la même dernière révision `ready` que l’exporteur. L’export recalcule l’empreinte sous verrou et échoue si elle a changé (`40001`). Une dépendance absente, ambiguë ou archivée bloque l’export (`23503`). Une dépendance `draft` est exportée uniquement comme référence stable : la cible doit déjà posséder une référence compatible, et le brouillon lui-même n’est jamais transféré. Les dépendances retournent `catalogId` plus `sourceId` ou `sourceRef` quand l’ancienne relation repose sur une clé locale ou un texte. Admin doit rapprocher ces clés locales par `catalogId`, jamais par égalité de nom entre environnements.

Les empreintes des lignes éditoriales sont SHA-256 de la projection JSONB normalisée par PostgreSQL. Celles des exercices utilisent l’empreinte canonique existante d’une révision (`approval_fingerprint_sha256`); l’epoch Engine n’est pas un critère de validation. Le client renvoie l’empreinte lue à la RPC « À publier » ou d’export; aucune confiance n’est accordée à une empreinte calculée uniquement dans le navigateur. La migration corrective `20261112205334_catalogue_export_chapter_row_fix.sql` conserve cette projection et ses permissions; elle utilise `chapter_row.admin_archived_at` pour déterminer l’action du chapitre.

Erreurs principales : `42501` acteur non autorisé; `22023` paramètres ou contenu non valides; `P0002` identité absente; `23503` référence invalide ou non prête, y compris un renommage de chapitre dont les références actives ne sont pas toutes incluses dans le lot; `40001` empreinte ou état concurrent périmé.

## Journal, lot et reprise

La synchronisation ajoute les colonnes `catalog_kind` et `catalog_id` au journal `novlearn_admin_private.publication_operations` existant (`mode='sync'`). Elle n’ajoute pas un second journal. Un lot a un UUID, une seule clé cible et 1 à 100 opérations uniques. L’opération conserve le payload, l’inspection, l’acteur, le digest du plan, l’expiration de 15 minutes et ses événements d’état.

1. Admin lit la liste, inspecte l’environnement cible et prépare une opération par changement avec `admin_prepare_catalogue_sync_operation`. Il inclut dans le lot les dépendances `ready` qui doivent être transférées; les références déjà présentes ne sont réutilisables que si l’inspection prouve leur compatibilité et leur identité stable.
2. Le service Admin calcule le digest de lot sur les couples triés `id,planDigest`, puis appelle `novlearn_admin_private.claim_catalogue_sync_batch(actor,batchId,batchDigest)` avec son rôle serveur `novlearn_publication_journal_executor`. La fonction revalide acteur, expiration, état et chaque projection source avant de passer toutes les opérations à `executing` dans une transaction.
3. Admin envoie tout le lot à une seule transaction côté cible, identifiée par `batchId`. L’import cible doit refuser les conflits de révision/identité, valider les dépendances, appliquer les archives sans effacer, et enregistrer atomiquement une empreinte d’idempotence du lot. Une répétition du même `batchId` et du même payload renvoie le même reçu; un payload différent est refusé.
4. Après réponse perdue, Admin interroge l’état cible par `batchId` avant toute répétition. Il ne marque jamais un transfert incertain comme échoué sur la seule base d’un timeout.
5. Admin appelle `novlearn_admin_private.record_catalogue_sync_batch(actor,batchId,batchDigest,expectedState,state,receipt,error)` avec le même rôle serveur. `state` vaut `uncertain`, `committed` ou `failed`; un échec ne peut être enregistré que si le non-commit est vérifié. Pour `committed`, `receipt` contient exactement `{batchId,stateToken,items}`; chaque item contient exactement `{kind,catalogId,fingerprint,targetId,result}`, avec `result` parmi `applied`, `unchanged`, `archived`. La fonction vérifie que chaque opération apparaît une seule fois et que son empreinte correspond.
6. Une confirmation `committed` met à jour le journal et, dans la même transaction, finalise les états source et écrit `sync_confirmed` dans les journaux pédagogiques existants. Une réponse perdue de cette RPC est réconciliable par lecture des opérations du journal; son rejeu avec le même reçu est idempotent.

Le rôle serveur ne reçoit aucun droit SQL sur les tables de profil, tentatives, duels, progression, notes, statistiques ou feedback. Ses seules fonctions d’écriture supplémentaires sont les deux transitions privées de journal. Les tables pédagogiques restent sans droit de suppression pour ce rôle.

## Sélection des lecteurs et reprise Production

Sur Staging, l’application sélectionne la dernière révision enregistrée, y compris les brouillons et archives; les sessions déjà ouvertes conservent leur définition et leur version. Les tentatives et instances de duel acceptent la version Staging effectivement utilisée. Un nouveau duel réserve ses couples exercice/version avant de tirer une manche; une réservation prend un verrou de ligne qui sérialise l’archivage concurrent.

Le code du lecteur Production est préparé pour exiger un pointeur `active_version_id`, une révision `published` et un exercice non archivé lorsque `PRODUCTION_CATALOG_SYNC_ENFORCED=true`. Cette option est serveur uniquement et reste inactive. La migration n’a pas été appliquée à Production. Le catalogue Production sans `catalog_id` nécessite un audit des correspondances et une reprise contrôlée avant toute activation; aucun rapprochement par nom ni bascule implicite ne doit être utilisé. Les sessions ouvertes, tentatives, duels et replays historiques restent référencés par leurs clés et snapshots existants.

## Capacité cible SQL

La migration `20261112123000_catalogue_sync_target.sql` ajoute sur une base NovLearn cible les fonctions privées `novlearn_admin_private.catalogue_sync_target_contract()`, `inspect_catalogue_sync_item(text,uuid)`, `apply_catalogue_sync_batch(uuid,text,jsonb)` et `observe_catalogue_sync_batch(uuid,text)`. Le marqueur attendu est `atomic-catalogue-target-v1`. `apply` prend un tableau borné d’objets `{payload,inspection}`, valide les empreintes d’état produites par `inspect`, applique les dépendances par identité `catalog_id` dans une transaction appelante et inscrit le reçu dans `catalogue_sync_target_receipts` dans cette même transaction. `observe` retourne `not_applied` si le lot n’existe pas, le reçu exact si l’identifiant et le digest correspondent, et refuse le même lot avec un autre digest.

L’import conserve les versions d’exercices publiées immuables, reconstruit leur en-tête depuis la définition de la révision exportée, remappe chapitre et compétences par leurs identités stables, et ne copie aucune donnée utilisateur. Les archives conservent les lignes et relations. Une archive sans ligne cible retourne `result='unchanged'` avec `targetId=catalogId`, identité déjà fournie par la source; elle ne crée pas de ligne.

Un renommage de chapitre ne cascade plus silencieusement vers `exercises.chapter` et `flashcards.chapter`. Avant toute écriture, `apply_catalogue_sync_batch` vérifie que chaque exercice actif référençant l’ancien nom est explicitement présent dans le lot avec une révision plus récente, et que chaque flashcard active concernée y figure en `upsert`. La nouvelle définition d’exercice est reconstruite avec le nom cible; les versions publiées antérieures restent inchangées. Si un élément manque, la fonction refuse le lot avec `23503`; le chapitre, les exercices, les flashcards et le reçu restent inchangés. Lorsque le renommage est accepté, le reçu inclut les éléments explicitement mis à jour. Les lignes archivées ne sont pas réécrites.

**Conséquence pour Novlearn-Admin (aucun fichier Admin modifié ici)** : le planificateur de lot et son aperçu doivent soit inclure toutes ces références actives — avec une nouvelle révision d’exercice — et les afficher comme éléments du lot, soit présenter le refus `23503` comme un renommage bloqué. Le résumé doit être construit à partir de tous les éléments du reçu. Dans Novlearn-Admin, les zones concernées sont la préparation/sélection des opérations de synchronisation, l’aperçu des dépendances et le rendu du reçu ou de l’erreur. Le test d’intégration requis doit vérifier qu’un renommage sans dépendants sélectionnés est présenté comme refusé sans confirmer le lot, et qu’un lot coordonné contient et récapitule chapitre, exercice nouvelle révision et flashcard.

Les droits directs sur les tables sont accordés à `novlearn_catalogue_sync_writer`, rôle sans connexion propriétaire des seules fonctions à privilèges bornés. La migration cible remplace la politique historique `Flashcards admin write`, qui lisait `profiles` directement, par le contrôle équivalent via `public.is_novlearn_admin()` : la politique reste réservée aux administrateurs authentifiés, tandis que la politique du rôle interne autorise uniquement les lignes à identité catalogue. Aucun accès aux profils n’est accordé à ce rôle. La migration corrective `20261112123200_catalogue_sync_flashcard_policy_fix.sql` répare aussi une cible où la migration initiale a déjà été installée. `novlearn_publication_executor` ne reçoit que l’exécution des fonctions de capacité cible et de préinspection; il n’obtient aucun droit de table ni de suppression.

## Limite de qualification

Le projet Supabase Staging ne permet pas de créer une branche isolée avec son offre actuelle. La migration cible `20261112123000_catalogue_sync_target.sql` et son correctif `20261112123200_catalogue_sync_flashcard_policy_fix.sql` sont donc appliqués uniquement aux bases PostgreSQL locales isolées; le marqueur et l'importateur cible restent absents de Staging et Production. La migration source de correction `20261112205334_catalogue_export_chapter_row_fix.sql` a été appliquée à Staging après qualification locale. Le durcissement RLS `20261113101533_catalogue_sync_runtime_rls.sql` a été appliqué à Staging : `runtime` n'a aucune politique publique et les lecteurs `SECURITY DEFINER` restent inchangés. Les autres migrations source `20261112121904` à `20261112122207` restent installées sur Staging, utilisé uniquement comme source.

Le SQL source n’accepte `uncertain → failed` qu’avec `p_error='not_applied'`, valeur réservée à la preuve d’une observation négative fiable de la cible sous verrou. Le service Admin conserve encore une garde locale qui empêche cette transition; il devra la retirer avant de pouvoir clôturer ainsi un lot incertain. Aucun fichier du dépôt Admin n’est modifié par cette mission.

Le contrat cible est qualifié par `supabase/tests/run_catalogue_sync_target_pglite.mjs` et `supabase/tests/catalogue_sync_target_qualification.sql`. La suite couvre le réimport d’une même révision dans un nouveau lot, deux lots concurrents visant la même identité et inspection, le conflit de contenu pour une révision existante, le refus d’une révision ancienne, les privilèges de lecture sans `SELECT FOR UPDATE`, le renommage coordonné ou refusé d’un chapitre, l’immutabilité des versions, les archives et le rollback atomique sans suppression. Elle couvre aussi l’ancienne politique de flashcards, le reçu durable et son rejeu, le refus d’un digest différent, les dépendances absentes, la reconstruction d’en-tête depuis la révision choisie et l’archive absente sans création de ligne. PGlite exécute les appels concurrents sur une connexion unique; la qualification de concurrence PostgreSQL à sessions distinctes reste à exécuter si une base locale jetable devient disponible. Pour la qualification précédente, le même scénario a été exécuté sur PostgreSQL 17.11 isolé avec les migrations canoniques, contraintes, triggers et politique historique réelle. `supabase/tests/catalogue_sync_source_export_qualification.sql` reproduit `42P01` avant la migration corrective, puis contrôle les exports prêt et archivé, le refus non-admin et l’empreinte périmée après correction. Staging a ensuite exporté un chapitre prêt et un chapitre archivé dans une transaction annulée; aucune ligne temporaire ne subsiste. Ces exécutions ne constituent pas une installation de capacité cible sur un projet Supabase géré; le marqueur reste absent de Staging et Production.

## Catalogue jouable en Staging

NovLearn ouvre la révision la plus récente parmi les révisions approuvées
(`ready`) ou publiées (`published`) d’un exercice. Les nouvelles sélections
excluent les brouillons et exercices archivés. Les duels conservent leurs
contraintes de format et épinglent la version choisie dans la réservation.
Les sessions déjà ouvertes peuvent reprendre leur instantané par identifiant.

La migration `20261125195000_staging_approved_exercise_readers.sql` aligne la
visibilité des métadonnées par le navigateur sur ces règles en Staging. La
lecture des définitions et des réponses reste réservée aux serveurs autorisés.
Côté Production, le lecteur canonique continue d’exiger une révision publiée.
La livraison d’une version approuvée passe par la synchronisation du catalogue.
