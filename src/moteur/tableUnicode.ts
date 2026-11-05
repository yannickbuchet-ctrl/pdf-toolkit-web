/**
 * La table ToUnicode d'une police PDF, lue à l'envers : pour chaque caractère, le code qui le dessine. C'est ce qui
 * permet de réécrire avec la police d'origine elle-même, même réduite aux lettres utilisées (repris de TableUnicode.kt).
 */
export interface TableUnicode {
  codes: Map<number, number>;
  octets: number;
}

/** Le caractère d'un texte UTF-16BE en hexadécimal, s'il n'y en a qu'un. */
function unSeulCaractere(hex: string): number | null {
  if (!hex || hex.length % 4 !== 0) return null;
  const unites: number[] = [];
  for (let i = 0; i < hex.length; i += 4) unites.push(parseInt(hex.slice(i, i + 4), 16));
  const texte = String.fromCharCode(...unites);
  const cps = [...texte];
  return cps.length === 1 ? cps[0].codePointAt(0)! : null;
}

export function lireTableUnicode(cmap: string): TableUnicode {
  const codes = new Map<number, number>();
  let octets = 0;
  const noter = (code: number, longueurHex: number, unicodeHex: string) => {
    octets = Math.max(octets, Math.ceil(longueurHex / 2));
    const cp = unSeulCaractere(unicodeHex);
    if (cp === null) return;
    // Le plus petit code l'emporte : un même caractère peut avoir plusieurs glyphes.
    const ancien = codes.get(cp);
    if (ancien === undefined || code < ancien) codes.set(cp, code);
  };
  for (const bloc of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloc[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      noter(parseInt(m[1], 16), m[1].length, m[2]);
    }
  }
  for (const bloc of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloc[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g)) {
      const bas = parseInt(m[1], 16);
      const haut = parseInt(m[2], 16);
      const longueur = m[1].length;
      if (haut < bas || haut - bas > 0xffff) continue;
      if (m[4] !== undefined) {
        // Une liste : un texte par code.
        let i = 0;
        for (const d of m[4].matchAll(/<([0-9A-Fa-f]*)>/g)) {
          if (bas + i <= haut) noter(bas + i, longueur, d[1]);
          i++;
        }
      } else if (m[3]) {
        // Une plage : le dernier caractère du texte augmente avec le code.
        const base = unSeulCaractere(m[3]);
        if (base !== null) {
          for (let code = bas; code <= haut; code++) {
            const cp = base + (code - bas);
            if (cp <= 0xffff) noter(code, longueur, cp.toString(16).padStart(4, "0"));
          }
        }
      }
    }
  }
  return { codes, octets: Math.max(octets, 1) };
}

/** Codes 0x80 à 0x9F du codage WinAnsi (Windows-1252) ; les autres codes de 0x20 à 0xFF sont ceux de Latin-1. */
const WINANSI_80: (number | null)[] = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];
const WINANSI_INVERSE = new Map<number, number>();
WINANSI_80.forEach((cp, i) => {
  if (cp !== null) WINANSI_INVERSE.set(cp, 0x80 + i);
});

/** Le code WinAnsi d'un caractère (codage des polices latines courantes), ou null. */
export function winAnsi(cp: number): number | null {
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return WINANSI_INVERSE.get(cp) ?? null;
}

/** Le caractère d'un code WinAnsi. */
export function depuisWinAnsi(code: number): number | null {
  if (code >= 0x80 && code <= 0x9f) return WINANSI_80[code - 0x80];
  return code >= 0x20 ? code : null;
}

/** Le code StandardEncoding (polices standard sans codage déclaré), pour les lettres ASCII sans ambiguïté. */
export function codeStandard(cp: number): number | null {
  return cp >= 0x20 && cp <= 0x7e && cp !== 0x27 && cp !== 0x60 ? cp : null;
}
