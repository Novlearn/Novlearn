# Sécurité Supabase staging — 6 novembre 2026

Projet inspecté et modifié : `novlearn-staging` (`tksvbkvfusrnxulpahky`). Aucune connexion à la base de production, aucun déploiement, aucun changement de workflow ou de VPS.

## Périmètre et résultats

Inventaire des 32 tables publiques, de leurs droits et des 90 politiques initiales ; recensement de 70 fonctions applicatives, de leurs propriétaires, droits EXECUTE et modes SECURITY DEFINER. Inspection des schémas privés et du Storage : aucun bucket ni objet, aucune table publique sans RLS, aucun USAGE des schémas privés accordé aux rôles clients.

Les essais SQL ont confirmé avant correction :
- un élève pouvait insérer une amitié déjà acceptée sans consentement ;
- un élève pouvait créer directement un duel terminé avec un score arbitraire ;
- plusieurs tables accordaient TRUNCATE à anon/authenticated, opération qui ne dépend pas des RLS. Il s'agit d'un droit PostgreSQL dangereux ; aucun accès SQL arbitraire par HTTP n'a été démontré, et aucune table n'a été tronquée.

## Corrections appliquées au staging

- `20261106102110_staging_rls_hardening.sql` : retrait de TRUNCATE, REFERENCES, TRIGGER et MAINTAIN des rôles clients sur toutes les tables publiques ; mutations de l'état autoritaire réservées aux serveurs (duels, amitiés, demandes/codes amis, DS, scores et tentatives). Restrictions RLS supplémentaires sur les anciens chemins encore permissifs. Les rôles clients incluent les administrateurs connectés : ceux-ci passent par les API/RPC prévues.
- Les feedbacks restent accessibles en insertion selon les droits existants, avec statut initial imposé à pending.
- Les helpers `is_guest`, `generate_random_code` et le lecteur `get_random_exercise` deviennent SECURITY INVOKER. Le lecteur obéit aux RLS du catalogue. La génération de code est bornée à 1–64 caractères.
- `get_my_role` reste disponible aux utilisateurs connectés pour les politiques du profil, avec retrait de l'accès anon.
- `20261106103450_bound_public_leaderboard_rpc.sql` : les trois RPC de classement refusent les limites NULL ou hors de 1–100. Leurs champs publics et leurs droits de lecture sont conservés.

Aucune autre colonne ou table n'est supprimée. Les droits des services, lecteurs Admin dédiés et fonctions de publication sont conservés.

## Suppression de exercises.content : préparée, NON appliquée

Le serveur de duels déployé demande encore explicitement cette colonne. La retirer immédiatement casserait sa requête. La PR supprime cette lecture et la dépendance de l'ancien endpoint admin de Novlearn ; les définitions canoniques restent gérées par Admin/Engine.

Après déploiement de ces lecteurs, appliquer `20261106103509_remove_exercises_content_after_deploy.sql` en une transaction :
- arrêt si un content contient autre chose que `{}` ;
- remplacement des fonctions de brouillon, publication et références de taxonomie ;
- mise à jour des deux politiques dépendantes ;
- suppression de la seule colonne `public.exercises.content`, avec RESTRICT.

La fonction de publication conserve son propriétaire restreint. Une habilitation de migration temporaire est retirée avant la fin de la transaction ; les habilitations Supabase préexistantes sont conservées. Les préconditions refusent un état de privilèges inattendu.

## Vérifications

- Tests réels sur le staging sous SET LOCAL ROLE anon, authenticated et service_role, avec JWT simulés au niveau PostgreSQL : falsification de métadonnées admin, lecture d'autres profils et duels, accès aux définitions et sessions privées, modification de rôle/récompenses/scores, visibilité des brouillons, accès invités, accès admin et écriture serveur.
- Transactions de test annulées. Aucun compte de test restant. Les comptes fixtures ne passent pas par une inscription HTTP ; cela ne certifie pas le parcours navigateur ou la validation des signatures JWT.
- 20 tests du serveur de duels et 9 tests frontend/API réussis sur une copie isolée des sources modifiées ; vérifications TypeScript complètes des deux services réussies via superposition des fichiers modifiés sur le dépôt et ses dépendances existantes.
- Compilation des fonctions/politiques préparées pour content vérifiée sur le vrai schéma staging, en transaction annulée. DROP COLUMN lui-même n'a pas été exécuté.
- Contrôle final : 117 exercices, 117 versions, 14 tentatives ; 0 fixtures restantes et 0 droit TRUNCATE client.
- Construction de production et parcours navigateur non exécutés. Consulter la CI de la PR pour les contrôles distants.

Le script `scripts/sql/staging-security-check.sql` doit être lancé avec arrêt au premier échec (`psql -X -v ON_ERROR_STOP=1 -f ...`) sur un environnement de test approprié. Il crée des fixtures à identifiants explicites dans une transaction et les annule. Ne pas le lancer automatiquement en production.

## Alertes et limites restantes

La protection Supabase Auth contre les mots de passe compromis est désactivée : à activer dans les paramètres Auth si le forfait le permet.
[Documentation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Les 9 alertes « RLS enabled, no policy » concernent des tables privées/serveur volontairement interdites aux clients ; aucune policy permissive n'a été ajoutée pour masquer ces alertes.
[Explication](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Les fonctions SECURITY DEFINER restantes incluent les RPC Admin avec contrôle d'administration, les lecteurs de profils publics et les classements publics. Leur présence n'est pas, à elle seule, une faille. L'audit ne démontre pas l'absence de toute faille ; il couvre les accès SQL examinés et les scénarios consignés, sans test exhaustif de toutes les routes HTTP, ni des dépendances ou du VPS.

## Suite et production

1. Relire la PR ciblant develop, puis autoriser sa fusion et son déploiement staging.
2. Vérifier le fonctionnement d'Admin, de l'entraînement et des duels avec le code déployé.
3. Appliquer seulement la migration content restante, puis relancer les contrôles et le parcours applicatif.
4. Pour la production, comparer d'abord le schéma réel, les propriétaires, l'historique et les éventuels anciens exercices non migrés. Promouvoir des migrations revues et compatibles, sans copier la base staging ni rejouer aveuglément tout l'historique.

Les migrations de sécurité déjà appliquées portent exactement les versions de l'historique distant. Les historiques plus anciens du dépôt et du staging diffèrent déjà ; un db push global n'est pas une procédure de promotion validée.
