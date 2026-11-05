# Novlearn

Plateforme de pratique des mathématiques du Bac : exercices adaptatifs, suivi des compétences et duels en temps réel. Le dépôt contient trois services, une base Supabase et les migrations SQL.

## Développer

Prérequis : Node.js **24.19.0** et npm **11.17.x** pour le frontend et le serveur de duels, Python **3.11+** pour l'API, et un projet Supabase. Aucun PostgreSQL local n'est requis pour lancer l'application.

Installer les dépendances dans `frontend/` et `duel-server/` avec `npm ci`. Pour l'API :

```bash
cd backend
python -m venv .venv
# Windows : .venv\Scripts\activate
# Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Lancer chaque service dans son dossier avec `npm run dev` (frontend, port 3000; duel-server, port 2567). L'API écoute sur le port 8010. Sous Windows, `start-dev.bat` lance les trois services; sous Linux/macOS, `./start-dev.sh`.

## Configurer

Copier les exemples `backend/.env.example` et `duel-server/.env.example` vers `.env`, puis créer `frontend/.env.local`. Renseigner l'URL et la clé publique Supabase côté frontend; les clés de service restent uniquement dans les environnements serveur (`SUPABASE_SERVICE_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`). Configurer aussi `NEXT_PUBLIC_COLYSEUS_URL` côté frontend. Ne jamais versionner de vrais secrets.

Les variables et procédures pour relier production et staging sont décrites dans [docs/supabase-environments.md](docs/supabase-environments.md). Pour synchroniser le catalogue, consulter [docs/catalog-sync.md](docs/catalog-sync.md).

## Vérifier et diagnostiquer

- Frontend : `cd frontend && npm test && npx tsc --noEmit && npm run build`
- Backend : `cd backend && python -m pytest`
- Duel-server : `cd duel-server && npm test && npm run build`
- API : ouvrir `http://localhost:8010/health`; l'alias `http://localhost:8010/api/health` est également disponible.

En développement, Next.js relaie `/api/*` vers le backend. Vérifier les trois processus, leurs fichiers d'environnement et les sorties de leurs terminaux. Les déploiements et leurs contrôles sont définis dans [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); `develop` cible staging et `main` la production. Le script `deploy.sh` reste utilisé par le déploiement de production.

## Restaurer

Les migrations historiques sont conservées dans `supabase/migrations/`. Pour initialiser ou restaurer un environnement Supabase, suivre [le guide de restauration et de configuration](docs/supabase-environments.md); il distingue le schéma, l'historique des migrations et les données applicatives. Ne pas rejouer les anciennes migrations sur une base existante sans avoir vérifié son historique. Les procédures ne restaurent pas les comptes Auth ni les objets Storage.

## Références

- [ARCHITECTURE.md](ARCHITECTURE.md) — architecture et composants
- [README-TESTS.md](README-TESTS.md) — commandes et conventions de tests
- [docs/supabase-environments.md](docs/supabase-environments.md) — staging, production et restauration
- [docs/catalog-sync.md](docs/catalog-sync.md) — synchronisation du catalogue
- [docs/engine-0.2.1-integration.md](docs/engine-0.2.1-integration.md) — archive moteur actuellement intégrée
