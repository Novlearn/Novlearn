# Audits et preuves

Ce dossier contient des constats datés, des reproductions et des preuves de vérification. Ce sont des sources historiques, pas la spécification active du produit. Les suites de code, migrations et workflows actuels priment pour connaître le comportement présent.

## Audits mathématiques

Les deux dossiers détaillés d'octobre 2026 et les copies de tests `.txt` qui les accompagnaient ont été supprimés lors de la consolidation. Le résumé des risques, l'état de la fixture active et les décisions proposées sont dans [`../product/roadmap.md`](../product/roadmap.md). Les tests exécutés par le projet restent dans `frontend/__tests__`, `backend/tests` et `duel-server/src/__tests__`.

## Preuves opérationnelles

- Les rapports de migration/RLS, de rejeu local et d'administration documentent des états et préconditions observés à leurs dates respectives.
- Les rapports Engine de novembre, leurs JSON et captures sont liés à des qualifications et versions précises. Une capture ne prouve pas l'état courant du VPS ou de la base.
- Les fichiers `*.original.sql` conservent des corps antérieurs pour comparaison; les migrations numérotées restent l'historique canonique du dépôt.

Ne jamais exécuter un SQL d'audit ou de proposition sur une base. Pour le statut des brouillons, consulter [`../sql-proposals/README.md`](../sql-proposals/README.md); pour restaurer un environnement, suivre [`../supabase-environments.md`](../supabase-environments.md).
