# 04 — Patterns UX

## Fonctionnalités

Présentes : entraînement par chapitre, progression, exercices/questions/QCM, MathLive, flashcards, duel, DS, compte/paramètres, classes, feedback/validation, dashboard admin. À confirmer comme futur : éditeur avancé d'exercices, preview/tests intégrés, publication et workflow brouillon/publié.

## Parcours élève

1. Chapitres : afficher progression/état et prochaine action; navigation courante explicitement nommée, emoji décoratif seulement.
2. Choix d'exercice : difficulté/type secondaires; filtres effaçables; loading, vide et erreur réseau distincts.
3. Énoncé : suivre l'ordre des éléments; titres/descriptions pour graphes et tableaux; formule longue défile dans son conteneur.
4. Réponse : label visible; clavier MathLive ne masque pas validation sur mobile; laisser le zoom navigateur actif.
5. Validation : conserver la saisie; distinguer erreur mathématique et erreur technique; résultat avec texte et icône, pas seulement couleur.
6. Correction/indice : étapes lisibles, indice volontaire; ne pas révéler trop tôt si plusieurs essais sont possibles.
7. Série : “n sur total”, possibilité de quitter/reprendre; confirmation si saisie perdue.
8. Flashcards : commande explicite pour révéler, actions de révision distinctes, clavier et tactile.

## Admin/Creator

Dashboard existant : synthèse puis détail, filtres explicites et états vides utiles. Formulaire cible : sections par intention, erreurs près du champ et résumé global avec liens. Preview cible : mêmes renderers élève et retour simple à l'édition. Tables : recherche/filtres en tête, compteur, sélection clairement montrée, adaptation en cartes ou débordement contrôlé. Publication future : statut lisible et confirmation nommant l'objet et la conséquence.

## États transversaux

| État | Convention |
|---|---|
| Loading | Skeleton si structure attendue, spinner pour action courte, dimensions stables |
| Empty | expliquer la raison et proposer l'étape suivante |
| Error | message clair, saisie conservée, action réessayer; distinguer réseau/validation |
| Success | confirmation concise, icône et texte |
| Disabled | état compréhensible; raison proche si non évidente |
| Read-only | contenu lisible, pas de faux champ actif |
| Offline | signaler lorsque l'action dépend du réseau; dire si sauvegarde locale |

## Responsive et accessibilité

S'appuyer sur 640/768/1024/1280px; vérifier aussi 320/768/1280px. Aucune barre entière ne doit défiler horizontalement. Ordre clavier logique, skip link vers main, focus non masqué par barre fixe, dialogue avec retour de focus. Zoom 200% sans perte; retirer maximumScale:1 de layout.tsx. Cibles 44px visées. Maths : scroll local, graphes avec alternative textuelle, clavier matériel/virtuel testés. Respecter prefers-reduced-motion.
