/**
 * Planches de photos d'identité (id_photo_layout, id_photo_pdf, read_id_photo_sheet sur PC).
 *
 * Le PDF demande à être imprimé sans mise à l'échelle (/PrintScaling /None) : les photos doivent sortir à leur taille
 * exacte. La photo entière et les réglages peuvent être joints au PDF pour modifier la planche plus tard ; les réglages
 * sont écrits comme sur PC (un dictionnaire au format Python) et relus par un lecteur sûr, qui n'exécute rien et
 * valide chaque valeur : un PDF peut venir de n'importe qui.
 */
import * as mupdf from "mupdf";

export const POINTS_PAR_MM = 72 / 25.4;
export const TITRE_PLANCHE = "Photos d'identité";
export const FICHIER_SOURCE = "photo-identite-source.jpg";
export const FICHIER_REGLAGES = "photo-identite-reglages.txt";
export const MARGE_MIN = 3; // mm : plus près du bord, la plupart des imprimantes couperaient les photos
export const PPP_MIN = 300;
export const PPP_MAX = 600;
export const PPP_FAIBLE = 250; // en dessous, la photo paraîtra floue une fois imprimée
export const ANGLE_MAX = 15;
export const OPERATIONS_MAX = 200;

/** (libellé, largeur et hauteur de la photo en mm, hauteur du visage min et max en mm) */
export const FORMATS: [string, number | null, number | null, number | null, number | null][] = [
  ["France, Union européenne (35 × 45 mm)", 35, 45, 32, 36],
  ["Royaume-Uni (35 × 45 mm)", 35, 45, 29, 34],
  ["États-Unis, Inde (51 × 51 mm)", 50.8, 50.8, 25, 35],
  ["Canada, passeport (50 × 70 mm)", 50, 70, 31, 36],
  ["Chine, visa (33 × 48 mm)", 33, 48, 28, 33],
  ["Japon, Australie (35 × 45 mm)", 35, 45, 32, 36],
  ["Personnalisé", null, null, null, null],
];

/** (libellé, largeur et hauteur de la feuille en mm) */
export const PAPIERS: [string, number | null, number | null][] = [
  ["Photo 10 × 15 cm", 101.6, 152.4], // le papier vendu sous ce nom mesure en réalité 4 × 6 pouces
  ["Photo 13 × 18 cm", 127, 178],
  ["A6 (10,5 × 14,8 cm)", 105, 148],
  ["A5 (14,8 × 21 cm)", 148, 210],
  ["A4 (21 × 29,7 cm)", 210, 297],
  ["Lettre US (21,6 × 27,9 cm)", 215.9, 279.4],
  ["Personnalisé", null, null],
];

export type Orientation = "auto" | "portrait" | "landscape";

export interface Disposition {
  largeur: number;
  hauteur: number;
  capacite: number;
  positions: [number, number][];
}

/**
 * Dispose les photos sur la feuille, le bloc étant centré (toutes les dimensions en mm). count : nombre de photos
 * voulu, 0 pour remplir la feuille. La marge et l'espacement ne changent que le nombre de photos, jamais leur taille.
 */
export function disposition(papier: [number, number], photo: [number, number], marge: number, ecart: number,
  orientation: Orientation = "auto", nombre = 0): Disposition {
  const grille = (l: number, h: number): [number, number] => [
    // La tolérance évite de perdre une rangée à cause d'un arrondi quand tout tient au dixième de mm près.
    Math.max(Math.floor((l - 2 * marge + ecart + 1e-6) / (photo[0] + ecart)), 0),
    Math.max(Math.floor((h - 2 * marge + ecart + 1e-6) / (photo[1] + ecart)), 0),
  ];
  const portrait: [number, number] = [Math.min(...papier), Math.max(...papier)];
  const paysage: [number, number] = [Math.max(...papier), Math.min(...papier)];
  let page: [number, number];
  if (orientation === "portrait") page = portrait;
  else if (orientation === "landscape") page = paysage;
  else {
    const [pc, pr] = grille(...portrait);
    const [lc, lr] = grille(...paysage);
    page = lc * lr > pc * pr ? paysage : portrait;
  }
  const [colonnes, rangees] = grille(...page);
  const capacite = colonnes * rangees;
  if (!capacite) return { largeur: page[0], hauteur: page[1], capacite: 0, positions: [] };
  const gauche = (page[0] - colonnes * photo[0] - (colonnes - 1) * ecart) / 2;
  const haut = (page[1] - rangees * photo[1] - (rangees - 1) * ecart) / 2;
  const positions: [number, number][] = [];
  for (let r = 0; r < rangees; r++) {
    for (let c = 0; c < colonnes; c++) positions.push([gauche + c * (photo[0] + ecart), haut + r * (photo[1] + ecart)]);
  }
  return { largeur: page[0], hauteur: page[1], capacite, positions: nombre ? positions.slice(0, nombre) : positions };
}

const nombre = (v: number) => {
  const t = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
};

/**
 * PDF d'une page portant la photo (JPEG) à chaque position (dimensions en mm). Une même image est partagée par toutes
 * les photos, le fichier reste léger. source : JPEG de la photo entière et texte des réglages, joints au PDF.
 */
export function planchePdf(jpeg: Uint8Array, page: [number, number], photo: [number, number], positions: [number, number][],
  traits: boolean, source: { jpeg: Uint8Array; reglages: string } | null, application: string): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  const L = page[0] * POINTS_PAR_MM, H = page[1] * POINTS_PAR_MM;
  const image = doc.addImage(new mupdf.Image(jpeg));
  const pw = photo[0] * POINTS_PAR_MM, ph = photo[1] * POINTS_PAR_MM;
  let contenu = "";
  for (const [x, y] of positions) {
    const x0 = x * POINTS_PAR_MM, y1 = H - y * POINTS_PAR_MM; // le PDF compte y depuis le bas de la page
    contenu += `q ${nombre(pw)} 0 0 ${nombre(ph)} ${nombre(x0)} ${nombre(y1 - ph)} cm /Photo Do Q\n`;
    if (traits) contenu += `q 0.6 0.6 0.6 RG 0.25 w ${nombre(x0)} ${nombre(y1 - ph)} ${nombre(pw)} ${nombre(ph)} re S Q\n`;
  }
  const objetPage = doc.addPage([0, 0, L, H], 0, { XObject: { Photo: image } }, contenu);
  doc.insertPage(-1, objetPage);
  doc.setMetaData("info:Title", TITRE_PLANCHE);
  doc.setMetaData("info:Creator", application);
  doc.setMetaData("info:Producer", application);
  const racine = doc.getTrailer().get("Root");
  racine.put("ViewerPreferences", doc.newDictionary());
  racine.get("ViewerPreferences").put("PrintScaling", doc.newName("None"));
  if (source) {
    const date = new Date();
    doc.insertEmbeddedFile(FICHIER_SOURCE, doc.addEmbeddedFile(FICHIER_SOURCE, "image/jpeg", source.jpeg, date, date));
    doc.insertEmbeddedFile(FICHIER_REGLAGES, doc.addEmbeddedFile(FICHIER_REGLAGES, "text/plain",
      new TextEncoder().encode(source.reglages), date, date));
  }
  return doc;
}

/** Rectangles des photos d'une planche (en points) : toutes la même image, à la même taille. null sinon. */
export function photosDeLaPlanche(page: mupdf.Page): mupdf.Rect[] | null {
  const boites: mupdf.Rect[] = [];
  const images = new Set<string>();
  const appareil = new mupdf.Device({
    fillImage(image: mupdf.Image, ctm: mupdf.Matrix) {
      images.add(`${image.getWidth()}x${image.getHeight()}`);
      boites.push(mupdf.Rect.transform([0, 0, 1, 1], ctm));
    },
  });
  try {
    page.run(appareil, mupdf.Matrix.identity);
  } finally {
    appareil.close();
  }
  if (boites.length === 0 || images.size !== 1) return null;
  const l = boites[0][2] - boites[0][0], h = boites[0][3] - boites[0][1];
  if (boites.some((b) => Math.abs(b[2] - b[0] - l) > 0.5 || Math.abs(b[3] - b[1] - h) > 0.5)) return null;
  return boites;
}

export function piecesJointes(doc: mupdf.PDFDocument): Record<string, mupdf.PDFObject> {
  try {
    return doc.getEmbeddedFiles();
  } catch {
    return {};
  }
}

/** Ce PDF est-il une planche de photos d'identité créée par l'application (ou par la version PC) ? */
export function estPlanche(doc: mupdf.PDFDocument, imprimeTailleReelle: boolean): boolean {
  try {
    if (doc.countPages() === 0) return false;
    const pj = piecesJointes(doc);
    if (pj[FICHIER_SOURCE] && pj[FICHIER_REGLAGES]) return true;
    return doc.getMetaData("info:Title") === TITRE_PLANCHE && imprimeTailleReelle && photosDeLaPlanche(doc.loadPage(0)) !== null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------------------------
 * Réglages au format Python : écriture (repr) et lecture sûre (l'équivalent d'ast.literal_eval, limité aux valeurs
 * simples : dictionnaires, listes, tuples, chaînes, nombres, True, False, None).
 */
export type Valeur = null | boolean | number | string | Valeur[] | { [cle: string]: Valeur };

/** Marque un tableau à écrire comme un tuple Python. */
export const TUPLE = Symbol("tuple");
export function tuple(...v: Valeur[]): Valeur[] {
  const t = [...v];
  (t as unknown as Record<symbol, boolean>)[TUPLE] = true;
  return t;
}

export function versPython(v: Valeur): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string") return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
  if (Array.isArray(v)) {
    const estTuple = (v as unknown as Record<symbol, boolean>)[TUPLE];
    const corps = v.map(versPython).join(", ");
    return estTuple ? `(${corps}${v.length === 1 ? "," : ""})` : `[${corps}]`;
  }
  return "{" + Object.entries(v).map(([k, x]) => `${versPython(k)}: ${versPython(x)}`).join(", ") + "}";
}

/** Lit un littéral Python. Lève une erreur sur tout ce qui n'est pas une valeur simple. */
export function depuisPython(texte: string): Valeur {
  if (texte.length > 100_000) throw new Error("réglages trop longs");
  let i = 0;
  let profondeur = 0;
  const blancs = () => {
    while (i < texte.length && /\s/.test(texte[i])) i++;
  };
  const attendre = (c: string) => {
    blancs();
    if (texte[i] !== c) throw new Error(`« ${c} » attendu en position ${i}`);
    i++;
  };
  const valeur = (): Valeur => {
    blancs();
    const c = texte[i];
    if (c === "{" || c === "[" || c === "(") {
      if (++profondeur > 20) throw new Error("réglages trop imbriqués");
      const fin = c === "{" ? "}" : c === "[" ? "]" : ")";
      i++;
      const liste: Valeur[] = [];
      const dico: Record<string, Valeur> = {};
      blancs();
      while (texte[i] !== fin) {
        if (c === "{") {
          const cle = valeur();
          if (typeof cle !== "string") throw new Error("clé de dictionnaire invalide");
          attendre(":");
          dico[cle] = valeur();
        } else {
          liste.push(valeur());
        }
        blancs();
        if (texte[i] === ",") {
          i++;
          blancs();
        } else if (texte[i] !== fin) {
          throw new Error(`« ${fin} » attendu en position ${i}`);
        }
      }
      i++;
      profondeur--;
      return c === "{" ? dico : liste;
    }
    if (c === "'" || c === '"') {
      i++;
      let s = "";
      while (i < texte.length && texte[i] !== c) {
        if (texte[i] === "\\") {
          const e = texte[i + 1];
          const echappements: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"' };
          if (e === "x" || e === "u") {
            const n = e === "x" ? 2 : 4;
            s += String.fromCharCode(parseInt(texte.slice(i + 2, i + 2 + n), 16));
            i += 2 + n;
            continue;
          }
          if (!(e in echappements)) throw new Error("échappement inconnu");
          s += echappements[e];
          i += 2;
        } else {
          s += texte[i++];
        }
      }
      if (texte[i] !== c) throw new Error("chaîne non terminée");
      i++;
      return s;
    }
    const m = /^(-?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|True|False|None)/.exec(texte.slice(i, i + 64));
    if (!m) throw new Error(`valeur inattendue en position ${i}`);
    i += m[0].length;
    if (m[0] === "True") return true;
    if (m[0] === "False") return false;
    if (m[0] === "None") return null;
    return Number(m[0]);
  };
  const v = valeur();
  blancs();
  if (i !== texte.length) throw new Error("texte en trop après les réglages");
  return v;
}

/** Le tuple de count nombres finis lu dans un PDF, ou null (finite_numbers sur PC). */
export function nombresFinis(v: unknown, count: number): number[] | null {
  if (!Array.isArray(v) || v.length !== count) return null;
  if (!v.every((x) => typeof x === "number" && Number.isFinite(x))) return null;
  return v as number[];
}

export interface Reglages {
  format: string;
  photo: [number, number];
  papierNom: string;
  papier: [number, number];
  orientation: Orientation;
  marge: number;
  ecart: number;
  nombre: number;
  traits: boolean;
  guide: boolean;
  /** Quarts de tour (« rotate », 90 ou 270) et découpes (« crop », angle, x, y, l, h) appliqués à la photo. */
  operations: (["rotate", number] | ["crop", number, number, number, number, number])[];
  angle: number;
  /** Cadre : x, y, largeur, hauteur en pixels de l'image, l'origine étant son centre. */
  selection: [number, number, number, number] | null;
  luminosite: number;
  contraste: number;
}

export const REGLAGES_DEFAUT: Reglages = {
  format: FORMATS[0][0], photo: [35, 45], papierNom: PAPIERS[0][0], papier: [101.6, 152.4], orientation: "auto",
  marge: 5, ecart: 2, nombre: 0, traits: true, guide: true, operations: [], angle: 0, selection: null, luminosite: 0, contraste: 0,
};

/** Les réglages au format de la version PC (settings()). */
export function reglagesVersTexte(r: Reglages): string {
  return versPython({
    version: 1,
    format: r.format,
    photo: tuple(...r.photo),
    paper_name: r.papierNom,
    paper: tuple(...r.papier),
    orientation: r.orientation,
    margin: r.marge,
    gap: r.ecart,
    count: r.nombre,
    cut_lines: r.traits,
    guide: r.guide,
    ops: r.operations.map((op) => tuple(...op)),
    angle: r.angle,
    selection: r.selection ? tuple(...r.selection) : null,
    brightness: r.luminosite,
    contrast: r.contraste,
  });
}

const borne = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Relit des réglages venus d'un fichier (apply_settings sur PC) : toute valeur invalide est ignorée. */
export function texteVersReglages(texte: string): Reglages {
  const brut = depuisPython(texte);
  if (brut === null || typeof brut !== "object" || Array.isArray(brut)) throw new Error("réglages invalides");
  const s = brut as Record<string, Valeur>;
  const r: Reglages = structuredClone(REGLAGES_DEFAUT);
  const photo = nombresFinis(s.photo, 2);
  if (photo && photo.every((v) => v >= 5 && v <= 300)) r.photo = [photo[0], photo[1]];
  const papier = nombresFinis(s.paper, 2);
  if (papier && papier.every((v) => v >= 20 && v <= 1500)) r.papier = [papier[0], papier[1]];
  if (typeof s.format === "string" && s.format.length < 200) r.format = s.format;
  if (typeof s.paper_name === "string" && s.paper_name.length < 200) r.papierNom = s.paper_name;
  if (s.orientation === "auto" || s.orientation === "portrait" || s.orientation === "landscape") r.orientation = s.orientation;
  for (const [cle, champ] of [["margin", "marge"], ["gap", "ecart"]] as const) {
    const v = nombresFinis([s[cle]], 1);
    if (v) r[champ] = borne(v[0], 0, 100);
  }
  r.traits = s.cut_lines !== false;
  r.guide = s.guide !== false;
  const n = nombresFinis([s.count], 1);
  if (n) r.nombre = Math.max(0, Math.floor(Math.min(n[0], 10000)));
  if (Array.isArray(s.ops)) {
    for (const op of s.ops.slice(0, OPERATIONS_MAX)) {
      if (!Array.isArray(op) || op.length === 0) continue;
      if (op[0] === "rotate" && op.length === 2 && (op[1] === 90 || op[1] === 270)) r.operations.push(["rotate", op[1]]);
      else if (op[0] === "crop") {
        const c = nombresFinis(op.slice(1), 5);
        if (c && c[3] >= 1 && c[4] >= 1 && Math.abs(c[0]) <= ANGLE_MAX) r.operations.push(["crop", c[0], c[1], c[2], c[3], c[4]]);
      }
    }
  }
  const angle = nombresFinis([s.angle], 1);
  if (angle && Math.abs(angle[0]) <= ANGLE_MAX) r.angle = angle[0];
  const sel = nombresFinis(s.selection, 4);
  if (sel && sel[2] >= 1 && sel[3] >= 1) r.selection = [sel[0], sel[1], sel[2], sel[3]];
  for (const [cle, champ] of [["brightness", "luminosite"], ["contrast", "contraste"]] as const) {
    const v = nombresFinis([s[cle]], 1);
    if (v) r[champ] = Math.round(borne(v[0], -50, 50));
  }
  return r;
}

/**
 * Ce qu'il faut pour modifier une planche : la photo (JPEG), les réglages, et complet = false si le PDF ne contient
 * que la photo déjà recadrée (réglages déduits de la page).
 */
export function lirePlanche(doc: mupdf.PDFDocument): { jpeg: Uint8Array; reglages: Reglages; complet: boolean } {
  const pj = piecesJointes(doc);
  if (pj[FICHIER_SOURCE] && pj[FICHIER_REGLAGES]) {
    try {
      const reglages = texteVersReglages(new TextDecoder().decode(doc.getEmbeddedFileContents(pj[FICHIER_REGLAGES])!.asUint8Array()));
      const jpeg = doc.getEmbeddedFileContents(pj[FICHIER_SOURCE])!.asUint8Array().slice();
      return { jpeg, reglages, complet: true };
    } catch {
      // pièces jointes abîmées : on se rabat sur la photo visible dans la page
    }
  }
  const page = doc.loadPage(0);
  const boites = photosDeLaPlanche(page);
  if (!boites) throw new Error("Ce PDF n’est pas une planche de photos d’identité.");
  let image: mupdf.Image | null = null;
  const appareil = new mupdf.Device({ fillImage(img: mupdf.Image) { image ??= img; } });
  try {
    page.run(appareil, mupdf.Matrix.identity);
  } finally {
    appareil.close();
  }
  const pix = (image as unknown as mupdf.Image).toPixmap().convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
  const jpeg = pix.asJPEG(95).slice();
  const [bx0, by0, bx1, by1] = page.getBounds();
  const pageL = (bx1 - bx0) / POINTS_PAR_MM, pageH = (by1 - by0) / POINTS_PAR_MM;
  const photo: [number, number] = [(boites[0][2] - boites[0][0]) / POINTS_PAR_MM, (boites[0][3] - boites[0][1]) / POINTS_PAR_MM];
  const arrondi = (v: number) => Math.round(v * 100) / 100;
  const gauches = [...new Set(boites.map((b) => arrondi(b[0] / POINTS_PAR_MM)))].sort((a, b) => a - b);
  const hauts = [...new Set(boites.map((b) => arrondi(b[1] / POINTS_PAR_MM)))].sort((a, b) => a - b);
  const ecart = gauches.length > 1 ? gauches[1] - gauches[0] - photo[0] : hauts.length > 1 ? hauts[1] - hauts[0] - photo[1] : 2;
  const marge = Math.max(MARGE_MIN, Math.min(gauches[0], hauts[0], pageL - gauches[gauches.length - 1] - photo[0], pageH - hauts[hauts.length - 1] - photo[1]));
  const orientation: Orientation = pageL > pageH ? "landscape" : "portrait";
  const papier: [number, number] = [Math.min(pageL, pageH), Math.max(pageL, pageH)];
  const capacite = disposition(papier, photo, marge, ecart, orientation).capacite;
  const reglages: Reglages = {
    ...structuredClone(REGLAGES_DEFAUT), photo, papier, orientation, marge, ecart,
    nombre: boites.length >= capacite ? 0 : boites.length, traits: true,
  };
  return { jpeg, reglages, complet: false };
}
