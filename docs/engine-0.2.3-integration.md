# Moteur d'exercices 0.2.3

Novlearn embarque l'archive officielle
`frontend/vendor/novlearn-exercise-engine-0.2.3.tgz` dans le frontend. Son
SHA-256 est `3068549e521d1f643ced8564e94ad645dbccace22a9ec173c912530af3766028`.
Le fichier checksum de la release et le manifeste versionné fixent la même
empreinte. Les archives 0.2.2 et antérieures restent disponibles pour le rejeu
et le rollback.

La release provient de [v0.2.3](https://github.com/Novlearn/Novlearn-Engine/releases/tag/v0.2.3),
et le déploiement Engine Staging est rapporté réussi par le
[workflow 44165765404](https://github.com/Novlearn/Novlearn-Engine/actions/runs/44165765404).
Le manifeste enregistre la version du package, son empreinte, les exports, les
fichiers et la provenance. Le SHA-256 de l'archive n'est pas le digest de l'image
Docker.

Le frontend et le serveur de duels épinglent tous deux cette empreinte. Les
requêtes vers Engine transportent `x-engine-archive-sha256` et refusent une
réponse dont l'empreinte diffère. Le contrôle local
`cd frontend && npm run verify:engine` compare l'archive, le checksum officiel,
le manifeste, le lockfile et l'identité du serveur de duels.

Cette intégration prépare la prochaine livraison Novlearn. Elle ne vaut pas
déploiement de Novlearn ni réception du parcours élève après ce déploiement.
