# Roadmap candidate

Cette liste consolide des questions ouvertes visibles dans le code et les audits. Elle n'est ni datée ni approuvée; l'équipe doit choisir le périmètre et les priorités avant d'en faire un plan de livraison.

| Ordre proposé | Décision ou travail | Condition de sortie |
|---|---|---|
| 1 | Décider si le test de placement par chapitre reste un produit. Son code dépend de tables supprimées par la migration 019. | Choisir de restaurer le parcours avec une migration vérifiée, ou retirer proprement le flux devenu hors périmètre. |
| 2 | Définir les règles de correction, de tentatives et de score par mode (entraînement, devoir, duel). | Règles pédagogiques approuvées et cas de référence relus par une personne compétente en mathématiques. |
| 3 | Réexaminer les propositions de moteur/correction et de design avec le code actuel. | Confirmer ce qui reste pertinent; établir un état de référence, des critères d'acceptation et les vérifications nécessaires avant toute migration. |
| 4 | Choisir des indicateurs de réussite et organiser une validation avec élèves/enseignants. | Définitions de mesure, période et seuils convenus; aucune donnée personnelle superflue collectée. |

## Résumé des audits mathématiques (octobre 2026)

Les audits historiques ont relevé trois sujets à revalider avant toute refonte : l'équivalence d'expressions dépend du domaine et des conventions de précision/forme; les contrats de génération et de correction divergent entre les parcours élève, duel et outil auteur; les effets de tentatives, de passage et d'abandon ne sont pas identiques selon le mode. Ces observations précèdent l'intégration actuelle de l'archive Engine 0.2.1 et ne sont pas certifiées comme défauts actuels.

Le fixture [`correction-reference.json`](../../frontend/__tests__/fixtures/correction-reference.json) contient 35 cas synthétiques. Son fichier indique que la revue pédagogique reste à faire; il ne certifie pas la correction générale du moteur. Les audits détaillés ont été retirés lors de la consolidation documentaire. Les fichiers `sql-proposals/` restent des brouillons distincts, pas des étapes de cette roadmap.
