import { expect, it } from "vitest";
import * as mupdf from "mupdf";
import { creerPdf, octets, ouvrir as relire, policeSimple } from "./fabrique";
import { comparer, type Options } from "../src/moteur/comparaison";

// Gros documents : un même texte coupé autrement en lignes forme un bloc immense, qui doit quand même être comparé
// mot à mot (sinon tout le document paraît changé) ; deux textes sans rapport doivent rester rapides.
const helv = (d: mupdf.PDFDocument) => ({ F1: policeSimple(d, new mupdf.Font("Helvetica")) });
const VOC = "le contrat prévoit que le vendeur livre la marchandise dans un délai raisonnable et que l acheteur paie le prix convenu".split(" ");
const METEO = "météo soleil nuage pluie vent orage neige brouillard température chaleur froid".split(" ");
const O: Options = { mode: "text", ignorerCasse: false, ignorerPonctuation: false, tolerance: 0.1 };
const TEXTE = ["ajout", "suppression", "modification"];

function mots(n: number, vocabulaire = VOC, pas = 7): string[] {
  return Array.from({ length: n }, (_, i) => vocabulaire[(i * pas + Math.floor(i / 13)) % vocabulaire.length] + (i % 50 === 0 ? String(i) : ""));
}

/** Les mots en lignes de parLigne mots, 35 lignes par page. */
function documentDe(liste: string[], parLigne: number): mupdf.PDFDocument {
  const lignes: string[] = [];
  for (let i = 0; i < liste.length; i += parLigne) lignes.push(liste.slice(i, i + parLigne).join(" "));
  const pages: string[][] = [];
  for (let i = 0; i < lignes.length; i += 35) pages.push(lignes.slice(i, i + 35));
  const doc = creerPdf(pages.map((l) => ({ lignes: l.map((t, i) => ({ police: "F1", x: 60, y: 60 + 20 * i, taille: 10, texte: t })) })), helv);
  return relire(octets(doc)) as mupdf.PDFDocument;
}

it("même texte de 6 000 mots coupé autrement : aucune différence de texte, seulement des pages décalées", () => {
  const liste = mots(6000);
  const r = comparer(documentDe(liste, 9), documentDe(liste, 11), O);
  expect(r.differences.filter((d) => TEXTE.includes(d.type))).toEqual([]);
  expect(r.differences.every((d) => d.type === "mise_en_page")).toBe(true);
});

it("même texte coupé autrement avec un mot changé : une seule modification de texte", () => {
  const liste = mots(6000);
  const autre = [...liste];
  autre[4321] = "MODIFIÉ";
  const r = comparer(documentDe(liste, 9), documentDe(autre, 11), O);
  const texte = r.differences.filter((d) => TEXTE.includes(d.type));
  expect(texte.length).toBe(1);
  expect(texte[0].nouveau).toContain("MODIFIÉ");
});

it("deux textes de 6 000 mots sans rapport : comparés en quelques secondes", () => {
  const debut = Date.now();
  comparer(documentDe(mots(6000), 9), documentDe(mots(6000, METEO, 5), 9), O);
  expect(Date.now() - debut).toBeLessThan(15000);
});
