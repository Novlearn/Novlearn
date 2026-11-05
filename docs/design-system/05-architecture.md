# 05 — Architecture technique

## Cible incrémentale

Conserver Next.js/Tailwind et le frontend actuel. Pas de monorepo ni package UI tant qu'un second frontend indépendant n'est pas confirmé.

```text
frontend/app/
  styles/                 # tokens.css éventuel après migration
  components/ui/           # primitives accessibles
  components/Exercise/     # orchestration métier élève
  renderers/               # types de contenus d'exercices
  admin/components/        # assemblages admin/creator
  types/                   # contrats partagés
```

Il s'agit d'une destination possible, pas d'un déplacement à faire au lot fondations. components/ui existe déjà.

## Tokens

Variables CSS sémantiques résolues par thème; Tailwind référence les variables plutôt que des hex pour l'UI sémantique. Garder app-* et content-* comme alias pendant la migration. Retirer les alias seulement après recherche démontrant zéro usage. Palette de graphes nommée séparément des états UI.

## Conventions

Composant TypeScript exporté, props étroites, variantes en unions littérales, mapping interne; className en extension rare. Bouton avec type explicite, disabled natif et focus visible. Champs avec label/help/error. Primitives sans dépendance vers Supabase, auth, routing ou correction mathématique.

Contrat indicatif futur : `type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean; };` Exemple descriptif, aucun code de production ajouté.

## Bibliothèques

Conserver Tailwind, TypeScript, lucide-react, sonner, next-themes, MathLive, KaTeX/MathText et Recharts. Aucun besoin actuel prouvé d'ajouter Radix/shadcn; inventorier les dialogs avant de comparer. MathLive reste propriétaire du champ/clavier. Examiner le CDN KaTeX séparément.

## Partage élève/Creator

Partager tokens, primitives et renderer tant que Creator reste dans la même app Next. Garder formulaires, tables et publication sous admin. Extraire un package seulement si un second client, un cycle de version propre et des frontières de build sont établis.
