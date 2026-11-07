/**
 * Images que le navigateur ne sait pas lire (TIFF hors Safari, JPEG 2000, PSD…), décodées par MuPDF, que le site
 * contient déjà. Le HEIC des iPhone n'en fait pas partie : MuPDF ne le lit pas (voir heic.worker.ts).
 */
import * as mupdf from "mupdf";

/** L'image en PNG, en RVB ou en gris, transparence comprise ; une erreur si MuPDF ne reconnaît pas le format. */
export function imageEnPng(octets: Uint8Array): Uint8Array {
  const image = new mupdf.Image(octets);
  try {
    const pix = image.toPixmap();
    try {
      const espace = pix.getColorSpace();
      if (espace && (espace.isRGB() || espace.isGray())) return pix.asPNG();
      // CMJN (fichiers d'imprimerie) et autres espaces de couleur : le PNG ne connaît que le RVB et le gris.
      const rvb = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
      try {
        return rvb.asPNG();
      } finally {
        rvb.destroy();
      }
    } finally {
      pix.destroy();
    }
  } finally {
    image.destroy();
  }
}
