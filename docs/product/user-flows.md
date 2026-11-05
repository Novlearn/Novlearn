# Parcours utilisateurs

Ces parcours résument les fonctions visibles dans le dépôt. Ils ne remplacent pas une recette de production ni une vérification des services distants.

## Compte et accès

1. L'élève ouvre une session, crée un compte ou choisit le mode invité lorsqu'il est disponible.
2. Il complète les informations de profil requises et accède aux fonctions permises par son compte.
3. Une fonction réservée explique qu'une connexion est requise et propose la conversion du compte invité.

## Entraînement

1. L'élève ouvre l'entraînement et choisit un chapitre ou la prochaine recommandation.
2. Le frontend demande un exercice à l'API, puis affiche l'énoncé et les champs de réponse adaptés aux éléments de l'exercice.
3. L'élève répond et valide; l'application enregistre la tentative et met à jour la progression selon le parcours.
4. Il consulte sa progression ou poursuit avec une autre recommandation.

Les détails de correction et de score varient selon le mode. Toute refonte doit définir ces règles avant de les mutualiser.

## Révision et devoir surveillé

- **Flashcards :** l'élève ouvre ses cartes, révise les questions/réponses et gère les cartes offertes par l'interface.
- **Devoir surveillé :** l'élève crée ou ouvre un devoir, réalise les exercices retenus et consulte son résultat.

## Duel

1. Un joueur invite un adversaire depuis le lobby.
2. L'adversaire accepte; les deux joueurs rejoignent la salle Colyseus.
3. Le serveur gère les questions, le temps et le score du match; les joueurs voient son résultat et son historique.

## Administration

Les rôles autorisés ouvrent les tableaux de bord et les écrans de validation disponibles. Le dépôt ne documente pas un éditeur général d'exercices avec un cycle complet brouillon → publication; ne pas supposer qu'un tel flux est en production.

## Parcours de placement par chapitre — bloqué

Le code backend contient encore des routes et une logique de test de placement, mais la migration `019_remove_chapter_test_tables.sql` supprime les tables de progression utilisées par cette logique, et aucune migration ultérieure du dépôt ne les recrée. Le parcours ne doit donc pas être présenté comme disponible tant que la décision produit et la compatibilité du schéma ne sont pas résolues.
