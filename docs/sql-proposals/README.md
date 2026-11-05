# Propositions SQL

Les fichiers de ce dossier sont des brouillons, snapshots ou propositions de correction. Aucun ne fait partie du flux de déploiement. Ils ne remplacent pas les migrations versionnées de `supabase/migrations/`, et leur présence ne prouve pas qu'une opération a été exécutée sur staging ou production.

| Fichier(s) | Nature connue | Précaution |
|---|---|---|
| `20261013-exercise-versioning.proposal.sql.txt` | DDL de versionnement explicitement non exécutable; dépend du schéma, des grants et de l'historique réel. | Réconcilier le schéma et les consommateurs avant toute migration. |
| `20261013-security-hardening.proposal.sql.txt` | Plan de revue sécurité incomplet, pas un script prêt à appliquer. | Établir les rôles, politiques et usages effectifs avant de produire du SQL. |
| `20261101-chapter-count-original.sql`, `20261101-chapter-count.diff` | Définition observée et différence proposée pour `get_chapters_with_count`. | Le diff marque explicitement l'absence d'autorisation pour application distante. |
| `20261101-exclude-unpublished-pilots.sql`, `20261101-exclude-unpublished-pilots-rollback.sql` | Proposition d'exclusion de pilotes et corps historique de comparaison. | Le fichier nommé rollback n'est pas une procédure universelle de restauration; vérifier l'état courant et les dépendances. |
| `20261102-completion-before-engine-guest.sql` | Corps de fonction associé à un changement du traitement des invités. | Vérifier la migration canonique et la définition distante avant réutilisation. |
| `20261102_engine_catalogue_archive*.proposal.sql.txt` | Variantes de proposition pour aligner les reçus de publication Engine. | Comparer la version visée et le registre réellement déployé; ne pas choisir par le nom du fichier seul. |

Les rapports liés expliquent le contexte et les limites. Toute adoption nécessite une revue indépendante, un état de base vérifié, un plan de retour compatible avec cet état et une migration numérotée approuvée. Ne pas exécuter directement ces fichiers sur une base distante.
