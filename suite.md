# Audit technique de NovLearn

**Périmètre :** snapshot du dépôt sur la branche `chore/cleanup`, inventaire des fichiers, lecture des configurations, d’un échantillon représentatif des routes, composants, migrations et tests, et consultation du site public. Aucun code n’a été modifié. Je n’ai pas exécuté de tests ni accédé aux comptes d’hébergement, aux secrets GitHub, à la console Supabase, aux journaux de production ou à Google Search Console : certains points d’infrastructure et de production restent donc à confirmer.

## 1. Executive summary

NovLearn a déjà une base utile : trois services clairement identifiables, une API REST, Supabase Auth avec PostgreSQL et RLS, des migrations, une PWA, une staging, des tests unitaires et une documentation plus fournie que beaucoup de projets de cette taille.

Les risques les plus urgents sont concrets :

1. **Next.js est verrouillé en version `15.5.12`.** Une vulnérabilité critique affectant l’optimisation des images AVIF est corrigée à partir de `15.5.24`. La version `15.5.27` est indiquée comme version de maintenance corrigée dans la publication Next.js du 30 septembre 2026. À traiter immédiatement, en confirmant que le serveur public expose bien l’optimiseur d’images Next.js, activé par défaut dans cette configuration. [Avis de sécurité Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [versions corrigées annoncées](https://nextjs.org/blog)
2. **Le duel fait confiance à la réponse du client.** Le serveur Colyseus reçoit `isCorrect` fourni par le navigateur et l’utilise pour attribuer des points.
3. **Les scores et tentatives sont modifiables depuis le navigateur.** Le composant d’exercice calcule et écrit les scores avec le client Supabase ; les policies permettent à un utilisateur authentifié d’écrire ses propres scores et tentatives.
4. **Staging et production semblent utiliser le même projet Supabase.** Le workflow de staging construit les services avec les mêmes secrets Supabase et GA que la production.
5. **La table `profiles` est lisible par tous les utilisateurs authentifiés.** La policy autorise `SELECT USING (true)`, sans limiter les colonnes, ce qui peut exposer des données de profil plus larges que nécessaire.

**Recommandation centrale :** conserver l’architecture et l’hébergement VPS actuels pour le moment. Corriger d’abord les problèmes de sécurité et d’isolation, puis fiabiliser le déploiement et l’API. Ni une migration vers un monorepo Turborepo, ni une migration de plateforme ne sont justifiées à ce stade.

## 2. Stack actuelle détectée

| Élément | Technologie identifiée | Ce qui reste inconnu |
|---|---|---|
| Frontend | Next.js App Router `15.5.12`, React `18.3.1`, TypeScript `5.9.3`, Tailwind `3.4.19` ; versions résolues dans le lockfile frontend | Version Node réellement utilisée en production |
| API principale | FastAPI `0.128.0`, Python, Pydantic `2.12.0`, Uvicorn | Version Python de production |
| Temps réel | Colyseus `0.17.8`, TypeScript | Capacité et configuration réelles de la machine |
| Données | PostgreSQL managé via Supabase ; accès par SDK JavaScript et Python | Région, taille, plan et état effectif de la base distante |
| Authentification | Supabase Auth ; session Supabase côté web, vérification du token auprès de Supabase côté API | Paramètres de sécurité configurés dans le projet distant |
| Hébergement | VPS avec Apache en reverse proxy, services systemd en production | Fournisseur, prix, CPU/RAM, sauvegardes VPS |
| TLS / domaine | Apache et chemins de certificats Let’s Encrypt configurés ; `www` redirigé vers le domaine sans `www` | Fournisseur DNS et présence éventuelle d’un CDN |
| Stockage applicatif | Aucun service d’upload utilisateur identifié dans le code inspecté ; assets statiques sous `frontend/public` | Buckets éventuels créés dans Supabase |
| Emails | Envoi par SMTP via variables d’environnement backend | Fournisseur SMTP |
| Notifications | Web Push avec VAPID ; rappels planifiés par APScheduler dans FastAPI | Services et limites de l’instance de production |
| Analytics | Google Analytics via `@next/third-parties/google`, conditionné par `NEXT_PUBLIC_GA_ID` | Configuration GA, consentement et mesure séparée par environnement |
| Tâches planifiées | APScheduler embarqué dans le processus FastAPI | Exécution et suivi effectifs en production |
| ORM | Aucun ORM détecté ; requêtes Supabase/PostgREST directement depuis les SDK | — |

La cartographie observée dans le code et les fichiers de déploiement :

```text
Navigateurs
    │ HTTPS
    ▼
Apache sur VPS ── TLS, routage des requêtes HTTP et WebSocket
    ├── Next.js : 3000
    │     ├── SDK Supabase côté navigateur
    │     └── routes Next.js avec service role côté serveur
    ├── FastAPI : 8010 ───────────┐
    └── Colyseus : 2567 ──────────┤
                                  ▼
                    Supabase : Auth + PostgreSQL
```

Staging utilise les ports `3001`, `8011` et `2568`. L’utilisation de la même base Supabase en staging et en production doit être vérifiée dans la configuration GitHub, mais les secrets injectés dans le workflow indiquent qu’ils sont partagés.

## 3. Architecture actuelle

Le dépôt contient quatre blocs applicatifs distincts : `frontend/`, `backend/`, `duel-server/` et `supabase/`, accompagnés de `apache/`, `systemd/`, `.github/workflows/` et `docs/`.

Le modèle trois services est cohérent avec le produit : Next.js pour le web et quelques routes serveur, FastAPI pour le lobby et les fonctions métier, Colyseus pour l’état temps réel des duels. Supabase fournit la base et l’authentification. La frontière n’est toutefois pas encore nette : une partie de la logique métier et des écritures de données restent dans le navigateur, et Next.js, FastAPI et Colyseus possèdent chacun une clé service role côté serveur.

Les principaux parcours du client web communiquent directement avec Supabase. En conséquence, un client mobile futur ne pourrait pas utiliser proprement toute la logique existante sans reproduire les écritures aujourd’hui effectuées dans l’interface.

## 4. Points positifs

- La séparation Next.js / FastAPI / Colyseus correspond aux différents besoins du produit.
- FastAPI assemble des routeurs par domaine dans [`backend/main.py`](</C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn/backend/main.py>) ; les endpoints de recommandation, duels, amis, DS et notifications sont répartis sous `backend/routers/`.
- Les migrations SQL sont versionnées dans `supabase/migrations/` et comprennent une refonte RLS à la migration 025.
- Le modèle d’exercices est fortement typé et discriminé dans `frontend/app/types/exercise.ts`.
- L’authentification s’appuie sur Supabase Auth ; le service role est une variable serveur, pas une variable `NEXT_PUBLIC_*`.
- Le workflow possède déjà deux chemins de déploiement, staging sur `develop` et production sur `main`.
- Des tests existent dans `backend/tests/`, `duel-server/src/__tests__/` et `frontend/__tests__/`.
- Les tokens CSS, un thème clair/sombre, `next/font` et une PWA sont déjà présents.
- La documentation est substantielle, notamment [`README.md`](</C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn/README.md>), [`ARCHITECTURE.md`](</C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn/ARCHITECTURE.md>) et [`README-TESTS.md`](</C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn/README-TESTS.md>).

## 5. Problèmes critiques

| Gravité | Emplacement | Problème et conséquence | Correction recommandée |
|---|---|---|---|
| **Critique – à vérifier et corriger immédiatement** | `frontend/package-lock.json`, `frontend/next.config.mjs` | Next.js `15.5.12` est antérieur au correctif `15.5.24` de l’avis critique sur l’optimisation AVIF. Le package `sharp` est installé et aucune désactivation de l’optimiseur n’apparaît dans la configuration. | Mettre à jour Next.js sur la branche 15 vers une version corrigée actuelle, au minimum `15.5.27` selon la publication du 30 septembre 2026 ; vérifier l’accès public à `/_next/image` et reconstruire. |
| **Critique pour l’intégrité des duels** | `duel-server/src/rooms/DuelRoom.ts` | `SubmitAnswerMsg` inclut `isCorrect`. `handleSubmitAnswer` s’en sert pour enregistrer la tentative et attribuer un point. Un client modifié peut annoncer une bonne réponse. | Faire calculer la correction par le serveur avec l’exercice, les variables et la réponse brute ; ignorer le booléen fourni par le client. |
| **Importante pour l’intégrité des scores** | `frontend/app/components/Exercise/ExerciseLoader.tsx`, migration `025` | Le navigateur calcule le nouveau score et écrit dans `user_competence_scores`. Il transmet aussi le résultat de tentative. Les policies autorisent ces écritures sur les lignes propres à l’utilisateur. | Faire vérifier et écrire les tentatives et scores côté API ou dans une fonction PostgreSQL contrôlée. Retirer les permissions client qui permettent de fixer ces résultats. |
| **Importante – confidentialité** | Migration `025_rls_security_overhaul.sql` | La policy `profiles_select_others` autorise chaque utilisateur authentifié à lire tous les profils (`USING (true)`). Les règles RLS filtrent des lignes, pas les champs : elles ne limitent pas la lecture à un prénom public. | Exposer uniquement les champs publics avec une vue ou une RPC ciblée ; restreindre la lecture directe des profils. |
| **Importante – isolation des environnements** | `.github/workflows/deploy.yml` | Le build staging utilise les mêmes noms de secrets Supabase et GA que la production (`NEXT_PUBLIC_SUPABASE_URL`, service key et GA ID). Les valeurs dédiées au staging ne sont pas visibles dans le dépôt. Risque de tests qui modifient la production et de données staging mélangées. | Créer un projet Supabase staging distinct, des secrets GitHub dédiés, et séparer SMTP, VAPID et GA. |
| **Importante – autorisation** | `frontend/app/admin/dashboard/page.tsx`, `middleware.ts`, `frontend/app/components/Layout.tsx` | Le menu masque l’accès admin selon `profile.role`, mais le chemin `/admin/dashboard` n’est pas dans les routes protégées par rôle du middleware et la page ne montre pas de vérification de rôle serveur. Un lien masqué n’est pas une barrière d’autorisation. | Refuser les données du dashboard côté API ou serveur sans rôle autorisé ; contrôler aussi l’accès à la route. |
| **Moyenne à importante – suppression de compte** | `frontend/app/api/delete-account/route.ts` | Plusieurs suppressions sont lancées avec `Promise.all`, mais leurs erreurs de requête ne sont pas examinées avant la suppression de l’utilisateur Auth. Certaines données peuvent rester si une suppression échoue. | Remplacer par une procédure transactionnelle ou une séquence vérifiée avec retour d’état fiable et journalisation. |
| **Moyenne** | `backend/auth.py` | Chaque requête protégée appelle `supabase.auth.get_user(token)`, donc ajoute un aller-retour réseau ; les exceptions sont renvoyées dans le détail de réponse d’erreur. | Réduire les détails d’erreur exposés ; mesurer la latence avant d’envisager une validation locale du JWT. |

L’avis Next.js d’août 2026 concerne l’optimiseur d’images lorsqu’il traite des AVIF malveillants ; le correctif cité est `15.5.24`. La note de version Next.js annonce ensuite `15.5.27` pour une série d’avis de sécurité du 30 septembre. Le dépôt ne permet pas de confirmer le trafic ou l’exposition réelle de ces routes, mais la version doit être mise à niveau sans attendre.

## 6. Audit code

| Emplacement | Problème observé | Gravité | Solution |
|---|---|---:|---|
| `frontend/app/components/Exercise/ExerciseLoader.tsx` | Chargement, évaluation, score, sauvegarde et état UI sont mêlés dans un composant client important. | Importante | Déplacer évaluation et écriture métier côté API ; découper le flux d’exercice en modules ciblés. |
| `frontend/app/contexts/AuthContext.tsx`, composants UI | Plusieurs usages de `any`, dont signatures d’erreurs et rôles de profil. Le compilateur strict est activé, mais `any` annule une partie du bénéfice. | Moyenne | Typer les erreurs avec `unknown` et des types Supabase générés ; typer explicitement les rôles et événements de graphiques. |
| `frontend/app/admin/dashboard/useDashboardData.ts` | Le dashboard lit directement plusieurs tables Supabase et agrège les résultats dans le client. Son fonctionnement est lié aux policies et au schéma. | Importante | Ajouter une API d’agrégats avec autorisation et pagination côté serveur. |
| `backend/auth.py` | Les logs d’authentification sont détaillés ; les erreurs de vérification sont incluses dans le message de réponse. | Moyenne | Logs structurés sans détails sensibles, réponses génériques, identifiant de corrélation. |
| `frontend/app/api/delete-account/route.ts` | Le statut d’erreur des requêtes Supabase de nettoyage n’est pas contrôlé. | Importante | Opération idempotente et vérifiable ; prévoir une trace de suppression complète. |
| `frontend/app/layout.tsx` | Charge KaTeX depuis jsDelivr alors que l’application inclut aussi ses propres outils de mathématiques. Le CSS et le script sont globaux. | Faible à moyenne | Confirmer où KaTeX est réellement nécessaire et le charger localement ou par route/composant. |
| `frontend/app/admin/dashboard/DashboardUI.tsx`, `DetailedCharts.tsx` | Types `any` dans les tooltips Recharts. | Faible | Typer les payloads à partir des structures de séries. |
| `frontend/app/utils/math/`, composants de rendu | Cœur métier mathématique important, mais peu de tests frontend de rendu et validation visibles. | Importante | Prioriser tests unitaires sur parsing, substitution, équivalence et rendu des réponses. |
| `package.json`, packages applicatifs | La CI emploie `npm install` plutôt que systématiquement `npm ci`, malgré les lockfiles. | Moyenne | Utiliser `npm ci` pour des builds reproductibles et détecter les écarts de lockfile. |

Il n’y a pas d’ORM : l’accès direct aux données via les SDK Supabase est simple et convient à ce stade, mais il conduit à du SQL relationnel exprimé à plusieurs endroits du client et de deux services backend. La priorité n’est pas d’ajouter un ORM ; c’est de clarifier qui peut écrire quoi, puis d’encapsuler les opérations métier et les agrégations sensibles.

## 7. Audit architecture

### Choix recommandé : conserver un monorepo léger

Le dépôt contient plusieurs services qui évoluent ensemble et partagent un domaine métier. Le monorepo actuel est donc pertinent. En revanche, il ne déclare pas de workspace pnpm/Turborepo et n’en a pas encore besoin. Le coût d’un nouveau gestionnaire de tâches, d’une refonte des chemins et d’un package partagé serait supérieur au bénéfice immédiat.

Organisation cible : garder `frontend/`, `backend/`, `duel-server/` et `supabase/`, mais distinguer plus clairement UI, accès données et logique métier. Ajouter un package partagé uniquement lorsque du code pur est réellement utilisé par au moins deux applications.

### Cible de séparation

- **UI web :** pages et composants React.
- **Logique web :** hooks et orchestration d’interface.
- **Métier :** règles mathématiques et progression pures, testables sans navigateur.
- **API :** endpoints REST FastAPI et contrats versionnés.
- **Données :** accès DB, migrations et types générés.
- **Services externes :** adaptateurs Auth, SMTP, Web Push et Colyseus.

REST FastAPI est le choix le plus simple pour le web et un futur client mobile. Pas besoin de migrer vers GraphQL ou tRPC. Générer un client TypeScript depuis OpenAPI et adopter des schémas de requête/réponse communs réduirait la duplication tout en gardant les API appelables depuis Expo.

## 8. Audit infrastructure / hébergement

Les fichiers Apache, systemd et le workflow SSH/SCP identifient une production hébergée sur un VPS. Le fournisseur et son prix ne sont pas inscrits dans le dépôt ; le coût actuel précis est donc **impossible à chiffrer ici**. Le site utilise des certificats Let’s Encrypt et un reverse proxy Apache. La présence d’un CDN ou d’un fournisseur DNS particulier n’est pas confirmée.

Le VPS est un choix cohérent et probablement économique pour héberger les trois services ensemble. La dépense Supabase dépend du plan réel. Au tarif publié actuellement consulté, Supabase Free inclut 500 MB de base et 5 GB d’egress, mais les projets peuvent être mis en pause après une semaine d’inactivité ; le plan Pro démarre à **25 $/mois** et inclut notamment les sauvegardes quotidiennes conservées 7 jours. [Tarifs Supabase](https://supabase.com/pricing)

| Scénario | Services envisagés | Coût bas trafic | Limites et appréciation |
|---|---|---:|---|
| **A — zéro coût d’hébergement**, avec compromis | Site marketing statique sur Cloudflare Pages ; Supabase Free ; GitHub Actions dans quota gratuit | 0 $ pour ces éléments | Cloudflare Pages sert les assets statiques gratuitement ; les fonctions sont soumises aux limites Workers, dont 100 000 requêtes/jour et 10 ms de CPU en Free. Supabase Free peut se mettre en pause. FastAPI et Colyseus ne sont pas des remplacements transparents à déployer avec le site statique. Ce n’est donc **pas une cible 0 € complète** pour le produit actuel. [Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| **B — recommandé : garder la production actuelle** | VPS existant pour Next.js, FastAPI, Colyseus et Apache ; Supabase managé ; GitHub Actions | Prix VPS inconnu + Supabase Free ou Pro (25 $/mois selon besoin de garanties) | Aucun portage applicatif. Choisir le plan Supabase selon les besoins de disponibilité et de sauvegarde ; confirmer le prix VPS. |
| **C — croissance** | Déploiement séparé des services dans des conteneurs ; Supabase Pro et pooling ; Redis/driver Colyseus si plusieurs instances ; CDN pour les assets | À chiffrer selon CPU, RAM, base, egress et stockage | À envisager après mesure : autoscaling, multi-instance temps réel et file d’attente ajoutent des coûts et de l’exploitation. |

Cloudflare R2 est une option ultérieure si NovLearn commence à stocker des avatars ou documents : la page de prix indique 10 GB de stockage standard inclus, puis 0,015 $/GB-mois, sans frais d’egress. Rien dans le dépôt n’exige ce service aujourd’hui. [Tarifs R2](https://developers.cloudflare.com/r2/pricing/)

Vercel n’est pas la voie la plus simple pour un transfert complet des trois services ; son plan gratuit Hobby est réservé à un usage personnel ou non commercial. [Conditions Hobby](https://vercel.com/docs/plans/hobby)

## 9. Audit SEO

Le site public répond et redirige `www.novlearn.fr` vers `novlearn.fr/accueil`. La page d’accueil présente un H1 clair — « Révise les maths du Bac en t’amusant » —, une description, des CTA, et les fonctions principales. [Page d’accueil publique](https://www.novlearn.fr/)

La page `/accueil` est cependant un composant client (`"use client"`). Next.js la pré-rend en HTML, et le crawler voit son contenu, mais les CTA reposent sur l’hydratation. Elle pourrait être un Server Component avec des éléments interactifs isolés.

**Lacunes SEO repérées dans le code :**

- `layout.tsx` définit un titre et une description génériques ; aucun `metadataBase`, canonical, Open Graph ou carte Twitter n’est déclaré.
- `frontend/app/sitemap/page.tsx` est un plan de site HTML, pas un sitemap XML.
- Aucun `app/robots.ts`, `app/sitemap.ts`, `robots.txt` ou `sitemap.xml` n’apparaît dans l’inventaire.
- Les pages publiques légales n’ont pas de métadonnées spécifiques visibles.
- Le site n’a qu’une page de présentation indexable riche ; les exercices et parcours sont surtout des fonctionnalités authentifiées, donc peu de contenu pédagogique indexable.
- Les endpoints `/robots.txt` et `/sitemap.xml` n’ont pas renvoyé de contenu au crawler utilisé. Leur code de réponse exact en production n’a pas pu être confirmé.
- La redirection `www` vers sans `www` est cohérente. La redirection de `/` vers `/accueil` dépend du middleware de session, ce qui mérite un canonical explicite vers la page publique de référence.

**Priorité SEO :** donner des métadonnées uniques à la landing page, générer le sitemap XML et le robots, puis publier progressivement des pages de contenu statiques par chapitre/compétence avec des liens vers la pratique. Créer des pages d’exercices indexables seulement si leur contenu est réellement utile et si les réponses ne compromettent pas l’activité.

## 10. Audit performance

Les bonnes bases sont `next/font/google` pour Fredoka avec `display: swap`, les assets servis localement et le fait que des modules lourds comme les graphiques soient dans l’espace dashboard.

Les améliorations à forte valeur :

- Éviter de charger KaTeX globalement si seules certaines routes en ont besoin.
- Vérifier les imports de `mathjs`, `recharts`, `html2canvas` et `jspdf` afin qu’ils restent découpés par route ; le dashboard PDF est le principal endroit à surveiller.
- Les logos publics pèsent environ 637 Ko et 514 Ko ; les compresser ou fournir des formats adaptés.
- Le middleware rafraîchit Supabase Auth sur une grande partie des navigations. Le coût réseau peut être mesuré avant d’optimiser.
- Le chargement aléatoire des exercices fait un `count exact`, puis une requête par offset dans `ExerciseLoader.tsx`. Cette approche peut devenir coûteuse lorsque la table grandit ; mesurer avant de remplacer.
- Il n’y a pas d’information de production sur les Core Web Vitals, le bundle ou les requêtes lentes. Ne pas fixer d’objectif de performance sans mesure de départ.

## 11. Audit sécurité

| Gravité | Observation | Action |
|---|---|---|
| **Critique** | Version Next.js non à jour, avis RCE critique AVIF sur versions antérieures à `15.5.24`. | Mise à jour de sécurité immédiate ; confirmer exposition de `/_next/image`. |
| **Élevée** | Score de duel fondé sur `isCorrect` fourni par le navigateur. | Calcul server-side dans Colyseus. |
| **Élevée** | Scores et résultats d’exercice falsifiables par l’utilisateur propriétaire via ses propres droits RLS. | API d’écriture contrôlée et suppression des écritures directes client. |
| **Élevée** | Lecture globale des profils authentifiés via policy RLS. | Vue publique minimale ; audit des champs email et date de naissance. |
| **Élevée** | Isolation staging/prod non démontrée et secrets partagés dans le workflow. | Clés et DB séparées. |
| **Moyenne** | Dashboard admin sans autorisation serveur claire ; le contrôle de menu est côté client. | Autorisation dans l’API et vérification des politiques DB. |
| **Moyenne** | Aucun header HSTS/CSP/`X-Content-Type-Options`/`frame-ancestors` visible dans les configs Apache inspectées ou `next.config.mjs`. | Configurer des headers adaptés et tester les dépendances CDN avant d’activer CSP. |
| **Moyenne** | Pas de rate limiting applicatif visible sur FastAPI/Next. | Limiter au minimum les endpoints de création de duel, feedback, signup et actions admin. |
| **Moyenne** | La route de suppression ignore les erreurs individuelles de nettoyage. | Nettoyage fiable, vérifié et traçable. |
| **Faible à moyenne** | `MathText.tsx` manipule `innerHTML` pour vider le conteneur ; le sink est à revoir selon la provenance du contenu. | Vérifier le chemin de données et éviter l’injection de contenu utilisateur non filtré. |

Aucun fichier `.env` ou exemple de secrets n’est suivi selon l’inventaire, et les fichiers d’environnement sont ignorés par `.gitignore`. Le workflow crée néanmoins des fichiers d’environnement sur le runner avant leur transfert. La clé service role est nécessaire à certains traitements, mais sa présence dans trois applications serveur accroît l’impact d’une compromission d’un service.

## 12. Audit UI / design system

Le projet possède déjà une base de design system : variables sémantiques en CSS dans `globals.css`, thèmes `.light` et `.dark`, classes Tailwind dérivées des tokens et `next-themes`. Le mode clair/sombre est donc **amorcé**, pas à construire depuis zéro.

La limite principale est l’adoption incomplète : plusieurs pages et composants emploient directement `slate-*`, `bg-white` et d’autres couleurs figées. `layout.tsx` choisit un thème sombre par défaut alors que les pages légales et la landing page codent aussi explicitement leur palette. Le changement de thème n’est pas complètement propagé partout.

**Cible recommandée :** terminer les tokens sémantiques pour surfaces, textes, bordures, états, ombres et espacements ; migrer les composants prioritaires vers eux ; définir les composants de base avant les composants métier. Cela rendra branding et thèmes plus simples sans créer un package UI séparé maintenant.

## 13. Audit base de données

La base est PostgreSQL via Supabase, sans ORM, avec un historique d’environ 45 fichiers SQL. Les migrations montrent des UUID pour les utilisateurs, des IDs séquentiels pour plusieurs entités, des contenus d’exercice JSONB, des clés étrangères, contraintes uniques et indexes de base. La migration 025 applique RLS à plusieurs tables.

Points à améliorer :

- Les types DB ne sont pas manifestement générés et partagés par les clients TypeScript.
- Les migrations sont la source de vérité, mais aucun schéma consolidé séparé ni procédure de migration de production avec vérification n’a été identifié.
- `supabase/config.toml` active le seed `./seed.sql`, mais ce fichier n’est pas présent dans l’inventaire. La reconstruction d’une base locale mérite vérification.
- La policy globale de lecture des profils est la lacune RLS la plus sérieuse observée.
- La permission d’écrire ses propres tentatives et scores permet de falsifier la progression.
- Les lectures analytics depuis le client contournent une couche d’agrégation métier ; centraliser celles-ci dans des requêtes backend ciblées.

Ne pas ajouter Alembic ou Prisma : Supabase CLI et les migrations SQL sont cohérents avec l’architecture existante.

## 14. Audit DevOps

Le workflow `.github/workflows/deploy.yml` déploie sur push `develop` (staging) et `main` (production). Il construit Next.js et Colyseus en CI, puis copie les services sur le VPS et redémarre les processus.

**Ce qui manque ou fragilise le flux :**

- Aucun événement `pull_request` et aucun job obligatoire de tests, lint ou typecheck avant déploiement.
- Les dépendances sont installées par `npm install`, et certaines GitHub Actions sont épinglées sur `@master`.
- Staging démarre backend et frontend avec `nohup` et des fichiers PID, tandis que la production a des units systemd.
- Le workflow construit des fichiers `.env` avec les secrets puis les copie sur le VPS.
- Le déploiement ne semble pas appliquer les migrations Supabase automatiquement ; le commentaire dans `deploy.sh` indique que l’étape migration est désactivée.
- Les tests backend ne sont pas exécutés par le workflow visible.
- L’ordre de copie et redémarrage n’est pas un déploiement atomique avec rollback applicatif documenté.

**Workflow proportionné :** garder `main` comme production et soit conserver `develop` pour staging si l’équipe l’utilise réellement, soit déployer la branche candidate vers staging avant fusion. Dans tous les cas, chaque PR doit passer installation reproductible, lint/typecheck, tests et build. Les migrations restent une étape explicite, revue et sauvegardée.

## 15. Audit professionnalisme

La reprise par une autre équipe est possible grâce au README, à l’architecture documentée, aux scripts de démarrage, aux migrations et aux guides de test. Les commandes de test sont décrites, mais ne sont pas reliées à des barrières CI.

La documentation n’est pas entièrement synchronisée : [`docs/AUDIT_REPRISE.md`](</C:/Users/balth/Desktop/Cours/2A/PAI/Novlearn/docs/AUDIT_REPRISE.md>) décrit encore `backend/main.py` comme un monolithe de 1 230 lignes, alors que le code actuel assemble des routeurs. `ARCHITECTURE.md` cite également des routes ou modules dont certains ne figurent plus dans l’arborescence. Ces documents restent utiles comme historique et pistes, mais leurs diagnostics doivent être revalidés avant application.

Autres lacunes : pas de `.env.example` détecté, seed déclaré mais absent, versions d’environnement partiellement implicites, pas de convention de migration production détaillée ni de runbook incident/restauration identifié.

## 16. Mobile readiness

L’application possède une PWA avec manifest, service worker, notifications push et fonctionnement standalone. Cela améliore l’usage mobile web, mais ne remplace pas une application iOS/Android complète.

Une app React Native + Expo paraît la meilleure option **si** le besoin natif se confirme. Le backend FastAPI REST peut la servir. Ce qui peut être partagé : types d’API, schémas de validation, règles mathématiques pures et calculs déterministes. Ce qui ne devrait pas être partagé : composants React web, accès navigateur, cookies web et composants Tailwind. Le client mobile ne devrait pas écrire directement les scores dans Supabase.

Un wrapper Capacitor pourrait être évalué pour une première présence en store, mais les parcours de duel, l’authentification, les notifications et l’expérience pédagogique interactive pourraient demander trop d’adaptations web. Le natif sur mesure serait prématuré.

**À faire dès maintenant :** conserver les règles métier pures hors composants, faire de l’API REST le point d’entrée des écritures sensibles, générer un client TypeScript depuis OpenAPI et ne pas coupler les règles de domaine à Next.js.

## 17. Architecture cible

Architecture principale recommandée : **VPS actuel + Apache + Next.js + FastAPI + Colyseus + Supabase managé**, avec des écritures métier sécurisées côté serveur.

```text
Web aujourd’hui ───────────────┐
                               ├── REST FastAPI ── PostgreSQL/Supabase
Mobile Expo demain ────────────┘         │
                                        ├── Auth Supabase
Web ── HTTPS ── Apache/VPS ── Next.js   ├── SMTP
                         ├── FastAPI    ├── Web Push
                         └── Colyseus ──┘
                 GitHub Actions : checks → staging → production
```

Cloudflare DNS/proxy et R2 sont des options, pas des changements requis. Ajouter Redis, une file de tâches, des réplicas ou une architecture de services plus distribuée uniquement si une mesure montre un besoin.

## 18. Arborescence cible

```text
/
├── apps/
│   ├── web/                 # évolution future de frontend/
│   ├── api/                 # évolution future de backend/
│   └── duel-server/         # service Colyseus
├── packages/
│   ├── contracts/           # types et client OpenAPI
│   ├── domain/              # logique pure réellement partagée
│   └── validation/          # schémas d’entrées partagés si utile
├── supabase/
│   ├── migrations/
│   ├── seed.sql             # si nécessaire et réellement maintenu
│   └── config.toml
├── infrastructure/
│   ├── apache/
│   ├── systemd/
│   └── scripts/
├── docs/
└── .github/workflows/
```

Cette structure est une direction possible, pas une tâche immédiate. Je garderais les noms et chemins actuels jusqu’à ce que les frontières API et métier soient stabilisées. Il n’y a pas encore assez de partage de code pour justifier un workspace pnpm ou Turborepo.

## 19. Infrastructure cible

| Service | Usage cible | Provider | Coût bas trafic | Limites |
|---|---|---|---:|---|
| Web/API/duels | Trois processus sur la même machine | VPS actuel | Inconnu : fournisseur non identifié | Panne unique, capacité à vérifier |
| PostgreSQL/Auth | Données et identité | Supabase | Free possible pour essais ; Pro à partir de 25 $/mois | Quotas Free et pause après inactivité ; vérifier la sauvegarde réelle |
| DNS/CDN | DNS, cache des assets, protection de base si souhaitée | Cloudflare en option | DNS/CDN de base souvent 0 $ ; confirmer le produit choisi | Ne remplace pas l’hébergement FastAPI/Colyseus |
| Stockage fichiers | Uniquement si uploads apparaissent | Supabase Storage ou R2 | Quotas gratuits possibles | Aucun besoin applicatif avéré aujourd’hui |
| Emails | Notifications et rappels | SMTP actuel, fournisseur à confirmer | Inconnu | Quotas et délivrabilité inconnus |
| Analytics | Mesure d’usage | GA actuel | ID Google Analytics configuré, coût non observable ici | Consentement et séparation des environnements |
| Erreurs / disponibilité | Suivi d’erreurs et uptime | Sentry + moniteur uptime à sélectionner | Offre gratuite à confirmer au moment du choix | Ne pas envoyer de PII dans les événements |
| CI/CD | Builds et déploiement | GitHub Actions + SSH | Selon quotas GitHub | Épingler les actions, séparer secrets staging/prod |

## 20. Plan de migration

Les coûts ci-dessous sont des estimations de charge, pas des changements exécutés. `XS` : moins d’une demi-journée ; `S` : jusqu’à une journée ; `M` : quelques jours.

| Phase | Priorité / taille | Tâche et impact | Dépendances | Zones concernées |
|---|---|---|---|---|
| **0 — sécurité** | P0 / S | Mettre à jour Next.js vers une version corrigée ; vérifier l’optimiseur d’images en production. | Build et validation de régression | `frontend/package.json`, lockfile, `next.config.mjs` |
| **0 — intégrité** | P0 / M-L | Faire calculer les scores de duel côté Colyseus ; retirer la confiance dans `isCorrect`. | Accès au moteur d’évaluation | `duel-server/src/rooms/`, logique math |
| **0 — données** | P0 / M | Centraliser les écritures de score/tentative derrière FastAPI ou RPC contrôlée. | Contrat API, règles de score | `ExerciseLoader.tsx`, FastAPI, migrations RLS |
| **0 — staging** | P0 / S-M | Créer un projet Supabase staging et des secrets dédiés ; séparer GA, SMTP et VAPID. | Accès aux consoles et configuration DNS si nécessaire | GitHub Secrets, workflow, Apache |
| **0 — confidentialité** | P1 / M | Remplacer lecture globale des profils par vue/RPC à champs publics ; réévaluer dashboard. | Définir les champs publics | Migration `025`, requêtes UI/backend |
| **1 — déploiement** | P1 / S | Ajouter PR checks : lint, typecheck, tests, build ; utiliser `npm ci` et actions épinglées. | Décision sur les commandes | `.github/workflows/` |
| **1 — environnements** | P1 / S | Standardiser `.env.example`, variables obligatoires et documentation staging/prod. | Inventaire final des secrets | README, backend, frontend, duel-server |
| **1 — exploitation** | P1 / S | Faire tourner staging sous systemd ; ajouter healthcheck et rollback simple. | Units staging sur VPS | `systemd/`, workflow, Apache |
| **2 — API mobile-ready** | P2 / M | Déplacer écritures métier sensibles et agrégats du dashboard vers REST. | Auth/contrats API clarifiés | FastAPI routers, client API |
| **2 — base** | P2 / S-M | Générer types DB ; documenter procédure de migration et rétablir un seed reproductible. | Vérifier si `seed.sql` doit exister | `supabase/`, scripts |
| **3 — UI/SEO** | P2 / S-M | Compléter tokens clair/sombre ; ajouter métadonnées, canonical, sitemap XML et robots. | Liste des pages publiques indexables | CSS, App Router |
| **4 — mobile readiness** | P3 / M | Générer client TypeScript OpenAPI ; isoler règles métier pures sans extraire un monorepo complet. | API stabilisée | `packages/contracts` éventuel |

## 21. Quick wins

1. Mettre Next.js à jour vers une version de maintenance corrigée.
2. Vérifier et corriger `isCorrect` dans les messages Colyseus.
3. Centraliser l’écriture des scores et résultats d’exercices côté serveur.
4. Créer une base Supabase de staging séparée.
5. Remplacer la lecture globale des profils par une exposition minimale de champs.
6. Ajouter une vérification de rôle côté serveur pour le dashboard admin.
7. Ajouter les checks CI sur pull request avant les déploiements.
8. Revoir la suppression de compte pour vérifier chaque erreur.
9. Ajouter les routes `robots.ts` et `sitemap.ts`, ainsi que canonical et Open Graph.
10. Fournir un `.env.example`, clarifier le seed et mettre à jour les documents d’architecture obsolètes.

## 22. Scores

Notes basées sur les éléments du dépôt, et non sur une inspection des consoles de production.

| Domaine | Note actuelle | Cible |
|---|---:|---:|
| Architecture | 6/10 | 8/10 |
| Code quality | 5/10 | 8/10 |
| System design | 5/10 | 8/10 |
| Sécurité | 3/10 | 8/10 |
| SEO | 4/10 | 8/10 |
| Performance | 5/10 | 8/10 |
| DevOps | 5/10 | 8/10 |
| Documentation | 7/10 | 8/10 |
| Maintenabilité | 5/10 | 8/10 |
| Mobile readiness | 5/10 | 8/10 |

**Maturité technique globale : 5/10.** La structure est crédible et l’application possède de vraies bases ; les lacunes d’intégrité, de confidentialité et de déploiement empêchent pour l’instant de la qualifier de projet professionnellement durci.

## 23. Conclusion

NovLearn n’a pas besoin d’une refonte générale. Le meilleur rendement viendra d’abord de la mise à jour de Next.js, de la validation serveur des réponses et scores, de l’isolation staging/prod et du durcissement des accès aux profils et au dashboard. Ensuite, les PR checks, les métadonnées SEO et la clarification des contrats API réduiront la dette sans interrompre les services ni imposer une migration de fournisseur.