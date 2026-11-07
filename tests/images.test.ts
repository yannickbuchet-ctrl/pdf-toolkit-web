/**
 * Lecture des images à insérer : reconnaissance du format, photos HEIC des iPhone (libheif) et formats que le
 * navigateur ne lit pas (MuPDF). Le décodage par le navigateur lui-même est vérifié par scripts/essai-images.mjs.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import creerLibheif from "libheif-js/libheif-wasm/libheif-bundle.mjs";
import { estImage, formatImage } from "../src/moteur/formatImage";
import { imageEnPng } from "../src/moteur/images";

/**
 * Photo HEIC d'essai, produite par pillow-heif 1.8.1 (libheif 1.23.6 et x265) : 96 × 64 pixels en quatre quarts
 * (rouge en haut à gauche, vert en haut à droite, bleu en bas à gauche, jaune en bas à droite), enregistrée avec une
 * rotation d'un quart de tour (boîte « irot »), comme une photo d'iPhone prise en hauteur.
 */
const HEIC = new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "images", "quadrants-quart-de-tour.heic")));

const octetsDe = (...morceaux: (string | number[])[]) =>
  new Uint8Array(morceaux.flatMap((m) => (typeof m === "string" ? [...m].map((c) => c.charCodeAt(0)) : m)));

/** Boîte « ftyp » d'un fichier ISO (HEIF, AVIF) : marque principale, version, marques compatibles. */
const ftyp = (principale: string, ...compatibles: string[]) => {
  const taille = 16 + 4 * compatibles.length;
  return octetsDe([0, 0, 0, taille], "ftyp", principale, [0, 0, 0, 0], ...compatibles, [0, 0, 0, 0]);
};

/** TIFF RVB non compressé, écrit à la main : le navigateur ne lit pas ce format, sauf Safari. */
function tiff(largeur: number, hauteur: number, couleur: (x: number, y: number) => [number, number, number]): Uint8Array {
  const entrees: [number, number, number, number][] = [
    [256, 3, 1, largeur], [257, 3, 1, hauteur], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, hauteur], [279, 4, 1, largeur * hauteur * 3],
  ];
  const ifd = 8, bits = ifd + 2 + 12 * entrees.length + 4, donnees = bits + 6;
  entrees[2][3] = bits;
  entrees[5][3] = donnees;
  const t = new Uint8Array(donnees + largeur * hauteur * 3);
  const v = new DataView(t.buffer);
  t.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, ifd, true);
  v.setUint16(ifd, entrees.length, true);
  entrees.forEach(([etiquette, type, nombre, valeur], k) => {
    const o = ifd + 2 + 12 * k;
    v.setUint16(o, etiquette, true);
    v.setUint16(o + 2, type, true);
    v.setUint32(o + 4, nombre, true);
    if (type === 3 && nombre === 1) v.setUint16(o + 8, valeur, true);
    else v.setUint32(o + 8, valeur, true);
  });
  for (let k = 0; k < 3; k++) v.setUint16(bits + 2 * k, 8, true);
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) t.set(couleur(x, y), donnees + 3 * (y * largeur + x));
  return t;
}

/** Les pixels d'un PNG, relus par MuPDF. */
function pixelsDuPng(png: Uint8Array) {
  const pix = new mupdf.Image(png).toPixmap();
  const n = pix.getNumberOfComponents() + pix.getAlpha();
  const p = pix.getPixels(), ligne = pix.getStride();
  return {
    largeur: pix.getWidth(), hauteur: pix.getHeight(), rvb: pix.getColorSpace()?.isRGB() ?? false,
    pixel: (x: number, y: number) => [...p.subarray(y * ligne + x * n, y * ligne + x * n + n)],
  };
}

describe("reconnaissance du format", () => {
  it("lit les signatures des formats courants", () => {
    expect(formatImage(octetsDe([0xff, 0xd8, 0xff, 0xe1]))).toBe("jpeg");
    expect(formatImage(octetsDe("\x89PNG\r\n\x1a\n"))).toBe("png");
    expect(formatImage(octetsDe("GIF89a"))).toBe("gif");
    expect(formatImage(octetsDe("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
    expect(formatImage(octetsDe("BM", [0, 0, 0, 0]))).toBe("bmp");
    expect(formatImage(octetsDe("II*\0"))).toBe("tiff");
    expect(formatImage(octetsDe("MM\0*"))).toBe("tiff");
    expect(formatImage(octetsDe([0, 0, 0, 12], "jP  \r\n\x87\n"))).toBe("jpeg2000");
    expect(formatImage(octetsDe("%PDF-1.7"))).toBe("inconnu");
    expect(formatImage(new Uint8Array(0))).toBe("inconnu");
  });

  it("distingue HEIC et AVIF, qui partagent la même structure de fichier", () => {
    expect(formatImage(ftyp("heic", "mif1", "heic"))).toBe("heif");
    expect(formatImage(ftyp("mif1", "heic"))).toBe("heif");
    expect(formatImage(ftyp("heix", "mif1"))).toBe("heif");
    expect(formatImage(ftyp("avif", "mif1", "miaf"))).toBe("avif");
    expect(formatImage(ftyp("mif1", "avif", "miaf"))).toBe("avif");
    expect(formatImage(ftyp("isom", "mp41"))).toBe("inconnu"); // une vidéo MP4
    expect(formatImage(HEIC.subarray(0, 64))).toBe("heif");
  });

  it("reconnaît une image à son extension quand le système n'annonce pas de type", () => {
    expect(estImage({ name: "IMG_0042.HEIC", type: "" })).toBe(true);
    expect(estImage({ name: "photo.heif", type: "" })).toBe(true);
    expect(estImage({ name: "scan.tif", type: "" })).toBe(true);
    expect(estImage({ name: "sans-extension", type: "image/heic" })).toBe(true);
    expect(estImage({ name: "devis.pdf", type: "application/pdf" })).toBe(false);
    expect(estImage({ name: "notes.txt", type: "" })).toBe(false);
  });
});

describe("photos HEIC (libheif)", () => {
  it("décode la photo et applique sa rotation, comme pour une photo d'iPhone prise en hauteur", async () => {
    const images = new (creerLibheif().HeifDecoder)().decode(HEIC);
    expect(images.length).toBe(1);
    const image = images[0];
    expect(image.is_primary()).toBe(true);
    expect(image.has_alpha_channel()).toBe(false);
    // 96 × 64 tourné d'un quart de tour dans le sens des aiguilles d'une montre : 64 × 96.
    const largeur = image.get_width(), hauteur = image.get_height();
    expect([largeur, hauteur]).toEqual([64, 96]);
    const cible = { data: new Uint8ClampedArray(largeur * hauteur * 4), width: largeur, height: hauteur };
    await new Promise<void>((ok, ko) => image.display(cible, (r) => (r ? ok() : ko(new Error("décodage HEIC impossible")))));
    const pixel = (x: number, y: number) => [...cible.data.subarray(4 * (y * largeur + x), 4 * (y * largeur + x) + 4)];
    const proche = (reel: number[], attendu: number[]) => attendu.every((v, k) => Math.abs(reel[k] - v) <= 24);
    // Après rotation : bleu en haut à gauche, rouge en haut à droite, jaune en bas à gauche, vert en bas à droite.
    expect(proche(pixel(8, 8), [40, 60, 220, 255])).toBe(true);
    expect(proche(pixel(56, 8), [220, 30, 30, 255])).toBe(true);
    expect(proche(pixel(8, 88), [240, 200, 20, 255])).toBe(true);
    expect(proche(pixel(56, 88), [30, 180, 60, 255])).toBe(true);
  });

  it("ne trouve aucune image dans un fichier qui n'est pas un HEIC", () => {
    expect(new (creerLibheif().HeifDecoder)().decode(octetsDe("%PDF-1.7 pas une image"))).toEqual([]);
  });
});

describe("formats lus par MuPDF", () => {
  it("convertit un TIFF en PNG, pixels intacts", () => {
    const couleur = (x: number, y: number): [number, number, number] => (x < 3 ? [200, 30, 40] : [20, 90 + y * 10, 230]);
    const png = imageEnPng(tiff(6, 4, couleur));
    expect(formatImage(png)).toBe("png");
    const r = pixelsDuPng(png);
    expect([r.largeur, r.hauteur, r.rvb]).toEqual([6, 4, true]);
    for (const [x, y] of [[0, 0], [2, 3], [3, 0], [5, 3]]) expect(r.pixel(x, y)).toEqual(couleur(x, y));
  });

  it("convertit un JPEG en CMJN (fichier d'imprimerie) en RVB", () => {
    const cmjn = new mupdf.Pixmap(mupdf.ColorSpace.DeviceCMYK, [0, 0, 16, 16], false);
    const p = cmjn.getPixels();
    for (let i = 0; i < p.length; i += 4) p.set([255, 0, 0, 0], i); // cyan pur
    // Valeurs inversées, comme dans les JPEG en CMJN de Photoshop (marqueur Adobe).
    const png = imageEnPng(cmjn.asJPEG(95, true));
    const r = pixelsDuPng(png);
    expect(r.rvb).toBe(true);
    const [rouge, vert, bleu] = r.pixel(8, 8);
    expect(rouge).toBeLessThan(80);
    expect(vert).toBeGreaterThan(120);
    expect(bleu).toBeGreaterThan(200);
  });

  it("refuse un fichier qui n'est pas une image", () => {
    expect(() => imageEnPng(octetsDe("ceci n'est pas une image"))).toThrow();
  });
});
