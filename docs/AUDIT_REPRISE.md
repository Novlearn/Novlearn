# Audit de reprise — Novlearn

Date : 10 septembre 2026. Périmètre : dépôt complet (frontend Next.js, backend FastAPI, duel-server Colyseus, migrations Supabase, CI/CD, docs). Base Supabase de production non consultée (aucun projet accessible via le connecteur) : l'état réel des tables et des policies RLS est déduit des migrations.

> **Historique.** Cet audit décrit le dépôt au 10 septembre 2026; il n'est pas un état courant. Le suivi documentaire du 5 novembre 2026 a actualisé le README, les guides de tests, notifications et environnements, et a supprimé plusieurs guides obsolètes. Voir [l'index des docs](README.md) et la [roadmap candidate](product/roadmap.md). Revalider chaque constat dans le code avant d'en faire une tâche.

## 1. Synthèse

Le projet est en bon état technique pour être repris : tout compile, tout est lint-clean et les trois suites de tests sont vertes (319 tests). L'architecture à trois services est cohérente et documentée dans `ARCHITECTURE.md`.

Les vrais problèmes sont ailleurs :

1. **L'intégrité des scores et des classements repose sur le client.** Points de compétence, tentatives, résultat de duel : tout est calculé dans le navigateur et écrit directement en base. Tricher au classement se fait depuis la console du navigateur.
2. **Fuite de données personnelles par RLS.** Tout utilisateur connecté peut lire l'email et la date de naissance de tous les autres (policy `profiles_select_others`).
3. **Une fonctionnalité morte en silence.** Le test de placement par chapitre (`chapter_placement_test.py`, 19 Ko) s'appuie sur deux tables supprimées par la migration 019. Le code échoue, l'exception est avalée, et on retombe sur la recommandation normale.
4. **Beaucoup de fichiers obsolètes ou dupliqués** : 150 fichiers de maquettes Figma versionnés, rapports de couverture commités, 3 copies désynchronisées de la config duel, README faux sur la moitié des points.
5. **Pas de CI de qualité** : le push sur `main` déploie en prod sans exécuter ni tests, ni lint, ni typecheck.

## 2. Ce qui a été vérifié

| Vérification | Résultat |
|---|---|
| Backend `pytest` (Python 3.12, deps fraîches) | 180 tests passés |
| Frontend `tsc --noEmit` | 0 erreur |
| Frontend `next lint` | 0 warning |
| Frontend `vitest` | 82 tests passés |
| Duel-server `tsc --noEmit` | 0 erreur |
| Duel-server `vitest` | 57 tests passés |
| Secrets `.env` dans l'historique git | aucun |

Lecture intégrale de : `main.py`, `auth.py`, `config.py`, `recommandation.py`, `streak.py`, `ds.py`, `chapter_selection.py`, `chapter_placement_test.py`, `notifications.py`, settings backend, tout le duel-server, `AuthContext`, `middleware.ts`, `api.ts`, routes API Next, `ExerciseLoader`, `ExerciseRenderer`, migrations clés (001, 019, 023, 024, 025, 028, 043), workflow de déploiement, configs Apache et systemd.

## 3. Architecture

```
Navigateur ──HTTP──▶ Next.js (3000) ──▶ FastAPI (8010) ──▶ Supabase
     │                    │  routes /api/exercises, /api/admin, /api/delete-account (service role)
     │                    └──────────────────────────────────▶ Supabase (anon key + RLS, 14 composants)
     └──WebSocket──▶ Colyseus duel-server (2567) ──▶ Supabase (service role)
```

**Points forts**
- Séparation claire lobby (FastAPI) / temps réel (Colyseus) pour les duels.
- Taxonomie chapitres/compétences en base, cachée côté client (Zustand) et côté backend.
- Migrations SQL numérotées et lisibles, RLS activée partout, refonte 025 bien pensée (anti-IDOR, anti-escalade de rôle).
- Bonne base de tests unitaires avec mocks Supabase propres.

**Faiblesses structurelles**
- **Trois chemins d'accès aux données** depuis le frontend : Supabase direct (14 composants), backend FastAPI, routes API Next. Aucune règle ne dit quand utiliser lequel. Résultat : la logique métier est éparpillée et parfois dupliquée (streak calculé en SQL par trigger, en Python dans `streak.py`, et bonus de streak en TypeScript dans `competenceScore.ts`).
- **La logique de score est côté client.** `ExerciseLoader.tsx` lit `user_competence_scores`, calcule les nouveaux points avec `computeNewScore` et fait l'upsert lui-même. La policy RLS autorise l'UPDATE de ses propres scores. Idem pour `exercise_attempts.is_correct`, et pour `isCorrect` envoyé au duel-server dans `submitAnswer`.
- **`main.py` est un monolithe de 1 230 lignes** avec modèles, routes amis, duels, DS, notifications et helpers. À découper en `APIRouter` par domaine.
- **Auth backend coûteuse** : `verify_token` appelle `supabase.auth.get_user()` (un aller-retour réseau) à chaque requête. Vérifier le JWT localement (secret JWT ou JWKS) supprime cette latence.
- **Cache taxonomie backend jamais invalidé** : après modification des compétences en base, il faut redémarrer le backend.

## 4. Problèmes critiques (à traiter avant toute évolution)

### 4.1 Sécurité et intégrité

| # | Problème | Où | Impact |
|---|---|---|---|
| S1 | Scores de compétence calculés et écrits par le client | `ExerciseLoader.tsx` (`updateCompetenceScore`), policy `user_competence_scores` UPDATE own | Triche triviale ; classement et progression non fiables |
| S2 | `is_correct` des tentatives choisi par le client | `ExerciseLoader.tsx`, RLS INSERT own | Le trigger `handle_exercise_completion` (streak, monthly_scores) fait confiance à cette valeur |
| S3 | Résultat de duel décidé par le client | `duel/active/[id]/page.tsx` envoie `isCorrect` ; `DuelRoom.ts` l'accepte tel quel | Un joueur peut gagner tous ses duels |
| S4 | Tout utilisateur authentifié lit email + date de naissance de tous | migration 025, `profiles_select_others USING (true)` ; contredit l'intention de la migration 014 | Fuite RGPD. Le dashboard admin fait `select * from profiles` avec la clé anon |
| S5 | Email utilisé comme nom de repli et envoyé à l'adversaire | `get_pending_duels`, `get_duel_history` dans `main.py`, `getPlayerName` dans `db.ts` | Le préfixe d'email d'un joueur sans prénom est visible par l'autre |
| S6 | Page `/admin/dashboard` sans contrôle de rôle | `admin/dashboard/page.tsx` : aucun test sur `profile.role` (seul le lien est masqué dans `Layout`) | Tout utilisateur connecté y accède ; les données sont limitées par RLS mais les profils sont lisibles (voir S4) |
| S7 | `GET /api/exercises` sans authentification, avec la service role key | `app/api/exercises/route.ts` (le commentaire dit "Authentifié") | Expose tous les exercices avec corrigés. Ils sont déjà lisibles en anon via RLS, mais l'intention est contradictoire. CORS avec `Allow-Credentials: true` et origine de repli |
| S8 | Mot de passe de la base Postgres en clair dans un commentaire | `backend/.env` local (non versionné) | À retirer et à faire tourner le mot de passe par précaution |
| S9 | Headers de sécurité HTTP absents | Apache SSL conf et `next.config.mjs` : ni HSTS, ni CSP, ni `X-Frame-Options`, ni `X-Content-Type-Options` | Déjà relevé par le rapport ZAP de mars 2026 (`docs/PE69B-rapport_cyber.md`), non corrigé |
| S10 | Actions GitHub épinglées sur `@master` | `appleboy/ssh-action@master`, `scp-action@master`, `checkout@v3` | Risque supply chain ; épingler un SHA ou une version |

**Recommandation pour S1 à S3** : créer un endpoint backend `POST /api/attempts` (ou une fonction Postgres `SECURITY DEFINER`) qui reçoit la réponse brute, la valide côté serveur, puis écrit tentative + score. Retirer les policies INSERT/UPDATE client sur `exercise_attempts` et `user_competence_scores`. Pour les duels, faire valider la réponse par `DuelRoom.ts` avec le même moteur d'évaluation (`utils/math/evaluation.ts` est du TypeScript pur, portable dans le duel-server).

### 4.2 Bugs et incohérences avérés

| # | Problème | Où |
|---|---|---|
| B1 | Test de placement mort : tables `user_chapter_test_state` et `user_chapter_test_completed` supprimées par la migration 019, mais toujours utilisées | `chapter_placement_test.py`, `main.py` (`/api/chapter-test/*`), `exercices/page.tsx` (mode `test`). L'erreur est avalée par `except Exception` dans `recommend_exercise` |
| B2 | Constante définie deux fois : `CONF_MEDIUM_MAX_HIGH = 0.3` puis `= 0.8`. La branche "défi" tire un exercice moyen dans 80 % des cas au lieu de 30 % | `settings/recommandation_settings.py` |
| B3 | `@property` au niveau module crée un attribut `COMPETENCES` cassé (objet property) qui court-circuite le `__getattr__` PEP 562 | `settings/competence_settings.py` |
| B4 | Config duel dupliquée trois fois et désynchronisée : timeout exercice 30 s (frontend) vs 45 s (serveur, backend) ; `DuelState` par défaut 300 s vs 180 s | `frontend/app/settings/duelSettings.ts` (non importé), `backend/settings/duel_settings.py` (non importé), `duel-server/src/config.ts`, `DuelState.ts` |
| B5 | Colonnes `Is_Flash` / `Need_Calculator` (majuscules en base, migration 021) lues en minuscules `is_flash` / `need_calculator` : `isFlash` toujours `false` | `app/api/exercises/route.ts` |
| B6 | Proxy dev vers le port 8000 alors que le backend écoute sur 8010. Masqué en local par `NEXT_PUBLIC_API_URL` dans `.env.local` | `next.config.mjs`, contredit `CLAUDE.md` |
| B7 | Les exercices stockent tantôt des IDs de compétence, tantôt des noms d'affichage. `recommandation.py` attend des IDs ; `ds.py` construit un mapping nom → id ; le frontend a `normalizeCompetenceId` pour absorber les deux | Données `exercises.competences` |
| B8 | 11 `print("[DS DEBUG] ...")` en production, dont un dump complet de `exos_par_comp` | `ds.py` |
| B9 | `datetime.utcnow()` déprécié (Python 3.12) ; mélange naïf/aware dans `accept_duel` | `main.py` |
| B10 | Le scheduler est documenté "8h" dans le code et la doc, mais le cron est à 17:00 | `notifications.py`, `docs/NOTIFICATIONS_SETUP.md` |
| B11 | Messages d'erreur utilisateur qui parlent de `localhost:8010` en production | `lib/api.ts` |
| B12 | `middleware.ts` protège `/cours`, route qui n'existe pas ; `CLAUDE.md` la cite comme page clé | `middleware.ts`, `CLAUDE.md` |
| B13 | `decline_duel` supprime la ligne au lieu de la passer en `declined` ; `accept_duel` termine d'autorité tous les autres duels actifs des deux joueurs | `main.py` |
| B14 | Duel-server sans gestion de déconnexion : pas d'`allowReconnection`, la partie continue jusqu'au timer si un joueur part | `DuelRoom.ts` (`onLeave` ne fait que logger) |
| B15 | `getRandomExercise` recharge tous les exercices flash à chaque question ; `ds.py` recharge toute la table `exercises` à chaque recommandation | `db.ts`, `ds.py` |
| B16 | `/api/delete-account` supprime manuellement 9 tables mais oublie `feedbacks` (FK SET NULL, ok), `ds`, `push_subscriptions`, `user_stats`, `user_weekly_rewards`. Ces tables ont `ON DELETE CASCADE` : la suppression manuelle est inutile et partielle. Un seul `auth.admin.deleteUser` suffit | `app/api/delete-account/route.ts` |
| B17 | Le workflow injecte `DATABASE_URL` et `SECRET_KEY` dans `backend/.env`, variables que rien ne lit | `.github/workflows/deploy.yml` |
| B18 | `@next/third-parties` en v16 avec Next 15 ; `react-joyride` en pré-release `3.0.0-7` ; `next lint` déprécié (retiré dans Next 16) | `frontend/package.json` |

## 5. Inventaire des fichiers : utile, inutile, à déplacer

### À supprimer du dépôt

| Fichier / dossier | Raison |
|---|---|
| `docs_projet/Maquette1/`, `docs_projet/Maquette2/` (150 fichiers) | Exports Figma + composants shadcn complets, jamais importés. À archiver hors dépôt (zip, branche `archive/maquettes`) |
| `duel-server/coverage/` (17 fichiers), `backend/.coverage` | Artefacts de couverture générés. À ajouter au `.gitignore` |
| `frontend/app/ClientProviders.tsx` | Doublon exact des providers de `layout.tsx`, jamais importé |
| `frontend/app/components/ThemeToggle.tsx`, `ThemeToaster.tsx` | Jamais importés (le thème a été retiré de `ProfileTab` au commit f42cacb) |
| `frontend/app/contexts/ThemeContext.tsx` | Ré-export d'une ligne de `next-themes`, un seul usage |
| `frontend/app/hooks/useVariable.ts` | Jamais importé |
| `frontend/app/lib/Flashcardsdata.ts` | Jamais importé (les flashcards viennent de la table `flashcards`) |
| `frontend/app/settings/competenceSettings.ts` | Shim marqué `@deprecated`, jamais importé |
| `frontend/app/settings/duelSettings.ts` | Jamais importé, valeurs fausses (voir B4) |
| `backend/settings/duel_settings.py` | Jamais importé (commentaire dans `main.py` : "no longer needed") |
| `shared/competences.json` | Obsolète : 2 chapitres sur 8, la source de vérité est la table `competences`. Encore copié sur le VPS par le workflow |
| `frontend/public/data/analyse_equation_de_degre_2_1_rgyfpt.json` | Jamais référencé |
| `frontend/app/classes/page.tsx` + `components/ClassesPage.tsx` (29 Ko) | Maquette avec données en dur ("GOTAGA", classes fictives), aucun appel réseau, aucune table `classes`. À retirer ou à mettre derrière un feature flag |
| `frontend/app/privacy/page.tsx` | Doublon de `politique-confidentialite/page.tsx` (contenu différent, une seule doit rester) |
| `docs/PE69B-rapport_cyber.html` (142 Ko) | Doublon HTML du `.md` |
| `.claude/settings.local.json` | Fichier de permissions personnelles avec chemins locaux, à ignorer |

### Docs à fusionner ou à réécrire

| Fichier | État |
|---|---|
| `README.md` | Faux sur : port backend (8000 vs 8010), stack (SQLAlchemy/PostgreSQL local, `DATABASE_URL`, `SECRET_KEY`), lien vers `GUIDE_LOCAL_SETUP.md` inexistant, arbre de fichiers d'une version antérieure |
| `docs/DEVELOPPEMENT_FUTUR.md` | Liste des "restes à faire" de l'intégration maquette, dépassée |
| `docs/IMPLEMENTATION_SUMMARY.md`, `DUEL_SYSTEM_SETUP.md`, `CONFIGURATION_CHECKLIST.md` | Notes de mise en place du duel v1 (avant Colyseus), dépassées |
| `docs/NOTIFICATIONS_SETUP.md` | Cite des colonnes `notif_pwa`/`notif_email` renommées en migration 034, et "8h" au lieu de 17h |
| `docs/CHAPTER_PLACEMENT_TEST_BRIEF.md` | Décrit une fonctionnalité morte (B1) |
| `docs/OPTIMISATIONS.md`, `docs/SETUP_AUTH.md` | Partiellement valides |
| `README-TESTS.md` | Valide, sauf : `make_supabase` est dans `helpers.py` et non `conftest.py` ; les comptes de tests sont dépassés |
| `ARCHITECTURE.md` | La seule doc à jour et complète. Y fusionner ce qui reste utile des autres, puis supprimer le reste |
| `CLAUDE.md` | Listé dans `.gitignore` mais versionné ; cite `/cours` et `MathParser.ts` qui n'existent plus, et `duel_settings.py` comme actif |

### À conserver mais à corriger

| Fichier | Action |
|---|---|
| `package.json` racine | Contient des dépendances runtime (`@cortex-js/compute-engine`, `serwist`, `@supabase/*`) qui n'appartiennent pas à la racine. Ne garder que `supabase` en devDependency et les scripts. Le double lockfile déclenche un warning Next à chaque build |
| `frontend/public/logo.png` (637 Ko), `logo_seul.png` (514 Ko) | À compresser (WebP / PNG optimisé), ce sont les deux plus gros fichiers du dépôt |
| `systemd/novlearn-backend.service` | `After=postgresql.service` : aucun Postgres local |
| `.github/workflows/deploy.yml` | Voir section 6 |

## 6. Déploiement et CI

- **Aucune barrière qualité** : le push sur `main` déploie directement. Ajouter un job `test` (pytest, vitest x2, tsc, lint) en prérequis de `deploy_production`, et le même job sur les PR.
- **Staging sans systemd** : lancé via `nohup` + fichiers `.pid`, tué au `fuser -k`. Fragile ; utiliser les mêmes unités systemd que la prod avec un suffixe `-staging`.
- **`scp` de `frontend/**` après `npm install`** : le pattern inclut très probablement `node_modules` (plusieurs centaines de Mo). Le commit b3af456 "éviter le timeout SSH" en est le symptôme. Copier uniquement `.next/`, `public/`, `package*.json`, `next.config.mjs`.
- **`rg` utilisé sur le VPS** dans le job staging : outil rarement présent par défaut.
- **`.env` backend généré dans le runner puis copié** : acceptable, mais les secrets transitent par le disque du runner et par scp. Préférer une écriture directe sur le VPS via `ssh-action` comme c'est déjà fait pour `frontend/.env.local`.
- **`frontend/.env.local` sur le VPS contient la service role key** : nécessaire pour les routes API Next, mais cela donne au process Next les pleins pouvoirs sur la base. Réduire la surface en déplaçant `/api/exercises` (POST/DELETE) et `/api/admin/*` vers FastAPI, qui a déjà cette clé.
- Le workflow déploie `shared/` qui n'est plus lu par personne.

## 7. Qualité de code et dette

- **Thème incohérent** : `next-themes` avec `defaultTheme="dark"` et `enableSystem`, mais 41 occurrences de `bg-white` en dur contre 24 `dark:`. `ExerciseLoader` est entièrement en clair, les pages légales entièrement en sombre. Décider d'un seul thème ou finir le travail avec des tokens.
- **KaTeX chargé depuis un CDN** dans `layout.tsx` (0.16.9) alors que `mathlive` est bundlé. Un seul moteur de rendu, chargé localement, suffit.
- **61 `any`** et **13 `console.log`** dont des logs de debug verbeux dans `exercices/page.tsx` en production.
- **`react/no-unescaped-entities` désactivé** globalement pour tout le projet.
- **Tests** : bonne base unitaire, mais aucun test de composant React, aucun test des renderers d'exercice (le cœur métier), aucun test E2E. `utils/math/evaluation.ts` (18 Ko, valide toutes les réponses) n'a aucun test.
- **Backend** : logs `INFO` très verbeux sur `/api/friends` (5 lignes par appel). `select("*")` sur `friend_codes` et `friends`. `get_friend_requests` sélectionne `email` sans l'utiliser.
- **`chapter_selection.py`** relit toute la table `exercises` (colonne `chapter`) à chaque recommandation sans chapitre.

## 8. Plan de reprise proposé

### Phase 0 : nettoyage (1 à 2 jours)
1. Supprimer les fichiers listés en section 5, mettre à jour `.gitignore` (coverage, `.coverage`, `.claude/settings.local.json`).
2. Archiver `docs_projet/Maquette*` hors dépôt.
3. Réécrire `README.md` à partir d'`ARCHITECTURE.md` ; supprimer les docs dépassées ; corriger `CLAUDE.md`.
4. Corriger B2, B3, B5, B6, B8, B9, B10, B11, B12, B17.
5. Une seule source pour la config duel : `duel-server/src/config.ts`, poussée au client via `DuelState` (déjà en place). Supprimer les deux autres copies.

### Phase 1 : sécurité et intégrité (1 semaine)
1. Restreindre `profiles_select_others` aux colonnes publiques (vue `public_profiles` ou colonnes explicites) et faire passer amis/duels/classement par cette vue. Corriger S5.
2. Garde de rôle sur `/admin/dashboard` (côté page et côté `middleware.ts`).
3. Endpoint serveur de soumission de tentative, retrait des policies INSERT/UPDATE client sur `exercise_attempts` et `user_competence_scores` (S1, S2). Passer le trigger et le bonus de streak sur une seule implémentation.
4. Validation des réponses de duel côté `DuelRoom.ts` (S3) ; gestion `onLeave` / `allowReconnection` (B14).
5. Headers HTTP de sécurité dans Apache (S9). Épingler les actions GitHub (S10).
6. Rotation du mot de passe base et nettoyage de `backend/.env` (S8).

### Phase 2 : fiabilité (1 semaine)
1. Décider du sort du test de placement (B1) : soit recréer les deux tables par une migration 044 et tester le flux, soit supprimer `chapter_placement_test.py`, les routes `/api/chapter-test/*`, le mode `test` frontend et la doc.
2. Normaliser `exercises.competences` en IDs uniquement par une migration de données, puis supprimer le mapping nom → id de `ds.py` et `normalizeCompetenceId` (B7).
3. Vérification JWT locale dans `auth.py`. Invalidation du cache taxonomie (TTL ou endpoint admin).
4. Job CI `test` bloquant avant déploiement ; staging sous systemd ; `scp` restreint aux artefacts de build.
5. `delete-account` réduit à `deleteUser` en s'appuyant sur les `ON DELETE CASCADE` (B16), après vérification que `profiles` cascade bien depuis `auth.users`.

### Phase 3 : dette et évolutivité (continu)
1. Découper `main.py` en routers (`friends`, `duels`, `ds`, `notifications`, `recommendation`).
2. Règle d'accès aux données : Supabase direct pour les lectures RLS simples, FastAPI pour toute écriture métier, routes Next uniquement pour ce qui a besoin de `cookies()`.
3. Tests sur `utils/math/evaluation.ts` et les renderers ; un test E2E Playwright sur le parcours "connexion → exercice → score".
4. Thème : choisir sombre ou clair, ou tokeniser proprement.
5. Migrer `next lint` vers ESLint CLI, aligner `@next/third-parties` sur Next 15, sortir de la pré-release `react-joyride`.
