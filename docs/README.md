# Documentation Novlearn

## Produit

- [PRD](product/prd.md) — public, objectifs, périmètre et critères à valider
- [Parcours utilisateurs](product/user-flows.md) — parcours confirmés dans le code et limites connues
- [Roadmap candidate](product/roadmap.md) — décisions ouvertes, sans dates ni engagement

## Développer et exploiter

- [README racine](../README.md) — démarrage, configuration, diagnostic et restauration
- [Tests](../README-TESTS.md)
- [Environnements Supabase](supabase-environments.md)
- [Synchronisation du catalogue](catalog-sync.md)
- [Notifications](NOTIFICATIONS_SETUP.md)
- [Moteur d'exercices 0.2.1](engine-0.2.1-integration.md)

Les points d'entrée automatisés sont déclarés dans `package.json`, `frontend/package.json` et `.github/workflows/`. Plusieurs autres scripts servent aux opérations manuelles de sauvegarde/rejeu, à la qualification staging ou aux diagnostics; l'absence d'un appel depuis le code ne suffit pas à établir qu'ils sont inutiles. `npm run correction:catalog:export` lit le catalogue Supabase configuré par `backend/.env` et écrit un corpus privé sous `.local/exercise-correction/`; ces données ne doivent pas être publiées. Les commandes `verify` et `replay` utilisent le corpus local.

## Historique utile

- [Intégration moteur 0.2.0](engine-0.2.0-integration.md) — historique de version
- [Analyse de sécurité PE69B](PE69B-rapport_cyber.md) — scan daté du 17 mars 2026; vérifier l'état actuel avant d'agir sur ses constats
- Les migrations versionnées de `supabase/migrations/` sont la source de vérité du schéma. Les anciens audits et propositions SQL ont été retirés.
