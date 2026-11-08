import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { octets, ouvrir, texteDePage } from "./fabrique";
import { ajouterPages, distance, lecteurTesseract, pageDeTexte, scan } from "./scan";
import { imageOcr, pageATexte, poserCalque } from "../src/moteur/ocr";
import {
  bilanVide, lignesOcr, lirePlages, motsCourants, reconnaitre, resumeOcr, seLitBien, texteExporte, type LecteurOcr, type MoteurOcr,
  type OptionsOcr,
} from "../src/moteur/ocrLecture";
import { chercher } from "../src/moteur/pages";
import { segmentsDePage } from "../src/moteur/texte";
import { taillesDesPages } from "../src/moteur/document";

const TEXTE: [number, string][] = [
  [16, "Compte rendu de la réunion du 12 février"],
  [12, "Été comme hiver, l’équipe se réunit à Noël chez Hélène."],
  [12, "Le château de la forêt où naît la rivière coûte 450 €."],
  [12, "Ça déçoit : « garçon », « œuvre », « cœur » et « maïs »."],
  [12, "Les élèves ont reçu leurs bulletins après les vacances."],
];

/** Le moteur PDF de la reconnaissance, directement sur un document MuPDF (dans le site : par le Web Worker). */
function moteurDe(doc: mupdf.PDFDocument, premieres: boolean[] = []): MoteurOcr {
  return {
    aDuTexte: async (p) => pageATexte(doc.loadPage(p)),
    image: async (p, ppp, rotation) => imageOcr(doc.loadPage(p), ppp, rotation),
    poser: async (p, lignes, rotation, premiere) => {
      premieres.push(premiere);
      poserCalque(doc, p, lignes, rotation);
    },
  };
}

const OPTIONS: OptionsOcr = { passerTexte: true, redresser: true };
let fra: Awaited<ReturnType<typeof lecteurTesseract>>;
let lire: LecteurOcr;

beforeAll(async () => {
  fra = await lecteurTesseract("fra");
  lire = fra.lire;
}, 60000);
afterAll(async () => {
  await fra?.fin();
});

async function ocr(doc: mupdf.PDFDocument, pages = [...Array(doc.countPages()).keys()], options = OPTIONS) {
  const bilan = bilanVide();
  const premieres: boolean[] = [];
  const fini = await reconnaitre(moteurDe(doc, premieres), lire, pages, options, () => {}, bilan);
  return { bilan, premieres, fini };
}

/** Taux d'erreur par caractère entre le texte lu et le texte attendu (espaces comprises). */
const tauxErreur = (lu: string, attendu: string) => distance(lu.replace(/\s+/g, " ").trim(), attendu) / attendu.length;
const attendu = TEXTE.map(([, t]) => t).join(" ");

describe("reconnaissance de texte (OCR)", () => {
  it("lit un scan accentué, bruité et incliné, et le rend cherchable sans changer son aspect", async () => {
    const doc = scan({ lignes: TEXTE, bruit: 0.003, inclinaison: 0.5 });
    expect(pageATexte(doc.loadPage(0))).toBe(false);
    const avant = doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true).getPixels().slice();
    const { bilan, premieres, fini } = await ocr(doc);
    expect(fini).toBe(true);
    expect(bilan.faites).toEqual([0]);
    expect(premieres).toEqual([true]);
    expect(tauxErreur(bilan.textes[0], attendu)).toBeLessThan(0.03);

    // Le PDF enregistré puis relu : le texte se copie, mots séparés, et se cherche sans accents.
    const relu = ouvrir(octets(doc)) as mupdf.PDFDocument;
    const copie = texteDePage(relu, 0);
    expect(tauxErreur(copie, attendu)).toBeLessThan(0.03);
    expect(copie).toContain("château de la forêt");
    expect(chercher(relu, "chateau de la foret").length).toBe(1);
    expect(chercher(relu, "NOEL").length).toBe(1);
    // L'occurrence est à sa place sur l'image : le texte d'origine est en Times 12 à 72 pt du bord gauche.
    const [o] = chercher(relu, "château");
    expect(o.rect[1]).toBeGreaterThan(90 + 16 * 1.6 + 12 * 1.6 - 14);
    expect(o.rect[3]).toBeLessThan(90 + 16 * 1.6 + 12 * 1.6 * 2 + 4);
    // Le calque est invisible : la page s'affiche comme avant, au pixel près.
    const apres = relu.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true).getPixels();
    let differents = 0;
    for (let k = 0; k < avant.length; k++) if (Math.abs(avant[k] - apres[k]) > 2) differents++;
    expect(differents).toBe(0);
    // En mode édition, le texte reconnu est marqué : il ne se modifie pas. Une ligne de l'image, un morceau.
    const segments = segmentsDePage(relu.loadPage(0));
    expect(segments.length).toBe(TEXTE.length);
    expect(segments.every((s) => s.ocr)).toBe(true);
    expect(chercher(relu, "rivière")[0].segment.ocr).toBe(true);
  });

  it("laisse telles quelles les pages qui ont déjà du texte", async () => {
    const doc = pageDeTexte([[14, "Une page déjà lisible, écrite en vrai texte."]]);
    ajouterPages(doc, scan({ lignes: TEXTE.slice(0, 2) }));
    const { bilan } = await ocr(doc);
    expect(bilan.ignorees).toEqual([0]);
    expect(bilan.faites).toEqual([1]);
    expect(segmentsDePage(doc.loadPage(0)).every((s) => !s.ocr)).toBe(true);
    expect(resumeOcr(bilan)).toBe("Texte reconnu sur 1 page (déjà du texte, laissée telle : page 1).");
    // Relancée, la reconnaissance ne refait rien : la page scannée a maintenant son texte.
    const encore = await ocr(doc);
    expect(encore.bilan.ignorees).toEqual([0, 1]);
    expect(encore.premieres).toEqual([]);
  });

  it("refait l'OCR d'une page sans ajouter le texte en double", async () => {
    const doc = scan({ lignes: TEXTE.slice(1, 3), bruit: 0.002 });
    await ocr(doc);
    const { bilan } = await ocr(doc, [0], { passerTexte: false, redresser: true });
    expect(bilan.faites).toEqual([0]);
    const relu = ouvrir(octets(doc)) as mupdf.PDFDocument;
    expect(chercher(relu, "château").length).toBe(1);
    expect(chercher(relu, "Hélène").length).toBe(1);
    // Un seul calque sur la page, dessiné une seule fois.
    const objets = relu.loadPage(0).getObject().get("Resources").get("XObject");
    const calques: string[] = [];
    objets.forEach((v, k) => !v.get("PDFToolkitOCR").isNull() && calques.push(String(k)));
    expect(calques).toEqual(["PTOcr1"]);
  });

  it("lit une page pivotée par le fichier, et pose le texte à sa place affichée", async () => {
    // Feuille scannée de côté, que le fichier fait afficher droite (/Rotate 90).
    const doc = scan({ lignes: TEXTE, tourne: 270, rotationPage: 90 });
    const taille = taillesDesPages(doc)[0];
    expect([Math.round(taille.largeur), Math.round(taille.hauteur), taille.rotation]).toEqual([595, 842, 90]);
    const { bilan } = await ocr(doc);
    expect(bilan.redressees).toEqual({});
    expect(tauxErreur(bilan.textes[0], attendu)).toBeLessThan(0.03);
    const relu = ouvrir(octets(doc)) as mupdf.PDFDocument;
    const [o] = chercher(relu, "réunion");
    expect(o.rect[0]).toBeGreaterThan(72);
    expect(o.rect[1]).toBeGreaterThan(70);
    expect(o.rect[3]).toBeLessThan(100);
    expect(taillesDesPages(relu)[0].rotation).toBe(90);
  });

  it("redresse une page scannée à l'envers", async () => {
    const doc = scan({ lignes: TEXTE, tourne: 180 });
    const { bilan } = await ocr(doc);
    expect(bilan.redressees).toEqual({ 0: 180 });
    expect(tauxErreur(bilan.textes[0], attendu)).toBeLessThan(0.03);
    const relu = ouvrir(octets(doc)) as mupdf.PDFDocument;
    expect(taillesDesPages(relu)[0].rotation).toBe(180);
    const [o] = chercher(relu, "réunion");
    expect(o.rect[1]).toBeLessThan(120); // en haut de la page, une fois redressée
    expect(resumeOcr(bilan)).toBe("Texte reconnu sur 1 page (redressée : page 1).");
    // Sans redressement, la page n'est pas tournée et se lit mal.
    const autre = scan({ lignes: TEXTE, tourne: 180 });
    const sans = await ocr(autre, [0], { passerTexte: true, redresser: false });
    expect(sans.bilan.redressees).toEqual({});
    expect(taillesDesPages(autre)[0].rotation).toBe(0);
  });

  it("s'arrête entre deux pages, en gardant les pages déjà lues", async () => {
    const doc = scan({ lignes: TEXTE.slice(0, 2) });
    ajouterPages(doc, scan({ lignes: TEXTE.slice(2, 4) }));
    ajouterPages(doc, scan({ lignes: TEXTE.slice(3) }));
    const bilan = bilanVide();
    let lues = 0;
    // Comme le bouton Annuler du site : la lecture en cours échoue (Tesseract arrêté), et arret() devient vrai.
    const lecteur: LecteurOcr = async (image, p) => {
      if (++lues === 2) throw new Error("arrêtée");
      return lire(image, p);
    };
    const fini = await reconnaitre(moteurDe(doc), lecteur, [0, 1, 2], OPTIONS, () => {}, bilan, () => lues >= 2);
    expect(fini).toBe(false);
    expect(bilan.faites).toEqual([0]);
    expect(resumeOcr(bilan, true)).toBe("Reconnaissance interrompue : les pages déjà lues gardent leur texte. Texte reconnu sur 1 page.");
    expect(pageATexte(doc.loadPage(1))).toBe(false);
    // Relancée, elle reprend où elle s'était arrêtée.
    const suite = await ocr(doc);
    expect(suite.bilan.ignorees).toEqual([0]);
    expect(suite.bilan.faites).toEqual([1, 2]);
    expect(texteExporte(suite.bilan)).toMatch(/^— Page 2 —\n.*château.*\n\n— Page 3 —\n/s);
  });

  it("signale une page blanche", async () => {
    const doc = scan({ lignes: [] });
    const { bilan } = await ocr(doc);
    expect(bilan.vides).toEqual([0]);
    expect(resumeOcr(bilan)).toBe("Aucun texte ajouté (aucun texte trouvé : page 1).");
  });
});

describe("OCR : saisie et sens de lecture", () => {
  it("lit une liste de pages", () => {
    expect(lirePlages("1-3, 7", 10)).toEqual([0, 1, 2, 6]);
    expect(lirePlages("5–3; 2", 10)).toEqual([1, 2, 3, 4]);
    expect(() => lirePlages("2-12", 10)).toThrow("Le document a 10 pages : « 2-12 » en sort.");
    expect(() => lirePlages("a", 10)).toThrow("« a » n’est pas un numéro de page ni une plage (exemple : 1-3, 7).");
    expect(() => lirePlages(" , ", 10)).toThrow("Indiquez les pages à lire");
  });

  it("reconnaît une page lue à l'endroit à ses mots courants", () => {
    const ligne = (t: string) => ({ hauteur: 10, base: 10, mots: t.split(" ").map((m) => [0, 1, m] as [number, number, string]) });
    expect(seLitBien(motsCourants([ligne("Le château de la forêt et les élèves ont reçu leurs bulletins")]))).toBe(true);
    expect(seLitBien(motsCourants([ligne("sadinbo SOA ʇuǝɯ ǝɔ ı ʞ ne qnʎ")]))).toBe(false);
    // Bruit écarté : traits de tableau, lignes sans lettre ni chiffre.
    const mots = [{ x0: 0, y0: 0, x1: 10, y1: 10, texte: "|", ligne: 0 }, { x0: 0, y0: 20, x1: 10, y1: 30, texte: "- .", ligne: 1 },
      { x0: 20, y0: 20, x1: 40, y1: 30, texte: "|Total|", ligne: 2 }];
    expect(lignesOcr(mots).map((l) => l.mots.map((m) => m[2]))).toEqual([["Total"]]);
  });
});
