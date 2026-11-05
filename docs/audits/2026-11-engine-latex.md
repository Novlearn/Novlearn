# Typographie des pilotes et autorité mathématique — 2 novembre 2026

À la demande de l'utilisateur, correction des formules restées en texte brut
dans les pilotes 122, 124 et 125 : délimiteurs LaTeX pour les suites, indices,
puissances et notation de dérivée. Modification par les champs Texte du Creator
Admin existant, sur Staging uniquement. Aucun ajout de convertisseur heuristique,
de moteur mathématique ni de parcours dans NovLearn.

L'éditeur enregistre ces brouillons en place : identifiants et révision 1
conservés, empreintes des définitions actualisées. Les empreintes initiales du
manifeste restent une preuve historique. Les instantanés antérieurs conservent
leur définition et leur empreinte d'origine ; leur reprise ne réécrit pas le passé.
Les nouvelles ouvertures utilisent les textes corrigés.

Une comparaison SQL en lecture seule avec les premiers instantanés de chaque
pilote confirme l'égalité des métadonnées, de la génération et des éléments après
exclusion du seul champ `text`. Les réponses attendues, politiques, paramètres,
identifiants des options et types de réponse n'ont pas changé. Les cinq pilotes
restent `draft`, sans version active. Aucun contenu publié ou Production modifié.

**Répartition actuelle :** Engine assure l'instanciation et les verdicts côté
serveur pour les exercices canoniques. L'interface NovLearn et MathLive assurent
les contrôles et la saisie ; KaTeX compose les expressions LaTeX. Un moteur de
calcul n'a pas vocation à remplacer cette bibliothèque d'affichage. L'adaptateur
ne calcule pas de réponse et le chemin Engine n'utilise pas `checkAnswer`,
`generateVariables` ou la simplification historique pour établir un verdict.

**La suppression globale de l'ancien moteur n'est pas réalisée.** Le catalogue
historique utilise encore son format et son fonctionnement antérieurs. Sa
conversion validée vers le format canonique doit précéder le retrait de ce code.
Le raccordement progressif ne doit pas être présenté comme une bascule totale.

Les preuves de cette modification sont dans le
[reçu typographique](2026-11-engine-latex-proof.json) et la
[capture de la page NovLearn existante](2026-11-engine-latex.png).
Les réponses privées et saisies ne figurent pas dans ces fichiers de preuve.
Cette correction éditoriale ne change aucun code mathématique ni composant ;
vérification par lecture Staging, comparaison des données et navigateur réel.
