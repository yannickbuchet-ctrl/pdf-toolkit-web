// Parcours dans un vrai navigateur (Chromium sans fenêtre, par Playwright) du site construit : ouvrir un PDF, modifier un
// texte, enregistrer, puis vérifier le fichier téléchargé. Captures d'écran dans captures/.
// Lancer après « npm run build » : node scripts/parcours-navigateur.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";

const racine = path.resolve(import.meta.dirname, "..");
const captures = path.join(racine, "captures");
fs.mkdirSync(captures, { recursive: true });
const PORT = 4179;

/** Un PDF d'exemple, sans aucune donnée personnelle. */
function exemple() {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const gras = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"), "Latin");
  const times = doc.addSimpleFont(new mupdf.Font("Times-Roman"), "Latin");
  const code = (t) => [...t].map((c) => {
    const cp = c.codePointAt(0);
    const w = { 0x20ac: 0x80, 0x2019: 0x92, 0x2014: 0x97 }[cp] ?? cp;
    return w.toString(16).padStart(2, "0");
  }).join("");
  const ligne = (f, taille, x, y, t, c = "0 0 0") => `BT ${c} rg /${f} ${taille} Tf ${x} ${842 - y} Td <${code(t)}> Tj ET\n`;
  const pages = [
    ligne("G", 22, 72, 90, "Devis n° 2026-118") + ligne("H", 12, 72, 130, "Atelier Exemple — 12 rue des Lilas, 75000 Paris") +
      ligne("H", 12, 72, 170, "Rénovation de la cuisine : 4 250 €") + ligne("H", 12, 72, 190, "Peinture du séjour : 1 180 €") +
      ligne("G", 12, 72, 220, "Total : 5 430 € TTC") + ligne("T", 12, 72, 270, "Devis valable trois mois à compter de sa date d’émission.") +
      "q 0.15 0.39 0.92 rg 72 520 451 3 re f Q\n",
    ligne("G", 18, 72, 90, "Conditions générales") + ligne("T", 12, 72, 130, "Un acompte de 30 % est demandé à la signature.") +
      ligne("T", 12, 72, 150, "Le solde est réglé à la fin des travaux."),
  ];
  for (const contenu of pages) doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { Font: { H: helv, G: gras, T: times } }, contenu));
  return doc.saveToBuffer("garbage=2,compress").asUint8Array().slice();
}

const serveur = spawn(process.execPath, [path.join(racine, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: racine, stdio: "pipe" });
await new Promise((ok, ko) => {
  serveur.stdout.on("data", (d) => String(d).includes(String(PORT)) && ok());
  serveur.on("exit", ko);
  setTimeout(() => ko(new Error("serveur muet")), 20000);
});

const erreurs = [];
const navigateur = await chromium.launch();
try {
  for (const theme of ["light", "dark"]) {
    const contexte = await navigateur.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: theme, acceptDownloads: true, locale: "fr-FR" });
    // Les fenêtres natives du système (choisir un fichier) ne s'ouvrent pas sans écran : l'application se rabat alors
    // sur le téléchargement, comme dans Firefox ou Safari.
    await contexte.addInitScript(() => {
      delete window.showOpenFilePicker;
      delete window.showSaveFilePicker;
    });
    const page = await contexte.newPage();
    page.on("pageerror", (e) => erreurs.push(`${theme} : ${e.message}`));
    page.on("console", (m) => m.type() === "error" && erreurs.push(`${theme} console : ${m.text()}`));
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(captures, `accueil-${theme}.png`) });
    if (theme === "dark") {
      await contexte.close();
      continue;
    }

    // Ouvrir : dépôt d'un fichier sur la page.
    const octets = [...exemple()];
    await page.evaluate((o) => {
      const f = new File([new Uint8Array(o)], "devis-exemple.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(f);
      for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, octets);
    await page.locator(".page canvas.rendu").first().waitFor();
    await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(captures, "document.png") });

    // Modifier un texte.
    await page.getByRole("button", { name: "Modifier le texte" }).click();
    const morceau = page.getByRole("button", { name: "Modifier le texte : Rénovation de la cuisine : 4 250 €" });
    await morceau.waitFor();
    await page.screenshot({ path: path.join(captures, "mode-texte.png") });
    await morceau.click();
    const editeur = page.locator("input.editeur");
    await editeur.waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(captures, "edition.png") });
    await editeur.fill("Rénovation complète de la cuisine : 4 900 €");
    await editeur.press("Enter");
    await page.locator(".etat .message.succes").waitFor({ timeout: 20000 });
    const bilan = await page.locator(".etat .message").textContent();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(captures, "texte-modifie.png") });

    // Recherche sans accents.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+f");
    await page.getByRole("searchbox", { name: "Rechercher" }).fill("renovation");
    await page.waitForFunction(() => document.querySelector(".compte")?.textContent?.includes("sur"));
    const compte = await page.locator(".compte").textContent();
    await page.screenshot({ path: path.join(captures, "recherche.png") });

    // Enregistrer : la fenêtre de compression, puis le téléchargement.
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 840 } });
    await page.keyboard.press("Control+s");
    await page.getByRole("dialog", { name: "Enregistrer" }).waitFor();
    await page.screenshot({ path: path.join(captures, "enregistrer.png") });
    const [telechargement] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("dialog", { name: "Enregistrer" }).getByRole("button", { name: "Enregistrer" }).click(),
    ]);
    const fichier = path.join(captures, "..", "dist", "parcours-enregistre.pdf");
    await telechargement.saveAs(fichier);
    const relu = mupdf.Document.openDocument(fs.readFileSync(fichier), "application/pdf");
    const texte = relu.loadPage(0).toStructuredText().asText();
    if (!texte.includes("Rénovation complète de la cuisine : 4 900 €") || texte.includes("4 250")) throw new Error("Le fichier enregistré ne contient pas le texte modifié :\n" + texte);

    // Infos sur les polices, photos d'identité et comparaison.
    await page.getByRole("button", { name: "Outils" }).click();
    await page.getByRole("menuitem", { name: "Infos sur les polices…" }).click();
    await page.getByRole("dialog", { name: "Infos sur les polices" }).waitFor();
    await page.locator("dialog details").first().evaluate((d) => (d.open = true));
    await page.screenshot({ path: path.join(captures, "polices.png") });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Outils" }).click();
    await page.getByRole("menuitem", { name: "Comparer deux PDF…" }).click();
    const dialogue = page.getByRole("dialog", { name: "Comparer deux PDF" });
    await dialogue.waitFor();
    // Version B : le fichier d'origine, déposé sur sa zone.
    await page.evaluate((o) => {
      const f = new File([new Uint8Array(o)], "devis-origine.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(f);
      const zone = document.querySelectorAll(".version")[1];
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, octets);
    await dialogue.getByText("devis-origine.pdf — 2 pages").waitFor();
    await dialogue.getByRole("button", { name: "Comparer" }).click();
    await dialogue.locator(".difference").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(captures, "comparaison.png") });
    const differences = await dialogue.locator(".difference").count();
    await page.keyboard.press("Escape");

    // Photos d'identité : une photo d'essai (dégradé et visage stylisé), puis la planche.
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 900, 1200], false);
    const px = pix.getPixels();
    for (let y = 0; y < 1200; y++) for (let x = 0; x < 900; x++) {
      const i = (y * 900 + x) * 3;
      const visage = ((x - 450) / 230) ** 2 + ((y - 520) / 300) ** 2 < 1;
      px[i] = visage ? 235 : 150 + y / 12; px[i + 1] = visage ? 200 : 180; px[i + 2] = visage ? 170 : 220;
    }
    const photo = path.join(racine, "dist", "photo-essai.jpg");
    fs.writeFileSync(photo, pix.asJPEG(90));
    await page.getByRole("button", { name: "Outils" }).click();
    const [choix] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: "Photos d’identité…" }).click()]);
    await choix.setFiles(photo);
    const photoDlg = page.getByRole("dialog", { name: "Photos d’identité" });
    await photoDlg.waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(captures, "photos-identite.png") });
    await photoDlg.getByRole("button", { name: "Créer la planche" }).click();
    await page.locator(".etat .message.succes", { hasText: "Planche créée" }).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(captures, "planche.png") });
    const planche = await page.locator(".etat .message").textContent();
    console.log(`Planche : ${planche}`);

    await contexte.close();

    // Téléphone : le document et la barre d'outils à 390 pixels de large.
    const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" });
    const tel = await mobile.newPage();
    tel.on("pageerror", (e) => erreurs.push(`mobile : ${e.message}`));
    await tel.goto(`http://localhost:${PORT}/`);
    await tel.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
    await tel.evaluate((o) => {
      const f = new File([new Uint8Array(o)], "devis-exemple.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(f);
      for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, octets);
    await tel.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
    await tel.getByRole("button", { name: "Ajuster à la largeur" }).click();
    await tel.waitForTimeout(800);
    await tel.screenshot({ path: path.join(captures, "telephone.png") });
    await mobile.close();
    console.log(`Bilan de la modification : ${bilan}`);
    console.log(`Recherche « renovation » : ${compte}`);
    console.log(`Comparaison avec l'original : ${differences} différence(s)`);
    console.log("Fichier enregistré vérifié :", fichier);
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
if (erreurs.length) {
  console.log("Erreurs de la page :\n" + erreurs.join("\n"));
  process.exitCode = 1;
}
console.log("Captures dans", captures);
