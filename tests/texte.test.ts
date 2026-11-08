import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import fs from "node:fs";
import { ARIAL, arialDisponible, creerPdf, type Ligne, octets, ouvrir, policeCid, policeSimple, policesDesLettres, texteDePage } from "./fabrique";
import { ajouterTexte, modifierTexte, segmentsDePage } from "../src/moteur/texte";
import { normaliser, famille, chaine, morceaux, nomLisible } from "../src/moteur/polices";
import { lireTableUnicode, winAnsi } from "../src/moteur/tableUnicode";

/** Modifie un morceau de la page, enregistre le document puis le rouvre depuis les octets écrits. */
function modifierEtRelire(doc: mupdf.PDFDocument, page: number, ancien: string, nouveau: string) {
  const cible = segmentsDePage(doc.loadPage(page)).find((s) => s.texte === ancien);
  if (!cible) throw new Error(`morceau « ${ancien} » introuvable : ${segmentsDePage(doc.loadPage(page)).map((s) => s.texte).join(" | ")}`);
  const [bilan] = modifierTexte(doc, page, [{ cible, texte: nouveau }]);
  const relu = ouvrir(octets(doc));
  return { bilan, relu, cible };
}

describe("noms de police", () => {
  it("normalise comme la version PC", () => {
    expect(normaliser("ABCDEF+TimesNewRomanPS-BoldMT")).toBe("timesnewromanbold");
    expect(normaliser("Times New Roman Bold")).toBe("timesnewromanbold");
    expect(famille("Arial-BoldMT")).toBe("arial");
    expect(famille("Calibri0400")).toBe("calibri");
    expect(nomLisible("ABCDEF+WorkSans-MediumItalic")).toEqual(["Work Sans", "Medium Italic"]);
    expect(nomLisible("Arial,Bold")).toEqual(["Arial", "Bold"]);
  });

  it("classe les polices de la plus fidèle à la plus générale", () => {
    const ch = chaine({ nom: "ABCDEF+Arial-BoldMT", gras: true, italique: false, integree: true }, "origine", null,
      [[{ nom: "ABCDEF+Arial-BlackMT", gras: true, italique: false, integree: true }, "soeur"]], (n) => n);
    expect(ch.map((c) => c.provenance)).toEqual(["originale", "soeur", "equivalente", "proche"]);
    expect(ch[3].police).toBe("Helvetica-Bold#");
    expect(ch[0].police).toBe("origine");
    expect(ch[2].nom).toBe("Helvetica-Bold");
  });

  it("découpe le texte selon les lettres disponibles", () => {
    const parts = morceaux("abc déf", 2, (rang, cp) => rang === 1 || cp < 128);
    expect(parts).toEqual([[0, "abc d"], [1, "é"], [0, "f"]]);
  });

  it("lit une table ToUnicode", () => {
    const t = lireTableUnicode("1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar <0003> <0020> <0024> <00E9> endbfchar\n1 beginbfrange <0010> <0012> <0041> endbfrange");
    expect(t.octets).toBe(2);
    expect(t.codes.get(0xe9)).toBe(0x24);
    expect(t.codes.get(0x42)).toBe(0x11);
    expect(winAnsi(0x20ac)).toBe(0x80);
    expect(winAnsi(0x151)).toBeNull();
  });
});

describe("modification du texte", () => {
  it("police standard non intégrée (Helvetica), avec accents", () => {
    const doc = creerPdf([{ lignes: [
      { police: "F1", x: 72, y: 100, taille: 14, texte: "Bonjour le monde" },
      { police: "F1", x: 72, y: 130, taille: 12, texte: "Été à Noël, ça coûte 5 €", couleur: [0.8, 0, 0] },
    ] }], (d) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) }));
    const { bilan, relu } = modifierEtRelire(doc, 0, "Été à Noël, ça coûte 5 €", "Œuvre déjà réécrite à 7 €");
    const texte = texteDePage(relu, 0);
    expect(texte).toContain("Œuvre déjà réécrite à 7 €");
    expect(texte).not.toContain("Noël");
    expect(texte).toContain("Bonjour le monde");
    expect(bilan.conservee).toBe(true);
    expect(bilan.message).toContain("Helvetica");
    // Taille, couleur et ligne de base conservées.
    const s = segmentsDePage(relu.loadPage(0)).find((x) => x.texte.startsWith("Œuvre"))!;
    expect(s.taille).toBeCloseTo(12, 1);
    expect(s.couleur).toBe(0xcc0000);
    expect(s.origineX).toBeCloseTo(72, 1);
    expect(s.origineY).toBeCloseTo(130, 1);
    expect(policesDesLettres(relu, 0).filter(([c]) => c === "Œ").map(([, f]) => f)).toEqual(["Helvetica"]);
  });

  it("police intégrée complète (Type 0) : la police d'origine est réutilisée", () => {
    const doc = creerPdf([{ lignes: [{ police: "F2", x: 72, y: 100, taille: 16, texte: "Texte en police intégrée" }] }],
      (d) => ({ F2: policeCid(d, new mupdf.Font("Times-Roman")) }));
    const relu0 = ouvrir(octets(doc));
    const { bilan, relu } = modifierEtRelire(relu0 as mupdf.PDFDocument, 0, "Texte en police intégrée", "Nouvelle phrase : « déjà vue » !");
    expect(texteDePage(relu, 0)).toContain("Nouvelle phrase : « déjà vue » !");
    expect(bilan.conservee).toBe(true);
    expect(bilan.message).toContain("conservée");
    // Aucune police ajoutée : le texte est écrit avec la police d'origine (même objet du PDF).
    const polices = new Set(policesDesLettres(relu, 0).map(([, f]) => f));
    expect(polices.size).toBe(1);
  });

  it("police intégrée réduite : lettres manquantes prises dans l'équivalent standard", () => {
    const doc = creerPdf([{ lignes: [{ police: "F2", x: 72, y: 100, taille: 16, texte: "abc def" }] }],
      (d) => ({ F2: policeCid(d, new mupdf.Font("Times-Roman")) }));
    doc.subsetFonts();
    const reduit = ouvrir(octets(doc)) as mupdf.PDFDocument;
    const nom = segmentsDePage(reduit.loadPage(0))[0].police;
    const { bilan, relu } = modifierEtRelire(reduit, 0, "abc def", "bac fed xyz");
    expect(texteDePage(relu, 0)).toContain("bac fed xyz");
    expect(bilan.conservee).toBe(false);
    expect(bilan.message).toContain("sauf pour des lettres");
    expect(bilan.message).toContain("xyz");
    const lettres = policesDesLettres(relu, 0);
    expect(lettres.find(([c]) => c === "b")![1]).toBe(nom);
    expect(lettres.find(([c]) => c === "x")![1]).not.toBe(nom);
  });

  it.runIf(arialDisponible)("police TrueType intégrée en codage WinAnsi (Arial)", () => {
    const arial = new mupdf.Font("ArialMT", new Uint8Array(fs.readFileSync(ARIAL)));
    const doc = creerPdf([{ lignes: [{ police: "F3", x: 50, y: 200, taille: 11, texte: "Facture n° 42" }] }],
      (d) => ({ F3: policeSimple(d, arial) }));
    const { bilan, relu } = modifierEtRelire(ouvrir(octets(doc)) as mupdf.PDFDocument, 0, "Facture n° 42", "Facture n° 43 — réglée");
    expect(texteDePage(relu, 0)).toContain("Facture n° 43 — réglée");
    expect(bilan.conservee).toBe(true);
  });

  it("page pivotée et remplacement de plusieurs morceaux", () => {
    const doc = creerPdf([{ rotation: 90, lignes: [
      { police: "F1", x: 72, y: 100, taille: 12, texte: "Premier" },
      { police: "F1", x: 72, y: 140, taille: 12, texte: "Second" },
    ] }], (d) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) }));
    const segs = segmentsDePage(doc.loadPage(0));
    const avant = segs.map((s) => [s.texte, s.origineX, s.origineY]);
    const bilans = modifierTexte(doc, 0, [
      { cible: segs.find((s) => s.texte === "Premier")!, texte: "Premier modifié, beaucoup plus long" },
      { cible: segs.find((s) => s.texte === "Second")!, texte: "Deuxième" },
    ]);
    expect(bilans.every((b) => b.conservee)).toBe(true);
    const relu = ouvrir(octets(doc));
    const apres = segmentsDePage(relu.loadPage(0));
    const p = apres.find((s) => s.texte.startsWith("Premier modifié"))!;
    const ancien = avant.find((a) => a[0] === "Premier")!;
    expect(p.origineX).toBeCloseTo(ancien[1] as number, 1);
    expect(p.origineY).toBeCloseTo(ancien[2] as number, 1);
    expect(apres.some((s) => s.texte === "Deuxième")).toBe(true);
    expect(apres.some((s) => s.texte === "Second")).toBe(false);
  });

  it("ajout de texte avec des caractères hors WinAnsi", () => {
    const doc = creerPdf([{ lignes: [] }], () => ({}));
    ajouterTexte(doc, 0, 100, 100, "Ajouté : « été » et Łódź\nDeuxième ligne", 14, 0x0000ff, "Helvetica");
    const relu = ouvrir(octets(doc));
    const t = texteDePage(relu, 0);
    expect(t).toContain("Ajouté : « été » et Łódź");
    expect(t).toContain("Deuxième ligne");
  });
});

describe("mots placés un par un", () => {
  // Comme certaines pages web imprimées en PDF : chaque mot (et la ligature « fi ») est écrit à part, sans caractère
  // d'espace, à la position calculée par le navigateur.
  const helv = new mupdf.Font("Helvetica");
  const largeur = (t: string, taille: number) => [...t].reduce((s, c) => s + helv.advanceGlyph(helv.encodeCharacter(c.codePointAt(0)!), 0) * taille, 0);
  function motParMot(mots: string[], x: number, y: number, taille: number, police = "F"): Ligne[] {
    const lignes: Ligne[] = [];
    for (const mot of mots) {
      lignes.push({ police, x, y, taille, texte: mot });
      x += largeur(mot, taille) + (mot === "fi" ? 0 : 0.28 * taille);
    }
    return lignes;
  }
  const fabriquer = () => creerPdf([{ lignes: [
    ...motParMot(["Date", "de", "fi", "n", "du", "contrat", ":", "10/12/2024"], 60, 100, 11),
    ...motParMot(["Nom", "et", "prénom"], 60, 140, 11),
    ...motParMot(["Date", "de", "naissance"], 360, 140, 11),
    ...motParMot(["Total", ":"], 60, 180, 11),
    ...motParMot(["450", "€"], 60 + largeur("Total", 11) + largeur(":", 11) + 0.56 * 11, 180, 11, "G"),
  ] }], (doc) => ({ F: policeSimple(doc, helv), G: policeSimple(doc, new mupdf.Font("Helvetica-Bold")) }));

  it("forment un seul morceau par ligne, espaces rétablies, colonnes et styles séparés", () => {
    const textes = segmentsDePage(fabriquer().loadPage(0)).map((s) => s.texte);
    expect(textes).toEqual(["Date de fin du contrat : 10/12/2024", "Nom et prénom", "Date de naissance", "Total :", "450 €"]);
    const s = segmentsDePage(fabriquer().loadPage(0))[0];
    expect(s.bords).toHaveLength([...s.texte].length);
  });

  it("se modifient d'un coup, sans laisser de mot de l'ancien texte", () => {
    const { relu } = modifierEtRelire(fabriquer(), 0, "Date de fin du contrat : 10/12/2024", "Date de fin du contrat : 31/12/2025");
    const textes = segmentsDePage(relu.loadPage(0)).map((s) => s.texte);
    expect(textes).toContain("Date de fin du contrat : 31/12/2025");
    expect(textes.filter((t) => t.startsWith("Date de fin"))).toHaveLength(1);
    expect(texteDePage(relu, 0)).not.toContain("10/12/2024");
    expect(textes).toContain("Date de naissance");
  });
});
