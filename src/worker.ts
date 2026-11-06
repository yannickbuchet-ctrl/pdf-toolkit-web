/**
 * Le moteur MuPDF, dans un Web Worker : tout le travail sur les PDF se fait ici, l'interface ne gèle jamais.
 * Les documents restent dans la mémoire du navigateur ; rien n'est envoyé nulle part.
 *
 * Protocole : le fil principal envoie { id, methode, args } ; le worker répond { id, ok, resultat } ou
 * { id, ok: false, erreur }, et peut envoyer { id, progression, message } pendant un long calcul.
 */
import * as mupdf from "mupdf";
import {
  copie, deplacer, enregistrer, extraire, fusionner, imprimeTailleReelle, insererDocuments, insererPageBlanche, metadonnees,
  MotDePasseRequis, ouvrir, ouvrirPdf, pivoter, reordonner, supprimerPages, taillesDesPages, type Compression,
} from "./moteur/document";
import {
  ajouterDessin, ajouterForme, ajouterNote, annoterTexte, annotations, champs, chercher, insererImage, remplacerDans, remplir, rendre,
  selectionTexte, supprimerAnnotation, type Couleur, type Occurrence, type Point,
} from "./moteur/pages";
import { ajouterTexte, ErreurPdf, modifierTexte, policesLocales, segmentsDePage, type Edition } from "./moteur/texte";
import { policesDuDocument } from "./moteur/infoPolices";
import { normaliser } from "./moteur/polices";
import { estPlanche, lirePlanche, planchePdf } from "./moteur/photo";
import { comparer, type Options, type Resultat } from "./moteur/comparaison";
import { rapportComparaison } from "./moteur/rapport";
import { APPLICATION } from "./version";

mupdf.setLog(null);

const portee = self as unknown as Worker;

/* --- État ------------------------------------------------------------------------------------------------------- */

interface Ouvert {
  doc: mupdf.PDFDocument;
  nom: string;
  /** Mot de passe appliqué à l'enregistrement (null : fichier non protégé). */
  motDePasse: string | null;
}

let principal: Ouvert | null = null;
const comparaison: { a: Ouvert | null; b: Ouvert | null; resultat: Resultat | null } = { a: null, b: null, resultat: null };

/** Annuler et rétablir : copies complètes du document (push_undo sur PC), dans une limite de mémoire. */
const MEMOIRE_ANNULATION = 400 * 1024 * 1024;
const ANNULATIONS_MAX = 50;
interface Etat {
  libelle: string;
  octets: Uint8Array;
  motDePasse: string | null;
}
let pileAnnuler: Etat[] = [];
let pileRetablir: Etat[] = [];

function doc(): mupdf.PDFDocument {
  if (!principal) throw new Error("Aucun document ouvert.");
  return principal.doc;
}

function limiterMemoire() {
  let total = pileAnnuler.reduce((s, e) => s + e.octets.length, 0) + pileRetablir.reduce((s, e) => s + e.octets.length, 0);
  while (pileAnnuler.length > ANNULATIONS_MAX || (total > MEMOIRE_ANNULATION && pileAnnuler.length > 1)) {
    total -= pileAnnuler.shift()!.octets.length;
  }
}

/** Mémorise l'état du document avant une opération, pour pouvoir l'annuler. */
function memoriser(libelle: string) {
  pileAnnuler.push({ libelle, octets: copie(doc()), motDePasse: principal!.motDePasse });
  pileRetablir = [];
  limiterMemoire();
}

function restaurer(etat: Etat) {
  principal!.doc.destroy();
  principal!.doc = ouvrirPdf(etat.octets);
  principal!.motDePasse = etat.motDePasse;
}

/** Exécute une opération annulable ; en cas d'erreur, le document d'avant est rétabli. */
function operation<T>(libelle: string, f: () => T): T {
  memoriser(libelle);
  try {
    return f();
  } catch (e) {
    restaurer(pileAnnuler.pop()!);
    throw e;
  }
}

function etat() {
  if (!principal) return null;
  const d = principal.doc;
  return {
    nom: principal.nom,
    pages: taillesDesPages(d),
    motDePasse: principal.motDePasse !== null,
    annuler: pileAnnuler.at(-1)?.libelle ?? null,
    retablir: pileRetablir.at(-1)?.libelle ?? null,
    tailleReelle: imprimeTailleReelle(d),
    planche: estPlanche(d, imprimeTailleReelle(d)),
    metadonnees: metadonnees(d),
  };
}
export type EtatDocument = NonNullable<ReturnType<typeof etat>>;

function ouvrirSource(octets: Uint8Array, motDePasse?: string): { doc: mupdf.PDFDocument; motDePasse: string | null; restrictions: boolean } {
  return ouvrir(octets, motDePasse);
}

/* --- Méthodes ----------------------------------------------------------------------------------------------------- */

type Progression = (fraction: number, message: string) => void;

const methodes = {
  ouvrir(a: { octets: Uint8Array; nom: string; motDePasse?: string }) {
    const o = ouvrirSource(a.octets, a.motDePasse);
    principal?.doc.destroy();
    principal = { doc: o.doc, nom: a.nom, motDePasse: o.motDePasse };
    pileAnnuler = [];
    pileRetablir = [];
    return { etat: etat()!, restrictions: o.restrictions };
  },

  /** Remplace le document ouvert par un PDF produit par l'application (fusion, planche) ; annulable s'il y en avait un. */
  remplacer(a: { octets: Uint8Array; nom: string; libelle: string }) {
    if (principal) memoriser(a.libelle);
    const d = ouvrirPdf(a.octets);
    if (principal) {
      principal.doc.destroy();
      principal.doc = d;
      principal.nom = a.nom;
      principal.motDePasse = null;
    } else {
      principal = { doc: d, nom: a.nom, motDePasse: null };
    }
    return etat()!;
  },

  fermer() {
    principal?.doc.destroy();
    principal = null;
    pileAnnuler = [];
    pileRetablir = [];
    return null;
  },

  etat() {
    return etat();
  },

  rendre(a: { page: number; echelle: number; cote?: "a" | "b" }) {
    const d = a.cote ? comparaison[a.cote]?.doc : doc();
    if (!d) throw new Error("Document absent.");
    return rendre(d.loadPage(a.page), a.echelle);
  },

  segments(a: { page: number }) {
    return segmentsDePage(doc().loadPage(a.page));
  },

  modifierTexte(a: { page: number; editions: Edition[] }) {
    return operation("modification du texte", () => modifierTexte(doc(), a.page, a.editions));
  },

  ajouterTexte(a: { page: number; x: number; y: number; texte: string; taille: number; couleur: number; police: string; gras: boolean; italique: boolean }) {
    operation("ajout de texte", () => ajouterTexte(doc(), a.page, a.x, a.y, a.texte, a.taille, a.couleur, a.police, a.gras, a.italique));
    return etat();
  },

  chercher(a: { aiguille: string; casse: boolean; accents: boolean }) {
    return chercher(doc(), a.aiguille, a.casse, a.accents);
  },

  /** Remplace des occurrences : tous les morceaux d'une page sont réécrits ensemble. */
  remplacer_occurrences(a: { occurrences: Occurrence[]; remplacement: string }) {
    return operation(a.occurrences.length > 1 ? "tout remplacer" : "remplacement", () => {
      const parPage = new Map<number, Map<string, { o: Occurrence; plages: [number, number][] }>>();
      for (const o of a.occurrences) {
        const cle = `${o.segment.texte}|${o.segment.origineX}|${o.segment.origineY}`;
        if (!parPage.has(o.page)) parPage.set(o.page, new Map());
        const m = parPage.get(o.page)!;
        if (!m.has(cle)) m.set(cle, { o, plages: [] });
        m.get(cle)!.plages.push([o.debut, o.fin]);
      }
      const bilans = [];
      for (const [page, morceaux] of parPage) {
        const editions = [...morceaux.values()].map(({ o, plages }) => ({ cible: o.segment, texte: remplacerDans(o.segment.texte, plages, a.remplacement) }));
        bilans.push(...modifierTexte(doc(), page, editions));
      }
      return bilans;
    });
  },

  champs(a: { page: number }) {
    return champs(doc().loadPage(a.page));
  },

  remplir(a: { page: number; index: number; valeur: string }) {
    operation("remplissage du formulaire", () => remplir(doc().loadPage(a.page), a.index, a.valeur));
    return null;
  },

  annotations(a: { page: number }) {
    return annotations(doc().loadPage(a.page));
  },

  supprimerAnnotation(a: { page: number; index: number }) {
    operation("suppression d’une annotation", () => supprimerAnnotation(doc().loadPage(a.page), a.index));
    return null;
  },

  selection(a: { page: number; a: Point; b: Point }) {
    return selectionTexte(doc().loadPage(a.page), a.a, a.b);
  },

  annoterTexte(a: { page: number; type: "Highlight" | "Underline" | "StrikeOut"; a: Point; b: Point; couleur: Couleur }) {
    const quads = selectionTexte(doc().loadPage(a.page), a.a, a.b);
    if (!quads.length) return false;
    operation("annotation du texte", () => annoterTexte(doc().loadPage(a.page), a.type, quads, a.couleur, APPLICATION));
    return true;
  },

  ajouterNote(a: { page: number; point: Point; texte: string; couleur: Couleur }) {
    operation("ajout d’une note", () => ajouterNote(doc().loadPage(a.page), a.point, a.texte, a.couleur, APPLICATION));
    return null;
  },

  ajouterDessin(a: { page: number; traits: Point[][]; couleur: Couleur; epaisseur: number }) {
    operation("dessin", () => ajouterDessin(doc().loadPage(a.page), a.traits, a.couleur, a.epaisseur, APPLICATION));
    return null;
  },

  ajouterForme(a: { page: number; type: "Square" | "Circle"; rect: [number, number, number, number]; couleur: Couleur; epaisseur: number }) {
    operation("ajout d’une forme", () => ajouterForme(doc().loadPage(a.page), a.type, a.rect, a.couleur, a.epaisseur, APPLICATION));
    return null;
  },

  insererImage(a: { page: number; octets: Uint8Array; rect: [number, number, number, number]; signature: boolean }) {
    operation(a.signature ? "signature" : "insertion d’une image", () => insererImage(doc(), a.page, a.octets, a.rect));
    return null;
  },

  pivoter(a: { pages: number[]; angle: number }) {
    operation("rotation", () => pivoter(doc(), a.pages, a.angle));
    return etat();
  },

  supprimer(a: { pages: number[] }) {
    operation(a.pages.length > 1 ? "suppression de pages" : "suppression d’une page", () => supprimerPages(doc(), a.pages));
    return etat();
  },

  deplacer(a: { pages: number[]; avant: number }) {
    operation("déplacement de pages", () => deplacer(doc(), a.pages, a.avant));
    return etat();
  },

  reordonner(a: { ordre: number[] }) {
    operation("nouvel ordre des pages", () => reordonner(doc(), a.ordre));
    return etat();
  },

  extraire(a: { pages: number[] }) {
    return extraire(doc(), a.pages);
  },

  insererPdf(a: { fichiers: { octets: Uint8Array; motDePasse?: string }[]; position: number }) {
    const sources = a.fichiers.map((f) => ouvrirSource(f.octets, f.motDePasse).doc);
    try {
      operation("insertion de pages", () => insererDocuments(doc(), sources, a.position));
    } finally {
      sources.forEach((s) => s.destroy());
    }
    return etat();
  },

  insererPageBlanche(a: { position: number; largeur: number; hauteur: number }) {
    operation("insertion d’une page blanche", () => insererPageBlanche(doc(), a.position, a.largeur, a.hauteur));
    return etat();
  },

  /** Vérifie qu'un fichier s'ouvre (et avec quel mot de passe), et compte ses pages. */
  examiner(a: { octets: Uint8Array; motDePasse?: string }) {
    const o = ouvrirSource(a.octets, a.motDePasse);
    try {
      return { pages: o.doc.countPages() };
    } finally {
      o.doc.destroy();
    }
  },

  /** Concatène des PDF ; « principal » désigne le document ouvert, avec ses modifications. */
  fusionner(a: { fichiers: ({ octets: Uint8Array; motDePasse?: string } | "principal")[] }) {
    const sources: mupdf.PDFDocument[] = [];
    const aFermer: mupdf.PDFDocument[] = [];
    try {
      for (const f of a.fichiers) {
        if (f === "principal") sources.push(doc());
        else {
          const d = ouvrirSource(f.octets, f.motDePasse).doc;
          sources.push(d);
          aFermer.push(d);
        }
      }
      const resultat = fusionner(sources);
      try {
        return enregistrer(resultat, { compression: "aucune", motDePasse: null }).octets;
      } finally {
        resultat.destroy();
      }
    } finally {
      aFermer.forEach((d) => d.destroy());
    }
  },

  /** Le mot de passe appliqué à l'enregistrement (null : retirer la protection). Annulable. */
  definirMotDePasse(a: { motDePasse: string | null }) {
    if (a.motDePasse && a.motDePasse.includes(",")) throw new Error("Le mot de passe ne peut pas contenir de virgule.");
    memoriser(a.motDePasse ? "protection par mot de passe" : "retrait du mot de passe");
    principal!.motDePasse = a.motDePasse;
    return etat();
  },

  enregistrer(a: { compression: Compression }) {
    const d = doc();
    const r = enregistrer(d, { compression: a.compression, motDePasse: principal!.motDePasse });
    const avant = a.compression === "aucune" ? null : enregistrer(d, { compression: "aucune", motDePasse: principal!.motDePasse }).octets.length;
    return { octets: r.octets, images: r.images, avant };
  },

  annuler() {
    const e = pileAnnuler.pop();
    if (!e) return etat();
    pileRetablir.push({ libelle: e.libelle, octets: copie(doc()), motDePasse: principal!.motDePasse });
    restaurer(e);
    return { ...etat()!, fait: e.libelle };
  },

  retablir() {
    const e = pileRetablir.pop();
    if (!e) return etat();
    pileAnnuler.push({ libelle: e.libelle, octets: copie(doc()), motDePasse: principal!.motDePasse });
    restaurer(e);
    return { ...etat()!, fait: e.libelle };
  },

  polices() {
    return policesDuDocument(doc());
  },

  /** Une police installée sur l'ordinateur, lue avec l'autorisation de l'utilisateur (Chrome, Edge). */
  ajouterPoliceLocale(a: { noms: string[]; octets: Uint8Array }) {
    try {
      new mupdf.Font(a.noms[0], a.octets);
    } catch {
      return false;
    }
    for (const n of a.noms) policesLocales.set(normaliser(n), { nom: a.noms[0], octets: a.octets });
    return true;
  },

  planche(a: { jpeg: Uint8Array; page: [number, number]; photo: [number, number]; positions: [number, number][]; traits: boolean; source: { jpeg: Uint8Array; reglages: string } | null }) {
    const d = planchePdf(a.jpeg, a.page, a.photo, a.positions, a.traits, a.source, APPLICATION);
    try {
      return enregistrer(d, { compression: "aucune", motDePasse: null }).octets;
    } finally {
      d.destroy();
    }
  },

  lirePlanche() {
    return lirePlanche(doc());
  },

  chargerComparaison(a: { cote: "a" | "b"; octets?: Uint8Array; nom: string; motDePasse?: string }) {
    comparaison[a.cote]?.doc.destroy();
    const d = a.octets ? ouvrirSource(a.octets, a.motDePasse).doc : ouvrirPdf(copie(doc()));
    comparaison[a.cote] = { doc: d, nom: a.nom, motDePasse: null };
    comparaison.resultat = null;
    return { pages: taillesDesPages(d) };
  },

  /** Échange les versions A et B : l'ancienne devient la nouvelle, et inversement. */
  inverserComparaison() {
    [comparaison.a, comparaison.b] = [comparaison.b, comparaison.a];
    comparaison.resultat = null;
    return null;
  },

  comparer(a: { options: Options }, progression: Progression) {
    if (!comparaison.a || !comparaison.b) throw new Error("Choisissez les deux versions à comparer.");
    comparaison.resultat = comparer(comparaison.a.doc, comparaison.b.doc, a.options, progression);
    return comparaison.resultat;
  },

  rapport(a: { date: number }) {
    if (!comparaison.a || !comparaison.b || !comparaison.resultat) throw new Error("Aucune comparaison à enregistrer.");
    return rapportComparaison(comparaison.resultat, comparaison.a.doc, comparaison.b.doc, comparaison.a.nom, comparaison.b.nom, APPLICATION, new Date(a.date));
  },

  fermerComparaison() {
    comparaison.a?.doc.destroy();
    comparaison.b?.doc.destroy();
    comparaison.a = comparaison.b = null;
    comparaison.resultat = null;
    return null;
  },
};

export type Methodes = typeof methodes;

/** Les objets à transférer sans copie vers le fil principal (pixels, fichiers). */
function transferts(v: unknown): Transferable[] {
  if (v instanceof Uint8Array || v instanceof Uint8ClampedArray) return [v.buffer as ArrayBuffer];
  if (v && typeof v === "object") {
    const r: Transferable[] = [];
    for (const x of Object.values(v)) if (x instanceof Uint8Array || x instanceof Uint8ClampedArray) r.push(x.buffer as ArrayBuffer);
    return r;
  }
  return [];
}

portee.addEventListener("message", (ev: MessageEvent) => {
  const { id, methode, args } = ev.data as { id: number; methode: keyof Methodes; args: unknown };
  try {
    const f = methodes[methode] as (a: unknown, p: Progression) => unknown;
    if (!f) throw new Error(`Méthode inconnue : ${String(methode)}`);
    const resultat = f(args, (fraction, message) => portee.postMessage({ id, progression: fraction, message }));
    const liste = transferts(resultat);
    portee.postMessage({ id, ok: true, resultat }, liste);
  } catch (e) {
    const erreur = e instanceof MotDePasseRequis
      ? { type: "mot-de-passe", incorrect: e.incorrect, message: e.message }
      : { type: e instanceof ErreurPdf ? "pdf" : "erreur", message: e instanceof Error ? e.message : String(e) };
    portee.postMessage({ id, ok: false, erreur });
  }
});

portee.postMessage({ pret: true });
