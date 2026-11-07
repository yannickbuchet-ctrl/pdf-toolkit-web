// Parcours dans un vrai navigateur (Chromium sans fenêtre, par Playwright) du site construit : ouvrir un PDF, modifier un
// texte, enregistrer, puis vérifier le fichier téléchargé ; comparer deux révisions d'une carte de circuit imprimé, sur
// ordinateur et sur téléphone. Captures d'écran dans captures/.
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

// Les deux révisions d'une carte de circuit imprimé (dossier « Exemples Gerber » à côté du projet), si elles existent.
const GERBER = path.resolve(racine, "..", "Exemples Gerber");
const cartes = fs.existsSync(path.join(GERBER, "carte-a4-revA.pdf"))
  ? ["carte-a4-revA.pdf", "carte-a4-revB.pdf"].map((n) => [...fs.readFileSync(path.join(GERBER, n))])
  : null;

/**
 * Comparaison des cartes A4 dans la fenêtre « Comparer deux PDF » déjà ouverte : réglage « Plan technique », côte à
 * côte puis superposées, navigation par F3, et (sur ordinateur) le rapport PDF. Captures prefixe-*.png. Sur téléphone,
 * renvoie le plus long gel du fil principal pendant le calcul.
 */
async function comparerCartes(page, dialogue, prefixe, telephone) {
  const verifier = (condition, message) => {
    if (!condition) throw new Error(`Cartes (${prefixe}) : ${message}`);
  };
  for (const [k, nom] of [[0, "carte-a4-revA.pdf"], [1, "carte-a4-revB.pdf"]]) {
    await page.evaluate(([o, nom, k]) => {
      const f = new File([new Uint8Array(o)], nom, { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(f);
      document.querySelectorAll(".version")[k].dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [cartes[k], nom, k]);
    await dialogue.getByText(`${nom} — 6 pages`).waitFor();
  }
  await dialogue.getByRole("combobox", { name: "Réglage de la comparaison" }).selectOption("plan");
  verifier((await dialogue.locator(".curseur output").textContent()) === "5 %", "la tolérance devrait passer à 5 %");
  const affichage = dialogue.getByRole("combobox", { name: "Affichage des deux versions" });
  verifier((await affichage.inputValue()) === (telephone ? "superposees" : "cote"), `affichage par défaut inattendu : ${await affichage.inputValue()}`);
  // Pendant le calcul (dans le Worker), l'interface doit rester fluide : plus long intervalle entre deux images.
  await page.evaluate(() => {
    window.__gel = 0;
    window.__fin = false;
    let t = performance.now();
    const tic = () => {
      const n = performance.now();
      window.__gel = Math.max(window.__gel, n - t);
      t = n;
      if (!window.__fin) requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
  });
  const debut = Date.now();
  await dialogue.getByRole("button", { name: "Comparer", exact: true }).click();
  await dialogue.getByText("24 différences", { exact: true }).waitFor({ timeout: 60000 });
  const duree = Date.now() - debut;
  const gel = await page.evaluate(() => ((window.__fin = true), window.__gel));
  const liste = await dialogue.locator(".differences").innerText();
  for (const couche of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "F.Silkscreen", "Perçages"]) verifier(liste.includes(`${couche} — Page`), `couche ${couche} absente de la liste`);
  verifier(liste.includes("B.Cu — Page 4 de A ↔ page 4 de B"), "titre de couple de pages B.Cu");
  verifier(/zone de \d+,\d × \d+,\d mm à x \d+,\d mm, y \d+,\d mm/.test(liste), "libellé en mm des changements visuels");
  await page.waitForTimeout(1500);
  if (!telephone) {
    verifier((await dialogue.locator(".paire:not(.superposee) .page-comparee").count()) === 12, "côte à côte : 12 pages attendues");
    await page.screenshot({ path: path.join(captures, `${prefixe}-cote-a-cote.png`) });
    await affichage.selectOption("superposees");
  }
  verifier((await dialogue.locator(".paire.superposee .page-comparee").count()) === 6, "superposées : 6 pages attendues");
  if (telephone) {
    // Les options et les fichiers se replient pour laisser la place aux pages ; « Options et fichiers » les rouvre.
    const plier = dialogue.getByRole("button", { name: "Options et fichiers" });
    verifier(!(await dialogue.locator(".versions").isVisible()) && (await plier.getAttribute("aria-expanded")) === "false", "les options devraient être repliées");
    await plier.tap();
    verifier(await dialogue.locator(".versions").isVisible(), "« Options et fichiers » devrait rouvrir les options");
    await page.screenshot({ path: path.join(captures, `${prefixe}-options.png`) });
    await plier.tap();
    const vue = await dialogue.locator(".cote-a-cote").boundingBox();
    verifier(vue.height > 300, `vue des pages trop petite : ${JSON.stringify(vue)}`);
  }
  const legende = await dialogue.locator(".legende").innerText();
  verifier(legende.includes("seulement dans A") && legende.includes("seulement dans B") && legende.includes("identique"), `légende : ${legende}`);
  // Aller par F3 à la différence de la couche In2.Cu (la séparation 3,3 V / 5 V déplacée), puis Maj+F3 et F3.
  const etat = dialogue.locator(".reglages .aide");
  for (let k = 0; k < 30 && !/zone de 32,5/.test(await etat.textContent()); k++) await page.keyboard.press("F3");
  verifier(/Différence \d+ sur 24 : Changement visuel — zone de 32,5/.test(await etat.textContent()), `F3 : ${await etat.textContent()}`);
  await page.keyboard.press("Shift+F3");
  const precedente = await etat.textContent();
  await page.keyboard.press("F3");
  verifier(/zone de 32,5/.test(await etat.textContent()) && precedente !== (await etat.textContent()), "Maj+F3 puis F3");
  await page.waitForTimeout(1500);
  // La superposition est rendue : du rouge (seulement dans A) et du vert (seulement dans B) sur la page In2.Cu.
  const mesure = await page.evaluate(() => {
    const section = [...document.querySelectorAll(".paire.superposee")].find((s) => s.getAttribute("aria-label").startsWith("In2.Cu"));
    const c = section.querySelector("canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let rouge = 0, vert = 0, noir = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) rouge++;
      else if (d[i + 1] > 150 && d[i] < 60 && d[i + 2] < 60) vert++;
      else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) noir++;
    }
    const actif = document.querySelector(".marque-diff.actif").getBoundingClientRect();
    const vue = document.querySelector(".cote-a-cote");
    return { largeur: c.width, rouge, vert, noir, actif: [actif.left, actif.top, actif.right, actif.bottom], ecran: [innerWidth, innerHeight],
      deborde: vue.scrollWidth - vue.clientWidth };
  });
  verifier(mesure.largeur > 100 && mesure.rouge > 50 && mesure.vert > 50 && mesure.noir > 1000, `superposition In2.Cu : ${JSON.stringify(mesure)}`);
  verifier(mesure.actif[3] > 0 && mesure.actif[1] < mesure.ecran[1], `la différence choisie n'est pas à l'écran : ${JSON.stringify(mesure)}`);
  verifier(mesure.deborde <= 1, `défilement horizontal de la vue : ${mesure.deborde} px`);
  await page.screenshot({ path: path.join(captures, `${prefixe}-superposees.png`) });
  if (!telephone) {
    // Changer d'affichage garde l'endroit regardé : le milieu de la couche B.Cu, et non la différence en cours (In2.Cu).
    const ou = () => page.evaluate(() => {
      const vue = document.querySelector(".cote-a-cote");
      const haut = vue.getBoundingClientRect().top;
      const s = [...vue.querySelectorAll("section.paire")].find((x) => x.getBoundingClientRect().bottom > haut + 1);
      const p = s.querySelector(".page-comparee").getBoundingClientRect();
      return { couche: s.getAttribute("aria-label").split(" — ")[0], haut: Math.round(((haut - p.top) / p.height) * 1000) / 1000 };
    });
    await page.evaluate(() => {
      const vue = document.querySelector(".cote-a-cote");
      const s = [...vue.querySelectorAll("section.paire")].find((x) => x.getAttribute("aria-label").startsWith("B.Cu"));
      const p = s.querySelector(".page-comparee").getBoundingClientRect();
      vue.scrollTop += p.top + 0.6 * p.height - vue.getBoundingClientRect().top;
    });
    const avant = await ou();
    for (const valeur of ["cote", "superposees"]) {
      await affichage.selectOption(valeur);
      const apres = await ou();
      verifier(apres.couche === avant.couche && Math.abs(apres.haut - avant.haut) < 0.01,
        `affichage ${valeur} : position perdue ${JSON.stringify(avant)} → ${JSON.stringify(apres)}`);
    }
    console.log(`Changement d'affichage : position gardée (${avant.couche}, ${Math.round(avant.haut * 100)} % de la page)`);
  }
  let rapport = "";
  if (!telephone) {
    const [telechargement] = await Promise.all([page.waitForEvent("download"), dialogue.getByRole("button", { name: "Rapport PDF" }).click()]);
    const fichier = path.join(racine, "dist", "parcours-rapport-cartes.pdf");
    await telechargement.saveAs(fichier);
    const doc = mupdf.Document.openDocument(fs.readFileSync(fichier), "application/pdf");
    const textes = [...Array(doc.countPages()).keys()].map((i) => doc.loadPage(i).toStructuredText().asText());
    verifier(textes[0].includes("réglage plan technique (zones fines)"), "options du rapport");
    const gros = textes.filter((t) => t.includes("Gros plans des différences")).length;
    verifier(gros === 8, `pages de gros plans : ${gros}`);
    verifier(!textes.join("").includes(" "), "espaces insécables dans le rapport");
    rapport = `, rapport de ${doc.countPages()} pages dont ${gros} de gros plans`;
  }
  console.log(`Cartes A4 (${prefixe}) : 24 différences en ${duree} ms, plus long gel de l'interface ${Math.round(gel)} ms, ` +
    `superposition In2.Cu ${mesure.rouge} px rouges, ${mesure.vert} px verts${rapport}`);
  return gel;
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

    if (await page.locator(".barre-mobile").isVisible()) throw new Error("La barre du bas ne doit pas apparaître sur ordinateur.");
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
    // Inverser : le document ouvert (qui contient « complète », ajouté) devient la nouvelle version.
    const avant = await dialogue.locator(".differences").innerText();
    if (!/Suppression[\s\S]*complète/.test(avant)) throw new Error(`Avant inversion, « complète » devrait être supprimé : ${avant}`);
    await dialogue.getByRole("button", { name: "⇄ Inverser" }).click();
    await dialogue.getByText("Versions inversées").waitFor();
    if (await dialogue.locator(".difference").count()) throw new Error("L'ancien résultat devrait être effacé après l'inversion.");
    await dialogue.getByRole("button", { name: "Comparer", exact: true }).click();
    await dialogue.locator(".difference").first().waitFor({ timeout: 30000 });
    const apres = await dialogue.locator(".differences").innerText();
    if (!/Ajout[\s\S]*complète/.test(apres) || !/250[\s\S]*900/.test(apres)) throw new Error(`Après inversion : ${apres}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(captures, "comparaison-inversee.png") });
    console.log("Inversion des versions : « complète » devient un ajout, « 250 » → « 900 »");
    if (cartes) {
      const gel = await comparerCartes(page, dialogue, "comparaison-cartes", false);
      if (gel > 500) throw new Error(`L'interface a gelé ${Math.round(gel)} ms pendant la comparaison des cartes.`);
    } else console.log("Exemples Gerber absents : comparaison des cartes non essayée.");
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

    // Téléphone (390 px, tactile) : barre du haut réduite, barre du bas, menus vers le haut, zoom à deux doigts.
    const mobile = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" });
    const tel = await mobile.newPage();
    tel.on("pageerror", (e) => erreurs.push(`mobile : ${e.message}`));
    const verifier = (condition, message) => {
      if (!condition) throw new Error(`Téléphone : ${message}`);
    };
    await tel.goto(`http://localhost:${PORT}/`);
    await tel.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
    verifier(!(await tel.locator(".barre-mobile").isVisible()), "la barre du bas ne doit pas apparaître sans document");
    await tel.screenshot({ path: path.join(captures, "telephone-accueil.png") });
    await tel.evaluate((o) => {
      const f = new File([new Uint8Array(o)], "devis-exemple.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(f);
      for (const type of ["dragenter", "dragover", "drop"]) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, octets);
    await tel.waitForFunction(() => document.querySelector(".page canvas.rendu")?.width > 100);
    await tel.waitForTimeout(500);
    const mesures = await tel.evaluate(() => {
      const barre = document.querySelector(".barre");
      const page = document.querySelector(".page").getBoundingClientRect();
      const visibles = [...barre.querySelectorAll("button")].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("aria-label") ?? b.textContent.trim());
      return { deborde: barre.scrollWidth - barre.clientWidth, page: [page.left, page.right], largeur: innerWidth, visibles, horizontal: document.querySelector(".visionneuse").scrollWidth - document.querySelector(".visionneuse").clientWidth };
    });
    verifier(mesures.deborde <= 0, `la barre du haut déborde de ${mesures.deborde} px`);
    verifier(mesures.page[0] >= 0 && mesures.page[1] <= mesures.largeur, `la page ne tient pas en largeur à l'ouverture : ${mesures.page}`);
    verifier(mesures.horizontal <= 1, `défilement horizontal du document : ${mesures.horizontal} px`);
    for (const nom of ["Ouvrir", "Enregistrer", "Annuler", "Rétablir", "Outils"]) verifier(mesures.visibles.includes(nom), `bouton « ${nom} » absent de la barre du haut : ${mesures.visibles}`);
    const bas = tel.getByRole("navigation", { name: "Actions du document" });
    for (const nom of ["Pages", "Modifier", "Annoter", "Chercher", "Plus"]) {
      const b = bas.getByRole("button", { name: nom });
      const r = await b.boundingBox();
      verifier(r && r.height >= 48 && r.y + r.height <= 844, `bouton du bas « ${nom} » trop petit ou hors de l'écran`);
    }
    await tel.screenshot({ path: path.join(captures, "telephone.png") });

    // Annoter : le menu s'ouvre au-dessus de la barre et choisit un outil.
    await bas.getByRole("button", { name: "Annoter" }).tap();
    const menuAnnoter = tel.getByRole("menu", { name: "Annoter" });
    await menuAnnoter.waitFor();
    const rm = await menuAnnoter.boundingBox(), rb = await bas.boundingBox();
    verifier(rm.y + rm.height <= rb.y + 1 && rm.y >= 0 && rm.x >= 0 && rm.x + rm.width <= 390, `menu Annoter mal placé : ${JSON.stringify(rm)}`);
    await tel.screenshot({ path: path.join(captures, "telephone-annoter.png") });
    await menuAnnoter.getByRole("menuitemcheckbox", { name: "Surligner" }).tap();
    verifier(await tel.getByRole("toolbar", { name: "Options de l'outil" }).isVisible(), "les options du surligneur n'apparaissent pas");
    verifier(await bas.getByRole("button", { name: "Annoter" }).evaluate((b) => b.classList.contains("actif")), "le bouton Annoter devrait signaler l'outil actif");

    // Modifier le texte : toucher une ligne ouvre l'éditeur.
    await bas.getByRole("button", { name: "Modifier" }).tap();
    verifier((await bas.getByRole("button", { name: "Modifier" }).getAttribute("aria-pressed")) === "true", "Modifier devrait être enfoncé");
    await tel.locator('.morceau[title^="Peinture"]').first().tap();
    await tel.locator(".editeur").first().waitFor();
    const bulle = await tel.locator(".bulle-police").boundingBox();
    verifier(bulle && bulle.x >= 0 && bulle.x + bulle.width <= 390, `la bulle de police sort de l'écran : ${JSON.stringify(bulle)}`);
    await tel.screenshot({ path: path.join(captures, "telephone-edition.png") });
    await tel.keyboard.press("Escape");
    await bas.getByRole("button", { name: "Modifier" }).tap();

    // Chercher.
    await bas.getByRole("button", { name: "Chercher" }).tap();
    await tel.getByRole("searchbox", { name: "Rechercher" }).fill("solde");
    await tel.getByText("1 sur 1").waitFor({ timeout: 10000 });
    await tel.screenshot({ path: path.join(captures, "telephone-recherche.png") });
    await bas.getByRole("button", { name: "Chercher" }).tap();
    verifier(!(await tel.getByRole("search").isVisible()), "Chercher devrait refermer la recherche");

    // Pages : le panneau des miniatures s'ouvre et se referme.
    await bas.getByRole("button", { name: "Pages" }).tap();
    await tel.waitForTimeout(300);
    verifier((await tel.locator(".miniatures").boundingBox()).width > 100, "le panneau des pages ne s'ouvre pas");
    await tel.screenshot({ path: path.join(captures, "telephone-pages.png") });
    await bas.getByRole("button", { name: "Pages" }).tap();

    // Plus, puis zoom à deux doigts (événements tactiles réels).
    await bas.getByRole("button", { name: "Plus" }).tap();
    const menuPlus = tel.getByRole("menu", { name: "Plus" });
    await menuPlus.waitFor();
    await tel.screenshot({ path: path.join(captures, "telephone-plus.png") });
    await menuPlus.getByRole("menuitem", { name: "Ajuster à la largeur" }).tap();
    const zoomAvant = await tel.locator(".zoom-valeur").textContent();
    const cdp = await mobile.newCDPSession(tel);
    const doigts = (ecart) => [{ x: 195 - ecart, y: 420 }, { x: 195 + ecart, y: 420 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: doigts(40) });
    for (const e of [60, 80, 100, 120]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: doigts(e) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await tel.waitForTimeout(800);
    const zoomApres = await tel.locator(".zoom-valeur").textContent();
    verifier(parseInt(zoomApres) > parseInt(zoomAvant) * 2.5, `le pincement devrait tripler le zoom : ${zoomAvant} → ${zoomApres}`);
    await tel.screenshot({ path: path.join(captures, "telephone-zoom.png") });
    if (cartes) {
      await tel.getByRole("button", { name: "Outils" }).tap();
      await tel.getByRole("menuitem", { name: "Comparer deux PDF…" }).tap();
      const dlg = tel.getByRole("dialog", { name: "Comparer deux PDF" });
      await dlg.waitFor();
      const gel = await comparerCartes(tel, dlg, "telephone-comparaison", true);
      verifier(gel < 500, `l'interface a gelé ${Math.round(gel)} ms pendant la comparaison`);
      await tel.keyboard.press("Escape");
    }
    console.log(`Téléphone : barres, menus, édition, recherche, pages et pincement vérifiés (zoom ${zoomAvant} → ${zoomApres})`);
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
