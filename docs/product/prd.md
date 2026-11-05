# PRD — Novlearn

**Statut :** synthèse du produit visé et des fonctions repérées dans le dépôt. Les éléments marqués « à valider » ne constituent pas un engagement de livraison.

## Problème et objectif

Les élèves de Terminale spécialité mathématiques ont besoin d'un entraînement régulier qui les aide à choisir quoi réviser, à comprendre leurs erreurs et à suivre leurs progrès. Novlearn vise à rendre cette pratique plus personnalisée et motivante grâce aux exercices interactifs, au suivi par compétence et aux défis entre élèves.

## Utilisateurs

- **Élève :** s'entraîne, consulte sa progression, révise avec des flashcards et peut participer à un duel ou à un devoir surveillé.
- **Équipe pédagogique et administration :** consulte les données de suivi et utilise les écrans d'administration et de validation prévus par les rôles applicatifs.

## Périmètre présent dans le dépôt

- Authentification, profil et mode invité.
- Entraînement avec sélection de chapitre, recommandation d'exercices et rendu de contenus mathématiques interactifs.
- Tentatives, progression par compétence et classements.
- Flashcards, création et réalisation de devoirs surveillés.
- Invitations et matchs 1v1, avec lobby API et serveur temps réel Colyseus.
- Préférences de notification et écrans d'administration/validation.

La présence d'un écran ou d'un endpoint ne certifie pas que le parcours fonctionne avec le schéma distant actuellement déployé. Vérifier notamment les fonctions d'administration et tout changement qui dépend d'une migration.

## Exigences produit à valider

1. L'élève doit pouvoir démarrer une séance, comprendre l'énoncé, répondre et voir un résultat compréhensible.
2. Les formules, graphes et tableaux doivent rester lisibles sur mobile comme sur ordinateur; le clavier et le zoom ne doivent pas bloquer la réponse.
3. La progression doit distinguer les chapitres et compétences travaillés et permettre de choisir une prochaine action.
4. Les parcours d'exercice, devoir et duel doivent distinguer erreur de réponse, incident technique, abandon et fin normale.
5. Les données personnelles et les réponses attendues doivent respecter les frontières d'accès serveur/client prévues par l'architecture.

Ces exigences expriment l'intention produit; les critères d'acceptation détaillés restent à convenir avec l'équipe pédagogique.

## Mesure du résultat

Avant de fixer des objectifs chiffrés, définir les événements et la période de mesure. Indicateurs candidats : séances terminées et répétées, répartition des compétences pratiquées, réussite des exercices recommandés, achèvement des devoirs/duels et retours des élèves et enseignants. Ne pas déduire un progrès d'apprentissage d'un simple temps de connexion.
