# Retrait du moteur mathématique historique — 3 novembre 2026

Les changements précédents étaient enregistrés dans `d32cc2c` avant ce nettoyage.
Le travail reste sur `codex/integration-engine-staging` ; aucun déploiement ni
écriture Production n'a été effectué.

## Résultat

`mathjs` est retiré du manifeste et du lockfile frontend, avec ses six dépendances
devenues inutiles. Les anciens évaluateurs, comparateurs, simplificateurs,
substitutions algébriques et générateurs de paramètres sont supprimés de Novlearn.
Les anciens calculs et écritures de points du navigateur sont également retirés.

L'entraînement utilise toujours les routes existantes et les sessions officielles
du serveur. Les champs de saisie, essais, indices, explications et QCM sont gardés.
Une absence de correcteur serveur produit une erreur, jamais un verdict local.
Les DS transmettent uniquement un UUID de session corrigée ; ils ne transmettent
plus de booléen de réussite, de difficulté ou de points à appliquer. Le backend
vérifie la propriété du DS et applique le reçu serveur. Les duels n'admettent plus
de manche historique ni de réussite déclarée par le navigateur, quel que soit le
drapeau d'activation ; ils conservent les identifiants de manche/question et le
verdict Engine comme autorité.

Les composants graphiques conservent canvas, grille, axes et survol. Engine prépare
513 coordonnées approchées par fonction, suffisantes pour le canvas de 512 pixels.
Le navigateur place/interpole ces coordonnées sans analyser ou évaluer de formule.
Les coordonnées hors domaine réel ou non finies restent des trous. Ces données
approchées n'interviennent jamais dans une correction exacte.

L'ancien écran `/validation`, son action API Claude et son entrée de navigation
sont retirés après l'accord utilisateur. Les données ne sont pas supprimées.
Le regroupement des écrans feedback, dashboard et flashcards dans Admin reste
une étape suivante. Les tests de caractérisation de l'ancien moteur sont
conservés comme textes historiques dans `legacy-math-baseline/` ; les tests
exécutables vérifient désormais le parcours Engine.

## Archive commune et réception

Engine **0.1.8**, SHA256
`82e499726db2da454627903ed65802eaa2ab3e7185f7f6cb3c84c1cbdbde3cea`, est installé
à l'identique dans Novlearn et Admin. Ses 169 fichiers, exports et dépendances
sont vérifiés. La projection des courbes est une option explicite du serveur ;
la génération, les instantanés privés, la correction et la projection par défaut
sont inchangés. Le patch de sources inclut les commits Engine jusqu'à la réception.

La candidate 0.1.7 avait rencontré des timeouts graphiques ; elle n'est pas reçue.
La version finale utilise un contexte Cortex local en précision machine pour le
dessin et réduit le nombre de points à la résolution utile. Le délai du host reste
de cinq secondes, avec les mêmes limites mémoire/processus et sans réseau.

La migration Staging `20261103104423_engine_graph_projection_archive` reconnaît
la nouvelle empreinte dans les nouveaux reçus Admin. Elle conserve les attributs
de sécurité de la fonction et les reçus antérieurs. La publication reste désactivée.

## Vérifications exécutées

- **111 exercices, 131 générations/projections** de l'archive exacte sous Linux
  borné. Les cinq exercices graphiques passent sur cinq seeds : **12 825 points**.
  Générations, réponses attendues et politiques identiques à la référence 0.1.4 ;
  aucune réponse privée dans les projections. Vérification réelle de `4/2 = 2`,
  du refus de `3` et d'une saisie incomplète.
- **113 tests frontend**, **175 tests backend**, **61 tests duels** et trois tests
  de reçus Admin passent. Les tests du chargeur vérifient l'absence d'écriture
  directe en base, le reçu serveur, le passage et la reprise d'une instance périmée.
- Build complet Novlearn, build duel, types des deux applications et lint passent.
- Engine : 1 548 tests portables sur la source 0.1.7, après reprise isolée du
  fichier computed ayant dépassé son délai sous charge ; les trois tests du module
  graphique modifié ensuite repassent sur la source finale 0.1.8. Build/types/lint/
  format passent. Le lanceur natif Windows reste bloqué par la stratégie OS déjà
  constatée ; le runtime opérationnel vérifié est Linux. Aucune protection modifiée.
- Navigateur réel : erreur puis nouvelle tentative, fraction `-48/2` acceptée comme
  `-24` pour la suite affichée ; exercice graphique 54 dessiné et réponse `3`
  acceptée avec son explication serveur. Rendu et saisie existants conservés.

Les [résultats structurés](2026-11-engine-only.json) ne contiennent pas de secrets
ou de réponses privées du catalogue. Le dev Staging est relancé après réception.

## Bascule Production à préparer séparément

Ce nettoyage rend les anciens lecteurs/correcteurs indisponibles sur la branche.
La livraison doit coordonner frontend, backend, serveur duel, activation d'Engine
et migration du catalogue Production. Le contrat DS ne prend plus l'ancien verdict
client. La migration d'empreinte fournie contient des préconditions **Staging** et
ne constitue pas une migration Production. Un simple merge ne suffit pas à la bascule.
