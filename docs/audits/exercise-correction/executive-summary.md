# 07 — Synthèse exécutive

Audit du 9 octobre 2026, dépôt Novlearn `907fb09` et code accessible `../Novlearn Creator/`. Sept documents d'audit ; aucune refactorisation, migration, dépendance ou donnée distante modifiée.

## Diagnostic

Le système couvre les réponses usuelles via un correcteur navigateur, mais **ne garantit ni équivalence mathématique ni intégrité des résultats**. L'évaluation de valeurs simples est utile ; les expressions sont comparées par texte/points numériques, sans domaine contractuel. Creator, élève et duel instancient différemment les mêmes templates. La note de migration est **risque élevé avant corpus et contrats**, réductible par bascule type/mode/version après tests indépendants.

Le catalogue et le schéma Supabase effectivement déployé n'ont pas été consultés : impact en production et fréquence des formats hérités restent à quantifier. Creator a été lu dans le dossier voisin ; son preview ne certifie pas la correction élève.

## Cinq problèmes prioritaires

| Problème / preuve | Gravité | Conséquence et action rentable |
|---|---|---|
| Verdict client fait autorité : `duel-server/src/rooms/DuelRoom.ts.handleSubmitAnswer`, `backend/routers/ds.py.ds_submit`, `backend/chapter_placement_test.py.get_next_test_exercise`, `frontend/app/components/Exercise/ExerciseLoader.tsx` | Critique | Points sans preuve ; réponses attendues téléchargées ; créer instances et correction serveur, écritures idempotentes |
| Équivalence sans domaine : `frontend/app/utils/math/evaluation.ts.checkExpression` | Critique | x+t accepté comme x+1 ; trou de définition ignoré ; validateurs exacts par familles/domaines, résultat indéterminé explicite |
| Substitution/normalisation altèrent maths : `parsing.ts.substituteVariables`, `formatting.ts.formatValue`, `evaluation.ts.toMathJsSyntax` | Élevée | a=-2 donne @a²=-4 ; '1/2' devient 1 ; max(1,2)=1.2 ; séparer calcul AST et affichage |
| Trois contrats divergents : `variableGenerator.ts`, `duel-server/src/db.ts.generateVariables`, `Creator/src/utils/generateRandomValues.js/mathmodules.js/defaultContent.js` | Élevée | computed root1 absent chez élève ; types camelCase non rendus ; moteur/contrat auteur partagés, adapteurs legacy |
| Skip/abandon/score incohérents : `ExerciseLoader.tsx`, pages exercices/DS, migrations `024/030/041/042` | Élevée | Passer peut transmettre succès ; UPDATE final n'annule pas effets du false initial ; événements terminaux et transaction cohérente |

Bugs confirmés par sondes : [02](mathematical-correctness.md) M01–M21. Routes/SQL/skip : constats statiques M22–M24 ; effets production à confirmer. Ne pas préserver un faux positif pour obtenir zéro divergence.

## Tests et dette

**82 frontend + 57 duel + 7 catalogue passent**. Backend : **150 passent, 30 erreurs d'initialisation**, DLL mmh3 bloquée localement. Aucune suite mathématique existante découverte ; couverture frontend exclut utils/math. Ces succès ne certifient pas moteur.

Doublons dominants : génération, substitution, parseurs, normalisation et conventions de réponse. Les barèmes de pratique, DS, placement et duel ont des finalités distinctes : partager mécanique/contrat, conserver politiques explicites. Détails : [03](duplications-and-debt.md) et [04](test-coverage-and-regressions.md).

## Recommandation et priorités

Un moteur dans FastAPI existant, registre simple de validateurs, instances reproductibles et résultat structuré. SymPy est un **candidat** pour calcul exact/symbolique contrôlé, après prototype sur corpus ; pas parse_expr libre ni CAS universel. Les frontends saisissent/rendent ; Creator valide/preview avec même service ; Colyseus garde temps/déroulement et vérifie instance active. Architecture et comparaison officielle des outils dans [05](target-architecture.md).

Ordre de travail :
1. Corpus et décisions, environnement tests exploitable.
2. Contrat v2 + adaptation historique sans perdre les champs.
3. Instances serveur et persistance transactionnelle.
4. Noyau sûr, validateurs simples puis ensembles/intervals/expressions.
5. Shadow avec oracle et bascule par type/mode.
6. Migration volontaire/versionnée du catalogue, retrait ancien après preuve.

Critère transversal : divergences explicables, aucune réponse fausse connue acceptée, pas de score doublé, pas de changement pédagogique silencieux. Rollback par version/flag, sans réintroduire des erreurs connues. Lots complets dans [06](migration-roadmap.md).

## Décisions avant codage

- Exact/approché, tolérance, arrondi et formes obligatoires par exercice.
- Domaine prescrit versus domaine commun ; symboles et hypothèses autorisés.
- Poids points configurés, essai raté puis succès, hints, skip et abandon par mode.
- Succès par élément ou exercice entier en duel ; politique de délai et erreur technique.
- Statut visible d'une correction indéterminée et exclusion d'exercices non certifiables.
- Correction prospective seulement ou reprise des agrégats historiques ; les paramètres des anciennes tentatives sont absents.

**Prochaine étape : L0**, corpus privé en lecture seule, fixtures de vérité et compatibilité, classification des bugs/règles/ambiguïtés ; aucun premier lot implémenté dans cet audit.
