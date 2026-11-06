/**
 * Planches de photos d'identité : formats, papiers, disposition et réglages (sans MuPDF, utilisable dans
 * l'interface comme dans le moteur).
 */
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

