/**
 * Comparaison de deux PDF : types de différences, résultat et textes (sans MuPDF, utilisable dans l'interface).
 */
export type Rect = [number, number, number, number];

export const TYPES = {
  ajout: ["#16a34a", "Ajout", "ajouts"],
  suppression: ["#dc2626", "Suppression", "suppressions"],
  modification: ["#ea7a00", "Modification", "modifications"],
  visuel: ["#7c3aed", "Changement visuel", "changements visuels"],
  page_ajoutee: ["#16a34a", "Page ajoutée", "pages ajoutées"],
  page_supprimee: ["#dc2626", "Page supprimée", "pages supprimées"],
  mise_en_page: ["#0891b2", "Mise en page", "changements de mise en page"],
} as const;
export type Type = keyof typeof TYPES;
export const TYPES_TEXTE: Type[] = ["ajout", "suppression", "modification"];
export const TYPES_PAGE: Type[] = ["page_ajoutee", "page_supprimee", "mise_en_page"];
export const MODES = { both: "Texte et visuel", text: "Texte seul", visual: "Visuel seul" } as const;
export type Mode = keyof typeof MODES;
/** Réglages de la comparaison visuelle, avec leur tolérance (en %) : « plan » regarde plus finement (zones fines). */
export const REGLAGES = { document: ["Document", 10], plan: ["Plan technique (circuit, dessin)", 5] } as const;
export type Reglage = keyof typeof REGLAGES;

export interface Options {
  mode: Mode;
  ignorerCasse: boolean;
  ignorerPonctuation: boolean;
  /** Tolérance de la comparaison visuelle, de 0 à 1. */
  tolerance: number;
  /** Réglage choisi (« document » par défaut). */
  reglage?: Reglage;
}

/** Un mot : page, rectangle affiché, texte, clé de comparaison, ligne. */
export type Mot = [number, Rect, string, string, string];

export interface Difference {
  type: Type;
  marquesA: [number, Rect][];
  marquesB: [number, Rect][];
  ancien: string;
  nouveau: string;
  detail?: string;
  niveauPage?: boolean;
  pageA: number | null;
  pageB: number | null;
  paire: number;
  /** Mots d'origine, gardés jusqu'à la fin du calcul. */
  brutA?: Mot[];
  brutB?: Mot[];
}

export interface Resultat {
  paires: [number | null, number | null][];
  differences: Difference[];
  notes: string[];
  pagesA: number;
  pagesB: number;
  texte: boolean;
  visuel: boolean;
  options: Options;
  /** Nom de chaque page de A et de B (couche de circuit imprimé, étiquette de page), ou "". */
  noms: [string[], string[]];
}

/** Nombre de différences par type, dans l'ordre de TYPES. */
export function decompte(elements: Difference[]): [Type, number][] {
  const c = new Map<Type, number>();
  for (const e of elements) c.set(e.type, (c.get(e.type) ?? 0) + 1);
  return (Object.keys(TYPES) as Type[]).filter((t) => c.has(t)).map((t) => [t, c.get(t)!]);
}

/** « 3 modifications, 1 ajout… » (vide s'il n'y a aucune différence). */
export function resume(elements: Difference[]): string {
  return decompte(elements).map(([t, n]) => `${n} ${n > 1 ? TYPES[t][2] : TYPES[t][1].toLowerCase()}`).join(", ");
}

/** Description d'une différence en une ligne. */
export function description(e: Difference): string {
  if (e.type === "modification") return `« ${e.ancien} » → « ${e.nouveau} »`;
  if (e.type === "ajout") return `« ${e.nouveau} »`;
  if (e.type === "suppression") return `« ${e.ancien} »`;
  return e.detail ?? "";
}

/** Nom d'un couple de pages : celui de la couche, commun ou « A / B » s'ils diffèrent, ou "". */
export function nomPaire([a, b]: [number | null, number | null], noms?: [string[], string[]]): string {
  const na = noms && a !== null ? noms[0][a] ?? "" : "";
  const nb = noms && b !== null ? noms[1][b] ?? "" : "";
  return na === nb || !nb ? na : !na ? nb : `${na} / ${nb}`;
}

/** Titre d'un couple de pages, précédé du nom de la couche quand il est connu (« B.Cu — Page 2 de A ↔ page 2 de B »). */
export function titrePaire(paire: [number | null, number | null], noms?: [string[], string[]]): string {
  const [a, b] = paire;
  const nom = nomPaire(paire, noms);
  const prefixe = nom ? `${nom} — ` : "";
  if (a === null) return `${prefixe}Page ${b! + 1} de B (sans équivalent dans A)`;
  if (b === null) return `${prefixe}Page ${a + 1} de A (sans équivalent dans B)`;
  return `${prefixe}Page ${a + 1} de A ↔ page ${b + 1} de B`;
}

/** Points PDF en millimètres, à la française : « 12,3 ». */
export function millimetres(points: number): string {
  return ((points * 25.4) / 72).toFixed(1).replace(".", ",").replace(/^-0,0$/, "0,0");
}

/** Description d'un changement visuel : sa taille et sa position, en mm depuis le coin haut gauche de la page. */
export function detailVisuel([x0, y0, x1, y1]: Rect): string {
  return `zone de ${millimetres(x1 - x0)} × ${millimetres(y1 - y0)} mm à x ${millimetres(x0)} mm, y ${millimetres(y0)} mm (image, dessin, couleur ou mise en page)`;
}
