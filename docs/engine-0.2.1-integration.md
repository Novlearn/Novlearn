# Moteur d'exercices 0.2.1

Le frontend utilise l'archive locale `frontend/vendor/novlearn-exercise-engine-0.2.1.tgz`, déclarée dans `frontend/package.json`. Les anciennes archives et leurs manifestes sont conservés pour la compatibilité et la vérification de versions déjà livrées.

## Vérification

Depuis `frontend/`, installer les dépendances avec `npm ci`, puis lancer `npm run verify:engine`, `npm test`, `npx tsc --noEmit` et `npm run build`. La CI exécute ces contrôles sur les PR et les pushes vers `develop` et `main` (`.github/workflows/ci.yml`).

## Déploiement

Les pushes directs vers `develop` déclenchent le déploiement staging; `main` déclenche la production via `.github/workflows/deploy.yml`. L'activation du moteur en staging est désactivée par défaut. N'activer `NOVLEARN_ENGINE_ENABLED` qu'après qualification du host, avec les paramètres serveur configurés dans l'environnement GitHub **staging**. Les valeurs de secrets se règlent dans GitHub et ne doivent pas être copiées dans ce document.

Le workflow de déploiement réalise des contrôles de processus et de santé définis dans le YAML. Il ne remplace pas une vérification complète des parcours navigateur, des duels ou des données métier.
