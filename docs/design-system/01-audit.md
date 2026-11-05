# 01 — Audit

## Méthode et périmètre

Inspection statique des manifests, styles, configuration Tailwind, layout, composants et pages. Les références sont relatives à la racine. Aucun audit visuel exécuté dans un navigateur.

## Architecture observée

- Next.js 15 App Router, React 18, TypeScript 5, Tailwind CSS 3.3; pages dans frontend/app.
- Composants métier dans app/components; renderers sous app/renderers; orchestration des exercices sous components/Exercise.
- Styling surtout par classes Tailwind dans JSX, complété par app/globals.css, styles inline et quelques styles jsx globaux.
- Dépendances UI installées : lucide-react, sonner, next-themes, mathlive, mathjs, recharts. Aucun Radix/shadcn trouvé dans frontend/package.json.
- Layout app/layout.tsx; navigation dans components/Layout.tsx. Celui-ci détecte le mode mobile par JS à 768px; les pages emploient aussi les breakpoints Tailwind.
- Clair et sombre sont réellement configurés : next-themes, classe HTML, defaultTheme dark, enableSystem. Tailwind déclare également darkMode class.

## Identité existante

Source centralisée principale : frontend/app/globals.css et frontend/tailwind.config.js.

| Rôle | Valeur actuelle |
|---|---|
| Fond sombre profond/médian/doux | HSL 222 47% 6%; 226 57% 11%; 222 47% 11% |
| Surface / élevée / creusée | HSL 215 28% 17%; 217 33% 22%; 222 47% 11% |
| Texte fort / principal / atténué / subtil | HSL 0 0% 100%; 213 31% 91%; 215 20% 65%; 215 16% 47% |
| Primaire / survol | HSL 221 83% 53%; 217 91% 60% (bleu proche #2563EB) |
| Accents | HSL 239 84% 67%; 271 81% 56% |
| Danger / succès / attention | HSL 0 84% 60%; 142 71% 45%; 38 92% 50% |
| Thème clair | Fond HSL 213 100% 97%; surfaces blanches; texte fort HSL 222 47% 11%; bleu primaire conservé |

Ombres dédiées dark/light existent dans globals.css. Tailwind expose app-* et content-* sémantiques plus des palettes fixes primary, purple, amber, slate. Les états n'ont pas encore systématiquement des paires accessibles texte/fond/bordure.

Typographie : Fredoka 300–700 chargée par next/font/google dans app/layout.tsx et appliquée au body. Plusieurs composants réécrivent famille/poids/taille inline. KaTeX est chargé depuis jsDelivr; MathLive est une dépendance.

Le spacing Tailwind suit l'échelle standard 4px mais des valeurs custom existent (ex. ActionButton min-width 240px). Les rayons vont de rounded à rounded-3xl/full et plusieurs ombres arbitraires sont utilisées.

## Inventaire ciblé

| Fichier/zone | Rôle et état | Réutilisabilité / observation |
|---|---|---|
| components/ActionButton.tsx | Action primaire/secondaire en relief | 2 variantes; minimum 240px, gradient et ombre locaux; pas de contrat disabled/type explicite |
| components/Layout.tsx, SidebarIcon.tsx | Navigation desktop/mobile, compte, accès invité | actif/verrouillé, plein écran; Layout mêle auth, routes et responsive |
| components/ui/MathInput.tsx | math-field et clavier virtuel MathLive | controlled, disabled/readOnly, gestion focus; couleurs inline claires incompatibles avec thème sombre |
| components/ui/MathText.tsx, Latex.tsx, katexUtils.ts | Affichage KaTeX | inline/display et substitution; couche spécialisée à préserver |
| components/Exercise/ExerciseRenderer.tsx | Dispatcher les types d'éléments | texte, équation, question, QCM, graphes et tableaux; logique métier distincte des primitives |
| app/renderers/*Renderer.tsx | Rendu et interaction par élément | conserver leurs contrats métier |
| components/Exercise/ExerciseLoader.tsx | Chargement et progression d'exercice | candidat pour unifier feedback/états visuels |
| components/ui/HelpModal.tsx, FeedbackModal.tsx, GuestLock/GuestConversionModal.tsx, modales account | Dialogues | implémentations multiples; comparer avant extraction d'une primitive commune |
| TrainingPage.tsx, ProgressPage.tsx, DuelPage.tsx, MonthlyLeaderboard.tsx | Parcours élève | composants de page riches et styles dans JSX |
| components/account/* | Profil, amis, avatar, demandes, suppression | motifs métier récurrents |
| admin/dashboard/*, validation/page.tsx, ds/nouveau/page.tsx | Dashboard, validation, création de DS | présence admin confirmée; éditeur complet d'exercices non repéré |
| Footer.tsx, Logo.tsx, TaxonomyProvider.tsx | Présentation/infrastructure | composants partagés distincts |

Pas de catalogue central de Button/Input/Card/Dialog identifié. Les éléments natifs et leurs classes sont composés dans les pages.

## Pages et incohérences

Routes observées : accueil, entraînement, exercices, progression, flashcards, duel, classement, DS, compte/paramètres, auth, classes, support, feedback, validation, admin dashboard. Layout fournit sidebar fixe desktop de 6rem, barre basse mobile, logo, compte et footer. Identité dominante : fond bleu nuit en dégradé, bleu/indigo, cartes, Fredoka et emoji pour navigation/taxonomie.

1. **Tokenisation partielle.** globals.css remappe les anciennes classes slate/text-white sous .light; cascade historique encore nécessaire.
2. **MathInput hors thème.** MathInput.tsx force fond blanc, textes et bordures ardoise, et définit les couleurs du clavier virtuel globalement.
3. **Boutons ad hoc.** ActionButton possède gradients et ombres 3D, tandis que d'autres actions sont stylées directement dans les pages.
4. **Typographie peu différenciée.** Fredoka sert aussi aux textes longs et interfaces denses; les règles inline empêchent une échelle stable.
5. **Responsive mixte.** Layout détecte le breakpoint en JS alors que les autres zones utilisent les breakpoints CSS; risque de divergence/hydratation.
6. **A11y à renforcer.** ActionButton n'expose pas type/disabled; LockedSidebarIcon est un div cliquable sans clavier/sémantique bouton; focus non centralisé. layout.tsx règle maximumScale à 1, bloquant le zoom utilisateur.
7. **Toast.** Le Toaster est fixé en thème sombre malgré le support clair/sombre.
8. **Maths mobiles.** Pas de convention documentée pour formules longues, graphes/tableaux larges ou place du clavier virtuel.
9. **KaTeX CDN.** Layout dépend de jsDelivr pour JS/CSS; évaluer robustesse/CSP séparément.
10. **Convention du thème.** Tailwind darkMode class coexiste avec sombre sur :root et clair sur .light; vérifier l'usage effectif de variantes dark:.

## Forces à préserver et limites

Les tokens HSL, deux thèmes, identité bleue/indigo, Lucide pour les icônes, séparation initiale MathLive/KaTeX/renderers et les tests Vitest sont de bons appuis. Emoji peuvent rester des marqueurs de chapitre. Les contrastes n'ont pas été calculés pour tous les couples et alphas; la conformité WCAG nécessite une mesure sur chaque combinaison retenue. Aucun audit clavier/lecteur d'écran/capture exhaustive n'a été réalisé.
