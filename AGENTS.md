# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Règles de contribution (humains et assistants)

Ces règles s'appliquent à toute correction, fonctionnalité, refactorisation ou modification de documentation. Lire cette section avant de modifier le dépôt.

### Une tâche, une branche, une pull request

**Interdictions absolues : aucun push direct sur `main` ou `develop`, et aucune pull request vers `main`. Les branches de tâche sont les seules branches à pousser; toutes les PR doivent cibler `develop`.**

1. Vérifier le dépôt avec `git remote -v`, puis la branche et les changements locaux avec `git status`. Ne jamais écraser le travail existant ni l'inclure dans sa propre contribution sans vérifier à qui il appartient.
2. Pour une nouvelle tâche, partir de `develop` à jour et créer une branche dédiée **avant toute modification** : `fix/description-courte`, `feat/description-courte`, `refactor/description-courte` ou `docs/description-courte`. Si une branche de tâche existe déjà, la reprendre après avoir vérifié son périmètre. Ne jamais travailler ni committer directement sur `develop` ou `main`.
3. Garder une seule tâche cohérente par branche. Faire des commits courts et explicites, en sélectionnant uniquement les fichiers concernés; éviter `git add .` si des modifications étrangères à la tâche sont présentes.
4. Vérifier le diff et exécuter les contrôles adaptés avant de pousser la branche. Ouvrir ensuite une **pull request vers `develop`**. Si le travail est incomplet, ouvrir une PR en brouillon et indiquer ce qui manque.
5. La PR doit décrire le problème ou le besoin, les changements, les vérifications réellement effectuées et les limites connues. Ajouter des captures pour une modification visuelle. Demander une revue et attendre sa validation; un assistant ne fusionne pas la PR sans demande explicite du responsable.
6. Ne jamais pousser directement sur `main` ou `develop`, ni créer ou rediriger une PR vers `main`, y compris pour une correction urgente, de la documentation ou une livraison. Ne pas forcer un push, réécrire l'historique des branches partagées ni supprimer le travail d'autrui. La gestion de la production reste à la charge du responsable, hors de ce parcours de contribution.

Exemple pour démarrer une nouvelle tâche, **avec un répertoire de travail propre** (remplacer le nom d'exemple) :

```bash
git remote -v
git status
git switch develop
git pull --ff-only origin develop
git switch -c fix/description-courte
# Effectuer les changements, les vérifier, puis sélectionner les fichiers :
git add chemin/du/fichier
git commit -m "fix: description de la correction"
git push -u origin fix/description-courte
```

Sur GitHub, cliquer sur **Compare & pull request**, choisir `develop` comme branche de destination et sa branche de tâche comme source, puis remplir la description. Une PR propose des changements à relire; sa fusion les intègre à la branche de destination.

Si le répertoire contient déjà du travail, ne pas lancer cette séquence telle quelle : identifier ce travail avant de changer de branche. Si Git ou GitHub est inaccessible, signaler précisément l'étape bloquée; ne pas contourner le blocage par un commit ou un push sur une branche partagée, ni annoncer une PR qui n'existe pas.

### Code simple et réutilisation

- Avant d'ajouter du code, rechercher les fonctions, services, hooks, composants et tests existants qui répondent déjà au besoin. Les réutiliser ou les adapter plutôt que créer un second mécanisme équivalent.
- Privilégier des fonctions courtes, des noms clairs et les conventions du dossier. Limiter les changements au besoin demandé; éviter les abstractions, dépendances, refontes et reformatages sans nécessité.
- Préserver les comportements existants, l'authentification, les autorisations et les contrats d'API. Ne pas désactiver une protection ni remplacer un appel réel par une simulation pour faire passer une vérification.
- Pour les exercices, réutiliser l'intégration Engine existante et ses contrats. Ne pas recréer un moteur de génération ou de correction parallèle dans l'application.

### Séparer les responsabilités

- `frontend/` : interface, rendu, interactions et appels aux services via les clients existants. Les fichiers client ne doivent contenir ni secrets, ni clés de service, ni opérations privilégiées sur les données.
- `backend/` : API FastAPI, règles métier et contrôles d'accès côté serveur. Ne pas ajouter de logique d'interface dans le backend, ni se fier au frontend pour faire respecter les autorisations.
- `duel-server/` : état et règles autoritaires des matchs en temps réel; conserver la gestion du lobby dans le backend.
- Respecter les frontières et adaptateurs serveur déjà présents, notamment pour Engine. Pour une évolution transverse, définir le contrat entre services et mettre à jour les appels concernés ensemble, sans dupliquer les règles métier.

### Charte graphique et système de design

- Reprendre les composants et les conventions des écrans existants, notamment `frontend/app/components/ui/`, avant de créer une nouvelle variante.
- Les références visuelles sont `frontend/app/globals.css` (variables et thèmes) et `frontend/tailwind.config.js` (tokens Tailwind). Utiliser les couleurs sémantiques existantes, par exemple `bg-app-surface`, `text-content-main` et `border-app-border`, plutôt que des couleurs arbitraires.
- Conserver la cohérence des typographies, espacements, arrondis, ombres, boutons et icônes. Ne pas redéfinir la palette ou le thème global pour un besoin local.
- Vérifier les thèmes clair et sombre, les formats mobile et bureau, les états chargement/vide/erreur, le contraste et l'utilisation au clavier pour les éléments modifiés.

### Infrastructure et VPS : hors périmètre des contributions courantes

- Une tâche applicative ou documentaire n'autorise **aucune intervention sur le VPS**, en staging comme en production : pas de SSH, commande distante, installation, redémarrage de service, déploiement manuel ou modification de secrets.
- Ne pas créer, modifier, déplacer ou supprimer les fichiers `.yml` / `.yaml`, les workflows et actions sous `.github/`, ni les configurations ou scripts d'infrastructure et de déploiement (notamment `apache/`, `systemd/`, `deploy.sh` et les scripts associés). Ne pas contourner cette règle en faisant la même modification via un script ou un autre format.
- Ne pas déclencher ou relancer manuellement de workflow de déploiement ou de maintenance, ni modifier les paramètres GitHub, les environnements ou les secrets. Les contrôles CI automatiques d'une PR restent autorisés.
- Ne pas appliquer de migration ni de script de modification des données sur une base partagée dans le cadre d'une tâche ordinaire. Préparer les éventuels changements de schéma dans la PR et laisser leur application au responsable.
- Si une évolution exige un changement d'infrastructure, expliquer le besoin et les fichiers concernés dans la PR, puis laisser cette partie au responsable jusqu'à une **demande explicite dédiée**. Les commandes techniques décrites plus bas ou dans les autres guides ne constituent pas une autorisation d'exécution.
- Attention : fusionner vers `develop` peut déclencher le déploiement staging existant; fusionner vers `main` peut déclencher la production. La création d'une PR ne vaut pas autorisation de fusion ni de déploiement.

### Vérifications et compte rendu

- Consulter [README.md](README.md) et [README-TESTS.md](README-TESTS.md) pour les commandes à jour. Exécuter les tests, vérifications de types et constructions pertinents pour les services modifiés; pour une modification documentaire seule, vérifier le diff, les liens et les exemples suffit.
- Ne jamais versionner de secrets, fichiers d'environnement réels, exports privés ou artefacts locaux. Relire les fichiers sélectionnés avant chaque commit.
- En fin de tâche, indiquer ce qui a changé, les contrôles effectués, la branche et le lien de PR s'il existe. Signaler honnêtement les contrôles non exécutés et les étapes bloquées.

## Project Overview

Novlearn is a gamified, personalized math practice platform for the French Baccalauréat. It features adaptive exercise recommendation, a 1v1 duel system, competence-based progress tracking, and a chapter placement test.

## Development Commands

### Frontend (Next.js 15, TypeScript, Tailwind CSS)
```bash
cd frontend
npm install
npm run dev      # Dev server on http://localhost:3000
npm run build    # Production build
npm run lint     # ESLint
```

### Backend (FastAPI, Python 3.11+)
```bash
cd backend

# Activate virtual environment (Windows)
.venv\Scripts\activate
# Or (Linux/Mac)
source .venv/bin/activate

pip install -r requirements.txt
python main.py   # Starts on http://localhost:8010 with auto-reload
# Alternative:
uvicorn main:app --reload
```

### Database (Supabase)
```bash
# From project root
npm run db:push    # Apply migrations to Supabase
npm run db:start   # Start local Supabase instance
npm run db:stop    # Stop local Supabase instance
```

### Duel server (Colyseus, real-time 1v1)
```bash
cd duel-server
npm install
npm run dev      # Colyseus on ws://localhost:2567
```

### Start All Three Services
```bash
# Windows
start-dev.bat
# Linux/Mac
./start-dev.sh
```

## Environment Variables

**Frontend** — create `frontend/.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=https://novlearn.fr  # production only
```

**Backend** — create `backend/.env`:
```
APP_ENV=development
DEBUG=True
HOST=0.0.0.0
PORT=8010
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key  # NOT the anon key
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

## Architecture

### Frontend (`frontend/app/`)

Uses **Next.js App Router**. All routes are under `frontend/app/`.

**API Proxy**: In development, `next.config.mjs` proxies `/api/*` → `http://localhost:8010/api/*`. In production, this is handled by the web server.

**Auth**: `contexts/AuthContext.tsx` — React context wrapping Supabase auth. Provides `useAuth()` hook with `user`, `profile`, `session`, `loading`. The `middleware.ts` refreshes sessions server-side on every request.

**Exercise System**:
- `types/exercise.ts` — core type definitions. An `Exercise` has `variables` (randomized parameters) and `elements` (typed content blocks: `text`, `equation`, `question`, `mcq`, `variation_table`, `sign_table`, `graph`, `sequence`, `discrete_graph`).
- `renderers/` — one renderer component per element type (e.g. `EquationRenderer`, `GraphRenderer`).
- `components/Exercise/ExerciseRenderer.tsx` — orchestrates rendering all elements of an exercise.
- `utils/variableGenerator.ts` — generates random variable values respecting `min`/`max`/`exclusions`.
- `utils/math/` — expression handling split by concern: `parsing.ts`, `evaluation.ts` (variable substitution via `mathjs`), `simplification.ts`, `formatting.ts`.

**Taxonomy** (chapters + competences):
- `services/taxonomyService.ts` — fetches chapters and competences from Supabase DB.
- `store/useTaxonomyStore.ts` — Zustand store caching taxonomy data.

**Key pages**: `/entrainement` (training), `/duel` (1v1 duel), `/progression` (progress), `/flashcards`, `/ds` (mock exams), `/classement` (leaderboard).

### Backend (`backend/`)

**Entry point**: `main.py` — FastAPI app with all route definitions.

**Auth**: `auth.py` — JWT verification via Supabase service key. All protected endpoints use `Depends(verify_token)`.

**Recommendation engine** (`recommandation.py`): Adaptive algorithm using merge sort on competence ratios (points / max_points). Selects exercise difficulty based on the user's current streak:
- Very low streak → easy exercises on mastered competences (confidence rebuilding)
- High streak → hardest competences at higher difficulty

**Settings** (`backend/settings/`):
- `competence_settings.py` — loads competence IDs and max_points from the `competences` table (cached in-process)
- `recommandation_settings.py` — streak thresholds and difficulty distribution parameters

**Chapter placement test** (`chapter_placement_test.py`): Legacy routes and logic remain, but migration 019 drops their state tables and no later migration recreates them. Treat the flow as unavailable until its product scope and schema are reconciled; see `docs/product/user-flows.md`.

### Duel server (`duel-server/`)

Colyseus room server holding the authoritative real-time state of a 1v1 duel.
The FastAPI backend owns the **lobby** (invitations, accept/decline, history);
this service owns the **match** itself.

- `src/rooms/DuelRoom.ts` — room lifecycle, answer submission, scoring, timers.
- `src/rooms/schema/DuelState.ts` — synchronized state schema.
- `src/config.ts` — single source of truth for duel timings (duration, per-exercise timeout).
- `src/db.ts` — Supabase writes with the service key.

The frontend connects via `app/lib/colyseusClient.ts` (`NEXT_PUBLIC_COLYSEUS_URL`).

### Database (Supabase + PostgreSQL)

Migrations in `supabase/migrations/`. Key tables:
- `profiles` — user info (first_name, last_name, birth_date)
- `exercises` — exercise definitions (JSON structure with `variables` and `elements` arrays, plus `competences` array, `chapter`, `difficulty`)
- `chapters` — math chapters with `order_index` and `emoji`
- `competences` — competence definitions with `max_points` and `chapter_id`
- `user_competence_scores` — per-user competence points
- `exercise_attempts` — history of user attempts
- Duel-related tables: `duels`, `duel_participants`, `duel_attempts`
- `monthly_leaderboard`, `weekly_leaderboard` — materialized leaderboard data

### Deployment

Automated via GitHub Actions on direct pushes to `develop` (staging) and `main` (production). Staging runs beside production on the VPS; production uses Apache reverse proxy + systemd services. The backend listens on port 8010 in production and 8011 in staging. Pull requests run CI but do not deploy.
