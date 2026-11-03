# Questions pour définir ensemble le modèle

Aucune réponse n'est imposée par le lot 0. Les exemples suivants s'appuient sur les tests et l'inventaire. Ils servent à préparer le prochain échange.

| Décision | Exemple concret | Ce qu'il faut préciser |
|---|---|---|
| Valeur ou forme attendue | 0,5 pour 1/2 ; 2x+2 pour 2(x+1) | Quand accepter toute expression équivalente, quand exiger fraction, factorisation ou autre forme |
| Domaine et hypothèses | (x-1)/(x-1) contre 1 ; sqrt(x)^2 contre x | Domaine explicitement donné, domaine naturel ou comparaison sur domaine commun ; variables réelles, entières ou complexes |
| Approximation | 0,3333 pour 1/3 ; 1,00009 pour 1 | Exact/approché par question, tolérance absolue/relative, arrondi et unités |
| Formats et grammaire | Ensembles singleton/vide, virgules, Unicode, LaTeX, notation scientifique | Saisies acceptées, notation ambiguë, réponse invalide distincte d'une réponse fausse |
| Essais et aide | Faux puis vrai au deuxième essai ; indice consulté | Validation finale, réussite au premier essai, points partiels, conservation de chaque essai |
| Passer et abandon | Aucun essai puis Passer ; fermeture avant réponse | Statuts distincts, impact sur séries/progression/statistiques, reprise éventuelle |
| Barème | Plusieurs questions, points par question et difficulté | Agrégation, réussite partielle, comparaison entre entraînement, placement, DS et duel |
| Génération | Exclusion impossible, référence dynamique, computed manquant | Erreur auteur ou erreur technique, retry borné, blocage publication, affichage élève |
| QCM | Deux options correctes, ordre mélangé | Identités stables des options, sélection exacte ou crédit partiel, trace complète |
| Autorité du résultat | Client annonce isCorrect=true en duel | Qui décide, quelle instance est signée/identifiée, conservation des paramètres, rejouabilité |
| Historique | Ancien booléen et nouveau verdict détaillé | Version du contrat, traitement des anciens résultats, conservation et recalcul |

Ordre proposé pour notre discussion : commencer par la réponse attendue et son domaine, puis les essais/points/statuts. Nous pourrons ensuite choisir le contrat technique et les étapes de migration en fonction de ces décisions, sans anticiper un moteur ou une bibliothèque.
