// Reconnaissance de texte (OCR) dans un vrai navigateur (Chromium sans fenêtre, par Playwright), sur le site construit,
// avec des scans de synthèse (aucun document personnel). Sur ordinateur : fenêtre « Reconnaissance de texte », page
// déjà textuelle laissée telle quelle, page à l'envers redressée, recherche sans accents dans le texte reconnu, texte
// reconnu non modifiable, Ctrl+Z et Ctrl+Y, OCR refaite sans doublon, arrêt en cours de lecture, Ctrl+Maj+O, texte
// copié et enregistré en .txt, PDF enregistré relu. Puis sur téléphone, et hors connexion (après une première
// utilisation en ligne, en français puis en anglais). Les fichiers de l'OCR ne doivent être téléchargés qu'à la première
// utilisation, et aucune requête ne doit quitter le site. Captures dans captures/ (ocr-*.png, telephone-ocr*.png).
// Lancer après « npm run build » : node scripts/essai-ocr.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";

const racine = path.resolve(import.meta.dirname, "..");
const captures = path.join(racine, "captures");
const sortie = path.join(racine, "dist", "essai-ocr");
fs.mkdirSync(sortie, { recursive: true });
const PORT = 4183;

const verifier = (condition, message) => {
  if (!condition) throw new Error(message);
};

/* --- Scans de synthèse ------------------------------------------------------------------------------------------ */

const WIN = { 0x20ac: 0x80, 0x2019: 0x92, 0x153: 0x9c, 0x152: 0x8c, 0xab: 0xab, 0xbb: 0xbb };
const codes = (t) => [...t].map((c) => (WIN[c.codePointAt(0)] ?? c.codePointAt(0)).toString(16).padStart(2, "0")).join("");

/** Une page A4 de texte, en Times, à partir de 72 pt du bord. */
function pageDeTexte(doc, lignes) {
  const f = doc.addSimpleFont(new mupdf.Font("Times-Roman"), "Latin");
  let y = 90, contenu = "";
  for (const [taille, texte] of lignes) {
    contenu += `BT /F ${taille} Tf 72 ${842 - y} Td <${codes(texte)}> Tj ET\n`;
    y += taille * 1.6;
  }
  return doc.addPage([0, 0, 595, 842], 0, { Font: { F: f } }, contenu);
}

/** Ajoute à doc le scan d'une page de texte : une image en niveaux de gris à 300 ppp, bruitée, à l'envers au choix. */
function ajouterScan(doc, lignes, aLEnvers = false) {
  const source = new mupdf.PDFDocument();
  source.insertPage(-1, pageDeTexte(source, lignes));
  const z = 300 / 72;
  const pix = source.loadPage(0).toPixmap(mupdf.Matrix.concat(mupdf.Matrix.scale(z, z), mupdf.Matrix.rotate(aLEnvers ? 180 : 0)), mupdf.ColorSpace.DeviceGray, false, false);
  const px = pix.getPixels();
  let s = 7;
  for (let k = 0; k < px.length; k++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    if (s / 2 ** 32 < 0.002) px[k] = Math.min(px[k], 120);
  }
  const image = doc.addImage(new mupdf.Image(pix));
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { XObject: { Im0: image } }, "q 595 0 0 842 0 0 cm /Im0 Do Q"));
}

const TEXTE = [
  [16, "Compte rendu de la réunion du 12 février"],
  [12, "Été comme hiver, l’équipe se réunit à Noël chez Hélène."],
  [12, "Le château de la forêt où naît la rivière coûte 450 €."],
  [12, "Les élèves ont reçu leurs bulletins après les vacances."],
];
const ANGLAIS = [
  [16, "Minutes of the annual meeting"],
  [12, "The committee agreed that the new library will open in spring."],
  [12, "All members are invited to the opening, with their families."],
];

/** Trois pages : un scan, une page de vrai texte, un scan à l'envers. */
function documentScanne() {
  const doc = new mupdf.PDFDocument();
  ajouterScan(doc, TEXTE);
  doc.insertPage(-1, pageDeTexte(doc, [[14, "Une page déjà lisible, écrite en vrai texte."]]));
  ajouterScan(doc, [[14, "Conditions générales de la location"], [12, "Le dépôt de garantie est rendu à la fin du séjour."], [12, "Les animaux ne sont pas acceptés dans le gîte."]], true);
  return doc.saveToBuffer("garbage=2,compress").asUint8Array().slice();
}

function documentAnglais() {
  const doc = new mupdf.PDFDocument();
  ajouterScan(doc, ANGLAIS);
  return doc.saveToBuffer("garbage=2,compress").asUint8Array().slice();
}

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
const fichiersOcr = [];
let horsLigneAttendu = false;
const surveiller = (contexte, nom) => {
  contexte.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.protocol === "http:" || u.protocol === "https:") && u.host !== `localhost:${PORT}`) externes.push(`${nom} : ${r.url()}`);
    if (/\/ocr-[0-9a-f]+\//.test(u.pathname)) fichiersOcr.push(`${nom} : ${u.pathname.split("/").pop()}`);
  });
  contexte.on("page", (page) => {
    page.on("pageerror", (e) => erreurs.push(`${nom} : ${e.message}`));
    // Hors connexion avant la première utilisation, le worker de Tesseract ne se charge pas : erreur attendue.
    page.on("console", (m) => m.type() === "error" && !(horsLigneAttendu && /ERR_INTERNET_DISCONNECTED|Failed to (fetch|load)/.test(m.text())) && erreurs.push(`${nom} console : ${m.text()}`));
  });
};

async function ouvrirPdf(page, octets, nom) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
  await page.evaluate(([o, nom]) => {
    const f = new File([new Uint8Array(o)], nom, { type: "application/pdf" });
    const dt = new DataTransfer();
    dt.items.add(f);
    for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [[...octets], nom]);
  await page.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
}

/** Ouvre la fenêtre de l'OCR par le menu Outils. */
async function fenetreOcr(page, telephone = false) {
  const outils = page.getByRole("button", { name: "Outils" });
  if (telephone) await outils.tap();
  else await outils.click();
  const entree = page.getByRole("menuitem", { name: "Reconnaissance de texte (OCR)…" });
  if (telephone) await entree.tap();
  else await entree.click();
  const dialogue = page.getByRole("dialog", { name: "Reconnaissance de texte (OCR)" });
  await dialogue.waitFor();
  return dialogue;
}

/** Lance la reconnaissance et attend le bilan ; renvoie [texte du bilan, durée en ms]. */
async function lancer(page, dialogue, telephone = false) {
  const debut = Date.now();
  const bouton = dialogue.getByRole("button", { name: /^(Lancer|Relancer)$/ });
  if (telephone) await bouton.tap();
  else await bouton.click();
  await dialogue.getByRole("button", { name: "Fermer", exact: true }).first().waitFor({ timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector("dialog .barre-progression:not([hidden])"), null, { timeout: 180000 });
  return [await dialogue.locator(".statut-ocr").textContent(), Date.now() - debut];
}

async function fermerFenetre(dialogue) {
  await dialogue.locator("footer").getByRole("button", { name: "Fermer", exact: true }).click();
  await dialogue.waitFor({ state: "detached" });
}

/** Cherche dans le document ; renvoie le nombre d'occurrences. */
async function chercher(page, texte) {
  if (await page.getByRole("searchbox", { name: "Rechercher" }).isHidden().catch(() => true)) await page.keyboard.press("Control+f");
  const champ = page.getByRole("searchbox", { name: "Rechercher" });
  await champ.fill(texte);
  await page.waitForTimeout(700);
  const compte = (await page.locator(".sous-barre .compte").textContent()) ?? "";
  if (compte === "Aucun résultat") return 0;
  return Number(/sur (\d+)/.exec(compte)?.[1] ?? 0);
}

/** Les fichiers de l'OCR gardés par le service worker. */
const gardes = (page) => page.evaluate(async () => {
  const r = [];
  for (const nom of await caches.keys()) for (const req of await (await caches.open(nom)).keys()) if (/\/ocr-[0-9a-f]+\//.test(req.url)) r.push(req.url.split("/").pop());
  return r.sort();
});

const navigateur = await chromium.launch();
try {
  /* Ordinateur */
  const contexte = await navigateur.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, locale: "fr-FR" });
  await contexte.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://localhost:${PORT}` });
  surveiller(contexte, "ordinateur");
  await contexte.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });
  const page = await contexte.newPage();
  page.on("dialog", (d) => d.accept());
  await ouvrirPdf(page, documentScanne(), "scan-essai.pdf");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
  const controle = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  await page.waitForTimeout(1500);
  verifier(fichiersOcr.length === 0, `les fichiers de l'OCR ne devraient pas être téléchargés avant son utilisation : ${fichiersOcr.join(", ")}`);
  verifier((await chercher(page, "foret")) === 0, "avant l'OCR, le scan n'a pas de texte");
  await page.keyboard.press("Escape");

  let dialogue = await fenetreOcr(page);
  verifier(await dialogue.getByRole("radio", { name: "Toutes les pages (3)" }).isChecked(), "« Toutes les pages » devrait être choisi");
  verifier((await dialogue.getByRole("combobox", { name: "Langue :" }).inputValue()) === "fra", "langue par défaut : français");
  await page.screenshot({ path: path.join(captures, "ocr.png") });
  const [resume, duree] = await lancer(page, dialogue);
  bilan.push(`Ordinateur, 3 pages (2 scans) : ${duree} ms — ${resume}`);
  verifier(resume.startsWith("Texte reconnu sur 2 pages (redressée : page 3 ; déjà du texte, laissée telle : page 2)."), `bilan inattendu : ${resume}`);
  verifier(resume.includes("Ctrl+Z"), "le bilan devrait rappeler Ctrl+Z");
  verifier(fichiersOcr.some((f) => f.includes("worker.min.js")) && fichiersOcr.some((f) => f.includes("fra.traineddata.gz")) && fichiersOcr.some((f) => /tesseract-core.*\.wasm\.js/.test(f)), `fichiers de l'OCR : ${fichiersOcr.join(", ")}`);
  await page.screenshot({ path: path.join(captures, "ocr-bilan.png") });

  // Texte copié et enregistré.
  await dialogue.getByRole("button", { name: "Copier le texte" }).click();
  // Le presse-papiers de Windows rend les fins de ligne en CR LF.
  const copie = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  verifier(copie.startsWith("— Page 1 —\nCompte rendu de la réunion du 12 février") && copie.includes("— Page 3 —\nConditions générales"), `texte copié : ${copie}`);
  const [txt] = await Promise.all([page.waitForEvent("download"), dialogue.getByRole("button", { name: "Enregistrer en .txt" }).click()]);
  verifier(txt.suggestedFilename() === "scan-essai (texte).txt", `nom du .txt : ${txt.suggestedFilename()}`);
  await txt.saveAs(path.join(sortie, "texte.txt"));
  verifier(fs.readFileSync(path.join(sortie, "texte.txt"), "utf8").includes("château de la forêt"), "le .txt devrait contenir le texte reconnu");

  // « Voir le résultat… » : texte reconnu page par page, recherche sans accents, puis le mot montré dans le document.
  await dialogue.getByRole("button", { name: "Voir le résultat…" }).click();
  const resultat = page.locator("dialog.ocr-resultat");
  await resultat.waitFor();
  verifier((await resultat.locator("h3").allTextContents()).join(",") === "Page 1,Page 3", "résultat : titres des pages");
  const champResultat = resultat.getByRole("searchbox", { name: "Chercher un mot dans le texte reconnu" });
  await champResultat.fill("DEPOT de garantie");
  verifier((await resultat.locator(".compte").textContent()) === "1 sur 1 · page 3", `résultat, compte : ${await resultat.locator(".compte").textContent()}`);
  verifier((await resultat.locator("mark.courante").textContent()) === "dépôt de garantie", "résultat : surlignage");
  await champResultat.fill("la");
  const nombreLa = await resultat.locator("mark").count();
  verifier(nombreLa > 2, `résultat, « la » : ${nombreLa}`);
  await champResultat.press("Shift+Enter");
  verifier((await resultat.locator(".compte").textContent()).startsWith(`${nombreLa} sur ${nombreLa}`), "Maj+Entrée : dernière occurrence");
  await champResultat.press("Enter");
  verifier((await resultat.locator(".compte").textContent()).startsWith(`1 sur ${nombreLa}`), "Entrée : première occurrence");
  await champResultat.fill("depot de garantie");
  await page.screenshot({ path: path.join(captures, "ocr-resultat.png") });
  await resultat.getByRole("button", { name: "Montrer dans le document" }).click();
  await resultat.waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  verifier((await page.getByRole("searchbox", { name: "Rechercher" }).inputValue()) === "dépôt de garantie", "recherche du document : mot");
  verifier((await page.locator(".sous-barre .compte").textContent()) === "1 sur 1", "recherche du document : occurrence");
  verifier((await page.locator(".page").nth(2).locator(".occurrence.courante").count()) === 1, "occurrence surlignée sur la page 3");
  await page.screenshot({ path: path.join(captures, "ocr-resultat-document.png") });
  await page.keyboard.press("Escape");

  // Recherche sans accents dans le texte reconnu, page redressée.
  verifier((await chercher(page, "chateau de la foret")) === 1, "recherche « chateau de la foret »");
  verifier((await chercher(page, "depot de garantie")) === 1, "recherche dans la page redressée");
  await page.screenshot({ path: path.join(captures, "ocr-recherche.png") });
  const rotation = await page.evaluate(() => document.querySelectorAll(".page")[2].getBoundingClientRect().height > document.querySelectorAll(".page")[2].getBoundingClientRect().width);
  verifier(rotation, "la page 3 doit rester en portrait (pivotée d'un demi-tour)");
  // Remplacer : le texte reconnu ne se remplace pas.
  await page.getByRole("textbox", { name: "Remplacer par" }).fill("manoir");
  await chercher(page, "château");
  await page.getByRole("button", { name: "Tout remplacer" }).click();
  await page.locator(".etat .message", { hasText: "ne peuvent pas être remplacées" }).waitFor();
  await page.keyboard.press("Escape");

  // Mode texte : le texte reconnu est encadré en pointillés gris et ne s'ouvre pas à la modification.
  await page.keyboard.press("t");
  const morceau = page.locator(".page").first().locator(".morceau.ocr").first();
  await morceau.waitFor();
  await morceau.click();
  await page.locator(".etat .message", { hasText: "Texte reconnu par l’OCR" }).waitFor();
  verifier((await page.locator(".editeur").count()) === 0, "aucun éditeur ne devrait s'ouvrir sur le texte reconnu");
  await page.screenshot({ path: path.join(captures, "ocr-mode-texte.png") });
  await page.keyboard.press("Escape");

  // Ctrl+Z annule toute l'opération, Ctrl+Y la rétablit.
  await page.locator(".visionneuse").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await page.locator(".etat .message", { hasText: "Annulé : reconnaissance de texte (OCR)." }).waitFor();
  verifier((await chercher(page, "chateau")) === 0, "après Ctrl+Z, plus de texte reconnu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+y");
  await page.locator(".etat .message", { hasText: "Rétabli : reconnaissance de texte (OCR)." }).waitFor();
  verifier((await chercher(page, "chateau")) === 1, "après Ctrl+Y, le texte reconnu revient");
  await page.keyboard.press("Escape");

  // OCR refaite sur la page 1 (Ctrl+Maj+O), « Ignorer… » décoché : pas de doublon.
  await page.keyboard.press("Control+Shift+O");
  dialogue = page.getByRole("dialog", { name: "Reconnaissance de texte (OCR)" });
  await dialogue.waitFor();
  await dialogue.getByRole("textbox", { name: "Pages à lire" }).fill("1");
  await dialogue.getByRole("checkbox", { name: /Ignorer les pages/ }).uncheck();
  const [refait] = await lancer(page, dialogue);
  verifier(refait.startsWith("Texte reconnu sur 1 page."), `OCR refaite : ${refait}`);
  await fermerFenetre(dialogue);
  verifier((await chercher(page, "chateau")) === 1, "OCR refaite : le texte ne doit pas être en double");
  await page.keyboard.press("Escape");

  // Arrêt en cours de lecture : les pages déjà lues gardent leur texte.
  dialogue = await fenetreOcr(page);
  await dialogue.getByRole("checkbox", { name: /Ignorer les pages/ }).uncheck();
  await dialogue.getByRole("button", { name: "Relancer" }).or(dialogue.getByRole("button", { name: "Lancer" })).click();
  // Arrêt pendant la page 2, la page 1 déjà relue.
  await dialogue.locator(".statut-ocr", { hasText: "Page 2 (2 sur 3)" }).waitFor({ timeout: 60000 });
  await dialogue.locator("footer").getByRole("button", { name: "Annuler" }).click();
  await page.waitForFunction(() => !document.querySelector("dialog .barre-progression:not([hidden])"), null, { timeout: 30000 });
  const arret = await dialogue.locator(".statut-ocr").textContent();
  bilan.push(`Arrêt en cours de lecture : ${arret}`);
  verifier(arret.startsWith("Reconnaissance interrompue : les pages déjà lues gardent leur texte. Texte reconnu sur 1 page."), `arrêt : ${arret}`);
  await fermerFenetre(dialogue);
  verifier((await chercher(page, "chateau")) === 1, "après l'arrêt, le texte de la page 1 reste (une seule fois)");
  await page.keyboard.press("Escape");

  // Le PDF enregistré, relu ici : le texte se lit, la page 3 est redressée.
  await page.keyboard.press("Control+s");
  const enregistrer = page.getByRole("dialog", { name: "Enregistrer" });
  await enregistrer.waitFor();
  await enregistrer.getByRole("radio", { name: /Ne pas compresser/ }).check();
  const [pdf] = await Promise.all([page.waitForEvent("download"), enregistrer.getByRole("button", { name: "Enregistrer" }).click()]);
  await pdf.saveAs(path.join(sortie, "scan-ocr.pdf"));
  const relu = mupdf.Document.openDocument(fs.readFileSync(path.join(sortie, "scan-ocr.pdf")), "application/pdf");
  const texte = (n) => relu.loadPage(n).toStructuredText("preserve-whitespace").asText();
  verifier(texte(0).includes("château de la forêt") && texte(0).includes("Hélène"), `page 1 relue : ${texte(0)}`);
  verifier(texte(1).includes("déjà lisible"), "page 2 relue");
  verifier(texte(2).includes("dépôt de garantie"), `page 3 relue : ${texte(2)}`);
  verifier(relu.asPDF().findPage(2).get("Rotate").asNumber() === 180, "page 3 : /Rotate 180 attendu");
  bilan.push("PDF enregistré : texte relu sur les trois pages, page 3 pivotée de 180°");

  // Hors connexion, après cette première utilisation : en français, puis en anglais (gardé par le service worker).
  if (controle) {
    for (let k = 0; k < 40 && (await gardes(page)).filter((f) => /traineddata|worker/.test(f)).length < 3; k++) await page.waitForTimeout(250);
    const g = await gardes(page);
    bilan.push(`Fichiers de l'OCR gardés pour le hors-ligne : ${g.join(", ")}`);
    verifier(g.includes("eng.traineddata.gz") && g.includes("fra.traineddata.gz") && g.includes("worker.min.js") && g.some((f) => f.startsWith("tesseract-core")), "fichiers de l'OCR non gardés");
    await contexte.setOffline(true);
    await ouvrirPdf(page, documentScanne(), "hors-ligne.pdf");
    dialogue = await fenetreOcr(page);
    const [horsLigne, t1] = await lancer(page, dialogue);
    bilan.push(`Hors connexion, français : ${t1} ms — ${horsLigne}`);
    verifier(horsLigne.startsWith("Texte reconnu sur 2 pages"), `hors connexion : ${horsLigne}`);
    await fermerFenetre(dialogue);
    await ouvrirPdf(page, documentAnglais(), "anglais.pdf");
    dialogue = await fenetreOcr(page);
    await dialogue.getByRole("combobox", { name: "Langue :" }).selectOption("eng");
    const [anglais, t2] = await lancer(page, dialogue);
    bilan.push(`Hors connexion, anglais : ${t2} ms — ${anglais}`);
    verifier(anglais.startsWith("Texte reconnu sur 1 page."), `hors connexion, anglais : ${anglais}`);
    await fermerFenetre(dialogue);
    verifier((await chercher(page, "library will open")) === 1, "recherche dans le texte anglais");
    await page.keyboard.press("Escape");
    await contexte.setOffline(false);
  } else bilan.push("Hors connexion : non essayé (service worker inactif)");
  await contexte.close();

  /* Téléphone */
  const avantTel = fichiersOcr.length;
  const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: "fr-FR" });
  surveiller(mobile, "téléphone");
  const tel = await mobile.newPage();
  tel.on("dialog", (d) => d.accept());
  await ouvrirPdf(tel, documentScanne(), "scan-telephone.pdf");
  await tel.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
  await tel.waitForTimeout(1000);
  verifier(fichiersOcr.length === avantTel, "téléphone : fichiers de l'OCR téléchargés avant son utilisation");
  // Hors connexion avant toute utilisation : l'OCR ne peut pas marcher, un message le dit.
  if (await tel.evaluate(() => !!navigator.serviceWorker?.controller)) {
    horsLigneAttendu = true;
    await mobile.setOffline(true);
    dialogue = await fenetreOcr(tel, true);
    const [jamais] = await lancer(tel, dialogue, true);
    bilan.push(`Téléphone hors connexion, avant toute utilisation : ${jamais}`);
    verifier(jamais.startsWith("Le lecteur de texte et les données du français n’ont pas pu être chargés."), `hors connexion avant toute utilisation : ${jamais}`);
    verifier(await tel.evaluate(() => !document.querySelector(".page .calque .morceau")), "le document ne doit pas changer");
    await dialogue.locator("footer").getByRole("button", { name: "Fermer", exact: true }).tap();
    await mobile.setOffline(false);
    horsLigneAttendu = false;
  }
  dialogue = await fenetreOcr(tel, true);
  const boite = await dialogue.boundingBox();
  verifier(boite.x >= 0 && boite.x + boite.width <= 390 && boite.height <= 844, `fenêtre hors de l'écran : ${JSON.stringify(boite)}`);
  const debordement = await tel.evaluate(() => document.querySelector("dialog .corps-dialogue").scrollWidth - document.querySelector("dialog .corps-dialogue").clientWidth);
  verifier(debordement <= 1, `la fenêtre déborde en largeur de ${debordement} px`);
  await tel.screenshot({ path: path.join(captures, "telephone-ocr.png") });
  const [resumeTel, dureeTel] = await lancer(tel, dialogue, true);
  bilan.push(`Téléphone, 3 pages : ${dureeTel} ms — ${resumeTel}`);
  verifier(resumeTel.startsWith("Texte reconnu sur 2 pages (redressée : page 3"), `téléphone : ${resumeTel}`);
  await tel.screenshot({ path: path.join(captures, "telephone-ocr-bilan.png") });
  await dialogue.getByRole("button", { name: "Voir le résultat…" }).tap();
  const resultatTel = tel.locator("dialog.ocr-resultat");
  await resultatTel.waitFor();
  await resultatTel.getByRole("searchbox").fill("riviere");
  const boiteResultat = await resultatTel.boundingBox();
  verifier(boiteResultat.x >= 0 && boiteResultat.x + boiteResultat.width <= 390 && boiteResultat.height <= 844, `résultat hors de l'écran : ${JSON.stringify(boiteResultat)}`);
  verifier((await resultatTel.locator(".compte").textContent()).startsWith("1 sur 1"), "téléphone, résultat : « riviere »");
  await tel.screenshot({ path: path.join(captures, "telephone-ocr-resultat.png") });
  await resultatTel.locator("footer").getByRole("button", { name: "Fermer", exact: true }).tap();
  await tel.getByRole("navigation", { name: "Actions du document" }).getByRole("button", { name: "Chercher" }).tap();
  await tel.getByRole("searchbox", { name: "Rechercher" }).fill("riviere");
  await tel.waitForTimeout(800);
  verifier((await tel.locator(".sous-barre .compte").textContent()) === "1 sur 1", "téléphone : recherche « riviere »");
  await tel.screenshot({ path: path.join(captures, "telephone-ocr-recherche.png") });
  if (await tel.evaluate(() => !!navigator.serviceWorker?.controller)) {
    for (let k = 0; k < 40 && (await gardes(tel)).length < 4; k++) await tel.waitForTimeout(250);
    await mobile.setOffline(true);
    await ouvrirPdf(tel, documentAnglais(), "anglais-telephone.pdf");
    dialogue = await fenetreOcr(tel, true);
    await dialogue.getByRole("combobox", { name: "Langue :" }).selectOption("eng");
    const [hl, t] = await lancer(tel, dialogue, true);
    bilan.push(`Téléphone hors connexion, anglais : ${t} ms — ${hl}`);
    verifier(hl.startsWith("Texte reconnu sur 1 page."), `téléphone hors connexion : ${hl}`);
    await mobile.setOffline(false);
  }
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
console.log("Captures dans", captures, "; fichiers dans", sortie);
