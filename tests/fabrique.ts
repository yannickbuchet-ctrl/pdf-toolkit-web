/**
 * Fabrique des PDF de test, sans aucun document personnel : chaque test crée ses propres fichiers avec MuPDF.
 */
import * as mupdf from "mupdf";
import fs from "node:fs";
import { winAnsi } from "../src/moteur/tableUnicode";
import { enregistrerCopie } from "../src/moteur/document";

export const ARIAL = "C:/Windows/Fonts/arial.ttf";
export const arialDisponible = fs.existsSync(ARIAL);

type Police = { objet: mupdf.PDFObject; codes: (t: string) => string; police: mupdf.Font };

/** Police simple (WinAnsi) : standard non intégrée, ou intégrée si c'est une police chargée d'un fichier. */
export function policeSimple(doc: mupdf.PDFDocument, police: mupdf.Font): Police {
  return {
    objet: doc.addSimpleFont(police, "Latin"),
    police,
    codes: (t) => [...t].map((c) => winAnsi(c.codePointAt(0)!)!.toString(16).padStart(2, "0")).join(""),
  };
}

/** Police Type 0 intégrée en entier (codage Identity-H). */
export function policeCid(doc: mupdf.PDFDocument, police: mupdf.Font): Police {
  return {
    objet: doc.addFont(police),
    police,
    codes: (t) => [...t].map((c) => police.encodeCharacter(c.codePointAt(0)!).toString(16).padStart(4, "0")).join(""),
  };
}

export interface Ligne {
  police: string;
  x: number;
  y: number;
  taille: number;
  texte: string;
  couleur?: [number, number, number];
}

/**
 * Un PDF d'une page (ou plus) A4 ; y est compté depuis le haut de la page. polices : nom de ressource -> police.
 */
export function creerPdf(pages: { lignes: Ligne[]; rotation?: 0 | 90 | 180 | 270; largeur?: number; hauteur?: number }[],
  polices: (doc: mupdf.PDFDocument) => Record<string, Police>): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const p = polices(doc);
  const fontDict: Record<string, mupdf.PDFObject> = {};
  for (const [k, v] of Object.entries(p)) fontDict[k] = v.objet;
  for (const page of pages) {
    const l = page.largeur ?? 595, h = page.hauteur ?? 842;
    let contenu = "";
    for (const ligne of page.lignes) {
      const [r, g, b] = ligne.couleur ?? [0, 0, 0];
      // Page pivotée d'un quart de tour : le texte est écrit vers le haut, pour être horizontal une fois affiché.
      const position = page.rotation === 90 ? `0 1 -1 0 ${ligne.y} ${ligne.x} Tm` : `${ligne.x} ${h - ligne.y} Td`;
      contenu += `BT ${r} ${g} ${b} rg /${ligne.police} ${ligne.taille} Tf ${position} <${p[ligne.police].codes(ligne.texte)}> Tj ET\n`;
    }
    const res = doc.addObject({ Font: fontDict });
    const obj = doc.addPage([0, 0, l, h], page.rotation ?? 0, res, contenu);
    doc.insertPage(-1, obj);
  }
  return doc;
}

/** Le fichier du document, enregistré comme le fait l'application (sur une copie fraîche). */
export function octets(doc: mupdf.PDFDocument, options = "garbage=2,compress"): Uint8Array {
  return enregistrerCopie(doc, options);
}

export function ouvrir(data: Uint8Array): mupdf.PDFDocument {
  return mupdf.Document.openDocument(data, "application/pdf") as mupdf.PDFDocument;
}

/** Le texte d'une page, lignes séparées par des retours. */
export function texteDePage(doc: mupdf.Document, n: number): string {
  return doc.loadPage(n).toStructuredText("preserve-whitespace").asText();
}

/** Polices utilisées pour écrire chaque lettre de la page : [lettre, police]. */
export function policesDesLettres(doc: mupdf.Document, n: number): [string, string][] {
  const r: [string, string][] = [];
  doc.loadPage(n).toStructuredText("preserve-whitespace").walk({ onChar: (c, _o, f) => { r.push([c, f.getName()]); } });
  return r;
}

/** Une image JPEG de test (dégradé coloré) de largeur × hauteur pixels. */
export function jpegDeTest(largeur: number, hauteur: number, qualite = 90): Uint8Array {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, largeur, hauteur], false);
  const px = pix.getPixels();
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 3;
      px[i] = (x * 255) / largeur;
      px[i + 1] = (y * 255) / hauteur;
      px[i + 2] = ((x + y) * 7) % 255;
    }
  }
  return pix.asJPEG(qualite).slice();
}
