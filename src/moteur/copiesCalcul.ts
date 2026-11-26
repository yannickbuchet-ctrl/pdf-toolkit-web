/**
 * Planche de copies : une même page répétée sur une feuille (une affiche en A6, quatre fois sur un A4, par exemple).
 * Calculs sans MuPDF, utilisables dans l'interface comme dans le moteur. Toutes les dimensions sont en mm.
 */

/** (libellé, largeur et hauteur de la feuille en mm, en portrait) */
export const PAPIERS_COPIES: [string, number, number][] = [
  ["A3 (29,7 × 42 cm)", 297, 420],
  ["A4 (21 × 29,7 cm)", 210, 297],
  ["A5 (14,8 × 21 cm)", 148, 210],
  ["Lettre US (21,6 × 27,9 cm)", 215.9, 279.4],
];

/** Nombres de copies proposés : chacun donne un format A plus petit (sur un A4 : 2 × A5, 4 × A6, 8 × A7). */
export const NOMBRES_COPIES = [2, 4, 8];

export const MARGE_COPIES = 5; // mm : la plupart des imprimantes n'impriment pas jusqu'au bord

export interface DispositionCopies {
  /** Feuille, orientation choisie comprise. */
  largeur: number;
  hauteur: number;
  colonnes: number;
  rangees: number;
  /** Chaque copie est tournée d'un quart de tour (dans le sens des aiguilles d'une montre). */
  tourner: boolean;
  /** Taille d'une copie sur la feuille, une fois tournée. */
  copie: [number, number];
  /** Coin supérieur gauche de chaque copie, depuis le haut de la feuille. */
  positions: [number, number][];
}

/**
 * Dispose `nombre` copies d'une page de `source` mm (taille affichée) sur la feuille, aussi grandes que possible, sans
 * déformation. Essaie les deux orientations de la feuille, chaque grille possible (colonnes × rangées = nombre) et la
 * copie tournée ou non ; à taille égale, la feuille en portrait et la copie droite sont préférées. Les copies sont
 * jointives (à `ecart` près) et le bloc est centré, pour qu'une seule coupe sépare deux copies voisines.
 */
export function dispositionCopies(papier: [number, number], source: [number, number], nombre: number, marge: number,
  ecart: number): DispositionCopies {
  const n = Math.max(1, Math.floor(nombre));
  const portrait: [number, number] = [Math.min(...papier), Math.max(...papier)];
  const paysage: [number, number] = [portrait[1], portrait[0]];
  let meilleure: { echelle: number; page: [number, number]; c: number; r: number; tourner: boolean } | null = null;
  for (const page of [portrait, paysage]) {
    for (let c = 1; c <= n; c++) {
      if (n % c) continue;
      const r = n / c;
      const celluleL = (page[0] - 2 * marge - (c - 1) * ecart) / c;
      const celluleH = (page[1] - 2 * marge - (r - 1) * ecart) / r;
      if (celluleL <= 0 || celluleH <= 0) continue;
      for (const tourner of [false, true]) {
        const [l, h] = tourner ? [source[1], source[0]] : source;
        const echelle = Math.min(celluleL / l, celluleH / h);
        // Tolérance relative : deux dispositions équivalentes ne se départagent pas sur un arrondi.
        if (!meilleure || echelle > meilleure.echelle * (1 + 1e-9)) meilleure = { echelle, page, c, r, tourner };
      }
    }
  }
  if (!meilleure) {
    return { largeur: portrait[0], hauteur: portrait[1], colonnes: 0, rangees: 0, tourner: false, copie: [0, 0], positions: [] };
  }
  const { echelle, page, c, r, tourner } = meilleure;
  const copie: [number, number] = tourner ? [source[1] * echelle, source[0] * echelle] : [source[0] * echelle, source[1] * echelle];
  const gauche = (page[0] - c * copie[0] - (c - 1) * ecart) / 2;
  const haut = (page[1] - r * copie[1] - (r - 1) * ecart) / 2;
  const positions: [number, number][] = [];
  for (let j = 0; j < r; j++) {
    for (let i = 0; i < c; i++) positions.push([gauche + i * (copie[0] + ecart), haut + j * (copie[1] + ecart)]);
  }
  return { largeur: page[0], hauteur: page[1], colonnes: c, rangees: r, tourner, copie, positions };
}

/** « A6 » si la copie a à peu près la taille d'un format A (marges comprises : 10 % de moins au plus), sinon "". */
export function formatProche(copie: [number, number]): string {
  const petit = Math.min(...copie), grand = Math.max(...copie);
  // A0 : 841 × 1189 mm ; chaque format suivant est la moitié du précédent, arrondie au mm inférieur (A1 : 594 × 841).
  const cote = (k: number) => (k < 0 ? 1189 : Math.floor(841 / Math.SQRT2 ** k));
  for (let k = 0; k <= 10; k++) {
    const fl = cote(k), fh = cote(k - 1);
    const rl = petit / fl, rh = grand / fh;
    if (rl <= 1.005 && rh <= 1.005 && rl >= 0.9 && rh >= 0.9) return `A${k}`;
  }
  return "";
}
