# Recette locale du catalogue

Voir le [lot de livraison](../../docs/catalogue-production-delivery.md) pour les
résultats, les limites et les décisions réservées au responsable.

La répétition utilise PostgreSQL 17.11 de l'image
`public.ecr.aws/supabase/postgres:17.11.0.003`. Son socle source est la base locale
`admin_local` du conteneur `novlearn-catalogue-final-source`, issue de la recette
Admin précédente. Le scénario la clone avant toute mutation ; il ne modifie pas
la base modèle. Ce prérequis n'est pas un projet Supabase hébergé. Sans ce socle,
la partie source est non exécutée et la recette ne peut pas être déclarée verte.

Si le conteneur cible n'existe pas, le créer uniquement en local :

```powershell
docker run -d --name novlearn-transition-20261113 -e POSTGRES_PASSWORD=synthetic-transition-only -p 127.0.0.1:55445:5432 public.ecr.aws/supabase/postgres:17.11.0.003
```

Démarrer la source locale existante si nécessaire, puis depuis NovLearn :

```powershell
docker start novlearn-catalogue-final-source
node supabase/tests/run_production_transition.mjs
node supabase/tests/run_production_application.mjs
```

Le deuxième scénario requiert aussi l'image Node et les archives de dépendances
du superviseur Engine local existant. Il vérifie les empreintes et bloque toute
requête réseau qui ne cible pas la boucle locale. Les ports temporaires sont
55446 pour PostgREST et 3155 pour Engine. Les conteneurs temporaires du scénario
applicatif sont arrêtés à sa sortie. La base, la sauvegarde et les preuves sont
gardées sous `.local/production-transition/` pour inspection et restauration.

La vérification optionnelle des registres privés déjà préparés est :

```powershell
node supabase/tests/verify_historical_candidates.mjs
```

Elle nécessite les candidats privés NovLearn/Admin, reste en lecture seule sur
le PostgreSQL local et ne change aucun `approved=false`. Aucun de ces scripts
ne doit être pointé vers une base hébergée. Ils ne remplacent pas le parcours
humain « À publier » et ne sont pas ajoutés à chaque synchronisation.
