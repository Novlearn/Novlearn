# 04 — Tests, reproductions et non-régression

Audit du 9 octobre 2026, révision Novlearn `907fb09`. Les commandes suivantes ont été exécutées, sans installer de dépendances ni modifier les tests. Aucun test sur service Supabase réel n'a été lancé. Aucune mesure de couverture en pourcentage n'a été produite.

## Résultats des suites existantes

| Répertoire / commande exacte | Résultat observé | Limites |
|---|---|---|
| frontend : `npm.cmd test -- --reporter=dot` | Code 0 ; **82 tests**, 3 fichiers passent | Vitest 2.1.9 ; 28 competenceScore, 24 exerciseUtils, 30 api ; pas de correction mathématique |
| duel-server : même commande | Code 0 ; **57 tests**, 2 fichiers passent | 24 db, 33 DuelState ; Supabase mocké ; pas de vrai duel réseau |
| backend : `$env:PYTHONDONTWRITEBYTECODE='1'; python -m pytest -p no:cacheprovider` | Code 1 ; **150 passent, 30 erreurs d'initialisation**, 180 collectés | Python global 3.12.10 ; pas de .venv locale ; erreurs test_api et test_auth |
| racine : `npm.cmd run test:catalog-sync` | Code 0 ; **7 tests passent** | PostgreSQL embarqué PGlite ; préservation JSON/bigint et rollback, pas grammaire/correction |
| Creator | Aucun runner dans package.json et aucun fichier de test découvert | Pas de suite exécutée ; absence de tests automatisés de maths observée |

Backend : import Supabase → storage3 → pyiceberg → mmh3 échoue : **ImportError: DLL load failed while importing mmh3: une stratégie de contrôle d'application a bloqué ce fichier**. Ce résultat est une limite de l'environnement local, pas 30 bugs applicatifs démontrés. Les dépendances n'ont pas été modifiées pour le contourner. Avertissements observés : portée de boucle pytest_asyncio non définie, alias AnyIO obsolète ; Vitest signale API Node CJS Vite obsolète.

Le lancement standard sandbox échouait avant création du processus (helper setup refresh) ; les lectures/tests ont été exécutés avec le mécanisme d'escalade autorisé. Aucun rejet d'approbation n'est intervenu.

## Couverture réelle observée

- `frontend/__tests__/lib/competenceScore.test.ts` : bonus, plafonnement et aliases de difficulté. `exerciseUtils.test.ts` : mapping. `api.test.ts` : contrats HTTP/mocks, pas vérité d'une réponse.
- `frontend/vitest.config.ts` : coverage.include limité à **app/lib/**/*.ts** ; exclut donc utils/math, variableGenerator et renderers. Un bon taux dans cette configuration ne signifie pas bonne couverture du correcteur.
- `duel-server/src/__tests__/db.test.ts` : appels Supabase mockés et génération simple. `DuelState.test.ts` : état et logique de scoring dont une simulation locale recopie le principe ; ne valide pas `DuelRoom.handleSubmitAnswer` dans une room réelle.
- `backend/tests/test_chapter_placement.py` : tri, barème et sélection ; `test_ds.py/test_ds_recommendation.py` : points/streak/recommandation ; `test_recommandation.py/test_streak.py/test_chapter_selection.py` : algorithmes. `test_notifications.py` : fonctions hors moteur. API/Auth bloqués par imports.
- Fixtures : `backend/tests/helpers.py.make_supabase`, `conftest.py.make_sb`, fixtures inline de frontend/duel ; `scripts/sync-catalog.test.mjs` utilise JSON synthétiques volontairement minimaux, pas exercices publiés complets.
- Pas de suite persistante découverte pour equivalence, parsing LaTeX, domains, generation riche, feedback React, publication/consommation Creator ↔ élève, triggers SQL d'abandon, idempotence, courses ou workload coûteux.
- `../Novlearn Creator/src/utils/defaultContent.js` fournit des **modèles**, pas un corpus attesté du catalogue réel. Aucune migration d'insertion d'exercices mathématiques complets découverte dans le dépôt.

## Sondes exécutées sur les vrais modules

Le harnais a transpillé TypeScript/ESM en mémoire avec TypeScript installé **5.9.3**, puis chargé les modules et mathjs **15.1.1** sans écrire de fichier. Il ne remplace aucune fonction métier. Son `new Function` charge **du code source local connu**, pas une expression de l'élève ; il ne fait pas partie du moteur applicatif.

Reproduction PowerShell depuis la racine (extrait autonome représentatif des sondes réellement effectuées) :

```powershell
@'
const fs = require('fs');
const path = require('path');
const ts = require('./frontend/node_modules/typescript');
const Module = require('module');
const cache = new Map();
function load(p) {
  p = path.resolve(p);
  if (cache.has(p)) return cache.get(p).exports;
  const m = {exports:{}};
  cache.set(p, m);
  const req = Module.createRequire(p);
  const js = ts.transpileModule(fs.readFileSync(p,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
  }).outputText;
  new Function('require','module','exports',js)(
    s => s.startsWith('.')
      ? load(path.resolve(path.dirname(p),s) + (p.endsWith('.js') ? '.js' : '.ts'))
      : req(s), m, m.exports);
  return m.exports;
}
const e = load('frontend/app/utils/math/evaluation.ts');
const p = load('frontend/app/utils/math/parsing.ts');
const g = load('frontend/app/utils/variableGenerator.ts');
for (const [u,a,f] of [
  ['1/2','0.5','number'],
  ['2(x+1)','2x+2','expression'],
  ['x^2-1','(x-1)(x+1)','expression'],
  ['sqrt(8)','2sqrt(2)','number'],
  ['sin(x)^2+cos(x)^2','1','expression'],
  ['x+t','x+1','expression'],
  ['(x-1)/(x-1)','1','expression'],
  ['1/0','1/0','expression'],
  ['1/0','Infinity','number'],
  ['a1;2b','[1;2]','interval'],
  ['{2}','2','set'],
  ['\\emptyset','{}','set'],
  ['\\{2;1\\}','{1;2}','set'],
  ['\\left|-2\\right|','2','number'],
  ['x\u00b2-1','(x-1)(x+1)','expression'],
  ['true','1','number']
]) console.log(JSON.stringify({u,a,f,result:e.checkAnswer(u,a,{},f)}));
console.log(e.evaluate('@a^2',{a:-2}));
console.log(p.substituteVariables('@a',{a:'1/2'}));
console.log(e.evaluate('max(1,2)',{}));
console.log(g.generateVariables([
  {id:1,name:'a',type:'integer',min:0,max:0,exclusions:[0]}
]));
'@ | node
```

Échapper Unicode en \u00b2 a été nécessaire pour éliminer une première dégradation de transport PowerShell (première sortie x?-1) : seul le second résultat x² correctement transmis est retenu.

Sondes complémentaires exécutées : absence de y libre ; scientific 1e3 ; espace LaTeX 1\\,2 ; sqrt avec frac imbriquée ; complex 1+i vs i+1 ; number a=2/y=2 ; paramètres négatifs ; set non ordonné ; tolérance 0.3333 vs 1/3 ; génération computed root1 comparée Creator/app ; Creator solve sans racine et ordre root1/root2 pour a<0. Résultats détaillés et conditions dans [02](mathematical-correctness.md), M01–M21. Les chemins UI M22–M24 sont **analyses statiques**, pas E2E exécutés.

## Matrice de référence à automatiser

**P** : sonde exécutée seulement ; **U** : test unitaire existant indirect ; **N** : pas de test trouvé. Toutes les lignes P restent à ajouter à une suite versionnée ; leurs verdicts futurs sont à faire valider pédagogiquement.

| Scénario / exemples | Attendu futur | Décision pédagogique / couverture actuelle |
|---|---|---|
| Exact : 4 face à 4 ; QCM bonnes options | correct | P pour constantes ; QCM N |
| Équivalence numérique : 1/2 et 0.5 ; sqrt(8) et 2sqrt(2) | correct si valeur libre | P ; forme de fraction à décider |
| Identités : développement, factorisation, trigonométrie | correct dans famille/domaines déclarés | P ; pas preuve actuelle |
| Autre notation : ², scientifique, frac imbriquée, absolu MathLive | correct ou syntax_error explicite si non supporté | P refus actuel ; alignement avec clavier nécessaire |
| Proche : 1.00009, 0.3333 | selon exact/tolerance/digits | P ; pas tolerance par exercice |
| Incorrect : 2x+3 face à 2x+2 ; x+t face à x+1 | incorrect | P faux positif seconde expression |
| Collision d'échantillons : produit des (x-v) sur liste de tests face à 0 | incorrect ou undetermined, jamais preuve par sondes seules | N ; fixture adverse à créer |
| Invalide : x+, accolades non fermées, a1;2b | syntax_error, aucun point | P interval accepté ; autres N |
| Vide / espaces | empty, aucun point et politique d'essai explicite | garde statique checkAnswer/UI ; N automatisé |
| Indéfini : 1/0, sqrt(-1), ln(0) en réels | domain_error, ou interdit selon type | P 1/0 accepté ; autres N |
| Hypothèses : sqrt(x)^2=x ; sqrt(x²)=x ; trou (x-1)/(x-1) | domaine x>=0 / x!=1 explicite ; pas identité sur R | P partiel ; choisir domaine prescrit |
| Infini / limites : +inf, -inf, Infinity | symboles autorisés seulement ; ne pas convertir 1/0 en limite | P ; convention à fixer |
| Ensemble vide/singleton/ordre/doublons | même ensemble indépendamment ordre ; syntaxe stable | P bugs vide/singleton/LaTeX |
| Intervalles : crochets ouverts/fermés, a>b, borne infinie fermée, union | syntax/domain_error ou validateur spécialisé explicite | P invalidité chars ; autres N |
| Fraction irréductible : 2/4, 1/2, 0.5 | valeur égale ; forme évaluée séparément si exigée | P décimal accepté ; règle produit |
| Complexes : 1+i, i+1 ; formes polaires | correct si type réellement implémenté ; sinon unsupported | P faux négatif ; pas d'extension implicite |
| Multivarié : x+y, x+t, noms hors whitelist | comparaison sur toutes inconnues autorisées | P pour t et y |
| Paramètres négatifs/fractions/5+ décimales | substitution exacte, énoncé cohérent | P ; N corpus réel |
| Génération impossible/cycle/unresolved/dynamic exclusions | invalid_exercise, pas fallback interdit | P impossible/computed absent ; autres N |
| Calcul auteur : solve sans racine, root1 a<0, a=0 | résultat certifié ou erreur ; convention ordre | P partiel |
| Entrée dangereuse : affectations, accès attributs, fonction non autorisée | syntax_error / forbidden, aucun effet | P affectation/bool ; N attaques lourdes |
| Ressources : profondeur/taille/exposants énormes | resource_limit/timeout, aucune récompense | N ; ne pas lancer un stress test sans limites |
| 1er faux puis 2e correct / hints | résultat selon mode, trace des essais | N ; statut actuel terminal peut être correct |
| QCM multiple : options mélangées, ensembles d'IDs | toutes selections préservées et validation serveur | N |
| Passer/abandon/succès final | statuts distincts ; barème et historique cohérents | N ; bug statique M22/M24 |
| Duel : faux booléen vrai, stale instance, 2 questions | client ignoré, instance contrôlée, succès complet | N ; bug statique M23 |
| Concurrence/retry/idempotence de score | une seule attribution, pas de perte par course | N ; mocks ne certifient pas transactions |
| Legacy : alias answer/numeric, QCM indices, types camelCase, computed JS | adapter ou bloquer publication avec diagnostic | N ; sources code Creator/duel |

## Corpus existant et oracle indépendant

Premier travail : export **autorisé en lecture seule**, restreint au catalogue et métadonnées utiles. Le guide `docs/catalog-sync.md` déconseille publier un export catalogue dans Git : conserver corpus privé, dériver fixtures minimales anonymisées sous droits adaptés. Ne pas inclure profiles/historiques personnels.

Pour chaque exercice/version : structure originale et hash, mode éligible, seed/valeurs figées, énoncé instancié, attendu original, format/règles/domaines/hypothèses, réponses acceptées et refusées, notes enseignant, classement regression/bug/règle/ambiguïté. Inclure extrêmes des paramètres, signes, zéros et exclusions ; toute convention observée au moins une fois. Conserver un corpus de compatibilité JSON et un corpus de vérité mathématique distincts.

L'ancien moteur est **une observation**, pas un oracle. Les exemples M01–M24 doivent avoir une vérité attendue revue par un enseignant. Une comparaison indépendante peut utiliser des constructions SymPy contrôlées ou calcul exact rationnel/polynomial, jamais le même parseur regex en guise de deuxième implémentation.

Stratégie :
1. Tests paramétrés par format et instance legacy ; fixtures publiques minimales sans export complet.
2. Propriétés : commutativité rationnelle, développement contrôlé, ordre/dédoublonnage de sets, préservation AST sous substitution et roundtrip publication. Générateurs bornés et seeds fixes.
3. Differential ancien/futur : enregistrer ancien verdict, futur verdict, oracle, cause, version ; accepter les écarts seulement avec décision référencée.
4. Intégration DB isolée : politiques, transactions, triggers, transitions pending→final, rollback et idempotence.
5. E2E peu nombreux mais représentatifs : pratique, second essai, DS skip, positionnement, duel stale/multi-question, Creator publication/preview.
6. Performance et sécurité : longueur/profondeur, timeout processus, taille des intermédiaires ; aucun test lourd sur production.
7. CI : inclure utils/math, générateur et service de correction ; test room réelle au lieu d'une copie de scoring ; ne pas transformer un échec d'import en succès en modifiant les tests.

Critère de sortie : catalogue classifié, cas confirmés automatisés, divergences expliquées, pas d'augmentation silencieuse des réponses fausses acceptées, modes et règles pédagogiques validés.
