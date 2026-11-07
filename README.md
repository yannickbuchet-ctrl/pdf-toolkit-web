# PDF Toolkit Web

Un éditeur de PDF simple et en français qui fonctionne **entièrement dans votre navigateur** : modifier le texte,
organiser et assembler les pages, remplir les formulaires, signer, protéger par mot de passe, compresser, créer des
photos d'identité et comparer deux versions d'un document.

C'est la version en ligne de [PDF Toolkit 2](https://github.com/yannickbuchet-ctrl/pdf-toolkit-2), l'éditeur PDF pour
Windows, avec le même moteur : MuPDF.

![PDF Toolkit Web : modification d'un texte dans un devis](captures/edition.png)

## Vos documents restent chez vous

- **Rien n'est envoyé.** Le site n'a pas de serveur qui reçoit vos fichiers : le moteur MuPDF, compilé en
  WebAssembly, tourne dans votre navigateur. Vos PDF sont lus et modifiés dans la mémoire de votre appareil.
- **Aucune statistique, aucun traceur, aucune publicité.** Le site ne charge rien depuis un autre site (pas même une
  police de caractères), et sa politique de sécurité interdit d'envoyer des données ailleurs.
- **Hors ligne** : une fois le site ouvert une première fois, il continue de fonctionner sans connexion. Seuls les
  fichiers du site lui-même sont gardés par le navigateur, jamais vos documents.
- Fermer l'onglet efface tout : enregistrez votre document avant.

## Fonctions

- **Ouvrir, enregistrer, imprimer** : bouton « Ouvrir » ou glisser-déposer d'un PDF sur la page. Avec Chrome ou Edge,
  « Enregistrer » écrit directement sur le fichier d'origine (le navigateur demande l'autorisation la première
  fois) ; ailleurs, le PDF est téléchargé.
- **Modifier le texte** : bouton « Modifier le texte », puis cliquez sur un texte pour le réécrire. La police
  d'origine est conservée quand c'est possible, ainsi que la taille, la couleur et la position. Un message indique
  la police utilisée, et, si des lettres manquent à la police d'origine, lesquelles ont été prises ailleurs.
- **Ajouter du texte**, dans la police, la taille et la couleur de votre choix.
- **Rechercher et remplacer**, sans tenir compte des accents ni des majuscules (« ete » trouve « Été »), une
  occurrence à la fois ou toutes ensemble.
- **Annotations** : surligner, souligner ou barrer du texte, poser une note, dessiner à main levée, tracer un
  rectangle ou une ellipse ; la liste des annotations de la page permet d'en supprimer.
- **Signatures et images** : signez à la souris, au doigt ou au stylet, ou importez une signature scannée (son fond
  blanc devient transparent) ou une image ; placez-la et redimensionnez-la sur la page.
- **Formulaires** : champs texte, cases à cocher et listes de choix se remplissent directement sur la page.
- **Organiser les pages** dans la colonne des miniatures : pivoter, déplacer (glisser-déposer, ou Ctrl+flèches),
  supprimer, extraire dans un nouveau PDF, insérer une page blanche ou les pages d'un autre PDF. « Organiser les
  pages » affiche les miniatures en grille.
- **Fusionner des PDF** dans l'ordre de votre choix ; un PDF déposé sur le document ouvert peut être ajouté à la fin.
- **Mots de passe** : ouverture des PDF protégés, protection par mot de passe (chiffrement AES 256 bits) ou retrait
  de la protection.
- **Compression à l'enregistrement** : sans perte, ou forte (images réduites à environ 150 ppp et recompressées en
  JPEG) pour l'envoi par e-mail. La taille avant et après est affichée.
- **Infos sur les polices** : nom exact, style, version, éditeur, licence, lettres présentes dans le PDF, et liens
  pour rechercher la police sur Internet ou sur Google Fonts.
- **Photos d'identité** : à partir d'une photo, choisissez le cadre (aux bonnes proportions, avec l'ovale du visage),
  redressez, faites pivoter, réglez la luminosité et le contraste. Formats France et Union européenne, Royaume-Uni,
  États-Unis, Canada, Chine, Japon, Australie ou sur mesure ; papier 10 × 15 cm, 13 × 18 cm, A6, A5, A4, Lettre ou
  sur mesure. La planche s'imprime à la taille exacte des photos. La photo entière et les réglages peuvent être joints
  au PDF pour modifier la planche plus tard (« Outils → Modifier la planche de photos ») : décochez cette option avant
  de transmettre le fichier.
- **Comparer deux PDF** : les deux versions côte à côte, avec les différences surlignées : mots ajoutés en vert,
  supprimés en rouge, modifiés en orange, et images, dessins, couleurs ou mise en page changés encadrés en violet, avec
  leur taille et leur position en millimètres (« zone de 0,7 × 1,4 mm à x 93,1 mm, y 50,8 mm »). Les pages ajoutées ou
  supprimées sont repérées sans décaler la suite. Les différences se lisent de l'ancienne version (A) vers la nouvelle
  (B) ; le document ouvert est proposé comme version A, et « Inverser » échange les deux. La liste des différences mène
  à chacune (F3 et Maj+F3). Options : ignorer les majuscules, la ponctuation, comparer le texte seul ou l'aspect seul,
  tolérance visuelle.
  - **Affichage « Superposées »** : chaque page de A et sa page de B en une seule image, où ce qui n'est que dans A
    apparaît en rouge, ce qui n'est que dans B en vert, et ce qui est identique en noir. C'est l'affichage proposé sur
    téléphone, où les options et les fichiers se replient après la comparaison (bouton « Options et fichiers »).
  - **Réglage « Plan technique (circuit, dessin) »**, pour les plans et les circuits imprimés (couches Gerber imprimées
    en PDF) : rendu deux fois plus fin, tolérance de 5 %, et des zones distinctes pour deux détails qui ne se touchent
    pas (un via et la piste voisine), jusqu'à 150 par page. Le nom de chaque couche (F.Cu, B.Cu, In1.Cu, F.Silkscreen,
    Perçages, Top Layer…), lu dans le texte de la page ou dans son étiquette, précède le numéro des pages.
  - **Rapport PDF** : synthèse, liste numérotée, pages A et B annotées, puis un gros plan de chaque différence (jusqu'à
    150) : la zone et ses abords dans A, dans B et superposés, avec sa position en millimètres.
- **Annuler et rétablir** chaque opération (Ctrl+Z, Ctrl+Y), zoom (Ctrl + molette), aller à une page (Ctrl+G).
- Interface utilisable au clavier, sur tablette et sur téléphone, en mode clair ou sombre selon votre système.

### Raccourcis clavier

| Touches | Action |
|---|---|
| Ctrl+O, Ctrl+S, Ctrl+Maj+S, Ctrl+P | ouvrir, enregistrer, enregistrer sous, imprimer |
| Ctrl+Z, Ctrl+Y | annuler, rétablir |
| Ctrl+F, Ctrl+H, F3, Maj+F3 | rechercher, remplacer, occurrence suivante ou précédente |
| Ctrl+G | aller à une page |
| Ctrl+plus, Ctrl+moins, Ctrl+0 | zoom |
| T | mode « Modifier le texte » |
| Échap | revenir à la lecture, annuler une saisie |

## Différences avec la version Windows

Un navigateur protège votre ordinateur : un site ne peut pas tout faire. Voici ce qui change.

- **Polices installées sur l'ordinateur.** Sur Windows, PDF Toolkit 2 réécrit un texte avec la police installée quand
  elle n'est pas intégrée au PDF. Un site n'y a pas accès, sauf avec **Chrome ou Edge** : dans « Outils → Infos sur
  les polices », le bouton « Utiliser les polices de cet ordinateur » le permet, avec votre autorisation. Sinon, la
  police d'origine intégrée au PDF est réutilisée, et les lettres qui lui manquent sont prises dans la police
  standard la plus proche (Helvetica, Times ou Courier, aux mêmes dimensions qu'Arial, Times New Roman et Courier New).
- **Enregistrer sur le fichier d'origine** n'est possible qu'avec Chrome et Edge. Firefox et Safari téléchargent une
  copie (dans le dossier « Téléchargements »).
- **Impression** : le navigateur imprime une image de chaque page (150 ppp, 300 ppp pour les photos d'identité). Pour
  une planche de photos d'identité, choisissez dans la fenêtre d'impression le bon papier, des marges « Aucune » et
  l'échelle « 100 % » : un site ne peut pas imposer ces réglages à l'imprimante, alors que la version Windows le fait.
  Pour un document de plusieurs formats de page, le navigateur ajuste chaque page à la feuille.
- **Photos d'identité** : l'outil « tronquer » de la version Windows n'existe pas ; les planches qui en contiennent
  sont relues correctement. En revanche, le navigateur lit plus de formats de photo (WebP, et HEIC avec Safari).
  Les réglages joints à la planche sont écrits au même format que sur Windows (compatibilité non vérifiée dans
  l'autre sens).
- **PDF aux droits limités** (impression ou copie interdites, sans mot de passe d'ouverture) : ces limites sont
  retirées à l'enregistrement, un message le signale.
- **Taille** : tout le document est en mémoire, et chaque opération annulable en garde une copie (au plus 50 copies
  et 400 Mo). Avec un très gros PDF sur un téléphone, la mémoire peut manquer.
- **Comparaison de documents sans rapport** : quand deux PDF n'ont presque aucune suite de mots en commun, le texte
  d'un très grand bloc n'est pas comparé mot à mot (cela prendrait des minutes) : il est signalé comme supprimé et
  ajouté, page par page. Un même texte simplement coupé autrement en lignes, lui, est toujours comparé mot à mot.
- **Comparaison en cours** : elle ne peut pas être interrompue.
- **Comparaison superposée** : elle s'affiche une fois la comparaison faite (sous Windows, dès l'ouverture des deux
  fichiers). Une page présente dans une seule version y est montrée seule, au lieu d'être omise.
- **Rapport de comparaison** : il est écrit en Helvetica, la police standard des PDF, au lieu d'Arial : les flèches y
  deviennent « -> » et « <-> ». Les gros plans de A et de B reprennent la page en vectoriel, comme sous Windows ; la
  superposition est une image.

## Navigateurs pris en charge

Le site vise les versions récentes de **Chrome, Edge, Firefox et Safari**, sur ordinateur, tablette et téléphone :
il a besoin de WebAssembly, des Web Workers et des modules JavaScript dans les workers, présents dans tous ces
navigateurs depuis 2023. Il a été essayé avec Chromium ; Firefox et Safari n'ont pas encore été essayés. Le premier
chargement télécharge le moteur MuPDF : environ 5 Mo si le serveur le compresse (c'est le cas de GitHub Pages),
10 Mo sinon.

## Licence

PDF Toolkit Web est distribué sous la licence **GNU AGPL v3** (voir [LICENSE](LICENSE)). Ce choix est imposé par
[MuPDF](https://mupdf.com/) (Artifex Software), sous licence AGPL : toute personne qui met ce logiciel à
disposition, y compris sur un site web, modifié ou non, doit aussi en publier le code source.

Code source : **[À COMPLÉTER : adresse du dépôt]** (à indiquer aussi dans `src/version.ts`, `CODE_SOURCE`).

Licences des composants tiers : [LICENCES-TIERCES.md](LICENCES-TIERCES.md).

## Crédits

- Application écrite par **Claude Code** (Claude Opus 5.5) sous la direction de **Yannick Buchet**.
- [MuPDF et MuPDF.js](https://mupdf.com/) (Artifex Software, AGPL) pour le traitement des PDF.

---

## Développer

### Installer

Il faut [Node.js](https://nodejs.org/) 22 ou plus récent (avec npm). Sous Windows, prenez l'installateur « LTS » sur
nodejs.org, ou, sans droits d'administrateur, l'archive zip « Windows Binary » décompressée dans un dossier de votre
choix, que vous ajoutez au `PATH` de la session :

```powershell
$env:Path = "C:\chemin\vers\node;$env:Path"
node -v
```

Puis, dans le dossier du projet :

```
npm install
```

### Lancer en développement

```
npm run dev
```

Vite affiche l'adresse locale (par défaut <http://localhost:5173>).

### Tester

```
npm test                              # tests de la logique (Vitest, MuPDF WebAssembly dans Node)
npm run build                         # vérification TypeScript, puis construction dans dist/
npx playwright install chromium       # une seule fois : navigateur sans fenêtre
node scripts/parcours-navigateur.mjs  # parcours dans le site construit, captures dans captures/
```

Les tests créent leurs propres PDF (aucun document personnel n'est utilisé) et relisent les fichiers produits :
modification du texte (police standard, police intégrée complète, police réduite, TrueType, accents, page pivotée),
pages, fusion, mots de passe, compression, formulaires, annotations, recherche, dimensions exactes des photos
d'identité et lecture sûre de leurs réglages, comparaison et rapport.

Si le dossier `Exemples Gerber` existe à côté du projet (deux révisions d'une carte de circuit imprimé, avec la liste
des modifications faites), `tests/comparaison-gerber.test.ts` compare les deux cartes A4 et vérifie que chaque
modification est trouvée, sur chacune de ses pages, sans fausse alerte (réglage « Plan technique » : 24 différences,
aucune manquée ; réglage « Document » : seul le perçage agrandi de 0,05 mm échappe), ainsi que les noms des couches,
la superposition et les gros plans du rapport. Le parcours dans le navigateur compare aussi ces cartes, sur ordinateur
et sur téléphone. Sans ce dossier, ces essais sont sautés.

### Construire

```
npm run build
```

Le résultat, `dist/`, est un site statique aux chemins relatifs : il peut être servi depuis n'importe quel dossier.
Pour fixer un chemin de base (sous-dossier d'un site) : `BASE=/pdf-toolkit-web/ npm run build`
(PowerShell : `$env:BASE = "/pdf-toolkit-web/"; npm run build`). `npm run preview` sert `dist/` en local.

Le service worker (`public/sw.js`) n'est actif que sur HTTPS ou `localhost`. Changez son nom de cache
(`CACHE`) à chaque version pour libérer l'ancien.

### Déployer sur GitHub Pages

Le fichier `.github/workflows/pages.yml` teste, construit et publie le site sur GitHub Pages. Il ne se lance que
manuellement (onglet « Actions » → « Publier sur GitHub Pages » → « Run workflow »). Avant la première publication :

1. créer le dépôt sur GitHub et y pousser la branche `main` ;
2. dans Settings → Pages, choisir la source « GitHub Actions » ;
3. compléter l'adresse du code source dans `src/version.ts` (`CODE_SOURCE`) et dans ce README.

### Organisation du code

| Dossier ou fichier | Rôle |
|---|---|
| `src/moteur/` | logique PDF avec MuPDF : texte (`texte.ts`, `polices.ts`, `segments.ts`, `tableUnicode.ts`), document et pages, compression, photos d'identité, comparaison et rapport |
| `src/worker.ts` | le moteur dans un Web Worker : documents ouverts, annuler et rétablir |
| `src/ui/` | l'interface : application, outils et fenêtres, photos d'identité, comparaison |
| `tests/` | tests Vitest et fabrique de PDF de test |
| `scripts/parcours-navigateur.mjs` | parcours dans Chromium sans fenêtre |
| `public/` | service worker, manifeste et icône |

À noter pour MuPDF.js 1.28 (vérifié par les tests) : enregistrer le document de travail avec des options
`garbage` ou `encrypt` le modifie en mémoire et l'abîme si on recommence ; l'application enregistre donc toujours
une copie fraîche (`enregistrerCopie`). Et `garbage=3` ou plus peut fusionner à tort deux formulaires XObject
semblables : l'application s'en tient à `garbage=2`.
