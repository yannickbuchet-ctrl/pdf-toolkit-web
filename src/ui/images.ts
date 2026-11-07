/**
 * Lecture des images à insérer (images, signatures, photos d'identité). Le navigateur les lit d'abord, avec
 * l'orientation EXIF. Pour les formats qu'il ne connaît pas, le site prend le relais : libheif pour le HEIC des
 * iPhone (Chrome, Edge et Firefox ne le lisent pas), MuPDF pour le TIFF et les autres. Les photos géantes sont
 * réduites : Safari sur iPhone refuse les canevas de plus de 16,7 millions de pixels, et la mémoire d'un téléphone
 * est comptée.
 */
import { appel } from "./moteur";
import { el, lire } from "./dom";
import { formatImage, type FormatImage } from "../moteur/formatImage";

export { estImage } from "../moteur/formatImage";

/** Formats proposés par les fenêtres de choix de fichier : HEIC et TIFF ne font pas partie de « image/* » partout. */
export const TYPES_IMAGES = "image/*,.heic,.heif,.hif,.avif,.webp,.tif,.tiff,.jfif";

/** Au-delà, une image est réduite à la lecture. 16 millions de pixels suffisent largement : une page A4 entière
 * imprimée à 300 ppp en compte 8,7 millions. */
export const PIXELS_MAX = 16_000_000;

const FORMATS_ACCEPTES = "JPEG, PNG, HEIC et HEIF (iPhone), WebP, AVIF, GIF, BMP et TIFF";

export interface ImageLue {
  /** L'image redressée (orientation EXIF, rotation HEIF), réduite à PIXELS_MAX pixels au plus. */
  canvas: HTMLCanvasElement;
  format: FormatImage;
  /** Aucun pixel transparent : l'image peut être enregistrée en JPEG. */
  opaque: boolean;
}

/**
 * Lit une image. annoncer : appelée avec un message d'attente quand la lecture passe par un décodeur du site, plus
 * lent que celui du navigateur.
 */
export async function lireImage(fichier: Blob, annoncer?: (message: string) => void): Promise<ImageLue> {
  const format = formatImage(new Uint8Array(await fichier.slice(0, 64).arrayBuffer()));
  let bitmap: ImageBitmap | null = null;
  let alpha: boolean | null = null;
  try {
    bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Format inconnu du navigateur : un décodeur du site prend le relais.
  }
  if (!bitmap && format === "heif") {
    annoncer?.("Lecture de la photo HEIC…");
    ({ bitmap, alpha } = await decoderHeif(fichier));
  }
  if (!bitmap) {
    annoncer?.("Lecture de l’image…");
    let png: Uint8Array;
    try {
      png = await appel("imageEnPng", { octets: await lire(fichier) });
    } catch {
      throw new Error(`format d’image non reconnu. Formats acceptés : ${FORMATS_ACCEPTES}.`);
    }
    bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  }
  try {
    const canvas = versCanvas(bitmap);
    return { canvas, format, opaque: format === "jpeg" || alpha === false || (alpha === null && !aDesTransparences(canvas)) };
  } finally {
    bitmap.close();
  }
}

/** Le HEIC, décodé par libheif dans un Web Worker créé pour l'occasion. */
async function decoderHeif(fichier: Blob): Promise<{ bitmap: ImageBitmap; alpha: boolean }> {
  const octets = await lire(fichier);
  const travailleur = new Worker(new URL("../heic.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise((ok, ko) => {
      travailleur.addEventListener("message", (ev: MessageEvent) => {
        if (ev.data.ok) ok({ bitmap: ev.data.image, alpha: ev.data.alpha });
        else ko(new Error(`photo HEIC illisible (${ev.data.message}).`));
      });
      travailleur.addEventListener("error", (ev) => {
        ev.preventDefault();
        ko(new Error("le lecteur de photos HEIC n’a pas pu démarrer. Hors connexion, il n’est disponible qu’après une première utilisation en ligne."));
      });
      travailleur.postMessage({ octets, pixelsMax: PIXELS_MAX }, [octets.buffer as ArrayBuffer]);
    });
  } finally {
    travailleur.terminate();
  }
}

/** L'image dans un canevas, réduite si elle dépasse PIXELS_MAX. */
function versCanvas(b: ImageBitmap): HTMLCanvasElement {
  const k = Math.min(1, Math.sqrt(PIXELS_MAX / (b.width * b.height)));
  const c = k < 1
    ? el("canvas", { width: Math.max(1, Math.floor(b.width * k)), height: Math.max(1, Math.floor(b.height * k)) })
    : el("canvas", { width: b.width, height: b.height });
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("mémoire insuffisante pour lire cette image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(b, 0, 0, c.width, c.height);
  return c;
}

/** Au moins un pixel transparent ? L'image est lue par bandes, pour ne pas copier d'un coup une photo entière. */
function aDesTransparences(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext("2d")!;
  const bande = Math.max(1, Math.floor(4_000_000 / c.width));
  for (let y = 0; y < c.height; y += bande) {
    const d = ctx.getImageData(0, y, c.width, Math.min(bande, c.height - y)).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  }
  return false;
}

/** L'image à mettre dans le PDF : JPEG (qualité 92 %) pour une photo opaque, PNG si elle a des transparences. */
export async function encoderPourPdf(image: ImageLue): Promise<Uint8Array> {
  const b = await new Promise<Blob | null>((ok) => image.canvas.toBlob(ok, image.opaque ? "image/jpeg" : "image/png", 0.92));
  if (!b) throw new Error("mémoire insuffisante pour préparer cette image.");
  return lire(b);
}

/** Copie réduite (plus grand côté : coteMax pixels), ou le canevas lui-même s'il est assez petit. */
export function reduire(c: HTMLCanvasElement, coteMax: number): HTMLCanvasElement {
  const k = coteMax / Math.max(c.width, c.height);
  if (k >= 1) return c;
  const r = el("canvas", { width: Math.max(1, Math.round(c.width * k)), height: Math.max(1, Math.round(c.height * k)) });
  const ctx = r.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, r.width, r.height);
  return r;
}
