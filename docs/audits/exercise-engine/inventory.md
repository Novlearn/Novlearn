# Cartographie du futur exercise-engine

Audit technique du 9 octobre 2026. Révision : `907fb09fa4d6148a496f574e70db63fd7acf8823`, avec les modifications locales préexistantes (dont les tests L0). Aucun changement applicatif, migration, export distant ou accès à la production. Les secrets et fichiers `.env` n'ont pas été consultés.

Vérification finale : HEAD est passé à `f5c0e0c37554c204673be0ecda6e2f573488c1c1` pendant l'audit. Le diff avec la révision initiale ajoute les tests/documents déjà présents et leurs configurations, sans changement des implémentations applicatives analysées. Ce commit n'a pas été créé par cet audit.

## Lecture des preuves

**E** : comportement exécuté sur fixtures synthétiques locales. **S** : constat établi par lecture des sources. **R** : risque ou besoin à valider. Aucun résultat ne certifie le catalogue réellement publié, les policies/triggers déployés ou le navigateur élève. Les documents préexistants de `../exercise-correction/` ont servi d'orientation, pas d'oracle. L'outil auteur voisin `../Novlearn Creator/` a été lu pour les contrats et testé sur paramètres synthétiques ; aucune modification de ce dépôt. Son identité exacte avec le futur NovLearn Admin reste à confirmer.

Chemins ci-dessous relatifs à la racine Novlearn ; `../Novlearn Creator/` désigne le dépôt voisin. Index : [comportements](mathematical-behaviors.md), [contrats](contracts.md), [risques](extraction-risks.md), [tests](test-requirements.md).

## Frontières à conserver

| Couche | Responsabilité actuelle | Frontière proposée, à décider |
|---|---|---|
| Moteur mathématique pur | Générer, substituer, parser, calculer, comparer | TypeScript sans React, DOM, réseau, auth, horloge ni base ; aléatoire injecté ; résultats et diagnostics explicites |
| Modèles/contrats | Templates de variables/blocs, solutions, formats | Schéma versionné et validation runtime ; distinguer définition, instance, vue publique et résultat |
| Rendu | React, MathLive, KaTeX, canvas, tableaux, feedback | Adaptateurs consommateurs du moteur ; compilation/échantillonnage numériques séparables, dessin et interaction hors moteur |
| Pédagogie | Essais, indices, agrégation, points, streak, progression | Politique distincte du verdict mathématique ; barèmes différents par mode |
| Backend applicatif | Identité, sélection, positionnement, DS, lobby, stockage | Autorité de soumission et persistance ; pont Python/TypeScript à définir ; ne pas mettre Supabase dans le moteur |
| Colyseus | Match, joueurs, timers, scores, historique duel | Utiliser le moteur pour génération et verdict, conserver protocole/timers/persistance côté service |

## Blocs effectivement pris en charge

Source contractuelle : `frontend/app/types/exercise.ts`. Dispatch réel : `frontend/app/components/Exercise/ExerciseRenderer.tsx.ElementRenderer`.

| Type | Entrée JSON et sortie | Implémentation/dépendances | Correction et risque d'extraction |
|---|---|---|---|
| `text` | `{text}` + valeurs → prose/math | `renderers/TextRenderer.tsx`, `ui/MathText.tsx`, substitution, KaTeX | Aucun verdict ; nettoyage actuellement aussi appliqué à la prose |
| `equation` | `{latex,requireAnswer?,correctAnswer?,answerType?,tolerance?}` → formule, input texte, callback | `EquationRenderer.handleSubmit`, `checkAnswer`, simplification | Un essai ; alias numeric ; correction absente peut donner true ; ce bloc n'est pas un solveur |
| `question` | `{question,answerFormat,correctAnswer,points?,hint?,explanation?}` → MathLive, feedback, callback | `QuestionRenderer.handleSubmit`, moteur, audio, React | Deux essais par défaut ; seulement résultat terminal ; points ignorés dans barème global |
| `mcq` | `{question,options:[{text,correct}],multipleChoice?,explanation?}` → choix mélangés, callback | `MCQRenderer.shuffleArray/handleValidate`, MathText, Math.random | Tout-ou-rien ; premier indice mélangé seulement dans callback ; correction hors evaluation.ts |
| `variation_table` | `{points:[{x,value,variation}]}` → tableau et flèches | `VariationTableRenderer`, substitution, Latex | Aucun calcul des variations ni vérification des points ; modèle auteur différent |
| `sign_table` | `{points:[{x,sign}]}` → tableau de signes | `SignTableRenderer`, substitution, Latex | Aucun calcul de racines/signes ; `+,-,0,\|\|` sont déclaratifs |
| `graph` | Bornes, grille, fonctions/couleurs → canvas interactif | `GraphRenderer.compileExpression/resolveStaticBound/computeBounds`, mathjs compile, React/DOM | Calcul local d'énoncé ; pas de réponse graphique ; sampling et domaines à isoler du dessin |
| `sequence` | `{type,formula,u0,relation?,reason?,showTerms,termsCount}` | Type `SequenceContent` seulement | **Pas de branche dans le dispatcher**, donc affiché « Type non supporté » ; pas de calcul de termes élève attesté |
| `discrete_graph` | `{points?:[{n,value}]}` | Type `DiscreteGraphContent` seulement | **Pas de branche dans le dispatcher** ; ne pas confondre avec discreteGraph auteur |

Le duel affiche uniquement `text` et `question` dans `frontend/app/duel/active/[id]/page.tsx`. Les autres blocs sont ignorés. L'auteur dispose de douze types : text, equation, graph, question, mcq, signTable, variationTable, statsTable, probaTree, vector, complexPlane, discreteGraph (`src/renderers/ElementRenderer.jsx.RENDERERS`). Sept types élève rendus ne signifient pas compatibilité de tous les contenus auteur.

## Fonctions du calcul et de génération

| Fichier / fonctions | Entrées → sorties | Dépendances / consommateurs | Risque |
|---|---|---|---|
| `utils/variableGenerator.ts.generateVariables` | Variable[] → Record<string,number\|string> partiel | types, evaluate ; Loader | Math.random global ; aucun état d'échec ; exclusions/computed dépendants de l'ordre |
| Même fichier : `evaluateExclusion`, `isValueExcluded` | Exclusion + scope → number/null, boolean | parseFloat, remplacement regex, evaluate | Exclusion future ignorée ; précision/signes ; string legacy non normalisée |
| `generateIntegerWithExclusions`, `generateDecimalWithExclusions` | Bornes/exclusions → nombre après ≤100 essais puis fallback | randomInteger/randomDecimal | Fallback interdit possible, bornes non validées |
| `evaluateComputedExpression` | Expression + scope numérique → number/NaN | Parenthèses autour des @valeurs, evaluate | Correction spécifique aux computed, pas au calcul général ; fonctions auteur absentes |
| `parseTupleChoices` | Chaîne de tuples + arité → tuple aléatoire/null | split, parseFloat, randomChoice | Valeurs partiellement numériques acceptées ; exclusions des tuples ignorées |
| `randomInteger`, `randomDecimal`, `randomChoice` | Bornes/précision/liste → tirage | Math.random, toFixed | Pas de seed ; liste vide et précision invalide sans contrat |
| `toNumericVariables`, `getNumericValue` | Scope/string → nombres/fallback | parseFloat | « 1/2 » devient 1 ; chaîne « 2x » devient 2 |
| `utils/math/parsing.ts.substituteVariables` | Template + scope → chaîne | formatValue/cleanMathExpression | Affichage utilisé avant calcul ; arrondi, parenthèses et prose altérés |
| Même fichier : `parseMathText` | Texte $/$$ → segments text/math/display-math | Regex | Segmentation d'affichage, pas parseur mathématique |
| `utils/math/evaluation.ts.toMathJsSyntax` | Texte/LaTeX → syntaxe mathjs | Réécritures regex | Sous-ensemble non formalisé ; imbrication/virgules/notation scientifique |
| `evaluate` | Expression + valeurs → number, Infinity ou NaN | mathjs evaluate, substitution ; scope libre x seulement | Type résultat coercitif ; NaN masque les causes |
| `checkAnswer` | Saisie/attendu/scope/format → boolean | Dispatch number/text/expression/interval/set/fraction/complex | Pas de tolérance configurable ni diagnostic ; ensembles dispatchés sur présence de ; |
| `checkNumberAnswer` (privée) | Deux expressions → boolean | evaluate, seuil absolu 1e-4 | Essai x=1.618 seulement après première évaluation valide et différente |
| `checkExpression`, `detectFreeVariables`, `safeEvaluateWithVars` | Expressions → équivalence par tests | Liste de variables/échantillons fixe, evaluate | Pas une preuve ; domaines ignorés ; secondaires fixées à 1 |
| `parseInterval/checkInterval` | Chaînes → bornes/openness → boolean | evaluate | Délimiteurs et validité géométrique non contrôlés |
| `parseSet/checkSet` | Chaînes → valeurs triées uniques → boolean | evaluate, Set JS | Grammaire/adaptation singleton/vide imparfaite ; unicité exacte, comparaison approchée |
| `parseFraction/checkFraction` | Chaînes → numérateur/dénominateur → boolean | evaluate | Comparaison numérique uniquement ; aucune irréductibilité imposée |
| `toLatex`, `mathJsExprToLatex` | Valeur/expression → LaTeX | String, parse.toTex, substitution | Présentation ; pas une certification de validité |
| `utils/math/formatting.ts.formatValue/cleanMathExpression` | Valeur/chaîne → format arrondi/nettoyé | JS toFixed, regex | Réécritures sémantiques hors AST |
| `utils/math/simplification.ts.simplifyLatexExpression` | Attendu + scope → LaTeX | mathjs evaluate/parse/simplify/fraction, parsing | Helpers numériques/fonctions/intervalles/sets, heuristiques d'affichage ; ne prouve pas équivalence |

## Orchestration, progression et serveurs

| Fichier / fonctions | Entrées → sorties ; dépendances | Risque de frontière |
|---|---|---|
| `components/Exercise/ExerciseLoader.tsx.loadExercise` | Supabase exercises → Exercise aplati + generateVariables ; props competences prioritaires | Cast sans validation ; mélange chargement, instance, UI, abandon |
| `handleElementSubmit`, `totalQuestions`, `saveExerciseAttempt` | Callbacks terminaux → complétion par Set d'IDs, !hasErrors → INSERT/UPDATE | IDs dupliqués ; pas de trace des essais bruts, variables, seed ou version |
| `updateCompetenceScore` | utilisateur/compétence/difficulté/verdict → points/streak | TaxonomyStore, Supabase, computeNewScore ; read/upsert non atomique |
| `lib/competenceScore.ts.computeNewScore/getBonusStreak/difficultyToLevel` | points/max/niveau/streak précédent → points plafonnés | Pur mais pédagogique ; faux ne baisse pas points, streak remis à zéro dans Loader |
| `lib/exerciseUtils.ts.dbToUiDifficulty/uiToDbDifficulty` | difficulté DB ↔ UI | easy/medium/hard ↔ Facile/Moyen/Difficile ; normalisation non systématique |
| `services/taxonomyService.ts`, `store/useTaxonomyStore.ts` | DB chapitres/compétences → cache/aliases/max_points | Réseau et nomenclature pédagogique hors moteur |
| `exercices/page.tsx.handleNextClick`, `lib/api.ts.postChapterTestNext` | hasErrors → last_success → backend | Skip sans réponse devient succès potentiel |
| `ds/[id]/exercices/page.tsx.handleNextClick`, `lib/api.ts.dsApi.submitDSAnswer` | Résultat global/difficulté/compétences → soumission DS | exercise_id transmis, pas exploité pour certifier réponse ; historique global aussi écrit |
| `components/useProgressData.ts.useProgressData` | exercise_attempts et user_competence_scores → totaux/historiques par chapitre | Comptabilise les lignes sans filtre is_abandoned dans cette requête |
| `components/MonthlyLeaderboard.tsx` | RPC classement → score/streak/success_rate | Agrégats SQL dépendants de verdicts déclarés |
| `backend/main.py` | Assemblage FastAPI/routers/lifespan | Aucune correction mathématique Python |
| `backend/routers/recommendation.py.recommend_exercise/chapter_test_next` | Identité/chapitre/last_success → ID/compétences/difficulté/mode | Auth n'atteste pas réponse ; recommandation fallback si positionnement indisponible |
| `backend/recommandation.py.recommander_exercice`, `chapter_selection.py.select_chapter_for_recommendation` | Scores, streak et catalogue → choix adaptatif | Supabase, settings, random, merge sort ; sélection pédagogique hors moteur |
| `backend/streak.py.compute_streak` | Historique global/chapitre → série signée | Fenêtre limitée ; suréchantillonnage x3 avant filtre chapitre, pas garantie de fenêtre complète |
| `backend/chapter_placement_test.py.fetch_or_start_test/get_next_test_exercise/_apply_scoring/_upsert_score` | État profiles, booléen succès → questions/points/completion | Algorithme adaptatif et barème spécifiques ; pas de réponse/instance vérifiée |
| `backend/routers/ds.py.ds_submit`, `backend/ds.py.soumettre_reponse_ds` | propriétaire DS + booléen/difficulté/compétences → scores/streak DS | Compétences/difficulté client ; exercise_id inutilisé dans scoring ; writes séparés |
| `backend/routers/duels.py` | Invitations/acceptation/refus/historique → lobby DB | Hors moteur ; match effectivement géré par Colyseus |
| `duel-server/src/db.ts.getRandomExercise/isQcmExercise/generateVariables` | rows flash sans calculatrice → row + valeurs | Supabase service, Math.random ; exclusions/computed ignorés ; QCM fallback non rendu |
| `duel-server/src/rooms/DuelRoom.ts.onAuth/onCreate/tryStartGame` | token/duel/ready → deux joueurs et match | Supabase auth, Colyseus ; aucun filtre de capacité moteur |
| `handleSubmitAnswer` | elementId/answer/isCorrect/timeSpent → tentative + point + grâce | Verdict client ; contrôle phase et solvedPlayers seulement pour le scoring |
| `advanceToNextExercise/startExerciseTimer/startGraceTimer/finishDuel/handleSkipRequest` | événement/temps → chargement, phase, scores finaux | Timers natifs et async ; grace=5s en dur ; besoin tests de courses |
| `broadcastExercise/getCorrectAnswerPayload` | row/variables → message ; première question → solution | Solutions visibles dès broadcast ; alias answer prioritaire |
| `duel-server/src/db.ts.recordAttempt/saveDuelResult` | Résultats déclarés → DB | Temps borné [0,600000] ms ; erreurs Supabase retournées non inspectées |
| `duel-server/src/rooms/schema/DuelState.ts`, `src/config.ts` | État synchronisé/timings | Pas de contrat d'instance ; responsabilités temps et match hors moteur |
| `duel/active/[id]/page.tsx.buildExercise/computeCorrectAnswer/handleAnswerSubmit` | message brut → question adaptée → verdict client envoyé | Alias différents du Loader ; précalcul numérique de solution ; 999 essais, indices désactivés |
| `app/api/exercises/route.ts.GET/POST` | row ↔ objet auteur ; POST body → upsert | Contrat non validé mathématiquement ; GET handler sans contrôle auth explicite |
| `app/api/admin/claude-exercises/route.ts.POST`, `validation/page.tsx` | brouillon/aperçu → publication | Aucun oracle mathématique ajouté par la publication |
| Migrations `001,004,006,017,021,024,027,030,041,042,043` | rows/résultats → stockage, agrégats, streak | SQL déployé non inspecté ; INSERT/UPDATE/DELETE ont des effets différents |

## Outil auteur : dépendances nécessaires à la compatibilité

Dans `../Novlearn Creator/`, `hooks/useExercises.js.createEmptyExercise/normalizeExercise` normalise les métadonnées et alias variableDefinitions ; `utils/defaultContent.js.getDefaultContent` définit les douze modèles ; les editors alimentent ces modèles. `hooks/useVariables.js` appelle `utils/generateRandomValues.js.generateRandomValues` : calcul JS via new Function, helpers mathModules, arrondi computed à 12 chiffres significatifs. `utils/mathExpr.js.preprocessLatex/compileExpression/evalMath` utilise un tokenizer/parseur récursif indépendant pour graphes et coordonnées. `utils/evaluateExpression.js.evaluateExpression` fait la substitution de calcul, avec négatifs parenthésés et précision préservée. `utils/mathRenderer.jsx.replaceVariables/MathText` assure le rendu react-katex, avec arrondi à quatre décimales, en distinguant prose/math. `utils/publishUtils.js.publishExerciseToDB/fetchFullExercise` adapte le JSON aplati vers content, sans certification de ses calculs.

Les helpers auteur `mathModules` sont : delta, root1, root2, vertexX, vertexY, solve, derive, pgcd, ppcm, isPrime, round, max, min, abs. Leurs noms, conventions et limites doivent être traités explicitement ; copier leur exécution JavaScript n'est pas une extraction sûre.

## Inventaire exhaustif du périmètre fonctionnel commun proposé

Le moteur doit assurer, pour le périmètre validé ensemble :

1. Validation runtime des définitions, formats, IDs, noms de variables, arités, bornes, précisions et options QCM.
2. Versionnement et normalisation documentée des dialectes historiques ; signaler les types non pris en charge sans perte silencieuse.
3. Génération integer/decimal/choice/doublet/triplet, avec tirages reproductibles et politique de distribution définie.
4. Exclusions numériques et dépendantes, contraintes croisées, détection des contraintes impossibles, absence de fallback interdit.
5. Graphe des dépendances computed, ordre topologique, détection cycles/manquants/collisions, diagnostics ; préserver précision.
6. Registre fermé de fonctions mathématiques, constantes, arités/domaines ; décider la compatibilité de chaque helper auteur.
7. Instanciation immuable d'un exercice : version de définition/moteur, valeurs, ordre d'options et identifiant reproductible.
8. Substitution dédiée au calcul, sans arrondi ni nettoyage de présentation ; parenthèses et échappements sûrs.
9. Segmentation et substitution de présentation pures, séparées de l'évaluation et compatibles prose/LaTeX.
10. Parsing formalisé texte/LaTeX/MathLive ; nombres français/scientifiques, opérateurs, fonctions, fractions/racines imbriquées.
11. Calcul scalaire typé avec statuts syntaxe/domaine/non-fini/inconnu/limite de ressources, plutôt que NaN unique.
12. Modèle exact rationnel et modèle approché distincts ; politique d'arrondi et tolérances absolue/relative explicites.
13. Correction number, text paramétré, expression, fraction, interval, set, complex ; toutes les formes autorisées décrites.
14. Fractions équivalentes, normalisées et irréductibles selon exigence ; forme imposée indépendante de la valeur.
15. Équivalence d'expressions avec variables libres déclarées, domaines et résultat indéterminé si aucune preuve suffisante.
16. Ensembles vides/singletons/non ordonnés/dédoublonnés ; intervalles ouverts/fermés, infinis, validité ; unions si retenues.
17. Complexes algébriques et éventuellement polaires, composants exacts/approchés, conventions d'argument à définir.
18. Équations : distinguer comparer une solution, comparer deux relations et résoudre ; réserver les capacités non implémentées.
19. QCM simple/multiple : validation d'une sélection complète d'IDs stables, indépendamment de l'ordre affiché.
20. Verdict structuré par élément avec motif, preuve/niveau de confiance, attendu invalide distinct d'une réponse fausse.
21. Préparation numérique de graphes : compilation, domaines, échantillons, bornes ; pas de dessin ou DOM dans le cœur.
22. Suites et graphes discrets si retenus : index initial, formule explicite/récurrence, limites/erreurs ; aujourd'hui absents élève.
23. Support déclaré des tableaux/arbres/vecteurs/plans complexes auteur si retenus, sans prétendre les calculer ou corriger actuellement.
24. Transformation d'affichage vers LaTeX et simplification contrôlée, sans utiliser le résultat affiché comme oracle de correction.
25. API de capacités par consommateur (Admin, pratique, duel) pour refuser un exercice impossible à traiter.
26. Budgets de longueur, profondeur, coût et durée ; fonctions/AST autorisés ; erreur déterministe à épuisement.
27. Sérialisation JSON des valeurs typées et non-finis sans pertes ; replay et traces mathématiques non sensibles.
28. Exécution cohérente navigateur/Node, API pure testable, aucune dépendance Supabase/React/Next/Colyseus.
29. Contrats consommables par l'autorité serveur pour vérifier une instance et sa sélection/réponse brute.
30. Corpus de référence et tests de propriétés/parité sur chaque capacité annoncée.

Les essais, indices, barèmes, progression, classement, matchmaking, choix adaptatif, auth, stockage, timers et déploiement restent des responsabilités séparées. Une fonction pure d'agrégation peut être partagée dans une couche pédagogique distincte, mais ses règles ne doivent pas être confondues avec l'équivalence mathématique.


