/**
 * Reconnaissance de caractères (OCR), la partie sans MuPDF : mots lus par Tesseract regroupés en lignes, sens de
 * lecture d'une page, déroulé page par page, bilan et texte exporté. Comme dans PDF Toolkit 2 sur PC (ocr_document,
 * ocr_lines, ocr_common_words…), avec les mêmes réglages et les mêmes textes.
 *
 * Ce module ne dépend ni de MuPDF ni de Tesseract : l'interface le fait tourner avec le moteur PDF (Web Worker) et
 * Tesseract.js (son propre Web Worker), les tests avec MuPDF et Tesseract.js dans Node.
 *
 * Coordonnées : points de la page affichée (origine en haut à gauche, rotation du fichier comprise).
 */

export const OCR_PPP = 300; // résolution des pages lues : un texte de 8 points y reste net
export const OCR_PPP_SENS = 150; // rendu réduit, pour essayer vite les quatre sens d'une page qui se lit mal
export const OCR_PIXELS_MAX = 24_000_000; // au-delà (affiche, plan A1…), la résolution baisse pour ménager la mémoire
export const OCR_PPP_MIN = 100;
export const LANGUES_OCR: [string, string][] = [["fra", "Français"], ["eng", "Anglais"], ["fra+eng", "Français et anglais"]];
const NOMS_LANGUES: Record<string, string> = { fra: "du français", eng: "de l’anglais" }; // « les données du français »
const MOTS_A_L_ENDROIT = 3; // mots courants à partir desquels une page est tenue pour lue à l'endroit…
const PART_A_L_ENDROIT = 0.2; // … s'ils font au moins 20 % des mots (voir motsCourants)
export const AIDE_TEXTE_OCR = "Texte reconnu par l’OCR : invisible, posé sur l’image du scan pour la recherche et la copie. " +
  "Il ne se modifie pas : le texte réécrit s’afficherait par-dessus l’image.";

/**
 * Mots courants du français et de l'anglais : une page lue à l'endroit en contient beaucoup, une page lue à l'envers
 * ou de travers presque aucun (Tesseract y voit « sadinbo SOA » ou des lettres isolées).
 */
const MOTS_COURANTS = new Set(`
le la les de des du un une et en au aux ce ces cet cette il ils elle elles on nous vous je tu ne pas plus que qui
dont où est sont été être avoir ont fait par pour sur sous dans avec sans chez entre après avant mais ou donc car si
comme tout tous toute toutes son sa ses leur leurs notre nos votre vos mon ma mes se lui moins très bien aussi
the and of to in is it that for on with as was are be by this at from or an not but have has had they we you he she
his her their our your will would can there which who what when all any if no do into than then also more about
`.split(/\s+/).filter(Boolean));

/** Échec de la reconnaissance de texte, avec un message pour l'utilisateur. */
export class ErreurOcr extends Error {}

/** Un mot lu sur l'image, en pixels ; ligne numérote les lignes dans l'ordre de lecture de Tesseract. */
export interface MotLu {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  texte: string;
  ligne: number;
}

/** Une ligne du calque : hauteur et bas de la ligne, et ses mots [x0, x1, texte], en points de la page. */
export interface LigneOcr {
  hauteur: number;
  base: number;
  mots: [number, number, string][];
}

/** L'image d'une page à lire : PNG, et taille d'un pixel en points de la page (tournée de la rotation demandée). */
export interface ImageOcr {
  png: Uint8Array;
  facteur: number;
  ppp: number;
}

/** Ce que Tesseract.js renvoie (sortie « blocks »), réduit à ce qui sert ici. */
interface BoiteTesseract {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface PageTesseract {
  blocks: { paragraphs: { lines: { bbox: BoiteTesseract; words: { text: string; bbox: BoiteTesseract }[] }[] }[] }[] | null;
}

/**
 * Les mots d'une page lue par Tesseract.js. Chaque mot prend la hauteur de sa ligne (jambages compris) : le calque
 * couvre ainsi exactement la ligne de l'image. Le texte vertical (mot bien plus haut que large), qui ne vient que d'une
 * page lue de travers ou d'une mention dans la marge, est écarté.
 */
export function motsDeTesseract(page: PageTesseract): MotLu[] {
  const mots: MotLu[] = [];
  let ligne = -1;
  for (const bloc of page.blocks ?? []) {
    for (const paragraphe of bloc.paragraphs) {
      for (const l of paragraphe.lines) {
        ligne++;
        for (const m of l.words) {
          const b = m.bbox;
          const lettres = [...m.text.trim()].length;
          if (!lettres || (lettres >= 3 && b.y1 - b.y0 > 1.5 * (b.x1 - b.x0))) continue;
          mots.push({ x0: b.x0, y0: Math.min(l.bbox.y0, b.y0), x1: b.x1, y1: Math.max(l.bbox.y1, b.y1), texte: m.text.trim(), ligne });
        }
      }
    }
  }
  return mots;
}

const alphanumerique = /[\p{L}\p{N}]/u;

/**
 * Regroupe les mots lus en lignes, dans l'ordre de lecture, et écarte le bruit : traits de tableau lus « | », lignes
 * sans lettre ni chiffre (taches lues « . » ou « - »). facteur : taille d'un pixel en points (voir ImageOcr).
 */
export function lignesOcr(mots: MotLu[], facteur = 1): LigneOcr[] {
  const groupes = new Map<number, [number, number, number, number, string][]>();
  for (const m of mots) {
    const texte = m.texte.replace(/^[|¦]+|[|¦]+$/g, "");
    if (!texte.trim()) continue;
    if (!groupes.has(m.ligne)) groupes.set(m.ligne, []);
    groupes.get(m.ligne)!.push([m.x0 * facteur, m.y0 * facteur, m.x1 * facteur, m.y1 * facteur, texte]);
  }
  let lignes: LigneOcr[] = [];
  for (const groupe of groupes.values()) {
    if (!groupe.some((m) => alphanumerique.test(m[4]))) continue;
    groupe.sort((a, b) => a[0] - b[0]);
    const haut = Math.min(...groupe.map((m) => m[1])), bas = Math.max(...groupe.map((m) => m[3]));
    lignes.push({ hauteur: bas - haut, base: bas, mots: groupe.map((m) => [m[0], m[2], m[4]]) });
  }
  // Un trait de tableau collé à un mot étire parfois la ligne entière : une ligne plus de deux fois plus haute que la
  // ligne type de la page reprend sa hauteur, sous le même bas de ligne.
  if (lignes.length >= 3) {
    const usuelle = lignes.map((l) => l.hauteur).sort((a, b) => a - b)[Math.floor(lignes.length / 2)];
    lignes = lignes.map((l) => (l.hauteur > 2 * usuelle ? { ...l, hauteur: usuelle } : l));
  }
  return lignes;
}

/**
 * [nombre de mots courants, leur part parmi les mots d'au moins deux lettres] : mots courants du français ou de
 * l'anglais. Sur les pages d'essai, une page lue à l'endroit en compte de 25 à 40 % ; lue à l'envers ou de travers,
 * quelques-uns par hasard (« ne », « son »), 14 % au plus.
 */
export function motsCourants(lignes: LigneOcr[]): [number, number] {
  let courants = 0, total = 0;
  for (const l of lignes) {
    for (const [, , texte] of l.mots) {
      for (let partie of texte.toLocaleLowerCase("fr").split(/[’'-]/)) {
        partie = partie.replace(/^[.,;:!?«»“”"()[\]]+|[.,;:!?«»“”"()[\]]+$/g, "");
        if ([...partie].filter((c) => /\p{L}/u.test(c)).length >= 2) {
          total++;
          if (MOTS_COURANTS.has(partie)) courants++;
        }
      }
    }
  }
  return [courants, courants / Math.max(1, total)];
}

export const seLitBien = (score: [number, number]) => score[0] >= MOTS_A_L_ENDROIT && score[1] >= PART_A_L_ENDROIT;

/** Le texte lu, ligne par ligne, dans l'ordre de lecture. */
export function texteOcr(lignes: LigneOcr[]): string {
  return lignes.map((l) => l.mots.map((m) => m[2]).join(" ")).join("\n");
}

/* --- Déroulé ---------------------------------------------------------------------------------------------------- */

/** Le moteur PDF, vu de la reconnaissance : pages, images à lire, calques à poser. */
export interface MoteurOcr {
  aDuTexte(page: number): Promise<boolean>;
  /** L'image de la page affichée, tournée en plus de rotation degrés, à environ ppp points par pouce. */
  image(page: number, ppp: number, rotation: number): Promise<ImageOcr>;
  /** Pose le calque de la page, après l'avoir pivotée de rotation degrés. premiere : premier changement du document. */
  poser(page: number, lignes: LigneOcr[], rotation: number, premiere: boolean): Promise<void>;
}

/** Lit les mots d'une image (Tesseract), dans la langue choisie. progression : avancement de 0 à 1 de cette lecture. */
export type LecteurOcr = (image: ImageOcr, progression?: (fraction: number) => void) => Promise<MotLu[]>;

export interface BilanOcr {
  faites: number[];
  /** Pages qui avaient déjà du texte, laissées telles quelles. */
  ignorees: number[];
  /** Pages sans texte reconnu. */
  vides: number[];
  /** Pages redressées : page -> angle ajouté. */
  redressees: Record<number, number>;
  echecs: Record<number, string>;
  textes: Record<number, string>;
}

export const bilanVide = (): BilanOcr => ({ faites: [], ignorees: [], vides: [], redressees: {}, echecs: {}, textes: {} });

export interface OptionsOcr {
  /** Les pages qui ont déjà du texte sont laissées telles quelles ; sinon, un calque OCR existant est remplacé. */
  passerTexte: boolean;
  /** Une page qui se lit mal est essayée dans les quatre sens, et redressée si elle se lit mieux autrement. */
  redresser: boolean;
}

/**
 * Reconnaît le texte des pages (indices) et le pose en calque invisible sur chacune. suivi(avancement de 0 à 1,
 * message) est appelé au fil de la lecture. bilan est rempli au fur et à mesure : interrompue (arret() devient vrai,
 * et la lecture en cours échoue), la reconnaissance laisse un document cohérent, car chaque page n'est modifiée qu'à la
 * fin de sa lecture, d'un seul coup ; les pages déjà lues gardent leur texte. Renvoie true si elle est allée au bout.
 * Une ErreurOcr (données de langue absentes) arrête tout.
 */
export async function reconnaitre(moteur: MoteurOcr, lire: LecteurOcr, pages: number[], options: OptionsOcr,
  suivi: (fraction: number, message: string) => void, bilan: BilanOcr, arret: () => boolean = () => false): Promise<boolean> {
  const total = Math.max(1, pages.length);
  let premiere = true;
  const lignesDe = async (page: number, rotation: number, ppp: number, debut: number, part: number) => {
    const image = await moteur.image(page, ppp, rotation);
    return lignesOcr(await lire(image, (f) => suivi((debut + part * f) / total, "")), image.facteur);
  };
  for (const [k, index] of pages.entries()) {
    if (arret()) return false;
    const libelle = `Page ${index + 1} (${k + 1} sur ${pages.length})`;
    if (options.passerTexte && (await moteur.aDuTexte(index))) {
      bilan.ignorees.push(index);
      continue;
    }
    suivi(k / total, `${libelle} : lecture du texte…`);
    let rotation = 0;
    let lignes: LigneOcr[];
    try {
      lignes = await lignesDe(index, 0, OCR_PPP, k, options.redresser ? 0.4 : 1);
      if (options.redresser && !seLitBien(motsCourants(lignes))) {
        // Page qui se lit mal : essayée dans les quatre sens, à plus basse résolution. Un autre sens ne l'emporte que
        // s'il se lit bien, et nettement mieux.
        const scores = new Map<number, [number, number]>();
        for (const sens of [0, 90, 180, 270]) {
          suivi((k + 0.4 + sens / 900) / total, `${libelle} : recherche du sens de lecture…`);
          scores.set(sens, motsCourants(await lignesDe(index, sens, OCR_PPP_SENS, k + 0.4 + sens / 900, 0.1)));
        }
        const meilleur = [...scores.keys()].reduce((a, b) => (scores.get(b)![0] > scores.get(a)![0] ? b : a));
        if (meilleur && seLitBien(scores.get(meilleur)!) && scores.get(meilleur)![0] >= 2 * scores.get(0)![0] + 1) {
          suivi((k + 0.8) / total, `${libelle} : lecture dans le bon sens…`);
          lignes = await lignesDe(index, meilleur, OCR_PPP, k + 0.8, 0.2);
          rotation = meilleur;
        }
      }
    } catch (e) {
      if (arret()) return false;
      if (e instanceof ErreurOcr) throw e;
      bilan.echecs[index] = /memory|mémoire/i.test(String(e)) ? "mémoire insuffisante" : `page illisible (${e instanceof Error ? e.message : String(e)})`;
      continue;
    }
    if (arret()) return false;
    if (!lignes.length) {
      bilan.vides.push(index);
      continue;
    }
    try {
      await moteur.poser(index, lignes, rotation, premiere);
      premiere = false;
    } catch (e) {
      bilan.echecs[index] = `calque impossible à écrire (${e instanceof Error ? e.message : String(e)})`;
      continue;
    }
    if (rotation) bilan.redressees[index] = rotation;
    bilan.faites.push(index);
    bilan.textes[index] = texteOcr(lignes);
  }
  suivi(1, "");
  return true;
}

/* --- Saisie, bilan, texte exporté ------------------------------------------------------------------------------- */

/** « 1-3, 7 » -> [0, 1, 2, 6] (pages de 1 à nombre). Lève une erreur, avec un message, si la saisie est invalide. */
export function lirePlages(texte: string, nombre: number): number[] {
  const pages = new Set<number>();
  for (let partie of texte.replace(/;/g, ",").split(",")) {
    partie = partie.trim();
    if (!partie) continue;
    const bornes = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(partie);
    if (!bornes) throw new Error(`« ${partie} » n’est pas un numéro de page ni une plage (exemple : 1-3, 7).`);
    let premiere = Number(bornes[1]), derniere = Number(bornes[2] ?? bornes[1]);
    if (premiere > derniere) [premiere, derniere] = [derniere, premiere];
    if (premiere < 1 || derniere > nombre) throw new Error(`Le document a ${nombre} page${nombre > 1 ? "s" : ""} : « ${partie} » en sort.`);
    for (let p = premiere; p <= derniere; p++) pages.add(p - 1);
  }
  if (!pages.size) throw new Error("Indiquez les pages à lire (exemple : 1-3, 7).");
  return [...pages].sort((a, b) => a - b);
}

/** Le texte reconnu, page par page, pour le presse-papiers ou un fichier .txt. */
export function texteExporte(bilan: BilanOcr): string {
  return Object.keys(bilan.textes).map(Number).sort((a, b) => a - b).map((i) => `— Page ${i + 1} —\n${bilan.textes[i]}`).join("\n\n");
}

/** Bilan d'une reconnaissance, en une phrase ou deux. */
export function resumeOcr(bilan: BilanOcr, interrompue = false): string {
  const liste = (indices: number[]) => [...indices].sort((a, b) => a - b).map((i) => String(i + 1)).join(", ");
  const s = (n: number) => (n > 1 ? "s" : "");
  const faites = bilan.faites.length;
  const redressees = Object.keys(bilan.redressees).map(Number);
  const parties = [faites ? `Texte reconnu sur ${faites} page${s(faites)}` : "Aucun texte ajouté"];
  if (redressees.length) parties.push(`redressée${s(redressees.length)} : page${s(redressees.length)} ${liste(redressees)}`);
  const n = bilan.ignorees.length;
  if (n) parties.push(`déjà du texte, laissée${s(n)} telle${s(n)} : page${s(n)} ${liste(bilan.ignorees)}`);
  if (bilan.vides.length) parties.push(`aucun texte trouvé : page${s(bilan.vides.length)} ${liste(bilan.vides)}`);
  let message = parties[0] + (parties.length > 1 ? ` (${parties.slice(1).join(" ; ")})` : "") + ".";
  for (const i of Object.keys(bilan.echecs).map(Number).sort((a, b) => a - b)) message += ` Page ${i + 1} : ${bilan.echecs[i]}.`;
  if (interrompue) message = "Reconnaissance interrompue : les pages déjà lues gardent leur texte. " + message;
  return message;
}

/** Message des données de langue introuvables (fichier absent du site, ou hors connexion avant toute utilisation). */
export function messageLangueAbsente(codes: string[]): string {
  const noms = codes.map((c) => NOMS_LANGUES[c] ?? `de la langue « ${c} »`).join(" et ");
  return `Les données de reconnaissance ${noms} n’ont pas pu être chargées. Sans connexion, elles ne sont disponibles ` +
    "qu’après une première reconnaissance de texte faite en ligne. Reconnectez-vous, ou choisissez une autre langue.";
}
