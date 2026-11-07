// Formats de photo dans un vrai navigateur (Chromium sans fenêtre, par Playwright), sur le site construit. Une photo
// HEIC d'iPhone est insérée sur ordinateur et sur téléphone : Chromium ne sait pas la lire, le décodeur du site prend
// le relais. Sont aussi essayés : un TIFF, une très grande photo JPEG tournée par son EXIF, un PNG transparent, une
// photo HEIC déposée sans type de fichier, les photos d'identité, puis l'insertion hors connexion. Le PDF enregistré
// est relu, et aucune requête ne doit quitter le site. Captures et fichiers dans dist/essai-images/.
// Lancer après « npm run build » : node scripts/essai-images.mjs [grande photo .heic, facultative, pour le temps]
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";

const racine = path.resolve(import.meta.dirname, "..");
const sortie = path.join(racine, "dist", "essai-images");
fs.mkdirSync(sortie, { recursive: true });
const PORT = 4181;
const HEIC = path.join(racine, "tests", "images", "quadrants-quart-de-tour.heic");
const GRANDE_HEIC = process.argv[2] ?? null;

const verifier = (condition, message) => {
  if (!condition) throw new Error(message);
};

/* --- Fichiers d'essai, tous fabriqués ici --------------------------------------------------------------------- */

function pdfExemple() {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { Font: { H: helv } }, "BT /H 18 Tf 72 760 Td (Page d'essai des images) Tj ET"));
  return doc.saveToBuffer("compress").asUint8Array().slice();
}

/** TIFF RVB non compressé : moitié gauche rouge, moitié droite bleue. */
function tiff(largeur, hauteur) {
  const entrees = [[256, 3, 1, largeur], [257, 3, 1, hauteur], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, hauteur], [279, 4, 1, largeur * hauteur * 3]];
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
  for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) t.set(x < largeur / 2 ? [210, 30, 30] : [30, 60, 210], donnees + 3 * (y * largeur + x));
  return t;
}

/** Photo JPEG de 6000 × 4000 (24 Mpx), bande rouge en haut, enregistrée « à tourner d'un quart de tour » (EXIF 6). */
function grandJpegTourne() {
  const [l, h] = [6000, 4000];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, l, h], false);
  const p = pix.getPixels();
  for (let y = 0; y < h; y++) {
    const c = y < 1000 ? [220, 30, 30] : [120, 140, 160];
    for (let x = 0; x < l; x++) p.set(c, 3 * (y * l + x));
  }
  const jpeg = pix.asJPEG(85);
  const tiffExif = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
  const app1 = [0xff, 0xe1, 0, 2 + 6 + tiffExif.length, ...[..."Exif\0\0"].map((c) => c.charCodeAt(0)), ...tiffExif];
  return new Uint8Array([0xff, 0xd8, ...app1, ...jpeg.subarray(2)]);
}

/** PNG de 200 × 120 avec un trou transparent au milieu. */
function pngTransparent() {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 200, 120], true);
  const p = pix.getPixels();
  for (let y = 0; y < 120; y++) for (let x = 0; x < 200; x++) p.set([30, 160, 80, x > 60 && x < 140 ? 0 : 255], 4 * (y * 200 + x));
  return pix.asPNG();
}

const fichiers = {
  tiff: path.join(sortie, "scan.tif"),
  jpeg: path.join(sortie, "grande-photo-tournee.jpg"),
  png: path.join(sortie, "logo-transparent.png"),
};
fs.writeFileSync(fichiers.tiff, tiff(300, 200));
fs.writeFileSync(fichiers.jpeg, grandJpegTourne());
fs.writeFileSync(fichiers.png, pngTransparent());

/** Les images du PDF (hors masques de transparence) : dimensions, filtre, masque, et la lecture de leurs pixels. */
function imagesDuPdf(octets) {
  const doc = mupdf.Document.openDocument(octets, "application/pdf").asPDF();
  const estImage = (ref) => {
    try {
      const sous = ref.isStream() && ref.get("Subtype");
      return !!sous && sous.isName() && sous.asName() === "Image";
    } catch {
      return false;
    }
  };
  const refs = [];
  for (let num = 1; num < doc.countObjects(); num++) if (estImage(doc.newIndirect(num))) refs.push(doc.newIndirect(num));
  const masques = new Set(refs.filter((r) => !r.get("SMask").isNull()).map((r) => r.get("SMask").asIndirect()));
  const images = [];
  for (const ref of refs) {
    if (masques.has(ref.asIndirect())) continue;
    const filtre = ref.get("Filter");
    images.push({
      largeur: ref.get("Width").asNumber(), hauteur: ref.get("Height").asNumber(),
      filtre: filtre.isName() ? filtre.asName() : String(filtre), masque: !ref.get("SMask").isNull(),
      pixel: (x, y) => {
        const pix = doc.loadImage(ref).toPixmap();
        const n = pix.getNumberOfComponents() + pix.getAlpha();
        return [...pix.getPixels().subarray(y * pix.getStride() + x * n, y * pix.getStride() + x * n + 3)];
      },
    });
  }
  return images;
}
const proche = (reel, attendu, tolerance = 30) => attendu.every((v, k) => Math.abs(reel[k] - v) <= tolerance);

/* --- Le navigateur ------------------------------------------------------------------------------------------ */

const serveur = spawn(process.execPath, [path.join(racine, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: racine, stdio: "pipe" });
await new Promise((ok, ko) => {
  serveur.stdout.on("data", (d) => String(d).includes(String(PORT)) && ok());
  serveur.on("exit", ko);
  setTimeout(() => ko(new Error("serveur muet")), 20000);
});

const erreurs = [];
const externes = [];
const bilan = [];
const surveiller = (contexte, nom) => {
  contexte.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.protocol === "http:" || u.protocol === "https:") && u.host !== `localhost:${PORT}`) externes.push(`${nom} : ${r.url()}`);
  });
  contexte.on("page", (page) => {
    page.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
    page.on("console", (m) => m.type() === "error" && erreurs.push(`${nom} console : ${m.text()}`));
  });
};

async function ouvrirPdf(page) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
  await page.evaluate((o) => {
    const f = new File([new Uint8Array(o)], "essai-images.pdf", { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [...pdfExemple()]);
  await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
}

/** Insère une image par le menu ; renvoie le temps de lecture (du choix du fichier à l'image prête à placer). */
async function inserer(page, chemin, telephone = false) {
  let choix;
  if (telephone) {
    await page.getByRole("navigation", { name: "Actions du document" }).getByRole("button", { name: "Annoter" }).tap();
    [choix] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menu", { name: "Annoter" }).getByRole("menuitem", { name: "Insérer une image…" }).tap()]);
  } else {
    [choix] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Insérer une image" }).click()]);
  }
  const accept = await choix.element().getAttribute("accept");
  verifier(accept.includes(".heic") && accept.includes("image/*"), `la fenêtre de choix n'accepte pas le HEIC : ${accept}`);
  const debut = Date.now();
  await choix.setFiles(chemin);
  await valider(page, telephone);
  return Date.now() - debut;
}

async function valider(page, telephone) {
  const boite = page.locator(".placement");
  await boite.waitFor({ timeout: 90000 });
  if (telephone) await boite.getByRole("button", { name: "Valider" }).tap();
  else await boite.getByRole("button", { name: "Valider" }).click();
  await page.locator(".etat .message.succes", { hasText: "Image ajoutée" }).waitFor({ timeout: 30000 });
}

async function enregistrer(page, nom) {
  await page.keyboard.press("Control+s");
  const dialogue = page.getByRole("dialog", { name: "Enregistrer" });
  await dialogue.waitFor();
  await dialogue.getByRole("radio", { name: /Ne pas compresser/ }).check();
  const [telechargement] = await Promise.all([page.waitForEvent("download"), dialogue.getByRole("button", { name: "Enregistrer" }).click()]);
  const fichier = path.join(sortie, nom);
  await telechargement.saveAs(fichier);
  return fs.readFileSync(fichier);
}

const navigateur = await chromium.launch();
try {
  /* Ordinateur */
  const contexte = await navigateur.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, locale: "fr-FR" });
  surveiller(contexte, "ordinateur");
  await contexte.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
  const page = await contexte.newPage();
  page.on("dialog", (d) => d.accept()); // « Quitter sans enregistrer ? » au rechargement
  await ouvrirPdf(page);
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 }).catch(() => {});
  const controle = await page.evaluate(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined);

  const tHeic = await inserer(page, HEIC);
  bilan.push(`HEIC 96 × 64 (rotation irot), ordinateur : lue en ${tHeic} ms`);
  const tTiff = await inserer(page, fichiers.tiff);
  bilan.push(`TIFF 300 × 200 : lu en ${tTiff} ms`);
  const tJpeg = await inserer(page, fichiers.jpeg);
  bilan.push(`JPEG 6000 × 4000 tourné par l'EXIF : lu en ${tJpeg} ms`);
  const tPng = await inserer(page, fichiers.png);
  bilan.push(`PNG transparent : lu en ${tPng} ms`);

  // Photo HEIC déposée sur la page, sans type de fichier (comme sous Windows sans l'extension HEIF).
  await page.evaluate((o) => {
    const f = new File([new Uint8Array(o)], "IMG_0042.HEIC", { type: "" });
    const dt = new DataTransfer();
    dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [...fs.readFileSync(HEIC)]);
  await valider(page, false);
  bilan.push("HEIC déposé sans type : inséré");
  await page.screenshot({ path: path.join(sortie, "ordinateur-images.png") });

  const enregistre = await enregistrer(page, "ordinateur.pdf");
  const images = imagesDuPdf(enregistre);
  const decrire = (i) => `${i.largeur} × ${i.hauteur} ${i.filtre}${i.masque ? " + masque" : ""}`;
  bilan.push(`Images du PDF enregistré : ${images.map(decrire).join(" ; ")}`);
  // Cinq images posées sur la page ; les deux photos HEIC identiques partagent le même objet image.
  const posees = mupdf.Document.openDocument(enregistre, "application/pdf").asPDF().loadPage(0).getObject().get("Resources").get("XObject");
  let nombre = 0;
  posees.forEach(() => nombre++);
  verifier(nombre === 5, `cinq images attendues sur la page, ${nombre} trouvées`);
  const heic = images.filter((i) => i.largeur === 64 && i.hauteur === 96);
  verifier(heic.length === 1, "la photo HEIC tournée (64 × 96) devrait être dans le PDF");
  for (const i of heic) {
    verifier(i.filtre === "DCTDecode" && !i.masque, `photo HEIC : JPEG sans masque attendu, ${decrire(i)}`);
    verifier(proche(i.pixel(8, 8), [40, 60, 220]) && proche(i.pixel(56, 8), [220, 30, 30]) && proche(i.pixel(8, 88), [240, 200, 20]),
      `photo HEIC mal orientée : ${i.pixel(8, 8)} / ${i.pixel(56, 8)} / ${i.pixel(8, 88)}`);
  }
  const scan = images.find((i) => i.largeur === 300 && i.hauteur === 200);
  verifier(scan && scan.filtre === "DCTDecode" && proche(scan.pixel(20, 100), [210, 30, 30]) && proche(scan.pixel(280, 100), [30, 60, 210]), "TIFF absent ou faux");
  const grande = images.find((i) => i.hauteur > i.largeur && i.hauteur > 2000);
  verifier(grande && grande.largeur * grande.hauteur <= 16_000_000 && grande.largeur * grande.hauteur > 15_000_000, `grande photo : réduction à 16 Mpx attendue (${grande && decrire(grande)})`);
  verifier(proche(grande.pixel(grande.largeur - 20, grande.hauteur / 2), [220, 30, 30]) && proche(grande.pixel(20, grande.hauteur / 2), [120, 140, 160]),
    "grande photo : la bande rouge (en haut de l'image d'origine) devrait être à droite après rotation");
  const transparent = images.find((i) => i.largeur === 200 && i.hauteur === 120);
  verifier(transparent && transparent.masque, "le PNG transparent devrait garder sa transparence (masque)");

  // Photos d'identité à partir d'une photo HEIC.
  await page.getByRole("button", { name: "Outils" }).click();
  const [choix] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: "Photos d’identité…" }).click()]);
  const debutPhoto = Date.now();
  await choix.setFiles(GRANDE_HEIC ?? HEIC);
  const photoDlg = page.getByRole("dialog", { name: "Photos d’identité" });
  await photoDlg.waitFor({ timeout: 90000 });
  bilan.push(`Photos d'identité, ${GRANDE_HEIC ? "grande photo HEIC" : "photo HEIC"} : fenêtre ouverte en ${Date.now() - debutPhoto} ms`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(sortie, "ordinateur-photo-identite.png") });
  await photoDlg.getByRole("button", { name: "Créer la planche" }).click();
  await page.locator(".etat .message.succes", { hasText: "Planche créée" }).waitFor({ timeout: 30000 });

  // Hors connexion : le lecteur HEIC a été gardé par le service worker à sa première utilisation.
  if (controle) {
    await contexte.setOffline(true);
    await ouvrirPdf(page);
    const tHorsLigne = await inserer(page, HEIC);
    bilan.push(`Hors connexion, après rechargement : HEIC lue en ${tHorsLigne} ms`);
    await contexte.setOffline(false);
  } else bilan.push("Hors connexion : non essayé (service worker inactif)");
  if (GRANDE_HEIC) {
    await ouvrirPdf(page);
    bilan.push(`Grande photo HEIC (${path.basename(GRANDE_HEIC)}), ordinateur : lue en ${await inserer(page, GRANDE_HEIC)} ms`);
  }
  await contexte.close();

  /* Téléphone */
  const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: "fr-FR" });
  surveiller(mobile, "téléphone");
  const lecteurHeic = [];
  mobile.on("request", (r) => r.url().includes("heic.worker") && lecteurHeic.push(r.url()));
  const tel = await mobile.newPage();
  await ouvrirPdf(tel);
  await tel.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
  await tel.waitForTimeout(1500);
  verifier(lecteurHeic.length === 0, "le lecteur HEIC ne devrait être téléchargé qu'à la première photo HEIC");
  bilan.push(`HEIC, téléphone : lue en ${await inserer(tel, HEIC, true)} ms`);
  verifier(lecteurHeic.length > 0, "le lecteur HEIC aurait dû être téléchargé");
  if (GRANDE_HEIC) bilan.push(`Grande photo HEIC, téléphone : lue en ${await inserer(tel, GRANDE_HEIC, true)} ms`);
  await tel.waitForTimeout(400);
  await tel.screenshot({ path: path.join(sortie, "telephone-images.png") });
  await mobile.close();
} finally {
  await navigateur.close();
  serveur.kill();
}

console.log(bilan.join("\n"));
if (externes.length) {
  console.log("Requêtes hors du site :\n" + externes.join("\n"));
  process.exitCode = 1;
}
if (erreurs.length) {
  console.log("Erreurs de la page :\n" + erreurs.join("\n"));
  process.exitCode = 1;
}
console.log("Captures et fichiers dans", sortie);
