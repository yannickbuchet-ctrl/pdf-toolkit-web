/**
 * Reconnaissance de caractères (OCR), la partie MuPDF : image des pages à lire, et calque de texte invisible posé sur
 * chaque page (mode de rendu 3), mot par mot, à la place de chaque mot de l'image. La page devient cherchable,
 * sélectionnable et copiable sans changer d'aspect. Même calque que PDF Toolkit 2 sur PC (set_ocr_layer) : police
 * GlyphLessFont, formulaire marqué PDFToolkitOCR, dessiné en dernier ; refaire l'OCR le remplace.
 *
 * Coordonnées : points de la page affichée (origine en haut à gauche, rotation du fichier comprise).
 */
import * as mupdf from "mupdf";
import { OCR_PIXELS_MAX, OCR_PPP_MIN, type ImageOcr, type LigneOcr } from "./ocrLecture";
import { ajouterContenu, nomLibre } from "./texte";

export const POLICE_OCR = "GlyphLessFont"; // nom usuel de la police des calques OCR (Tesseract, MuPDF, OCRmyPDF…)
const MARQUE_OCR = "PDFToolkitOCR"; // clé du formulaire (XObject) qui porte le calque : refaire l'OCR le remplace
const PREFIXE_OCR = "PTOcr"; // préfixe de son nom dans les ressources de la page

/**
 * Police sans aucun dessin de Tesseract (572 octets, Apache 2.0, telle que MuPDF l'écrit) : chaque caractère y est un
 * blanc d'un demi-cadratin. Avec le codage Identity-H, le code d'un caractère est son numéro Unicode, et la table
 * ToUnicode le rend tel quel : toutes les lettres sont couvertes (é è ê à ç œ « » ’ €…), pour la recherche comme pour
 * le copier-coller.
 */
const GLYPHLESS_TTF =
  "00010000000a0080000300204f532f3256dec8940000012800000060636d6170000a0034000001900000001e676c796615224124000001b8" +
  "00000018686561640b78f165000000ac00000036686865610c020402000000e400000024686d74780400000000000188000000086c6f6361" +
  "000c0000000001b0000000066d6178700004000500000108000000206e616d65f2eb16da000001d00000004b706f7374000100010000021c" +
  "000000200001000000010000b09471105f0f3cf50407080000000000cf9afc6e00000000d4c3a7f200000000040008000000001000020000" +
  "00000000000100000800ffff0000040000000000040000010000000000000000000000000000000200010000000200040001000000000001" +
  "0000000000000000000000000000000000030000019000050000000000000000000000000000000000000000000000000500010001000000" +
  "000000000000000000000000000000000000474f4f470040000000000001ffff000000010001800000000000000000000000000000010000" +
  "000000000400000000000002000100000000001400030000000000140006000a000000000000000000000000000c00000001000000000400" +
  "080000030000312111210400fc00080000000003002a0000000300000005001600000001000000000005000b001600030001040900050016" +
  "000000560065007200730069006f006e00200031002e003056657273696f6e20312e30000001000000000000000000000000000100000000" +
  "000000000000000000000000";
const TO_UNICODE = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

const octetsHex = (h: string) => Uint8Array.from(h.match(/../g)!, (o) => parseInt(o, 16));

/** La page contient-elle déjà du texte, visible ou non (calque OCR compris) ? */
export function pageATexte(page: mupdf.Page): boolean {
  const st = page.toStructuredText("");
  try {
    return st.asText().trim() !== "";
  } finally {
    st.destroy();
  }
}

/**
 * Image en niveaux de gris de la page telle qu'affichée (annotations exclues), tournée en plus de rotation degrés, à
 * environ ppp points par pouce (moins pour une très grande page), en PNG : c'est ce que lit Tesseract.
 */
export function imageOcr(page: mupdf.Page, ppp: number, rotation = 0): ImageOcr {
  const [x0, y0, x1, y1] = page.getBounds();
  let zoom = ppp / 72;
  const pixels = (x1 - x0) * (y1 - y0) * zoom * zoom;
  if (pixels > OCR_PIXELS_MAX) zoom = Math.max(OCR_PPP_MIN / 72, zoom * Math.sqrt(OCR_PIXELS_MAX / pixels));
  const pix = page.toPixmap(mupdf.Matrix.concat(mupdf.Matrix.scale(zoom, zoom), mupdf.Matrix.rotate(rotation)), mupdf.ColorSpace.DeviceGray, false, false);
  try {
    const resolution = Math.max(1, Math.round(zoom * 72));
    pix.setResolution(resolution, resolution);
    return { png: pix.asPNG().slice(), facteur: 1 / zoom, ppp: resolution };
  } finally {
    pix.destroy();
  }
}

const nombre = (v: number) => {
  const t = v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return t === "" || t === "-0" ? "0" : t;
};

/**
 * Contenu du calque : texte invisible (3 Tr) en police /F0 (policeOcr), ligne par ligne. Chaque mot est posé à sa
 * place et étiré (Tz) à sa largeur sur l'image, pour que la sélection tombe juste ; une espace, étirée elle aussi,
 * comble l'écart jusqu'au mot suivant, pour que le copier-coller sépare les mots dans toutes les visionneuses.
 * Coordonnées des lignes : celles de la page affichée ; matrice les ramène à l'espace du PDF.
 */
export function fluxCalque(lignes: LigneOcr[], matrice: mupdf.Matrix): string {
  const sortie = [matrice.map(nombre).join(" ") + " cm", "BT", "3 Tr"];
  for (const { hauteur, base, mots } of lignes) {
    if (hauteur <= 0) continue;
    sortie.push(`/F0 ${nombre(hauteur)} Tf`);
    mots.forEach(([x0, x1, texte], k) => {
      // Un caractère hors du plan multilingue de base (rare : emoji, idéogramme) ne tient pas sur deux octets.
      const codes = [...texte].map((c) => (c.codePointAt(0)! < 0x10000 ? c.codePointAt(0)! : 0xfffd));
      if (!codes.length) return;
      const etirement = Math.max(1, (100 * (x1 - x0)) / (codes.length * 0.5 * hauteur));
      const hex = codes.map((c) => c.toString(16).toUpperCase().padStart(4, "0")).join("");
      // Repère de la page affichée (y vers le bas) : la matrice de texte retourne l'axe y.
      sortie.push(`${nombre(etirement)} Tz 1 0 0 -1 ${nombre(x0)} ${nombre(base)} Tm <${hex}> Tj`);
      if (k + 1 < mots.length) {
        const ecart = mots[k + 1][0] - x1;
        sortie.push(`${nombre(Math.max(1, (100 * ecart) / (0.5 * hauteur)))} Tz <0020> Tj`);
      }
    });
  }
  sortie.push("ET");
  return sortie.join("\n") + "\n";
}

/** La police des calques OCR (Type 0, Identity-H, GlyphLessFont intégrée), ajoutée au document. */
export function policeOcr(doc: mupdf.PDFDocument): mupdf.PDFObject {
  const ttf = octetsHex(GLYPHLESS_TTF);
  const fichier = doc.addStream(ttf, { Length1: ttf.length });
  const descripteur = doc.addObject({
    Type: "FontDescriptor", FontName: POLICE_OCR, Flags: 5, FontBBox: [0, 0, 500, 1000], ItalicAngle: 0, Ascent: 1000,
    Descent: -1, CapHeight: 1000, StemV: 80, FontFile2: fichier,
  });
  const versGlyphes = new Uint8Array(2 * 65536); // tous les caractères : le glyphe blanc n° 1
  for (let k = 1; k < versGlyphes.length; k += 2) versGlyphes[k] = 1;
  const descendante = doc.addObject({
    Type: "Font", Subtype: "CIDFontType2", BaseFont: POLICE_OCR,
    CIDSystemInfo: { Registry: "(Adobe)", Ordering: "(Identity)", Supplement: 0 },
    FontDescriptor: descripteur, DW: 500, CIDToGIDMap: doc.addStream(versGlyphes, {}),
  });
  return doc.addObject({
    Type: "Font", Subtype: "Type0", BaseFont: POLICE_OCR, Encoding: "Identity-H", DescendantFonts: [descendante],
    ToUnicode: doc.addStream(TO_UNICODE, {}),
  });
}

/** Une copie (superficielle) d'un dictionnaire, en objet direct. */
function copieDirecte(doc: mupdf.PDFDocument, source: mupdf.PDFObject): mupdf.PDFObject {
  const copie = doc.newDictionary();
  if (source.isDictionary()) source.forEach((v, k) => copie.put(String(k), v));
  return copie;
}

/**
 * Le dictionnaire XObject propre à la page : ses ressources, qu'elle les partage avec d'autres pages, les hérite ou les
 * ait à elle, sont copiées dans un dictionnaire direct, ainsi que leur dictionnaire XObject. Ajouter ou retrouver le
 * calque d'une page ne touche ainsi jamais aux ressources d'une autre.
 */
function objetsPropres(doc: mupdf.PDFDocument, page: mupdf.PDFPage): mupdf.PDFObject {
  const objet = page.getObject();
  const actuelles = objet.get("Resources");
  if (!actuelles.isDictionary() || actuelles.isIndirect()) {
    objet.put("Resources", copieDirecte(doc, actuelles.isDictionary() ? actuelles : objet.getInheritable("Resources")));
  }
  const ressources = objet.get("Resources");
  const objets = ressources.get("XObject");
  if (!objets.isDictionary() || objets.isIndirect()) ressources.put("XObject", copieDirecte(doc, objets));
  return ressources.get("XObject");
}

/** Les calques OCR posés par cette application sur la page : [nom de la ressource, formulaire]. */
function calques(objets: mupdf.PDFObject): [string, mupdf.PDFObject][] {
  const r: [string, mupdf.PDFObject][] = [];
  objets.forEach((v, k) => {
    if (v.isStream() && !v.get(MARQUE_OCR).isNull()) r.push([String(k), v]);
  });
  return r;
}

/** La police du calque de ce document, créée une fois par document, puis reprise. */
const polices = new WeakMap<mupdf.PDFDocument, mupdf.PDFObject>();

/**
 * Pose le calque OCR de la page, après l'avoir pivotée de rotation degrés (0, 90, 180 ou 270) : un formulaire
 * (XObject) marqué PDFToolkitOCR, dessiné par-dessus tout le contenu. Sur une page déjà passée à l'OCR, le calque
 * existant est réécrit : le texte n'est jamais ajouté en double.
 */
export function poserCalque(doc: mupdf.PDFDocument, numero: number, lignes: LigneOcr[], rotation = 0) {
  let page = doc.loadPage(numero) as mupdf.PDFPage;
  if (rotation) {
    const objet = page.getObject();
    const actuelle = objet.getInheritable("Rotate");
    objet.put("Rotate", ((((actuelle.isNumber() ? actuelle.asNumber() : 0) + rotation) % 360) + 360) % 360);
    page = doc.loadPage(numero) as mupdf.PDFPage;
  }
  let police = polices.get(doc);
  if (!police) polices.set(doc, (police = policeOcr(doc)));
  const matrice = mupdf.Matrix.invert(page.getTransform());
  const [x0, y0, x1, y1] = mupdf.Rect.transform(page.getBounds(), matrice); // la page affichée, dans l'espace du PDF
  const dictionnaire = {
    Type: "XObject", Subtype: "Form", BBox: [x0 - 1, y0 - 1, x1 + 1, y1 + 1], Resources: { Font: { F0: police } }, [MARQUE_OCR]: 1,
  };
  const flux = fluxCalque(lignes, matrice);
  const objets = objetsPropres(doc, page);
  const existants = calques(objets);
  if (existants.length) {
    const [, formulaire] = existants[0];
    for (const [k, v] of Object.entries(dictionnaire)) formulaire.put(k, v);
    formulaire.writeStream(flux);
    for (const [, autre] of existants.slice(1)) autre.writeStream(""); // calques en trop d'un ancien passage : vidés
    return;
  }
  const nom = nomLibre(objets, PREFIXE_OCR);
  objets.put(nom, doc.addStream(flux, dictionnaire));
  ajouterContenu(doc, page, `q /${nom} Do Q\n`);
}
