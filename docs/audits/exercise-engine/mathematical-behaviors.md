# Comportements mathématiques

Audit du 9 octobre 2026 sur HEAD `907fb09` et état local préexistant. Sources/entrées/sorties/dépendances : [inventory](inventory.md). E = exécuté localement ; S = lecture de code ; R = à vérifier. Aucun catalogue distant ni déploiement inspecté.

## Génération des variables

`frontend/app/utils/variableGenerator.ts.generateVariables(Variable[])` retourne un objet partiel `Record<string, number|string>`, sans diagnostics.

| Variante | Algorithme actuel | Contraintes et erreurs |
|---|---|---|
| integer | floor(random*(max-min+1))+min, bornes inclusives si entières | min/max nécessaires ; pas de contrôle min≤max ou intégralité ; 100 essais puis nouveau tirage même interdit |
| decimal | Tirage uniforme continu puis toFixed(decimals), parseFloat | min/max/decimals nécessaires ; distribution non uniforme sur grille après arrondi ; précision invalide peut lever une exception |
| choice | Tirage dans choices tableau ; filtrage des choix parseFloat-numériques exclus | Type de valeur conservé string ; non-numériques toujours gardés ; tous exclus → tirage original |
| doublet choice | split ; puis virgules, parseFloat ; arité 2 ; tirage d'un tuple | names doit avoir longueur 2 ; exclusions non appliquées ; parsing vide/invalide → aucune valeur |
| triplet choice | Idem, arité 3 | names longueur 3 ; erreurs silencieuses |
| triplet perfect_square | Tire p,q puis A=p²,B=2pq,C=q² | Exclusions appliquées à p,q, pas A/B/C ; signe de B possible ; aucune validation des noms |
| computed | Après tirages, remplace @nombres par (valeur), evaluate avec scope vide | Finis seulement ; dépendances manquantes/cycles → omission ; exclusions computed ignorées |

S : noms dupliqués peuvent écraser des valeurs ; names peut entrer en collision avec variables scalaires. Les branches doublet perfect_square et type inconnu ne produisent rien. Le JSON n'est pas validé avant le switch.

`evaluateExclusion` accepte nombre ou expression : conversion des valeurs par parseFloat, substitution @name sans parenthèses, puis evaluate. Les @non résolus produisent null et sont ignorés. Première passe dans l'ordre de la liste : une exclusion dépendant d'une variable tirée plus tard ou computed n'est pas revisitée. Seuil d'exclusion `abs(value-excluded)<1e-4`. Les chaînes historiques telles que exclusions="@a" sont parcourues caractère par caractère : le test L0 confirme qu'elles n'excluent pas a. Une chaîne "12" ne représente pas correctement une exclusion de douze.

La boucle computed compare **computedCount**, nombre de variables résolues, avec 10 ; ce n'est pas un compteur de passes. Elle peut résoudre plus de dix variables dans un seul parcours, mais une chaîne inverse de onze dépendances s'arrête après v9 : v10 manque (E, sonde en mémoire). Retourner un objet partiel permet ensuite un rendu/correcteur avec placeholders non résolus.

E : @a^2 avec a=-2 est correctement calculé à 4 en computed, alors que evaluate général retourne -4. E : exclusion impossible [0] sur [0,0] retourne 0. Les tests déterministes remplacent Math.random ; l'API elle-même n'accepte ni seed ni RNG.

## Grammaire, parsing et évaluation

Pipeline actuel : `evaluate(expression, variables)` → `substituteVariables` → `toMathJsSyntax` → mathjs.evaluate → conversion Number.

`substituteVariables` traite @nom, @@ et aussi {nom}; trie les clés par longueur ; substitue avec gestion des signes, formatValue (quatre décimales), puis cleanMathExpression. Les noms sont injectés dans RegExp sans validation/échappement. La frontière après @nom bloque lettres/chiffres mais permet underscore, contrairement à l'auteur. Si le scope est vide, la fonction court-circuite le nettoyage et restaure seulement @@. Le résultat peut donc dépendre de la présence d'une variable sans rapport avec l'expression.

`toMathJsSyntax` retire de nombreuses commandes MathLive/LaTeX ; transforme les virgules en points, infty en Infinity, pi/e, times/cdot/div et ':' ; log est décimal, ln devient log naturel ; convertit sqrt/nthRoot, puissances, fractions frac/dfrac/cfrac/tfrac simples et multiplication implicite. Les fractions sont réécrites itérativement, mais les racines passent avant les fractions et ne gèrent pas toutes les imbrications. Aucun AST intermédiaire scolaire ou whitelist n'est appliqué.

`evaluate` n'offre au scope mathjs que x si fourni ; les autres variables doivent être substituées via @. Préserve ±Infinity ; rejette les objets avec re, les autres résultats non finis ; convertit les résultats coercibles en Number. Les exceptions deviennent NaN. E : true→1 et a=2→2 sont acceptés comme réponses numériques dans les tests. Il n'existe pas de catégorie d'erreur distincte pour syntaxe invalide, paramètre absent, domaine, attendu cassé, timeout ou complexité.

Cas vérifiés (tests L0 et sondes synthétiques) :

| Entrée | Résultat actuel | Conséquence |
|---|---|---|
| evaluate("@a^2",{a:-2}) | -4 | Substitution sans parenthèses dans calcul général |
| evaluate("@a",{a:0.123456789}) | 0.1235 | Présentation arrondit avant calcul |
| paramètre string a="1/2" | traité comme 1 | parseFloat ne représente pas un rationnel |
| max(1,2) | 1.2 | Virgule décimale détruit séparateur d'arguments |
| 1e3 comparé à 1000 | faux | Insertion '*' perturbe notation scientifique |
| sqrt LaTeX contenant frac | NaN / réponse refusée dans cas testé | Ordre des réécritures et accolades |
| valeur absolue LaTeX avec barres | refusée dans cas testé | abs() et barres ne sont pas équivalents dans la grammaire actuelle |
| x² face à x*x | faux | Unicode non normalisé par le pipeline élève |

Le parseur auteur `../Novlearn Creator/src/utils/mathExpr.js` est distinct : tokenizer et descente récursive, fonctions fermées, puissances associatives à droite, multiplication implicite, Unicode/scientifique et virgules d'arguments. `evalMath` n'est pas un correcteur de réponses. Le calcul computed auteur suit encore un troisième dialecte, JavaScript via new Function avec ^→**.

## Correction par format

`checkAnswer(userInput, correctAnswer, variables, format='number')` rejette les chaînes vides puis retourne boolean. Il ne consomme ni points ni tolerance.

| Format / fonctions | Comportement précis | Limitations vérifiées ou établies |
|---|---|---|
| number / checkNumberAnswer | evaluate des deux côtés ; NaN faux ; infinis par identité ; sinon erreur absolue <1e-4 | Pas de précision demandée ; après différence numérique seulement, reteste x=1.618. Des expressions libres non évaluables d'emblée sortent avant ce fallback |
| text | trim().toLowerCase() des deux chaînes | Attendu @variable non substitué (E : '2' vs '@a', a=2 → faux) ; accents/Unicode/espaces internes non normalisés |
| expression / checkExpression | Identité normalisée immédiate ; sinon numérique si aucune variable détectée ; sinon échantillonnage | Texte invalide identique accepté (E : garbage/garbage) ; pas de preuve symbolique ni politique de domaine |
| interval / parseInterval/checkInterval | Nettoie left/right/middle, lbrack/rbrack ; enlève premiers/derniers caractères ; split ';' ; evaluate des deux bornes ; compare ouverture et valeur | E : a1;2b accepté comme [1;2] ; ne vérifie pas les vrais délimiteurs, l'ordre des bornes ni ouverture aux infinis ; une seule composante, pas d'union |
| set / checkAnswer→checkSet | **Seulement si l'attendu contient ';'**, sinon checkExpression | E : singleton {2} vs 2, emptyset vs {}, accolades LaTeX → faux ; défaut de routage et regex d'accolade échappée |
| set / parseSet/checkSet | Alias vides, préfixe S=/solutions:, split ';' ou ≥2 espaces ; evaluate ; unique exact puis tri ; comparer à 1e-4 | Pas de virgules de liste ; pas d'ensembles symboliques/unions ; dédoublonnage non tolérant ; seuil de rejet >1e-4 contrairement aux autres formats |
| fraction / parseFraction/checkFraction | Signe initial ; fraction LaTeX ou a/b ou scalaire/1 ; dénominateur nul rejeté ; compare quotients à <1e-4 | E : 2/4 et 0.5 acceptés face à 1/2 ; aucun contrôle entiers/irréductibilité/forme imposée |
| complex | normalizeExpression des chaînes puis égalité | E : 1+i ≠ i+1 ; @a+i non substitué ; aucun calcul de parties réelle/imaginaire, module ou argument |
| QCM / MCQRenderer.handleValidate | Toutes les options correctes et aucune incorrecte, sélection non vide | options.correct fait foi ; multipleChoice=false avec plusieurs bonnes options impossible à réussir ; callback perd sélection complète et IDs auteur |

`normalizeExpression` ignore casse/espaces et quelques commandes LaTeX/opérateurs. Ce n'est pas une normalisation algébrique. La branche complex ne fait pas appel à mathjs pour comparer des complexes.

Le bloc equation utilise ces formats pour **une réponse attendue préécrite**. Aucun solveur d'équations élève n'est observé. Il n'y a pas de format dédié aux inéquations, relations équivalentes, systèmes, matrices ou vecteurs. Une question peut demander une solution d'équation sous number/set/interval, sans que le moteur ait résolu cette équation.

## Équivalence et domaines

`detectFreeVariables` reconnaît seulement n,x,t,k,i,j,m,p,u,v, retire @templates et commandes LaTeX. y,z ou un nom arbitraire ne sont pas couverts. La variable principale est n si présente, sinon la première détectée. Toutes les secondaires valent 1.

Échantillons discrets : [0,1,2,3,4,5,6,7,10,15]. Continus : [0.5,1,1.5,2,2.5,3,4,5,-1,-0.5,0.1,0.25]. Au moins cinq tests valides, tous concordants. Si l'un des résultats est NaN/non fini, ce point est ignoré, même si seul le domaine de la réponse élève est invalide.

E : x+t est accepté face à x+1. E : le produit des douze facteurs `(x-v)` sur tous les échantillons continus est accepté face à zéro, alors qu'il est non nul ailleurs. E : (x-1)/(x-1) est accepté face à 1 ; sqrt(x)^2 face à x malgré domaines différents. Aucune dérivation symbolique, preuve d'identité polynomiale ou égalité de domaines n'est utilisée dans checkExpression. mathjs.simplify apparaît dans la présentation, pas dans cette preuve.

Décisions nécessaires : domaine prescrit ou domaine commun ; rejet des singularités supprimées ; variables et domaines déclarés ; différence entre égalité de valeurs, identité, forme factorisée/développée et équations équivalentes. Un résultat « indéterminé » est nécessaire si le critère retenu n'est pas démontré.

## Arrondis et simplification d'affichage

| Site | Politique observée | Portée |
|---|---|---|
| variableGenerator.randomDecimal | toFixed(decimals) | Génération scalaire |
| parsing→formatValue | Entier inchangé, sinon toFixed(4) | Affichage **et calcul général** |
| checkAnswer | Absolue 1e-4, généralement strict '<' | Verdict ; EquationContent.tolerance ignorée |
| checkSet | Refus seulement si écart '>1e-4' | Frontière du seuil différente |
| simplification.toSimpleFraction | mathjs.fraction ; dénominateur ≤1000 | Rationalisation d'un flottant, pas arithmétique exacte initiale |
| simplification.formatNumberForLatex | Arrondi à 7 décimales, puis 4 si besoin | Affichage de solution |
| Graphe | coordonnée survol toFixed(2), graduations selon pas | Présentation uniquement |
| Duel db.roundTo | Math.round(v*10^d)/10^d | Diffère de toFixed pour certains flottants/valeurs négatives |
| Auteur computed | toPrecision(12) | Précision distincte du calcul élève |
| Auteur round | Math.round à n décimales | Fonction de calcul exposée à l'auteur |

`simplifyLatexExpression` substitue les valeurs, retire $, traite intervalles/';'/ensembles récursivement, puis évalue les parties purement numériques. Préserve certaines fonctions (ln/log/exp/sqrt/trigo/pi/e), réduit fractions/produits numériques et racines carrées parfaites, sinon parse/simplify/toTex avec fallback regex. `removeDivisionByOne` supprime des motifs `/1` et fractions de dénominateur ±1. Ces heuristiques ne garantissent pas une transformation sémantique sûre pour toute expression imbriquée. Les termes « exact » dans les commentaires ne prouvent pas une arithmétique exacte : la source reste souvent un Number.

## Fonctions auteur et préparation graphique

`mathModules` : delta=b²−4ac ; root1/2=(-b∓sqrt(delta))/(2a) ; vertexX=-b/(2a), vertexY=f(vertexX) ; derive est différence centrée h=1e-5 ; solve est sécante, ≤50 itérations, tolérance résidu 1e-7 et différence 1e-9. E : solve('x*x+1',0) retourne un nombre fini non racine ; root1(-1,0,1)=1 et root2=-1 malgré aide petite/grande. a=0, non-entiers PGCD/primalité, absence de convergence doivent avoir des contrats ; ils ne sont pas certifiés par ces helpers.

Graphe élève : compileExpression substitue puis compile avec mathjs, scope x ; resolveStaticBound rend null pour auto ou expression invalide (même catégorie). computeBounds choisit x=[-10,10] si auto, ou ±20 depuis la borne connue ; refuse ordre invalide ; 201 positions x (indices 0..200), y finis, percentiles 1/99%, marge 15%, range minimal 1. Canvas réévalue par pixel, coupe sauts >50% de l'étendue y et valeurs hors marge ; heuristique, pas analyse des asymptotes. Légende simplifiée distincte des fonctions compilées. Ces calculs d'énoncé doivent partager les conventions du cœur, sans déplacer canvas/ResizeObserver/souris vers le package pur.

Aucun calcul automatique des signes/variations n'est effectué par les deux tableaux élève ; leurs valeurs sont des déclarations auteur. Aucun calcul de suites n'est opérationnel dans le dispatcher élève actuel.
