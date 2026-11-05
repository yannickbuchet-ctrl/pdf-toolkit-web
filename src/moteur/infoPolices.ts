/**
 * Infos sur les polices (font_info et FontInfoDialog sur PC) : tout ce que le PDF dit des polices, pour les retrouver.
 */
import * as mupdf from "mupdf";
import { nomLisible, normaliser, sansPrefixe, tableDesNoms } from "./polices";
import { fichierDePolice, lirePage, parcourirPolices } from "./texte";

export interface InfoPoliceDocument {
  nomPdf: string;
  famille: string;
  style: string;
  type: string;
  encodage: string;
  integree: boolean;
  sousEnsemble: boolean;
  pages: number[];
  /** Textes de la table « name » (1 famille, 2 style, 4 nom complet, 5 version, 6 nom PostScript, 8 éditeur…). */
  noms: Record<number, string>;
  /** Caractères écrits avec cette police dans les pages lues. */
  lettres: string;
}

const TYPES: Record<string, string> = {
  Type0: "Type 0 (composite)", Type1: "Type 1", MMType1: "Type 1 multiple master", TrueType: "TrueType", Type3: "Type 3",
};

/** Les polices du document, pages lues au plus : pagesMax (les lettres utilisées ne sont cherchées que là). */
export function policesDuDocument(doc: mupdf.PDFDocument, pagesMax = 300): InfoPoliceDocument[] {
  const polices = new Map<string, InfoPoliceDocument>();
  const n = Math.min(doc.countPages(), pagesMax);
  for (let p = 0; p < n; p++) {
    const page = doc.loadPage(p);
    parcourirPolices(page.getObject().getInheritable("Resources"), (_cle, f) => {
      const base = f.get("BaseFont");
      const nomPdf = base.isName() ? base.asName() : "(sans nom)";
      const cle = normaliser(nomPdf) || nomPdf;
      let info = polices.get(cle);
      if (!info) {
        const fichier = fichierDePolice(f);
        const noms = fichier ? tableDesNoms(fichier) : {};
        const [fam, style] = nomLisible(nomPdf);
        const sousType = f.get("Subtype");
        const enc = f.get("Encoding");
        info = {
          nomPdf: sansPrefixe(nomPdf), famille: noms[16] ?? noms[1] ?? fam, style: noms[17] ?? noms[2] ?? (style || "Regular"),
          type: sousType.isName() ? TYPES[sousType.asName()] ?? sousType.asName() : "?",
          encodage: enc.isName() ? enc.asName() : enc.isDictionary() ? "personnalisé" : "par défaut",
          integree: fichier !== null, sousEnsemble: /^[A-Z]{6}\+/.test(nomPdf), pages: [], noms, lettres: "",
        };
        polices.set(cle, info);
      }
      if (!info.pages.includes(p + 1)) info.pages.push(p + 1);
    });
    // Caractères écrits avec chaque police : ceux qu'une police réduite contient.
    const lettres = new Map<string, Set<string>>();
    for (const c of lirePage(page).caracteres) {
      const k = normaliser(c.police);
      if (!lettres.has(k)) lettres.set(k, new Set());
      if (c.code > 0x20) lettres.get(k)!.add(String.fromCodePoint(c.code));
    }
    for (const [k, set] of lettres) {
      const info = polices.get(k) ?? [...polices.values()].find((i) => normaliser(i.nomPdf) === k);
      if (info) info.lettres = [...new Set([...info.lettres, ...set])].sort().join("");
    }
  }
  return [...polices.values()].sort((a, b) => a.famille.localeCompare(b.famille, "fr"));
}
