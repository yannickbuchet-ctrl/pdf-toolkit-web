/**
 * Essai de la planche de copies et des liens dans le site lancé par « npm run dev » (port 5180 par défaut) :
 * node scripts/essai-copies.mjs [dossier des captures]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import * as mupdf from "mupdf";

const PORT = process.env.PORT ?? 5180;
const captures = process.argv[2] ?? "dist/essai-copies";
fs.mkdirSync(captures, { recursive: true });

// Une affiche A4 de 2 pages : un lien web et un lien vers la page 2.
const doc = new mupdf.PDFDocument();
const police = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
for (const texte of ["CONCERT", "PAGE DEUX"]) {
  doc.insertPage(-1, doc.addPage([0, 0, 595.28, 841.89], 0, { Font: { F1: police } },
    `0.9 0.2 0.2 rg 0 700 595.28 141.89 re f BT /F1 64 Tf 60 420 Td (${texte}) Tj ET BT /F1 20 Tf 60 300 Td (Site web) Tj ET BT /F1 20 Tf 60 250 Td (Voir page 2) Tj ET`));
}
const p0 = doc.loadPage(0);
p0.createLink([55, 520, 200, 548], "https://exemple.fr/");
p0.createLink([55, 570, 200, 598], doc.formatLinkURI(new mupdf.LinkDestination(0, 1, "XYZ", 0, 0)));
const octets = [...doc.saveToBuffer("").asUint8Array()];

const navigateur = await chromium.launch();
const erreurs = [];
try {
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => erreurs.push(e.message));
  page.on("console", (m) => m.type() === "error" && erreurs.push(`console : ${m.text()}`));
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
  await page.evaluate((o) => {
    const f = new File([new Uint8Array(o)], "affiche.pdf", { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, octets);
  await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);

  // Liens : l'adresse web est un vrai lien, le lien interne mène à la page 2.
  const web = page.locator('a.lien[href="https://exemple.fr/"]');
  await web.waitFor({ timeout: 10000 });
  if ((await web.getAttribute("target")) !== "_blank") throw new Error("le lien web ne s'ouvre pas dans un nouvel onglet");
  const haut = await page.locator(".visionneuse, #visionneuse").first().evaluate((v) => v.scrollTop).catch(() => -1);
  await page.locator('a.lien[href="#"]').click();
  await page.waitForTimeout(300);
  const apres = await page.locator(".visionneuse, #visionneuse").first().evaluate((v) => v.scrollTop).catch(() => -1);
  console.log("défilement avant/après le lien interne :", haut, apres);
  if (!(apres > haut)) throw new Error("le lien interne ne mène pas à la page 2");

  // Planche de copies : 4 × A6 sur A4, puis 8.
  await page.getByRole("button", { name: "Outils" }).click();
  await page.getByRole("menuitem", { name: "Planche de copies d’une page…" }).click();
  const dialogue = page.locator("dialog[open]");
  await dialogue.getByText("4 copies —").waitFor();
  console.log("choix :", (await dialogue.locator(".choix-copies").innerText()).replace(/\n/g, " | "));
  await page.waitForTimeout(500);
  await dialogue.screenshot({ path: `${captures}/dialogue-4.png` });
  await dialogue.getByText("8 copies —").click();
  await page.waitForTimeout(300);
  await dialogue.screenshot({ path: `${captures}/dialogue-8.png` });
  await dialogue.getByText("4 copies —").click();
  await dialogue.getByRole("button", { name: "Afficher la planche" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".page").length === 1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${captures}/planche.png` });
  console.log("message :", await page.locator("[role=status], .message").first().innerText().catch(() => ""));
} finally {
  await navigateur.close();
}
if (erreurs.length) {
  console.error("Erreurs :\n" + erreurs.join("\n"));
  process.exit(1);
}
console.log("OK");
