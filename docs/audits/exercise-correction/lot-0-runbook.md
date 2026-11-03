# Lot 0 — exécution et revue

Depuis la racine :

```powershell
npm.cmd run test:correction
npm.cmd run correction:catalog:verify
npm.cmd run correction:catalog:replay
```

La première commande exécute backend, frontend, duel puis les scripts lot 0, sans utiliser le catalogue ni un service réel. Les deux suivantes utilisent les fichiers privés déjà présents. L'export est la seule commande avec accès réseau :

```powershell
npm.cmd run correction:catalog:export
```

Elle lit uniquement exercises dans le Supabase configuré par backend/.env. Ne pas publier `.local/exercise-correction/`, ses manifests ou ses rapports détaillés. Un nouveau snapshot crée de nouveaux fichiers et met à jour latest.json ; les anciennes versions sont conservées.

Sur un nouveau checkout, installer les dépendances racine, frontend et duel avec `npm ci`. Préparer un Python 3.11+ compatible dans backend/.venv puis installer backend/requirements-test.txt. La machine validée utilise Python 3.12.14. Le runner sélectionne backend/.venv s'il existe, sinon python ; `CORRECTION_TEST_PYTHON` permet un chemin explicite. Les dépendances ne sont pas installées automatiquement par les tests.

La parité Creator utilise le checkout frère `../Novlearn Creator`. En son absence, la suite est explicitement skipped ; ce skip ne vaut pas validation de parité. Seuls des paramètres synthétiques sont exécutés avec les modules Creator. Le catalogue privé n'est jamais passé à son générateur utilisant new Function.

Pour la couverture frontend :

```powershell
npm.cmd --prefix frontend run test:coverage
```

La couverture inclut désormais le vrai correcteur. Aucun seuil de certification n'est introduit. Les tests algébriques déterministes utilisent 77 couples de fractions et 20 couples de coefficients ; ce sont des vérifications bornées, pas une preuve générale.

Pour revoir le corpus :
1. Lire la justification de chaque cas dans `frontend/__tests__/fixtures/correction-reference.json`.
2. Confirmer le domaine et la syntaxe acceptée avec le produit.
3. Renseigner un relecteur et les décisions, sans remplacer les observations par des vérités.
4. Lors d'une correction, convertir l'échec attendu en assertion ordinaire et mettre à jour la caractérisation avec une explication.
5. Rejouer le snapshot hashé sur les seeds fixées puis relire les contraintes qui ne sont pas contrôlées automatiquement.

Versions de source au début du lot :
- evaluation.ts : `6ddda013d63053b1d2fe4703da0f5cc74353e4c6bc4335bc52a828617518b217`
- parsing.ts : `f94e3a6a71b443e8446d0442540fb6da0ae92fbcc951fa70f91feb3bf1b85cb6`
- variableGenerator.ts : `868c383d3d903213e6153eab3f6cf9d2b5657b0d234156406321a7429b9d2302`

Ces sources applicatives restent inchangées. L'environnement Python et les rapports locaux sont ignorés par Git. Le rapport de statut détaille les validations réalisées et celles encore ouvertes.
