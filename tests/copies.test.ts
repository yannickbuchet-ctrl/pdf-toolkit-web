import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { octets, ouvrir as relire } from "./fabrique";
import { dispositionCopies, formatProche, plancheCopies, TITRE_COPIES } from "../src/moteur/copies";
import { imprimeTailleReelle } from "../src/moteur/document";

const MM = 72 / 25.4;
const A4: [number, number] = [210, 297];

/** Une affiche A4 : un fond rouge en haut, du texte, et (option) une rotation de page. */
function affiche(rotation = 0, largeur = 595.28, hauteur = 841.89): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const police = doc.addSimpleFont(new mupdf.Font("Helvetica"), "Latin");
  const contenu = `1 0 0 rg 0 ${hauteur - 100} ${largeur} 100 re f BT /F1 40 Tf 60 400 Td (AFFICHE) Tj ET`;
  const page = doc.addPage([0, 0, largeur, hauteur], rotation as 0, { Font: { F1: police } }, contenu);
  doc.insertPage(-1, page);
  return doc;
}

/** La couleur d'un point de la page (x, y en mm depuis le coin supérieur gauche). */
function couleur(page: mupdf.Page, x: number, y: number): [number, number, number] {
  const k = 2;
  const pix = page.toPixmap([k, 0, 0, k, 0, 0], mupdf.ColorSpace.DeviceRGB, false, true);
  const px = Math.round(x * MM * k), py = Math.round(y * MM * k);
  const p = pix.getPixels(), i = py * pix.getStride() + px * 3;
  return [p[i], p[i + 1], p[i + 2]];
}

describe("disposition des copies", () => {
  it("4 copies d'une affiche A4 sur un A4 : ≈ A6, jointives, en portrait", () => {
    const d = dispositionCopies(A4, A4, 4, 5, 0);
    expect([d.colonnes, d.rangees, d.tourner]).toEqual([2, 2, false]);
    expect(d.largeur).toBe(210);
    expect(d.copie[0]).toBeCloseTo(100, 5);
    expect(formatProche(d.copie)).toBe("A6");
    // Jointives : la deuxième colonne commence où finit la première.
    expect(d.positions[1][0]).toBeCloseTo(d.positions[0][0] + d.copie[0], 6);
    expect(d.positions[2][1]).toBeCloseTo(d.positions[0][1] + d.copie[1], 6);
  });

  it("2 copies : ≈ A5", () => {
    const d = dispositionCopies(A4, A4, 2, 5, 0);
    expect(d.colonnes * d.rangees).toBe(2);
    expect(formatProche(d.copie)).toBe("A5");
  });

  it("une page paysage est tournée si elle tient mieux ainsi", () => {
    const d = dispositionCopies(A4, [297, 210], 4, 5, 0);
    expect(d.copie[0]).toBeLessThan(d.copie[1]);
    expect(formatProche(d.copie)).toBe("A6");
  });

  it("2 × A4 sur un A3", () => {
    expect(formatProche(dispositionCopies([297, 420], A4, 2, 5, 0).copie)).toBe("A4");
  });
});

describe("planche PDF", () => {
  it("répète la page en vectoriel, à la taille calculée", () => {
    const source = affiche();
    const d = dispositionCopies(A4, A4, 4, 5, 0);
    const r = relire(octets(plancheCopies(source, 0, d, true, "PDF Toolkit Web"))) as mupdf.PDFDocument;
    expect(r.countPages()).toBe(1);
    expect(imprimeTailleReelle(r)).toBe(true);
    expect(r.getMetaData("info:Title")).toBe(TITRE_COPIES);
    const page = r.loadPage(0);
    const [x0, y0, x1, y1] = page.getBounds();
    expect((x1 - x0) / MM).toBeCloseTo(210, 1);
    expect((y1 - y0) / MM).toBeCloseTo(297, 1);
    // Le texte reste du texte : 4 fois « AFFICHE ».
    expect(page.toStructuredText("preserve-whitespace").asText().match(/AFFICHE/g)?.length).toBe(4);
    // Le bandeau rouge en haut de chaque copie, le blanc en dessous.
    for (const [x, y] of d.positions) {
      expect(couleur(page, x + d.copie[0] / 2, y + 2)).toEqual([255, 0, 0]);
      expect(couleur(page, x + d.copie[0] / 2, y + d.copie[1] * 0.3)).toEqual([255, 255, 255]);
    }
  });

  it("respecte la rotation de la page source", () => {
    // Page portrait tournée de 90° : affichée en paysage, bandeau rouge à droite.
    const source = affiche(90);
    const d = dispositionCopies(A4, [297, 210], 2, 5, 0);
    const page = (relire(octets(plancheCopies(source, 0, d, false, "x"))) as mupdf.PDFDocument).loadPage(0);
    const [x, y] = d.positions[0];
    if (d.tourner) {
      // Tournée encore d'un quart de tour : le bandeau passe en bas.
      expect(couleur(page, x + d.copie[0] / 2, y + d.copie[1] - 2)).toEqual([255, 0, 0]);
    } else {
      expect(couleur(page, x + d.copie[0] - 2, y + d.copie[1] / 2)).toEqual([255, 0, 0]);
    }
    expect(page.toStructuredText("preserve-whitespace").asText().match(/AFFICHE/g)?.length).toBe(2);
  });

  it("garde les annotations de la page", () => {
    const source = affiche();
    const p = source.loadPage(0) as mupdf.PDFPage;
    const a = p.createAnnotation("Square");
    a.setRect([100, 100, 300, 200]);
    a.setColor([0, 0, 1]);
    a.setBorderWidth(12);
    a.update();
    const d = dispositionCopies(A4, A4, 4, 5, 0);
    const page = (relire(octets(plancheCopies(source, 0, d, false, "x"))) as mupdf.PDFDocument).loadPage(0);
    const k = d.copie[0] / 210; // réduction
    // Le contour bleu (12 points), sur le bord gauche du rectangle, dans chaque copie : le pixel le plus bleu autour.
    for (const [x, y] of d.positions) {
      let rouge = 255;
      for (let px = 90; px <= 114; px += 2) rouge = Math.min(rouge, couleur(page, x + (px / MM) * k, y + (150 / MM) * k)[0]);
      expect(rouge).toBeLessThan(60); // MuPDF.js compte y depuis le haut de la page
    }
    // Le document d'origine n'est pas modifié.
    expect([...(source.loadPage(0) as mupdf.PDFPage).getAnnotations()].length).toBe(1);
  });
});
