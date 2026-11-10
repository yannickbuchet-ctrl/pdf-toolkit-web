// Zoom de la comparaison (Ctrl+molette) dans Chromium sans fenêtre : le point visé reste sous le pointeur, les pages
// A et B (côte à côte) gardent le même zoom et le même décalage, le glissé déplace les deux ensemble, et les pages
// sont recalculées plus nettes. Aussi en affichage superposé. Captures dans captures/.
//
// Lancer après « npm run build » : node scripts/essai-zoom-comparaison.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";

const racine = path.resolve(import.meta.dirname, "..");
const exemples = path.resolve(racine, "..", "Exemples Gerber");
const PORT = 4186;
const verifier = (c, m) => {
  if (!c) throw new Error(m);
};
const serveur = spawn(process.execPath, [path.join(racine, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: racine, stdio: "pipe" });
await new Promise((ok, ko) => {
  serveur.stdout.on("data", (d) => String(d).includes(String(PORT)) && ok());
  setTimeout(() => ko(new Error("serveur muet")), 20000);
});
const navigateur = await chromium.launch();
const erreurs = [];
const bilan = [];
try {
  const page = await navigateur.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => erreurs.push(e.message));
  await page.addInitScript(() => delete window.showOpenFilePicker);
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByText("Prêt. Ouvrez ou déposez un PDF.").waitFor({ timeout: 30000 });
  await page.locator(".fonction", { hasText: "Comparer deux PDF" }).click();
  const choisir = page.getByRole("button", { name: "Choisir un PDF…" });
  for (const [i, f] of [[0, "carte-a4-revA.pdf"], [1, "carte-a4-revB.pdf"]]) {
    const [ch] = await Promise.all([page.waitForEvent("filechooser"), choisir.nth(i).click()]);
    await ch.setFiles(path.join(exemples, f));
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: "Comparer", exact: true }).click();
  await page.locator(".fenetre-page canvas").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);

  const etatPages = () => page.evaluate(() => [...document.querySelectorAll(".fenetre-page")].slice(0, 2).map((f) => {
    const p = f.querySelector(".page-comparee");
    const bf = f.getBoundingClientRect();
    const bp = p.getBoundingClientRect();
    return { fl: bf.left, ft: bf.top, fw: bf.width, pl: bp.left, pt: bp.top, pw: bp.width, ph: bp.height, transform: p.style.transform };
  }));
  // Point visé : au tiers de la page A.
  const avant = await etatPages();
  const x = avant[0].fl + avant[0].fw * 0.3;
  const y = avant[0].pt + avant[0].ph * 0.4;
  const fx = (x - avant[0].pl) / avant[0].pw;
  const fy = (y - avant[0].pt) / avant[0].ph;
  await page.mouse.move(x, y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  const apres = await etatPages();
  const zoom = apres[0].pw / avant[0].pw;
  const fx2 = (x - apres[0].pl) / apres[0].pw;
  const fy2 = (y - apres[0].pt) / apres[0].ph;
  verifier(zoom > 2, `zoom : ${zoom}`);
  verifier(Math.abs(fx2 - fx) < 0.01 && Math.abs(fy2 - fy) < 0.01, `le point visé a bougé : (${fx}, ${fy}) → (${fx2}, ${fy2})`);
  verifier(apres[0].transform === apres[1].transform && Math.abs(apres[0].pw - apres[1].pw) < 1, `A et B désynchronisées : ${JSON.stringify(apres)}`);
  verifier(Math.abs(apres[0].pt - apres[1].pt) < 1, "A et B ne sont plus à la même hauteur");
  verifier((await page.locator(".valeur-zoom").textContent()).includes("%"), "valeur du zoom");
  bilan.push(`Ctrl+molette : zoom ×${zoom.toFixed(2)}, point visé immobile, A et B synchronisées (${apres[0].transform})`);
  // Netteté : le canevas est recalculé à la nouvelle largeur.
  const resolution = await page.evaluate(() => {
    const c = document.querySelector(".fenetre-page canvas");
    return { pixels: c.width, affiche: c.getBoundingClientRect().width };
  });
  verifier(resolution.pixels >= resolution.affiche * 0.95, `page floue : ${JSON.stringify(resolution)}`);
  await page.screenshot({ path: path.join(racine, "captures", "comparaison-zoom.png") });

  // Glisser : A et B se déplacent ensemble.
  const fen = await page.locator(".fenetre-page").first().boundingBox();
  const yv = Math.max(fen.y, 0) + 400;
  await page.mouse.move(fen.x + fen.width / 2, yv);
  await page.mouse.down();
  await page.mouse.move(fen.x + fen.width / 2 - 150, yv - 50, { steps: 6 });
  await page.mouse.up();
  const glisse = await etatPages();
  verifier(glisse[0].transform !== apres[0].transform && glisse[0].transform === glisse[1].transform, `glissé : ${JSON.stringify(glisse)}`);
  bilan.push(`Glissé : ${glisse[0].transform} sur les deux pages`);

  // Superposées : même zoom, une page par ligne.
  await page.locator("select").filter({ hasText: "Superposées" }).selectOption("superposees");
  await page.waitForTimeout(1500);
  const sup = await etatPages();
  verifier(sup[0].pw > sup[0].fw * 1.5, `superposées : zoom perdu ${JSON.stringify(sup[0])}`);
  bilan.push(`Superposées : zoom conservé (page ${Math.round(sup[0].pw)} px dans une fenêtre de ${Math.round(sup[0].fw)} px)`);
  await page.screenshot({ path: path.join(racine, "captures", "comparaison-zoom-superposees.png") });
  // Retour à 100 %
  await page.getByRole("button", { name: "Revenir à la page entière" }).click();
  await page.waitForTimeout(500);
  const cent = await etatPages();
  verifier(Math.abs(cent[0].pw - cent[0].fw) < 1, "100 % : la page ne remplit pas sa fenêtre");
} catch (e) {
  erreurs.push(`ÉCHEC : ${e.message}`);
} finally {
  await navigateur.close();
  serveur.kill();
}
console.log(bilan.join("\n"));
if (erreurs.length) {
  console.log("\nErreurs :\n" + erreurs.join("\n"));
  process.exit(1);
}
console.log("\nTout est conforme.");
