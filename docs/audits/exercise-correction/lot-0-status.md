# Lot 0 — corpus et socle de tests

Travail du 9 octobre 2026, base Novlearn `907fb09`. Ce document complète l'audit initial sans en modifier les observations historiques.

Le socle technique du lot 0 est livré : snapshot privé, inventaire réel, corpus synthétique, tests des vrais modules et commandes reproductibles. La certification pédagogique reste **ouverte**, conformément au souhait de discuter ensuite du modèle. Le schéma déployé et ses policies ne sont pas certifiés.

## Livrables

- `scripts/correction-catalog.mjs` : GET uniquement sur la table exercises, projection explicite, pagination et compte vérifié, deux lectures ordonnées identiques, SHA-256, inventaire. Aucune donnée utilisateur. Les définitions sont conservées sous `.local/exercise-correction/`, exclu de Git. Deux lectures identiques réduisent la dérive mais ne remplacent pas un snapshot SQL transactionnel.
- `scripts/correction-replay.mjs` : génération sur cinq seeds fixes, deux passages identiques par instance, rapport détaillé privé. Le harnais charge les vrais modules TypeScript en mémoire ; aucun changement au générateur applicatif.
- `frontend/__tests__/fixtures/correction-reference.json` : 35 cas publics synthétiques, paramètres explicites, résultat observé, référence mathématique proposée, justification, auteur, relecteur en attente. Aucune copie d'un exercice complet privé.
- Tests `correction-l0`, `variable-generator-l0`, `creator-parity-l0`, `renderers-l0`, `exercise-loader-l0` et `DuelRoom.l0`. Les composants et le handler sont réels ; transport, persistance, audio et widgets de présentation sont mockés.
- `scripts/correction-triggers.test.mjs` : fonctions et triggers extraits des migrations 024/030/041 et exécutés dans PGlite, sur schéma minimal local. Aucun SQL envoyé à Supabase.
- Environnement `backend/.venv` Python 3.12.14 et dépendances de `requirements-test.txt`. Versions applicatives et requirements conservés. `scripts/correction-backend-tests.mjs` isole les variables de test des credentials réels.
- Deux dépendances de développement frontend : React Test Renderer et ses types 18.3.1, compatibles avec React 18. La couverture inclut désormais maths, générateur, trois renderers et ExerciseLoader.

## Catalogue observé

111 exercices, empreinte SHA-256 :
`a4f724a5b2141755cb9325ad774080cbcb27c5e8749ed6375af6a9fed782fc28`.

| Dimension | Observation |
|---|---|
| Éléments | text 103 ; question 103 ; mcq 51 ; graph 5 |
| Formats question | number 64 ; expression 23 ; interval 7 ; set 6 ; text 3 |
| Variables | integer 231 ; computed 57 ; decimal 7 ; choice 2 ; triplet 1 |
| Exclusions | 297 chaînes, dont 63 non vides et 10 contenant une référence dynamique |
| QCM | 47 à choix unique ; 4 à choix multiple ; 51 avec flag `correct` dans les options |
| Ensembles | 4 réponses avec point-virgule ; 2 sans point-virgule, dont une notation avec virgule ambiguë |
| Autres conventions | points sur 103 questions ; `ln` dans deux computed |
| Flags | 62 flash ; 13 avec calculatrice ; ces flags seuls ne prouvent pas l'éligibilité effective à un mode |
| Contrôles structurels implémentés | Aucun problème signalé ; ce contrôle partiel ne certifie ni les réponses ni toutes les structures |

Les templates Creator offrent plus de types que ce snapshot publié. Les helpers root1/root2/solve ne sont pas rencontrés dans ces computed ; ils restent testés car disponibles dans Creator. Le terme « domaine implicite » reste une hypothèse à relire exercice par exercice, pas une propriété certifiée automatiquement.

Rejeu privé : seeds `1, 42, 2026, 90709, 4294967295`, **555 instances**, aucun résultat non reproductible, aucune variable manquante, aucune exclusion numérique statique violée, aucun avertissement d'épuisement. Les exclusions dynamiques, singularités, contraintes combinées et pertinence pédagogique ne sont pas validées par ce rapport.

## Séparation observation / vérité / décision

35 cas : 13 accords avec une référence proposée, 14 écarts, 8 décisions ouvertes. Les 14 écarts, le défaut de max(1,2) et deux défauts du générateur donnent **17 tests `it.fails`** : ils réussissent lorsque l'assertion mathématique échoue comme attendu. Vitest les compte parmi les tests passants. Ils matérialisent une dette, jamais une certification de justesse.

Les tests de caractérisation figent l'observation actuelle ; les attentes proposées ont une justification indépendante. Une correction future doit provoquer la révision explicite des observations et la conversion des `it.fails` en tests ordinaires. Ne pas changer la référence pour conserver le comportement historique.

Huit choix du corpus et le contrat d'erreur du générateur restent en `todo`, soit **9 décisions en attente**. Auteur : Codex ; relecture humaine non effectuée. Les conventions Unicode, espaces LaTeX et représentation des paramètres doivent également être confirmées avant inscription dans un contrat produit.

## Vérifications exécutées

| Suite | Résultat |
|---|---|
| Backend isolé | 180 tests passent, aucun test existant modifié |
| Frontend, état final | 174 passent, dont 17 échecs mathématiques attendus ; 9 todo |
| Duel | 63 passent, dont 6 sur le vrai handler DuelRoom |
| Scripts lot 0 | 7 passent : inventaire 4, triggers 3 |
| Catalogue sync existant | 7 passent |
| TypeScript frontend | `tsc --noEmit --incremental false` passe |
| Snapshot privé | Hash, compte et inventaire vérifiés |
| Rejeu privé | 555 instances reproductibles |

La suite frontend complète mesurée avant les deux derniers cas Creator comptait 172 passants et 9 todo ; ces deux cas ont été validés ensuite. Couverture sur ce passage : `evaluation.ts` **90,60 % lignes, 69,23 % branches** ; générateur 73,89 % lignes ; ExerciseLoader 65,71 % lignes. La couverture globale du périmètre élargi est 71,31 % lignes. Le détail est généré sous `frontend/coverage/`, hors Git. Aucun taux backend n'est annoncé.

Les 30 erreurs initiales backend ne sont pas 30 bugs métier. Avec les versions déclarées, l'import Supabase fonctionne. Deux problèmes locaux subsistent pour la commande globale historique : le plugin coverage charge une DLL SQLite bloquée par la politique Windows ; une variable DEBUG héritée vaut une chaîne non booléenne. Le runner lot 0 charge explicitement les plugins asyncio/mock, fixe DEBUG=false et des credentials fictifs. Il ne neutralise aucune assertion ni aucun import métier. La commande de couverture backend historique peut toujours échouer sur cette machine.

## Comportements confirmés par exécution

- Premier essai incorrect puis correct : QuestionRenderer ne transmet que le succès final ; deux erreurs transmettent seulement l'échec final.
- EquationRenderer sans réponse attendue transmet true pour une saisie arbitraire.
- QCM multiple : les deux bonnes options sont reconnues, mais le callback ne transmet que le premier index mélangé.
- Passer avant toute réponse transmet `onNextClick(false)`. Le lien vers le booléen succès de placement/DS reste une observation des pages dans l'audit, pas un test de navigation navigateur.
- trackAbandon : INSERT false au chargement, UPDATE au résultat, DELETE en cas de passage. Les vrais triggers locaux ne compensent pas ces UPDATE/DELETE.
- DuelRoom accorde un point à un `isCorrect=true` client, accepte un elementId absent et attribue un point d'exercice après une seule réponse à un exercice de deux questions. Un doublon est persisté deux fois, scoré une seule fois.
- Creator/app divergent sur substitution négative, max avec virgule, helpers computed et ln. Le solver Creator peut renvoyer un nombre qui n'est pas une racine.

## Limites et conditions avant L1

| Sujet | État |
|---|---|
| Modèle souhaité, forme et tolérance, domaines, essais, points | À discuter ensemble ; aucun choix imposé |
| Auteur/relecteur des attentes | Auteur tracé ; validation humaine en attente |
| Snapshot SQL transactionnel | Non disponible ; double lecture REST avec compte et hash |
| Schéma réellement déployé, RLS et policies | Non inspectés faute de connexion SQL de lecture configurée ; migrations locales seules ne prouvent pas le déploiement |
| End-to-end navigateur, MathLive, publication Creator et duel réseau | Non exécutés ; les tests de callbacks n'en tiennent pas lieu |
| Couverture exhaustive des conventions et exercices | Inventaire et premiers représentants disponibles ; pas de certification exhaustive |
| Concurrence et idempotence des futurs résultats | À définir avec le futur contrat ; aucun moteur v2 mis en place |

Les critères de clôture pédagogique du L0 restent ouverts. L1 ne doit pas commencer avant notre échange. Aucun fichier applicatif, migration, donnée distante, déploiement ou commit n'a été modifié par ce lot.
