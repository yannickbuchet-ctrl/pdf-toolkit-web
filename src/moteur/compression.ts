/**
 * Compression forte : les images sont recompressées en JPEG et, si elles sont très détaillées, ramenées à environ
 * 150 ppp (rewrite_images sur PC, avec les mêmes réglages). Le texte reste net et modifiable.
 */
import * as mupdf from "mupdf";

export const COMPRESSION_PPP = 150;
export const COMPRESSION_SEUIL_PPP = COMPRESSION_PPP + 20;
export const COMPRESSION_PPP_CIBLE = 144;
export const COMPRESSION_QUALITE = 75;

/** Plus grande taille d'affichage (en pouces) de chaque image, repérée par ses dimensions en pixels. */
function taillesAffichees(doc: mupdf.PDFDocument): Map<string, [number, number]> {
  const tailles = new Map<string, [number, number]>();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const appareil = new mupdf.Device({
      fillImage(image: mupdf.Image, ctm: mupdf.Matrix) {
        const cle = `${image.getWidth()}x${image.getHeight()}`;
        const l = Math.hypot(ctm[0], ctm[1]) / 72, h = Math.hypot(ctm[2], ctm[3]) / 72;
        const t = tailles.get(cle) ?? [0, 0];
        tailles.set(cle, [Math.max(t[0], l), Math.max(t[1], h)]);
      },
    });
    try {
      page.run(appareil, mupdf.Matrix.identity);
    } finally {
      appareil.close();
    }
  }
  return tailles;
}

/** Recompresse les images du document. Renvoie le nombre d'images réécrites. */
export function recompresserImages(doc: mupdf.PDFDocument): number {
  const tailles = taillesAffichees(doc);
  let reecrites = 0;
  const n = doc.countObjects();
  for (let num = 1; num < n; num++) {
    const ref = doc.newIndirect(num);
    // Le flux se lit par sa référence : MuPDF ne voit un flux que dans un objet indirect.
    const objet = ref;
    try {
      if (!objet.isStream()) continue;
      const sous = objet.get("Subtype");
      if (!sous.isName() || sous.asName() !== "Image") continue;
      // Transparence, masques et images à un bit (texte numérisé) sont laissés tels quels.
      if (!objet.get("SMask").isNull() || !objet.get("Mask").isNull() || objet.get("ImageMask").isBoolean() && objet.get("ImageMask").asBoolean()) continue;
      const bpc = objet.get("BitsPerComponent");
      if (bpc.isNumber() && bpc.asNumber() < 8) continue;
    } catch {
      continue;
    }
    try {
      const image = doc.loadImage(ref);
      const l = image.getWidth(), h = image.getHeight();
      if (l < 64 || h < 64) continue;
      const affichee = tailles.get(`${l}x${h}`);
      if (!affichee) continue; // image inutilisée ou dans un motif : laissée telle quelle
      const ppp = Math.min(l / Math.max(affichee[0], 1e-3), h / Math.max(affichee[1], 1e-3));
      let nl = l, nh = h;
      if (ppp > COMPRESSION_SEUIL_PPP) {
        const f = COMPRESSION_PPP_CIBLE / ppp;
        nl = Math.max(1, Math.round(l * f));
        nh = Math.max(1, Math.round(h * f));
      }
      const gris = image.getNumberOfComponents() === 1 && !image.getColorSpace()?.isIndexed();
      const espace = gris ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
      const pix = new mupdf.Pixmap(espace, [0, 0, nl, nh], false);
      pix.clear(255);
      const dessin = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      dessin.fillImage(image, [nl, 0, 0, nh, 0, 0], 1);
      dessin.close();
      const jpeg = pix.asJPEG(COMPRESSION_QUALITE);
      const avant = objet.readRawStream().getLength();
      if (jpeg.length >= avant * 0.9) continue; // aucun gain : l'image d'origine est gardée
      objet.writeRawStream(jpeg);
      objet.put("Filter", doc.newName("DCTDecode"));
      objet.delete("DecodeParms");
      objet.delete("Decode");
      objet.put("Width", nl);
      objet.put("Height", nh);
      objet.put("BitsPerComponent", 8);
      objet.put("ColorSpace", doc.newName(gris ? "DeviceGray" : "DeviceRGB"));
      reecrites++;
    } catch {
      // Image illisible ou format exotique : on la garde.
    }
  }
  return reecrites;
}
