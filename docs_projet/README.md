# Documents projet

Specifications d'origine du projet Novlearn (PE69).

| Fichier | Contenu |
|---|---|
| `Fiche de lancement.txt` | Cadrage initial |
| `Cahier des charges Technique.txt` | Exigences techniques |
| `Charte graphique.txt` | Couleurs, typographies, principes visuels |

## Maquettes Figma — archivees

Les exports Figma `Maquette1/` et `Maquette2/` (146 fichiers : composants
shadcn/ui complets, assets, `AJOUTS_MAQUETTE2.md`) ne sont plus versionnes.
Ils n'etaient importes par aucune partie de l'application : les ecrans
correspondants sont implementes dans `frontend/app/`.

Ils restent accessibles via le tag `archive/maquettes-2026-09` :

```bash
# Consulter la liste des fichiers archives
git ls-tree -r --name-only archive/maquettes-2026-09 -- docs_projet/

# Restaurer les maquettes dans le repertoire de travail
git checkout archive/maquettes-2026-09 -- docs_projet/Maquette1 docs_projet/Maquette2
```
