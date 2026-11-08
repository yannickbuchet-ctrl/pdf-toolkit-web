// Essai des fonctions de l'accueil, dans Chromium sans fenêtre : chaque tuile fait choisir un PDF, puis ouvre
// directement l'outil choisi (mode texte, pages, OCR, signature, compression, mot de passe). Sur ordinateur et sur
// téléphone. Le PDF est fabriqué ici, sans aucun document personnel.
//
// Lancer après « npm run build » : node scripts/essai-accueil.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import * as mupdf from "mupdf";

const racine = path.resolve(import.meta.dirname, "..");
const PORT = 4184;

function verifier(condition, message) {
  if (!condition) throw new Error(message);
}

function pdfDEssai() {
  const doc = new mupdf.PDFDocument();
  const police = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  for (const texte of ["Premiere page d'essai", "Deuxieme page d'essai"]) {
    const page = doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F: police } }), `BT /F 14 Tf 72 760 Td (${texte}) Tj ET`);
    doc.insertPage(-1, page);
  }
  return Buffer.from(doc.saveToBuffer("compress").asUint8Array());
}

const serveur = spawn(process.execPath, [path.join(racine, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: racine, stdio: "pipe" });
await new Promise((ok, ko) => {
  serveur.stdout.on("data", (d) => String(d).includes(String(PORT)) && ok());
  serveur.on("exit", ko);
  setTimeout(() => ko(new Error("serveur muet")), 20000);
});

const fichier = { name: "essai-accueil.pdf", mimeType: "application/pdf", buffer: pdfDEssai() };
const TUILES = [
  ["Modifier le texte", async (p, tel) => (await p.locator(tel ? ".barre-mobile .bouton" : ".barre .bouton", { hasText: tel ? "Modifier" : "Modifier le texte" }).first().getAttribute("aria-pressed")) === "true", "mode texte actif"],
  ["Organiser les pages", async (p, tel) => p.evaluate((t) => document.querySelector(".corps").classList.contains(t ? "miniatures-ouvertes" : "grille"), tel), "pages en grille (ou panneau des pages)"],
  ["Reconnaissance de texte (OCR)", (p) => p.locator("dialog.ocr").isVisible(), "fenêtre de l'OCR"],
  ["Signer et annoter", (p) => p.locator("dialog", { hasText: "Signature" }).first().isVisible(), "fenêtre de la signature"],
  ["Compresser", (p) => p.locator("dialog", { hasText: "ompress" }).first().isVisible(), "fenêtre de la compression"],
  ["Mots de passe", (p) => p.locator("dialog", { hasText: "mot de passe" }).first().isVisible(), "fenêtre du mot de passe"],
];

const navigateur = await chromium.launch();
const bilan = [];
try {
  for (const [appareil, options] of [["ordinateur", { viewport: { width: 1360, height: 860 } }], ["téléphone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const contexte = await navigateur.newContext({ ...options, locale: "fr-FR" });
    await contexte.addInitScript(() => delete window.showOpenFilePicker);
    for (const [titre, controle, attendu] of TUILES) {
      const page = await contexte.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(e.message));
      await page.goto(`http://localhost:${PORT}/`);
      await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
      const [choix] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".fonction", { hasText: titre }).click()]);
      await choix.setFiles(fichier);
      await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
      await page.waitForTimeout(600);
      const ok = await controle(page, appareil === "téléphone");
      if (titre === "Reconnaissance de texte (OCR)") await page.screenshot({ path: path.join(racine, "dist", `accueil-ocr-${appareil}.png`) });
      verifier(ok, `${appareil}, « ${titre} » : ${attendu} attendu après l'ouverture`);
      verifier(!erreurs.length, `${appareil}, « ${titre} » : ${erreurs.join(" ; ")}`);
      bilan.push(`${appareil} — ${titre} : ${attendu}`);
      await page.close();
    }
    // Choix annulé : l'accueil reste affiché, sans erreur.
    const page = await contexte.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
    const [choix] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".fonction", { hasText: "Compresser" }).click()]);
    await choix.setFiles([]);
    await page.waitForTimeout(500);
    verifier(await page.locator(".accueil").isVisible() && !(await page.locator("dialog").count()), `${appareil} : choix annulé`);
    await contexte.close();
  }
} finally {
  await navigateur.close();
  serveur.kill();
}
console.log(bilan.join("\n") + "\nTout est conforme.");
