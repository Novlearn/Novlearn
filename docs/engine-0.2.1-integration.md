# Engine 0.2.1 — livraison Novlearn staging

L'archive officielle est conservée sans recompression dans
`frontend/vendor/novlearn-exercise-engine-0.2.1.tgz` : SHA-256
`6d1d52f38297d6f91be0eaa4aea57eb63f61973eae4cc83d86fd0aa6651dd85a`.
Son manifeste contient les 189 empreintes de fichiers, exports, dépendances,
SRI SHA-512 et références de release/déploiement. Les archives et preuves
antérieures restent disponibles pour le rejeu historique.

Node **24.19.0**, npm **11.17.0**. Exécuter dans frontend : `npm ci`,
`npm run verify:engine`, `npm test`, `npx tsc --noEmit`, `npm run build`.
Dans duel-server : `npm ci`, `npm test`, `npm run build`.
La CI `Verify Engine integration` couvre les pushes de la branche
`codex/integration-engine-staging` et les PR. La qualification SSH supplémentaire
s'exécute uniquement sur les pushes de cette branche, avec l'environnement
GitHub **staging**. Elle installe le runtime Node dans le préfixe staging dédié
et corrige la route Apache `/api/exercises` dans le seul vhost TLS staging,
avec sauvegarde, `apache2ctl configtest` et rechargement Apache. Elle ne déploie
aucun service applicatif ni Engine.

## Configuration et preuve VPS

Next et Colyseus doivent hériter de `APP_ENV=staging`,
`NODE_ENV=production`, `NOVLEARN_ENGINE_ENABLED=true`,
`ENGINE_URL=http://127.0.0.1:3151/run` et du secret serveur `ENGINE_TOKEN`.
Les secrets GitHub `ENGINE_URL` et `ENGINE_TOKEN`, et la variable GitHub
`NOVLEARN_ENGINE_ENABLED`, appartiennent à l'environnement **staging**.
Le token doit être celui du host déjà présent, jamais une valeur publique.
Ne transmettre aucune valeur de secret dans un ticket ou une conversation.

Le déploiement reste déclenché par un push sur **develop**. Il utilise `npm ci`
et vérifie l'archive avant build. Son lanceur démarre les enfants avec les valeurs
du fichier privé staging, ce qui permet de vérifier leur environnement réel
dans `/proc/<pid>/environ` sans l'afficher. Le contrôle après déploiement exige
les bons PID, commandes, répertoires, URL, flag, environnement et projets.
Il appelle `/healthz` puis `/run` avec l'empreinte exacte et vérifie celle de la
réponse. Un calcul `parseMathInput` synthétique ne crée aucune donnée métier.
Le SDK livré à Next et la fonction `engineRun` compilée des duels sont aussi
appelés avec les valeurs héritées par les processus.

Le workflow ne remplace jamais le fichier Apache partagé. Il ajoute ou remet en
ordre uniquement `ProxyPass /api/exercises` et `ProxyPassReverse` dans le bloc
`staging.novlearn.fr`, avant le proxy générique `/api`, puis valide toute la
configuration avec `apache2ctl configtest` avant de recharger Apache. En cas
d'échec, il restaure la configuration précédente. Le vhost production n'est pas
modifié. Le chemin public `/run` pour Admin reste hors de cette livraison ; aucun
déploiement ni reconstruction Engine n'est requis.

## Données et limites de réception

La lecture staging du 4 novembre constate les tables de sessions/duels et la RPC
de transition, **111 versions publiées**, **zéro session active**. Une rotation
SQL n'est pas nécessaire pour la connexion Novlearn au host 0.2.1 : l'identité
des nouvelles sessions est fournie par le serveur applicatif. Aucune migration
ni modification des anciens reçus n'est exécutée par cette livraison.

Le registre privé de publication Admin est encore désactivé sur l'archive 0.1.8.
Sa rotation vers 0.2.1 et la qualification Admin nécessitent une proposition SQL
avec les préconditions effectivement observées ; la migration historique 0.2.0
n'est ni réécrite ni appliquée automatiquement. Cette tâche ne configure pas Admin.

Une réponse HTTP de l'application et un calcul serveur ne constituent pas un
parcours navigateur connecté, un DS ou un duel à deux joueurs. Le journal indique
séparément les contrôles réellement exécutés et les blocages.
