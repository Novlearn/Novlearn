# Risques, duplications et décisions

Audit du 9 octobre 2026, HEAD `907fb09` avec modifications locales préexistantes. Aucun correctif implémenté. **E** = reproduit sur cas synthétiques/tests locaux ; **S** = établi par le code ; **R** = risque non reproduit ou dépendant du déploiement/catalogue. La gravité est une appréciation de l'impact possible ; le nombre d'exercices/utilisateurs affectés n'est pas connu.

## Défauts établis

| ID / preuve / gravité | Observation et reproduction | Fichiers/fonctions | Conséquence pour l'extraction |
|---|---|---|---|
| B01 E critique | Un message answer='wrong',isCorrect=true donne un point ; elementId=999 également | DuelRoom.handleSubmitAnswer, DuelRoom.l0.test.ts | Centraliser le calcul ne change rien si le serveur continue de croire le client |
| B02 E élevée | Une seule réponse donne le point pour un exercice à deux questions ; doublons persistés deux fois, scorés une fois | Même handler/test ; recordAttempt avant solvedPlayers | Décider point par élément/exercice, idempotence et instance |
| B03 S élevée | Générateur duel traite seulement integer/decimal, ignore exclusions/computed/choice/tuples | duel-server/src/db.ts.generateVariables | Même définition produit une instance différente ou incomplète selon consommateur |
| B04 E élevée | @a^2, a=-2 → -4 ; computed correspondant → 4 | parsing.substituteVariables, evaluation.evaluate, evaluateComputedExpression ; correction/creator tests | Séparer substitution de calcul et d'affichage ; risque de modifier les réponses historiques |
| B05 E élevée | @a=0.123456789 → evaluate renvoie 0.1235 ; string '1/2' traité comme 1 | formatValue, substituteVariables, toNumericVariables | Contrat de valeur exact/approché nécessaire avant partage |
| B06 E élevée | x+t accepté comme x+1 | checkExpression, safeEvaluateWithVars ; correction-reference | Variables secondaires figées à 1 ; faux positifs de progression/duel |
| B07 E élevée | Produit des douze facteurs (x-v) sur échantillons accepté face à zéro | checkExpression/getTestValuesForVariable ; sonde audit | Échantillonnage déterministe n'est pas preuve d'identité |
| B08 E élevée | 'garbage' comparé à lui-même → true ; 1/0 identique accepté | checkExpression identité normalizeExpression | Ne pas confondre identité textuelle et expression valide ; politique infini/domaine à décider |
| B09 E élevée | a1;2b accepté comme [1;2] | parseInterval/checkInterval ; correction-reference | Validation syntaxique d'intervalle absente |
| B10 S/E moyenne | [-Infinity;2] comparé à lui-même → true ; bornes inversées non rejetées par parser | parseInterval, sonde locale | Nécessite validité des intervalles, au-delà de l'égalité de champs |
| B11 E élevée | Ensembles vides/singletons rejetés ; accolades LaTeX échappées rejetées | checkAnswer branche set, parseSet ; correction-reference | Dispatch piloté par chaîne de solution ; dialecte non canonique |
| B12 E élevée | max(1,2)→1.2 ; 1e3≠1000 ; radical avec fraction, barres abs, x² refusés dans cas testés | toMathJsSyntax ; correction-l0/creator-parity | Définir grammaire et conversions ; ne pas transporter les regex inchangées comme langage stable |
| B13 E/S moyenne | 1+i≠i+1 ; '2+i' vs '@a+i',a=2 → faux | checkAnswer complex, normalizeExpression | Format déclaré sans équivalence complexe ni substitution |
| B14 E/S moyenne | Texte '2' vs '@a',a=2 → faux | checkAnswer text | Attendu paramétré non résolu ; décider politique textuelle |
| B15 E élevée | Domaine d'entiers [0,0], exclusions=[0] → 0 | generateIntegerWithExclusions ; variable-generator-l0 | Impossible génération cachée par fallback ; exercice illégal possible |
| B16 E élevée | exclusions legacy='@a' n'exclut pas a ; dépendances futures ignorées (S) | evaluateExclusion/isValueExcluded/generateVariables | Normalisation et résolution des contraintes à spécifier |
| B17 E élevée | Onze computed en dépendance inverse → v0..v9, v10 absent | generateVariables boucle computed ; sonde audit | Limite computedCount erronée ; aucun diagnostic sur instance partielle |
| B18 E élevée | Equation requireAnswer=true sans correctAnswer accepte réponse quelconque comme true | EquationRenderer.handleSubmit ; renderers-l0 | Attendu absent devrait être invalid-expected, pas succès |
| B19 E/S moyenne | QCM multiple correctement sélectionné retourne seulement premier indice mélangé | MCQRenderer.handleValidate ; renderers-l0 | Impossible rejouer/valider la sélection complète à partir du callback |
| B20 E/S élevée | Passer avant réponse appelle onNextClick(false), les pages envoient !hasErrors=true | ExerciseLoader, exercices/page, ds/[id]/exercices/page ; loader-l0 | Skip peut être reçu comme succès positionnement/DS ; verdict distinct nécessaire |
| B21 E/S élevée | Pending INSERT false puis UPDATE true ou DELETE laisse compteurs erronés dans les définitions SQL testées | 024 trigger INSERT, 030.handle_exercise_completion, 041.update_user_stats_on_attempt ; correction-triggers | Confirmé SQL en mémoire ; impact production conditionnel au schéma déployé ; hors moteur pur |
| B22 S élevée | sequence/discrete_graph déclarés, non dispatchés ; tableaux auteur camelCase et structures incompatibles | exercise.ts, ExerciseRenderer, Creator defaultContent | Renommer les types ne résout pas transformation des structures ; capacité consommateur explicite |
| B23 E élevée | Helper root1 absent côté élève ; Creator ln computed ne produit pas r mais élève oui | Creator generateRandomValues/mathModules, variableGenerator ; creator-parity | Fonctions/grammaire différentes ; export auteur ne garantit pas utilisabilité élève |
| B24 E élevée | Creator solve('x*x+1',0) retourne un non-root ; root1(-1,0,1)=1,root2=-1 | Creator mathModules.solve/root1/root2 ; creator-parity | Convergence/résidu non attestés ; convention petite/grande fausse pour a<0 |

B08/B10 décrivent une acceptation établie. Le comportement pédagogique attendu (infini comme valeur étendue, domaine imposé, etc.) reste à trancher ; ne pas choisir silencieusement une convention lors de l'extraction.

## Limitations, incohérences et risques non quantifiés

- **S** : EquationContent.tolerance n'est consommée ni par EquationRenderer ni par checkAnswer ; QuestionContent.points n'influence pas computeNewScore. La fraction dite « irréductible » accepte 2/4 et 0.5 (E) : incohérence avec commentaire, convention produit à choisir.
- **E/S** : 2(y+1) vs 2y+2 refusé ; variables libres reconnues limitées à dix noms. Les points où une réponse n'est pas définie sont ignorés ; (x-1)/(x-1) et 1 acceptés. Impossible d'inférer égalité des domaines de ce verdict.
- **S** : checkSet dédoublonne à l'égalité Number exacte mais compare ensuite à 1e-4. Au seuil exactement 1e-4, number et set n'appliquent pas la même inégalité. NaN/Infinity et tri doivent avoir des règles ; ne pas étendre les sets réels aux complexes par simple réemploi.
- **S/R** : cleanMathExpression sur template entier peut réécrire prose, coefficients, puissances et termes sans AST. removeDivisionByOne peut supprimer un motif dans un contexte plus large. Une transformation d'affichage peut donc modifier un calcul si partagée sans séparation.
- **S/R** : noms de variables libres dans regex, collisions de noms/IDs, min>max, décimales négatives, bornes non entières, tableaux absents et chaînes partiellement numériques ne sont pas validés uniformément. Certains provoquent silence, d'autres une exception générale.
- **S/R** : pas de budget AST/longueur/profondeur/coût, pas de timeout de chaque calcul ; try/catch ne protège pas contre une évaluation longue. Aucune exécution JavaScript arbitraire par saisie élève n'a été démontrée. Les computed/solve/derive auteur utilisent explicitement new Function ; ne pas les porter sur le serveur tels quels.
- **S** : Loader charge select('*') et duel broadcast la row complète, solutions comprises. La correction serveur seule ne suffit pas si la solution privée reste diffusée. GET /api/exercises n'applique pas explicitement une authentification dans le handler ; protections réelles middleware/proxy non certifiées ici.
- **S/R** : SubmitAnswerMsg ne contient pas d'instanceId ; message retardé peut viser la nouvelle question. Pas de validation runtime de answer/isCorrect/timeSpent/elementId, pas d'anti-replay ou de limite de soumissions dans ce handler.
- **S/R** : advanceToNextExercise async peut se poursuivre pendant finishDuel ; timeout, grâce et skip ont des transitions concurrentes ; absence de verrou/version de transition dans code inspecté. Course non reproduite dans cet audit.
- **S** : le pool duel écarte QCM seulement si d'autres exercices existent ; fallback QCM possible, alors que la page ne rend pas mcq. Équations et graphes non affichés peuvent supprimer une partie indispensable de l'énoncé. Il faut filtrer par capacités, pas par titre contenant QCM.
- **S** : getCorrectAnswerPayload choisit uniquement la première question, tandis que page duel précalcule la solution avec evaluate et aliases answer/answerType/numeric. Les modes n'ont pas un adaptateur de contrat commun.
- **S/R** : les enfants question/QCM gardent état au changement de props ; le dispatcher utilise element.id comme key. Si un exercice suivant réutilise un ID, l'état terminé peut persister. React réel navigateur et régénération à couvrir ; absence de reset contrairement à EquationRenderer.
- **S/R** : Loader compte questions puis compare Set.size, sans valider que l'ID appartient à un élément répondable. IDs dupliqués empêchent complétion ; callback externe rejoué non audité. Sans question, totalQuestions=0 et aucun achèvement automatique.
- **S/R** : updateCompetenceScore fait SELECT puis UPSERT, non atomique ; score mis à jour même si saveError de tentative ; Promise.all sur IDs non dédoublonnés ; multi-onglets/échecs réseau peuvent dissocier historique et progression.
- **S** : exercise_attempts normal écrit score par défaut 0, temps null, sans answer/variables. Le trigger mensuel calcule ses points par difficulté indépendamment, user_stats additionne NEW.score. Ces agrégats ne sont pas des mesures identiques. Historique non rejouable.
- **S** : useProgressData et compute_streak ne filtrent pas is_abandoned dans les requêtes inspectées. Fenêtre chapitre x3 de compute_streak peut manquer des tentatives anciennes ; extraction mathématique ne résout pas ces choix.
- **S** : ds_submit authentifie le propriétaire, mais consomme compétences/difficulté/verdict client et ignore exercise_id pour certification. Difficultés françaises donnent delta=1 dans POINTS_PAR_DIFFICULTE, contrairement à difficultyToLevel et SQL bilingues.
- **S/R** : Type Exercise.difficulty français et contrainte SQL easy/medium/hard divergent ; publication auteur défaut Moyen/Facile. Échec de publication dépendant de contrainte réellement déployée. GET flags minuscules vs colonnes majuscules. Bigint SQL sérialisés en number peuvent dépasser entier sûr JS.
- **S** : Supabase recordAttempt/saveDuelResult attendent requête mais ne contrôlent pas error ; catch appelant ne suffit pas si l'erreur est une valeur retournée. La fiabilité de persistance ne doit pas faire partie de la promesse du moteur.

## Duplications à inventorier avant partage

| Domaine | Copies | Différence / dépendance bloquante |
|---|---|---|
| Génération | variableGenerator / duel db / Creator generateRandomValues | 100 vs 50 essais, tableaux vs strings, défauts/bornes, rounding, exclusions, tuples, computed |
| Évaluation | evaluation.ts / GraphRenderer compile / Creator mathExpr / computed JS | Portée du scope, dialecte, coercition, fonctions et erreurs ; packages mathjs vs parseur maison |
| Substitution | parsing.substituteVariables / computed/exclusion helpers / Creator evaluateExpression/mathRenderer | Négatifs parenthésés ou non, précision, frontière underscore, prose |
| Formatage | formatValue / toLatex / simplification / KaTeX adapters / auteur | 4 décimales vs 12 significatifs ; rationalisation flottants ; erreurs masquées |
| Contrats | exercise.ts / duel db.ts / buildExercise / normalizeExercise / defaultContent / API | camel/snake, nullabilité, flags, IDs, réponse answer/correctAnswer, numeric/number |
| QCM | renderer élève / aperçu auteur | IDs/aliases et sélection complète vs un indice ; Math.random local |
| Scores | competenceScore / Python placement / Python DS / SQL 030 / DuelRoom | Politiques volontairement distinctes ; ne pas les fusionner en une formule unique |
| Agrégation de résultat | Question/Equation/MCQ / Loader / page duel / Python | Essais terminaux vs bruts, 1 ou 2 ou 999 essais, points par exercice vs première réponse |

React 18/Next élève et React 19/Vite auteur ne doivent pas être des peerDependencies d'un cœur pur. mathjs est une dépendance de calcul actuelle ; MathLive/KaTeX/canvas/DOM relèvent du rendu. Supabase/Zustand/auth sont des adaptateurs métier. FastAPI/Python ne peut pas importer directement un package TypeScript : choisir explicitement un service/worker Node, un pont local ou une autre autorité ; une réécriture Python recréerait la duplication de règles.

## Décisions à prendre ensemble

1. Confirmer le périmètre v1 : sept blocs élève rendus, neuf déclarés ou douze auteur ; définir capacités requises pour duel et Admin.
2. Définir la grammaire unique, le registre des fonctions auteur conservées et le rejet des expressions invalides/non bornées.
3. Définir exact/approché, tolérances et arrondis ; fraction irréductible et forme factorisée/développée ; complexes acceptés.
4. Déclarer variables libres et domaines ; choisir niveau de preuve d'équivalence et statut indéterminé.
5. Versionner définitions/instances/moteur et distinguer vue publique/solution privée ; préciser replay, IDs, unité de temps.
6. Choisir l'autorité de correction (duel Node et pratique/DS/positionnement), et le raccord au backend Python.
7. Séparer succès mathématique, succès après nouvel essai, échec terminal, skip, abandon et timeout ; définir les barèmes par mode.
8. Traiter cohérence transactionnelle et idempotence des tentatives/points dans les services, sans en faire une dépendance du cœur.
9. Valider un corpus mathématique humain ; classifier chaque différence comme bug corrigé, comportement à préserver ou règle nouvelle.
10. Avant migration, obtenir un inventaire autorisé d'une copie locale/staging des contenus et du schéma. Aucun export distant lancé ici ; les occurrences réelles et versions déployées restent inconnues.

Il ne faut pas extraire le pipeline actuel en supposant qu'il constitue déjà un contrat stable : cela figerait les faux positifs, le nettoyage avant calcul et les différences de mode. Les propositions ci-dessus décrivent des décisions préalables, sans lancer la refonte.
