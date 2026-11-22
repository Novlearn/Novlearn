# Audit et plan de transition du catalogue Production

État observé le 13 novembre 2026. L'audit Production a utilisé uniquement les catalogues PostgreSQL, les définitions de schéma, les politiques, les fonctions et des agrégats. Aucun contenu d'exercice, réponse, compte ou autre donnée personnelle n'a été exporté. La Production n'a reçu aucune écriture.

**Complément de préparation :** le [lot concret et sa recette](catalogue-production-delivery.md)
contiennent désormais le code, la route SQL additive, les registres candidats,
les résultats PostgreSQL/pgTAP/applicatifs et les conditions restantes. Le constat
initial « Docker arrêté » ci-dessous décrit l'audit antérieur ; les répétitions
locales ont depuis été réalisées. Aucune activation hébergée supplémentaire.

## Durcissement Staging

Sur `novlearn_catalog_sync.runtime`, Staging avait RLS désactivé et `FORCE ROW LEVEL SECURITY` désactivé. Le schéma et la table appartiennent à `postgres`. `anon`, `authenticated`, `service_role` et `novlearn_publication_journal_executor` n'ont ni `USAGE` sur le schéma, ni droit direct de lecture ou d'écriture sur la table. Aucun changement de droits n'est requis.

`public.novlearn_catalog_is_staging()` est une fonction `SECURITY DEFINER` appartenant à `postgres`, avec `search_path` vide. Elle ne retourne qu'un booléen. Quand un JWT porte un émetteur, la fonction compare cet émetteur à l'URL Auth exacte de Staging; elle ne lit pas la ligne runtime dans ce cas. Sans émetteur, sa lecture de cette ligne reste légitime. Des fonctions de lecture et de trigger s'appuient aussi directement sur cette configuration et appartiennent à `postgres`. La fonction n'a pas été révoquée et la sélection d'environnement n'a pas été modifiée.

La liste de schémas exposés par PostgREST n'est pas retournée par l'outil de lecture PostgreSQL; son paramètre de session `pgrst.db_schemas` est absent. Le contrôle d'accès effectif a néanmoins été vérifié : les quatre rôles n'ont pas `USAGE` sur `novlearn_catalog_sync`, ce qui bloque le chemin direct même si le schéma était exposé. Le chemin indirect intentionnel reste le RPC public booléen et les fonctions `SECURITY DEFINER` ci-dessus.

Les fonctions dépendantes observées sont `novlearn_catalog_reader_allows`, `novlearn_catalog_item_reader_allows`, `novlearn_catalog_is_staging`, `require_available_duel_reservation`, `require_published_attempt_version` et `require_published_duel_exercise_version`. La migration ne change ni leur propriétaire, ni leurs ACL, ni leur logique.

La migration `20261113101533_catalogue_sync_runtime_rls.sql` active uniquement RLS sur la table interne, sans politique. Le test pgTAP `supabase/tests/catalogue_sync_runtime_rls.sql` couvre les ACL, le propriétaire, la fonction à privilèges et les émetteurs Staging/Production. Un smoke test PGlite exécute la migration réelle avec un runtime synthétique et vérifie lectures/écritures directes refusées ainsi que les appels de lecture bornés pour `anon`, `authenticated` et `service_role`; la qualification PGlite locale de la capacité cible passe aussi. Le service Docker local n'était pas démarré, donc la suite complète sur les bases PostgreSQL Supabase locales, notamment la reprise source, n'a pas pu être rejouée.

Après ces qualifications locales et la validation fonctionnelle fournie dans le rapport précédent, cette seule migration de durcissement a été appliquée à Staging. Vérification hébergée : RLS activé, `FORCE ROW LEVEL SECURITY` désactivé, aucune politique, propriétaire `postgres`; les quatre rôles non autorisés n'ont toujours aucun droit d'usage du schéma ou de lecture/écriture directe de la table. L'exécution de `novlearn_catalog_is_staging()` est toujours accordée aux lecteurs prévus et la fonction reste `SECURITY DEFINER` détenue par `postgres`. Les émetteurs JWT Staging et Production ont renvoyé respectivement `true` et `false`. La reprise de synchronisation complète n'a pas été rejouée après ce changement RLS; son absence de régression est appuyée par le périmètre minimal et les qualifications locales préexistantes, pas par un nouveau test d'intégration source dans cette session.

## Modèle Production observé

Le projet `novlearn-prod` ne contient pas `novlearn_catalog_sync` et ne suit pas le modèle catalogue de Staging.

| Table | Structure historique et agrégats |
| --- | --- |
| `exercises` | 111 lignes; PK `id bigint`; contenu directement dans `content jsonb`; `chapter text`, `competences text[]`; aucune colonne `catalog_id` ou `active_version_id`; aucune table de versions. Les 111 valeurs de chapitre correspondent à un chapitre par nom/alias, sans que cela constitue une preuve d'identité catalogue. |
| `chapters` | 8 lignes; PK UUID locale; `name` unique, `aliases`, `order_index`, `emoji`; pas d'identité catalogue. |
| `competences` | 28 lignes; PK `id text`; `chapter_id uuid` vers `chapters`, avec suppression en cascade; `name`, `max_points`; pas d'identité catalogue. |
| `flashcards` | 27 lignes; PK UUID locale; `chapter text`, `question`, `answer`; pas de FK vers `chapters`, ni identité catalogue. 25 chapitres de flashcards correspondent par nom/alias, 2 ne correspondent pas. |

Les 179 références de compétence contenues dans `exercises.competences` sont des textes sans FK. Aucune ne correspond directement à `competences.id`; 152 correspondent à un nom de compétence, et 27 ne correspondent ni à un identifiant ni à un nom. Les rapprochements de noms servent uniquement à quantifier le travail manuel et ne sont pas des associations à appliquer automatiquement.

Les relations d'activité sont importantes pour la migration :

- `exercise_attempts` contient 1 907 lignes. Son FK vers `exercises.id` utilise `ON DELETE SET NULL`; deux tentatives ont déjà un `exercise_id` nul. Il n'y a pas de référence de version dans cette table.
- `duels` contient 38 lignes. Son `exercise_id` référence `exercises.id` sans suppression en cascade; 23 duels ont une référence d'exercice et 23 ont aussi `exercise_data` conservé comme instantané JSON.
- `duel_attempts` contient 63 lignes et référence ses duels. Ces clés de duel et de tentative ne doivent pas être réécrites.
- `user_competence_scores` a 661 lignes, sans FK de compétence; 658 références correspondent à une compétence actuelle, 3 ne correspondent pas. `ds_competence_scores` a 42 références, avec FK vers `competences.id` et `ds.id` en cascade. `user_progress` est vide; sa colonne `chapter` est textuelle sans FK. `ds.competence_ids` est également un tableau textuel.

La Production conserve des politiques de lecture publiques pour exercices, chapitres, compétences et flashcards. `public.get_random_exercise(text,text)` est un lecteur `SECURITY DEFINER` appartenant à `postgres`; `get_chapters_with_count(uuid)` a le même type de privilège avec contrôle de l'utilisateur. Les triggers sur les tentatives mettent à jour les statistiques existantes. Les politiques et lecteurs Production ne doivent pas être remplacés avant que leurs équivalents et leur comportement aient été qualifiés dans la transition future.

Les schémas Admin historiques comprennent seulement deux vues `accounts` (`novlearn_admin_api` et `novlearn_admin_read`); aucune table du catalogue synchronisé ni fonction de synchronisation n'y a été trouvée. Les vues ont `security_barrier=true` et aucune ACL accordée directement à `anon`, `authenticated` ou `service_role`. Les politiques de lecture spécifiques aux rôles Admin existants ne valent pas autorisation de synchroniser le catalogue.

## Plan de transition à examiner avant toute exécution

1. **Geler le périmètre et les lecteurs.** Le responsable confirme les lecteurs, les historiques à conserver, les contenus Production qui ne sont pas présents sur Staging et la politique de traitement des 27 références de compétence non rapprochées, des 2 flashcards non rapprochées, des 3 scores sans compétence et des 2 tentatives sans exercice. Ne pas activer le drapeau de sélection Production.
2. **Créer une sauvegarde restaurable avant changement.** Prendre une sauvegarde cohérente de la base et des composants Supabase nécessaires, la conserver dans un espace chiffré à accès restreint, noter l'heure, la version PostgreSQL, les migrations et les empreintes des artefacts. Restaurer cette sauvegarde dans un environnement isolé autorisé, puis vérifier les tables, contraintes, séquences, volumes et contrôles de cohérence. Un échec de restauration bloque toute intervention.
3. **Répéter sur PostgreSQL local 17 avec un schéma historique.** Construire un fixture synthétique à partir des colonnes, contraintes, politiques, lecteurs et triggers observés ici; générer des clés et des contenus fictifs. N'inclure aucune ligne issue de Production. Rejouer sauvegarde/restauration, migrations additives, import/idempotence, activité conservée, accès lecteurs et retour arrière. Il n'existe pas de troisième projet Supabase; les répétitions restent locales.
4. **Préparer un registre de correspondance approuvé.** Créer un manifeste explicite par type (`exercise`, `chapter`, `competence`, `flashcard`) qui relie la PK Production à un `catalog_id` déjà émis par Staging, avec empreinte du contenu, identité source, décision, justificatif et réviseur. Chaque association ambiguë, manquante ou multiple reste bloquée pour décision humaine. Aucun rapprochement automatique par nom, aucune régénération massive de contenu et aucune fusion de clés locales.
5. **Préparer une migration de compatibilité additive pour le vieux schéma.** Préserver les PK Production et ses FK; ajouter les identités catalogue validées et les états de publication selon un script contrôlé. La structure de versions attendue par la capacité cible doit être introduite explicitement à partir de `exercises.content`, avec un instantané privé et une version historique SQL 0 distincte de la numérotation source, sans attribuer la version active à une ancienne activité ; voir le lot de livraison pour la procédure retenue. Les nouvelles tables, clés composites, contraintes uniques, index, droits et politiques doivent être établis avant d'installer la capacité cible. Les éléments Production non appariés restent conservés mais non publiables jusqu'à décision.
6. **Conserver l'activité sans réattribution.** Ne pas modifier les PK locales ni les colonnes relationnelles historiques de tentatives, duels, progression, DS et flashcards. Les anciennes tentatives restent sans version (`NULL`/identité historique inconnue); ne jamais leur attribuer la nouvelle révision active. Les deux tentatives déjà sans exercice restent telles quelles. Les instantanés `duels.exercise_data` restent intacts. Les nouvelles activités seulement portent les identités de version du nouveau modèle.
7. **Installer la capacité cible seulement après validation indépendante.** Vérifier la compatibilité exacte de chaque migration avec le schéma Production répété, puis installer les fonctions et reçus cible dans la fenêtre approuvée. Staging reste la source et n'héberge pas l'importateur cible. Aucun import ne démarre pendant cette étape.
8. **Adapter les lecteurs en mode observation, puis activer graduellement.** Comparer les candidats sélectionnés par l'ancien lecteur et le lecteur versionné, contrôler les archives et les identités, puis faire une activation limitée aux contenus explicitement rapprochés. Garder l'ancien chemin disponible pendant la période d'observation. L'activation globale attend l'accord du responsable et les contrôles de cohérence.
9. **Contrôler et préparer le retour arrière.** Avant/après, comparer les nombres par type, les clés et contraintes, les empreintes de contenu et de versions, les références FK, les décomptes d'activité agrégés, les archives, les reçus et les sélections lecteurs. Tester les lecteurs élèves, tentatives, duels et reprise sur identités fictives. Le retour arrière désactive le nouveau lecteur et restaure le schéma/sauvegarde cohérente; il ne supprime ni les reçus ni les contenus historiques. Définir à l'avance les seuils d'arrêt et l'autorité qui déclenche le retour.

## Preuves et limites de l’audit initial

Les métadonnées et agrégats ci-dessus ont été lus dans les projets hébergés Staging et Production le 13 novembre 2026. La structure historique est ainsi observée sur Production sans export de contenu ou de données personnelles. La migration RLS est appliquée à Staging seulement. Le test pgTAP et le test d'intégration complet restaient à rejouer à ce stade ; leurs exécutions locales ultérieures sont consignées dans le lot de livraison. Toute validation Production future devra établir les sauvegardes/restaurations, droits effectifs et comportement des lecteurs sous de vrais JWT Staging/Production.

Ce document est un plan à relire. Il n'autorise aucune migration, importation, activation ou autre écriture sur Production.
