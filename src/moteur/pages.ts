/**
 * Ce qui se fait sur une page : rendu, formulaires, annotations, images et signatures, recherche.
 */
import * as mupdf from "mupdf";
import { ajouterContenu, nomLibre, ressourcesDePage, segmentsDePage, versPdf } from "./texte";
import { rectangleDe, type Segment } from "./segments";

/* --- Rendu ------------------------------------------------------------------------------------------------------ */

export interface Rendu {
  largeur: number;
  hauteur: number;
  /** Pixels RVBA, ligne par ligne. */
  pixels: Uint8ClampedArray;
}

/** Dessine la page à l'échelle donnée (1 = 72 pixels par pouce), annotations et champs de formulaire compris. */
export function rendre(page: mupdf.Page, echelle: number): Rendu {
  const pix = page.toPixmap([echelle, 0, 0, echelle, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
  const l = pix.getWidth(), h = pix.getHeight(), pas = pix.getStride();
  const src = pix.getPixels();
  const sortie = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    let s = y * pas, d = y * l * 4;
    for (let x = 0; x < l; x++, s += 3, d += 4) {
      sortie[d] = src[s];
      sortie[d + 1] = src[s + 1];
      sortie[d + 2] = src[s + 2];
      sortie[d + 3] = 255;
    }
  }
  pix.destroy();
  return { largeur: l, hauteur: h, pixels: sortie };
}

/* --- Formulaires ------------------------------------------------------------------------------------------------ */

export interface Champ {
  index: number;
  type: string;
  nom: string;
  valeur: string;
  options: string[];
  rect: [number, number, number, number];
  multiligne: boolean;
  coche: boolean;
  taille: number;
}

/** Champs de formulaire remplissables de la page (les champs en lecture seule et les boutons sont ignorés). */
export function champs(page: mupdf.PDFPage): Champ[] {
  const r: Champ[] = [];
  page.getWidgets().forEach((w, index) => {
    const type = w.getFieldType();
    if (!["text", "checkbox", "radiobutton", "combobox", "listbox"].includes(type) || w.isReadOnly()) return;
    let taille = 0;
    try {
      taille = w.getDefaultAppearance().size;
    } catch {
      taille = 0;
    }
    const valeur = w.getValue() ?? "";
    r.push({
      index, type, nom: w.getLabel() || w.getName(), valeur,
      options: w.isChoice() ? w.getOptions() : [],
      rect: w.getRect() as Champ["rect"],
      multiligne: type === "text" && w.isMultiline(),
      coche: (type === "checkbox" || type === "radiobutton") && valeur !== "Off" && valeur !== "",
      taille,
    });
  });
  return r;
}

/** Remplit un champ : texte ou choix pour un champ texte ou une liste, « on » / « off » pour une case. */
export function remplir(page: mupdf.PDFPage, index: number, valeur: string) {
  const w = page.getWidgets()[index];
  if (!w) throw new Error("Ce champ n’existe plus.");
  const type = w.getFieldType();
  if (type === "text") w.setTextValue(valeur);
  else if (type === "combobox" || type === "listbox") w.setChoiceValue(valeur);
  else if (type === "checkbox" || type === "radiobutton") {
    const coche = w.getValue() !== "Off" && w.getValue() !== "";
    if ((valeur === "on") !== coche) w.toggle();
  }
  w.update();
  page.update();
}

/* --- Annotations ------------------------------------------------------------------------------------------------ */

export type Couleur = [number, number, number];
export type Point = [number, number];

/** Les quadrilatères du texte compris entre deux points (sélection à la souris). */
export function selectionTexte(page: mupdf.Page, a: Point, b: Point): mupdf.Quad[] {
  const st = page.toStructuredText("");
  try {
    return st.highlight(a, b);
  } finally {
    st.destroy();
  }
}

export function annoterTexte(page: mupdf.PDFPage, type: "Highlight" | "Underline" | "StrikeOut", quads: mupdf.Quad[], couleur: Couleur, auteur: string) {
  if (!quads.length) throw new Error("Aucun texte sélectionné.");
  const a = page.createAnnotation(type);
  a.setQuadPoints(quads);
  a.setColor(couleur);
  a.setAuthor(auteur);
  a.setModificationDate(new Date());
  a.update();
}

export function ajouterNote(page: mupdf.PDFPage, point: Point, texte: string, couleur: Couleur, auteur: string) {
  const a = page.createAnnotation("Text");
  a.setRect([point[0], point[1], point[0] + 20, point[1] + 20]);
  a.setContents(texte);
  a.setColor(couleur);
  a.setAuthor(auteur);
  a.setIcon("Comment");
  a.setModificationDate(new Date());
  a.update();
}

export function ajouterDessin(page: mupdf.PDFPage, traits: Point[][], couleur: Couleur, epaisseur: number, auteur: string) {
  const utiles = traits.filter((t) => t.length > 1);
  if (!utiles.length) return;
  const a = page.createAnnotation("Ink");
  a.setInkList(utiles);
  a.setColor(couleur);
  a.setBorderWidth(epaisseur);
  a.setAuthor(auteur);
  a.setModificationDate(new Date());
  a.update();
}

export function ajouterForme(page: mupdf.PDFPage, type: "Square" | "Circle", rect: [number, number, number, number], couleur: Couleur, epaisseur: number, auteur: string) {
  const a = page.createAnnotation(type);
  a.setRect(rect);
  a.setColor(couleur);
  a.setBorderWidth(epaisseur);
  a.setAuthor(auteur);
  a.setModificationDate(new Date());
  a.update();
}

export interface InfoAnnotation {
  index: number;
  type: string;
  rect: [number, number, number, number];
  contenu: string;
  auteur: string;
}

const NOMS_ANNOTATIONS: Record<string, string> = {
  Text: "Note", FreeText: "Zone de texte", Highlight: "Surlignage", Underline: "Soulignement", StrikeOut: "Texte barré",
  Squiggly: "Soulignement ondulé", Ink: "Dessin", Square: "Rectangle", Circle: "Ellipse", Line: "Ligne", Stamp: "Tampon",
  Polygon: "Polygone", PolyLine: "Ligne brisée", FileAttachment: "Pièce jointe", Caret: "Insertion", Redact: "Caviardage",
};

/** Les annotations de la page (liens et champs de formulaire exclus). */
export function annotations(page: mupdf.PDFPage): InfoAnnotation[] {
  return page.getAnnotations().map((a, index) => {
    const type = a.getType();
    let contenu = "", auteur = "";
    try {
      contenu = a.getContents();
      auteur = a.hasAuthor() ? a.getAuthor() : "";
    } catch {
      /* annotation sans texte */
    }
    return { index, type: NOMS_ANNOTATIONS[type] ?? type, rect: a.getBounds() as InfoAnnotation["rect"], contenu, auteur };
  }).filter((a) => a.type !== "Link" && a.type !== "Popup");
}

export function supprimerAnnotation(page: mupdf.PDFPage, index: number) {
  const a = page.getAnnotations()[index];
  if (!a) throw new Error("Cette annotation n’existe plus.");
  page.deleteAnnotation(a);
  page.update();
}

/**
 * Pose une image (PNG ou JPEG, transparence comprise) dans le contenu de la page, à l'emplacement donné en points de
 * la page affichée : comme sur PC, elle fait ensuite partie de la page. Un JPEG reste compressé en JPEG.
 */
export function insererImage(doc: mupdf.PDFDocument, numero: number, octets: Uint8Array, rect: [number, number, number, number]) {
  const page = doc.loadPage(numero);
  const image = new mupdf.Image(octets);
  const ref = doc.addImage(image);
  const objets = ressourcesDePage(doc, page, "XObject");
  const nom = nomLibre(objets, "EdImg");
  objets.put(nom, ref);
  const [x0, y0, x1, y1] = rect;
  const f = (v: number) => v.toFixed(3);
  // Repère de la page affichée (y vers le bas) : l'image, dessinée dans le carré unité, est retournée.
  ajouterContenu(doc, page, `q ${versPdf(page)}${f(x1 - x0)} 0 0 ${f(-(y1 - y0))} ${f(x0)} ${f(y1)} cm /${nom} Do Q\n`);
}

/* --- Recherche ---------------------------------------------------------------------------------------------------- */

/** Texte sans accents et en minuscules, et pour chaque caractère obtenu, la position du caractère d'origine. */
export function normaliserRecherche(texte: string, casse: boolean, accents: boolean): { texte: string; origine: number[] } {
  let sortie = "";
  const origine: number[] = [];
  [...texte].forEach((c, i) => {
    let t = c;
    if (!accents) {
      t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
      t = ({ "œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss", " ": " ", "’": "'", "‘": "'" } as Record<string, string>)[t] ?? t;
    }
    if (!casse) t = t.toLocaleLowerCase("fr");
    for (const x of t) {
      sortie += x;
      origine.push(i);
    }
  });
  return { texte: sortie, origine };
}

export interface Occurrence {
  page: number;
  segment: Pick<Segment, "texte" | "origineX" | "origineY">;
  /** Position dans le texte du morceau, en points de code. */
  debut: number;
  fin: number;
  rect: [number, number, number, number];
}

/**
 * Cherche dans chaque morceau de texte, sans tenir compte des accents ni (au choix) des majuscules : « ete » trouve
 * « Été ». Un mot coupé entre deux morceaux (changement de police au milieu) n'est pas trouvé, comme sur PC.
 */
export function chercher(doc: mupdf.PDFDocument, aiguille: string, casse = false, accents = false, pages?: number[]): Occurrence[] {
  const cherche = normaliserRecherche(aiguille, casse, accents).texte;
  if (!cherche.trim()) return [];
  const r: Occurrence[] = [];
  for (const p of pages ?? [...Array(doc.countPages()).keys()]) {
    for (const s of segmentsDePage(doc.loadPage(p))) {
      const n = normaliserRecherche(s.texte, casse, accents);
      let i = n.texte.indexOf(cherche);
      while (i >= 0) {
        const debut = n.origine[i];
        const fin = n.origine[i + cherche.length - 1] + 1;
        r.push({ page: p, segment: { texte: s.texte, origineX: s.origineX, origineY: s.origineY }, debut, fin, rect: rectangleDe(s, debut, fin) });
        i = n.texte.indexOf(cherche, i + cherche.length);
      }
    }
  }
  return r;
}

/** Le texte d'un morceau après remplacement des occurrences données (positions en points de code). */
export function remplacerDans(texte: string, plages: [number, number][], remplacement: string): string {
  const cps = [...texte];
  for (const [debut, fin] of [...plages].sort((a, b) => b[0] - a[0])) cps.splice(debut, fin - debut, remplacement);
  return cps.join("");
}
