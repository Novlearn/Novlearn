# Synchroniser le catalogue production vers staging

Deux projets Supabase independants : les migrations gerent le schema, cet outil copie le contenu pedagogique. Aucun serveur ou abonnement supplementaire n'est necessaire.

## Utilisation locale

Prerequis : Node.js 20.12+ et les dependances racine (`npm install`).

1. Copier `.env.catalog-sync.example` vers `.env.catalog-sync.local`.
2. Remplacer les deux references de projet et les deux URL PostgreSQL. Utiliser les connexions **Session pooler**, port **5432**, du bouton **Connect** des dashboards. Une connexion directe fonctionne aussi si IPv6 est disponible. Le mot de passe est celui de la base, pas une cle API. Percent-encoder les caracteres speciaux du mot de passe.
3. Appliquer au staging les migrations correspondant au schema de production. Les migrations presentes dans ce depot ne garantissent pas a elles seules de recreer le schema reel : notamment 028 suppose que `exercises_claude` existe deja. Verifier et completer le schema initial avant toute premiere copie.
4. Executer depuis la racine :

```powershell
npm run db:sync:catalog
npm run db:sync:catalog -- --apply
```

La premiere commande donne les nombres d'ajouts, de mises a jour, de lignes identiques et de lignes propres au staging. Elle n'ecrit dans aucune base. La seconde applique les changements.

Ajouter `--flashcards` pour copier egalement cette table :

```powershell
npm run db:sync:catalog -- --flashcards
npm run db:sync:catalog -- --apply --flashcards
```

## Contenu copie

- `chapters`, puis `competences`, puis `exercises`.
- `flashcards` seulement avec l'option explicite.
- Toutes les colonnes non generees de ces tables en production, y compris contenu JSON, tableaux, flags et dates.

Les exercices et competences conservent leurs IDs de production. Les chapitres sont rapproches par **nom** : un chapitre deja present en staging conserve son UUID, et les references `competences.chapter_id` sont adaptees. Cela gere les UUID differents generes par les migrations des deux projets. Un chapitre absent est insere avec l'UUID de production. Un conflit d'UUID sur un autre nom fait echouer la transaction ; aucun renommage automatique n'est tente.

Les comptes, profils, tentatives, scores, duels, DS et feedbacks ne sont pas copies. Les exercices propres au staging sont conserves s'ils ont un ID absent de production. Pour un ID deja importe depuis la production, **la production remplace les valeurs du staging** : les modifications locales de cet exercice sont ecrasees. Un ID jamais importe qui existe deja en staging avec un contenu different est un conflit : la copie est bloquee pour proteger les exercices propres au staging. Il n'y a pas de fusion bidirectionnelle. Utiliser une plage d'IDs reservee ou une table de brouillons separee pour eviter les collisions. En cas de conflit, choisir un nouvel ID pour le brouillon et adapter ses references avant de relancer ; l'outil ne renumerote pas automatiquement les historiques.

Les exercices supprimes en production restent en staging. Il n'y a volontairement ni DELETE ni TRUNCATE : supprimer des exercices peut nullifier les references dans les historiques. Pour une copie strictement identique, definir d'abord le comportement attendu pour les historiques et brouillons.

## Premiere copie et conflits d'IDs

Le champ `untracked_conflicts` de l'apercu compte les exercices differents sur un ID dont l'origine production n'a pas encore ete enregistree. Un staging neuf ne devrait pas avoir ce conflit.

Si le staging contient **deja une ancienne copie du catalogue de production**, verifier que les IDs conflictuels sont bien ceux de cette ancienne copie, puis adopter ces exercices une seule fois :

```powershell
npm run db:sync:catalog -- --apply --adopt-existing
```

Cette option autorise explicitement leur ecrasement par la production. Ne pas l'utiliser pour resoudre un conflit avec un exercice cree uniquement en staging.

Lors de l'application, une petite table privee `novlearn_catalog_sync.imported_exercises` conserve les IDs importes et la reference du projet source. Elle est creee automatiquement et mise a jour dans la transaction staging ; aucune table de suivi n'est creee en production. Le compte PostgreSQL staging doit pouvoir creer ce schema. Cette table n'est pas exposee par la Data API, le schema refuse l'acces PUBLIC et la RLS est activee sans policy publique.

## Transactions et securite

- Connexion production dans une transaction PostgreSQL **READ ONLY**, avec snapshot coherent pour les tables du catalogue. Pour renforcer la protection, utiliser en production un role avec uniquement SELECT sur ces tables ; il doit egalement pouvoir lire flashcards si cette option est utilisee.
- Verifications avant connexion : deux references distinctes, URLs correspondant aux references, domaines Supabase, base postgres et port 5432. Ces controles supposent que les references configurees identifient correctement la production et le staging.
- TLS avec verification du certificat. Si un certificat n'est pas reconnu, configurer l'autorite de confiance de Node (par exemple NODE_EXTRA_CA_CERTS) ; ne pas desactiver la verification TLS.
- Liste de tables fixe : aucune table utilisateur ne peut etre ajoutee via la ligne de commande.
- Toutes les ecritures staging, verification finale et ajustements des sequences sont dans **une transaction**. Une erreur annule la copie entiere.
- En mode application, les tables cible sont verrouillees pendant la transaction pour empecher les modifications concurrentes. Lancer hors des tests actifs de duel et d'edition ; aucune room Colyseus n'est migree.
- Les colonnes et types sont controles avant copie. Les colonnes supplementaires staging sont acceptees seulement si elles sont generees, nullable ou possedent un defaut. Un changement de schema incompatible doit passer par les migrations.
- Les contraintes et triggers PostgreSQL restent actifs. Un trigger sur une table de catalogue peut avoir ses propres effets ; auditer tout nouveau trigger avant d'etendre le catalogue.
- Le transport conserve le JSON PostgreSQL comme texte pour ne pas arrondir les IDs bigint.
- Le prochain ID des sequences staging est avance si necessaire, jamais diminue. ALTER SEQUENCE permet d'annuler aussi cet ajustement si la transaction echoue.
- Les secrets locaux sont ignores par Git et ne sont jamais affiches. Ne pas publier d'export du catalogue dans un depot.

Apres une modification des competences, redemarrer le backend staging pour recharger son cache en memoire ; rafraichir aussi les clients frontend.

## GitHub Actions

Le workflow manuel `Sync production catalog to staging` propose d'abord un apercu. Cocher `apply` pour appliquer. La case `adopt_existing` correspond a la premiere adoption decrite ci-dessus ; la laisser desactivee normalement. Il utilise l'environnement GitHub **staging** et attend ces secrets :

- `CATALOG_PRODUCTION_PROJECT_REF`
- `CATALOG_STAGING_PROJECT_REF`
- `CATALOG_PRODUCTION_DB_URL`
- `CATALOG_STAGING_DB_URL`

Configurer les secrets avant de lancer le workflow. Aucune synchronisation automatique sur push n'est ajoutee : une copie ne doit pas ecraser par surprise les essais du staging. Les minutes GitHub Actions relevent des quotas habituels du depot.

## Validation

`npm run test:catalog-sync` execute les controles des connexions ainsi que des tests sur un PostgreSQL embarque (PGlite) : apercu sans ecriture, remapping des UUID, JSON et bigint, reexecution idempotente, sequences, protection des brouillons en cas de collision et rollback sur erreur. Ces tests ne contactent aucun projet Supabase.
