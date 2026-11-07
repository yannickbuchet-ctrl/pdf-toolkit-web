/**
 * Reconnaissance du format d'une image d'après ses premiers octets. Module sans dépendance : il sert à l'interface
 * (images.ts) comme aux tests.
 */

export type FormatImage = "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heif" | "avif" | "jpeg2000" | "inconnu";

const EXTENSION_IMAGE = /\.(jpe?g|jfif|png|gif|webp|bmp|heic|heif|hif|avif|tiff?|jp2|jpx)$/i;

/** Une image, d'après le type annoncé par le système ou, s'il n'en annonce pas (HEIC sous Windows), l'extension. */
export const estImage = (f: { name: string; type: string }) => f.type.startsWith("image/") || EXTENSION_IMAGE.test(f.name);

/** Le format, d'après les premiers octets du fichier (64 suffisent) : le nom et le type annoncé peuvent être faux. */
export function formatImage(d: Uint8Array): FormatImage {
  const texte = (debut: number, fin: number) => String.fromCharCode(...d.subarray(debut, fin));
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "jpeg";
  if (texte(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (texte(0, 4) === "GIF8") return "gif";
  if (texte(0, 4) === "RIFF" && texte(8, 12) === "WEBP") return "webp";
  if (texte(0, 2) === "BM") return "bmp";
  if (texte(0, 4) === "II*\0" || texte(0, 4) === "MM\0*") return "tiff";
  if (texte(0, 12) === "\0\0\0\x0cjP  \r\n\x87\n" || texte(0, 4) === "\xff\x4f\xff\x51") return "jpeg2000";
  if (texte(4, 8) === "ftyp") {
    // Boîte « ftyp » : la marque principale, puis les marques compatibles.
    const fin = Math.min(d.length, ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0);
    const marques = [texte(8, 12)];
    for (let i = 16; i + 4 <= fin; i += 4) marques.push(texte(i, i + 4));
    if (marques.some((m) => m === "avif" || m === "avis")) return "avif";
    if (marques.some((m) => ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"].includes(m))) return "heif";
  }
  return "inconnu";
}
