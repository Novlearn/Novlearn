# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

**Chapter placement test** (`chapter_placement_test.py`): Tests users on a chapter before allowing free practice; uses adaptive questioning.

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

Automated via GitHub Actions on push to `main`. Deploys to a VPS with Apache reverse proxy + systemd services. The backend runs on port 8010 internally.
