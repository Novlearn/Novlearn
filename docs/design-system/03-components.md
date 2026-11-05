# 03 — Composants

Catalogue cible, pas liste de créations immédiates. Primitives sans logique métier; composants NovLearn assemblent primitives et contrats existants.

## Primitives communes

| Composant | Statut / variantes recommandées | Accessibilité |
|---|---|---|
| Button | À harmoniser : primary, secondary, outline, ghost, danger; sm/md/lg; loading/disabled | vrai button, type explicite, focus visible |
| IconButton | À créer si répétition, tailles 36/44 | nom accessible obligatoire, cible 44 recommandée |
| Input/Textarea/Select | Inventorier les natifs; défaut/erreur/disabled/readOnly | label lié, aide/erreur via aria-describedby; select natif si suffisant |
| Checkbox/Radio/Switch | Factoriser après inventaire | label; switch seulement pour préférence immédiate |
| Badge | neutral/info/success/warning/danger, plein ou doux | libellé textuel, jamais couleur seule |
| Card | statique ou interactive, selected | pas de boutons imbriqués; focus si navigation |
| Dialog | plusieurs modales existantes; info/form/confirm | piège focus, Escape, retour focus, titre et description |
| Tooltip/Popover/Dropdown | créer seulement si usage l'exige | clavier et focus; info essentielle visible autrement |
| Tabs/Accordion | motifs à inventorier | clavier ARIA, état sélectionné/expanded exposé |
| Alert/Toast | sonner est déjà présent; inline/toast | toast annoncé, erreur persistante inline |
| Progress/Skeleton/Spinner | composants locaux à inventorier | progression nommée/valeur; skeleton non annoncé comme contenu |
| Table/Pagination/Breadcrumb/Navigation | dashboard et navigation | sémantique table/landmark, état courant |
| EmptyState | si motif répété | cause compréhensible et action possible |

## Composants métier élève

| Composant | Rôle, variantes et états |
|---|---|
| ExerciseCard | chapitre/titre/type/difficulté; locked, available, completed; focus et navigation explicite |
| ExerciseStatement | assemble texte, formules, graphes et tableaux dans l'ordre pédagogique |
| MathExpression | façade sur MathText/Latex existants; inline/display/long; KaTeX reste responsable du rendu |
| MathInput | MathInput.tsx existe; empty/filled/focused/disabled/invalid/valid; préserver MathLive et sa gestion de focus; label et annonce d'erreur à vérifier |
| MathKeyboard | clavier virtuel intégré MathLive; conserver son moteur, centraliser seulement configuration/style et tester tactile/clavier matériel |
| AnswerFeedback | correct/incorrect/partial; texte + icône + score, aria-live poli |
| CorrectionPanel | étapes, réponse attendue, replié/ouvert; distinguer correction du verdict moteur |
| HintPanel | fermé/ouvert, indices consommés; bouton nommé et révélation progressive |
| ExerciseProgress | étape/total, texte “2 sur 5” en plus du visuel |
| CompetencyCard/ChapterCard | unseen/in-progress/mastered/locked, état textuel |
| Flashcard/Deck | face, révélation, précédent/suivant; action accessible, geste non obligatoire |
| LearningProgress/StatCard | valeur, unité, période, tendance explicite |

## Admin et Creator

Présents : dashboard admin, validation, création de DS. Éditeur complet d'exercices, prévisualisation/test/publication non repéré; ces éléments restent futurs. Prévoir si validé des sections de formulaire, éditeur de contenu typé, panneau preview utilisant les renderers élève, statut brouillon/publié et confirmation de publication. Ne pas dupliquer MathText, renderers ou moteur de correction.

## Règles de réutilisation

Réutiliser un composant spécialisé si son contrat convient. Extraire une primitive lorsqu'un motif apparaît dans au moins trois usages ou qu'un comportement clavier/accessibilité doit être fiable partout. Variantes limitées nommées; primitives sans Supabase, routing, auth ou logique mathématique. Les callbacks métier restent dans les composants métier.
