/**
 * Planche de copies : une page du document répétée sur une feuille, pour l'imprimer en plus petit (voir copiesCalcul).
 *
 * La page est reprise telle quelle, en vectoriel (un « Form XObject » partagé par toutes les copies) : le texte reste
 * net et le fichier léger. Ses annotations et champs de formulaire sont d'abord fondus dans son contenu, sur une copie
 * du document, pour apparaître sur chaque copie. Le PDF demande à être imprimé sans mise à l'échelle
 * (/PrintScaling /None) : les copies sortent à la taille calculée.
 */
import * as mupdf from "mupdf";
import { copie, ouvrirPdf } from "./document";
import type { DispositionCopies } from "./copiesCalcul";

export * from "./copiesCalcul";

export const TITRE_COPIES = "Planche de copies";
const POINTS_PAR_MM = 72 / 25.4;

const nombre = (v: number) => {
  const t = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
};

/** Le contenu d'une page (un flux ou un tableau de flux), mis bout à bout. */
function contenuDePage(page: mupdf.PDFObject): Uint8Array {
  const contenus = page.get("Contents");
  const flux: mupdf.PDFObject[] = [];
  if (contenus.isArray()) for (let i = 0; i < contenus.length; i++) flux.push(contenus.get(i));
  else if (contenus.isStream()) flux.push(contenus);
  const morceaux = flux.filter((f) => f.isStream()).map((f) => f.readStream().asUint8Array());
  const total = morceaux.reduce((s, m) => s + m.length + 1, 0);
  const r = new Uint8Array(total);
  let p = 0;
  for (const m of morceaux) {
    r.set(m, p);
    p += m.length;
    r[p++] = 10; // un saut de ligne : un flux peut s'arrêter au milieu d'un mot-clé
  }
  return r;
}

/**
 * Matrice qui place la zone visible [x0 y0 x1 y1] (en points), tournée de `rotation` degrés dans le sens des aiguilles
 * d'une montre, réduite de `k`, avec son coin inférieur gauche en (ox, oy).
 */
function matrice(zone: number[], rotation: number, k: number, ox: number, oy: number): number[] {
  const [x0, y0, x1, y1] = zone;
  const l = x1 - x0, h = y1 - y0;
  switch (rotation) {
    case 90: return [0, -k, k, 0, ox - k * y0, oy + k * (l + x0)];
    case 180: return [-k, 0, 0, -k, ox + k * (l + x0), oy + k * (h + y0)];
    case 270: return [0, k, -k, 0, ox + k * (h + y0), oy - k * x0];
    default: return [k, 0, 0, k, ox - k * x0, oy - k * y0];
  }
}

/** PDF d'une page : la page `index` de `source`, à chaque position de la disposition. */
export function plancheCopies(source: mupdf.PDFDocument, index: number, d: DispositionCopies, traits: boolean,
  application: string): mupdf.PDFDocument {
  // Une copie du document, pour fondre annotations et champs dans la page sans toucher au document ouvert.
  const travail = ouvrirPdf(copie(source));
  try {
    travail.bake(true, true);
    const page = travail.findPage(index);
    const boite = (cle: string) => {
      const b = page.getInheritable(cle);
      return b.isArray() && b.length === 4 ? [0, 1, 2, 3].map((i) => b.get(i).asNumber()) : null;
    };
    const media = boite("MediaBox") ?? [0, 0, 612, 792];
    const recadrage = boite("CropBox") ?? media;
    // La zone visible : le recadrage, limité à la page.
    const zone = [Math.max(Math.min(recadrage[0], recadrage[2]), Math.min(media[0], media[2])),
      Math.max(Math.min(recadrage[1], recadrage[3]), Math.min(media[1], media[3])),
      Math.min(Math.max(recadrage[0], recadrage[2]), Math.max(media[0], media[2])),
      Math.min(Math.max(recadrage[1], recadrage[3]), Math.max(media[1], media[3]))];
    const rot = page.getInheritable("Rotate");
    const rotationPage = ((((rot.isNumber() ? rot.asNumber() : 0) % 360) + 360) % 360);

    const doc = new mupdf.PDFDocument();
    const greffe = doc.newGraftMap();
    const forme = doc.newDictionary();
    forme.put("Type", doc.newName("XObject"));
    forme.put("Subtype", doc.newName("Form"));
    const bbox = doc.newArray();
    zone.forEach((v) => bbox.push(doc.newReal(v)));
    forme.put("BBox", bbox);
    const ressources = page.getInheritable("Resources");
    forme.put("Resources", ressources.isNull() ? doc.newDictionary() : greffe.graftObject(ressources));
    const groupe = page.get("Group");
    if (!groupe.isNull()) forme.put("Group", greffe.graftObject(groupe));
    const objetForme = doc.addStream(contenuDePage(page), forme);

    const L = d.largeur * POINTS_PAR_MM, H = d.hauteur * POINTS_PAR_MM;
    const rotation = (rotationPage + (d.tourner ? 90 : 0)) % 360;
    const visibleL = rotation % 180 ? zone[3] - zone[1] : zone[2] - zone[0];
    const k = (d.copie[0] * POINTS_PAR_MM) / visibleL;
    const cl = d.copie[0] * POINTS_PAR_MM, ch = d.copie[1] * POINTS_PAR_MM;
    let contenu = "";
    for (const [x, y] of d.positions) {
      const ox = x * POINTS_PAR_MM, oy = H - y * POINTS_PAR_MM - ch; // le PDF compte y depuis le bas de la feuille
      contenu += `q ${nombre(ox)} ${nombre(oy)} ${nombre(cl)} ${nombre(ch)} re W n ${matrice(zone, rotation, k, ox, oy).map(nombre).join(" ")} cm /Copie Do Q\n`;
    }
    if (traits && d.positions.length > 1) {
      for (const [x, y] of d.positions) {
        contenu += `q 0.6 0.6 0.6 RG 0.25 w ${nombre(x * POINTS_PAR_MM)} ${nombre(H - y * POINTS_PAR_MM - ch)} ${nombre(cl)} ${nombre(ch)} re S Q\n`;
      }
    }
    const objetPage = doc.addPage([0, 0, L, H], 0, { XObject: { Copie: objetForme } }, contenu);
    doc.insertPage(-1, objetPage);
    doc.setMetaData("info:Title", TITRE_COPIES);
    doc.setMetaData("info:Creator", application);
    doc.setMetaData("info:Producer", application);
    const racine = doc.getTrailer().get("Root");
    racine.put("ViewerPreferences", doc.newDictionary());
    racine.get("ViewerPreferences").put("PrintScaling", doc.newName("None"));
    return doc;
  } finally {
    travail.destroy();
  }
}
