/**
 * Ouverture, enregistrement, mots de passe et organisation des pages.
 */
import * as mupdf from "mupdf";
import { recompresserImages } from "./compression";

export class MotDePasseRequis extends Error {
  constructor(readonly incorrect: boolean) {
    super(incorrect ? "Mot de passe incorrect." : "Ce PDF est protégé par un mot de passe.");
  }
}

export interface Ouverture {
  doc: mupdf.PDFDocument;
  /** Mot de passe d'ouverture du fichier d'origine : il est réappliqué à l'enregistrement (comme sur PC). */
  motDePasse: string | null;
  /** Le fichier limitait des droits (impression, copie…) sans mot de passe d'ouverture. */
  restrictions: boolean;
  repare: boolean;
}

export function ouvrirPdf(data: Uint8Array): mupdf.PDFDocument {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(data, "application/pdf");
  } catch (e) {
    throw new Error("Ce fichier n’est pas un PDF lisible : " + (e as Error).message);
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new Error("Ce fichier n’est pas un PDF.");
  }
  return pdf;
}

/**
 * Ouvre un PDF, protégé ou non. Le document protégé est déverrouillé et déchiffré en mémoire (unlock sur PC) : le
 * chiffrement n'est réappliqué qu'à l'enregistrement, et annulation, fusion ou compression travaillent ainsi sur un
 * document ordinaire.
 */
export function ouvrir(data: Uint8Array, motDePasse?: string): Ouverture {
  const doc = ouvrirPdf(data);
  const chiffre = (doc.getMetaData(mupdf.Document.META_ENCRYPTION) ?? "None") !== "None";
  if (doc.needsPassword()) {
    if (motDePasse === undefined) {
      doc.destroy();
      throw new MotDePasseRequis(false);
    }
    if (!doc.authenticatePassword(motDePasse)) {
      doc.destroy();
      throw new MotDePasseRequis(true);
    }
    const clair = doc.saveToBuffer("encrypt=none").asUint8Array().slice();
    doc.destroy();
    return { doc: ouvrirPdf(clair), motDePasse, restrictions: false, repare: false };
  }
  if (chiffre) {
    // Droits limités sans mot de passe d'ouverture : le document est déchiffré pour pouvoir être modifié.
    const clair = doc.saveToBuffer("encrypt=none").asUint8Array().slice();
    doc.destroy();
    return { doc: ouvrirPdf(clair), motDePasse: null, restrictions: true, repare: false };
  }
  return { doc, motDePasse: null, restrictions: false, repare: doc.wasRepaired() };
}

export type Compression = "aucune" | "sans-perte" | "forte";

export interface OptionsEnregistrement {
  compression: Compression;
  /** Mot de passe à appliquer (chiffrement AES 256 bits), ou null pour un fichier non protégé. */
  motDePasse: string | null;
}

/** Copie de travail : l'état complet du document, pour annuler ou rétablir (push_undo sur PC). */
export function copie(doc: mupdf.PDFDocument): Uint8Array {
  return doc.saveToBuffer("").asUint8Array().slice();
}

/**
 * Options d'enregistrement, vérifiées par tests/document.test.ts sur MuPDF.js 1.28 :
 * - un enregistrement avec « garbage » ou « encrypt » modifie le document en mémoire (renumérotation des objets) et,
 *   répété, l'abîme : le document de travail n'est donc jamais enregistré qu'avec des options vides ; les autres
 *   enregistrements se font sur une copie relue, utilisée une seule fois ;
 * - « garbage=3 » ou plus (fusion des objets en double) perd le contenu de formulaires XObject semblables : on s'en
 *   tient à « garbage=2 » (objets inutilisés retirés, numérotation compactée).
 */
export const OPTIONS_SIMPLES = "garbage=2,compress";
const OPTIONS_SANS_PERTE = "garbage=2,compress,compress-fonts,compress-images,objstms";

/** Enregistre une copie fraîche du document avec ces options, sans toucher au document lui-même. */
export function enregistrerCopie(doc: mupdf.PDFDocument, options: string): Uint8Array {
  const copieRelue = ouvrirPdf(copie(doc));
  try {
    return copieRelue.saveToBuffer(options).asUint8Array().slice();
  } finally {
    copieRelue.destroy();
  }
}

/** Le fichier à enregistrer : compressé ou non, chiffré si un mot de passe est demandé. */
export function enregistrer(doc: mupdf.PDFDocument, options: OptionsEnregistrement): { octets: Uint8Array; images: number } {
  // MuPDF lit les options d'enregistrement séparées par des virgules : un mot de passe ne peut pas en contenir.
  const mdp = options.motDePasse;
  if (mdp && mdp.includes(",")) throw new Error("Le mot de passe ne peut pas contenir de virgule.");
  const base = options.compression === "aucune" ? OPTIONS_SIMPLES : OPTIONS_SANS_PERTE;
  const chiffrement = mdp ? `,encrypt=aes-256,user-password=${mdp},owner-password=${mdp}` : "";
  // Toujours sur une copie : si l'enregistrement échoue, le document affiché reste intact (images comprises).
  const travail = ouvrirPdf(copie(doc));
  try {
    const images = options.compression === "forte" ? recompresserImages(travail) : 0;
    return { octets: travail.saveToBuffer(base + chiffrement).asUint8Array().slice(), images };
  } finally {
    travail.destroy();
  }
}

/** Fait pivoter des pages d'un quart de tour (angle : 90, -90 ou 180). */
export function pivoter(doc: mupdf.PDFDocument, pages: number[], angle: number) {
  for (const i of pages) {
    const objet = doc.findPage(i);
    const actuel = objet.getInheritable("Rotate");
    const valeur = actuel.isNumber() ? actuel.asNumber() : 0;
    objet.put("Rotate", (((valeur + angle) % 360) + 360) % 360);
  }
}

export function supprimerPages(doc: mupdf.PDFDocument, pages: number[]) {
  if (pages.length >= doc.countPages()) throw new Error("Un document doit garder au moins une page.");
  for (const i of [...new Set(pages)].sort((a, b) => b - a)) doc.deletePage(i);
}

/** Réordonne les pages : ordre est la liste des anciens numéros, dans le nouvel ordre. */
export function reordonner(doc: mupdf.PDFDocument, ordre: number[]) {
  const n = doc.countPages();
  if (ordre.length !== n || new Set(ordre).size !== n || ordre.some((i) => i < 0 || i >= n)) {
    throw new Error("Ordre des pages invalide.");
  }
  doc.rearrangePages(ordre);
}

/** Déplace des pages avant la page « avant » (numéro dans l'ordre actuel ; n pour la fin). */
export function deplacer(doc: mupdf.PDFDocument, pages: number[], avant: number) {
  const n = doc.countPages();
  const choisies = [...new Set(pages)].sort((a, b) => a - b);
  const reste = [...Array(n).keys()].filter((i) => !choisies.includes(i));
  const position = reste.filter((i) => i < avant).length;
  reordonner(doc, [...reste.slice(0, position), ...choisies, ...reste.slice(position)]);
}

/** Un nouveau document fait des pages choisies, dans cet ordre. */
export function extraire(doc: mupdf.PDFDocument, pages: number[]): Uint8Array {
  const nouveau = new mupdf.PDFDocument();
  try {
    const greffe = nouveau.newGraftMap();
    pages.forEach((p) => greffe.graftPage(-1, doc, p));
    return enregistrerCopie(nouveau, OPTIONS_SIMPLES);
  } finally {
    nouveau.destroy();
  }
}

/** Insère les pages d'autres PDF à la position donnée (-1 : à la fin). Renvoie le nombre de pages insérées. */
export function insererDocuments(doc: mupdf.PDFDocument, sources: mupdf.PDFDocument[], position = -1): number {
  let a = position < 0 ? doc.countPages() : position;
  const debut = a;
  for (const source of sources) {
    const greffe = doc.newGraftMap();
    for (let i = 0; i < source.countPages(); i++) greffe.graftPage(a++, source, i);
  }
  return a - debut;
}

/** Insère une page blanche de la taille donnée (en points) à la position donnée. */
export function insererPageBlanche(doc: mupdf.PDFDocument, position: number, largeur = 595.28, hauteur = 841.89) {
  const page = doc.addPage([0, 0, largeur, hauteur], 0, {}, "");
  doc.insertPage(position, page);
}

/** Concatène plusieurs PDF (déjà déverrouillés) dans l'ordre donné. */
export function fusionner(sources: mupdf.PDFDocument[]): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  insererDocuments(doc, sources, 0);
  return doc;
}

/** Taille de chaque page affichée (rotation comprise), en points. */
export function taillesDesPages(doc: mupdf.PDFDocument): { largeur: number; hauteur: number; rotation: number }[] {
  const r = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const rot = page.getObject().getInheritable("Rotate");
    r.push({ largeur: x1 - x0, hauteur: y1 - y0, rotation: rot.isNumber() ? rot.asNumber() : 0 });
  }
  return r;
}

/** Les informations du document (titre, auteur…). */
export function metadonnees(doc: mupdf.PDFDocument): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [cle, nom] of [["titre", "info:Title"], ["auteur", "info:Author"], ["sujet", "info:Subject"],
    ["createur", "info:Creator"], ["producteur", "info:Producer"], ["format", "format"]] as const) {
    const v = doc.getMetaData(nom);
    if (v) r[cle] = v;
  }
  return r;
}

/** Le PDF demande-t-il à être imprimé sans mise à l'échelle (/PrintScaling /None) ? */
export function imprimeTailleReelle(doc: mupdf.PDFDocument): boolean {
  try {
    const prefs = doc.getTrailer().get("Root").get("ViewerPreferences");
    const v = prefs.isDictionary() ? prefs.get("PrintScaling") : null;
    return !!v && v.isName() && v.asName() === "None";
  } catch {
    return false;
  }
}
