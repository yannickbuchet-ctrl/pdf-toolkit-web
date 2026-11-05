/**
 * Portage de difflib.SequenceMatcher de Python (sans « autojunk », comme la version PC) : les opérations qui
 * transforment la suite a en la suite b. Les éléments sont comparés par égalité stricte (chaînes ou nombres).
 */
export type Etiquette = "equal" | "replace" | "delete" | "insert";
export type Operation = [Etiquette, number, number, number, number];

export function operations<T extends string | number>(a: T[], b: T[]): Operation[] {
  const b2j = new Map<T, number[]>();
  b.forEach((x, j) => {
    const l = b2j.get(x);
    if (l) l.push(j);
    else b2j.set(x, [j]);
  });

  /** Le plus long bloc commun de a[alo:ahi] et b[blo:bhi] (find_longest_match, sans éléments ignorés). */
  const plusLong = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let meilleurI = alo, meilleurJ = blo, taille = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const nouveau = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        nouveau.set(j, k);
        if (k > taille) {
          meilleurI = i - k + 1;
          meilleurJ = j - k + 1;
          taille = k;
        }
      }
      j2len = nouveau;
    }
    return [meilleurI, meilleurJ, taille];
  };

  // get_matching_blocks, sans récursion (une pile) pour les longs documents.
  const blocs: [number, number, number][] = [];
  const pile: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (pile.length) {
    const [alo, ahi, blo, bhi] = pile.pop()!;
    const [i, j, k] = plusLong(alo, ahi, blo, bhi);
    if (k) {
      blocs.push([i, j, k]);
      if (alo < i && blo < j) pile.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) pile.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  // Réunit les blocs adjacents.
  const fusionnes: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of blocs) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else {
      if (k1) fusionnes.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) fusionnes.push([i1, j1, k1]);
  fusionnes.push([a.length, b.length, 0]);

  const ops: Operation[] = [];
  let i = 0, j = 0;
  for (const [ai, bj, taille] of fusionnes) {
    const etiquette: Etiquette | "" = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : "";
    if (etiquette) ops.push([etiquette, i, ai, j, bj]);
    i = ai + taille;
    j = bj + taille;
    if (taille) ops.push(["equal", ai, i, bj, j]);
  }
  return ops;
}
