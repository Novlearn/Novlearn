# Présentation mathématique commune — 3 novembre 2026

Engine 0.1.6 prépare les mathématiques paramétrées des énoncés, questions, indices
et explications par substitution Cortex dans l'AST brut, puis sérialisation LaTeX.
Les valeurs négatives sont correctement groupées dans les puissances et indices.
Les retours de ligne et les relations initiales des démonstrations sont conservés.
Aucune évaluation ou simplification nouvelle ne participe à cette présentation.
Les réponses textuelles exactes et les instantanés historiques restent inchangés.
Les composants de rendu et de saisie des deux applications sont conservés.

Archive commune : `206444e1efea28fd163589f36d8b0ad653968d90f3dd2e3fc8f77da135a0798d`.
Sources : branche Engine `codex/catalogue-staging-engine`, commit `a3e17ec` ;
le patch fourni conserve la série complète depuis `baa48c4`.
Les candidates 0.1.5 restent des preuves locales non reçues, hors distribution finale.

## Vérifications exécutées

- 111 exercices, cinq seeds : 555 comparaisons des générations et des données de
  correction avec les instantanés privés 0.1.4. Aucun changement de réponse,
  politique ou points ; aucun signe `+−` restant dans les textes examinés.
- Archive exacte sous Linux borné : 111 exercices, 127 générations/projections
  publiques, dont cinq seeds sur les cas 18, 35, 98 et 110. Aucun champ privé exposé.
  Les lots ayant dépassé cinq secondes sous forte charge ont été relancés avec
  moins de concurrence ; les limites du host sont inchangées.
- 100 tests Engine ciblés : signes, puissances, indices, équivalences, budget de
  texte, composition, correction et relecture des observations historiques.
- 34 tests des routes et rendus existants Novlearn ; trois tests de reçus Admin.
- Vérification des 165 fichiers installés et dépendances dans les deux applications.
  Build/types/lint/format Engine et contrôles de types des applications passent.
- Le lanceur Windows inchangé est bloqué par la stratégie de contrôle d'application
  du poste. La suite complète n'est pas annoncée comme passée : elle a rencontré
  ce blocage et des timeouts de tests algébriques sous charge. Les protections
  n'ont pas été modifiées ; le dev utilise le profil Linux borné vérifié ci-dessus.

Les [résultats structurés](2026-11-engine-text-display.json) ne contiennent ni
réponses privées ni secrets. Les valeurs et explications d'une nouvelle instance
de l'exercice 18 sont aussi vérifiées dans l'écran élève existant.

## Staging et suite du nettoyage

La migration `20261103085704_engine_text_display_archive` a été appliquée uniquement
à Staging pour reconnaître cette archive dans les nouveaux reçus Admin. Elle
vérifie le corps précédent de la fonction et conserve ses attributs de sécurité.
La publication Production reste désactivée ; aucun reçu ancien n'est réécrit.
Cette migration à préconditions Staging ne constitue pas un plan de migration Production.

Les anciens générateurs/correcteurs peuvent être retirés sur la branche avant
merge, après suppression vérifiée de leurs consommateurs. La livraison Production
doit coordonner activation du runtime, migration de son catalogue et suppression
des chemins historiques ; un simple merge ne réalise pas cette bascule aujourd'hui.

`mathjs` reste réellement utilisé par `GraphRenderer` pour échantillonner les courbes,
ainsi que par des utilitaires historiques. La correction des exercices migrés
reste dans Engine côté serveur. Le retrait de cette dépendance exige de remplacer
ces usages, sans supprimer KaTeX, MathLive ou les composants de rendu/saisie.
