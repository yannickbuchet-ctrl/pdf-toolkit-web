import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { creerPdf, jpegDeTest, octets, ouvrir as relire, policeSimple, texteDePage } from "./fabrique";
import {
  copie, deplacer, enregistrer, extraire, fusionner, imprimeTailleReelle, insererDocuments, insererPageBlanche, MotDePasseRequis, ouvrir,
  pivoter, reordonner, supprimerPages, taillesDesPages,
} from "../src/moteur/document";
import { annotations, ajouterDessin, ajouterNote, annoterTexte, champs, chercher, insererImage, remplacerDans, remplir, selectionTexte, supprimerAnnotation } from "../src/moteur/pages";
import { policesDuDocument } from "../src/moteur/infoPolices";
import { modifierTexte } from "../src/moteur/texte";

/** Un document de n pages, chacune portant « Page k ». */
function pagesNumerotees(n: number, prefixe = "Page"): mupdf.PDFDocument {
  return creerPdf([...Array(n).keys()].map((k) => ({ lignes: [{ police: "F1", x: 72, y: 100, taille: 20, texte: `${prefixe} ${k + 1}` }] })),
    (d) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) }));
}

const titres = (doc: mupdf.Document) => [...Array(doc.countPages()).keys()].map((i) => texteDePage(doc, i).trim());

describe("pages", () => {
  it("pivote, déplace, supprime, insère et extrait", () => {
    const doc = pagesNumerotees(5);
    pivoter(doc, [1], 90);
    pivoter(doc, [1], 90);
    pivoter(doc, [2], -90);
    let relu = relire(octets(doc)) as mupdf.PDFDocument;
    expect(taillesDesPages(relu).map((t) => t.rotation)).toEqual([0, 180, 270, 0, 0]);
    expect(taillesDesPages(relu)[2]).toMatchObject({ largeur: 842, hauteur: 595 });

    deplacer(doc, [3, 4], 0);
    expect(titres(relire(octets(doc)))).toEqual(["Page 4", "Page 5", "Page 1", "Page 2", "Page 3"]);
    reordonner(doc, [4, 3, 2, 1, 0]);
    expect(titres(relire(octets(doc)))).toEqual(["Page 3", "Page 2", "Page 1", "Page 5", "Page 4"]);
    supprimerPages(doc, [0, 4]);
    expect(titres(relire(octets(doc)))).toEqual(["Page 2", "Page 1", "Page 5"]);
    expect(() => supprimerPages(doc, [0, 1, 2])).toThrow();
    insererPageBlanche(doc, 1, 300, 400);
    relu = relire(octets(doc)) as mupdf.PDFDocument;
    expect(relu.countPages()).toBe(4);
    expect(taillesDesPages(relu)[1]).toMatchObject({ largeur: 300, hauteur: 400 });

    const extrait = relire(extraire(doc, [3, 0]));
    expect(titres(extrait)).toEqual(["Page 5", "Page 2"]);
  });

  it("fusionne et insère d'autres PDF", () => {
    const a = pagesNumerotees(2, "A"), b = pagesNumerotees(3, "B");
    const f = relire(octets(fusionner([a, b])));
    expect(titres(f)).toEqual(["A 1", "A 2", "B 1", "B 2", "B 3"]);
    const c = pagesNumerotees(2, "C");
    insererDocuments(c, [pagesNumerotees(1, "X")], 1);
    expect(titres(relire(octets(c)))).toEqual(["C 1", "X 1", "C 2"]);
  });
});

describe("mots de passe", () => {
  it("protège, ouvre et retire la protection", () => {
    const doc = pagesNumerotees(1, "Secret");
    const { octets: protege } = enregistrer(doc, { compression: "aucune", motDePasse: "été 2026" });
    expect(new TextDecoder("latin1").decode(protege)).not.toContain("Secret");
    expect(() => ouvrir(protege)).toThrow(MotDePasseRequis);
    try {
      ouvrir(protege, "mauvais");
      expect.unreachable();
    } catch (e) {
      expect((e as MotDePasseRequis).incorrect).toBe(true);
    }
    const o = ouvrir(protege, "été 2026");
    expect(o.motDePasse).toBe("été 2026");
    expect(texteDePage(o.doc, 0)).toContain("Secret 1");
    const meta = relire(protege);
    expect(meta.getMetaData("encryption")).toContain("AES");
    // Retirer la protection : enregistrer sans mot de passe.
    const libre = enregistrer(o.doc, { compression: "aucune", motDePasse: null }).octets;
    const r = relire(libre);
    expect(r.needsPassword()).toBe(false);
    expect(texteDePage(r, 0)).toContain("Secret 1");
    // Le document de travail reste utilisable après un enregistrement chiffré.
    enregistrer(o.doc, { compression: "sans-perte", motDePasse: "x" });
    expect(texteDePage(relire(copie(o.doc)), 0)).toContain("Secret 1");
    expect(() => enregistrer(o.doc, { compression: "aucune", motDePasse: "a,b" })).toThrow(/virgule/);
  });

  it("ouvre un PDF aux droits limités sans mot de passe d'ouverture", () => {
    const doc = pagesNumerotees(1, "Limité");
    const data = doc.saveToBuffer("encrypt=aes-128,owner-password=proprio,permissions=0").asUint8Array().slice();
    const o = ouvrir(data);
    expect(o.restrictions).toBe(true);
    expect(texteDePage(o.doc, 0)).toContain("Limité 1");
  });
});

describe("compression", () => {
  it("sans perte et forte (images réduites)", () => {
    const doc = pagesNumerotees(1, "Photo");
    // Une grande image non compressée en JPEG, affichée sur 2 pouces : environ 1000 ppp.
    const pix = new mupdf.Image(jpegDeTest(2000, 1500, 95)).toPixmap();
    const png = pix.asPNG();
    insererImage(doc, 0, png, [72, 200, 216, 308]);
    const brut = enregistrer(doc, { compression: "aucune", motDePasse: null }).octets;
    const sansPerte = enregistrer(doc, { compression: "sans-perte", motDePasse: null }).octets;
    const forte = enregistrer(doc, { compression: "forte", motDePasse: null });
    expect(sansPerte.length).toBeLessThanOrEqual(brut.length);
    expect(forte.images).toBe(1);
    expect(forte.octets.length).toBeLessThan(brut.length / 4);
    // L'image réduite fait environ 144 ppp sur 2 pouces de large, et le texte reste du texte.
    const r = relire(forte.octets);
    expect(texteDePage(r, 0)).toContain("Photo 1");
    let largeur = 0;
    r.loadPage(0).run(new mupdf.Device({ fillImage(img: mupdf.Image) { largeur = img.getWidth(); } }), mupdf.Matrix.identity);
    expect(largeur).toBeGreaterThan(270);
    expect(largeur).toBeLessThan(300);
    // Le document de travail garde son image d'origine.
    let origine = 0;
    doc.loadPage(0).run(new mupdf.Device({ fillImage(img: mupdf.Image) { origine = img.getWidth(); } }), mupdf.Matrix.identity);
    expect(origine).toBe(2000);
  });
});

describe("annotations, formulaires, recherche, polices", () => {
  it("surligne, annote, dessine et supprime", () => {
    const doc = pagesNumerotees(1, "Texte à surligner");
    const page = doc.loadPage(0);
    const quads = selectionTexte(page, [70, 85], [300, 100]);
    expect(quads.length).toBeGreaterThan(0);
    annoterTexte(page, "Highlight", quads, [1, 0.9, 0], "Moi");
    ajouterNote(page, [300, 300], "Une note « en français »", [1, 0.8, 0], "Moi");
    ajouterDessin(page, [[[100, 400], [150, 420], [200, 400]]], [0, 0, 1], 2, "Moi");
    const relu = relire(octets(doc)) as mupdf.PDFDocument;
    const liste = annotations(relu.loadPage(0));
    expect(liste.map((a) => a.type)).toEqual(["Surlignage", "Note", "Dessin"]);
    expect(liste[1].contenu).toBe("Une note « en français »");
    supprimerAnnotation(relu.loadPage(0), 1);
    expect(annotations((relire(octets(relu)) as mupdf.PDFDocument).loadPage(0)).map((a) => a.type)).toEqual(["Surlignage", "Dessin"]);
  });

  it("remplit un formulaire", () => {
    const doc = pagesNumerotees(1, "Formulaire");
    const page = doc.loadPage(0);
    const w = page.createAnnotation("Widget") as unknown as mupdf.PDFWidget;
    w.setRect([72, 200, 300, 220]);
    const objet = w.getObject();
    objet.put("FT", doc.newName("Tx"));
    objet.put("T", doc.newString("nom"));
    objet.put("DA", doc.newString("/Helv 12 Tf 0 g"));
    const acro = doc.newDictionary();
    acro.put("Fields", doc.newArray());
    acro.get("Fields").push(objet);
    doc.getTrailer().get("Root").put("AcroForm", acro);
    const relu = relire(octets(doc)) as mupdf.PDFDocument;
    const c = champs(relu.loadPage(0));
    expect(c.length).toBe(1);
    expect(c[0].type).toBe("text");
    remplir(relu.loadPage(0), c[0].index, "Jean Dupont");
    const fin = relire(octets(relu)) as mupdf.PDFDocument;
    expect(champs(fin.loadPage(0))[0].valeur).toBe("Jean Dupont");
  });

  it("cherche sans tenir compte des accents et remplace", () => {
    const doc = creerPdf([{ lignes: [
      { police: "F1", x: 72, y: 100, taille: 12, texte: "L'été est chaud, l'ÉTÉ aussi." },
      { police: "F1", x: 72, y: 130, taille: 12, texte: "Cœur de la ville" },
    ] }], (d) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) }));
    const occ = chercher(doc, "ete");
    expect(occ.length).toBe(2);
    expect(chercher(doc, "ete", true).length).toBe(1);
    expect(chercher(doc, "été", false, true).length).toBe(2);
    expect(chercher(doc, "coeur").length).toBe(1);
    // Remplacer tout : un seul morceau, deux plages.
    const s = occ[0].segment;
    const nouveau = remplacerDans(s.texte, occ.map((o) => [o.debut, o.fin]), "hiver");
    expect(nouveau).toBe("L'hiver est chaud, l'hiver aussi.");
    modifierTexte(doc, 0, [{ cible: s, texte: nouveau }]);
    expect(texteDePage(relire(octets(doc)), 0)).toContain("L'hiver est chaud, l'hiver aussi.");
  });

  it("décrit les polices du document", () => {
    const doc = pagesNumerotees(2, "Polices");
    const p = policesDuDocument(doc);
    expect(p.length).toBe(1);
    expect(p[0]).toMatchObject({ nomPdf: "Helvetica", integree: false, pages: [1, 2] });
    expect(p[0].lettres).toContain("P");
    expect(imprimeTailleReelle(doc)).toBe(false);
  });
});

describe("enregistrement", () => {
  it("enregistre plusieurs fois sans abîmer le document, formulaires XObject semblables compris", async () => {
    const { formeDePage } = await import("../src/moteur/rapport");
    const a = pagesNumerotees(1, "Bonjour le monde"), b = pagesNumerotees(1, "Bonjour la terre");
    const doc = new mupdf.PDFDocument();
    const fa = formeDePage(doc, relire(octets(a)) as mupdf.PDFDocument, 0).forme;
    const fb = formeDePage(doc, relire(octets(b)) as mupdf.PDFDocument, 0).forme;
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, { XObject: { A: fa, B: fb } }, "/A Do q 1 0 0 1 0 -100 cm /B Do Q"));
    for (const compression of ["aucune", "sans-perte", "forte", "aucune", "sans-perte"] as const) {
      const t = texteDePage(relire(enregistrer(doc, { compression, motDePasse: null }).octets), 0);
      expect(t).toContain("Bonjour le monde");
      expect(t).toContain("Bonjour la terre");
      expect(texteDePage(doc, 0)).toContain("Bonjour la terre");
    }
  });
});
