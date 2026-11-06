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

export interface Options {
  mode: Mode;
  ignorerCasse: boolean;
  ignorerPonctuation: boolean;
  /** Tolérance de la comparaison visuelle, de 0 à 1. */
  tolerance: number;
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

export function titrePaire([a, b]: [number | null, number | null]): string {
  if (a === null) return `Page ${b! + 1} de B (sans équivalent dans A)`;
  if (b === null) return `Page ${a + 1} de A (sans équivalent dans B)`;
  return `Page ${a + 1} de A ↔ page ${b + 1} de B`;
}
