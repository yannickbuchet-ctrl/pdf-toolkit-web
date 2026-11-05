import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { creerPdf, octets, ouvrir as relire, policeSimple, texteDePage } from "./fabrique";
import { apparierPages, comparer, description, resume, type Options } from "../src/moteur/comparaison";
import { operations } from "../src/moteur/difflib";
import { rapportComparaison } from "../src/moteur/rapport";
import { modifierTexte, segmentsDePage } from "../src/moteur/texte";

const OPTIONS: Options = { mode: "both", ignorerCasse: false, ignorerPonctuation: false, tolerance: 0.1 };
const helv = (d: mupdf.PDFDocument) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) });

/** Un document dont chaque page porte quelques lignes de texte. */
function document(pages: string[][], rectangles: Record<number, string> = {}): mupdf.PDFDocument {
  const doc = creerPdf(pages.map((lignes) => ({ lignes: lignes.map((t, i) => ({ police: "F1", x: 72, y: 100 + 20 * i, taille: 12, texte: t })) })), helv);
  for (const [p, contenu] of Object.entries(rectangles)) {
    const page = doc.loadPage(Number(p));
    const objet = page.getObject();
    const ajout = doc.addStream(contenu, {});
    const contenus = doc.newArray();
    contenus.push(objet.get("Contents"));
    contenus.push(ajout);
    objet.put("Contents", contenus);
  }
  return relire(octets(doc)) as mupdf.PDFDocument;
}

const LIGNES = (k: number) => [`Page ${k} : premier paragraphe du rapport annuel.`, `Deuxième ligne de la page ${k}, avec des chiffres.`, `Conclusion de la page ${k}.`];

describe("difflib", () => {
  it("donne les mêmes opérations que Python", () => {
    // difflib.SequenceMatcher(None, "abxcd", "abcd", autojunk=False).get_opcodes()
    expect(operations([..."abxcd"], [..."abcd"])).toEqual([["equal", 0, 2, 0, 2], ["delete", 2, 3, 2, 2], ["equal", 3, 5, 2, 4]]);
    // difflib.SequenceMatcher(None, "qabxcd", "abycdf").get_opcodes()
    expect(operations([..."qabxcd"], [..."abycdf"])).toEqual([
      ["delete", 0, 1, 0, 0], ["equal", 1, 3, 0, 2], ["replace", 3, 4, 2, 3], ["equal", 4, 6, 3, 5], ["insert", 6, 6, 5, 6],
    ]);
  });

  it("apparie les pages sans décaler la suite", () => {
    const sim = (i: number, j: number): [number, number] => [[0, 1, 2, 3][i] === [0, 9, 1, 2, 3][j] ? 1 : 0, 0.5];
    expect(apparierPages(4, 5, sim)).toEqual([[0, 0], [null, 1], [1, 2], [2, 3], [3, 4]]);
  });
});

describe("comparaison de deux PDF", () => {
  it("documents identiques : aucune différence", () => {
    const a = document([LIGNES(1), LIGNES(2)]);
    const b = document([LIGNES(1), LIGNES(2)]);
    const r = comparer(a, b, OPTIONS);
    expect(r.differences).toEqual([]);
    expect(r.paires).toEqual([[0, 0], [1, 1]]);
  });

  it("mot modifié, mot ajouté, page insérée et dessin changé", () => {
    const a = document([LIGNES(1), LIGNES(2), LIGNES(3)], { 2: "q 1 0 0 rg 300 300 100 50 re f Q" });
    const lignes2 = LIGNES(2);
    lignes2[1] = "Deuxième ligne de la page 2, avec beaucoup des nombres.";
    const b = document([LIGNES(1), ["Une page entièrement nouvelle", "insérée au milieu du document."], lignes2, LIGNES(3)],
      { 3: "q 0 0 1 rg 300 300 100 50 re f Q" });
    const r = comparer(a, b, OPTIONS);
    expect(r.paires).toEqual([[0, 0], [null, 1], [1, 2], [2, 3]]);
    const types = r.differences.map((d) => d.type);
    expect(types).toContain("page_ajoutee");
    expect(types).toContain("modification");
    expect(types).toContain("visuel");
    const modif = r.differences.find((d) => d.type === "modification")!;
    expect(description(modif)).toBe("« chiffres. » → « nombres. »");
    expect(r.differences.find((d) => d.type === "ajout")!.nouveau).toBe("beaucoup");
    expect(resume(r.differences)).toMatch(/1 ajout.*1 modification.*1 changement visuel.*1 page ajoutée/);
    // Le dessin passé du rouge au bleu est repéré à sa place.
    const v = r.differences.find((d) => d.type === "visuel")!;
    expect(v.pageA).toBe(2);
    expect(v.pageB).toBe(3);
    const [x0, y0, x1, y1] = v.marquesB[0][1];
    expect(x0).toBeLessThanOrEqual(300);
    expect(x1).toBeGreaterThanOrEqual(400);
    expect(y0).toBeLessThanOrEqual(842 - 350);
    expect(y1).toBeGreaterThanOrEqual(842 - 300);

    // Rapport PDF : synthèse, liste, puis pages annotées.
    const rapport = relire(rapportComparaison(r, a, b, "version-a.pdf", "version-b.pdf", "PDF Toolkit Web", new Date(2026, 10, 5, 9, 7)));
    const premiere = texteDePage(rapport, 0);
    expect(premiere).toContain("Comparaison de deux PDF");
    expect(premiere).toContain("Rapport établi le 5 novembre 2026 à 9 h 07");
    expect(premiere).toContain("« chiffres. » -> « nombres. »");
    expect(rapport.countPages()).toBeGreaterThanOrEqual(3);
    const feuillets = [...Array(rapport.countPages()).keys()].slice(1).map((i) => texteDePage(rapport, i));
    expect(feuillets.some((t) => t.includes("Deuxième ligne de la page 2"))).toBe(true);
    const annots = [...Array(rapport.countPages()).keys()].flatMap((i) => (rapport as mupdf.PDFDocument).loadPage(i).getAnnotations());
    expect(annots.length).toBeGreaterThanOrEqual(5);
  });

  it("un mot réécrit par un éditeur de PDF n'est compté qu'une fois", () => {
    const a = document([LIGNES(1)]);
    const b = document([LIGNES(1)]) as mupdf.PDFDocument;
    const cible = segmentsDePage(b.loadPage(0)).find((s) => s.texte.startsWith("Conclusion"))!;
    modifierTexte(b, 0, [{ cible, texte: "Conclusion de la page 9." }]);
    const r = comparer(a, relire(octets(b)), OPTIONS);
    const texte = r.differences.filter((d) => d.type !== "visuel");
    expect(texte.length).toBe(1);
    expect(description(texte[0])).toBe("« 1. » → « 9. »");
  });

  it("options : casse et ponctuation ignorées, texte seul", () => {
    const a = document([["Bonjour, le Monde !"]]);
    const b = document([["bonjour le monde"]]);
    expect(comparer(a, b, { ...OPTIONS, mode: "text" }).differences.length).toBeGreaterThan(0);
    expect(comparer(a, b, { ...OPTIONS, mode: "text", ignorerCasse: true, ignorerPonctuation: true }).differences).toEqual([]);
  });
});
