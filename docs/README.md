# Documentation Novlearn

## Produit

- [PRD](product/prd.md) — public, objectifs, périmètre et critères à valider
- [Parcours utilisateurs](product/user-flows.md) — parcours confirmés dans le code et limites connues
- [Roadmap candidate](product/roadmap.md) — décisions ouvertes, sans dates ni engagement

## Développer et exploiter

- [README racine](../README.md) — démarrage, configuration, diagnostic et restauration
- [Tests](../README-TESTS.md)
- [Environnements Supabase](supabase-environments.md)
- [Notifications](NOTIFICATIONS_SETUP.md)
- [Moteur d'exercices 0.2.1](engine-0.2.1-integration.md)

Les commandes et workflows déclarent les scripts automatisés. Les autres scripts sont lancés à la demande pour la sauvegarde/restauration locale, les contrôles d'environnement ou la qualification du moteur. Les commandes `correction:catalog:*` exportent, vérifient ou rejouent un corpus local privé sous `.local/exercise-correction/`; ce corpus ne doit pas être publié.

## Historique utile

- [Intégration moteur 0.2.0](engine-0.2.0-integration.md) — historique de version
- [Analyse de sécurité PE69B](PE69B-rapport_cyber.md) — scan daté du 17 mars 2026; vérifier l'état actuel avant d'agir sur ses constats
- Les migrations versionnées de `supabase/migrations/` sont la source de vérité du schéma. Les anciens audits et propositions SQL ont été retirés.
