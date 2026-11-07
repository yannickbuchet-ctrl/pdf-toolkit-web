/**
 * Comparaison de couches de circuit imprimé (Gerber imprimées en PDF), avec les exemples du dossier « Exemples Gerber »
 * à côté du projet (verifier_comparaison.py sur PC) : chaque modification attendue doit être trouvée sur chacune de ses
 * pages, et chaque différence trouvée doit correspondre à une modification (sinon c'est une fausse alerte). Les tests
 * sont sautés si le dossier n'existe pas.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import { ouvrir, texteDePage } from "./fabrique";
import { comparer, description, superposition, titrePaire, type Options, type Rect, type Resultat } from "../src/moteur/comparaison";
import { rapportComparaison } from "../src/moteur/rapport";

const DOSSIER = path.resolve(import.meta.dirname, "../../Exemples Gerber");
const present = fs.existsSync(path.join(DOSSIER, "carte-a4-revA.pdf"));
const MM = 72 / 25.4;
const DECALAGE = [10, 18]; // coin haut gauche de la carte sur la page A4, en mm (generer_carte_a4.py)
const lire = (nom: string) => ouvrir(new Uint8Array(fs.readFileSync(path.join(DOSSIER, nom))));
const base: Options = { mode: "both", ignorerCasse: false, ignorerPonctuation: false, tolerance: 0.1 };

/** Les modifications attendues (modifications-carte-a4.txt) : pages (de 1 à 6), zone en mm de la carte, description. */
function attendues(): { pages: number[]; zone: Rect; texte: string }[] {
  const lignes = fs.readFileSync(path.join(DOSSIER, "modifications-carte-a4.txt"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("- "));
  return lignes.map((l) => {
    const m = /^- (.*) ; pages ([\d, ]+) ; zone x (-?[\d.]+)–(-?[\d.]+) mm, y (-?[\d.]+)–(-?[\d.]+) mm$/.exec(l);
    if (!m) throw new Error(`Ligne illisible : ${l}`);
    return { texte: m[1], pages: m[2].split(",").map(Number), zone: [Number(m[3]), Number(m[5]), Number(m[4]), Number(m[6])] as Rect };
  });
}

const enMm = (r: Rect): Rect => [r[0] / MM - DECALAGE[0], r[1] / MM - DECALAGE[1], r[2] / MM - DECALAGE[0], r[3] / MM - DECALAGE[1]];
const chevauche = (a: Rect, b: Rect, marge = 1) => a[0] - marge <= b[2] && b[0] - marge <= a[2] && a[1] - marge <= b[3] && b[1] - marge <= a[3];

/** Confronte le résultat aux modifications attendues. */
function bilan(r: Resultat) {
  const trouvees = r.differences.flatMap((d) => (d.marquesB.length ? d.marquesB : d.marquesA).map(([p, z]) => ({ page: p + 1, zone: enMm(z), texte: description(d) })));
  const liste = attendues();
  const manquees: string[] = [];
  for (const { pages, zone, texte } of liste) {
    for (const page of pages) if (!trouvees.some((t) => t.page === page && chevauche(t.zone, zone))) manquees.push(`${texte} (page ${page})`);
  }
  const fausses = trouvees.filter((t) => !liste.some(({ pages, zone }) => pages.includes(t.page) && chevauche(t.zone, zone)));
  return { manquees, fausses };
}

describe.skipIf(!present)("comparaison de couches de circuit imprimé (Exemples Gerber)", () => {
  const a = present ? lire("carte-a4-revA.pdf") : null!;
  const b = present ? lire("carte-a4-revB.pdf") : null!;

  it("réglage plan technique, tolérance 5 % : tout est trouvé, sans fausse alerte", () => {
    const debut = performance.now();
    const r = comparer(a, b, { ...base, tolerance: 0.05, reglage: "plan" });
    const { manquees, fausses } = bilan(r);
    console.log(`Plan 5 % : ${r.differences.length} différences, ${manquees.length} manquée(s), ${fausses.length} fausse(s) alerte(s), ${Math.round(performance.now() - debut)} ms`);
    expect(manquees).toEqual([]);
    expect(fausses).toEqual([]);
    expect(r.differences.length).toBe(24);
    expect(r.noms[0]).toEqual(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu", "F.Silkscreen", "Perçages"]);
    expect(r.noms[1]).toEqual(r.noms[0]);
    expect(titrePaire(r.paires[3], r.noms)).toBe("B.Cu — Page 4 de A ↔ page 4 de B");
    // Libellé des changements visuels, en mm avec une virgule.
    const visuel = r.differences.find((d) => d.type === "visuel")!;
    expect(description(visuel)).toMatch(/^zone de \d+,\d × \d+,\d mm à x \d+,\d mm, y \d+,\d mm \(image, dessin, couleur ou mise en page\)$/);

    // Rapport : gros plans à la fin, texte cherchable avec de vraies espaces.
    const rapport = ouvrir(rapportComparaison(r, a, b, "carte-a4-revA.pdf", "carte-a4-revB.pdf", "PDF Toolkit Web", new Date(2026, 10, 7, 10, 0)));
    const textes = [...Array(rapport.countPages()).keys()].map((i) => texteDePage(rapport, i));
    expect(textes[0]).toContain("réglage plan technique (zones fines)");
    expect(textes[0]).toContain("B.Cu — Page 4 de A <-> page 4 de B");
    const gros = textes.map((t, i) => [t, i] as const).filter(([t]) => t.includes("Gros plans des différences"));
    // 24 différences, toutes localisées (aucune « page entière »), à 3 par page.
    expect(gros.length).toBe(8);
    const tout = gros.map(([t]) => t).join("\n");
    for (let n = 1; n <= 24; n++) expect(tout).toContain(`${n}. `);
    expect(tout).toMatch(/Zone : x \d+,\d à \d+,\d mm, y \d+,\d à \d+,\d mm/);
    expect(tout).toContain("· Perçages :");
    expect(textes.join("").includes(" ")).toBe(false);
    // Recherche dans le rapport, comme dans un lecteur de PDF.
    const derniere = rapport.loadPage(gros[gros.length - 1][1]);
    expect(derniere.search("Gros plans des différences", "").length).toBe(1);
    // Chaque gros plan : deux vues vectorielles (A et B) et une superposition en image.
    const ressources = (rapport as mupdf.PDFDocument).findPage(gros[0][1]).get("Resources").get("XObject");
    let formes = 0, images = 0;
    ressources.forEach((v: mupdf.PDFObject) => {
      const sous = v.resolve().get("Subtype").asName();
      if (sous === "Form") formes++;
      if (sous === "Image") images++;
    });
    expect(images).toBe(3);
    expect(formes).toBeGreaterThanOrEqual(2);
  });

  it("réglage document, tolérance 10 % : seul le perçage agrandi de 0,05 mm échappe", () => {
    const r = comparer(a, b, { ...base, tolerance: 0.1, reglage: "document" });
    const { manquees, fausses } = bilan(r);
    console.log(`Document 10 % : ${r.differences.length} différences, manquées : ${manquees.join(" ; ") || "aucune"}, ${fausses.length} fausse(s) alerte(s)`);
    expect(r.differences.length).toBe(24);
    expect(manquees).toEqual(["via V151 agrandi de 0,6 à 0,7 mm (toutes les couches) (page 6)"]);
    expect(fausses).toEqual([]);
  });

  it("petite carte, réglage plan : le via V3 et la piste de masse voisine de B.Cu sont deux zones", () => {
    const v1 = lire("carte-capteur-v1.pdf"), v2 = lire("carte-capteur-v2.pdf");
    const r = comparer(v1, v2, { ...base, tolerance: 0.05, reglage: "plan" });
    expect(r.noms[0]).toEqual(["F.Cu", "B.Cu", "F.Silkscreen", "Perçages"]);
    const page = r.noms[1].indexOf("B.Cu");
    const zones = r.differences.filter((d) => d.type === "visuel" && d.pageB === page).map((d) => d.marquesB[0][1]);
    // Carte placée à (60, 80) pt ; V3 en (44, 17) mm ; la masse descend en x = 46 mm (46,2 mm en v2) entre y = 17,6 et 30 mm.
    const point = (x: number, y: number): [number, number] => [60 + x * MM, 80 + y * MM];
    const contient = (z: Rect, [x, y]: [number, number]) => z[0] <= x && x <= z[2] && z[1] <= y && y <= z[3];
    const via = zones.filter((z) => contient(z, point(44, 17)));
    const masse = zones.filter((z) => contient(z, point(46.1, 24)));
    expect(via.length).toBe(1);
    expect(masse.length).toBe(1);
    expect(via[0]).not.toBe(masse[0]);
    // Avec le réglage document, les deux sont réunis dans une seule zone.
    const doc = comparer(v1, v2, { ...base, tolerance: 0.1 });
    const zonesDoc = doc.differences.filter((d) => d.type === "visuel" && d.pageB === page).map((d) => d.marquesB[0][1]);
    expect(zonesDoc.some((z) => contient(z, point(44, 17)) && contient(z, point(46.1, 24)))).toBe(true);
  });

  it("superposition : rouge pour A seule, vert pour B seule, noir pour le commun", () => {
    // Page In2.Cu : la séparation blanche entre 3,3 V et 5 V (1 mm de large), en x = 95 mm dans A, passe à 96 mm dans B.
    // En x = 95 mm, A est blanche et B noire : vert ; en x = 96 mm, l'inverse : rouge.
    const pa = a.loadPage(2), pb = b.loadPage(2);
    const echelle = 2;
    const { largeur, hauteur, rvb } = superposition(pa, pb, echelle);
    expect(Math.abs(largeur - (pa.getBounds()[2] - pa.getBounds()[0]) * echelle)).toBeLessThanOrEqual(1);
    expect(rvb.length).toBe(largeur * hauteur * 3);
    const compte = (z: Rect) => {
      let rouge = 0, vert = 0, noir = 0, autre = 0;
      for (let y = Math.floor(z[1] * echelle); y < Math.ceil(z[3] * echelle); y++) {
        for (let x = Math.floor(z[0] * echelle); x < Math.ceil(z[2] * echelle); x++) {
          const i = (y * largeur + x) * 3, [R, V, B] = [rvb[i], rvb[i + 1], rvb[i + 2]];
          if (R > 200 && V < 60 && B < 60) rouge++;
          else if (V > 200 && R < 60 && B < 60) vert++;
          else if (R < 60 && V < 60 && B < 60) noir++;
          else autre++;
        }
      }
      return { rouge, vert, noir, autre };
    };
    const enPoints = (z: Rect): Rect => [(z[0] + DECALAGE[0]) * MM, (z[1] + DECALAGE[1]) * MM, (z[2] + DECALAGE[0]) * MM, (z[3] + DECALAGE[1]) * MM];
    const vert = compte(enPoints([94.8, 40, 95.2, 60]));
    expect(vert.vert).toBeGreaterThan(0);
    expect(vert.rouge).toBe(0);
    expect(vert.vert).toBeGreaterThan(0.9 * (vert.vert + vert.noir + vert.autre)); // bords adoucis
    const rouge = compte(enPoints([95.8, 40, 96.2, 60]));
    expect(rouge.rouge).toBeGreaterThan(0);
    expect(rouge.vert).toBe(0);
    expect(rouge.rouge).toBeGreaterThan(0.9 * (rouge.rouge + rouge.noir + rouge.autre));
    // Le cuivre coulé, identique de part et d'autre, est noir.
    const commun = compte(enPoints([60, 40, 80, 41]));
    expect(commun.noir).toBeGreaterThan(0);
    expect(commun.rouge + commun.vert).toBe(0);
    // Une partie seulement de la page (gros plan) : mêmes couleurs.
    const zoom = 8, cadre = enPoints([94, 49, 97, 51]);
    const gros = superposition(pa, pb, zoom, cadre);
    const pixel = (xmm: number) => {
      const x = Math.round(((xmm + DECALAGE[0]) * MM - cadre[0]) * zoom), y = Math.round(gros.hauteur / 2);
      return [...gros.rvb.subarray((y * gros.largeur + x) * 3, (y * gros.largeur + x) * 3 + 3)];
    };
    expect(pixel(95)).toEqual([0, 255, 0]);
    expect(pixel(96)).toEqual([255, 0, 0]);
    expect(pixel(94.2)).toEqual([0, 0, 0]);
    // Une page comparée à elle-même : aucune couleur.
    const meme = superposition(pa, pa, 0.5);
    let couleur = 0;
    for (let i = 0; i < meme.rvb.length; i += 3) if (meme.rvb[i] !== meme.rvb[i + 1]) couleur++;
    expect(couleur).toBe(0);
  });
});
