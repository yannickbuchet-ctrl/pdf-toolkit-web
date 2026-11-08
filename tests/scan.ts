/**
 * Scans de synthèse pour les essais de l'OCR, sans aucun document personnel : une page de texte écrite avec MuPDF est
 * dessinée en image (300 ppp, niveaux de gris, bruit et légère inclinaison au choix), puis mise seule dans un PDF,
 * comme le ferait un scanner. Et Tesseract.js dans Node, avec les données de langue du projet.
 */
import * as mupdf from "mupdf";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { winAnsi } from "../src/moteur/tableUnicode";
import { motsDeTesseract, type ImageOcr, type LecteurOcr, type PageTesseract } from "../src/moteur/ocrLecture";

export interface OptionsScan {
  /** Lignes de texte : [taille en points, texte] ; écrites en Times à partir de 72 pt du bord. */
  lignes: [number, string][];
  /** Rotation de l'image dans la page, en degrés (sens horaire) : 180 pour une feuille scannée à l'envers. */
  tourne?: 0 | 90 | 180 | 270;
  /** /Rotate de la page du scan (le fichier corrige l'affichage). */
  rotationPage?: 0 | 90 | 180 | 270;
  /** Inclinaison de la feuille, en degrés. */
  inclinaison?: number;
  /** Bruit (taches grises) : proportion des pixels touchés. */
  bruit?: number;
  ppp?: number;
}

/** Une page A4 de texte, en PDF (texte réel), écrite avec une police standard. */
export function pageDeTexte(lignes: [number, string][], police = "Times-Roman"): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const f = doc.addSimpleFont(new mupdf.Font(police), "Latin");
  let y = 90, contenu = "";
  for (const [taille, texte] of lignes) {
    const codes = [...texte].map((c) => (winAnsi(c.codePointAt(0)!) ?? 0x3f).toString(16).padStart(2, "0")).join("");
    contenu += `BT /F ${taille} Tf 72 ${842 - y} Td <${codes}> Tj ET\n`;
    y += taille * 1.6;
  }
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { Font: { F: f } }, contenu));
  return doc;
}

/** Pseudo-hasard reproductible. */
function hasard(graine: number) {
  let s = graine >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Le scan d'une page de texte : un PDF d'une page qui ne contient qu'une image, sans aucun texte. */
export function scan(options: OptionsScan): mupdf.PDFDocument {
  const ppp = options.ppp ?? 300;
  const source = pageDeTexte(options.lignes);
  const z = ppp / 72;
  const tourne = options.tourne ?? 0;
  const matrice = mupdf.Matrix.concat(mupdf.Matrix.concat(mupdf.Matrix.scale(z, z), mupdf.Matrix.rotate(tourne)), mupdf.Matrix.rotate(options.inclinaison ?? 0));
  const brute = source.loadPage(0).toPixmap(matrice, mupdf.ColorSpace.DeviceGray, false, false);
  // L'image inclinée est un peu plus grande que la page : on garde un cadre de la taille de la page, centré.
  const [l, h] = tourne % 180 ? [Math.round(842 * z), Math.round(595 * z)] : [Math.round(595 * z), Math.round(842 * z)];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, l, h], false);
  pix.clear(255);
  const dst = pix.getPixels(), src = brute.getPixels();
  const lb = brute.getWidth(), hb = brute.getHeight(), pas = brute.getStride();
  const dx = Math.round((lb - l) / 2), dy = Math.round((hb - h) / 2);
  const alea = hasard(42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const sx = x + dx, sy = y + dy;
      let v = sx >= 0 && sy >= 0 && sx < lb && sy < hb ? src[sy * pas + sx] : 255;
      if (options.bruit && alea() < options.bruit) v = Math.min(v, 90 + Math.floor(alea() * 120));
      dst[y * l + x] = v;
    }
  }
  brute.destroy();
  source.destroy();
  const doc = new mupdf.PDFDocument();
  const image = doc.addImage(new mupdf.Image(pix));
  const [pl, ph] = [l / z, h / z];
  doc.insertPage(-1, doc.addPage([0, 0, pl, ph], options.rotationPage ?? 0, { XObject: { Im0: image } }, `q ${pl} 0 0 ${ph} 0 0 cm /Im0 Do Q`));
  return doc;
}

/** Ajoute les pages de source à la fin de doc. */
export function ajouterPages(doc: mupdf.PDFDocument, source: mupdf.PDFDocument) {
  for (let i = 0; i < source.countPages(); i++) doc.graftPage(-1, source, i);
}

/* --- Tesseract.js dans Node ------------------------------------------------------------------------------------- */

/** Les données de langue du projet (paquets @tesseract.js-data), réunies dans un dossier comme sur le site. */
function dossierLangues(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-toolkit-ocr-"));
  for (const code of ["fra", "eng"]) {
    const fichier = path.resolve(import.meta.dirname, "..", "node_modules", "@tesseract.js-data", code, "4.0.0_best_int", `${code}.traineddata.gz`);
    fs.copyFileSync(fichier, path.join(dossier, `${code}.traineddata.gz`));
  }
  return dossier;
}

let langues: string | null = null;

/** Un lecteur Tesseract.js (LSTM, mise en page automatique), avec les mêmes réglages que le site. */
export async function lecteurTesseract(langue = "fra"): Promise<{ lire: LecteurOcr; fin: () => Promise<void>; worker: Worker }> {
  langues ??= dossierLangues();
  const worker = await createWorker(langue, 1, { langPath: langues, cacheMethod: "none", gzip: true });
  await worker.setParameters({ tessedit_pageseg_mode: "3" as never });
  const lire: LecteurOcr = async (image: ImageOcr) => {
    await worker.setParameters({ user_defined_dpi: String(image.ppp) });
    const r = await worker.recognize(Buffer.from(image.png), {}, { blocks: true, text: false });
    return motsDeTesseract(r.data as unknown as PageTesseract);
  };
  return { lire, fin: () => worker.terminate().then(() => undefined), worker };
}

/** Distance d'édition entre deux textes (nombre de caractères à changer), pour mesurer la précision. */
export function distance(a: string, b: string): number {
  const x = [...a], y = [...b];
  let prec = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cour = [i];
    for (let j = 1; j <= y.length; j++) cour[j] = Math.min(prec[j] + 1, cour[j - 1] + 1, prec[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prec = cour;
  }
  return prec[y.length];
}
