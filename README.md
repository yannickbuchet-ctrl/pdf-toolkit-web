# PDF Toolkit Web

Un éditeur de PDF simple et en français qui fonctionne **entièrement dans votre navigateur** : modifier le texte,
organiser et assembler les pages, remplir les formulaires, signer, protéger par mot de passe, compresser, créer des
photos d'identité et comparer deux versions d'un document.

**Ouvrir le site : <https://yannickbuchet-ctrl.github.io/pdf-toolkit-web/>**

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

### Lire et naviguer

- **Ouvrir** un PDF avec le bouton « Ouvrir » ou en le glissant sur la page. Les PDF protégés par mot de passe
  s'ouvrent après saisie du mot de passe.
- **Zoom** avec Ctrl + molette, Ctrl+plus et Ctrl+moins (Ctrl+0 : 100 %), ou à deux doigts sur un écran tactile.
  **Aller à une page** : Ctrl+G, ou le numéro de page dans la barre.
- **Rechercher** (Ctrl+F) sans tenir compte des accents ni des majuscules (« ete » trouve « Été ») ; F3 et Maj+F3
  passent à l'occurrence suivante ou précédente.

### Modifier et ajouter du texte

- **Modifier le texte** : bouton « Modifier le texte » (ou touche T), puis cliquez sur un texte pour le réécrire.
  L'ancien texte est vraiment retiré du fichier. La police d'origine est conservée quand c'est possible, ainsi que la
  taille, la couleur et la position. Un message indique la police utilisée et, si des lettres manquent à la police
  d'origine, lesquelles ont été prises ailleurs.
- **Rechercher et remplacer** (Ctrl+H) : une occurrence à la fois ou toutes ensemble.
- **Ajouter du texte** n'importe où sur la page, en Helvetica, Times ou Courier, à la taille et dans la couleur de
  votre choix, en gras ou en italique.
- **Infos sur les polices** (menu Outils) : nom exact, style, version, éditeur, licence, lettres présentes dans le
  PDF, et liens pour rechercher la police sur Internet ou sur Google Fonts.

### Annoter, remplir, signer

- **Annotations** : surligner, souligner ou barrer du texte, poser une note, dessiner à main levée, tracer un
  rectangle ou une ellipse. La liste des annotations de la page (menu Outils) permet d'en supprimer.
- **Formulaires** : zones de texte, cases à cocher, cases rondes à choix unique (« ○ Oui ● Non ») et listes de choix
  se remplissent directement sur la page.
- **Signatures et images** : signez à la souris, au doigt ou au stylet, ou importez une signature scannée (son fond
  blanc devient transparent) ou une image ; placez-la et redimensionnez-la sur la page.

### Organiser et assembler

- **Pages**, dans la colonne des miniatures : pivoter, déplacer (glisser-déposer, ou Ctrl+flèches), supprimer,
  extraire dans un nouveau PDF, insérer une page blanche ou les pages d'un autre PDF. « Organiser les pages » affiche
  les miniatures en grille.
- **Fusionner des PDF** (menu Outils) dans l'ordre de votre choix. Un PDF glissé sur le document ouvert peut être
  ajouté à la fin, ou ouvert à la place.
- **Annuler et rétablir** chaque opération : Ctrl+Z, Ctrl+Y.

### Comparer deux PDF

Menu Outils → **Comparer deux PDF**. Le document ouvert est proposé comme version A (l'ancienne) ; choisissez la
version B (la nouvelle), puis cliquez sur **Comparer**. **Inverser** échange les deux.

- **Ce qui est comparé** : le texte mot à mot (mots ajoutés en vert, supprimés en rouge, modifiés en orange) et
  l'aspect des pages (images, dessins, couleurs, mise en page : encadrés en violet, avec leur taille et leur position
  en millimètres, par exemple « zone de 0,7 × 1,4 mm à x 93,1 mm, y 50,8 mm »). Les pages ajoutées ou supprimées sont
  repérées sans décaler la suite.
- **Deux affichages** : **côte à côte**, ou **superposées** : chaque page de A et sa page de B en une seule image, ce
  qui n'est que dans A en rouge, ce qui n'est que dans B en vert, ce qui est identique en noir. Passer de l'un à
  l'autre garde l'endroit regardé.
- **La liste des différences** mène à chacune ; F3 et Maj+F3 passent à la suivante ou à la précédente.
- **Réglages** :
  - **Document** (par défaut) : pour les textes, contrats, devis…, avec une tolérance visuelle de 10 %.
  - **Plan technique (circuit, dessin)** : pour les plans et les circuits imprimés, par exemple des couches Gerber
    imprimées en PDF. Rendu deux fois plus fin, tolérance de 5 %, et deux détails qui ne se touchent pas (un via et la
    piste voisine) restent deux différences. Le nom de chaque couche (F.Cu, B.Cu, In1.Cu, F.Silkscreen, Top Layer,
    Perçages…) précède le numéro des pages.
  - Options : ignorer les majuscules, ignorer la ponctuation, comparer le texte seul ou l'aspect seul, tolérance
    visuelle réglable.
- **Rapport PDF** : synthèse, liste numérotée, pages A et B annotées, puis un gros plan de chaque différence (jusqu'à
  150) : la zone et ses abords dans A, dans B et superposés, avec sa position en millimètres.

### Photos d'identité

Menu Outils → **Photos d'identité**, à partir d'une photo :

- choisissez le cadre (aux bonnes proportions, avec l'ovale du visage), redressez, faites pivoter, réglez la
  luminosité et le contraste ;
- formats France et Union européenne, Royaume-Uni, États-Unis, Canada, Chine, Japon, Australie ou sur mesure ;
  papier 10 × 15 cm, 13 × 18 cm, A6, A5, A4, Lettre ou sur mesure ;
- la planche s'imprime à la taille exacte des photos (voir « Impression » plus bas).

La photo entière et les réglages peuvent être joints au PDF pour modifier la planche plus tard (« Outils → Modifier la
planche de photos ») : décochez cette option avant de transmettre le fichier.

### Enregistrer, protéger, imprimer

- **Enregistrer** (Ctrl+S) : avec Chrome ou Edge, le PDF est écrit directement sur le fichier d'origine (le
  navigateur demande l'autorisation la première fois) ; ailleurs, il est téléchargé. **Enregistrer sous** :
  Ctrl+Maj+S.
- **Mots de passe** (menu Outils) : protection par mot de passe (chiffrement AES 256 bits) ou retrait de la
  protection.
- **Compression à l'enregistrement** : sans perte, ou forte (images réduites à environ 150 ppp et recompressées en
  JPEG) pour l'envoi par e-mail. La taille avant et après est affichée.
- **Imprimer** : Ctrl+P.

### Sur téléphone et tablette

Sur un écran étroit, la barre du haut ne garde que l'essentiel (ouvrir, enregistrer, numéro de page, annuler,
rétablir, Outils) et une barre en bas de l'écran, sous le pouce, regroupe le reste :

| Bouton | Rôle |
|---|---|
| Pages | ouvre ou ferme la colonne des miniatures |
| Modifier | mode « Modifier le texte » : touchez un texte pour le réécrire |
| Annoter | remplir les formulaires, ajouter du texte, surligner, poser une note, dessiner, signer, insérer une image |
| Chercher | rechercher et remplacer |
| Plus | zoom, ajuster à la largeur, enregistrer sous, imprimer |

La page est ajustée à la largeur de l'écran dès l'ouverture ; zoomez à deux doigts. Dans la comparaison, l'affichage
« Superposées » est choisi d'office et les options se replient après le calcul (bouton « Options et fichiers » pour
les rouvrir). L'interface suit le mode clair ou sombre de l'appareil.

### Raccourcis clavier

| Touches | Action |
|---|---|
| Ctrl+O, Ctrl+S, Ctrl+Maj+S, Ctrl+P | ouvrir, enregistrer, enregistrer sous, imprimer |
| Ctrl+Z, Ctrl+Y | annuler, rétablir |
| Ctrl+F, Ctrl+H | rechercher, rechercher et remplacer |
| F3, Maj+F3 | occurrence ou différence suivante, précédente |
| Ctrl+G | aller à une page |
| Ctrl+plus, Ctrl+moins, Ctrl+0 | zoom avant, arrière, 100 % |
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

Code source : [github.com/yannickbuchet-ctrl/pdf-toolkit-web](https://github.com/yannickbuchet-ctrl/pdf-toolkit-web).

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
3. si le dépôt change d'adresse, la mettre à jour dans `src/version.ts` (`CODE_SOURCE`) et dans ce README.

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
