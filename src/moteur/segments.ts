/**
 * Les morceaux de texte modifiables d'une page (repris de Segmentation dans Texte.kt). Toutes les coordonnées sont en
 * points de la page affichée : origine en haut à gauche, rotation propre au fichier comprise.
 */
import { estBlanc } from "./polices";

/** Un caractère de la page. police : nom tel que le PDF le donne. */
export interface CaracterePage {
  code: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  origineX: number;
  origineY: number;
  police: string;
  taille: number;
  /** Couleur en 0xRRGGBB. */
  couleur: number;
  gras: boolean;
  italique: boolean;
  ligne: number;
}

/** Un morceau de texte modifiable : une suite de caractères d'une même ligne, dans une même police, taille et couleur. */
export interface Segment {
  texte: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  origineX: number;
  origineY: number;
  police: string;
  taille: number;
  couleur: number;
  gras: boolean;
  italique: boolean;
  ligne: number;
  /** Bords gauche et droit de chaque caractère du texte (un par point de code), pour surligner une partie. */
  bords: [number, number][];
}

const blanc = (c: CaracterePage) => estBlanc(c.code);

function memeStyle(a: CaracterePage, b: CaracterePage): boolean {
  return a.police === b.police && Math.abs(a.taille - b.taille) < 0.05 && a.couleur === b.couleur;
}

function segment(c: CaracterePage[]): Segment {
  const premier = c[0];
  const visibles = c.filter((x) => !blanc(x));
  return {
    texte: c.map((x) => String.fromCodePoint(x.code === 0xa0 ? 0x20 : x.code)).join(""),
    x0: Math.min(...visibles.map((x) => x.x0)),
    y0: Math.min(...visibles.map((x) => x.y0)),
    x1: Math.max(...visibles.map((x) => x.x1)),
    y1: Math.max(...visibles.map((x) => x.y1)),
    origineX: premier.origineX,
    origineY: premier.origineY,
    police: premier.police,
    taille: premier.taille,
    couleur: premier.couleur,
    gras: premier.gras,
    italique: premier.italique,
    ligne: premier.ligne,
    bords: c.map((x) => [x.x0, x.x1]),
  };
}

/**
 * Regroupe les caractères en morceaux. Une espace ne commence jamais un morceau : elle suit celui en cours. Un grand
 * écart sur une même ligne (colonnes, cellules de tableau) coupe le morceau. Les espaces du bord sont retirées.
 */
export function decouper(caracteres: CaracterePage[]): Segment[] {
  const segments: Segment[] = [];
  let courant: CaracterePage[] = [];
  let reference: CaracterePage | null = null;
  const clore = () => {
    let debut = 0;
    let fin = courant.length;
    while (debut < fin && blanc(courant[debut])) debut++;
    while (fin > debut && blanc(courant[fin - 1])) fin--;
    if (fin > debut) segments.push(segment(courant.slice(debut, fin)));
    courant = [];
    reference = null;
  };
  for (const c of caracteres) {
    const r: CaracterePage | null = reference;
    if (r === null) {
      if (blanc(c)) continue;
      courant.push(c);
      reference = c;
      continue;
    }
    const derniere = courant[courant.length - 1];
    const memeLigne = c.ligne === r.ligne;
    const loin = c.x0 - derniere.x1 > 3 * r.taille;
    if (!memeLigne || loin) {
      clore();
      if (!blanc(c)) {
        courant.push(c);
        reference = c;
      }
      continue;
    }
    if (blanc(c) || memeStyle(c, r)) {
      courant.push(c);
    } else {
      clore();
      courant.push(c);
      reference = c;
    }
  }
  clore();
  return segments;
}

/** Le morceau sous le pointeur : celui qui contient le point, ou le plus proche à moins de tolerance points. */
export function toucher(segments: Segment[], x: number, y: number, tolerance: number): Segment | null {
  let meilleur: Segment | null = null;
  let distance = Infinity;
  for (const s of segments) {
    const dx = Math.max(0, s.x0 - x, x - s.x1);
    const dy = Math.max(0, s.y0 - y, y - s.y1);
    const d = dx * dx + dy * dy;
    // À distance égale (point dans plusieurs morceaux), le plus petit l'emporte : c'est le plus précis.
    const plusPetit = meilleur !== null && (s.x1 - s.x0) * (s.y1 - s.y0) < (meilleur.x1 - meilleur.x0) * (meilleur.y1 - meilleur.y0);
    if (d < distance || (d === distance && plusPetit)) {
      distance = d;
      meilleur = s;
    }
  }
  return meilleur !== null && distance <= tolerance * tolerance ? meilleur : null;
}

/** Retrouve un morceau après une nouvelle lecture de la page : même texte, même place à un demi-point près. */
export function retrouver(segments: Segment[], cible: Pick<Segment, "texte" | "origineX" | "origineY">): Segment | null {
  return segments.find((s) => s.texte === cible.texte && Math.abs(s.origineX - cible.origineX) < 0.5 &&
    Math.abs(s.origineY - cible.origineY) < 0.5) ?? null;
}

const sansBlancs = (t: string) => t.replace(/[\s ]/g, "");

/** Combien de fois le texte apparaît sur la page, espaces ignorées : sert à vérifier qu'il a bien disparu. */
export function occurrences(segments: Segment[], texte: string): number {
  const cible = sansBlancs(texte);
  if (!cible) return 0;
  const page = segments.map((s) => sansBlancs(s.texte)).join("");
  let n = 0;
  let i = page.indexOf(cible);
  while (i >= 0) {
    n++;
    i = page.indexOf(cible, i + cible.length);
  }
  return n;
}

/** Rectangle des caractères debut..fin (en points de code) d'un morceau. */
export function rectangleDe(s: Segment, debut: number, fin: number): [number, number, number, number] {
  const b = s.bords.slice(debut, Math.max(debut + 1, fin));
  if (b.length === 0) return [s.x0, s.y0, s.x1, s.y1];
  return [Math.min(...b.map((x) => x[0])), s.y0, Math.max(...b.map((x) => x[1])), s.y1];
}
