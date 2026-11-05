# Consolidation Git Engine — 2 novembre 2026

À la demande de l'utilisateur, sauvegarde locale sur la branche
`codex/integration-engine-staging`, avant conversion du catalogue Staging.
Le commit de code est `e883ada1913f99177de3926890670473b9aabfc8`.
La réception, les captures et les exemples mathématiques sont regroupés ensuite.
Aucun push, déploiement ou changement distant pendant cette consolidation.

## Sélection des changements

Seuls les changements de cette mission ont été sélectionnés. Pour les trois
fichiers partagés (`.gitignore`, API exercices et page de duel), le contenu de
l'index a été construit sans inclure les modifications antérieures. Leurs
fichiers de travail ont été conservés, avec vérification de leurs empreintes.

Restent hors de ces commits : la documentation et les migrations historiques
déjà modifiées, les changements de confidentialité/profils et d'autorisation
GET déjà présents, leurs tests et les anciens travaux de replay SQL/Admin.
Le dépôt voisin Admin et les configurations privées ne sont pas committés.
Le contrôle du contenu indexé n'a trouvé ni chemin de configuration privée ni
valeur de clé provenant des configurations locales.

## Vérification du contenu effectivement indexé

Une copie a été exportée de l'index, sans reprendre les modifications et fichiers
non sélectionnés. Elle utilise les dépendances locales déjà installées, sans
copier les configurations privées.

- Frontend : **201 réussites, 9 TODO, 8 ignorés**. Les huit tests de comparaison
  Creator sont explicitement ignorés car son dépôt voisin est absent de la copie.
  Les deux fichiers de tests API préexistants non sélectionnés n'y figurent pas.
- Backend : **187 réussites**, avec configuration fictive et cible loopback
  indisponible ; aucune base distante. L'exécution restreinte bloquait TestClient ;
  l'exécution locale autorisée a terminé en six secondes.
- Duel : **71 réussites** ; compilation TypeScript réussie.
- TypeScript frontend : réussi.
- Sessions PostgreSQL en mémoire, garde invitée, scores, rejouage, idempotence
  et contrôles d'exclusion/rollback sur copie : réussis.
- Archive officielle Engine : **157 fichiers installés et dépendances vérifiés**.
- `git diff --cached --check` : réussi.

Le total de **218 tests frontend réussis** dans la réception précédente concerne
l'espace de travail complet, avec les travaux antérieurs et le dépôt Creator
voisin. Il ne doit pas être confondu avec les 201 réussites de la copie isolée.

La copie fraîche a révélé une conversion CRLF par Git sur Windows : elle
modifiait les corps SQL et faisait échouer la garde MD5. Des attributs `eol=lf`
ciblés sur les seuls fichiers SQL de cette mission fixent le format de checkout.
Les empreintes attendues et le refus de modification d'un corps inattendu sont
conservés. La nouvelle exportation passe les contrôles sans adapter les gardes.

Les exemples arithmétiques restent un contrôle synthétique du cœur officiel,
distinct des parcours navigateur : `node scripts/test-engine-math-examples.mjs`.
Ils vérifient notamment `4/2`, les rationnels exacts, les signes, la multiplication
implicite, les décimaux, les réponses fausses et le refus de division par zéro.

La conversion générale des exercices Staging n'a pas commencé pendant ces commits.
Les limites du [bilan des parcours existants](2026-11-engine-existing-routes.md)
restent applicables : catalogue historique encore présent, recette complète
DS/duels et qualification de l'hébergement cible restantes.
