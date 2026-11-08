# Licences des composants tiers

PDF Toolkit Web est distribué sous la licence **GNU AGPL v3** (voir [LICENSE](LICENSE)). Le site publié contient
les composants suivants.

## Inclus dans le site

| Composant | Version | Rôle | Licence |
|---|---|---|---|
| [MuPDF](https://mupdf.com/) et [MuPDF.js](https://www.npmjs.com/package/mupdf) (Artifex Software) | 1.28.1 | lecture, rendu, modification et écriture des PDF, compilés en WebAssembly | GNU AGPL v3 (ou licence commerciale d'Artifex) |

MuPDF.js est un seul fichier WebAssembly (`mupdf-wasm.wasm`) qui contient aussi des bibliothèques et des polices
intégrées par Artifex. D'après les sources de MuPDF et les mentions trouvées dans ce fichier, il s'agit notamment de :

| Composant inclus dans MuPDF | Rôle | Licence |
|---|---|---|
| FreeType | lecture des polices | FreeType License (FTL) |
| HarfBuzz | mise en forme du texte | MIT |
| Little CMS (lcms2, version d'Artifex) | gestion des couleurs | MIT |
| OpenJPEG | images JPEG 2000 | BSD 2 clauses |
| jbig2dec | images JBIG2 | GNU AGPL v3 |
| libjpeg (IJG) | images JPEG | licence IJG |
| zlib | compression | licence zlib |
| Brotli | compression | MIT |
| Gumbo | analyse HTML | Apache 2.0 |
| Polices URW Nimbus Sans, Nimbus Roman, Nimbus Mono PS, Standard Symbols, Dingbats ((URW)++ Design & Development) | les 14 polices standard du PDF | distribuées par Artifex avec MuPDF : voir la licence de MuPDF |

La liste exacte et les textes de licence de chaque composant se trouvent dans les sources de MuPDF
(<https://mupdf.com/releases>, dossier `thirdparty/` et fichier `COPYING`). Elle dépend de la façon dont Artifex
compile MuPDF.js : en cas de doute, ce sont ces sources qui font foi.

### Lecteur de photos HEIC

Fichier `heic.worker-….js`, téléchargé seulement à la première photo HEIC (photos d'iPhone) dans un navigateur qui ne
sait pas les lire.

| Composant | Version | Rôle | Licence |
|---|---|---|---|
| [libheif-js](https://github.com/catdad-experiments/libheif-js) (Kiril Vatev) | 1.23.5 | libheif compilé en WebAssembly pour le navigateur | GNU LGPL v3 |
| [libheif](https://github.com/strukturag/libheif) (struktur AG) | 1.23 | lecture du conteneur HEIF, rotation et symétrie de la photo | GNU LGPL v3 |
| [libde265](https://github.com/strukturag/libde265) (struktur AG) | inclus dans libheif-js | décodage des images compressées en HEVC (H.265) | GNU LGPL v3 |

Les textes de la licence LGPL sont dans le paquet npm `libheif-js` (fichiers `LICENSE` et `libheif-wasm/LICENSE`).
Le code source de ces bibliothèques est publié aux adresses ci-dessus. Celui de PDF Toolkit Web (AGPL) l'est aussi :
on peut donc reconstruire le site avec une autre version de ces bibliothèques, comme le demande la LGPL.

### Reconnaissance de texte (OCR)

Client Tesseract.js (fichier `src-….js`, quelques Ko), puis, téléchargés seulement à la première reconnaissance de
texte, les fichiers du dossier `ocr-…/` : `worker.min.js`, une des trois versions de `tesseract-core-…-lstm.wasm.js`
(selon le processeur) et les données `fra.traineddata.gz` et `eng.traineddata.gz`.

| Composant | Version | Rôle | Licence |
|---|---|---|---|
| [Tesseract.js](https://github.com/naptha/tesseract.js) (Jerome Wu, Kevin Kwok, Guillermo Webster, Balearica et contributeurs) | 7.0.0 | client et Web Worker de la reconnaissance | Apache 2.0 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Tesseract compilé en WebAssembly | Apache 2.0 |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) (Google, puis le projet tesseract-ocr), dans une version modifiée par tesseract.js-core | inclus dans tesseract.js-core | moteur de reconnaissance (réseau LSTM) | Apache 2.0 |
| [Leptonica](http://www.leptonica.org/) (Dan Bloomberg), et les bibliothèques d'images qu'il utilise (zlib, libpng, libjpeg…) | inclus dans tesseract.js-core | lecture et traitement des images | licence Leptonica (de type BSD 2 clauses) ; zlib, libpng, IJG |
| Données de langue `fra` et `eng` « best_int » : modèles de [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) (Google) convertis en entiers par le projet Tesseract.js, paquets npm `@tesseract.js-data/fra` et `@tesseract.js-data/eng` (dossier `4.0.0_best_int`) | 1.0.0 | ce que Tesseract sait du français et de l'anglais | Apache 2.0 (données) ; MIT (paquets npm) |
| Inclus dans `worker.min.js` : regenerator-runtime (Facebook), zlib.js (imaya), buffer et ieee754 (Feross Aboukhadijeh), is-url, bmp-js, wasm-feature-detect | — | fonctionnement du Web Worker, décompression des données | MIT ; BSD 3 clauses (ieee754) ; Apache 2.0 (wasm-feature-detect) |

Les textes de la licence Apache 2.0 sont dans les paquets npm `tesseract.js` (`LICENSE.md`) et `tesseract.js-core`
(`LICENSE`). La liste exacte des bibliothèques compilées dans le moteur WebAssembly est dans le dépôt de
tesseract.js-core (dossier `third_party`), qui fait foi. La police sans dessin du calque de texte invisible
(`GlyphLessFont`, 572 octets, dans `src/moteur/ocr.ts`) vient de Tesseract (Apache 2.0), telle que MuPDF l'écrit.

## Utilisés seulement pour construire le site (non publiés)

| Outil | Rôle | Licence |
|---|---|---|
| [Vite](https://vite.dev/) | construction du site | MIT |
| [TypeScript](https://www.typescriptlang.org/) | vérification des types | Apache 2.0 |
| [Vitest](https://vitest.dev/) | tests automatisés | MIT |
| [Playwright](https://playwright.dev/) | parcours dans un navigateur sans fenêtre | Apache 2.0 |
| @types/node | types de Node.js pour les tests | MIT |

## Icônes

Le logo et les icônes de l'interface ont été dessinés pour cette application (fichiers `src/ui/icones.ts` et
`public/icone.svg`) et suivent la licence de l'application.
