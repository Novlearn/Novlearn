# Contrats JSON et interfaces

Audit du 9 octobre 2026, révision `907fb09` + état local préexistant. Contrats actuels vérifiés dans les sources ; interfaces futures ci-dessous **proposées**, non implémentées. Le catalogue réel n'a pas été lu. Les exemples sont synthétiques, pas des exercices publiés.

## Trois représentations actuelles

La DB stocke les métadonnées au niveau ligne et les définitions sous `content`. L'auteur utilise un objet aplati avec appTitle ; l'élève utilise Exercise aplati avec app_title ; le duel transporte la ligne DB complète avec content. Pas de schemaVersion ni de validation runtime partagée.

```json
{
  "id": 1,
  "title": "Exemple interne",
  "app_title": "Calculer un carré",
  "chapter": "Exemple",
  "difficulty": "easy",
  "competences": ["competence-exemple"],
  "Is_Flash": true,
  "Need_Calculator": false,
  "content": {
    "variables": [{"id": 1, "name": "a", "type": "integer", "min": -3, "max": 3, "exclusions": [0]}],
    "elements": [
      {"id": 1, "type": "text", "content": {"text": "Pour $a=@a$, calculer $a^2$."}},
      {"id": 2, "type": "question", "content": {"question": "Quelle valeur ?", "answerFormat": "number", "correctAnswer": "@a^2", "points": 1}}
    ]
  }
}
```

Le JSON représente un contrat existant, mais l'exemple a<0 expose le bug actuel de substitution ; il ne certifie pas la correction. `001_initial_schema.sql` impose easy/medium/hard ; `021` ajoute title/competences/app_title et flags cités. L'interface Exercise déclare difficulté française, title/app_title string et competence_id optionnel ; des lignes peuvent avoir des champs nullable. `ExerciseLoader` fait `as unknown as Exercise`, sans conversion systématique. `exerciseUtils` expose les conversions mais ne les impose pas à l'import.

`../Novlearn Creator/src/utils/publishUtils.js.META_KEYS/publishExerciseToDB` extrait id/title/appTitle/chapter/difficulty/competences/flags et met le reste dans content. `normalizeExercise` accepte appTitle/app_title/apptitle et variableDefinitions, sans harmoniser les types de blocs ou les structures. `frontend/app/api/exercises/route.ts.GET` renvoie l'objet aplati ; il lit is_flash/need_calculator en minuscules, alors que publication et duel utilisent Is_Flash/Need_Calculator. Métadonnées potentiellement perdues à la lecture (S, schéma déployé non vérifié).

## Contrat Variable et valeurs

Source : `frontend/app/types/exercise.ts.Variable`, `VariableValues`.

| Champ | Type courant | Conditions effectivement utilisées |
|---|---|---|
| id, name, type | number, string, union | Aucun contrôle unicité/nom/ID runtime ; name obligatoire TS même pour tuples |
| min, max | number optionnels | integer/decimal, triplet perfect_square |
| decimals | number optionnel | Obligatoire pour decimal élève ; défaut 2 dans duel/auteur |
| exclusions | (string\|number)[] optionnel | integer/decimal/choice et graines p,q ; auteur persiste aussi une chaîne |
| choices | string[]\|string | Tableau pour choice ; chaîne '(1,2);(-1,3)' pour tuple |
| expression | string optionnel | computed ; pas d'AST/version/domaine |
| mode | choice\|perfect_square optionnel | perfect_square implémenté pour triplet élève |
| names | string[] optionnel | Longueur 2/3 ; valeurs produites sous ces noms, pas sous name |

Exemples :

```json
[
  {"id":1,"name":"d","type":"decimal","min":0,"max":1,"decimals":2},
  {"id":2,"name":"c","type":"choice","choices":["1/2","3"]},
  {"id":3,"name":"tuple","type":"doublet","mode":"choice","names":["p","q"],"choices":"(1,2);(-1,3)"},
  {"id":4,"name":"square","type":"triplet","mode":"perfect_square","names":["A","B","C"],"min":-4,"max":4,"exclusions":[0]},
  {"id":5,"name":"r","type":"computed","expression":"@A+@C"}
]
```

VariableValues = Record<string,number|string>. Pas de distinction string de prose, expression, rationnel ou choix ; parseFloat introduit une interprétation implicite. NaN/Infinity ne sont pas des valeurs JSON natives : JSON.stringify les transforme en null. Pas de représentation portable d'exactitude ni de chaîne de dépendances.

## Tous les contenus élève déclarés

Chaque élément a `{id:number,type,content}` ; l'union est discriminée à la compilation seulement.

| Type | Champs content exacts | Saisie / rendu actuel |
|---|---|---|
| text | text:string | MathText |
| equation | latex:string ; answerType?:AnswerFormat ; correctAnswer?:string ; requireAnswer?:boolean ; tolerance?:number | Formule, input si requireAnswer ; tolerance non consommée |
| question | question:string ; answerFormat:AnswerFormat ; correctAnswer:string ; points?:number ; hint?:string ; explanation?:string | MathLive + feedback ; points non utilisé pour barème compétence |
| mcq | question:string ; options:{text:string,correct:boolean}[] ; multipleChoice?:boolean ; explanation?:string | Sélection locale ; pas d'ID d'option dans le type élève |
| variation_table | points:{x:string,value:string,variation:'croissante'\|'décroissante'\|''}[] | Tableau déclaratif |
| sign_table | points:{x:string,sign:'+'\|'-'\|'0'\|'\|\|'}[] | Tableau déclaratif |
| graph | xMin/xMax/yMin/yMax:number\|string ; showGrid:boolean ; functions:{color:string,expression:string,showExpression?:boolean}[] | Compilation et canvas ; 'auto' est une chaîne particulière |
| sequence | type:explicit\|recursive ; formula:string ; u0:string ; relation?:string ; reason?:string ; showTerms:boolean ; termsCount:number | Type seulement, non rendu |
| discrete_graph | points?:{n:number,value:number}[] | Type seulement, non rendu |

AnswerFormat = number/text/expression/interval/set/fraction/complex. numeric n'appartient pas à l'union mais est adapté dans EquationRenderer et page duel. Equation n'est pas un AnswerFormat : résoudre et corriger une solution sont des contrats différents.

## Contrats auteur incompatibles avec l'élève

Sources voisines : `utils/defaultContent.js`, `renderers/ElementRenderer.jsx`, `hooks/useExercises.js`, editors. Ces structures sont effectivement proposées par l'outil auteur ; leur présence dans le catalogue publié reste inconnue.

| Type auteur | Champs/modèle par défaut | Écart |
|---|---|---|
| variationTable | variable,function,points:[{x,y,pos:'top'/'bottom'}] | Nom camelCase, y/pos vs value/variation |
| signTable | variable,function,points:[{x,type:'boundary'/'zero'}],signs:string[] | Signes séparés, pas sign par point ; renommer seul ne suffit pas |
| discreteGraph | type:'explicit',formula,numberOfTerms,showGrid,showValues,connectPoints,showLimit | Modèle génératif vs points préévalués ; aucun renderer élève |
| statsTable | headers:string[],rows:string[][] | Absent des types élève |
| probaTree | nodes:[{id,label,isRoot?,parent?,proba?}],showPathProbabilities | Absent élève ; pas de validation de probabilités dans moteur élève |
| vector | dimension:'2D',vectors:[{name,x,y}],showNorm,showCoordinates | Absent élève ; aucune réponse vectorielle |
| complexPlane | points:[{name,re,im}],showGrid,showLabels,showModulus,showArgument | Absent élève ; ne rend pas format complex fonctionnel |
| mcq | options avec id supplémentaire, points | ID perdu par le correcteur élève ; points non déclaré MCQContent |
| equation | type:'simple',latex | Affichage par défaut, pas correction automatique |
| question | answerFormat:'set',correctAnswer:'@x1; @x2',points | Plusieurs solutions ';' ; pas de schéma obligatoire d'ensemble |

Les modèles communs text/graph/question/mcq n'impliquent pas une égalité de grammaire des expressions. Le support d'anciens aliases MCQ par l'aperçu auteur ne doit pas être implicitement promis au renderer élève.

## Interfaces réelles et pertes de données

```ts
// Utilitaires purs actuels
function generateVariables(defs: Variable[]): VariableValues;
function evaluate(expression: string, variables?: VariableValues): number;
function checkAnswer(input: string, expected: string,
  variables: VariableValues, format?: AnswerFormat): boolean;
// Frontière renderer → Loader
onElementSubmit(elementId: number, answer: unknown, isCorrect: boolean): void;
// QCM réduit la sélection à un seul indice dans l'ordre mélangé
onSubmit(selectedIndex: number, isCorrect: boolean): void;
```

ExerciseRenderer ne génère pas si preGeneratedVariables absent : fournit {}. QuestionRenderer envoie un callback seulement au succès ou après maxAttempts erreurs. Loader ne stocke pas la réponse brute de ce callback ; exercise_attempts contient résultat global, exercise_id/user_id et temps null dans le parcours normal. En trackAbandon : INSERT false/is_abandoned=true, UPDATE verdict/is_abandoned=false, ou DELETE au skip. Pas de seed, version, valeurs générées, ordre QCM ni liste de réponses par élément.

Contrats backend `backend/schemas.py` :

```json
{"chapter":"Exemple","last_success":true}
```

```json
{"exercise_id":"1","competence_ids":["competence-exemple"],"is_correct":true,"difficulty":"easy"}
```

`chapter_test_next` n'a ni réponse brute ni ID d'instance ; `ds_submit` reçoit exercise_id mais ne le transmet pas à soumettre_reponse_ds. Sortie recommandation : exercise_id, competence_id/competences, difficulty_level, difficulty, mode ; sortie positionnement final : completed et chapter. Les valeurs de scores sont politiques métier, pas sorties de moteur mathématique.

Duel (`db.ts.ExerciseRow`, `DuelRoom.SubmitAnswerMsg`) :

```ts
// Diffusé aux deux joueurs, solutions comprises dans row.content
{ exercise: ExerciseRow, variables: Record<string, number> }
// Envoyé par le navigateur
{ elementId: number, answer: string, isCorrect: boolean, timeSpent: number }
```

Pas d'exerciseId/instanceId/version/numéro de soumission. currentVariables est numérique seulement. recordAttempt écrit duel_id/player_id/element_id/answer/is_correct/time_spent ; pas d'exercise_id ni snapshot de valeurs dans ce write. timeSpent duel est en millisecondes ; le schéma initial exercise_attempts décrit des secondes, et Loader écrit null. Unifier les unités explicitement, sans changer rétroactivement les historiques.

## Interfaces futures proposées pour discussion

L'objectif est de rendre les erreurs et les frontières reviewables, pas d'engager une implémentation.

```ts
type Diagnostic = { code: string; path: string; message: string };
type Result<T> =
  | { ok: true; value: T; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[] };
type MathValue =
  | { kind: 'rational'; numerator: string; denominator: string }
  | { kind: 'real'; value: number }
  | { kind: 'complex'; re: number; im: number }
  | { kind: 'text'; value: string }
  | { kind: 'infinity'; sign: 1 | -1 };
interface ExerciseInstance {
  instanceId: string;
  definitionId: string;
  definitionVersion: string;
  engineVersion: string;
  seed: string;
  values: Record<string, MathValue>;
  optionOrder: Record<string, string[]>;
}
interface AnswerSubmission {
  instanceId: string;
  elementId: string;
  submissionId: string;
  answer: { kind: 'math' | 'text'; raw: string }
    | { kind: 'mcq'; optionIds: string[] };
}
type Verdict = {
  status: 'correct' | 'incorrect' | 'invalid-input'
    | 'invalid-expected' | 'indeterminate';
  reason: string;
  method?: 'exact' | 'symbolic' | 'numeric';
};
```

API souhaitée : validateDefinition(unknown)→Result<Definition>, normalizeLegacy→Result<Definition>, instantiate(definition,rng)→Result<Instance>, parse(raw,grammar)→Result<AST>, evaluate(ast,scope,limits)→Result<MathValue>, grade(instance,answer,policy)→Verdict, format(value,displayPolicy)→texte/LaTeX, prepareGraph→échantillons/bornes/diagnostics. Les types proposés restent à affiner : complexes avec composantes exactes, expression/AST sérialisable, intervalles/ensembles, domaines et contraintes de forme.

Séparer une vue publique sans solutions/correct des définitions privées serveur. L'instance et ses valeurs doivent être détenues ou certifiées par le serveur ; une seed choisie librement par l'élève ne constitue pas une preuve. La politique contient format, domaine, précision/arrondi, tolérances, forme attendue, variables libres ; les points et nombre d'essais sont une politique pédagogique séparée. Les IDs bigint/UUID/locaux doivent avoir une représentation JSON sans dépassement de Number.MAX_SAFE_INTEGER ; le choix string proposé ne migre aucune donnée ici.
