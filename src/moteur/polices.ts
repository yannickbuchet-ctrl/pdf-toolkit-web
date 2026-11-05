/**
 * Le choix des polices pour réécrire un texte, repris de PDF Toolkit 2 sur PC (normalize_font_name, font_family,
 * FONT_SUBSTITUTES, font_chain, split_runs) et de son portage Android (Texte.kt).
 *
 * Différence avec le PC : un navigateur ne donne pas accès aux polices installées (sauf, sur Chrome et Edge, avec
 * l'autorisation de l'utilisateur : voir policesLocales dans texte.ts). Les polices de remplacement sont donc les
 * polices standard du PDF fournies par MuPDF (Nimbus Sans, Nimbus Roman, Nimbus Mono), de mêmes dimensions
 * qu'Helvetica, Times et Courier, c'est-à-dire qu'Arial, Times New Roman et Courier New.
 */

/** "ABCDEF+TimesNewRomanPS-BoldMT", "Times New Roman Bold" -> "timesnewromanbold" */
export function normaliser(nom: string): string {
  let n = nom.includes("+") ? nom.slice(nom.indexOf("+") + 1) : nom;
  n = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  n = n.replace(/regular/g, "").replace(/oblique/g, "italic");
  n = n.replace(/mt$/, "");
  n = n.replace(/ps(bold|italic|bolditalic)?$/, "$1");
  return n;
}

/** Le nom sans le préfixe de sous-ensemble : "ABCDEF+Arial-BoldMT" -> "Arial-BoldMT". */
export function sansPrefixe(nom: string): string {
  return /^[A-Z]{6}\+/.test(nom) ? nom.slice(7) : nom.includes("+") ? nom.slice(nom.indexOf("+") + 1) : nom;
}

const SUFFIXES_STYLE = ["bolditalic", "bold", "italic", "normal", "book", "roman"];

/** Famille sans le style : "Arial-BoldMT" -> "arial", "Calibri0400" -> "calibri", "Times-Roman" -> "times". */
export function famille(nom: string): string {
  let f = normaliser(nom).replace(/\d+$/, "");
  let retire = true;
  while (retire) {
    retire = false;
    for (const s of SUFFIXES_STYLE) {
      if (f.endsWith(s) && f.length > s.length) {
        f = f.slice(0, -s.length);
        retire = true;
      }
    }
  }
  return f;
}

/** Du plus long au plus court : « extrabold » avant « bold ». */
const GRAISSES: [string, number][] = [
  ["extralight", 200], ["ultralight", 200], ["semibold", 600], ["demibold", 600], ["extrabold", 800],
  ["ultrabold", 800], ["thin", 100], ["light", 300], ["regular", 400], ["normal", 400], ["book", 400],
  ["medium", 500], ["bold", 700], ["black", 900], ["heavy", 900],
];

/** Graisse approximative d'après le nom (400 = normal, 700 = gras). */
export function graisse(nom: string): number {
  const n = normaliser(nom);
  for (const [mot, poids] of GRAISSES) if (n.includes(mot)) return poids;
  return 400;
}

/** Famille sans graisse ni italique : "WorkSans-Medium" et "WorkSans-Regular" -> "worksans". */
export function familleDeBase(nom: string): string {
  let f = normaliser(nom).replace(/\d+$/, "").replace(/italic/g, "");
  for (const [mot] of GRAISSES) f = f.split(mot).join("");
  return f;
}

export type Genre = "sans" | "serif" | "mono";

const INDICES_SERIF = [
  "times", "georgia", "garamond", "cambria", "baskerville", "palatino", "bookman", "caslon", "minion", "didot",
  "bodoni", "century", "constantia", "merriweather", "playfair", "lora", "serif", "roman",
];
const INDICES_MONO = ["mono", "courier", "consol", "code", "typewriter"];

/**
 * « mono », « serif » ou « sans » d'après le nom. L'indication « à empattements » des PDF est souvent fausse : on se
 * fie au nom, et une police inconnue est supposée sans empattements.
 */
export function genre(nom: string): Genre {
  const n = normaliser(nom);
  if (INDICES_MONO.some((i) => n.includes(i))) return "mono";
  if (!n.includes("sans") && INDICES_SERIF.some((i) => n.includes(i))) return "serif";
  return "sans";
}

export function estGras(nom: string, indication: boolean): boolean {
  return indication || graisse(nom) >= 600;
}

export function estItalique(nom: string, indication: boolean): boolean {
  return indication || normaliser(nom).includes("italic");
}

/** Les polices standard du PDF, telles que MuPDF les fournit. */
export function standard(g: Genre, gras: boolean, italique: boolean): string {
  const noms = {
    mono: ["Courier", "Courier-Oblique", "Courier-Bold", "Courier-BoldOblique"],
    serif: ["Times-Roman", "Times-Italic", "Times-Bold", "Times-BoldItalic"],
    sans: ["Helvetica", "Helvetica-Oblique", "Helvetica-Bold", "Helvetica-BoldOblique"],
  }[g];
  return noms[(gras ? 2 : 0) + (italique ? 1 : 0)];
}

/**
 * Familles de mêmes dimensions qu'une police standard du PDF : l'équivalent de FONT_SUBSTITUTES sur PC
 * (Helvetica -> Arial, Times -> Times New Roman, Courier -> Courier New), lu dans l'autre sens.
 */
const EQUIVALENCES: Record<string, Genre> = {
  helvetica: "sans", helveticaneue: "sans", arial: "sans", liberationsans: "sans", nimbussans: "sans", arimo: "sans",
  times: "serif", timesnewroman: "serif", liberationserif: "serif", nimbusroman: "serif", tinos: "serif",
  courier: "mono", couriernew: "mono", liberationmono: "mono", nimbusmono: "mono", nimbusmonops: "mono",
  cousine: "mono",
};

/** La police standard de mêmes dimensions, si cette police en a une. */
export function equivalente(nom: string, gras: boolean, italique: boolean): string | null {
  const g = EQUIVALENCES[famille(nom)] ?? EQUIVALENCES[familleDeBase(nom)];
  return g ? standard(g, gras, italique) : null;
}

/** Origine d'une police utilisée pour réécrire un texte, de la plus fidèle à la plus générale. */
export type Provenance = "originale" | "locale" | "equivalente" | "soeur" | "proche";

export interface Candidat<F> {
  police: F;
  nom: string;
  provenance: Provenance;
}

/**
 * Ce qu'on sait d'une police. integree : son fichier est dans le PDF ; reutilisable : la police d'origine elle-même
 * peut servir à écrire (ses codes sont connus), intégrée ou non.
 */
export interface InfoPolice {
  nom: string;
  gras: boolean;
  italique: boolean;
  integree: boolean;
  reutilisable?: boolean;
}

/**
 * Les polices candidates, de la plus fidèle à la plus générale (font_chain sur PC) :
 * 1. la police d'origine, réutilisée telle quelle si ses codes sont connus, ou refaite depuis son fichier intégré ;
 *    une police standard non intégrée (Helvetica) est remplacée par son équivalent de mêmes dimensions ;
 * 2. la même police installée sur l'ordinateur, si l'utilisateur a autorisé leur lecture (Chrome, Edge) ;
 * 3. la même famille dans une autre graisse, intégrée à la page, la plus proche d'abord ;
 * 4. l'équivalent standard de mêmes dimensions, pour les lettres absentes de la police intégrée ;
 * 5. une police standard proche (Helvetica, Times ou Courier, même style), puis sa version complète intégrée.
 * charger : l'objet police d'un nom standard (ou d'un nom suivi de « # » pour la version complète), ou null.
 */
export function chaine<F>(
  origine: InfoPolice,
  policeOrigine: F | null,
  policeLocale: { police: F; nom: string } | null,
  policesPage: [InfoPolice, F][],
  charger: (nom: string) => F | null,
): Candidat<F>[] {
  const resultat: Candidat<F>[] = [];
  const vus = new Set<string>();
  const ajouter = (police: F | null, nom: string, provenance: Provenance, cle = normaliser(nom)) => {
    if (police !== null && !vus.has(cle)) {
      vus.add(cle);
      resultat.push({ police, nom, provenance });
    }
  };
  const gras = estGras(origine.nom, origine.gras);
  const italique = estItalique(origine.nom, origine.italique);
  const equiv = equivalente(origine.nom, gras, italique);
  if (policeOrigine !== null && (origine.integree || origine.reutilisable)) {
    // La police d'origine et son équivalent standard peuvent porter le même nom : ce ne sont pas les mêmes polices
    // (l'une n'a parfois que quelques lettres), les deux restent.
    ajouter(policeOrigine, sansPrefixe(origine.nom), "originale", "#origine");
  } else if (equiv !== null) {
    ajouter(charger(equiv), equiv, "equivalente");
  }
  if (policeLocale) ajouter(policeLocale.police, policeLocale.nom, "locale", "#locale");
  const base = familleDeBase(origine.nom);
  const cible = normaliser(origine.nom);
  const poids = graisse(origine.nom);
  policesPage
    .filter(([info]) =>
      info.integree && familleDeBase(info.nom) === base && normaliser(info.nom) !== cible &&
      estItalique(info.nom, info.italique) === italique)
    .sort(([a], [b]) => Math.abs(graisse(a.nom) - poids) - Math.abs(graisse(b.nom) - poids))
    .forEach(([info, police]) => ajouter(police, sansPrefixe(info.nom), "soeur"));
  if (equiv !== null) ajouter(charger(equiv), equiv, "equivalente");
  const proche = standard(genre(origine.nom), gras, italique);
  ajouter(charger(proche), proche, "proche");
  // Version complète (intégrée) de la police standard : pour les lettres hors du codage WinAnsi (ő, ł, Ω…).
  ajouter(charger(proche + "#"), proche, "proche", "#complete");
  return resultat;
}

/** Itère sur les caractères (points de code) d'un texte. */
export function caracteres(texte: string): number[] {
  const r: number[] = [];
  for (const c of texte) r.push(c.codePointAt(0)!);
  return r;
}

export function estBlanc(cp: number): boolean {
  return cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0xa0 || cp === 0x202f || cp === 0x2009 ||
    (cp >= 0x2000 && cp <= 0x200a) || cp === 0x3000;
}

/**
 * Découpe le texte en morceaux écrits chacun avec la première police qui en a les lettres (split_runs sur PC). Une
 * espace reste dans la police du morceau en cours. Renvoie [rang de la police, morceau] ; rang -1 : aucune police.
 */
export function morceaux(texte: string, nombrePolices: number, couvre: (rang: number, cp: number) => boolean): [number, string][] {
  const res: [number, string][] = [];
  for (const cp of caracteres(texte)) {
    let rang = -1;
    if (estBlanc(cp) && res.length > 0) {
      rang = res[res.length - 1][0];
    } else {
      for (let i = 0; i < nombrePolices; i++) {
        if (couvre(i, cp)) {
          rang = i;
          break;
        }
      }
    }
    const ch = String.fromCodePoint(cp);
    if (res.length > 0 && res[res.length - 1][0] === rang) res[res.length - 1][1] += ch;
    else res.push([rang, ch]);
  }
  return res;
}

/**
 * Le compte rendu pour l'utilisateur. La référence est la police d'origine (ou celle installée sur l'ordinateur), ou,
 * pour une police standard non intégrée (Helvetica), son équivalent de mêmes dimensions.
 * conservee : tout le texte est écrit avec elle.
 */
export function bilan<F>(parts: [number, string][], ch: Candidat<F>[], nomOrigine: string): { conservee: boolean; message: string } {
  const nom = sansPrefixe(nomOrigine);
  const premier = ch[0];
  const reference = premier && ["originale", "equivalente", "locale"].includes(premier.provenance) ? premier : null;
  // La police installée sur l'ordinateur compte aussi comme police d'origine.
  const references = new Set<Candidat<F>>(reference ? [reference] : []);
  for (const c of ch) if (c.provenance === "locale" || c.provenance === "originale") references.add(c);
  let referenceUtilisee = false;
  const emprunts = new Map<string, string>();
  for (const [rang, texte] of parts) {
    const c = ch[rang];
    if (!c) continue;
    if (references.has(c)) {
      referenceUtilisee = true;
    } else {
      const lettres = texte.replace(/\s/g, "");
      if (lettres) emprunts.set(c.nom, (emprunts.get(c.nom) ?? "") + lettres);
    }
  }
  const details = [...emprunts.entries()]
    .map(([police, lettres]) => `« ${[...new Set(caracteres(lettres))].map((c) => String.fromCodePoint(c)).join("")} » en « ${police} »`)
    .join(" ; ");
  const polices = [...emprunts.keys()].map((p) => `« ${p} »`).join(", ");
  if (reference && referenceUtilisee && emprunts.size === 0) {
    if (reference.provenance === "equivalente" && normaliser(reference.nom) === normaliser(nom)) {
      return { conservee: true, message: `Police d’origine « ${nom} » conservée (police standard du PDF).` };
    }
    if (reference.provenance === "originale") return { conservee: true, message: `Police d’origine « ${nom} » conservée.` };
    if (reference.provenance === "locale") {
      return { conservee: true, message: `Police d’origine « ${nom} » conservée (installée sur cet ordinateur).` };
    }
    return {
      conservee: true,
      message: `Police « ${nom} » non intégrée au PDF : remplacée par son équivalent de mêmes dimensions « ${reference.nom} ».`,
    };
  }
  if (reference && referenceUtilisee) {
    return { conservee: false, message: `Police d’origine conservée, sauf pour des lettres qu’elle ne contient pas : ${details}.` };
  }
  return { conservee: false, message: `La police d’origine « ${nom} » n’a pas pu être conservée : texte écrit en ${polices}.` };
}

/**
 * Nom lisible d'une police d'après son nom dans le PDF : [famille, style] (readable_font_name sur PC).
 * "ABCDEF+WorkSans-MediumItalic" -> ["Work Sans", "Medium Italic"] ; "Arial,Bold" -> ["Arial", "Bold"].
 */
export function nomLisible(nom: string): [string, string] {
  const n = sansPrefixe(nom);
  let [fam, ...reste] = n.split("-");
  let style = reste.join("-");
  if (!style) {
    const parts = fam.split(",");
    fam = parts[0];
    style = parts.slice(1).join(",");
  }
  fam = fam.replace(/(PS|MT)$/, "");
  style = style.replace(/MT$/, "");
  const espace = (t: string) => t.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, " ").trim();
  return [espace(fam), espace(style)];
}

/**
 * Textes de la table « name » d'une police TrueType / OpenType : {numéro: texte} (font_names sur PC).
 * 1 famille, 2 style, 4 nom complet, 5 version, 6 nom PostScript, 8 éditeur, 9 créateur, 11 site de l'éditeur,
 * 12 site du créateur, 13 licence, 14 lien de la licence, 0 copyright, 16 / 17 famille et style typographiques.
 * Renvoie {} pour une police sans cette table (Type 1, CFF seule).
 */
export function tableDesNoms(data: Uint8Array): Record<number, string> {
  const vue = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (o: number) => vue.getUint16(o);
  const u32 = (o: number) => vue.getUint32(o);
  const tag = (o: number) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
  try {
    const debut = tag(0) === "ttcf" ? u32(12) : 0;
    const signature = tag(debut);
    if (!(signature === "\x00\x01\x00\x00" || signature === "OTTO" || signature === "true")) return {};
    const nombre = u16(debut + 4);
    let table = -1;
    for (let i = 0; i < nombre; i++) {
      const e = debut + 12 + 16 * i;
      if (tag(e) === "name") {
        table = u32(e + 8);
        break;
      }
    }
    if (table < 0) return {};
    const enregistrements = u16(table + 2);
    const chaines = u16(table + 4);
    const noms: Record<number, string> = {};
    const rangs: Record<number, number> = {};
    for (let i = 0; i < enregistrements; i++) {
      const e = table + 6 + 12 * i;
      const plateforme = u16(e), codage = u16(e + 2), langue = u16(e + 4), id = u16(e + 6), longueur = u16(e + 8), decalage = u16(e + 10);
      const brut = data.subarray(table + chaines + decalage, table + chaines + decalage + longueur);
      let texte: string, rang: number;
      if (plateforme === 0 || plateforme === 3) {
        let s = "";
        for (let k = 0; k + 1 < brut.length; k += 2) s += String.fromCharCode((brut[k] << 8) | brut[k + 1]);
        texte = s;
        rang = langue === 0x0409 ? 0 : 1;
      } else if (plateforme === 1 && codage === 0) {
        texte = String.fromCharCode(...brut);
        rang = 2;
      } else {
        continue;
      }
      texte = texte.replace(/\u0000/g, "").trim();
      if (texte && rang < (rangs[id] ?? 9)) {
        noms[id] = texte;
        rangs[id] = rang;
      }
    }
    return noms;
  } catch {
    return {};
  }
}

/** Le nom de la police d'un fichier CFF (FontFile3 /Type1C ou /CIDFontType0C), lu dans son index des noms. */
function nomCff(data: Uint8Array): string | null {
  try {
    if (data.length < 8 || data[0] !== 1) return null;
    const entete = data[2];
    const nombre = (data[entete] << 8) | data[entete + 1];
    if (nombre < 1) return null;
    const taille = data[entete + 2];
    const lire = (o: number) => {
      let v = 0;
      for (let i = 0; i < taille; i++) v = (v << 8) | data[o + i];
      return v;
    };
    const debutDecalages = entete + 3;
    const debutDonnees = debutDecalages + (nombre + 1) * taille - 1;
    const a = lire(debutDecalages), b = lire(debutDecalages + taille);
    if (b <= a || b - a > 200) return null;
    return String.fromCharCode(...data.subarray(debutDonnees + a, debutDonnees + b));
  } catch {
    return null;
  }
}

/** Les noms qu'une police porte dans son propre fichier (TrueType, OpenType, CFF ou Type 1). */
export function nomsInternes(data: Uint8Array): string[] {
  const noms = new Set<string>();
  const table = tableDesNoms(data);
  for (const id of [6, 4]) if (table[id]) noms.add(table[id]);
  if (table[1]) noms.add(table[1] + (table[2] ?? ""));
  const cff = nomCff(data);
  if (cff) noms.add(cff);
  if (data.length > 6 && (data[0] === 0x25 || data[0] === 0x80)) {
    let debut = "";
    for (let i = 0; i < Math.min(data.length, 4096); i++) debut += String.fromCharCode(data[i]);
    const m = /\/FontName\s*\/([^\s/[\]()<>{}]+)/.exec(debut);
    if (m) noms.add(m[1]);
  }
  return [...noms];
}
