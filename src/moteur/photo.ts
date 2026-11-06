/**
 * Planches de photos d'identité (id_photo_layout, id_photo_pdf, read_id_photo_sheet sur PC).
 *
 * Le PDF demande à être imprimé sans mise à l'échelle (/PrintScaling /None) : les photos doivent sortir à leur taille
 * exacte. La photo entière et les réglages peuvent être joints au PDF pour modifier la planche plus tard ; les réglages
 * sont écrits comme sur PC (un dictionnaire au format Python) et relus par un lecteur sûr, qui n'exécute rien et
 * valide chaque valeur : un PDF peut venir de n'importe qui.
 */
import * as mupdf from "mupdf";
import {
  disposition, FICHIER_REGLAGES, FICHIER_SOURCE, MARGE_MIN, POINTS_PAR_MM, REGLAGES_DEFAUT, texteVersReglages, TITRE_PLANCHE,
  type Orientation, type Reglages,
} from "./photoCalcul";

export * from "./photoCalcul";

const nombre = (v: number) => {
  const t = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
};

/**
 * PDF d'une page portant la photo (JPEG) à chaque position (dimensions en mm). Une même image est partagée par toutes
 * les photos, le fichier reste léger. source : JPEG de la photo entière et texte des réglages, joints au PDF.
 */
export function planchePdf(jpeg: Uint8Array, page: [number, number], photo: [number, number], positions: [number, number][],
  traits: boolean, source: { jpeg: Uint8Array; reglages: string } | null, application: string): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const L = page[0] * POINTS_PAR_MM, H = page[1] * POINTS_PAR_MM;
  const image = doc.addImage(new mupdf.Image(jpeg));
  const pw = photo[0] * POINTS_PAR_MM, ph = photo[1] * POINTS_PAR_MM;
  let contenu = "";
  for (const [x, y] of positions) {
    const x0 = x * POINTS_PAR_MM, y1 = H - y * POINTS_PAR_MM; // le PDF compte y depuis le bas de la page
    contenu += `q ${nombre(pw)} 0 0 ${nombre(ph)} ${nombre(x0)} ${nombre(y1 - ph)} cm /Photo Do Q\n`;
    if (traits) contenu += `q 0.6 0.6 0.6 RG 0.25 w ${nombre(x0)} ${nombre(y1 - ph)} ${nombre(pw)} ${nombre(ph)} re S Q\n`;
  }
  const objetPage = doc.addPage([0, 0, L, H], 0, { XObject: { Photo: image } }, contenu);
  doc.insertPage(-1, objetPage);
  doc.setMetaData("info:Title", TITRE_PLANCHE);
  doc.setMetaData("info:Creator", application);
  doc.setMetaData("info:Producer", application);
  const racine = doc.getTrailer().get("Root");
  racine.put("ViewerPreferences", doc.newDictionary());
  racine.get("ViewerPreferences").put("PrintScaling", doc.newName("None"));
  if (source) {
    const date = new Date();
    doc.insertEmbeddedFile(FICHIER_SOURCE, doc.addEmbeddedFile(FICHIER_SOURCE, "image/jpeg", source.jpeg, date, date));
    doc.insertEmbeddedFile(FICHIER_REGLAGES, doc.addEmbeddedFile(FICHIER_REGLAGES, "text/plain",
      new TextEncoder().encode(source.reglages), date, date));
  }
  return doc;
}

/** Rectangles des photos d'une planche (en points) : toutes la même image, à la même taille. null sinon. */
export function photosDeLaPlanche(page: mupdf.Page): mupdf.Rect[] | null {
  const boites: mupdf.Rect[] = [];
  const images = new Set<string>();
  const appareil = new mupdf.Device({
    fillImage(image: mupdf.Image, ctm: mupdf.Matrix) {
      images.add(`${image.getWidth()}x${image.getHeight()}`);
      boites.push(mupdf.Rect.transform([0, 0, 1, 1], ctm));
    },
  });
  try {
    page.run(appareil, mupdf.Matrix.identity);
  } finally {
    appareil.close();
  }
  if (boites.length === 0 || images.size !== 1) return null;
  const l = boites[0][2] - boites[0][0], h = boites[0][3] - boites[0][1];
  if (boites.some((b) => Math.abs(b[2] - b[0] - l) > 0.5 || Math.abs(b[3] - b[1] - h) > 0.5)) return null;
  return boites;
}

export function piecesJointes(doc: mupdf.PDFDocument): Record<string, mupdf.PDFObject> {
  try {
    return doc.getEmbeddedFiles();
  } catch {
    return {};
  }
}

/** Ce PDF est-il une planche de photos d'identité créée par l'application (ou par la version PC) ? */
export function estPlanche(doc: mupdf.PDFDocument, imprimeTailleReelle: boolean): boolean {
  try {
    if (doc.countPages() === 0) return false;
    const pj = piecesJointes(doc);
    if (pj[FICHIER_SOURCE] && pj[FICHIER_REGLAGES]) return true;
    return doc.getMetaData("info:Title") === TITRE_PLANCHE && imprimeTailleReelle && photosDeLaPlanche(doc.loadPage(0)) !== null;
  } catch {
    return false;
  }
}

/**
 * Ce qu'il faut pour modifier une planche : la photo (JPEG), les réglages, et complet = false si le PDF ne contient
 * que la photo déjà recadrée (réglages déduits de la page).
 */
export function lirePlanche(doc: mupdf.PDFDocument): { jpeg: Uint8Array; reglages: Reglages; complet: boolean } {
  const pj = piecesJointes(doc);
  if (pj[FICHIER_SOURCE] && pj[FICHIER_REGLAGES]) {
    try {
      const reglages = texteVersReglages(new TextDecoder().decode(doc.getEmbeddedFileContents(pj[FICHIER_REGLAGES])!.asUint8Array()));
      const jpeg = doc.getEmbeddedFileContents(pj[FICHIER_SOURCE])!.asUint8Array().slice();
      return { jpeg, reglages, complet: true };
    } catch {
      // pièces jointes abîmées : on se rabat sur la photo visible dans la page
    }
  }
  const page = doc.loadPage(0);
  const boites = photosDeLaPlanche(page);
  if (!boites) throw new Error("Ce PDF n’est pas une planche de photos d’identité.");
  let image: mupdf.Image | null = null;
  const appareil = new mupdf.Device({ fillImage(img: mupdf.Image) { image ??= img; } });
  try {
    page.run(appareil, mupdf.Matrix.identity);
  } finally {
    appareil.close();
  }
  const pix = (image as unknown as mupdf.Image).toPixmap().convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
  const jpeg = pix.asJPEG(95).slice();
  const [bx0, by0, bx1, by1] = page.getBounds();
  const pageL = (bx1 - bx0) / POINTS_PAR_MM, pageH = (by1 - by0) / POINTS_PAR_MM;
  const photo: [number, number] = [(boites[0][2] - boites[0][0]) / POINTS_PAR_MM, (boites[0][3] - boites[0][1]) / POINTS_PAR_MM];
  const arrondi = (v: number) => Math.round(v * 100) / 100;
  const gauches = [...new Set(boites.map((b) => arrondi(b[0] / POINTS_PAR_MM)))].sort((a, b) => a - b);
  const hauts = [...new Set(boites.map((b) => arrondi(b[1] / POINTS_PAR_MM)))].sort((a, b) => a - b);
  const ecart = gauches.length > 1 ? gauches[1] - gauches[0] - photo[0] : hauts.length > 1 ? hauts[1] - hauts[0] - photo[1] : 2;
  const marge = Math.max(MARGE_MIN, Math.min(gauches[0], hauts[0], pageL - gauches[gauches.length - 1] - photo[0], pageH - hauts[hauts.length - 1] - photo[1]));
  const orientation: Orientation = pageL > pageH ? "landscape" : "portrait";
  const papier: [number, number] = [Math.min(pageL, pageH), Math.max(pageL, pageH)];
  const capacite = disposition(papier, photo, marge, ecart, orientation).capacite;
  const reglages: Reglages = {
    ...structuredClone(REGLAGES_DEFAUT), photo, papier, orientation, marge, ecart,
    nombre: boites.length >= capacite ? 0 : boites.length, traits: true,
  };
  return { jpeg, reglages, complet: false };
}
