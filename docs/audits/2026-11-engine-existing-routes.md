# Engine dans les parcours existants — 2 novembre 2026

Branche : `codex/integration-engine-staging`. Cette étape remplace la démonstration
isolée par une intégration dans les parcours existants. Aucun déploiement ni
changement Production. Les modifications antérieures du dépôt et du dépôt Admin
voisin sont conservées. À la fin de la recette, aucun commit ni push n'avait
encore été effectué. L'utilisateur a ensuite demandé la consolidation locale
des seuls changements Engine avant la conversion du catalogue Staging.

## Plan exécuté et portée réelle

1. **Entraînement** : raccordement d'`ExerciseLoader` et d'`ExerciseRenderer`,
   des formulaires numériques/symboliques et du QCM existants. Conservation des
   écrans, boutons, aide, signalements, deux essais pour une question libre et
   un essai pour un QCM. Une première erreur puis une réussite reste une réussite,
   conformément au fonctionnement antérieur.
2. **Autorité serveur et reprise** : génération/correction officielles, instantanés
   privés durables, soumissions comptées conservées en privé, reprise du même
   instantané et enregistrement transactionnel des tentatives, points et rejouage.
3. **DS** : adaptation du chargeur commun et de la route de soumission existante.
   Pour un exercice Engine, le serveur utilise un résultat lié à l'utilisateur,
   au DS et à son instantané ; les booléens, difficultés et compétences déclarés
   par le navigateur ne déterminent pas le résultat. Attribution DS idempotente.
4. **Duels** : adaptation des messages existants, lecture de la version publiée,
   conservation du round officiel en privé et correction par le même host Engine.
   Les réponses visant une ancienne instance et les succès déclarés par le client
   sont refusés pour les exercices Engine. Le scoring attend l'enregistrement.
5. **Positionnement** : constat du retrait des tables par la migration
   `019_remove_chapter_test_tables.sql`, confirmé dans Staging. Aucun nouveau
   positionnement ni table de placement réintroduits. Le chemin historique reste
   en compatibilité ; une demande de positionnement Engine est refusée (410).
6. **Nettoyage** : suppression des routes temporaires `/entrainement/pilotes` et
   `/api/engine/pilots`, de leurs composants et de leur stockage en mémoire.
   Les anciens tests du prototype ont été remplacés par les tests de l'API et
   des composants existants et par une vérification SQL transactionnelle.

Il n'y a aucun nouveau parcours utilisateur. Les opérations internes passent par
`PATCH /api/exercises`, chemin déjà existant ; les contrats d'édition Admin
`POST`/`DELETE` gardent leur autorisation. Le navigateur reçoit la projection
officielle et ses propres résultats. La correction attendue n'est révélée qu'à
la fin de la question, dans l'emplacement de correction déjà présent dans l'UI.
Les reçus JSON de cette réception ne contiennent ni saisies ni attendus.

**Compatibilité à distinguer de la bascule du catalogue :** les exercices
historiques conservent leur format et leur fonctionnement antérieurs. Aucune
conversion automatique du catalogue, recette mathématique devinée, publication
ou activation des cinq pilotes. L'ancien code de génération/correction reste
utilisé par ce catalogue historique ; cette étape ne certifie pas sa correction
mathématique et ne constitue pas une bascule de tous les exercices vers Engine.

## Recette réellement effectuée

Les exercices 122 à 126 ont été chargés depuis leur révision Staging réelle par
la page existante `/exercices?id=…`, en tant qu'Admin. Ce droit de prévisualisation
est limité aux cinq marqueurs pilotes en développement Staging. Il n'admet pas
ces brouillons dans les sélections des élèves.

| Pilote | Vérification dans le navigateur |
| --- | --- |
| 122 / M1-01 | Première réponse fausse, second essai juste ; même instance et résultat après rechargement et redémarrage des services |
| 123 / M1-02 | Saisie neutre sans consommation d'essai, puis réponse correcte |
| 124 / M1-03 | Expression algébrique équivalente acceptée |
| 125 / M1-04 | QCM existant, choix à identifiant stable et verdict serveur |
| 126 / M1-05 | Tableau, deux questions ; la première réponse ne termine pas l'exercice, la seconde le termine |

Les identités de cette nouvelle recette sont dans
[la preuve navigateur](2026-11-engine-existing-browser-proof.json).
La [capture](2026-11-engine-existing-routes.png) montre la page existante avant
soumission, sans publier les réponses de correction.
Les [identités et empreintes des cinq versions](2026-11-engine-pilot-manifest.json)
sont celles de la réception initiale. Les cinq versions restent en brouillon,
sans version active. Les empreintes des trois textes corrigés ensuite en LaTeX
sont consignées dans le [suivi typographique](2026-11-engine-latex-proof.json).
Les prévisualisations n'écrivent ni tentative élève ni point. Un dernier essai
sur le runtime final a rencontré une indisponibilité temporaire, sans consommer
d'essai ; la nouvelle soumission a abouti sur la même instance. La vérification
finale Staging confirme six prévisualisations terminées, zéro tentative pilote
et zéro version pilote active.

La recette initiale du 1er novembre (15 instances / 54 corrections sur l'ancienne
route éphémère) reste une preuve historique distincte, pas une mesure de la
nouvelle UI. La nouvelle API est aussi exercée sur les cinq définitions et les
graines 0, 1 et 42 avec le vrai cœur Engine et un transport/base simulés.

**DS et duels ne sont pas annoncés comme reçus de bout en bout sur Staging.**
Leur code et leurs contrats sont vérifiés par tests et sur copie. Aucun match
réel à deux joueurs ni attribution de points DS depuis une version Engine publiée
n'a été effectué. Les pilotes doivent rester non publiés selon le brief initial.
Le duel conserve son contrat de flash à une seule question libre, sans
calculatrice ; les exercices composés incompatibles sont refusés.

## Données privées, scores et migrations Staging

Cible vérifiée : `novlearn-staging`, `tksvbkvfusrnxulpahky`, distincte de
Production `abwipnppcrghdhwriyjp`.

| Migration appliquée uniquement à Staging | Effet |
| --- | --- |
| `20261102094823_engine_exercise_sessions` | Instantanés et état de résolution privés ; transition avec contrôle de révision ; tentative, rejouage et compétences dans une transaction ; résultat DS appliqué une seule fois |
| `20261102095237_engine_session_lifecycle` | Un seul instantané actif par utilisateur/exercice/contexte ; suppression des instantanés privés lors d'une suppression de compte |
| `20261102101102_engine_guest_attempts` | Garde ciblée du trigger de récompenses : une tentative canonique invitée ne rapporte pas de récompense d'utilisateur inscrit |

La nouvelle table a la RLS activée, sans accès `anon`/`authenticated`. Les nouvelles
fonctions sont `SECURITY INVOKER` et exécutables uniquement par `service_role`.
Une lecture REST anonyme des instantanés et un appel anonyme de transition
renvoient tous deux 401. Les tables de rejouage privées déjà présentes sont
réutilisées pour les tentatives terminées. Les instantanés officiels privés ne
sont pas remis au navigateur et ne sont jamais reconstruits à partir d'une
nouvelle définition.

Le trigger de récompenses a été relu avant modification : MD5 initial
`28f8d602399ed85ab26ec315662f5e33`, après garde invitée
`fd14b5fd5aca28ecf66053d0ce245dbb`. Son
[corps initial](../sql-proposals/20261102-completion-before-engine-guest.sql)
est conservé. Le changement est limité aux invités des exercices canoniques.
Les protections précédentes des tirages et des compteurs ne sont pas modifiées.

Limites explicites : instantanés de résolution valables 24 heures, au plus 32
actifs par utilisateur, requêtes de 16 Kio, un calcul par utilisateur et deux
calculs simultanés au niveau API. Une saisie invalide, indéterminée ou une erreur
ne consomme pas d'essai. Un exercice passé ne crée pas de tentative ni de points.
Les abandons suivis sont finalisés lors d'une nouvelle ouverture après expiration,
ce qui évite de compter à tort un échec lors d'une simple reprise. Leur traitement
est différé ; il ne s'agit pas d'un traitement planifié permanent.

Retour applicatif : arrêter le lanceur et désactiver les drapeaux Engine. Conserver
les données privées et les tables de rejouage ; aucun script ne les supprime.
Les anciennes routes temporaires ne sont pas réintroduites. Ne pas annuler les
gardes de publication tant que les brouillons canoniques existent. Aucun retour
arrière n'a été exécuté à distance.

## Vérifications

- Frontend : **218 tests réussis, 9 TODO** ; 32 tests concernent l'API Engine et
  les formulaires existants. Les autres comprennent des caractérisations de
  défauts historiques, pas une certification de tout l'ancien moteur.
- Backend : **187 tests réussis**, dont session HttpOnly vérifiée par Supabase,
  utilisation du résultat serveur DS et compatibilité du champ de taxonomie
  `aliases` avec l'ancien nom `db_aliases`.
- Duel : **71 tests réussis**, dont refus du succès client forgé, d'une mauvaise
  instance et d'un résultat tardif ; états neutres sans point.
- PostgreSQL en mémoire : propriété, transition atomique, rejouage privé,
  absence de double attribution, prévisualisation et passage sans points,
  idempotence DS, garde invitée sur le véritable corps du trigger et refus
  d'accès du rôle authentifié.
- TypeScript frontend, compilation du duel, lint des modules modifiés,
  intégrité de l'archive et `git diff --check` : vérifiés.

Commandes : `npm test` dans `frontend`, `node scripts/correction-backend-tests.mjs`
depuis la racine, `npm test` et `npm run build` dans `duel-server`,
`node scripts/test-engine-exercise-sessions.mjs` et
`node scripts/verify-engine-staging.mjs` depuis la racine.

## Exécution locale et limites restantes

`cd frontend` puis `npm run dev:engine-staging` lance l'UI sur 127.0.0.1:3000,
FastAPI sur 127.0.0.1:8011, Colyseus sur 127.0.0.1:2568 et le host privé sur
127.0.0.1:3151. Le lanceur vérifie les deux références de clé, utilise uniquement
Staging, désactive le scheduler et l'analytics et évite le backend historique
potentiellement configuré sur Production. Les fichiers `.env` préexistants ont
gardé leurs empreintes initiales. Les credentials Staging sont dans les fichiers
locaux ignorés, jamais dans le dépôt ni dans des variables publiques.

Ce lanceur Staging utilise Turbopack et désactive l'enveloppe Serwist en
développement isolé, après des erreurs de chargement des fragments Webpack dans
le navigateur. Le démarrage normal conserve sa configuration. Les chargements
simultanés de React StrictMode partagent la même requête d'ouverture/reprise ;
une reprise en lecture reste possible pendant un calcul pour le même utilisateur.

Le host Linux officiel reste dans le conteneur borné, sans réseau ; son
[rapport de démarrage](2026-11-engine-existing-host-proof.json) accompagne cette
réception. Les services locaux restent disponibles. `Ctrl+C` sur ce lanceur
arrête uniquement ses processus et son conteneur.

La mise en service générale reste conditionnée à une revue et une publication
autorisées des contenus canoniques, à la recette réelle des DS/duels et à la
qualification de l'hébergement cible. Aucun fonctionnement du host sur Vercel,
Railway, VPS ou Function conteneurisée n'est déduit de ces tests locaux.
