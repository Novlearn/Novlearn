# Catalogue Staging et correction commune

Le 2 novembre 2026, les **111 exercices historiques** de `novlearn-staging`
ont été convertis et activés, avec les mêmes identifiants. Les cinq pilotes et
l'ancien exercice archivé restent inactifs. La Production n'a pas été modifiée.

L'entraînement et les DS utilisent la route Next.js existante `/api/exercises`.
Le serveur Colyseus utilise le même hôte Engine privé et la même opération
`gradeAnswer`. FastAPI conserve la recommandation et l'application des résultats
DS ; il ne réévalue pas les mathématiques. L'Admin et Novlearn utilisent les mêmes
octets d'Engine 0.1.4. Aucune nouvelle route ou fonction utilisateur n'a été ajoutée.

Les corrections portent notamment sur les domaines de définition des suites,
les hypothèses des QCM, les signes, les bornes d'intervalles, les racines réelles
des courbes et les références aux compétences. Les formules restent prises en
charge par CortexJS dans Engine. Le navigateur adapte seulement la présentation
et l'échantillonnage des courbes ; il n'attribue pas le verdict des exercices Engine.

Chaque ancien contenu est conservé dans la provenance privée de sa version et
dans une sauvegarde locale ignorée par Git. `exercises.content` est désormais
vide pour tous les parents : les anciennes réponses ne restent pas dans cette
source publique. Une réponse attendue et une explication peuvent être révélées
quand la question est terminée. L'accès éditorial Admin reste distinct.

L'import technique est identifié comme un transfert, sans inventer une
approbation humaine ou un reçu signé. Son admission vérifie le manifeste privé,
les empreintes, le parent historique inchangé, la version initiale et le runtime
Staging désactivé pour la publication. Il ne crée aucun droit ou membre de rôle.
Les versions publiées restent immuables ; l'import est à usage unique. Les
écritures clientes des tentatives et des points sont bloquées sur Staging ; les
serveurs conservent leurs écritures. Ces migrations sont un déploiement Staging,
à revoir avant toute migration de la Production.

La [qualification](2026-11-engine-catalogue-qualification.json) couvre cinq seeds
par exercice, soit 555 générations, 111 relectures déterministes, 770 bonnes
réponses, 770 mauvaises et 770 saisies vides. Elle s'ajoute à la relecture des
énoncés et à la réception navigateur entraînement/DS. Elle ne constitue pas une
preuve exhaustive de toutes les variantes possibles.

La [réception](2026-11-engine-catalogue-activation.json) distingue les contrôles
automatisés, la vraie correction dans une salle de duel simulée et une partie
entre deux utilisateurs humains, qui n'a pas été exécutée. Le DS de réception
du compte de test reste disponible sur Staging. Les contrôles locaux SQL ont
utilisé une nouvelle base PostgreSQL 17 sans réseau, avec les instantanés Staging
de la fonction historique de complétion et du schéma des parents ; il ne s'agit
pas d'un rejeu sans adaptation de toute l'histoire SQL.

L'archive est identifiée par son SHA256 dans le manifeste du vendor. Le
[patch source](../../frontend/vendor/engine-source-0.1.4.patch) part du commit
Engine `baa48c4` et conserve le repère `65f6473`, antérieur au formatage suivant.
Les archives candidates 0.1.2/0.1.3 sont des états historiques, sans sélection
implicite. Les anciens parcours restent dans le code pour la Production non
migrée ; leur repli est refusé lorsque le mode Engine Staging est activé.

Le mode dev isolé se lance depuis la racine avec `node scripts/run-engine-staging.mjs`.
Il fournit Novlearn sur `http://127.0.0.1:3000`, FastAPI sur 8011 et les duels sur
2568, sans modifier les fichiers d'environnement existants. Les sauvegardes,
définitions et plans d'import contenant des réponses restent dans `.local/engine-staging`.
