# 03 — Doublons, incohérences et dette

Audit du 9 octobre 2026, `907fb09`. Les chemins Creator sont dans le dépôt voisin `../Novlearn Creator/`. Les propositions ci-dessous n'ont pas été implémentées. Les reproductions C et constats S/R sont détaillés dans [02](mathematical-correctness.md).

## Duplication et stratégie de mutualisation

| Responsabilité / fichiers et fonctions exacts | Différences ; risque | Mutualisation utile / suppression possible |
|---|---|---|
| Génération : `frontend/app/utils/variableGenerator.ts.generateVariables` ; `duel-server/src/db.ts.generateVariables` ; `../Novlearn Creator/src/utils/generateRandomValues.js.generateRandomValues` | App : exclusions tableaux, 100 retries, computed mathjs ; duel : seulement entier/décimal, pas exclusions ; Creator : chaînes, 50 retries, modules JS et 10 passes. **Critique** : instances et réponses différentes selon mode. | Une instanciation backend, versionnée et reproductible, consommée par les trois clients ; garder temporairement générateurs historiques pour comparaison puis retirer les producteurs actifs. |
| Substitution calcul : `parsing.ts.substituteVariables` ; `variableGenerator.ts.evaluateComputedExpression/evaluateExclusion` ; `Creator/src/utils/evaluateExpression.js.evaluateExpression` ; `Creator/src/utils/mathRenderer.jsx.replaceVariables` | parenthèses/arrondis/boundary underscore différents ; remplacement simple doublé pour éviter un bug du helper commun. **Élevé**. | Substitution AST pour calcul ; interpolation séparée pour rendu. Un formatteur ne doit jamais alimenter le moteur. Retirer substitution calcul regex lorsque compatibilité certifiée. |
| Parsing : `evaluation.ts.toMathJsSyntax/normalizeExpression/parseFraction/parseInterval/parseSet` ; `Creator/src/utils/mathExpr.js.preprocessLatex/tokenize/parse` | Virgules, fractions imbriquées, Unicode, fonctions et ensembles divergents. **Élevé**. | Grammaire de saisie commune au service, adaptateurs ASCII/LaTeX explicites ; conserver marqueurs pédagogiques et positions. Pas simplement une grosse regex partagée. |
| Affichage : `formatting.ts.formatValue/cleanMathExpression`, `simplification.ts.uniformizeLatex/removeDivisionByOne`, `Creator/src/utils/mathRenderer.jsx.formatValue/cleanMathExpression` | arrondis et suppressions redondants ; Creator limite nettoyage aux segments maths alors que substitution élève s'applique aussi au texte. **Élevé** si partagé avec calcul. | Mutualiser conventions de rendu et fixtures ; utiliser serialization AST pour feedback certifié. Garder rendu de prose indépendant. |
| Évaluation : `evaluation.ts.evaluate`, `simplification.ts.evaluateNumericOnly`, `GraphRenderer.tsx.compileExpression`, `Creator/mathExpr.js.compileExpression`, `Creator/mathmodules.js.solve/derive` | limites de type/finite/complex/preserved functions différentes. **Élevé**. | Le graphe peut conserver une approximation locale ; correction et computed doivent passer par langage sûr backend. Ne pas confondre dessin d'une courbe et preuve d'équivalence. |
| Correction UI : `QuestionRenderer.tsx.handleSubmit`, `EquationRenderer.tsx.handleSubmit`, `MCQRenderer.tsx.handleValidate` | essais 2/1, hints, callback terminal vs multi-choix tronqué, equation sans attendu réussit. **Élevé**. | Contrat unique de résultat par élément ; politique d'essais séparée et versionnée. Garder UI spécifique à chaque saisie. |
| Adaptation historique : `duel/active/[id]/page.tsx.buildExercise/computeCorrectAnswer`, `ExerciseLoader.tsx.loadExercise`, `Creator/hooks/useExercises.js.normalizeExercise` | answer/correctAnswer et answerType/answerFormat/numeric en duel seulement ; variableDefinitions en Creator seulement. **Élevé**. | Un adaptateur legacy contrôlé au chargement/publication, diagnostics si aliases conflictuels ; ne pas modifier à l'aveugle tous les JSON. |
| QCM : `frontend/app/renderers/MCQRenderer.tsx.handleValidate`, `Creator/src/renderers/MCQRenderer.jsx.isOptionCorrect` | Creator supporte options strings, isCorrect, correctAnswers/correctAnswer ; élève seulement objets text/correct ; mélange indices. **Élevé**. | IDs stables des options ; convertisseur des conventions connues ; service valide ensemble d'IDs. Le callback ancien peut rester derrière un adaptateur temporaire. |
| Difficultés/barèmes : `lib/exerciseUtils.ts`, `lib/competenceScore.ts`, `backend/ds.py.POINTS_PAR_DIFFICULTE`, `chapter_placement_test.py._apply_scoring`, SQL `030_fix_max_streak.sql.handle_exercise_completion` | EN/FR et normalisation inégale ; règles pratique/DS/positionnement/classement effectivement différentes. **Élevé**. | Un alias canonique de difficulté ; politiques de score **par mode**. Mutualiser normalisation, cap et transaction, pas effacer des barèmes pédagogiques distincts. |
| Séries : `ExerciseLoader.updateCompetenceScore`, `backend/streak.py.compute_streak`, `ds.py.soumettre_reponse_ds`, trigger 030 | streak compétence reset 0 ; DS ±1 borné ; profil signé change de signe ; historique recalculé par fenêtre. **Élevé** si considérés identiques. | Nommer chaque série et sa source ; un événement terminal alimente projections adaptées. Suppression de doublons seulement après décision produit. |
| Persistance : Loader save/update, DS submit, `duel-server/src/db.ts.recordAttempt`, triggers 024/041 | write direct client, résultat déclaratif, plusieurs writes non atomiques, historique impossible à rejouer. **Critique**. | Service auteur des verdicts, transaction avec idempotence et identifiant d'instance ; un état pending ne déclenche pas récompense. |
| Temps : page duel, `db.ts.recordAttempt(timeSpentMs)`, SQL 001 | frontend calcule secondes, paramètre nommé milliseconds et plafond 600000 ; schéma historique secondes. **Moyen**. | Unité explicite dans contrat, temps mesuré côté serveur pour scoring. |
| Champs de publication : `Creator/publishUtils.js.META_KEYS`, `frontend/app/api/exercises/route.ts.GET` | Creator écrit Is_Flash/Need_Calculator ; GET lit is_flash/need_calculator et expose isFlash/needCalculator ; normalizer attend capitalisées. **Élevé** : flags perdus à réédition possible. | Contrat de lecture/écriture canonique et tests roundtrip ; adaptateur legacy conserve métadonnées et inconnus. |

## Fonctions sans appel observé

Recherche statique dans `frontend/`, hors node_modules : `frontend/app/utils/math/evaluation.ts.mathJsExprToLatex`, `frontend/app/utils/variableGenerator.ts.toNumericVariables` et `getNumericValue` n'ont pas de consommateur trouvé. **Candidats**, pas preuve universelle de code mort : vérifier éventuels consommateurs externes/build avant suppression. Les exports checkExpression/checkSet/checkInterval/checkFraction sont utilisés par checkAnswer et doivent rester.

`randomInteger/randomDecimal/randomChoice` ont des appels internes effectifs ; ne pas les supprimer sur le seul motif qu'ils sont exportés. `SequenceContent/DiscreteGraphContent` sont des contrats orphelins de renderer ; leur suppression fermerait une promesse de compatibilité plutôt qu'enlever une logique inutilisée. Décision fondée sur inventaire du catalogue nécessaire.

Aucun cycle direct d'import n'a été observé dans le cœur lu : evaluation → parsing → formatting ; simplification → evaluation/parsing ; variableGenerator → evaluation. L'audit n'a pas exécuté un détecteur de cycles exhaustif sur tout le dépôt. La dépendance **sémantique** calcul → affichage est le problème principal, même sans cycle d'import.

## Fichiers ayant trop de responsabilités

- `ExerciseLoader.tsx` : DB, tirage, abandon, complétion, scores, navigation, modales et feedback. Extraire d'abord contrat d'instance/persistance avant hooks de présentation ; ne pas répartir un même bug dans davantage de fichiers.
- `evaluation.ts` : conversions, exécution, heuristique d'équivalence, parsing des conteneurs et rendu LaTeX. Séparer grammaire, règles et comparaison avec types d'erreur explicites.
- `duel/active/[id]/page.tsx` : réseau, lifecycle, temps, aliases et précalcul de vérité. Enlever précalcul/adaptation métier lorsque serveur les porte.
- `Creator/generateRandomValues.js` : tirage, exclusions, parsing tuples et exécution JS ; `mathmodules.js` mêle algorithmes et aide pédagogique. Porter seulement les opérations utiles dans une whitelist.
- `backend/main.py` n'est plus un monolithe d'endpoints malgré AGENTS ; les routers existent. La centralisation recommandée porte sur correction/service, pas sur regrouper tous les endpoints dans main.

## Dette du contrat et exercices hérités

| Convention observée | Compatibilité actuelle | Qualification |
|---|---|---|
| `content.variables/elements` versus exercice aplati ; ancien variableDefinitions | Creator normalizeExercise accepte alias ; Loader prend content.variables uniquement | Regression possible lors d'import ; adapter sans perte |
| camelCase signTable/variationTable dans Creator ; snake_case dans élève | Pas de conversion dans publication ni dispatcher | Défaut interopérabilité confirmé par code ; impact catalogue non quantifié |
| Shape variation `y/pos` versus `value/variation` ; sign `type/signs` versus `sign` par point | Un simple renommage du type ne suffit pas | Convertisseur de structure et test visuel nécessaires |
| probaTree/statsTable/vector/complexPlane/discreteGraph | Creator rend ces blocs, application ne les rend pas | Fonctionnalité d'auteur au-delà de client élève ; ne pas annoncer support de correction |
| correctAnswer/answer ; answerFormat/answerType ; numeric | Duel adapte, questions normales non | Héritage à tester mode par mode |
| Ensembles sans accolades et point-virgule | Support nominal multi-valeurs ; vide/singleton bug | Garder syntaxe, corriger branche et parsing |
| QCM anciennes options / indices | Creator preview tolérant, élève divergent | Convertir vers IDs canoniques, ne pas supprimer compatibilité sans corpus |
| points/tolerance facultatifs | Affichés/configurés mais non appliqués par scoring/comparaison | Intention produit ambiguë, pas promesse effective |
| helpers computed root1/derive/solve et syntaxe JS | Preview peut fonctionner ; app ne fournit pas ces fonctions | Migration de langage nécessaire ; anciens templates ne constituent pas du code fiable |

`ARCHITECTURE.md` décrit encore des rendus et des colonnes qui ne correspondent pas au code. L'audit ne modifie pas ce document : sa mise à jour doit suivre l'implémentation ultérieure.

Le stockage de seulement is_correct empêche d'expliquer une divergence ancienne : pas de graine, variables, version d'exercice ou réponses élémentaires en pratique. `duel_attempts` garde réponse/element_id mais pas d'identifiant d'instance ou lien suffisamment complet pour retrouver le template exact. Une refonte de persistance doit précéder l'effacement des helpers.

## Configuration auteur et validation de publication

`../Novlearn Creator/src/supabaseAdmin.js` et `src/pages/TaxonomyManager.jsx` exposent au navigateur une capacité service-role si configurée ; `src/utils/publishUtils.js` utilise également un secret HTTP côté auteur. Constat de code, pas preuve de secret déployé : déplacer ces capacités vers authentification/autorisation serveur dans la préparation des contrats. Aucun secret n'a été lu.

Creator publie difficulté française (createEmptyExercise/publishExerciseToDB), sans conversion EN malgré la contrainte SQL initiale. Références : `../Novlearn Creator/src/hooks/useExercises.js`, `src/utils/publishUtils.js`, `supabase/migrations/001_initial_schema.sql`. Risque conditionnel de refus DB ; aliases de lecture frontend ne réparent pas une contrainte d'écriture.
