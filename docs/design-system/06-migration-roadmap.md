# 06 — Roadmap de migration

Plan proposé. Aucune implémentation ni test exécuté pour cet audit documentaire.

| Lot | Objectif et zones | Risques/dépendances | Critères futurs |
|---|---|---|---|
| 0 — Validation | décider direction, thème, typo, tokens et a11y; docs seulement | couples de contraste à mesurer | revue design/dev, décisions enregistrées, contrastes vérifiés |
| 1 — Tokens | globals.css, tailwind.config.js, alias, Toaster, MathInput | cascade compat et clavier MathLive | deux thèmes vérifiés, contrastes AA, aucun changement fonctionnel |
| 2 — Primitives | Button, IconButton, champs, Badge, Card, Alert, dialogs | styles répartis dans pages | clavier/focus/disabled/erreur/tactile vérifiés; callbacks conservés |
| 3 — Métier | Exercise, renderers, progression, flashcards, account | risque élevé pour correction et saisie | tests exercice/correction/renderers, parcours MathLive, comparaison visuelle |
| 4 — Pages/layout | Layout, entraînement, progression, duel, DS, dashboard | auth/rôles et responsive | routes et rôles vérifiés aux breakpoints, plein écran conservé |
| 5 — A11y/responsive | labels, focus, zoom, graphes/tables, overflow maths, mouvement | peut avancer dès lot 1 | clavier/lecteur d'écran ciblés, zoom 200%, vues 320/768/1280, contrastes AA |
| 6 — Docs/gouvernance | catalogue, exemples, conventions, revue tokens | composants stabilisés requis | états documentés, nouvelles valeurs justifiées par token |

## Ordre recommandé

Lot 0, puis lot 1 avec alias de compatibilité; lot 2 sur boutons/champs/dialogues; lot 3 avec garde-fous MathLive et correction; lot 4 page par page; lot 5 en continu; lot 6 comme condition de clôture. Traiter le zoom bloqué dans le travail accessibilité prioritaire.

## Garde-fous

- Les règles `.light .bg-slate-*` ont une cascade contextuelle : inventorier usages et comparer captures avant retrait.
- MathInput gère focus, clavier virtuel global et masquage au démontage : tester champs multiples, mobile et clavier matériel.
- Ne pas changer modèles de contenu, renderers, moteur de correction ou callbacks durant harmonisation visuelle.
- Lors de l'implémentation future, exécuter suites Vitest existantes sous frontend/__tests__, parcours manuel entraînement/réponse/correction, thèmes, routes admin et vues responsive.
