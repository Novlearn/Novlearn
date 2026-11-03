# 02 — Justesse mathématique

Audit du 9 octobre 2026, révision `907fb09`. **C** = comportement confirmé par sonde exécutée ; **S** = défaut établi par lecture du code, non reproduit en session applicative ; **R** = risque probable ; **H** = hypothèse à vérifier sur le catalogue/déploiement. Le catalogue Supabase n'a pas été consulté : aucune fréquence ni liste d'exercices publiés affectés n'est prétendue.

## Nature des comparaisons actuelles

Dans `frontend/app/utils/math/evaluation.ts.checkAnswer`, le format sélectionne :

| Format réel | Comparaison | Limites et formes |
|---|---|---|
| number (défaut ; format inconnu aussi) | `checkNumberAnswer` : evaluate des deux côtés, différence absolue < 1e-4 ; Infinity identique accepté | Entiers, décimaux, calculs et fractions numériques ; flottants. Pas de précision demandée par exercice. Fallback x=1.618 seulement après une première évaluation valide. |
| fraction | `parseFraction/checkFraction` : quotient approché, < 1e-4 | Fractions LaTeX ou slash, signe initial, décimaux ; dénominateur zéro refusé dans le parseur de fraction. Aucune irréductibilité ni forme fraction exigée malgré le commentaire du type. |
| expression | `normalizeExpression` puis `checkExpression` : égalité de chaînes sinon échantillonnage | Pas de preuve algébrique. Une variable principale varie ; autres inconnues fixées à 1. Au moins cinq points communs finis ; points indéfinis ignorés. |
| interval | `parseInterval/checkInterval` : crochets et bornes numériques | Intervalle simple à séparateur ;. Pas d'union, vérification gauche<=droite ni grammaire stricte des crochets. |
| set | Si attendu contient ; : `parseSet/checkSet` ; sinon `checkExpression` | Ensembles finis numériques triés/dédoublonnés exactement puis comparés à 1e-4. Vide/singleton passent une autre branche ; syntaxe MathLive échappée fragile. |
| text | trim + minuscules, égalité stricte | Accents/espaces internes/punctuations non normalisés ; variables non substituées. Saisie MathLive utilisée aussi pour ce format. |
| complex | `normalizeExpression`, égalité de chaînes | Pas d'arithmétique complexe ni équivalence cartésienne/polaire. evaluate rejette les objets complexes. |
| QCM | `frontend/app/renderers/MCQRenderer.tsx.handleValidate` | Exactement toutes les options correctes et aucune incorrecte ; multi-réponses supportées localement, premier indice seul dans callback. |

Les équations/inéquations peuvent être des **énoncés**, avec solutions demandées en set/interval. `EquationRenderer` ne résout ni ne compare deux relations. L'acceptation numérique de `y=2` correspond à une affectation mathjs, pas à un validateur d'équation.

Fonctions : expression et tests numériques, sans domaine explicite. Suites : n échantillonné sur des entiers mais aucun domaine/indice initial attaché. Plusieurs questions : correction indépendante puis tout-ou-rien global ; pas de validation de raisonnement ou dépendance entre étapes. Vecteurs/coordonnées : aucun validateur élève observé, malgré les rendus vector/complexPlane du Creator. Unions d'intervalles, ensembles infinis et solutions paramétrées ne sont pas correctement pris en charge par une grammaire dédiée.

## Équivalence, domaine et forme

Cinq critères doivent devenir explicites :
1. Identité de texte : éventuellement pertinente en text, insuffisante pour complex.
2. Égalité numérique : utile pour valeur approchée avec tolérance contractuelle ; ne vaut pas exactitude rationnelle.
3. Identité algébrique : comparaison d'ASTs/transformation prouvée dans une famille prise en charge.
4. Même fonction sur un domaine : valeurs **et** définitions sur le domaine demandé.
5. Forme pédagogique : irréductible, factorisée, développée, nombre de décimales, etc., conservée avant canonicalisation.

Actuellement 1 et 2 sont implémentés ; 3 et 4 sont approximés par tests ; 5 n'a pas de contrat effectif. Ni `AnswerFormat`, ni QuestionContent, ni EquationContent n'expriment un domaine ou des hypothèses. Les exclusions de variables portent sur les paramètres tirés et ne décrivent pas le domaine d'une fonction.

Sondes positives : 1/2 ≡ 0.5 en number ; 2(x+1) ≡ 2x+2 ; x^2-1 ≡ (x-1)(x+1) ; sqrt(8) ≡ 2sqrt(2) ; sin(x)^2+cos(x)^2 ≡ 1. Les trois identités fonctionnelles passent les sondes d'expression ; cela ne démontre pas une correction symbolique générale.

## Bugs et divergences reproductibles

Pour les lignes ci-dessous, appel : `checkAnswer(saisie,attendu,variables,format)` sauf précision. Modules directement chargés en mémoire, mathjs installé 15.1.1. Voir le harnais dans [04](test-coverage-and-regressions.md).

| ID / statut / gravité | Reproduction et résultat actuel | Cause précise ; impact ; correction proposée |
|---|---|---|
| M01 C — critique | expression : saisie x+t, attendu x+1, variables {} → true | `checkExpression` fixe t=1 ; valide une formule fausse. Faire des comparaisons exactes/contrôlées sur toutes les inconnues autorisées. |
| M02 C — élevée | expression : (x-1)/(x-1) face à 1 → true ; sqrt(x)^2 face à x → true | `checkExpression` ignore les points où l'un est NaN ; le trou x=1 et le domaine réel x>=0 disparaissent. Bug si domaine attendu inclut ces points ; acceptable seulement avec domaine restreint explicitement posé. |
| M03 C — élevée | expression : 1/0 face à 1/0 → true | `checkExpression` accepte l'identité textuelle avant parsing/domaine. Une réponse attendue invalide peut certifier une réponse élève invalide. Valider l'attendu à publication puis la saisie avant comparaison. |
| M04 C — élevée | number : 1/0 face à Infinity → true | `evaluate` accepte Infinity ; `checkNumberAnswer` compare ses signes. Division réelle par zéro confondue avec symbole de limite. Distinguer infini symbolique permis et expression indéfinie. |
| M05 C — élevée | `evaluate('@a^2',{a:-2})` → -4 ; attendu mathématique de la substitution = 4 | `parsing.substituteVariables` injecte -2 sans parenthèses. Les computed sont partiellement protégés par `evaluateComputedExpression`, la correction et le graphe ne le sont pas. Substitution dans l'AST, pas formatage d'affichage. |
| M06 C — élevée | `substituteVariables('@a',{a:'1/2'})` → '1' | `formatValue` et parseFloat prennent seulement le préfixe ; un choix expression devient nombre tronqué. Stocker choix numériques exacts / expressions typées. |
| M07 C — élevée | `evaluate('max(1,2)',{})` → 1.2 ; min(1,2) → 1.2 ; Creator `evalMath` donne 2 et 1 | `toMathJsSyntax` transforme toutes les virgules en points. Confond décimales et séparateurs d'arguments. Parsing contextuel ; migrer soigneusement les computed. |
| M08 C — élevée | interval : a1;2b face à [1;2] → true | `parseInterval` jette premier/dernier caractères sans vérifier leur appartenance aux crochets. N'importe quels caractères donnent un intervalle fermé. Parser strict, bornes ordonnées, infinies ouvertes. |
| M09 C — moyenne | set : {2} face à 2 → false ; \\emptyset face à {} → false | `checkAnswer` ne choisit checkSet que si l'attendu contient ;. Le même type change d'algorithme avec cardinalité. Toujours parser un ensemble. |
| M10 C — élevée | set : \\{2;1\\} face à {1;2} → false ; {2;1} face à {1;2} → true | `parseSet` capture la barre oblique précédant l'accolade terminale dans son groupe gourmand ; évaluateur échoue. Problème de syntaxe compatible avec saisie LaTeX, à vérifier aussi sur la valeur effective MathLive. |
| M11 C — moyenne | number : \\left|-2\\right| face à 2 → false | Le clavier propose la valeur absolue, mais `toMathJsSyntax` ne convertit pas les barres en abs. Faux négatif d'un calcul correct. |
| M12 C — moyenne | `evaluate('\\sqrt{\\frac{1}{2}}',{})` → NaN | Racines converties avant fractions, regex limitée aux accolades simples ; après fraction la racine n'est pas re-traduite. Parser de structure nécessaire. |
| M13 C — moyenne | number : 1e3 face à 1000 → false ; 1\\,2 face à 12 → false ; expression x²-1 face à (x-1)(x+1) → false | Implicite transforme 1e3 en 1*e3 ; virgule avant espace LaTeX laisse \\. ; superscript Unicode non reconnu. Creator reconnaît scientifique et ². |
| M14 C — élevée | expression : 2(y+1) face à 2y+2 → false | `detectFreeVariables` ne connaît pas y, bien que clavier l'expose ; evaluate ne fournit que scope x. Rechercher symboles dans l'AST, whitelist liée à l'exercice. |
| M15 C — moyenne / décision | fraction : 0.5 face à 1/2 → true ; number : 0.3333 face à 1/3 → true ; 1.00009 face à 1 → true | Quotient/tolérance fixe : bug seulement si forme ou exactitude exigée ; un commentaire 'fraction irréductible' ne suffit pas à décrire la règle des exercices publiés. |
| M16 C — moyenne | complex : 1+i face à i+1 → false ; expression : \\infty face à Infinity → false | Égalité textuelle pour complex ; expression calcule Infinity-Infinity=NaN. Distinguer formats et symboles autorisés. |
| M17 C — élevée | number : true face à 1 → true ; a=2 ou y=2 face à 2 → true | `evaluate` convertit booléens en Number et accepte AssignmentNode. Restreindre types/nœuds au langage mathématique du format. Pas une preuve d'exécution JavaScript arbitraire. |
| M18 C — élevée | `generateVariables([{name:'a',type:'integer',min:0,max:0,exclusions:[0]}])` → {a:0} | Générateur abandonne les contraintes après 100 essais et rend une valeur interdite. Rejeter instance impossible ; ne jamais inventer une instance invalide. |
| M19 C — élevée | a=1,b=-3,c=2, computed r=root1(@a,@b,@c) : Creator r=1 ; élève omet r | Fonctions `mathModules` disponibles seulement dans Creator ; `variableGenerator` finit sans état d'erreur. Risque d'énoncé/correction incomplet à publication. |
| M20 C — élevée | Creator `mathModules.solve('x*x+1',0)` → -0.7188735535985907, sans racine réelle | `solve` renvoie dernier itéré après arrêt sans certifier résidu/convergence/domaine. Une réponse computed incorrecte peut être publiée comme vérité. |
| M21 C — moyenne | Creator `root1(-1,0,1)`=1 et root2=-1 ; aide annonce root1 'la plus petite' | Ordre dépend signe de a. Les deux racines existent mais la convention pédagogique est fausse. Trier si contrat petite/grande, protéger a=0. |
| M22 S — élevée | Cliquer Passer avant réponse en mode positionnement/DS | Loader appelle onNextClick(hasErrors=false) ; pages inversent en succès. Aucune réponse nécessaire pour attribuer le succès backend. Distinguer skip/abandon/incorrect/correct, endpoint ne doit pas croire agrégat. |
| M23 S — critique | Message de duel avec answer quelconque et isCorrect=true pendant playing | `DuelRoom.handleSubmitAnswer` attribue un point sans contrôler réponse, elementId ou instance ; un seul élément suffit pour exercice multiple. Vérification serveur et identifiant d'instance. |
| M24 S — élevée | trackAbandon : chargement false puis finalisation UPDATE true | Triggers AFTER INSERT en 024/041, dernière fonction 030, aucun trigger UPDATE/DELETE compensatoire trouvé : profils/monthly_scores/user_stats gardent effets du false initial. Retirer une ligne par skip ne les annule pas. Conséquences conditionnelles à déploiement conforme aux migrations. |

## Autres limites établies et risques

**S — tolérances et précision.** `EquationContent.tolerance` n'est pas utilisé par EquationRenderer/checkAnswer. `QuestionContent.points` n'est pas utilisé par l'agrégateur de scores. `formatValue` arrondit paramètres à 4 décimales avant calcul ; `simplification.formatNumberForLatex` utilise d'autres seuils (fraction dénominateur <=1000, 7 puis 4 décimales). Les paramètres calculés perdent donc une précision non justifiée avant une tolérance de 1e-4.

**S — domaines.** Aucun traitement global des singularités, logarithmes ou branches de puissances n'est observé. evaluate renvoie NaN pour objet complexe ; safeEvaluateWithVars ignore les infinis. Les fonctions trigonométriques utilisent mathjs, sans convention angulaire pédagogique déclarée. Tester arcsin/arccos/arctan LaTeX : noms conservés, alias mathjs à certifier. Un test trigonométrique réussi ne certifie pas toute notation trigonométrique.

**S — ensembles.** Une seule union n'est pas modélisée. Les doubles espaces peuvent séparer des valeurs. Dédoublonnage exact avant comparaison approchée peut traiter des quasi-doublons différemment. checkSet utilise >1e-4 pour refuser, les autres <1e-4 pour accepter : seuil strict différent. Les égalités avec infini méritent un contrat spécifique. L'ordre des solutions est ignoré en set, celui des coordonnées devrait être préservé dans un futur tuple.

**R — échantillonnage contournable.** `getTestValuesForVariable` utilise listes déterministes. Un polynôme non nul s'annulant sur toute la liste sera accepté face à zéro. Augmenter le nombre de points n'est pas une preuve. Une tolérance absolue ne gère pas correctement des ordres de grandeur variés. Tests de branche/valeurs isolées impossibles à certifier avec ces seuls points.

**R — nettoyage sémantique.** `cleanMathExpression` et `removeDivisionByOne` sont des réécritures textuelles sans AST ; suppression d'un facteur n'est pas sûre dans un dénominateur ou avec priorités. Le calcul réutilise le nettoyage lorsque le scope n'est pas vide, alors qu'un scope vide court-circuite substituteVariables : comportement dépendant du contexte. La substitution historique {nom} peut aussi intervenir dans des structures LaTeX. Éviter toute simplification de présentation avant l'évaluation.

**S/R — auteur.** Creator exprime exclusions sous forme de chaîne '0; -1'. L'élève attend tableau et itère une chaîne caractère par caractère si reçue ; une partie des exclusions est donc interprétée autrement. Le duel ignore toutes les exclusions et computed/choice/tuples. `normalizeExercise` ne convertit pas les noms de blocs ni la grammaire computed. Le catalogue reste à inventorier avant d'affirmer que toutes ces branches sont utilisées.

## Robustesse et sécurité

Le moteur élève appelle le parseur mathjs, pas eval JavaScript ni new Function dans le chemin de réponse inspecté. **Aucune exécution arbitraire de réponse élève n'a été démontrée**. Mais il n'y a ni whitelist d'AST, longueur/profondeur maximale, ni plafond de taille des matrices/appels mathjs, ni timeout/worker. NaN confond syntaxe invalide, domaine impossible, attendu cassé et erreur interne. Une expression chère bloque le thread UI ; try/catch n'impose pas une durée.

Le Creator est différent : `generateRandomValues` utilise directement new Function sur expression computed ; `mathmodules.solve/derive` aussi sur chaînes. Ce sont des entrées auteur/importées, pas une saisie élève de Novlearn. La possibilité d'exécuter du JavaScript dans ces chemins est **établie par code**, sans exploitation exécutée. Ni les 10 passes de génération ni les 50 itérations sécantes ne bornent le travail de chaque expression. Ne pas porter ces évaluateurs sur le backend. `mathExpr` possède un parseur restrictif, mais récursion/profondeur non bornées explicitement ; preprocessLatex limite les passes de fractions à 5.

Le moteur conserve/exporte les réponses attendues aux clients (Loader select *, broadcastExercise complet, GET exercice complet). Une future correction serveur n'assure pas l'intégrité si les solutions restent visibles avant soumission. Les paramètres et versions doivent être liés à une instance ; mathjs ne doit pas être alimenté par un scope contrôlable par élève.

La documentation officielle mathjs recommande de limiter les capacités exposées et les ressources : [sécurité des expressions](https://mathjs.org/docs/expressions/security.html). La recommandation pour Novlearn est une grammaire scolaire autorisée et un processus de calcul borné, pas la prétention qu'une bibliothèque suffirait à sécuriser toute expression.

## Classification pour la migration

- **Bugs à corriger volontairement** : M01, acceptation d'indéfini M03/M04, substitution M05/M06/M07, syntaxe M08, génération impossible M18, solveur non certifié M20, succès sans réponse M22/M23, finalisation incohérente M24.
- **Régressions à éviter** : signe initial des fractions, expressions équivalentes simples, semicolon français, ensembles non ordonnés, paramétrage des exercices, aliases numériques, retry/hints et barèmes distincts.
- **Règles pédagogiques légitimes à préciser** : exact vs approché ; fraction irréductible ; forme imposée ; deuxième essai ; domaine de comparaison ; identité sur domaine commun vs domaine prescrit ; point par élément ou exercice en duel.
- **Hypothèses catalogue** : usage effectif de computed root1/solve/derive, exclusions chaînes, anciens QCM et unions. Export autorisé en lecture seule et revue pédagogique nécessaires au premier lot.
