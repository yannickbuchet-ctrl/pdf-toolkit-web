import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { jpegDeTest, octets, ouvrir as relire } from "./fabrique";
import {
  depuisPython, disposition, estPlanche, lirePlanche, planchePdf, photosDeLaPlanche, POINTS_PAR_MM, REGLAGES_DEFAUT,
  reglagesVersTexte, texteVersReglages,
} from "../src/moteur/photo";
import { imprimeTailleReelle } from "../src/moteur/document";

describe("disposition des photos", () => {
  it("place le plus de photos possible, bloc centré", () => {
    // 10 × 15 cm (4 × 6 pouces), photos 35 × 45, marge 5, écart 2 : 2 colonnes × 3 rangées en portrait.
    const d = disposition([101.6, 152.4], [35, 45], 5, 2);
    expect(d.capacite).toBe(6);
    expect(d.largeur).toBeCloseTo(101.6);
    expect(d.positions[0][0]).toBeCloseTo((101.6 - 72) / 2);
    expect(d.positions[0][1]).toBeCloseTo((152.4 - 139) / 2);
    // A4 : 5 × 6 = 30 photos.
    expect(disposition([210, 297], [35, 45], 5, 2).capacite).toBe(30);
    // Nombre demandé, et orientation imposée.
    expect(disposition([101.6, 152.4], [35, 45], 5, 2, "auto", 4).positions.length).toBe(4);
    expect(disposition([101.6, 152.4], [35, 45], 5, 2, "landscape").largeur).toBeCloseTo(152.4);
    // Marge et écart ne changent que le nombre de photos.
    expect(disposition([101.6, 152.4], [35, 45], 30, 2).capacite).toBe(2);
  });
});

describe("planche PDF", () => {
  it("a les dimensions exactes et demande une impression sans mise à l'échelle", () => {
    const photo = jpegDeTest(413, 531); // 35 × 45 mm à 300 ppp
    const d = disposition([101.6, 152.4], [35, 45], 5, 2);
    const reglages = { ...REGLAGES_DEFAUT, selection: [-200, -260, 400, 520] as [number, number, number, number], angle: 2.5, luminosite: 10 };
    const doc = planchePdf(photo, [d.largeur, d.hauteur], [35, 45], d.positions, true,
      { jpeg: jpegDeTest(1200, 1600), reglages: reglagesVersTexte(reglages) }, "PDF Toolkit Web");
    const r = relire(octets(doc)) as mupdf.PDFDocument;
    const [x0, y0, x1, y1] = r.loadPage(0).getBounds();
    expect((x1 - x0) / POINTS_PAR_MM).toBeCloseTo(101.6, 2);
    expect((y1 - y0) / POINTS_PAR_MM).toBeCloseTo(152.4, 2);
    expect(imprimeTailleReelle(r)).toBe(true);
    const boites = photosDeLaPlanche(r.loadPage(0))!;
    expect(boites.length).toBe(6);
    for (const b of boites) {
      expect((b[2] - b[0]) / POINTS_PAR_MM).toBeCloseTo(35, 2);
      expect((b[3] - b[1]) / POINTS_PAR_MM).toBeCloseTo(45, 2);
    }
    expect(boites[0][0] / POINTS_PAR_MM).toBeCloseTo(d.positions[0][0], 2);
    expect(boites[0][1] / POINTS_PAR_MM).toBeCloseTo(d.positions[0][1], 2);
    // Une seule image dans le fichier, partagée par les six photos.
    expect(estPlanche(r, true)).toBe(true);
    const lue = lirePlanche(r);
    expect(lue.complet).toBe(true);
    expect(lue.reglages.selection).toEqual([-200, -260, 400, 520]);
    expect(lue.reglages.angle).toBe(2.5);
    expect(lue.reglages.luminosite).toBe(10);
    expect(new mupdf.Image(lue.jpeg).getWidth()).toBe(1200);
  });

  it("relit une planche sans réglages joints d'après la page", () => {
    const d = disposition([210, 297], [35, 45], 5, 2, "auto", 8);
    const doc = planchePdf(jpegDeTest(413, 531), [d.largeur, d.hauteur], [35, 45], d.positions, false, null, "PDF Toolkit Web");
    const r = relire(octets(doc)) as mupdf.PDFDocument;
    expect(estPlanche(r, imprimeTailleReelle(r))).toBe(true);
    const lue = lirePlanche(r);
    expect(lue.complet).toBe(false);
    expect(lue.reglages.photo[0]).toBeCloseTo(35, 1);
    expect(lue.reglages.photo[1]).toBeCloseTo(45, 1);
    expect(lue.reglages.ecart).toBeCloseTo(2, 1);
    expect(lue.reglages.nombre).toBe(8);
  });
});

describe("réglages au format Python", () => {
  it("écrit et relit comme la version PC", () => {
    const texte = reglagesVersTexte({ ...REGLAGES_DEFAUT, operations: [["rotate", 90], ["crop", 1.5, -10, -20, 300, 400]] });
    expect(texte).toContain("'photo': (35, 45)");
    expect(texte).toContain("'ops': [('rotate', 90), ('crop', 1.5, -10, -20, 300, 400)]");
    const r = texteVersReglages(texte);
    expect(r.operations).toEqual([["rotate", 90], ["crop", 1.5, -10, -20, 300, 400]]);
    // Un fichier écrit par la version PC (repr de Python).
    const pc = "{'version': 1, 'format': 'France, Union européenne (35 × 45 mm)', 'photo': (35.0, 45.0), 'paper_name': 'Photo 10 × 15 cm', " +
      "'paper': (101.6, 152.4), 'orientation': 'auto', 'margin': 5.0, 'gap': 2.0, 'count': 0, 'cut_lines': True, 'guide': False, " +
      "'ops': [], 'angle': -3.0, 'selection': (-120.5, -160.0, 241.0, 310.0), 'brightness': 5, 'contrast': -4}";
    const lu = texteVersReglages(pc);
    expect(lu.guide).toBe(false);
    expect(lu.angle).toBe(-3);
    expect(lu.selection).toEqual([-120.5, -160, 241, 310]);
  });

  it("refuse ou ignore ce qui n'est pas une valeur simple", () => {
    expect(() => depuisPython("__import__('os').system('x')")).toThrow();
    expect(() => depuisPython("{'a': 1} + 1")).toThrow();
    expect(() => depuisPython("[".repeat(50) + "]".repeat(50))).toThrow();
    const r = texteVersReglages("{'photo': (1e309, 45), 'margin': 'beaucoup', 'angle': 90, 'ops': [('rotate', 45), 'x'], 'count': -5}");
    expect(r.photo).toEqual([35, 45]);
    expect(r.marge).toBe(REGLAGES_DEFAUT.marge);
    expect(r.angle).toBe(0);
    expect(r.operations).toEqual([]);
    expect(r.nombre).toBe(0);
  });
});
