/**
 * Comparaison de deux PDF, portée de PDF Toolkit 2 sur PC (align_pages, text_differences, reconcile_rewritten,
 * visual_differences, compare_documents) : texte mot à mot sur l'ensemble du document, pages appariées à la manière
 * d'un diff (une page ajoutée ne décale pas la suite), puis comparaison visuelle des pages appariées.
 */
import * as mupdf from "mupdf";
import { operations } from "./difflib";
import { type Difference, type Mot, type Options, type Rect, type Resultat, type Type } from "./comparaisonTextes";

export * from "./comparaisonTextes";

const DPI = 72; // résolution du rendu comparé pixel par pixel
const CELLULE = 4; // pixels : grain des zones de différence visuelle (4 px à 72 ppp ≈ 1,4 mm)
const ECART = 2; // cellules : deux différences plus proches que cela forment une seule zone
const LIGNES_JOINTES = 3; // lignes identiques au plus entre deux blocs modifiés comparés ensemble, mot à mot
const ZONES_MAX = 25; // au-delà, les zones d'une page sont réunies en une seule
const SIMILITUDE_TEXTE = 0.25; // part des mots retrouvés à l'identique pour apparier deux pages
const SIMILITUDE_IMAGE = 0.6; // ressemblance des vignettes pour apparier deux pages sans texte
const BANDE = 30; // écart (en pages) cherché autour de la diagonale pour apparier les pages
const VIGNETTE: [number, number] = [24, 34];
const PART_NOUVELLE = 0.9; // part de mots nouveaux au-delà de laquelle une page sans équivalent est « ajoutée »
const EXTRAIT = 80;
const MOTS_MAX = 2e7; // au-delà de ce produit des nombres de mots, un bloc n'est pas comparé mot à mot

const union = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const intersection = (a: Rect, b: Rect): Rect => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

/** Forme d'un mot utilisée pour la comparaison (vide : mot ignoré). */
export function cleDuMot(texte: string, casse: boolean, ponctuation: boolean): string {
  texte = ponctuation ? texte.replace(/[^\p{L}\p{N}]+/gu, "") : texte.replace(/\s+/g, "");
  return casse ? texte.toLocaleLowerCase("fr") : texte;
}

/**
 * Mots de la page dans l'ordre du contenu du fichier, le plus stable d'une version à l'autre (un tri par position
 * mélangerait les colonnes) ; un texte réécrit ailleurs dans le contenu est rapproché ensuite par sa position.
 */
export function motsDePage(page: mupdf.Page, casse = false, ponctuation = false): [Rect, string, string, string][] {
  const mots: [Rect, string, string, string][] = [];
  const st = page.toStructuredText("preserve-whitespace");
  const [px0, py0, px1, py1] = page.getBounds();
  let bloc = -1, ligne = 0;
  let courant = "";
  let rect: Rect | null = null;
  const clore = () => {
    if (courant && rect) {
      // Seuls les mots visibles dans la page comptent (TEXT_MEDIABOX_CLIP sur PC).
      const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
      const cle = cleDuMot(courant, casse, ponctuation);
      if (cle && cx >= px0 && cx <= px1 && cy >= py0 && cy <= py1) mots.push([rect, courant, cle, `${bloc}:${ligne}`]);
    }
    courant = "";
    rect = null;
  };
  try {
    st.walk({
      beginTextBlock() {
        bloc++;
        ligne = -1;
      },
      beginLine() {
        clore();
        ligne++;
      },
      onChar(c, _o, _f, _t, q) {
        if (/\s/.test(c)) {
          clore();
          return;
        }
        const r: Rect = [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]), Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];
        courant += c;
        rect = rect ? union(rect, r) : r;
      },
      endLine() {
        clore();
      },
    });
  } finally {
    st.destroy();
  }
  return mots;
}

/**
 * Les mots de mots présents tels quels au même endroit dans autres (à tolerance points près) : ils n'ont ni changé ni
 * bougé, et la comparaison visuelle les compare donc à l'image.
 */
export function motsImmobiles<T extends [Rect, string, ...unknown[]]>(mots: T[], autres: T[], tolerance = 0.5): T[] {
  const places = new Map<string, Rect[]>();
  for (const [r, t] of autres) places.set(t, [...(places.get(t) ?? []), r]);
  return mots.filter(([w, t]) => (places.get(t) ?? []).some((r) =>
    Math.abs(w[0] - r[0]) <= tolerance && Math.abs(w[1] - r[1]) <= tolerance && Math.abs(w[2] - r[2]) <= tolerance && Math.abs(w[3] - r[3]) <= tolerance));
}

/** Vignette en niveaux de gris de taille fixe, pour apparier des pages sans texte. */
export function vignette(page: mupdf.Page): Uint8Array {
  const [l, h] = VIGNETTE;
  const [x0, y0, x1, y1] = page.getBounds();
  const pix = page.toPixmap([l / Math.max(1, x1 - x0), 0, 0, h / Math.max(1, y1 - y0), 0, 0], mupdf.ColorSpace.DeviceGray, false, false);
  const data = pix.getPixels();
  const sortie = new Uint8Array(l * h).fill(255);
  const w = Math.min(l, pix.getWidth());
  for (let y = 0; y < Math.min(h, pix.getHeight()); y++) {
    for (let x = 0; x < w; x++) sortie[y * l + x] = data[y * pix.getStride() + x];
  }
  return sortie;
}

/** Ressemblance de deux vignettes, de 0 à 1, rapportée à l'encre présente. */
export function similitudeVignettes(a: Uint8Array, b: Uint8Array): number {
  let encre = 0, diff = 0;
  for (let i = 0; i < a.length; i++) {
    encre += 255 - a[i] + (255 - b[i]);
    diff += Math.abs(a[i] - b[i]);
  }
  return encre === 0 ? 1 : Math.max(0, 1 - diff / encre);
}

/**
 * Apparie les pages des deux versions, à la manière d'un diff : une page insérée ou supprimée ne décale pas les
 * suivantes. Les pages restées seules entre deux couples sont ensuite associées dans l'ordre ; le surplus seul est
 * déclaré ajouté ou supprimé.
 */
export function apparierPages(n: number, m: number, similitude: (i: number, j: number) => [number, number]): [number | null, number | null][] {
  const bande = BANDE + Math.abs(n - m);
  let precedente = new Float64Array(m + 1);
  const choix: Uint8Array[] = [];
  for (let i = 1; i <= n; i++) {
    const centre = ((i - 1) * m) / Math.max(1, n);
    const bas = Math.max(1, Math.floor(centre - bande)), haut = Math.min(m, Math.floor(centre + bande) + 1);
    const ligne = new Float64Array(m + 1);
    const c = new Uint8Array(m + 1);
    for (let j = 1; j <= m; j++) {
      let meilleur = precedente[j], k = 1;
      if (ligne[j - 1] > meilleur) {
        meilleur = ligne[j - 1];
        k = 2;
      }
      if (j >= bas && j <= haut) {
        const [score, seuil] = similitude(i - 1, j - 1);
        if (score >= seuil && precedente[j - 1] + score >= meilleur) {
          meilleur = precedente[j - 1] + score;
          k = 0;
        }
      }
      ligne[j] = meilleur;
      c[j] = k;
    }
    choix.push(c);
    precedente = ligne;
  }
  const chemin: [number | null, number | null][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const k = i > 0 && j > 0 ? choix[i - 1][j] : i > 0 ? 1 : 2;
    if (k === 0) {
      chemin.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (k === 1) {
      chemin.push([i - 1, null]);
      i--;
    } else {
      chemin.push([null, j - 1]);
      j--;
    }
  }
  chemin.reverse();
  const paires: [number | null, number | null][] = [];
  let seulesA: number[] = [], seulesB: number[] = [];
  const vider = () => {
    for (let k = 0; k < Math.min(seulesA.length, seulesB.length); k++) paires.push([seulesA[k], seulesB[k]]);
    for (const a of seulesA.slice(seulesB.length)) paires.push([a, null]);
    for (const b of seulesB.slice(seulesA.length)) paires.push([null, b]);
    seulesA = [];
    seulesB = [];
  };
  for (const [a, b] of chemin) {
    if (a === null) seulesB.push(b!);
    else if (b === null) seulesA.push(a);
    else {
      vider();
      paires.push([a, b]);
    }
  }
  vider();
  return paires;
}

/** Rectangles de mots consécutifs, réunis ligne par ligne. */
function rectsDesMots(mots: Mot[]): [number, Rect][] {
  const marques: [number, Rect][] = [];
  let dernier: string | null = null;
  for (const [page, rect, , , ligne] of mots) {
    const cle = `${page}/${ligne}`;
    if (dernier === cle) marques[marques.length - 1][1] = union(marques[marques.length - 1][1], rect);
    else marques.push([page, [...rect] as Rect]);
    dernier = cle;
  }
  return marques;
}

const CHANGEMENTS = { replace: "modification", delete: "suppression", insert: "ajout" } as const;

function extrait(textes: string[]): string {
  const t = textes.join(" ");
  return t.length <= EXTRAIT ? t : t.slice(0, EXTRAIT - 1).trimEnd() + "…";
}

function element(type: Type, ancien: Mot[], nouveau: Mot[]): Difference {
  return {
    type, marquesA: rectsDesMots(ancien), marquesB: rectsDesMots(nouveau),
    ancien: extrait(ancien.map((w) => w[2])), nouveau: extrait(nouveau.map((w) => w[2])), brutA: ancien, brutB: nouveau,
    pageA: null, pageB: null, paire: 0,
  };
}

function changementsMots(ancien: Mot[], nouveau: Mot[]): Difference[] {
  return operations(ancien.map((w) => w[3]), nouveau.map((w) => w[3]))
    .filter(([t]) => t !== "equal")
    .map(([t, a1, a2, b1, b2]) => element(CHANGEMENTS[t as keyof typeof CHANGEMENTS], ancien.slice(a1, a2), nouveau.slice(b1, b2)));
}

/**
 * Différences de texte entre deux documents. Les lignes sont comparées d'abord (rapide, et insensible au décalage d'un
 * paragraphe inséré), puis les mots des seuls blocs de lignes qui diffèrent. Renvoie aussi le nombre de mots
 * identiques par couple de pages, qui sert à apparier les pages.
 */
export function differencesTexte(pagesA: [Rect, string, string, string][][], pagesB: [Rect, string, string, string][][],
  progression: (f: number) => void = () => {}): { elements: Difference[]; communs: Map<string, number> } {
  const suite = (pages: [Rect, string, string, string][][]): Mot[] =>
    pages.flatMap((liste, page) => liste.map(([r, t, k, l]) => [page, r, t, k, l] as Mot));
  const motsA = suite(pagesA), motsB = suite(pagesB);
  const lignes = (mots: Mot[]) => {
    const r: [number, number][] = [];
    let debut = 0;
    for (let i = 1; i <= mots.length; i++) {
      if (i === mots.length || mots[i][0] !== mots[debut][0] || mots[i][4] !== mots[debut][4]) {
        r.push([debut, i]);
        debut = i;
      }
    }
    return r;
  };
  const lignesA = lignes(motsA), lignesB = lignes(motsB);
  const cles = (mots: Mot[], ls: [number, number][]) => ls.map(([s, e]) => mots.slice(s, e).map((w) => w[3]).join(" "));
  const ops = operations(cles(motsA, lignesA), cles(motsB, lignesB));

  // Deux blocs séparés par quelques lignes identiques sont comparés ensemble.
  const segments: [string, number, number, number, number][] = [];
  for (const [t, i1, i2, j1, j2] of ops) {
    if (t === "equal") segments.push(["equal", i1, i2, j1, j2]);
    else if (segments.length >= 2 && segments[segments.length - 2][0] === "block" &&
      segments[segments.length - 1][2] - segments[segments.length - 1][1] <= LIGNES_JOINTES) {
      segments.pop();
      segments[segments.length - 1][2] = i2;
      segments[segments.length - 1][4] = j2;
    } else segments.push(["block", i1, i2, j1, j2]);
  }

  const communs = new Map<string, number>();
  const ajouter = (a: number, b: number, n: number) => communs.set(`${a},${b}`, (communs.get(`${a},${b}`) ?? 0) + n);
  const elements: Difference[] = [];
  const blocs = segments.filter((x) => x[0] === "block").length;
  let fait = 0;
  for (const [genre, i1, i2, j1, j2] of segments) {
    if (genre === "equal") {
      for (let k = 0; k < i2 - i1; k++) {
        const [sa, ea] = lignesA[i1 + k];
        ajouter(motsA[sa][0], motsB[lignesB[j1 + k][0]][0], ea - sa);
      }
      continue;
    }
    const partA = i2 > i1 ? motsA.slice(lignesA[i1][0], lignesA[i2 - 1][1]) : [];
    const partB = j2 > j1 ? motsB.slice(lignesB[j1][0], lignesB[j2 - 1][1]) : [];
    fait++;
    progression(fait / Math.max(1, blocs));
    if (partA.length * partB.length > MOTS_MAX) {
      // Bloc immense (documents sans rapport) : la comparaison mot à mot prendrait des minutes et ne dirait rien de
      // plus. Tout le texte du bloc est déclaré supprimé d'un côté et ajouté de l'autre, page par page.
      const parPage = (mots: Mot[]) => [...new Set(mots.map((w) => w[0]))].map((p) => mots.filter((w) => w[0] === p));
      for (const m of parPage(partA)) elements.push(element("suppression", m, []));
      for (const m of parPage(partB)) elements.push(element("ajout", [], m));
      continue;
    }
    for (const [t, a1, a2, b1, b2] of operations(partA.map((w) => w[3]), partB.map((w) => w[3]))) {
      if (t === "equal") {
        for (let k = 0; k < a2 - a1; k++) ajouter(partA[a1 + k][0], partB[b1 + k][0], 1);
        continue;
      }
      elements.push(element(CHANGEMENTS[t], partA.slice(a1, a2), partB.slice(b1, b2)));
    }
  }
  return { elements, communs };
}

function chevauchent(a: Rect[], b: Rect[]): boolean {
  for (const ra of a) {
    for (const rb of b) {
      const hauteur = Math.min(ra[3] - ra[1], rb[3] - rb[1]);
      const vertical = Math.min(ra[3], rb[3]) - Math.max(ra[1], rb[1]);
      if (hauteur > 0 && vertical >= hauteur / 2 && Math.min(ra[2], rb[2]) > Math.max(ra[0], rb[0])) return true;
    }
  }
  return false;
}

/**
 * Rapproche une suppression et les ajouts écrits au même endroit d'une page appariée : un éditeur de PDF qui modifie
 * un mot l'efface et réécrit la ligne à la fin du contenu de la page. Superposés, ils sont comparés mot à mot.
 */
export function rapprocherReecritures(elements: Difference[], paires: [number | null, number | null][]): Difference[] {
  const appariees = new Set(paires.filter(([a, b]) => a !== null && b !== null).map(([a, b]) => `${a},${b}`));
  const ajouts = elements.filter((e) => e.type === "ajout");
  const retires = new Set<Difference>();
  const remplaces = new Map<Difference, Difference[]>();
  for (const suppression of elements.filter((e) => e.type === "suppression")) {
    const pages = new Set(suppression.marquesA.map(([p]) => p));
    if (pages.size !== 1) continue;
    const pageA = [...pages][0];
    const rectsA = suppression.marquesA.map(([, r]) => r);
    const groupe = ajouts.filter((a) => !retires.has(a) && a.marquesB.every(([p]) => appariees.has(`${pageA},${p}`)) &&
      chevauchent(rectsA, a.marquesB.map(([, r]) => r)));
    if (!groupe.length) continue;
    groupe.forEach((a) => retires.add(a));
    remplaces.set(suppression, changementsMots(suppression.brutA!, groupe.flatMap((a) => a.brutB!)));
  }
  return elements.filter((e) => !retires.has(e)).flatMap((e) => remplaces.get(e) ?? [e]);
}

/**
 * Zones (en points de la page affichée) où le rendu des deux pages diffère, cellule par cellule ; une cellule diffère
 * si l'écart d'une composante (rouge, vert ou bleu) d'un de ses pixels dépasse la tolérance. Les cellules couvertes
 * par masques (le texte, déjà comparé mot à mot) sont ignorées. Les cellules proches sont réunies en zones.
 */
export function differencesVisuelles(pageA: mupdf.Page, pageB: mupdf.Page, tolerance: number, masques: Rect[] = []): Rect[] {
  const echelle = DPI / 72;
  const m: mupdf.Matrix = [echelle, 0, 0, echelle, 0, 0];
  const pa = pageA.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
  const pb = pageB.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
  const largeur = Math.min(pa.getWidth(), pb.getWidth()), hauteur = Math.min(pa.getHeight(), pb.getHeight());
  const da = pa.getPixels(), db = pb.getPixels(), sa = pa.getStride(), sb = pb.getStride();
  const limite = Math.round(Math.max(0, Math.min(1, tolerance)) * 255);
  const colonnes = Math.ceil(largeur / CELLULE);
  const cle = (cx: number, cy: number) => cy * (colonnes + 4) + cx;
  const masque = new Set<number>();
  for (const r of masques) {
    for (let cy = Math.max(0, Math.floor((r[1] * echelle) / CELLULE) - 1); cy <= Math.floor((r[3] * echelle) / CELLULE) + 1; cy++) {
      for (let cx = Math.max(0, Math.floor((r[0] * echelle) / CELLULE) - 1); cx <= Math.floor((r[2] * echelle) / CELLULE) + 1; cx++) masque.add(cle(cx, cy));
    }
  }
  const marquees = new Set<number>();
  for (let y = 0; y < hauteur; y++) {
    const oa = y * sa, ob = y * sb;
    const cy = Math.floor(y / CELLULE);
    for (let x = 0; x < largeur; x++) {
      const pa3 = oa + x * 3, pb3 = ob + x * 3;
      if (Math.abs(da[pa3] - db[pb3]) > limite || Math.abs(da[pa3 + 1] - db[pb3 + 1]) > limite || Math.abs(da[pa3 + 2] - db[pb3 + 2]) > limite) {
        const k = cle(Math.floor(x / CELLULE), cy);
        if (!masque.has(k)) marquees.add(k);
      }
    }
  }
  let zones: Rect[] = [];
  const largeurCle = colonnes + 4;
  while (marquees.size) {
    const premier = marquees.values().next().value as number;
    marquees.delete(premier);
    const pile = [premier];
    let x0 = premier % largeurCle, x1 = x0, y0 = Math.floor(premier / largeurCle), y1 = y0;
    while (pile.length) {
      const k = pile.pop()!;
      const cx = k % largeurCle, cy = Math.floor(k / largeurCle);
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let dy = -ECART; dy <= ECART; dy++) {
        for (let dx = -ECART; dx <= ECART; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0) continue;
          const v = cle(nx, ny);
          if (marquees.has(v)) {
            marquees.delete(v);
            pile.push(v);
          }
        }
      }
    }
    zones.push([(x0 * CELLULE) / echelle, (y0 * CELLULE) / echelle, Math.min(largeur, (x1 + 1) * CELLULE) / echelle, Math.min(hauteur, (y1 + 1) * CELLULE) / echelle]);
  }
  if (zones.length > ZONES_MAX) zones = [zones.reduce(union)];
  // Les coordonnées de rendu partent du coin de la page affichée.
  const [ox, oy] = pageA.getBounds();
  zones = zones.map((z) => [z[0] + ox, z[1] + oy, z[2] + ox, z[3] + oy]);
  return zones.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/**
 * Compare deux documents. progression(fraction, message) est appelée après chaque étape.
 */
export function comparer(docA: mupdf.Document, docB: mupdf.Document, options: Options,
  progression: (f: number, message: string) => void = () => {}): Resultat {
  const { mode, ignorerCasse, ignorerPonctuation } = options;
  const n = docA.countPages(), m = docB.countPages();
  const total = Math.max(1, n + m);
  const notes: string[] = [];

  // 1. Lecture des mots de chaque page (30 %).
  const infos: { mots: [Rect, string, string, string][]; vignette: Uint8Array | null; rect: Rect }[][] = [[], []];
  [docA, docB].forEach((doc, cote) => {
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      infos[cote].push({ mots: motsDePage(page, ignorerCasse, ignorerPonctuation), vignette: null, rect: page.getBounds() as Rect });
      progression((0.3 * (i + 1 + (cote ? n : 0))) / total, `Lecture de la version ${"AB"[cote]} : page ${i + 1} / ${doc.countPages()}`);
    }
  });
  const [infosA, infosB] = infos;
  const texteA = infosA.some((x) => x.mots.length), texteB = infosB.some((x) => x.mots.length);
  const avecTexte = texteA && texteB;
  for (const [nom, a, nb] of [["A", texteA, n], ["B", texteB, m]] as const) {
    if (!a && nb) notes.push(`La version ${nom} ne contient pas de texte (PDF scanné ou image) : seule la comparaison visuelle est possible.`);
  }
  const modeTexte = (mode === "both" || mode === "text") && avecTexte;
  const modeVisuel = mode === "both" || mode === "visual" || (mode === "text" && !avecTexte);
  if (mode === "text" && !avecTexte) notes.push("Comparaison du texte impossible : la comparaison visuelle a été faite à la place.");

  // 2. Texte, mot à mot, sur l'ensemble du document (fait aussi en mode visuel seul : il sert à apparier les pages).
  let elements: Difference[] = [];
  let communs = new Map<string, number>();
  if (avecTexte) {
    progression(0.35, "Comparaison du texte…");
    ({ elements, communs } = differencesTexte(infosA.map((x) => x.mots), infosB.map((x) => x.mots), (fr) => progression(0.3 + 0.25 * fr, "Comparaison du texte…")));
    if (!modeTexte) elements = [];
  }

  // Vignettes des pages sans texte, pour les apparier.
  const besoin: [number, number][] = [];
  infos.forEach((liste, cote) => liste.forEach((info, i) => {
    if (!avecTexte || !info.mots.length) besoin.push([cote, i]);
  }));
  besoin.forEach(([cote, i], k) => {
    infos[cote][i].vignette = vignette((cote ? docB : docA).loadPage(i));
    progression(0.55 + (0.05 * (k + 1)) / besoin.length, "Préparation des pages sans texte…");
  });

  // 3. Appariement des pages.
  const similitude = (i: number, j: number): [number, number] => {
    const a = infosA[i], b = infosB[j];
    if (avecTexte && (a.mots.length || b.mots.length)) {
      if (!(a.mots.length && b.mots.length)) return [0, 1];
      return [(communs.get(`${i},${j}`) ?? 0) / Math.max(a.mots.length, b.mots.length), SIMILITUDE_TEXTE];
    }
    return [similitudeVignettes(a.vignette!, b.vignette!), SIMILITUDE_IMAGE];
  };
  progression(0.6, "Appariement des pages…");
  const paires = apparierPages(n, m, similitude);
  const paireDeA = new Map<number, number>(), paireDeB = new Map<number, number>();
  paires.forEach(([a, b], k) => {
    if (a !== null) paireDeA.set(a, k);
    if (b !== null) paireDeB.set(b, k);
  });

  elements = rapprocherReecritures(elements, paires);

  // Pages sans équivalent : ajoutées ou supprimées si leur texte est surtout nouveau (ou absent), sinon simple
  // décalage de la mise en page.
  const changesA = new Map<number, number>(), changesB = new Map<number, number>();
  for (const e of elements) {
    for (const w of e.brutA ?? []) changesA.set(w[0], (changesA.get(w[0]) ?? 0) + 1);
    for (const w of e.brutB ?? []) changesB.set(w[0], (changesB.get(w[0]) ?? 0) + 1);
  }
  const entiereA = new Set<number>(), entiereB = new Set<number>();
  const elementsPage: Difference[] = [];
  for (const [a, b] of paires) {
    if (a !== null && b !== null) continue;
    const cote = b === null ? "a" : "b";
    const index = (cote === "a" ? a : b)!;
    const info = (cote === "a" ? infosA : infosB)[index];
    const changes = (cote === "a" ? changesA : changesB).get(index) ?? 0;
    const mots = info.mots.length;
    let type: Type, detail: string;
    if (!modeTexte || mots === 0 || changes >= PART_NOUVELLE * mots) {
      (cote === "a" ? entiereA : entiereB).add(index);
      type = cote === "a" ? "page_supprimee" : "page_ajoutee";
      detail = cote === "a" ? `Page ${index + 1} de A, absente de B` : `Page ${index + 1} de B, absente de A`;
    } else {
      type = "mise_en_page";
      detail = `Page ${index + 1} de ${cote === "a" ? "A" : "B"} sans équivalent dans ${cote === "a" ? "B" : "A"} : texte décalé d'une page à l'autre (contenu ajouté ou retiré plus haut)`;
    }
    elementsPage.push({
      type, marquesA: cote === "a" ? [[index, [...info.rect] as Rect]] : [], marquesB: cote === "b" ? [[index, [...info.rect] as Rect]] : [],
      ancien: "", nouveau: "", detail, niveauPage: true, pageA: null, pageB: null, paire: 0,
    });
  }
  if (entiereA.size || entiereB.size) {
    elements = elements.filter((e) => {
      e.marquesA = e.marquesA.filter(([p]) => !entiereA.has(p));
      e.marquesB = e.marquesB.filter(([p]) => !entiereB.has(p));
      return e.marquesA.length || e.marquesB.length;
    });
  }
  elements.push(...elementsPage);

  // 4. Comparaison visuelle des pages appariées (35 %).
  if (modeVisuel) {
    const comparees = paires.filter(([a, b]) => a !== null && b !== null) as [number, number][];
    comparees.forEach(([a, b], k) => {
      const pa = docA.loadPage(a), pb = docB.loadPage(b);
      const ra = pa.getBounds() as Rect, rb = pb.getBounds() as Rect;
      if (Math.abs(ra[2] - ra[0] - (rb[2] - rb[0])) > 1 || Math.abs(ra[3] - ra[1] - (rb[3] - rb[1])) > 1) {
        elements.push({
          type: "mise_en_page", marquesA: [[a, ra]], marquesB: [[b, rb]], ancien: "", nouveau: "", niveauPage: true,
          detail: `Format de page différent : ${Math.round(ra[2] - ra[0])} × ${Math.round(ra[3] - ra[1])} pt → ${Math.round(rb[2] - rb[0])} × ${Math.round(rb[3] - rb[1])} pt`,
          pageA: null, pageB: null, paire: 0,
        });
      }
      // Les mots changés ou déplacés sont déjà comparés mot à mot : ils sont masqués. Un mot identique resté exactement à
      // sa place, lui, reste comparé à l'image : un changement de couleur, de police, un surlignage ou un tampon posé
      // dessus doivent apparaître (unmoved_words sur PC).
      let masques: Rect[] = [];
      if (modeTexte) {
        const ma = infosA[a].mots, mb = infosB[b].mots;
        const restesA = new Set(motsImmobiles(ma, mb)), restesB = new Set(motsImmobiles(mb, ma));
        masques = [...ma.filter((w) => !restesA.has(w)).map((w) => w[0]), ...mb.filter((w) => !restesB.has(w)).map((w) => w[0])];
      }
      for (const zone of differencesVisuelles(pa, pb, options.tolerance, masques)) {
        elements.push({
          type: "visuel", marquesA: [[a, intersection(zone, ra)]], marquesB: [[b, intersection(zone, rb)]], ancien: "", nouveau: "",
          detail: "Aspect modifié : image, dessin, couleur, surlignage ou mise en page", pageA: null, pageB: null, paire: 0,
        });
      }
      progression(0.65 + (0.35 * (k + 1)) / Math.max(1, comparees.length), `Comparaison visuelle : page ${k + 1} / ${comparees.length}`);
    });
  }

  // Ordre de lecture : par couple de pages, puis de haut en bas.
  const ordre = new Map<Difference, [number, number, number, number]>();
  for (const e of elements) {
    delete e.brutA;
    delete e.brutB;
    e.pageA = e.marquesA.length ? e.marquesA[0][0] : null;
    e.pageB = e.marquesB.length ? e.marquesB[0][0] : null;
    e.paire = e.pageB !== null ? paireDeB.get(e.pageB)! : paireDeA.get(e.pageA!)!;
    const premier = (e.marquesB.length ? e.marquesB : e.marquesA)[0][1];
    ordre.set(e, [e.paire, e.niveauPage ? 0 : 1, premier[1], premier[0]]);
  }
  elements.sort((x, y) => {
    const a = ordre.get(x)!, b = ordre.get(y)!;
    for (let k = 0; k < 4; k++) if (a[k] !== b[k]) return a[k] - b[k];
    return 0;
  });
  progression(1, "Terminé.");
  return { paires, differences: elements, notes, pagesA: n, pagesB: m, texte: modeTexte, visuel: modeVisuel, options: { ...options } };
}

