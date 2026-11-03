# Novlearn

Plateforme d'entraînement ludique et personnalisée pour le Bac de mathématiques :
recommandation adaptative d'exercices, duels 1v1 en temps réel, suivi de progression
par compétence et test de positionnement par chapitre.

## Architecture

Trois services, une base Supabase.

```
Navigateur ──HTTP──▶ Next.js (3000) ──▶ FastAPI (8010) ──▶ Supabase
     │                    │
     └──WebSocket──▶ Colyseus duel-server (2567) ──▶ Supabase
```

| Service | Rôle | Port |
|---|---|---|
| `frontend/` | Next.js 15 (App Router), React 18, Tailwind, TypeScript | 3000 |
| `backend/` | FastAPI — recommandation, amis, duels (lobby), DS, notifications | 8010 |
| `duel-server/` | Colyseus — état temps réel des duels 1v1 | 2567 |
| `supabase/` | Migrations PostgreSQL, RLS | — |

`ARCHITECTURE.md` détaille le moteur d'exercices, le schéma de base et le CI/CD.

## Démarrage rapide

### Prérequis

- Node.js 18+
- Python 3.11+
- Un projet Supabase (aucun PostgreSQL local n'est nécessaire)

### Les trois services d'un coup

```bash
# Windows
start-dev.bat
# Linux/Mac
./start-dev.sh
```

### Ou service par service

```bash
# Frontend  →  http://localhost:3000
cd frontend && npm install && npm run dev

# Backend   →  http://localhost:8010
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # Linux/Mac
pip install -r requirements.txt
python main.py

# Duel-server  →  ws://localhost:2567
cd duel-server && npm install && npm run dev
```

En développement, `next.config.mjs` proxifie `/api/*` vers `http://localhost:8010`.
En production, c'est Apache qui assure le reverse proxy.

### Vérification

- Frontend : <http://localhost:3000>
- Health check backend : <http://localhost:8010/api/health>

## Configuration

### `frontend/.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://votre-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre-anon-key
NEXT_PUBLIC_COLYSEUS_URL=http://localhost:2567
NEXT_PUBLIC_SITE_URL=https://novlearn.fr   # production uniquement
```

### `backend/.env`

Voir `backend/.env.example`.

```env
APP_ENV=development
DEBUG=True
HOST=0.0.0.0
PORT=8010
SUPABASE_URL=https://votre-project-ref.supabase.co
SUPABASE_SERVICE_KEY=votre-service-role-key   # PAS la clé anon
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### `duel-server/.env`

Voir `duel-server/.env.example`.

> Les valeurs Supabase se trouvent dans le dashboard : **Settings → API**.
> Après modification d'un `.env`, redémarrer le service concerné.

## Base de données

La correction locale de la migration `exercises_claude` est documentée dans [son audit](docs/audits/2026-10-migration-028-exercises-claude.md). Les propositions de versionnement des exercices et de sécurité SQL sont conservées dans `docs/sql-proposals/` et ne sont pas des migrations déployables.

```bash
npm run db:push     # applique les migrations sur Supabase
npm run db:start    # instance Supabase locale
npm run db:stop
```

## Tests

```bash
npm test              # les trois suites
npm run test:backend  # pytest
npm run test:frontend # vitest
npm run test:duel     # vitest
npm run test:coverage
```

Détails et conventions : `README-TESTS.md`.

## Structure

```
novlearn/
├─ frontend/        Next.js — app/ (routes, composants, renderers, utils)
├─ backend/         FastAPI — main.py, recommandation.py, ds.py, settings/, tests/
├─ duel-server/     Colyseus — rooms/, schema/
├─ supabase/        migrations SQL
├─ apache/          vhosts de production
├─ systemd/         unités des trois services
├─ docs/            audit, notes de mise en place, rapport cyber
└─ docs_projet/     spécifications d'origine
```

## Déploiement

Automatisé par GitHub Actions (`.github/workflows/deploy.yml`) : chaque push sur
`main` déploie sur le VPS (Apache en reverse proxy + trois services systemd).

Secrets GitHub Actions consommés par le workflow :

| Domaine | Secrets |
|---|---|
| VPS | `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| Divers | `ADMIN_API_SECRET`, `LOG_LEVEL`, `NEXT_PUBLIC_GA_ID` |

> `DATABASE_URL` et `SECRET_KEY` sont encore référencés par le workflow mais
> hérités d'une architecture PostgreSQL/SQLAlchemy abandonnée : aucun code ne
> les lit. Voir `docs/AUDIT_REPRISE.md`.

## Documentation

| Document | Contenu |
|---|---|
| `ARCHITECTURE.md` | Référence technique complète |
| `README-TESTS.md` | Guide des tests |
| `docs/AUDIT_REPRISE.md` | Audit de reprise : dette, sécurité, priorités |
| `docs/SETUP_AUTH.md` | Configuration de l'authentification |
| `docs/NOTIFICATIONS_SETUP.md` | Notifications push |
| `docs/OPTIMISATIONS.md` | Pistes de performance |
| `docs_projet/` | Cahier des charges, charte graphique, fiche de lancement |

## Équipe

Balthazar · Charles · Yoan · Timothée · Alexandre

## Calendrier

- **Février 2026** — MVP testable
- **Juin 2026** — Livraison finale

## Licence

Projet académique — École Centrale de Lyon (PE69).

## Synchronisation du catalogue

Pour copier les exercices et la taxonomie de production vers le staging : [guide et commandes](docs/catalog-sync.md).

Pour initialiser les deux projets Supabase et configurer Auth, les secrets et Realtime : [guide des environnements](docs/supabase-environments.md).
# Intégration Engine 0.2.0

Voir le [guide des environnements et de l'intégration](docs/engine-0.2.0-integration.md)
pour les variables GitHub/Vercel, le host isolé et l'ordre des migrations.
