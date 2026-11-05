# Vérifications

Les versions exécutées par l'intégration continue sont décrites dans [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Les commandes locales correspondantes sont :

```bash
# Depuis la racine
npm run test:backend
npm run test:duel
npm run test:frontend

# Vérifications de production utilisées par CI
cd frontend && npm run verify:engine && npm test && npx tsc --noEmit && npm run build
cd duel-server && npm run build && npm test
cd backend && python -m pytest
```

Pour cibler un test, utiliser `python -m pytest tests/test_streak.py -v` dans `backend/`, ou `npm test -- <fichier>` dans le service Node concerné. Les tests du backend et du frontend couvrent notamment la recommandation, les notifications, les routes et le rendu d'exercices; ceux du serveur de duels couvrent l'état et les règles de match.

Les tests utilisent des clients Supabase simulés et ne requièrent pas de base distante. Les vérifications de déploiement ou de staging qui requièrent des secrets ou un VPS ne sont pas des tests locaux.
