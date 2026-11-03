# 06 — Feuille de route sans régression

Proposition du 9 octobre 2026 ; aucun lot lancé. Références : [01](current-architecture.md), bugs M01–M24 dans [02](mathematical-correctness.md), tests dans [04](test-coverage-and-regressions.md), cible dans [05](target-architecture.md).

**Dépendances** : L0 → L1 → L2 → L3 → L4 → L5 → L6 ; L7 s'effectue ensuite. L2 peut débuter la préparation transactionnelle pendant L3, sans bascule prématurée. Chaque activation et migration de données nécessite validation du lot concret. Conserver configurations et versions historiques suffisamment longtemps pour rollback, sans réactiver les faux positifs connus pour sauver des chiffres de compatibilité.

## L0 — Corpus, environnement de test et décisions

**Objectif / priorité** : P0, disposer d'une référence mathématique et pédagogique avant changement.

**Périmètre** : `frontend/app/utils/math/*`, `utils/variableGenerator.ts`, tests frontend/duel/backend existants ; modèles et `src/utils/*` de Creator ; lecture catalogue et schéma réel Supabase, sous autorisation et accès adaptés. Ne pas inclure données utilisateurs. Respecter `docs/catalog-sync.md` : pas d'export complet dans Git.

**Actions** : obtenir snapshot lecture seule cohérent ; inventorier types, aliases, réponses, exclusions, computed, domaines implicites, modes éligibles ; sélectionner fixtures anonymisées/rejouables ; conserver hash/version/seed ; transformer sondes M01–M21 en tests de caractérisation et de vérité distincts ; certifier skips/abandon/UI/QCM et barèmes ; rétablir environnement backend supporté sans modifier tests pour réussir. Décider quelles différences sont bugs ou règles.

**Tests** : matrice 04 ; parity Creator/app sur mêmes paramètres ; route/policies/triggers en DB isolée. Aucun stress test lourd en prod.

**Risques** : catalogue inaccessible/incomplet, réponses historiques ambiguës, corpus légalement/publicationnellement restreint, faux positif ancien pris pour oracle.

**Validation** : chaque convention rencontrée représentée, fixtures avec attentes indépendantes et auteur/relecteur, couverture du vrai correcteur, 30 erreurs backend expliquées puis environnement test exploitable. Pas exiger que tous tests de vérité passent sur ancien moteur : ses bugs doivent être visibles.

**Rollback** : aucun changement applicatif ; retrait des seules nouvelles fixtures si corpus mal formé, conserver notes/snapshot privé et résultats d'audit.

## L1 — Contrat v2 et adaptation legacy

**Objectif / priorité** : P0, rendre explicites format, domaine, hypothèses, forme, approximation et politique d'essais.

**Périmètre** : futurs `backend/correction/contracts.py/legacy.py`, types client générés/partagés ; Creator `publishUtils.js/normalizeExercise/defaultContent/QuestionEditor/MCQEditor` ; schéma exercises.content et projection publique.

**Actions** : définir legacy-v1 à partir du catalogue, règles v2, capacités client et aliases conflictuels ; adapter sans modifier les originaux ; introduire IDs stables QCM, IDs DB chaînes, statuts skip/abandon/technique ; avertir/bloquer publication invalide. Définir protocole de validation auteur/preview commun.

**Tests** : roundtrip JSON, versions/unknown fields, lecture métadonnées flags, camel/snake et shapes tables, anciens QCM indices ; policies auteur ; schemas invalides et unsupported type.

**Risques** : champs facultatifs interprétés comme engagements (points/tolerance), renom de types insuffisant, données hors TypeScript.

**Validation** : aucun champ perdu ; une version identifie sans ambiguïté règles et syntaxe ; erreurs auteur explicites ; legacy continue à se charger derrière adaptateur ; décisions pédagogiques actées.

**Rollback** : lecture v1 conservée et v2 désactivable ; aucune réécriture massive ; arrêter publication v2 si clients incompatibles.

## L2 — Instances et transaction de résultats

**Objectif / priorité** : P0, fermer frontière de confiance et rendre les tentatives reproductibles.

**Périmètre** : `ExerciseLoader.tsx.loadExercise/saveExerciseAttempt/updateCompetenceScore`, `variableGenerator.ts`, `backend/routers/ds.py.ds_submit`, `chapter_placement_test.py`, duel `db.ts/DuelRoom.ts` ; futurs instances/service/repository ; tables tentatives et migrations 024/030/041/042.

**Actions** : serveur lie template immuable/version, paramètres, mode/contexte et identité ; graphe computed sûr ; remplacer fallback impossible ; définir submission_id/idempotence ; une transaction finalise et alimente projections de score ; pending/abandon ne comptent pas par INSERT provisoire ; récupérer compétences/difficulté côté serveur ; planifier politiques interdisant writes clients autoritaires et solutions privées.

**Tests** : concurrence, replays, timeouts, rollback SQL, double finalisation, UPDATE/DELETE historiques, erreurs persistance ; génération extrêmes/exclusions et cycles ; temps et bigint.

**Risques** : deux écrivains (client et serveur), triggers doublant récompense, fermeture RLS avant client compatible, CAS encore non prêt.

**Validation** : instance rejouable ; aucune réponse/tentative hors instance ; une attribution maximum ; aucun point pour skip involontaire ; agrégats cohérents DB isolée. Déployer la structure en mode inactif tant que correcteur n'est pas certifié.

**Rollback** : flags et clients compatibles v1 ; stopper nouvelles sessions v2 si transaction défectueuse, conserver instances/tentatives v2. Ne pas revenir à écritures clientes non contrôlées pour duels compétitifs : suspendre ce mode si nécessaire.

## L3 — Noyau sûr et validateurs simples

**Objectif / priorité** : P1, centraliser maths et supprimer calcul dépendant de présentation.

**Périmètre** : futurs parsing/math_engine/validators ; `evaluation.ts` et `Creator/mathExpr.js` comme références ; `Creator/generateRandomValues.js/mathmodules.js` pour grammaire computed à convertir.

**Actions** : langage restreint ASCII/LaTeX ; AST original + représentation de calcul ; whitelist nœuds/fonctions ; substitution AST ; exact rationnel/nombre approché, fraction+forme, texte, QCM ; prototype SymPy contrôlé sur corpus ; erreurs distinctes ; pool borné et tests de budget.

**Tests** : M03–M07/M11–M13/M15/M17–M21 ; opérateurs/priorités/négatifs/virgules/fonctions ; attaques de syntaxe/ressources ; oracle indépendant ; conversions des computed réellement utilisés.

**Risques** : parse_expr non sécurisé, lost form, ambiguïté virgule, nouveau parseur refusant notation publiée.

**Validation** : aucun code libre exécuté ; paramètres/solutions invalides bloqués ; toutes divergences documentées ; résultats non conclusifs explicites ; coût borné.

**Rollback** : moteur v2 en shadow sans effet de score ; désactivation calcul v2, conservation observations. Aucun portage brut new Function en backend.

## L4 — Intervalles, ensembles et expressions sous hypothèses

**Objectif / priorité** : P1, résoudre les risques de faux positifs les plus difficiles.

**Périmètre** : fonctions anciennes `checkExpression/Interval/Set/Fraction` ; futurs validateurs spécialisés et adapter legacy.

**Actions** : grammaires strictes pour ensembles/intervals ; tuples uniquement si besoin confirmé ; expression exacte par familles, conservation domaines initiaux ; implémenter les fonctions usuelles effectivement nécessaires ; required_form séparé ; aucun succès fondé seulement sur points déterministes ; reporter le périmètre non certifiable à undetermined/unsupported avec diagnostic auteur.

**Tests** : M01/M02/M08–M10/M14/M16 ; domaine trou, log/sqrt/powers, plusieurs inconnues, ensembles vides/ordre/duplicats, crochets inversés/infinis/union ; différentiel et propriété.

**Risques** : domaine implicite de legacy, simplification qui annule restrictions, CAS coûteux/indéterminé, extensions non requises.

**Validation** : tests oracle par famille ; aucun faux positif connu accepté ; aucune interprétation produit implicite ; unsupported visible à publication, pas exercice silencieusement modifié.

**Rollback** : garder exercices/domaines originaux ; gate par format/version. Retirer une famille v2 d'éligibilité si bug, pas supprimer ses templates.

## L5 — Shadow et bascule progressive des modes

**Objectif / priorité** : P1, remplacer chemins actifs avec comparaison explicable.

**Périmètre** : Question/Equation/MCQRenderer, Loader, `frontend/app/exercices/page.tsx`, pages DS et duel, `backend/routers/recommendation.py`, `backend/routers/ds.py`, `DuelRoom.ts` ; Creator validation/preview.

**Actions** : shadow sans double écriture ; collecter divergences par type/instance/version avec minimisation données ; activer d'abord nombre/text/QCM puis fraction/interval/set puis expression. Par mode : pratique limitée → positionnement/DS → duel, avec protection duel traitée en priorité dès noyau certifié. Nouvel auteur publie seulement les capacités certifiées ; Creator preview appelle moteur partagé ; frontend consomme verdicts/remaining_attempts et feedback.

**Tests** : E2E de chaque mode, first wrong/second correct, hints, skip/abandon, stale response duel, multiquestion, retries réseau, confidentialité expected, conflits métadonnées ; charge par famille.

**Risques** : changement de comportement historique légitime, latence duel, certains faux positifs devenant refus et variation des statistiques.

**Validation** : zéro divergence non classifiée dans corpus ; écarts autorisés référencés ; aucune double attribution ; seuils de perf mesurés ; clients et auteurs comprennent les erreurs. Une équipe pédagogique signe les différences de forme/domaine/essais avant activation.

**Rollback** : flags par type/mode/version ; cesser nouvelles instances de famille affectée ; terminer/suspendre existantes avec leur version ; garder journaux d'explication. Bugs mathématiques corrigés ne sont pas réintroduits silencieusement.

## L6 — Migration volontaire du catalogue et des historiques

**Objectif / priorité** : P2, expliciter règles des exercices publiés et projections cohérentes.

**Périmètre** : exercises.content versions, instances/attempts, contraintes/RLS et fonctions SQL ; données catalogue en lots identifiés, sans toucher inutilement historique personnel.

**Actions** : simuler conversion offline ; sauvegarde/snapshot ; chaque changement de règle produit une nouvelle version ; computed JS remplacé par opérations whitelisted, pas regex générale ; convertir camelCase et tables avec structure ; corriger solutions erronées avec révision pédagogique ; réconcilier agrégats seulement selon plan de reprise validé.

**Tests** : dry-run, counts/hashes et conservation flags/champs/IDs ; oracle sur paramètres ; snapshots privés ; foreign keys/rollback ; exercice édité n'altère pas tentative liée à ancienne version.

**Risques** : changements irréversibles de contenu et récompenses, manque de variables dans historiques anciens empêchant rejouer leur correction, absence de schéma prod complet dans migrations.

**Validation** : zéro changement mathématique silencieux ; traçabilité avant/après, sauvegarde testée ; schéma réel introspecté ; aucune prétention de recalcul historique sans données disponibles.

**Rollback** : annuler lot par versions/snapshot et transaction ; conserver nouvelles tentatives immuables ; reprise de projections idempotente. Ne pas restaurer DB entière au détriment des tentatives récentes.

## L7 — Retrait et simplification

**Objectif / priorité** : P2, supprimer doublons uniquement après retrait des consommateurs.

**Périmètre** : ancien correcteur evaluation.ts (conserver utilitaires nécessaires graph/rendu), générateurs historiques, `computeCorrectAnswer`, écritures directes scores, fonctions candidates sans appel ; document ARCHITECTURE et consignes.

**Actions** : vérifier imports/build/code externe ; supprimer chemins autoritaires clients et doubles producteurs ; conserver archive privée corpus/versions ; revoir coverage pour ne pas oublier moteur ; simplifier hooks UI seulement maintenant.

**Tests** : suites ciblées et build, contrats mobile/Creator, corpus et E2E modes ; anciennes versions encore rejouables selon durée de conservation décidée.

**Risques** : suppression prématurée d'adaptateur legacy ; casser graphes en supprimant evaluate ; clients non mis à jour.

**Validation** : aucun appel ancien en télémétrie/imports ; période de surveillance définie ; rollback testé ; aucun ancien verdict client accepté.

**Rollback** : restauration du module supprimé via commit dédié, sans réactiver autorité client ; versions moteur et contrat conservées pour instances historiques.

## Données à prévoir, sans migration exécutée

Proposer explicitement template_version/correction_version, instance_id + paramètres exacts/seed + snapshot/hash, réponses par élément + original/form verdict/reason, submission_id unique, statut terminal et mode. Éviter nouveaux champs partout avant contrat validé. Choix de stockage JSONB pour snapshot possible ; vérifier coûts/droits/rétention.

Historiques actuels pratique ne contiennent pas réponse brute/variables : impossible de reconstruire la vérité des tentatives anciennes. Ne pas recalculer les anciens verdicts à partir d'un nouveau tirage. La reprise des classements est une décision distincte de la correction prospective.

**Premier lot recommandé : L0 uniquement.** Son livrable est le corpus certifié, les tests de référence et les décisions produit ; cet audit n'a pas lancé sa mise en œuvre.
