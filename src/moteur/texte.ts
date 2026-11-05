/**
 * L'édition du texte par MuPDF, comme dans PDF Toolkit 2 sur PC et son portage Android (MoteurMuPdf.kt) : le morceau
 * de texte est effacé par une redaction (le texte disparaît vraiment du contenu de la page, images et dessins gardés),
 * puis réécrit à la même ligne de base, dans la même taille et la même couleur, avec la police la plus fidèle
 * disponible pour chaque lettre. La page est ensuite relue : si le résultat n'est pas celui attendu, une erreur est
 * levée et l'appelant rétablit le document d'avant.
 *
 * Coordonnées : celles de la page affichée (origine en haut à gauche, rotation du fichier comprise).
 */
import * as mupdf from "mupdf";
import {
  bilan, chaine, estBlanc, estGras, estItalique, equivalente, genre, morceaux, nomsInternes, normaliser, standard,
  type Candidat, type InfoPolice,
} from "./polices";
import { decouper, occurrences, retrouver, type CaracterePage, type Segment } from "./segments";
import { codeStandard, lireTableUnicode, winAnsi } from "./tableUnicode";

export class ErreurPdf extends Error {}

/** Un glyphe à écrire : son code dans la police (en hexadécimal) et son avance, en fraction de la taille. */
interface Glyphe {
  hex: string;
  avance: number;
}

/** Une police avec laquelle écrire : le dictionnaire à placer dans les ressources de la page, et ses glyphes. */
interface Ecriture {
  objet: mupdf.PDFObject;
  glyphe(cp: number): Glyphe | null;
  /** Police intégrée : ses glyphes doivent être vérifiés (une police réduite garde des codes sans dessin). */
  integree?: boolean;
}

/** Le dessin de chaque glyphe d'une police intégrée : true s'il dessine quelque chose. */
const visibilite = new WeakMap<Ecriture, Map<number, boolean>>();

/**
 * Vérifie, en les dessinant, que les glyphes de ces caractères existent vraiment dans la police. Une police réduite
 * (sous-ensemble) garde souvent sa table ToUnicode et ses largeurs complètes, mais les lettres non utilisées n'y ont
 * plus de dessin : écrites avec elle, elles seraient invisibles. Chaque glyphe est écrit dans sa case d'une page
 * d'essai, avec l'objet police du PDF lui-même, et la page est dessinée une seule fois.
 */
function verifierGlyphes(e: Ecriture, cps: number[]) {
  let connus = visibilite.get(e);
  if (!connus) visibilite.set(e, (connus = new Map()));
  const aVoir = [...new Set(cps)].filter((cp) => !connus!.has(cp) && !estBlanc(cp) && e.glyphe(cp) !== null);
  if (aVoir.length === 0) return;
  const case_ = 40, colonnes = 10, lignes = Math.ceil(aVoir.length / colonnes);
  const essai = new mupdf.PDFDocument();
  try {
    const police = essai.graftObject(e.objet);
    let contenu = "";
    aVoir.forEach((cp, i) => {
      const x = (i % colonnes) * case_ + 8, y = (lignes - 1 - Math.floor(i / colonnes)) * case_ + 10;
      contenu += `BT /F 24 Tf ${x} ${y} Td <${e.glyphe(cp)!.hex}> Tj ET
`;
    });
    const page = essai.addPage([0, 0, colonnes * case_, lignes * case_], 0, essai.addObject({ Font: { F: police } }), contenu);
    essai.insertPage(-1, page);
    const pix = essai.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceGray, false, false);
    const px = pix.getPixels(), largeur = pix.getWidth(), hauteur = pix.getHeight();
    aVoir.forEach((cp, i) => {
      const x0 = (i % colonnes) * case_, y0 = Math.floor(i / colonnes) * case_;
      let encre = false;
      for (let y = y0; y < Math.min(y0 + case_, hauteur) && !encre; y++) {
        for (let x = x0; x < Math.min(x0 + case_, largeur); x++) {
          if (px[y * largeur + x] < 160) {
            encre = true;
            break;
          }
        }
      }
      connus!.set(cp, encre);
    });
  } catch {
    for (const cp of aVoir) connus.set(cp, true);
  } finally {
    essai.destroy();
  }
}

/** Le glyphe d'un caractère, s'il existe et, pour une police intégrée, s'il dessine bien quelque chose. */
function glypheSur(e: Ecriture, cp: number): Glyphe | null {
  const g = e.glyphe(cp);
  if (g === null || !e.integree || estBlanc(cp)) return g;
  return visibilite.get(e)?.get(cp) === false ? null : g;
}

const hex = (code: number, octets: number) => code.toString(16).toUpperCase().padStart(octets * 2, "0");

/** Lecture d'une page : ses caractères, et l'objet police de MuPDF de chaque nom de police. */
export interface Lecture {
  caracteres: CaracterePage[];
  polices: Map<string, mupdf.Font>;
}

const couleurRGB = (c: number[]) => {
  const v = (x: number | undefined) => Math.max(0, Math.min(255, Math.round((x ?? 0) * 255)));
  return (v(c[0]) << 16) | (v(c[1]) << 8) | v(c[2]);
};

/** Les caractères des lignes horizontales de la page (les autres ne sont pas modifiables). */
export function lirePage(page: mupdf.Page): Lecture {
  const caracteres: CaracterePage[] = [];
  const polices = new Map<string, mupdf.Font>();
  const st = page.toStructuredText("preserve-whitespace,preserve-spans");
  try {
    let ligne = -1;
    let horizontale = true;
    st.walk({
      beginLine(_bbox, wmode, dir) {
        ligne++;
        horizontale = wmode === 0 && dir[0] > 0.99 && Math.abs(dir[1]) < 0.02;
      },
      onChar(c, origine, font, taille, quad, couleur) {
        if (!horizontale) return;
        const nom = font.getName() ?? "";
        if (!polices.has(nom)) polices.set(nom, font);
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        caracteres.push({
          code: c.codePointAt(0) ?? 0x20,
          x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
          origineX: origine[0], origineY: origine[1],
          police: nom, taille, couleur: couleurRGB(couleur as number[]),
          gras: font.isBold(), italique: font.isItalic(), ligne,
        });
      },
    });
  } finally {
    st.destroy();
  }
  return { caracteres, polices };
}

export function segmentsDePage(page: mupdf.Page): Segment[] {
  return decouper(lirePage(page).caracteres);
}

/** Une police des ressources de la page : son dictionnaire, tel qu'il est référencé, et son fichier s'il est intégré. */
interface RessourcePolice {
  objet: mupdf.PDFObject;
  fichier: Uint8Array | null;
  nom: string;
}

/** Le fichier d'une police intégrée (FontFile, FontFile2 ou FontFile3), ou null. */
export function fichierDePolice(f: mupdf.PDFObject): Uint8Array | null {
  const descendantes = f.get("DescendantFonts");
  let descripteur = f.get("FontDescriptor");
  if (!descripteur.isDictionary() && descendantes.isArray() && descendantes.length > 0) {
    descripteur = descendantes.get(0).get("FontDescriptor");
  }
  if (!descripteur.isDictionary()) return null;
  for (const cle of ["FontFile2", "FontFile3", "FontFile"]) {
    const flux = descripteur.get(cle);
    if (flux.isStream()) {
      try {
        return flux.readStream().asUint8Array().slice();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Parcourt les polices des ressources (de la page et de ses formulaires XObject). */
export function parcourirPolices(ressources: mupdf.PDFObject, rappel: (nomRessource: string, f: mupdf.PDFObject) => void, profondeur = 0) {
  if (!ressources.isDictionary() || profondeur > 3) return;
  const dico = ressources.get("Font");
  if (dico.isDictionary()) {
    dico.forEach((f, cle) => {
      if (f.isDictionary()) rappel(String(cle), f);
    });
  }
  const objets = ressources.get("XObject");
  if (objets.isDictionary()) {
    objets.forEach((x) => {
      const sous = x.get("Subtype");
      if (sous.isName() && sous.asName() === "Form") parcourirPolices(x.get("Resources"), rappel, profondeur + 1);
    });
  }
}

function policesDeLaPage(page: mupdf.PDFPage): Map<string, RessourcePolice> {
  const polices = new Map<string, RessourcePolice>();
  parcourirPolices(page.getObject().getInheritable("Resources"), (_cle, f) => {
    const base = f.get("BaseFont");
    if (!base.isName()) return;
    const r = { objet: f, fichier: fichierDePolice(f), nom: base.asName() };
    // MuPDF nomme parfois la police d'après son fichier (« NimbusRoman-Regular ») plutôt que d'après le PDF
    // (« Times-Roman ») : tous ses noms mènent à la même ressource.
    const noms = [base.asName()];
    const descripteur = f.get("FontDescriptor");
    if (descripteur.isDictionary() && descripteur.get("FontName").isName()) noms.push(descripteur.get("FontName").asName());
    if (r.fichier) noms.push(...nomsInternes(r.fichier));
    for (const nom of noms) {
      const cle = normaliser(nom);
      if (cle && !polices.has(cle)) polices.set(cle, r);
    }
  });
  return polices;
}

/** Les largeurs d'une police CID (tableau W) : code -> largeur en millièmes. */
function largeursCid(descendante: mupdf.PDFObject): Map<number, number> {
  const largeurs = new Map<number, number>();
  const w = descendante.get("W");
  if (!w.isArray()) return largeurs;
  let i = 0;
  while (i < w.length) {
    const premier = w.get(i);
    if (!premier.isNumber()) break;
    const suivant = w.get(i + 1);
    if (suivant.isArray()) {
      for (let k = 0; k < suivant.length; k++) largeurs.set(premier.asNumber() + k, suivant.get(k).asNumber());
      i += 2;
    } else {
      const dernier = suivant.asNumber();
      const l = w.get(i + 2).asNumber();
      for (let c = premier.asNumber(); c <= dernier && c - premier.asNumber() < 65536; c++) largeurs.set(c, l);
      i += 3;
    }
  }
  return largeurs;
}

const policesStandard = new Map<string, mupdf.Font>();

/** Une police standard du PDF, fournie par MuPDF. */
function policeStandard(nom: string): mupdf.Font | null {
  if (!policesStandard.has(nom)) {
    try {
      policesStandard.set(nom, new mupdf.Font(nom));
    } catch {
      return null;
    }
  }
  return policesStandard.get(nom) ?? null;
}

/**
 * La police d'origine comme moyen d'écriture, si ses codes se retrouvent : table ToUnicode, ou codage WinAnsi d'une
 * police latine simple. Une police de type 3 n'est jamais réutilisée.
 */
function reprise(r: RessourcePolice, gras: boolean, italique: boolean): Ecriture | null {
  const dico = r.objet;
  const sousType = dico.get("Subtype");
  if (!sousType.isName()) return null;
  const type = sousType.asName();
  const toUnicode = dico.get("ToUnicode");
  let table: ReturnType<typeof lireTableUnicode> | null = null;
  if (toUnicode.isStream()) {
    try {
      const octets = toUnicode.readStream().asUint8Array();
      let texte = "";
      for (let i = 0; i < octets.length; i++) texte += String.fromCharCode(octets[i]);
      table = lireTableUnicode(texte);
    } catch {
      table = null;
    }
  }
  if (type === "Type0") {
    // Seul le codage Identity-H est sûr : le code est le numéro de caractère CID de la police.
    const encodage = dico.get("Encoding");
    if (!encodage.isName() || encodage.asName() !== "Identity-H" || table === null || table.octets !== 2) return null;
    const descendantes = dico.get("DescendantFonts");
    if (!descendantes.isArray() || descendantes.length === 0) return null;
    const descendante = descendantes.get(0);
    const largeurs = largeursCid(descendante);
    const dw = descendante.get("DW");
    const defaut = dw.isNumber() ? dw.asNumber() : 1000;
    const t = table;
    return {
      objet: dico,
      integree: r.fichier !== null,
      glyphe(cp) {
        const code = t.codes.get(cp);
        if (code === undefined) return null;
        return { hex: hex(code, 2), avance: (largeurs.get(code) ?? defaut) / 1000 };
      },
    };
  }
  if (type === "TrueType" || type === "Type1" || type === "MMType1") {
    const encodage = dico.get("Encoding");
    let nomEncodage: string | null;
    if (encodage.isName()) nomEncodage = encodage.asName();
    else if (encodage.isDictionary() && encodage.get("Differences").isNull()) {
      const base = encodage.get("BaseEncoding");
      nomEncodage = base.isName() ? base.asName() : null;
    } else if (encodage.isNull()) nomEncodage = "StandardEncoding";
    else nomEncodage = null; // un codage avec des différences : trop risqué sans ToUnicode
    let codeDe: (cp: number) => number | null;
    if (table !== null && table.octets === 1) {
      const t = table;
      codeDe = (cp) => t.codes.get(cp) ?? null;
    } else if (nomEncodage === "WinAnsiEncoding") codeDe = winAnsi;
    else if (nomEncodage === "StandardEncoding" && type !== "TrueType") codeDe = codeStandard;
    else return null;
    const premierObj = dico.get("FirstChar");
    const premier = premierObj.isNumber() ? premierObj.asNumber() : -1;
    const largeurs = dico.get("Widths");
    const integree = r.fichier !== null;
    // Police non intégrée sans largeurs (polices standard) : celles de la police standard de mêmes dimensions.
    const metriques = integree ? null : policeStandard(equivalente(r.nom, gras, italique) ?? standard(genre(r.nom), gras, italique));
    return {
      objet: dico,
      integree,
      glyphe(cp) {
        const code = codeDe(cp);
        if (code === null) return null;
        let l: number | null = null;
        if (premier >= 0 && largeurs.isArray() && code - premier >= 0 && code - premier < largeurs.length) {
          l = largeurs.get(code - premier).asNumber();
          // Une police intégrée réduite n'a souvent que les lettres utilisées : largeur nulle = absente.
          if (integree && l <= 0) return null;
        } else if (metriques !== null) {
          const gid = metriques.encodeCharacter(cp);
          if (gid > 0) l = metriques.advanceGlyph(gid) * 1000;
        }
        return l === null ? null : { hex: hex(code, 1), avance: l / 1000 };
      },
    };
  }
  return null;
}

/** Une police ajoutée au PDF par MuPDF (Type 0, codage Identity-H : le code est le numéro de glyphe). */
function ajoutee(doc: mupdf.PDFDocument, police: mupdf.Font, integree = false): Ecriture | null {
  try {
    const objet = doc.addFont(police);
    return {
      objet,
      integree,
      glyphe(cp) {
        const gid = police.encodeCharacter(cp);
        return gid > 0 ? { hex: hex(gid, 2), avance: police.advanceGlyph(gid) } : null;
      },
    };
  } catch {
    return null;
  }
}

/**
 * Une police standard du PDF, non intégrée, en codage WinAnsi : c'est ce qu'écrit la version PC avec les polices
 * « helv », « tiro »… Le fichier reste léger ; la visionneuse l'affiche avec Helvetica, Arial ou un équivalent.
 */
function standardSimple(doc: mupdf.PDFDocument, nom: string): Ecriture | null {
  const police = policeStandard(nom);
  if (police === null) return null;
  try {
    const objet = doc.addSimpleFont(police, "Latin");
    return {
      objet,
      glyphe(cp) {
        const code = winAnsi(cp);
        const gid = police.encodeCharacter(cp);
        return code !== null && gid > 0 ? { hex: hex(code, 1), avance: police.advanceGlyph(gid) } : null;
      },
    };
  } catch {
    return null;
  }
}

/** Les polices installées sur l'ordinateur que l'utilisateur a permis de lire (Chrome, Edge), par nom normalisé. */
export const policesLocales = new Map<string, { nom: string; octets: Uint8Array }>();

function policeLocale(nom: string): { nom: string; octets: Uint8Array } | null {
  return policesLocales.get(normaliser(nom)) ?? null;
}

/** Une modification demandée : le morceau à remplacer (tel que lu) et son nouveau texte. */
export interface Edition {
  cible: Pick<Segment, "texte" | "origineX" | "origineY">;
  texte: string;
}

export interface BilanEdition {
  conservee: boolean;
  message: string;
}

/** La chaîne de polices d'un morceau et le découpage du nouveau texte, choisis avant tout effacement. */
interface Plan {
  segment: Segment;
  texte: string;
  chaine: Candidat<Ecriture>[];
  parts: [number, string][];
}

function planifier(doc: mupdf.PDFDocument, page: mupdf.PDFPage, lecture: Lecture, cible: Segment, texte: string, cache: Map<string, Ecriture | null>): Plan {
  const ressources = policesDeLaPage(page);
  const memoire = <T>(cle: string, f: () => T | null): T | null => {
    if (!cache.has(cle)) cache.set(cle, f() as Ecriture | null);
    return cache.get(cle) as T | null;
  };
  const ecriture = (nom: string, f: mupdf.Font | undefined): Ecriture | null => memoire(`page:${normaliser(nom)}`, () => {
    const r = ressources.get(normaliser(nom));
    if (!r) return f ? ajoutee(doc, f) : null;
    // D'abord la police d'origine elle-même ; sinon, comme sur PC, une police neuve faite de son fichier.
    const gras = estGras(nom, f?.isBold() ?? false);
    const italique = estItalique(nom, f?.isItalic() ?? false);
    const r2 = reprise(r, gras, italique);
    if (r2) return r2;
    if (r.fichier) {
      try {
        return ajoutee(doc, new mupdf.Font(nom, r.fichier), true);
      } catch {
        return null;
      }
    }
    return null;
  });
  const origine = ressources.get(normaliser(cible.police));
  const infoOrigine: InfoPolice = {
    nom: cible.police, gras: cible.gras, italique: cible.italique,
    integree: origine?.fichier != null, reutilisable: origine !== undefined,
  };
  const page2: [InfoPolice, Ecriture][] = [];
  for (const [nom, f] of lecture.polices) {
    const r = ressources.get(normaliser(nom));
    if (!r || normaliser(nom) === normaliser(cible.police)) continue;
    const e = ecriture(nom, f);
    if (e) page2.push([{ nom, gras: f.isBold(), italique: f.isItalic(), integree: r.fichier !== null }, e]);
  }
  const locale = policeLocale(cible.police);
  const ecritureLocale = locale
    ? memoire<Ecriture>(`locale:${normaliser(locale.nom)}`, () => {
      try {
        return ajoutee(doc, new mupdf.Font(locale.nom, locale.octets));
      } catch {
        return null;
      }
    })
    : null;
  const ch = chaine<Ecriture>(
    infoOrigine,
    ecriture(cible.police, lecture.polices.get(cible.police)),
    ecritureLocale ? { police: ecritureLocale, nom: locale!.nom } : null,
    page2,
    (nom) => nom.endsWith("#")
      ? memoire(`complete:${nom}`, () => {
        const f = policeStandard(nom.slice(0, -1));
        return f ? ajoutee(doc, f) : null;
      })
      : memoire(`simple:${nom}`, () => standardSimple(doc, nom)),
  );
  if (ch.length === 0) throw new ErreurPdf("Aucune police utilisable pour écrire ce texte.");
  const cps = [...texte].map((c) => c.codePointAt(0)!);
  for (const c of ch) if (c.police.integree) verifierGlyphes(c.police, cps);
  const parts = morceaux(texte, ch.length, (rang, cp) => estBlanc(cp) || glypheSur(ch[rang].police, cp) !== null);
  const absents = parts.filter(([r]) => r < 0).map(([, t]) => t).join("").replace(/\s/g, "");
  if (absents) {
    throw new ErreurPdf(`Ces caractères ne peuvent être écrits avec aucune police disponible : ${[...new Set(absents)].join(" ")}`);
  }
  return { segment: cible, texte, chaine: ch, parts };
}

/**
 * Efface les morceaux : une redaction sur leurs lettres, réduite en hauteur pour ne pas toucher les lignes voisines
 * (comme sur PC) et d'un rien en largeur pour épargner les mots voisins. Les images et les dessins sont conservés.
 */
function effacer(page: mupdf.PDFPage, segments: Segment[]) {
  for (const s of segments) {
    const marge = (s.y1 - s.y0) * 0.15;
    const a = page.createAnnotation("Redact");
    a.setRect([s.x0 + 0.2, s.y0 + marge, s.x1 - 0.2, s.y1 - marge]);
  }
  page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
}

const nombre = (v: number) => {
  const t = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
};

/** Ajoute du contenu à la fin de la page, le contenu existant étant isolé entre q et Q. */
export function ajouterContenu(doc: mupdf.PDFDocument, page: mupdf.PDFPage, flux: string) {
  const objet = page.getObject();
  const debut = doc.addStream("q\n", {});
  const fin = doc.addStream("Q\n" + flux, {});
  const contenus = objet.get("Contents");
  const nouveaux = doc.newArray();
  nouveaux.push(debut);
  if (contenus.isArray()) for (let k = 0; k < contenus.length; k++) nouveaux.push(contenus.get(k));
  else if (!contenus.isNull()) nouveaux.push(contenus);
  nouveaux.push(fin);
  objet.put("Contents", nouveaux);
}

/** Le dictionnaire de ressources propre à la page (créé, ou copié de celui hérité, si besoin), et l'une de ses catégories. */
export function ressourcesDePage(doc: mupdf.PDFDocument, page: mupdf.PDFPage, categorie: string): mupdf.PDFObject {
  const objet = page.getObject();
  let ressources = objet.get("Resources");
  if (!ressources.isDictionary()) {
    const heritees = objet.getInheritable("Resources");
    ressources = doc.newDictionary();
    if (heritees.isDictionary()) heritees.forEach((v, k) => ressources.put(String(k), v));
    objet.put("Resources", ressources);
    ressources = objet.get("Resources");
  }
  let dico = ressources.get(categorie);
  if (!dico.isDictionary()) {
    ressources.put(categorie, doc.newDictionary());
    dico = ressources.get(categorie);
  }
  return dico;
}

/** Nom libre dans un dictionnaire de ressources : prefixe1, prefixe2… */
export function nomLibre(dico: mupdf.PDFObject, prefixe: string, deja: Set<string> = new Set()): string {
  let n = 1;
  while (!dico.get(prefixe + n).isNull() || deja.has(prefixe + n)) n++;
  return prefixe + n;
}

/** Les opérateurs qui passent de l'espace de la page affichée à celui du PDF. */
export function versPdf(page: mupdf.PDFPage): string {
  const m = mupdf.Matrix.invert(page.getTransform());
  return m.map(nombre).join(" ") + " cm\n";
}

/**
 * Écrit le nouveau texte, morceau par morceau, chacun dans sa police, à la ligne de base donnée (x, y en points de
 * la page affichée). Renvoie la largeur écrite.
 */
function ecrire(doc: mupdf.PDFDocument, page: mupdf.PDFPage, x0: number, y: number, taille: number, couleur: number, parts: [number, string][], ch: Candidat<Ecriture>[]): string {
  const polices = ressourcesDePage(doc, page, "Font");
  const noms = new Map<number, string>();
  const pris = new Set<string>();
  for (const [rang] of parts) {
    if (noms.has(rang)) continue;
    const nom = nomLibre(polices, "EdT", pris);
    pris.add(nom);
    noms.set(rang, nom);
    polices.put(nom, ch[rang].police.objet);
  }
  const r = ((couleur >> 16) & 255) / 255, v = ((couleur >> 8) & 255) / 255, b = (couleur & 255) / 255;
  let flux = "q " + versPdf(page) + `${nombre(r)} ${nombre(v)} ${nombre(b)} rg\n`;
  let x = x0;
  for (const [rang, morceau] of parts) {
    const police = ch[rang].police;
    const nom = noms.get(rang)!;
    // Les glyphes qui se suivent vont dans un même Tj. Une lettre sans glyphe (l'espace manque souvent aux polices
    // réduites) coupe le groupe : on avance sans rien dessiner, puis on reprend à la bonne position.
    let groupe = "";
    let debutGroupe = x;
    const vider = () => {
      if (!groupe) return;
      // Repère de la page affichée (y vers le bas) : la matrice de texte retourne l'axe y.
      flux += `BT /${nom} ${nombre(taille)} Tf 1 0 0 -1 ${nombre(debutGroupe)} ${nombre(y)} Tm <${groupe}> Tj ET\n`;
      groupe = "";
    };
    for (const c of morceau) {
      const cp = c.codePointAt(0)!;
      const g = glypheSur(police, cp);
      if (g === null) {
        vider();
        x += 0.278 * taille;
        continue;
      }
      if (!groupe) debutGroupe = x;
      groupe += g.hex;
      x += g.avance * taille;
    }
    vider();
  }
  return flux + "Q\n";
}

const sansBlancs = (t: string) => t.replace(/[\s ]/g, "");

/**
 * Remplace le texte de plusieurs morceaux d'une page (replace_spans sur PC). Les polices sont choisies avant
 * l'effacement, tant qu'elles sont encore dans les ressources de la page ; tous les anciens textes sont effacés avant
 * d'écrire les nouveaux (un texte allongé ne risque pas d'être effacé par la suppression d'un voisin). Le document
 * est modifié en place : en cas d'erreur, l'appelant doit rétablir sa copie d'avant.
 */
export function modifierTexte(doc: mupdf.PDFDocument, numeroPage: number, editions: Edition[]): BilanEdition[] {
  const page = doc.loadPage(numeroPage);
  const lecture = lirePage(page);
  const segments = decouper(lecture.caracteres);
  const cache = new Map<string, Ecriture | null>();
  const plans: Plan[] = [];
  for (const e of editions) {
    const cible = retrouver(segments, e.cible);
    if (!cible) throw new ErreurPdf("Ce texte n’est plus à cet endroit de la page. Cliquez à nouveau dessus.");
    plans.push(e.texte.trim() ? planifier(doc, page, lecture, cible, e.texte, cache) : { segment: cible, texte: "", chaine: [], parts: [] });
  }
  const avant = new Map(plans.map((p) => [p.segment.texte, occurrences(segments, p.segment.texte)]));

  effacer(page, plans.map((p) => p.segment));
  let flux = "";
  for (const p of plans) {
    if (p.texte) flux += ecrire(doc, page, p.segment.origineX, p.segment.origineY, p.segment.taille, p.segment.couleur, p.parts, p.chaine);
  }
  if (flux) ajouterContenu(doc, page, flux);

  // Relecture : le nouveau texte doit être là, à sa place, et l'ancien ne doit plus y être. Sinon, la modification
  // est refusée : mieux vaut rien que du texte effacé à moitié.
  const apres = segmentsDePage(doc.loadPage(numeroPage));
  for (const p of plans) {
    const cible = p.segment;
    const nouveau = sansBlancs(p.texte);
    if (nouveau) {
      const largeur = Math.max(cible.x1 - cible.x0, 1);
      const place = apres.filter((s) => Math.abs(s.origineY - cible.origineY) < 1 && s.origineX < cible.origineX + 1 + largeur * 4 &&
        s.x1 > cible.origineX - 1);
      const ecrit = place.sort((a, b) => a.origineX - b.origineX).map((s) => sansBlancs(s.texte)).join("");
      if (!ecrit.includes(nouveau)) throw new ErreurPdf("Le nouveau texte n’a pas pu être écrit correctement.");
    }
    const ancien = sansBlancs(cible.texte);
    const encore = occurrences(apres, cible.texte);
    const attendu = (avant.get(cible.texte) ?? 0) - plans.filter((q) => q.segment.texte === cible.texte).length;
    if (ancien && !plans.some((q) => sansBlancs(q.texte).includes(ancien)) && encore > Math.max(0, attendu)) {
      throw new ErreurPdf("Le texte d’origine n’a pas pu être effacé complètement.");
    }
  }
  return plans.map((p) => (p.texte ? bilan(p.parts, p.chaine, p.segment.police) : { conservee: true, message: "Texte supprimé." }));
}

/** Les polices standard proposées pour ajouter du texte. */
export const POLICES_AJOUT: Record<string, string> = {
  Helvetica: "Sans empattements (Helvetica, Arial)",
  "Times-Roman": "Avec empattements (Times)",
  Courier: "Machine à écrire (Courier)",
};

/** Ajoute un texte (une ou plusieurs lignes) à la page, en police standard, x et y étant la ligne de base de la première ligne. */
export function ajouterTexte(doc: mupdf.PDFDocument, numeroPage: number, x: number, y: number, texte: string, taille: number,
  couleur: number, police: string, gras = false, italique = false): void {
  const page = doc.loadPage(numeroPage);
  const g = police === "Courier" ? "mono" : police === "Times-Roman" ? "serif" : "sans";
  const nom = standard(g, gras, italique);
  const cache = new Map<string, Ecriture | null>();
  const charger = (n: string) => {
    if (!cache.has(n)) {
      const f = policeStandard(n.replace(/#$/, ""));
      cache.set(n, f === null ? null : n.endsWith("#") ? ajoutee(doc, f) : standardSimple(doc, n));
    }
    return cache.get(n)!;
  };
  const ch = chaine<Ecriture>({ nom, gras, italique, integree: false }, null, null, [], charger);
  let flux = "";
  texte.split(/\r?\n/).forEach((ligne, i) => {
    if (!ligne.trim()) return;
    const parts = morceaux(ligne, ch.length, (rang, cp) => estBlanc(cp) || ch[rang].police.glyphe(cp) !== null);
    const absents = parts.filter(([r]) => r < 0).map(([, t]) => t).join("").replace(/\s/g, "");
    if (absents) throw new ErreurPdf(`Ces caractères ne peuvent pas être écrits : ${[...new Set(absents)].join(" ")}`);
    flux += ecrire(doc, page, x, y + i * taille * 1.2, taille, couleur, parts, ch);
  });
  if (flux) ajouterContenu(doc, page, flux);
}
