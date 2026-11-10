# Architecture Technique — Novlearn

> Document rédigé pour une lecture sans accès au dépôt. Il couvre l'ensemble des fonctionnalités, pages et systèmes techniques du projet.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Moteur d'exercices](#3-moteur-dexercices)
4. [Pages et fonctionnalités frontend](#4-pages-et-fonctionnalités-frontend)
5. [Backend API (FastAPI)](#5-backend-api-fastapi)
6. [Serveur temps réel — Duels (Colyseus)](#6-serveur-temps-réel--duels-colyseus)
7. [Base de données (Supabase / PostgreSQL)](#7-base-de-données-supabase--postgresql)
8. [Authentification](#8-authentification)
9. [Déploiement et CI/CD](#9-déploiement-et-cicd)
10. [Systèmes transversaux](#10-systèmes-transversaux)

---

## 1. Vue d'ensemble

**Novlearn** est une plateforme de préparation au Baccalauréat (mathématiques) combinant :

- **Entraînement adaptatif** : l'algorithme de recommandation choisit l'exercice et la difficulté en fonction du niveau réel de l'utilisateur sur chaque compétence.
- **Duel 1v1 en temps réel** : deux utilisateurs s'affrontent sur les mêmes exercices avec timer.
- **Test de positionnement par chapitre** : avant d'accéder au mode entraînement libre, un test adaptatif évalue l'utilisateur et initialise ses scores de compétence.
- **Suivi de progression par compétence** : chaque chapitre est découpé en compétences ; l'utilisateur accumule des points par compétence.
- **Classement mensuel / hebdomadaire** : leaderboard gamifié.
- **DS (Devoirs Surveillés)** : outils pour enseignants/tuteurs permettant de créer des assignations ciblées sur des sous-ensembles de compétences.

L'architecture repose sur **trois services** distincts qui communiquent via l'API et la base de données :

```
┌─────────────────────┐        HTTP/REST        ┌──────────────────────┐
│  Frontend Next.js   │◄───────────────────────►│  Backend FastAPI     │
│  (port 3000)        │                          │  (port 8010)         │
│                     │        WebSocket         │                      │
│                     │◄───────────────────────►│  Duel-server Colyseus│
└─────────────────────┘         (port 2567)      └──────────────────────┘
          │                                                 │
          └─────────────────────┬───────────────────────────┘
                                │  PostgreSQL (Supabase)
                                ▼
                     ┌────────────────────┐
                     │  Supabase          │
                     │  - Auth (JWT)      │
                     │  - DB PostgreSQL   │
                     │  - Storage         │
                     └────────────────────┘
```

---

## 2. Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Frontend | Next.js (App Router) | 15 |
| UI | React, Tailwind CSS | 18 |
| Langage frontend | TypeScript | — |
| Backend API | FastAPI | — |
| Langage backend | Python | 3.11+ |
| Temps réel (duels) | Colyseus (Node.js) | — |
| Base de données | PostgreSQL via Supabase | — |
| Auth | Supabase Auth (JWT) | — |
| Rendu LaTeX | MathJax | — |
| Évaluation maths | mathjs | — |
| Notifications push | Web Push API (VAPID) | — |

---

## 3. Moteur d'exercices

C'est le cœur technique du projet. L'idée centrale : **un exercice est un document JSON structuré** composé de variables aléatoires et d'éléments de contenu. Ce format permet de créer des milliers de variantes d'un même exercice avec des paramètres différents, sans coder chaque variante manuellement.

### 3.1 Structure d'un exercice

```typescript
interface Exercise {
  id: number;
  title: string;
  chapter: string;
  difficulty: "Facile" | "Moyen" | "Difficile";
  competences: string[];      // Compétences entraînées (ex: ["analyse_derivees"])
  variables: Variable[];      // Paramètres aléatoires
  elements: ExerciseElement[]; // Blocs de contenu à afficher
}
```

### 3.2 Variables — paramètres aléatoires

Chaque exercice déclare des **variables** qui sont générées aléatoirement à chaque instanciation. Elles sont référencées dans le contenu des éléments via la syntaxe `@nomVariable`.

| Type | Description | Exemple de déclaration |
|------|-------------|----------------------|
| `integer` | Entier aléatoire dans `[min, max]` | `{name:"a", type:"integer", min:-10, max:10}` |
| `decimal` | Décimal aléatoire avec précision | `{name:"k", type:"decimal", min:0, max:1, decimals:2}` |
| `choice` | Valeur tirée d'une liste | `{name:"signe", type:"choice", choices:["+","-"]}` |
| `computed` | Calculée à partir d'autres variables | `{name:"c", type:"computed", expression:"@a * @b + 1"}` |
| `doublet` | Paire de valeurs (ex: racines d'un polynôme) | `{name:"pq", type:"doublet", mode:"distinct", names:["p","q"]}` |
| `triplet` | Triplet de valeurs | `{name:"abc", type:"triplet", mode:"choice", choices:"(1,2,3)"}` |

**Exclusions dynamiques** : il est possible d'exclure certaines valeurs pour éviter les cas dégénérés. Les exclusions peuvent référencer d'autres variables : `exclusions: [0, "@a+1"]` exclut 0 et la valeur `a+1`.

**Algorithme de génération (deux passes)** :
1. Générer les variables `integer`, `decimal`, `choice`, `doublet`, `triplet` (avec retry jusqu'à 100 fois si exclusions non satisfaites).
2. Calculer les variables `computed` en évaluant leurs expressions avec les valeurs déjà générées (itérativement jusqu'à 10 passes pour les dépendances croisées).

### 3.3 Éléments — blocs de contenu

Un exercice est composé d'une liste ordonnée d'**éléments**, chacun étant d'un type précis. L'affichage et l'interaction varient selon le type.

#### `text` — Texte enrichi
Affiche du texte avec substitution de variables. Peut inclure du LaTeX inline (`$...$`) et du gras/italique. Exemple : `"Soit f la fonction définie par f(x) = @a·x² + @b·x + @c."`.

#### `equation` — Équation LaTeX
Affiche une équation en bloc (centré). Peut être accompagné d'un champ de saisie si l'utilisateur doit résoudre l'équation.

#### `question` — Question à réponse courte
L'utilisateur saisit une réponse textuelle ou mathématique. La correction est automatique via le système d'évaluation (voir §3.5). Supporte plusieurs formats de réponse attendue.

#### `mcq` — Question à choix multiple
Boutons radio ou cases à cocher. Les options peuvent contenir du LaTeX. La bonne réponse est définie dans le JSON de l'exercice.

#### `variation_table` — Tableau de variations
Génère un tableau de variations d'une fonction : valeurs remarquables en abscisse, valeurs de f en ordonnée, flèches montantes/descendantes selon le signe de f'.

#### `sign_table` — Tableau de signes
Tableau indiquant le signe d'une expression selon les intervalles : `+`, `-`, `0`, `||` (discontinuité).

#### `graph` — Graphe 2D
Trace une ou plusieurs fonctions sur un repère. Paramètres : fenêtre d'affichage (`xMin`, `xMax`, `yMin`, `yMax`), liste de fonctions avec expressions mathématiques utilisant les variables de l'exercice.

#### `sequence` — Suite numérique
Affiche les premiers termes d'une suite (définition explicite ou récurrente). L'expression du terme général peut utiliser les variables de l'exercice.

#### `discrete_graph` — Nuage de points
Tracé de points discrets sur un repère, utile pour représenter des suites ou données statistiques.

### 3.4 Évaluation des réponses

Le module `frontend/app/utils/math/evaluation.ts` centralise la vérification des réponses. Il supporte plusieurs **formats de réponse attendue** :

| Format | Logique de vérification |
|--------|------------------------|
| `number` | Comparaison numérique avec tolérance (≈ 0.0001) |
| `text` | Comparaison de chaînes (insensible à la casse) |
| `expression` | Évaluation des deux expressions, comparaison du résultat numérique |
| `interval` | Parsing de la notation intervalle (`]-∞;2]`, `[1;5[`) et vérification d'appartenance |
| `fraction` | Réduction en forme irréductible, comparaison numérateur/dénominateur |
| `set` | Parsing de la notation ensemble (`{-1; 2; 5}`), comparaison des membres |
| `complex` | Normalisation et comparaison des nombres complexes |

**Pipeline de parsing** : l'entrée utilisateur (LaTeX ou notation usuelle française) est convertie en syntaxe mathjs via `toMathJsSyntax()` :
- `\frac{a}{b}` → `((a)/(b))`
- `\sqrt{x}` → `sqrt(x)`
- `2x` → `2*x` (multiplication implicite)
- `,` → `.` (séparateur décimal)

### 3.5 Pipeline de rendu complet

```
Données JSON exercice (depuis DB)
        │
        ▼
generateVariables()          ← Génère les valeurs aléatoires
        │
        ▼
ExerciseRenderer.tsx          ← Orchestre l'affichage
        │
        ├─► TextRenderer         → Texte substitué + LaTeX inline
        ├─► EquationRenderer     → Bloc LaTeX + input optionnel
        ├─► QuestionRenderer     → Input + checkAnswer()
        ├─► MCQRenderer          → Boutons radio/checkbox
        ├─► VariationTableRenderer → Tableau HTML
        ├─► SignTableRenderer    → Tableau HTML signes
        ├─► GraphRenderer        → Canvas 2D (fonctions tracées)
        └─► SequenceRenderer     → Liste de termes
        │
        ▼
onElementSubmit(elementId, answer, isCorrect)
        │
        ▼
Enregistrement tentative en DB (exercise_attempts)
```

### 3.6 Création d'exercices

Les exercices sont stockés en JSON dans la table `exercises` de la base de données (colonnes `variables` et `elements` de type `JSONB`). Il n'existe pas d'éditeur graphique intégré à Novlearn ; les exercices sont créés directement en JSON. Un endpoint admin (`GET /api/admin/claude-exercises`) permet de lister des exercices générés par IA.

---

## 4. Pages et fonctionnalités frontend

Le frontend suit la structure **Next.js App Router** : chaque dossier sous `frontend/app/` correspond à une route.

### 4.1 Pages principales (authentifiées)

#### `/accueil` — Dashboard
Page d'accueil post-connexion. Résumé des activités récentes, accès rapide aux principales fonctionnalités.

#### `/entrainement` — Entraînement adaptatif
**Page centrale de l'application.**

Flux :
1. Appel `GET /api/recommend-exercise` → l'algorithme backend choisit l'exercice et la difficulté.
2. L'exercice est chargé depuis la DB et instancié (variables générées côté client).
3. L'utilisateur répond aux éléments de l'exercice.
4. À chaque réponse, une tentative est enregistrée (`exercise_attempts`).
5. Les scores de compétence sont mis à jour.
6. Un nouvel exercice est recommandé.

Le composant `ExerciseLoader.tsx` gère les états de chargement/erreur. Le rendu est délégué à `ExerciseRenderer.tsx`.

#### `/progression` — Suivi de progression
Visualisation des scores par compétence sur chaque chapitre. Affiche :
- Ratio points / max_points par compétence (barres de progression)
- Streak courant et streak maximum
- Statistiques globales (exercices résolus, taux de réussite)

#### `/classement` — Classement
Leaderboard en trois onglets :
- **Mensuel** : score accumulé sur le mois en cours
- **Hebdomadaire** : score de la semaine
- **Taux de réussite** : classement par pourcentage de bonnes réponses

#### `/duel` — Lobby duels
Liste les défis en attente (reçus), l'historique des duels terminés, et permet de défier un ami. La sélection de l'adversaire passe par le système d'amis.

#### `/duel/active/[id]` — Duel en cours
Interface de jeu temps réel. Connectée au serveur Colyseus via WebSocket. Affiche l'exercice, le score des deux joueurs, le timer et l'état d'avancement.

#### `/flashcards` — Flashcards
Mode mémorisation par chapitre. Questions/réponses rapides, chargées depuis la table `flashcards`.

#### `/ds` — Devoirs Surveillés (liste)
Liste les assignations créées ou reçues.

#### `/ds/nouveau` — Créer un DS
Formulaire de création : titre, date limite, compétences ciblées.

#### `/ds/[id]` — Détail d'un DS
Progression sur les compétences de l'assignation, accès aux exercices associés.

#### `/cours` — Chapitres / cours
Navigation par chapitre. Peut inclure des ressources de cours ou renvoyer vers le mode entraînement filtré par chapitre.

#### `/compte` — Profil utilisateur
Informations personnelles (prénom, nom, date de naissance), avatar, statistiques globales.

#### `/parametres` — Paramètres
Préférences : notifications (push, email), chapitres masqués, apparence (mode sombre).

#### `/classes` — Gestion de classes (tuteurs)
Fonctionnalité pour les enseignants : gestion de groupes d'élèves.

#### `/feedback` — retirée
L'ancien tableau de consultation administrative des feedbacks a été supprimé. L'envoi des retours élèves reste disponible dans la modale de feedback intégrée à l'application; la consultation administrative est centralisée dans Novlearn-Admin.

### 4.2 Pages d'authentification

| Route | Description |
|-------|-------------|
| `/auth/login` | Connexion email/mot de passe ou Google OAuth |
| `/auth/signup` | Inscription (email, prénom, nom, date de naissance) |
| `/auth/forgot-password` | Demande de réinitialisation de mot de passe |
| `/auth/update-password` | Changement de mot de passe (depuis lien email) |
| `/auth/verify-email` | Vérification de l'adresse email |
| `/auth/callback` | Callback OAuth (échange du code contre session) |

### 4.3 Pages d'invitation

#### `/invite/[code]` — Invitation ami
Lien partageable. Lorsqu'un utilisateur connecté visite ce lien, il envoie automatiquement une demande d'ami à l'auteur du code.

### 4.4 Pages légales

`/cgu`, `/privacy`, `/politique-confidentialite`, `/sitemap`.

### 4.5 Architecture frontend interne

#### Gestion de l'état global

| Store / Context | Contenu |
|----------------|---------|
| `AuthContext` | `user`, `profile`, `session`, `loading` |
| `useTaxonomyStore` (Zustand) | Chapitres et compétences (chargés une fois au démarrage) |
| `ThemeContext` | Mode sombre / clair |

#### Proxy API (développement)

`next.config.mjs` redirige `/api/*` → `http://localhost:8010/api/*`. En production, le reverse proxy Apache fait la même chose.

---

## 5. Backend API (FastAPI)

**Port** : 8010 (dev) / 8011 (staging)  
**Fichier principal** : `backend/main.py`

Tous les endpoints protégés requièrent un header `Authorization: Bearer <JWT>`. Le JWT est vérifié via `supabase.auth.get_user(token)`.

### 5.1 Recommandation d'exercices

#### `GET /api/recommend-exercise?chapter=<optionnel>`

Logique en cascade :
1. Si pas de chapitre → sélectionne le chapitre optimal via `select_chapter_for_recommendation()` (chapitre avec le plus de compétences faibles).
2. Vérifie si un test de positionnement est en cours ou doit être lancé (`fetch_or_start_test()`).
3. Sinon, appelle l'algorithme de recommandation principal.

**Retourne** : `{exercise_id, competences[], difficulty_level, difficulty, mode: "test"|"recommendation"}`

#### Algorithme de recommandation (`backend/recommandation.py`)

L'algorithme est basé sur deux entrées :
- **Streak courant** : calculé sur les 20 dernières tentatives (correct = +1, incorrect = -1).
- **Ratio par compétence** : `points / max_points` pour chaque compétence du chapitre.

| Streak | Comportement |
|--------|-------------|
| < −5 | Confiance très basse → compétence maîtrisée + difficulté facile/moyen |
| −5 à −1 | Confiance basse → compétence la plus faible + facile/moyen |
| −1 à +2 | Normal → compétence médiane faible + facile/moyen |
| ≥ +2 | Haut → compétence la plus déficiente + moyen/difficile |

La sélection des compétences faibles utilise un **tri par fusion (merge sort)** sur les ratios. Le fallback si aucun exercice n'est disponible est un exercice aléatoire.

### 5.2 Test de positionnement (`backend/chapter_placement_test.py`)

#### `POST /api/chapter-test/next`
Reçoit `{chapter, last_success: boolean}` et retourne le prochain exercice de test ou `{completed: true}`.

**Structure du test** :
- 2 exercices par compétence : facile d'abord, puis moyen si réussi.
- 3ème exercice (difficile) seulement si les deux premiers sont réussis.
- Maximum ~20–30 questions (limitées aux 10 compétences à plus fort poids).
- Scoring : le succès à chaque niveau initialise les points de compétence (de 10 % à 30 % du max selon la difficulté).

#### `GET /api/chapter-test/status?chapter=<optionnel>`
Indique si l'utilisateur a complété le test de positionnement pour un chapitre.

### 5.3 Système d'amis

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/friends/code` | GET | Récupère ou génère le code d'invitation de l'utilisateur |
| `/api/friends/add-by-code` | POST | Envoie une demande d'ami via un code |
| `/api/friends` | GET | Liste les amis acceptés (avec profils) |
| `/api/friends/{id}` | DELETE | Supprime un ami |
| `/api/friends/requests` | GET | Liste les demandes en attente |
| `/api/friends/requests/{id}/accept` | POST | Accepte une demande |
| `/api/friends/requests/{id}/decline` | POST | Refuse une demande |

### 5.4 Système de duels (lobby)

Le lobby est géré par le backend FastAPI. La partie elle-même se déroule sur le serveur Colyseus.

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/duels/create` | POST | Crée un défi (`{friend_id}`) → status = "waiting" |
| `/api/duels/{id}/accept` | POST | Accepte → status = "active" |
| `/api/duels/{id}/decline` | POST | Refuse → supprime le duel |
| `/api/duels/pending` | GET | Défis reçus en attente |
| `/api/duels/active` | GET | Duels actifs (pour redirection automatique) |
| `/api/duels/history` | GET | 50 derniers duels terminés |

### 5.5 DS (Devoirs Surveillés)

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/ds` | POST | Crée une assignation |
| `/api/ds` | GET | Liste les assignations |
| `/api/ds/{id}` | GET | Détail avec scores par compétence |
| `/api/ds/{id}/recommend` | GET | Recommande un exercice pour l'assignation |
| `/api/ds/{id}/submit` | POST | Soumet une réponse |
| `/api/ds/{id}` | DELETE | Supprime |

### 5.6 Notifications

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/notifications/vapid-public-key` | GET | Clé publique VAPID pour Web Push |
| `/api/notifications/preferences` | GET/PUT | Préférences de notification |
| `/api/notifications/subscribe` | POST | Enregistre un abonnement push |
| `/api/notifications/subscribe` | DELETE | Supprime l'abonnement |

Un **scheduler APScheduler** (actif uniquement en production) envoie des notifications quotidiennes (récapitulatif, rappel d'entraînement).

### 5.7 Autres endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/exercises` | Liste paginée de tous les exercices |
| `DELETE /api/delete-account` | Suppression de compte (RGPD) |
| `GET /api/admin/claude-exercises` | Liste exercices générés par IA (admin) |

---

## 6. Serveur temps réel — Duels (Colyseus)

**Port** : 2567  
**Technologie** : Colyseus (Node.js, WebSocket)  
**Fichier** : `duel-server/src/rooms/DuelRoom.ts`

### 6.1 État partagé (`DuelState`)

L'état de la partie est synchronisé entre tous les participants via le protocole Colyseus (`@type` decorators) :

```
DuelState {
  player1Id, player2Id
  player1Name, player2Name
  player1Score, player2Score
  phase: "lobby" | "playing" | "finished"
  duelStartedAt, exerciseStartedAt
  duelDurationSeconds
  exerciseTimeoutSeconds
  correctionDisplaySeconds
}
```

### 6.2 Flux de jeu

```
1. Joueur 1 crée le duel via l'API FastAPI
         └─► duel créé en DB (status="waiting")
         └─► notification envoyée à Joueur 2

2. Joueur 2 accepte via l'API FastAPI
         └─► status="active" en DB

3. Les deux joueurs se connectent à la room Colyseus (auth JWT vérifié)
         └─► onAuth: vérification que l'utilisateur est bien participant

4. Les deux joueurs envoient "ready"
         └─► phase="playing"
         └─► l'exercice est broadcasté

5. Boucle de jeu :
   ├─► Joueur soumet une réponse (message "submitAnswer")
   │       └─► vérification côté serveur
   │       └─► mise à jour du score
   │       └─► si les deux ont répondu ou timeout → exercice suivant
   └─► Timer global (duelDurationSeconds) → fin de partie

6. Fin de partie :
   └─► calcul du vainqueur (score, puis temps en cas d'égalité)
   └─► sauvegarde en DB (table "duels" + "duel_attempts")
   └─► mise à jour des scores de compétence
```

### 6.3 Mécaniques spéciales

- **Grace timer** : 5 secondes accordées au 2ème joueur après que le 1er ait soumis.
- **Skip** : un joueur peut demander de passer l'exercice. Si les deux demandent → passage immédiat.
- **Timeout exercice** : l'exercice avance automatiquement si aucun joueur ne répond dans le délai imparti.

---

## 7. Base de données (Supabase / PostgreSQL)

Les migrations sont versionnées sous `supabase/migrations/`. La base compte une quarantaine de migrations (001–043+).

### 7.1 Tables principales

#### Utilisateurs et profils

| Table | Rôle | Colonnes clés |
|-------|------|---------------|
| `profiles` | Profil utilisateur | `id` (UUID), `email`, `first_name`, `last_name`, `birth_date`, `role`, `avatar_id`, `avatar_color`, `current_streak`, `max_streak`, `hidden_chapters`, `notif_*` |

#### Taxonomie

| Table | Rôle | Colonnes clés |
|-------|------|---------------|
| `chapters` | Chapitres mathématiques | `id`, `name`, `order_index`, `emoji` |
| `competences` | Compétences par chapitre | `id` (TEXT, ex: "analyse_derivees"), `chapter_id`, `name`, `max_points` |

#### Exercices et tentatives

| Table | Rôle | Colonnes clés |
|-------|------|---------------|
| `exercises` | Définitions d'exercices | `id`, `chapter`, `difficulty`, `variables` (JSONB), `elements` (JSONB), `competences` (TEXT[]) |
| `exercise_attempts` | Historique des tentatives | `user_id`, `exercise_id`, `is_correct`, `time_spent`, `attempted_at` |
| `user_competence_scores` | Points par compétence et utilisateur | `user_id`, `competence_id`, `points`, `chapter` |
| `user_chapter_test_completed` | Suivi des tests de positionnement | `user_id`, `chapter` |

#### Duels et multijoueur

| Table | Rôle | Colonnes clés |
|-------|------|---------------|
| `duels` | Métadonnées de duel | `id`, `player1_id`, `player2_id`, `status`, `winner_id`, `player1_score`, `player2_score` |
| `duel_attempts` | Actions durant un duel | `duel_id`, `player_id`, `element_id`, `answer`, `is_correct`, `time_spent` |

#### Social

| Table | Rôle | Colonnes clés |
|-------|------|---------------|
| `friends` | Amitiés (non orientées) | `user1_id`, `user2_id`, `status` |
| `friend_requests` | Demandes d'amis | `from_user_id`, `to_user_id`, `status` |
| `friend_codes` | Codes d'invitation | `user_id` (PK), `code` (UNIQUE) |

#### Classements (dénormalisés)

| Table | Rôle |
|-------|------|
| `monthly_leaderboard` | Score mensuel par utilisateur |
| `weekly_leaderboard` | Score hebdomadaire |
| `success_rate_leaderboard` | Taux de réussite global |

#### DS et divers

| Table | Rôle |
|-------|------|
| `ds` | Assignations (titre, deadline, compétences ciblées) |
| `ds_competence_scores` | Points par compétence dans une assignation |
| `flashcards` | Cartes mémo par chapitre |
| `feedbacks` | Retours utilisateurs sur les exercices |
| `push_subscriptions` | Abonnements Web Push |

### 7.2 Sécurité (Row Level Security)

Chaque table a des politiques RLS Supabase :
- **Les utilisateurs ne voient que leurs propres données** (`exercise_attempts`, `user_competence_scores`, etc.).
- **Les exercices sont publics** (tous les utilisateurs authentifiés y accèdent).
- **Les admins** (colonne `role = 'admin'` dans `profiles`) contournent la plupart des restrictions.
- **Le backend** utilise la `SUPABASE_SERVICE_KEY` (clé service) qui bypass le RLS → accès total.

---

## 8. Authentification

### 8.1 Supabase Auth

Supabase Auth gère les JWT. Deux fournisseurs supportés :
- **Email / Mot de passe**
- **Google OAuth** (via `supabase.auth.signInWithOAuth`)

### 8.2 Flux frontend (`AuthContext.tsx`)

```
App démarre
    │
    ▼
supabase.auth.getSession()    ← Vérifie la session existante (cookie)
    │
    ├─► Session trouvée → fetch profil DB → setProfile()
    └─► Pas de session → user = null
    │
    ▼
supabase.auth.onAuthStateChange()  ← Écoute les événements auth
    │
    ├─► SIGNED_IN / TOKEN_REFRESHED → fetch profil
    └─► SIGNED_OUT → clear profil
```

Le hook `useAuth()` expose : `{user, profile, session, loading, signIn, signUp, signInWithGoogle, signOut}`.

### 8.3 Flux backend

Chaque requête protégée inclut `Authorization: Bearer <JWT>`. Le backend appelle `supabase.auth.get_user(token)` pour valider et extraire `user_id`. La dépendance FastAPI `Depends(verify_token)` est injectée dans les endpoints concernés.

### 8.4 Middleware Next.js

`middleware.ts` s'exécute côté serveur sur chaque requête. Il rafraîchit la session Supabase si nécessaire, assurant que les Server Components reçoivent toujours un token valide.

### 8.5 Mode invité

`supabase.auth.signInAnonymously()` crée un utilisateur anonyme. Le flag `user.is_anonymous` est `true`. Certaines fonctionnalités (duels, progression persistée) nécessitent un compte complet.

---

## 9. Déploiement et CI/CD

### 9.1 Infrastructure VPS

```
Internet
    │
    ▼
Apache (reverse proxy)
    ├─► / → Next.js (port 3000)
    ├─► /api/* → FastAPI (port 8010)
    └─► /duel-ws/* → Colyseus (port 2567, WebSocket)
```

Les trois services sont gérés par **systemd** sur le VPS.

### 9.2 GitHub Actions

**Déclencheur** : push sur `develop` (staging) ou `main` (production).

**Étapes** :
1. Build du frontend Next.js (avec variables d'environnement injectées).
2. Création du fichier `.env` backend depuis les secrets GitHub.
3. Transfert du code sur le VPS via SCP.
4. Redémarrage des services via systemd.

**Environnements** :
- `develop` → domaine staging (port 8011 backend)
- `main` → `novlearn.fr` (port 8010 backend)

### 9.3 Variables d'environnement

**Frontend** (`.env.local`) :

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=https://novlearn.fr
NEXT_PUBLIC_COLYSEUS_URL=wss://novlearn.fr/duel-ws
NEXT_PUBLIC_GA_ID=G-...
```

**Backend** (`.env`) :

```env
APP_ENV=production
DEBUG=False
HOST=0.0.0.0
PORT=8010
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...      # Clé service (accès total DB)
CORS_ORIGINS=https://novlearn.fr
SCHEDULER_ENABLED=true
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
```

---

## 10. Systèmes transversaux

### 10.1 Streak

Le streak mesure la dynamique récente de l'utilisateur sur les **20 dernières tentatives** :
- Bonne réponse : +1
- Mauvaise réponse : −1
- Clampé dans [−5, +20]

Il est le principal pilote de l'algorithme de recommandation : un streak élevé déclenche des exercices plus difficiles, un streak très négatif déclenche du contenu de reconstruction de confiance.

### 10.2 Taxonomie (chapitres et compétences)

Chargée une seule fois au démarrage via `TaxonomyProvider` et mise en cache dans le store Zustand `useTaxonomyStore`. Disponible dans toute l'application sans requêtes supplémentaires.

Chaque chapitre contient plusieurs compétences avec un `max_points` (plafond de score). Le ratio `points / max_points` est la métrique centrale de l'algorithme de recommandation.

### 10.3 Chapitres masqués

Un utilisateur peut masquer les chapitres qu'il n'a pas encore vus en cours. L'algorithme de recommandation exclut automatiquement ces chapitres, sauf si l'utilisateur choisit explicitement d'y travailler.

### 10.4 Avatars

Chaque profil a un `avatar_id` (type d'avatar : renard, chat, ours…) et un `avatar_color` (couleur hexadécimale). Ces attributs sont affichés dans les profils, le classement et les interfaces de duel.

### 10.5 Notifications

**Web Push** : utilise le protocole Web Push standard (VAPID). Les abonnements sont stockés dans `push_subscriptions`. Déclencheurs : défi de duel reçu, rappel quotidien.

**Email** : SMTP. Déclencheurs : défi de duel, récapitulatif quotidien. Templates dédiés.

**Préférences** : chaque utilisateur configure quels types de notifications il souhaite recevoir (colonnes `notif_*` dans `profiles`).

### 10.6 Sécurité

- **Injection SQL** : impossible via Supabase JS client (requêtes paramétrées).
- **XSS** : les entrées utilisateur affichées en LaTeX sont traitées via MathJax (contexte contrôlé).
- **CORS** : whitelist stricte des origines côté FastAPI.
- **RLS** : isolation des données par utilisateur au niveau base de données.
- **RGPD** : endpoint de suppression de compte (`DELETE /api/delete-account`), suivi de consentement.

---

*Document généré le 25 mai 2026. Basé sur la branche `develop` du dépôt Novlearn.*
