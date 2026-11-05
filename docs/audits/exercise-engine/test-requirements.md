# Tests requis avant migration

Audit du 9 octobre 2026. Révision `907fb09` + tests/configurations déjà modifiés ou non suivis au début de l'audit. Aucun test ni code applicatif ajouté par cet audit ; les cinq documents sont les seuls livrables créés. Le sandbox local ne démarrait pas : lectures et tests locaux exécutés avec escalade autorisée. Aucun accès à production, migration ou export du catalogue.

## Vérifications réellement exécutées

| Commande / contexte | Résultat | Ce que cela atteste |
|---|---|---|
| frontend : npm test -- --reporter=dot | 8 fichiers ; 174 passed, 9 todo (183 cas) | Includes défauts attendus via it.fails ; pas une certification de justesse |
| duel-server : npm test -- --reporter=dot | 3 fichiers ; 63 passed | Transport/persistance simulés, handler réel pour L0 |
| racine : node scripts/correction-backend-tests.mjs | 180 passed, 6 warnings de dépréciation | Python local 3.12.14, Supabase/configuration factices ; pas de backend de production |
| node --test scripts/correction-catalog.test.mjs scripts/correction-triggers.test.mjs scripts/sync-catalog.test.mjs | 14 passed | 4 catalogue/config, 3 triggers SQL et 7 sync ; SQL en PGlite mémoire ; pas de copie distante |
| Sonde node en mémoire par transpileModule TypeScript | Cas listés ci-dessous | Charge fonctions actuelles, sans créer de fichier source ni utiliser le catalogue |

Les exécutions n'ont pas installé de dépendances, lancé de serveur applicatif ou fait de build/déploiement. Les résultats de couverture chiffrés n'ont pas été générés pendant cet audit. Les tests Vitest peuvent créer leur cache local ; ce n'est pas une modification applicative. Des warnings Vite CJS et de dépendances Python ont été observés, sans échec de tests.

Sonde locale : evaluate('@a',{a:0.123456789})=0.1235 ; expression garbage=garbage acceptée ; text/complex @a non substitué ; x+t=x+1 accepté ; intervalle fermé en -Infinity accepté ; fraction 2/4 acceptée face à 1/2 ; produit des douze facteurs d'échantillons accepté face à zéro ; chaîne computed inverse de onze variables résout seulement v0..v9. Ces sondes ne constituent pas de nouveaux tests permanents.

## Couverture existante et limites

| Fichiers | Comportements couverts | Ce qui n'est pas prouvé |
|---|---|---|
| frontend/__tests__/lib/competenceScore.test.ts | 28 cas bonus, plafonds, difficultés | Écriture atomique, concurrence, double application |
| lib/exerciseUtils.test.ts | 24 cas mapping difficulté | Adaptation effective des rows au Loader |
| lib/api.test.ts | 30 cas wrapper/requêtes avec mocks | Vérité du verdict transmis ou endpoint réel |
| correction-l0.test.ts + fixtures/correction-reference.json | 35 observations + références proposées, 77 paires de fractions et 20 distributivités, virgule max | Oracle humain encore pending ; certaines règles référence=null ; it.fails réussit quand le défaut se reproduit |
| variable-generator-l0.test.ts | 8 cas dont 1 todo : tape déterministe, exclusions/fallback/legacy, dépendance manquante | Distribution, toutes arités/contraintes, cycles, chaîne >10, validité bornes/noms |
| renderers-l0.test.tsx | 6 cas : deux essais, vide, equation sans attendu, QCM multiple | MathLive/MathText/audio mockés ; pas de rendu visuel ni reset interexercices |
| exercise-loader-l0.test.tsx | 5 cas : skip/abandon/update/finalisation normale | Renderer et Supabase mockés ; points/non-atomicité/retry/multiquestion/réseau |
| creator-parity-l0.test.ts | 8 cas sur checkout voisin réel : bases, négatif, max, computed, root/ln, solve | Suite skip si voisin absent ; pas toutes fonctions/syntaxes ou catalogue publié |
| duel-server/src/__tests__/DuelState.test.ts | 33 cas état/schema | Cycle de match et races |
| duel-server/src/__tests__/db.test.ts | 24 cas DB/auth/tirages simples, mocks | Exclusions/computed (absents), schéma Supabase réel, erreurs de write retournées |
| rooms/__tests__/DuelRoom.l0.test.ts | 6 cas handler : booléen forgé, ID inconnu, multiquestion, doublon, phase, false | Flux join/ready/timeouts/skip/grâce/finish/réseau réel |
| backend/tests/test_chapter_placement.py | Tri/barème/choix/statut | Fin complète/reprise/idempotence d'une soumission certifiée |
| test_recommandation/test_chapter_selection/test_streak/test_ds/test_ds_recommendation | Helpers et algorithmes avec données simulées | Évaluation mathématique (aucune dans backend actuel), historique de production |
| scripts/correction-triggers.test.mjs | Définitions SQL réelles 024/030/041 sur schéma minimal ; INSERT/UPDATE/DELETE | Migrations complètes, RLS, ordre de triggers et version déployée |
| scripts/correction-catalog.test.mjs et sync-catalog.test.mjs | Normalisation inventaire et copies en mémoire | Aucune occurrence réelle des anciens formats |

Aucun test dédié de GraphRenderer, SignTableRenderer, VariationTableRenderer, segmentation/substitution générale, MathInput/KaTeX dans un navigateur ou simplification complète identifié dans les suites présentes. Les branches de ces utilitaires traversées indirectement ne constituent pas une spécification exhaustive.

## Matrice de tests à compléter

P0 = requis avant toute migration d'un chemin de correction ; P1 = requis avant annoncer la capacité concernée ; P2 = qualité/extension. Les futurs tests doivent séparer **caractérisation actuelle**, **oracle mathématique validé** et **décisions pédagogiques**, pour ne pas transformer un bug reproduit en exigence.

| Priorité / fonction | Entrées/cas indispensables | Assertion utile |
|---|---|---|
| P0 contrats runtime | JSON absent/malformé, unknown type/format, null, doublons IDs/noms, mauvais types | Diagnostic avec path ; jamais cast silencieux ou publication d'un attendu invalide |
| P0 normalisation | DB/auteur/élève/duel ; numeric, answer, variableDefinitions, appTitle ; flags ; camel/snake et structures tableaux | Round-trip sans perte, alias explicites, rejet de conflit, version fixe ; renommage structurel testé |
| P0 génération | Bornes inclusives, min=max, inversées/non entières/non finies, précision négative/excessive | Valeurs satisfaisant contrat ; rejet définitions invalides |
| P0 exclusions | Numériques, dynamiques précédentes/futures/computed, legacy strings, toutes exclues, proximité seuil | Aucune valeur interdite ; diagnostic impossible ; règles d'ordre indépendantes si promises |
| P0 choix/tuples | Liste vide, texte/rationnels, arité 2/3, caractères parasites, collisions names | Type de valeur conservé, tuples complets ; aucun parseFloat tronqué |
| P0 computed | Ordre direct/inverse, 11+ dépendances, diamant, cycle, manquant, écrasement, domaine invalide | Graphe correct, un calcul par nœud, erreur explicite, pas d'instance partielle utilisée |
| P0 déterminisme | Seed/tape identique navigateur/Node/auteur, ordre QCM, valeurs computed | Replay bit-identique selon version ; RNG injecté ; pas Math.random caché |
| P0 substitution calcul | -2 au carré, 1/2, haute précision, @a/@alpha/@a_b, @@, {a}, noms illégaux | Calcul conserve valeur/priorités ; aucun nettoyage de prose ni arrondi |
| P0 parser | Virgule française vs arguments, exposant signé/scientifique, fractions/racines imbriquées, abs, Unicode, fonctions | AST et résultat attendus ; token invalide localisé ; pas de langage ambigu implicite |
| P0 types résultats | true, affectation, matrice, objet, complexe, NaN, ±Infinity, dépassements | Types autorisés seulement ; invalid/domaine/non-fini distingués |
| P0 number/tolérance | Valeurs proches autour 1e-4, 0, grands/petits nombres, infini, précision attendue | Politique absolue/relative/arrondi explicitement choisie ; aucune dépendance au format d'affichage |
| P0 expression | Identités polynomiales, différences minuscules, y/z, x+t, polynomial d'annulation, domaines disjoints/trous | Pas de faux positif de la grille connue ; invalid attendu distinct ; preuve ou indeterminate |
| P0 interval | Toutes ouvertures, semicolon/décimales, fractions aux bornes, malformé, ordre, infini, singleton/vide | Validation complète ; unions si capacité retenue ; conventions non-françaises déclarées |
| P0 set | Vide/singleton/multiple, ordre/doublons/quasi-doublons, accolades MathLive, préfixes, non-finis | Routage indépendant de ';' dans attendu ; cardinalité/comparaison cohérentes |
| P0 fraction | Signes, dénominateur nul, fractions imbriquées, décimal, 2/4, numérateurs non entiers | Valeur vs forme imposée distinctes ; rationalité exacte si promise |
| P0 complex | 1+i/i+1, produit, conjugaison, @paramètre, parties nulles, formes polaires | Équivalence réelle/imaginaire, tolérance/domaine/argument spécifiés |
| P0 QCM | Simple/multiple, aucune/toutes bonnes, sélection incomplète/fausse, IDs après shuffle | IDs stables et sélection complète ; schéma invalide rejeté ; replay sûr |
| P0 contrats renderer | Vide, 1/2/999 essais, faux puis vrai, reset props/exercice, IDs répétés | Chaque tentative brute traçable ; résultat terminal distinct ; attendu absent jamais succès |
| P0 agrégation | Plusieurs questions, equation sans réponse, aucun élément répondable, ID inconnu/dupliqué | Achèvement selon éléments attendus ; statut correct/incorrect/incomplet/skip/abandon/timeout |
| P0 intégrité duel | isCorrect forgé, mauvais instanceId/ID, message retardé/rejoué, payload mal typé | Serveur recalcule verdict pour instance détenue ; aucun point non mérité ; erreur sûre |
| P0 timers duel | Deux ready, deux solveurs, grâce, skip simultané, timeout/finish pendant load, déconnexion | Une transition/instance, score idempotent, aucune relance après fin |
| P0 persistance/scoring | INSERT pending→UPDATE final, DELETE skip, retries/doublons, erreur Supabase comme valeur | Une tentative finale/transaction, agrégats compensés ou non incrémentés avant final ; diagnostic d'échec |
| P0 APIs métier | Skip/incomplet au positionnement et DS, succès après second essai, mauvais exercice/compétences/difficulté | Revalidation d'instance, barème mode correct ; jamais confiance au booléen client seul |
| P1 fonctions auteur | Chaque helper : a=0/delta<0, racines triées, PGCD/PPCM signe/0/non-entier, primalité, round, solve/derive | Domaine/arité ; résidu/convergence pour solve ; erreur dérivée connue ; absence de new Function dans cœur |
| P1 graphes | Bornes statiques/dynamiques/auto/inversées, ln/sqrt/tan/1/x, discontinuités, fonction invalide | Cohérence moteur/échantillons ; diagnostics distincts d'auto ; aucun trait trompeur dans captures |
| P1 présentation | Prose avec 1 lettre, zéro, $, échappements, solution négative/fraction/ensemble/fonctions | Aucun texte altéré ; LaTeX cohérent avec valeur ; simplification ne change pas sémantique |
| P1 runtime UI | Vrai MathLive→LaTeX→moteur, KaTeX chargé/retard/absent, SSR, clavier/accessibilité | Saisies réelles acceptées selon contrat ; cleanup timers ; rendu vérifié visuellement |
| P1 barèmes | Pratique bonus/streak/max ; positionnement int(10/20/30% max) ; DS 1/2/3 et ±1 ; duel 1 | Maintenir politiques distinctes ; toutes difficultés normalisées ; aucune double attribution |
| P1 suites/types auteur | Explicit/recursive/u0/n initial, arité/axes vecteurs, probabilités, stats, tableaux | À exécuter seulement si capacité v1 retenue ; aucun support annoncé sans tests et renderer |
| P1 compatibilité catalogue | Copie locale autorisée, validation sans évaluer code auteur arbitraire, seed par définition | Rapport d'occurrences incompatibles ; différences classifiées et revue pédagogique ; production jamais utilisée comme runner |
| P1 ressources | Longueur/profondeur, grosses puissances/listes, beaucoup de fonctions/variables | Calcul borné et interruption, pas de blocage UI/service ; diagnostics déterministes |
| P2 qualité package | Import Node/navigateur, bundle/import pur, sérialisation, backward compatibility | Pas de React/DOM/réseau/secrets au chargement ; changements de version identifiés |

## Méthode de validation de référence

Construire une référence indépendante du correcteur actuel : résultats exacts rationnels, identités démontrées et contre-exemples explicites ; revue humaine mathématique/pédagogique avant d'en faire un oracle. Les snapshots de verdicts actuels et it.fails servent à rendre les changements visibles, pas à valider une convention.

Tests de propriétés utiles : chaque tirage satisfait toutes ses contraintes ; inversion du signe deux fois ; normalisation idempotente ; fraction multipliée numérateur/dénominateur par même entier non nul ; permutation d'ensemble et options sans changer verdict ; distributivité avec coefficients indépendants ; absence de perte de valeurs lors de sérialisation/replay. Ne pas tester uniquement l'implémentation avec une seconde copie de la même formule.

Fuzzing ciblé : grammaire/parsing/normalisation, profondeur bornée, tokens invalides, dépendances cycliques, tuples malformés. Chaque échec doit devenir une petite fixture expliquée. Le benchmark doit mesurer compilation, génération et correction séparément dans Node et navigateur, avec un budget défini ensemble.

## Critères de passage, sans migration engagée

- Toutes les capacités annoncées disposent de tests d'acceptation par format, d'une grammaire et d'un contrat d'erreur.
- Chaque B01–B24 du [registre de risques](extraction-risks.md) est caractérisé et classé : correction volontaire, politique à décider ou responsabilité hors moteur.
- Aucun bug connu n'est certifié par un simple rapport « tests verts » ; les expected failures et todo restent visibles jusqu'à résolution/revue.
- Un même template/version/seed produit une même instance et un même verdict chez chaque consommateur autorisé ; différences historiques expliquées.
- Les tests d'intégration couvrent l'autorité serveur, la cohérence tentative/score et les transitions ; la pureté du moteur ne dispense pas de ces tests.
- Catalogue et schéma déployés restent non vérifiés à ce stade. Tout futur test staging ou inventaire distant nécessite un périmètre séparé ; cet audit ne lance aucune opération de ce type.
