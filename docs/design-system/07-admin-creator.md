# 07 — Variante Admin/Creator

## Portée et verdict

Cette proposition répond à la demande d'adapter NovLearn Admin/Creator au Design System élève. Elle complète les six documents précédents et reste une spécification : aucun code applicatif n'a été modifié.

**Le Design System élève est accessible ici**, dans `docs/design-system/01-audit.md` à `06-migration-roadmap.md`. Ses bases observées sont Tailwind 3, tokens HSL dans `frontend/app/globals.css` et `frontend/tailwind.config.js`, thèmes clair/sombre, bleu/indigo, Fredoka, Lucide, Sonner et MathLive/KaTeX.

Il n'y a pas deux applications frontend dans ce dépôt. L'application élève et les routes Admin sont au sein du même Next.js 15 App Router / React 18 / TypeScript 5, sous `frontend/app`. Le package root n'est qu'un orchestrateur de scripts; il ne déclare pas workspace UI. Aucune raison actuelle d'introduire un monorepo ou un package inter-app.

## Audit de compatibilité

| Besoin | État relevé | Conclusion |
|---|---|---|
| Fondation frontend | Même Next, React, TS, Tailwind et build | Réutilisation directe possible dans un même bundle |
| Dashboard | `app/admin/dashboard/page.tsx`, composants locaux `DashboardUI.tsx`, données/hooks/export PDF | Fonctionnel mais style sombre distinct, polices et couleurs codées localement; KPI et graphiques sont des composants métier admin |
| Validation d'exercices | `app/validation/page.tsx`; modal de preview utilise `ExerciseRenderer` et `generateVariables`; validation/refus via endpoint admin | Preview/renderer élève déjà réellement partagé; modale et badges locaux |
| Flashcards | `app/flashcards/page.tsx`; CRUD, formulaire, filtre chapitre, confirmations navigateur | Gestion fonctionnelle présente; pas de table/éditeur partagé identifié |
| Création DS | `app/ds/nouveau/page.tsx`; sélection de compétences et chapitres via `useTaxonomyStore` | Réutilise déjà la taxonomie; ce n'est pas un ExerciseEditor |
| Exercices | Types dans `app/types/exercise.ts`, renderers partagés, MathInput dans `components/ui/MathInput.tsx` | Garder l'interface MathLive et ses contrats; appliquer thème via variables et wrapper |
| Navigation | Routes Admin enveloppées par `components/Layout.tsx` | Shell Admin dédié justifié; l'actuel Layout combine navigation élève, compte et responsive |
| Tokens/thèmes | Tokens sémantiques partagés mais compatibilité de classes slate en transition | Réutiliser primitives et conventions; exposer sémantiques Admin neutres sans changer l'élève |

Les intitulés ExerciseEditor, ExercisePreview générique, DataTable, SearchInput, FilterBar, ChapterSelector et CompetencySelector ne sont pas identifiés comme composants partagés existants. `PreviewModal` et la sélection de taxonomie DS sont des ancêtres fonctionnels, non des primitives standardisées. La présence d'un workflow complet brouillon/publication pour les exercices n'est pas confirmée; la page validation fournit plutôt une file d'approbation avec actions valider/refuser.

## Direction et thème Admin proposés

Une variante **claire, neutre, dense et calme**; l'app élève garde son ton actuel. Les deux expériences partagent les repères bleu NovLearn, les conventions de focus, l'échelle et les composants de base. L'Admin réduit gradients, halos, ombres décoratives, grands rayons et animations.

### Primitives communes

Prendre comme primitives, à centraliser à terme, le bleu marque existant (palette Tailwind blue et token HSL primary), indigo existant pour accent secondaire, échelle neutre Slate, vert/ambre/rouge fonctionnels, spacing base 4px, typographie de lecture, focus, rayons, ombres et durées documentés dans `02-foundations.md`. Ces valeurs primitives sont des données communes; leur usage varie via tokens sémantiques.

### Sémantiques Admin proposées

| Token de rôle | Direction proposée |
|---|---|
| `admin.canvas` | slate très clair, fond de travail |
| `admin.sidebar` | blanc/neutre, bordure droite discrète |
| `admin.surface` / `admin.surface-raised` | blanc, élévation minimale |
| `admin.text-primary` / `secondary` / `muted` | slate-900 / slate-700 / slate-600; maintenir le contraste pour petit texte |
| `admin.border` / `admin.border-strong` | slate-200 / slate-300 |
| `admin.brand` / `admin.brand-soft` | bleu NovLearn pour action primaire, sélection et liens; fond bleu très léger |
| `admin.success`, `warning`, `danger`, `info` | états avec versions texte, fond, bordure et icône |
| `admin.table-row-hover`, `selected`, `focus` | surfaces neutres et marque de sélection explicite |

Valeurs précises à dériver de primitives déjà listées dans `02-foundations.md`, puis tester les contrastes WCAG 2.2 AA sur chaque couple. Ne pas inventer une nouvelle teinte de marque. Sombre Admin reste hors première livraison, mais noms sémantiques doivent permettre une future variante.

### Densité et typo

Proposer par défaut 40px de hauteur pour contrôles admin (compact 32px réservé aux actions secondaires, large 44px tactile), lignes tableau 40–44px, espacements denses 8/12/16px. Les densités ne s'appliquent pas automatiquement au mobile. Employer pile système sans-serif pour les formulaires/données; garder Fredoka au logo ou aux éléments de marque. Cette décision typographique est à valider avec fondations élève.

## Mutualisation et composants spécifiques

### À mutualiser directement ou par façade commune

| Famille | Candidats existants ou communs | Limite de partage |
|---|---|---|
| Fondations | primitives couleurs, spacing, typo, focus, motion; tokens CSS partagés | tokens sémantiques Admin restent distincts |
| Boutons, champs, badge, alert, card, dialog | cible commune; code UI centralisé à construire progressivement | variants `compact` et density, pas de logique admin dans primitives |
| Icônes/toasts | lucide-react et sonner déjà présents | toaster doit lire thème actif ou thème du shell |
| Taxonomie | `useTaxonomyStore`, `taxonomyService`, types chapitre/compétence existants | sélecteurs Admin ajoutent recherche, sélection multiple et résumé |
| Contenu math | `MathText`, `Latex`, `MathInput`, types Exercise, `ExerciseRenderer` | wrapper Admin choisit surface/largeur; ne clone pas MathLive ni renderer |
| Aperçu exercice | logique preview de validation et renderer élève existants | `ExercisePreview` peut devenir un conteneur partagé seulement si un deuxième usage apparaît |
| Progression/états | tokens de statut et progress UI | signification sémantique fournie par métier |

### Spécifiques Admin (à créer si besoin confirmé)

`AdminAppShell`, `AdminSidebar`, `AdminPageHeader`; `DataTable` avec sélection/tri/pagination; `SearchInput`, `FilterBar`; `FormField` (peut réutiliser Input); `StatusBadge` (compose Badge); `StatCard` (compose Card); `PublicationStatus`; `ChapterSelector`, `CompetencySelector`; `ExerciseEditor`; `FlashcardEditor`. `ConfirmDialog` doit être générique et partagé, son contenu/action admin étant spécifique.

ExerciseEditor et FlashcardEditor sont des éditeurs métier, jamais des primitives. `PublicationStatus` ne doit pas promettre un workflow tant que le modèle et les transitions brouillon/publié ne sont pas établis. DataTable n'est justifié que pour de vraies listes administrables; ne pas créer une abstraction généraliste sans besoin de tri, pagination ou sélection.

## Contrat des composants prioritaires

| Composant | Responsabilité et états essentiels | Adaptation |
|---|---|---|
| AppShell / Sidebar | navigation admin, sections et compte; actif, collapsed, mobile drawer | sidebar claire structurée; landmarks nav/main, noms, état courant; drawer clavier |
| PageHeader | titre, aide/context, actions principales | actions groupées, retour possible; passage en pile sur mobile |
| DataTable | affichage et actions de lignes | densité compact/comfortable, tri annoncé, sélection clavier, colonnes mobiles choisies |
| SearchInput / FilterBar | recherche et filtres appliqués | labels, effacement, filtres actifs sous forme supprimable; empilement mobile |
| FormField | label, contrôle, aide, erreur | message associé; validation sans dépendre de couleur |
| StatusBadge / PublicationStatus | statut court et état publication | texte explicite et icône; transitions autorisées définies par domaine |
| StatCard | valeur, unité, libellé et tendance | compose Card; ne pas utiliser uniquement une grande couleur décorative |
| ConfirmDialog | confirmation d'action sensible | objet/conséquence, action destructive distincte; focus trap/Escape |
| ExerciseEditor | composition des éléments et métadonnées typées | brouillon/erreur/sauvegarde; preview partage renderer; aucun changement au moteur math |
| ExercisePreview | visualisation fidèle des renderers avec variables | existe partiellement dans ValidationPage; isoler du chrome élève |
| MathInput | saisie mathématique via MathLive | réutiliser contrôle existant, prévoir densité et label; pas de clavier maison |
| ChapterSelector / CompetencySelector | sélection taxonomie | données du store existant; recherche, sélection globale de chapitre et compte |
| FlashcardEditor | question/réponse/chapitre | formulaires accessibles, édition/création; réutiliser FormField et sélecteur |

## Architecture recommandée

Première étape sans déplacement : conserver `frontend/app/components/ui` pour primitives partagées et `app/renderers`, placer les nouveaux assemblages sous `app/admin/components` et le shell sous `app/admin/AdminAppShell.tsx` (ou dossier équivalent). Appliquer ce shell aux routes Admin ciblées, sans refondre d'un coup toutes les pages.

```text
frontend/app/
  styles/                         # tokens communs + mapping admin proposé
  components/ui/                  # primitives sans dépendance métier
  components/ui/MathInput.tsx     # MathLive existant, thème piloté par tokens
  renderers/                      # renderers exercice utilisés par élève/preview
  admin/
    AdminAppShell.tsx
    components/                   # table, filtres, selectors, éditeurs métier
    dashboard/                    # route et logique déjà présentes
  validation/                     # workflow présent; peut consommer shell/composants
  flashcards/                     # CRUD présent; peut consommer shell/champs
```

Ne pas fusionner le `Layout` élève avec l'AppShell Admin. Les primitives reçoivent props et callbacks, pas de dépendance auth/Supabase. Les adaptateurs métier lisent taxonomy/auth et alimentent les primitives. Une frontière de dossier et de tokens permet aux deux expériences d'évoluer séparément, tandis que l'import direct des composants élimine la duplication dans ce dépôt.

Si un second frontend séparé apparaît plus tard, mesurer d'abord les composants vraiment partagés et la compatibilité Next/React/Tailwind; extraire alors éventuellement un package versionné. Aujourd'hui, le coût d'un package/monorepo dépasse son bénéfice.

## Roadmap

| Lot | Travail | Acceptation / risques |
|---|---|---|
| A — décisions | valider shell dédié, thème clair, typo, densité, tokens, périmètre des routes et statut publication | décision écrite; contraste calculé; workflow non supposé |
| B — tokens Admin | ajouter mapping sémantique Admin à côté des tokens communs; ne pas changer thèmes élève | le dashboard peut consommer ses tokens; captures thème élève inchangées |
| C — shell et primitives | AppShell/Sidebar/PageHeader et Button/Input/Badge/Dialog/Alert réutilisables | accès clavier, rôle courant, mobile; Layout élève non régressé |
| D — listes et taxonomie | SearchInput, FilterBar, DataTable si besoin, ChapterSelector/CompetencySelector | sélection, tri et erreurs testés; mêmes données taxonomy |
| E — domaines | harmoniser dashboard, validation/ExercisePreview, flashcards; ensuite définir le vrai périmètre ExerciseEditor | preview emploie renderer et génération de variables actuels; CRUD inchangé |
| F — finition | densité responsive, contrastes, formulaires, confirmation et doc | tests clavier/zoom/mobile, contraste AA, documentation mise à jour |

Risques principaux : CSS global hérité des classes slate; Toaster en thème fixe; styles MathLive globaux; couplage actuel au Layout et aux rôles; ne pas confondre validation de contenu avec publication. Prévoir captures avant/après, tests des flux de validation/CRUD/DS, vérification des deux thèmes élève et du shell Admin.

## Décisions à valider

1. Accepter un Admin clair comme présentation principale, distinct du thème élève sombre/clair.
2. Valider pile système sans-serif pour densité, avec Fredoka limitée aux marqueurs de marque.
3. Valider hauteur compacte 40px et ligne tableau 40–44px, avec minimum tactile distinct.
4. Confirmer quelles routes constituent l'espace Admin : dashboard, validation, flashcards, création de DS et autres pages réservées à des rôles.
5. Décider si ExerciseEditor est dans le périmètre immédiat ou reste une capacité future; préciser le statut éditorial brouillon/publication.
6. Confirmer si sélection de chapitre/compétence exige recherche, multi-sélection, filtres persistants et pagination pour calibrer les abstractions.

Ces validations sont nécessaires avant l'implémentation visuelle; elles ne bloquent pas la conclusion de cet audit et de cette proposition.
