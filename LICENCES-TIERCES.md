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
