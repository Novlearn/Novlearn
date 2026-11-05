# 02 — Fondations proposées

Les recommandations sont des propositions. Garder les variables HSL sémantiques comme API des thèmes et migrer leur usage progressivement.

## Principes

Clarté pédagogique; expression mathématique prioritaire et lisible; interactions simples; cohérence des états; accessibilité clavier/tactile/zoom; feedback immédiat avec texte et icône; adaptabilité mobile/desktop; style sérieux avec ludisme mesuré.

## Couleurs

### Primitives existantes à conserver comme base

| Famille | HEX présents dans tailwind.config.js | Rôle indicatif |
|---|---|---|
| blue 50/100/200/300 | #F0F9FF / #DBEAFE / #BFDBFE / #93C5FD | fonds/accent doux |
| blue 500/600/700/800 | #3B82F6 / #2563EB / #1E40AF / #1E3A8A | marque et interaction |
| purple 500/700 | #A855F7 / #7E22CE | accent distinctif |
| amber 400/500 | #FBBF24 / #F59E0B | attention/progression |
| slate 600/700/800/900/950 | #475569 / #334155 / #1E293B / #0F172A / #020617 | neutres |

Indigo actuel HSL 239 84% 67% (environ #6366F1). Les HSL de globals.css font autorité quand elles diffèrent des couleurs fixes Tailwind; harmoniser après validation.

### Tokens sémantiques proposés

bg.canvas/subtle; surface.default/raised/sunken/overlay; text.primary/secondary/muted/inverse/link; border.subtle/default/strong/focus; action.primary et ses états hover/active/disabled; state.success/warning/danger/info avec text/bg/border/icon; progress.low/medium/high; math.input surface/border/text/focus/keyboard.

Les noms existants app-* et content-* restent alias temporaires. Chaque état doit combiner texte/icône et couleur. Selected ajoute bordure ou marque visuelle; disabled conserve lisibilité et explique la raison si nécessaire.

### Thèmes et WCAG

Conserver les thèmes clair et sombre existants. Bleu reste action primaire; indigo et violet sont des accents parcimonieux. Viser WCAG 2.2 AA : 4.5:1 texte normal, 3:1 grand texte et contours essentiels. Mesurer les couples réellement composés après transparences, dégradés et focus. text-subtle HSL 215 16% 47% sur fond sombre est à vérifier et ne devrait pas porter une information essentielle sans mesure. En thème clair, éviter slate-400 en petit texte. Anneau focus 2px avec offset, distinct de la bordure.

## Typographie

Proposition à valider : garder Fredoka pour marque, titres courts et accents; utiliser la pile système sans-serif pour paragraphes denses, formulaires et admin. Ne pas ajouter de police distante à cette étape. MathLive/KaTeX gardent leurs polices mathématiques.

| Niveau | Taille / hauteur de ligne | Graisse |
|---|---:|---:|
| H1 | 32/40 px; mobile 28/36 | 600–700 |
| H2 | 28/36 | 600–700 |
| H3 | 24/32 | 600 |
| H4 | 20/28 | 600 |
| H5 | 18/26 | 500–600 |
| H6 | 16/24 | 600 |
| Corps large / corps | 18/28; 16/24 | 400 |
| Corps petit / label | 14/20 | 400 / 500–600 |
| Caption | 12/16 | 400–500, secondaire seulement |

Expressions longues : défilement horizontal local; conserver taille lisible et alignement; fournir titre/description aux graphes et texte alternatif quand le rendu ne suffit pas. Ne pas réduire le corps sous 14px sans raison.

## Dimensions, mouvement

Spacing base 4px : 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px. Contrôles 36/44/48px; cible tactile recommandée 44×44. Largeur max proposée : 1200px élève, 1440px admin; gouttières 16/24/32px mobile/tablette/desktop.

Rayons : 4px badge, 8px contrôle, 12px carte/menu, 16px grande surface, full pour pilule/avatar. Bordure 1px, focus/selected 2px. Réutiliser les deux ombres actuelles comme sm/md de départ.

Breakpoints Tailwind actuels : 640, 768, 1024, 1280, 1536px. Éviter une détection JS distincte pour l'affichage. Z-index proposés : base 0, sticky 10, navigation 20, menu 30, backdrop 40, dialog 50, toast 60, tooltip 70.

Mouvement proposé : 120ms rapide, 180ms standard, 240ms entrée/sortie; easing cubic-bezier(0.2,0,0,1). Transitions servent le feedback, sans secousse indispensable. `prefers-reduced-motion: reduce` supprime déplacement, boucle et effets non nécessaires. Skeleton pour chargement structurel; spinner pour action courte.
