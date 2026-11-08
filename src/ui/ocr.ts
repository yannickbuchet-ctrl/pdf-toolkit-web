/**
 * La fenêtre « Reconnaissance de texte (OCR) », comme OcrDialog sur PC : pages, langue et options, puis lecture page
 * par page, avec progression et bouton Annuler, et bilan à la fin.
 *
 * Tesseract.js lit les images dans son propre Web Worker : l'interface ne gèle pas, et Annuler l'arrête aussitôt (la
 * page en cours n'est pas modifiée). Ses fichiers (worker, moteur WebAssembly, données de langue) sont servis par le
 * site lui-même, dans le dossier __DOSSIER_OCR__ (voir vite.config.ts), et ne sont téléchargés qu'à la première
 * utilisation, puis gardés par le service worker pour le hors-ligne. Rien n'est envoyé : les images des pages restent
 * dans la mémoire du navigateur.
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { el, fenetre, pluriel, telecharger } from "./dom";
import { icone } from "./icones";
import {
  bilanVide, chercherTexteOcr, ErreurOcr, LANGUES_OCR, lirePlages, messageLangueAbsente, motsDeTesseract, reconnaitre, resumeOcr, texteExporte,
  type BilanOcr, type ImageOcr, type LecteurOcr, type MoteurOcr, type PageTesseract,
} from "../moteur/ocrLecture";

declare const __DOSSIER_OCR__: string;

type Tesseract = typeof import("tesseract.js");
type TravailleurTesseract = Awaited<ReturnType<Tesseract["createWorker"]>>;

class Arret extends Error {
  constructor() {
    super("Reconnaissance arrêtée.");
  }
}

/**
 * Un lecteur Tesseract.js pour une langue : moteur LSTM seul (celui des données « best_int »), mise en page
 * automatique (sans elle, Tesseract lit la page comme un seul bloc et saute les tableaux).
 */
class Lecteur {
  private travailleur: TravailleurTesseract | null = null;
  private suivi: ((fraction: number) => void) | null = null;
  private arreter: ((e: Error) => void) | null = null;

  private constructor(readonly langue: string) {}

  static async creer(langue: string, annoncer: (message: string) => void, arret: Promise<never>): Promise<Lecteur> {
    const lecteur = new Lecteur(langue);
    const dossier = new URL(`${__DOSSIER_OCR__}/`, document.baseURI).href;
    const chargement = (async () => {
      const { createWorker } = (await import("tesseract.js")) as Tesseract;
      return createWorker(langue, 1, {
        workerPath: `${dossier}worker.min.js`, corePath: dossier, langPath: dossier, workerBlobURL: false, gzip: true,
        // Les données sont gardées par le service worker, avec les autres fichiers du site : pas de second cache.
        cacheMethod: "none",
        logger: (m) => {
          if (m.status === "recognizing text") lecteur.suivi?.(m.progress);
          else if (m.status === "loading language traineddata" && m.progress < 1) annoncer("Chargement des données de la langue…");
          else if (m.status === "loading tesseract core" && m.progress < 1) annoncer("Chargement du lecteur de texte…");
        },
        errorHandler: () => {},
      });
    })();
    try {
      lecteur.travailleur = await Promise.race([chargement, arret]);
    } catch (e) {
      chargement.then((t) => t.terminate(), () => {});
      if (e instanceof Arret) throw e;
      // Un fichier qui manque (hors connexion avant la première utilisation) : le worker ne se charge pas (erreur sans
      // message), ou les données de langue ne se téléchargent pas (« Network error while fetching… »).
      const texte = e instanceof Error ? e.message : String(e ?? "");
      throw new ErreurOcr(!navigator.onLine || !texte || texte === "undefined" || /fetch|network|404|load/i.test(texte)
        ? messageLangueAbsente(langue.split("+")) : `Le lecteur de texte n’a pas pu démarrer (${texte}).`);
    }
    await lecteur.travailleur.setParameters({ tessedit_pageseg_mode: "3" as never });
    return lecteur;
  }

  /** Lit une image ; échoue aussitôt si la lecture est arrêtée (Tesseract est alors arrêté lui aussi). */
  lire: LecteurOcr = async (image: ImageOcr, progression) => {
    const t = this.travailleur;
    if (!t) throw new Arret();
    await t.setParameters({ user_defined_dpi: String(image.ppp) });
    this.suivi = progression ?? null;
    const lecture = t.recognize(image.png as unknown as Blob, {}, { blocks: true, text: false });
    const arret = new Promise<never>((_, rejeter) => (this.arreter = rejeter));
    try {
      const r = await Promise.race([lecture, arret]);
      return motsDeTesseract(r.data as unknown as PageTesseract);
    } finally {
      this.suivi = null;
      this.arreter = null;
    }
  };

  /** Arrête Tesseract, même au milieu d'une page : la lecture en cours échoue. */
  async terminer() {
    const t = this.travailleur;
    this.travailleur = null;
    this.arreter?.(new Arret());
    await t?.terminate().catch(() => {});
  }
}

/** Le moteur PDF, vu de la reconnaissance : le Web Worker de MuPDF. */
const moteurPdf: MoteurOcr = {
  aDuTexte: (page) => appel("ocrATexte", { page }, { discret: true }),
  image: (page, ppp, rotation) => appel("ocrImage", { page, ppp, rotation }, { discret: true }),
  poser: async (page, lignes, rotation, premiere) => {
    await appel("ocrPoser", { page, lignes, rotation, premiere }, { discret: true });
  },
};

/** Fenêtre « Reconnaissance de texte (OCR) » du document ouvert. */
export async function reconnaissanceTexte(app: Application) {
  const etat = app.etat;
  if (!etat) return;
  app.fermerEditeur();
  const nombre = etat.pages.length;
  const f = fenetre("Reconnaissance de texte (OCR)", { classe: "ocr" });

  const toutes = el("input", { type: "radio", name: "pages-ocr", value: "toutes", checked: nombre > 1 });
  const certaines = el("input", { type: "radio", name: "pages-ocr", value: "certaines", checked: nombre === 1 });
  const liste = el("input", { type: "text", class: "entree", value: String(app.pageCourante + 1), "aria-label": "Pages à lire", placeholder: "exemple : 1-3, 7", title: "Numéros de pages et plages, séparés par des virgules : 1-3, 7", inputmode: "text" });
  liste.addEventListener("input", () => (certaines.checked = true));
  const langue = el("select", { class: "entree", id: "langue-ocr", title: "Langue du texte à lire. « Français et anglais » convient à un document mêlant les deux, mais lit un peu moins bien chacune et deux fois moins vite." });
  for (const [code, nom] of LANGUES_OCR) langue.append(el("option", { value: code, text: nom }));
  const passer = el("input", { type: "checkbox", checked: true });
  const redresser = el("input", { type: "checkbox", checked: true });
  const progression = el("div", { class: "barre-progression", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Avancement de la reconnaissance" }, el("div"));
  const statut = el("p", { class: "statut-ocr", role: "status", "aria-live": "polite" });

  f.corps.append(
    el("p", { style: { marginTop: "0" }, text: "Le texte des pages scannées est lu sur l’image, puis posé dessus en calque invisible : le document devient cherchable, et son texte sélectionnable et copiable, sans changer d’aspect. Tout se fait sur cet appareil : rien n’est envoyé." }),
    el("fieldset", {},
      el("legend", { text: "Pages" }),
      el("label", { class: "choix" }, toutes, el("span", { text: `Toutes les pages (${nombre})` })),
      el("label", { class: "choix choix-pages" }, certaines, el("span", { text: "Seulement les pages :" }), liste)),
    el("div", { class: "champ-formulaire" }, el("label", { for: "langue-ocr", text: "Langue :" }), langue),
    el("label", { class: "choix" }, passer, el("span", {}, "Ignorer les pages qui contiennent déjà du texte",
      el("span", { class: "indication", text: "Décochée, une page déjà passée à l’OCR est relue : son ancien texte reconnu est remplacé, jamais ajouté en double." }))),
    el("label", { class: "choix" }, redresser, el("span", {}, "Redresser les pages scannées à l’envers ou d’un quart de tour",
      el("span", { class: "indication", text: "Une page qui se lit mal est essayée dans les quatre sens, puis pivotée pour s’afficher à l’endroit si elle se lit mieux autrement." }))),
    progression, statut);

  const voir = el("button", { type: "button", class: "bouton cadre", hidden: true, title: "Ouvrir le texte reconnu, page par page, et y chercher un mot", html: `${icone("chercher")}<span>Voir le résultat…</span>` });
  const copier = el("button", { type: "button", class: "bouton cadre", hidden: true, title: "Copier dans le presse-papiers le texte reconnu, page par page", html: `${icone("liste")}<span>Copier le texte</span>` });
  const exporter = el("button", { type: "button", class: "bouton cadre", hidden: true, html: `${icone("telecharger")}<span>Enregistrer en .txt</span>` });
  const fermer = el("button", { type: "button", class: "bouton cadre", text: "Fermer" });
  const lancer = el("button", { type: "button", class: "bouton principal", text: "Lancer" });
  f.pied.append(voir, copier, exporter, el("span", { style: { flex: "1" } }), fermer, lancer);

  let enCours: { arreter: () => void } | null = null;
  let bilan: BilanOcr | null = null;
  let modifie = false;
  const controles = [toutes, certaines, liste, langue, passer, redresser, lancer];

  fermer.addEventListener("click", () => (enCours ? enCours.arreter() : f.fermer()));
  // Échap, ou la croix, pendant la lecture : arrêt, la fenêtre reste ouverte avec le bilan.
  f.dialog.addEventListener("cancel", (e) => {
    if (!enCours) return;
    e.preventDefault();
    enCours.arreter();
  });
  f.dialog.addEventListener("close", () => enCours?.arreter());

  let ouvrirResultat = false;
  voir.addEventListener("click", () => {
    ouvrirResultat = true;
    f.fermer();
  });
  copier.addEventListener("click", async () => {
    if (!bilan) return;
    try {
      await navigator.clipboard.writeText(texteExporte(bilan));
      statut.textContent = "Texte reconnu copié dans le presse-papiers.";
    } catch {
      statut.textContent = "Le navigateur n’a pas permis la copie : enregistrez le texte en .txt.";
    }
  });
  exporter.addEventListener("click", () => {
    if (!bilan) return;
    const base = app.nomEnregistrement().replace(/\.pdf$/i, "");
    telecharger(new TextEncoder().encode(texteExporte(bilan) + "\n"), `${base} (texte).txt`, "text/plain;charset=utf-8");
    statut.textContent = `Texte enregistré : téléchargement de « ${base} (texte).txt ».`;
  });

  lancer.addEventListener("click", async () => {
    let pages: number[];
    try {
      pages = toutes.checked ? [...Array(nombre).keys()] : lirePlages(liste.value, nombre);
    } catch (e) {
      statut.textContent = (e as Error).message;
      liste.focus();
      return;
    }
    controles.forEach((c) => (c.disabled = true));
    voir.hidden = copier.hidden = exporter.hidden = true;
    fermer.textContent = "Annuler";
    progression.hidden = false;
    const barre = progression.firstElementChild as HTMLElement;
    const avancer = (fraction: number, message: string) => {
      barre.style.width = `${Math.round(fraction * 100)}%`;
      progression.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
      if (message) statut.textContent = message;
    };
    avancer(0, "Préparation…");
    // Sur un petit écran, les options remplissent la fenêtre : la progression, en dessous, est amenée à la vue.
    progression.scrollIntoView({ block: "nearest" });
    bilan = bilanVide();
    modifie = false;
    let arrete = false;
    let lecteur: Lecteur | null = null;
    let signalerArret: (e: Error) => void = () => {};
    const arret = new Promise<never>((_, rejeter) => (signalerArret = rejeter));
    arret.catch(() => {});
    enCours = {
      arreter: () => {
        if (arrete) return;
        arrete = true;
        statut.textContent = "Arrêt de la lecture…";
        signalerArret(new Arret());
        lecteur?.terminer();
      },
    };
    let fini = false;
    const debut = performance.now();
    const moteur: MoteurOcr = { ...moteurPdf, poser: async (...a) => {
      await moteurPdf.poser(...a);
      modifie = true;
    } };
    try {
      lecteur = await Lecteur.creer(langue.value, (m) => avancer(0, m), arret);
      fini = await reconnaitre(moteur, lecteur.lire, pages, { passerTexte: passer.checked, redresser: redresser.checked }, avancer, bilan, () => arrete);
    } catch (e) {
      if (e instanceof ErreurOcr) statut.textContent = e.message;
      else if (!(e instanceof Arret)) {
        statut.textContent = `La reconnaissance de texte a échoué : ${(e as Error).message ?? e}`;
        console.error(e);
      }
    } finally {
      await lecteur?.terminer();
      enCours = null;
      progression.hidden = true;
      controles.forEach((c) => (c.disabled = false));
      fermer.textContent = "Fermer";
      lancer.textContent = "Relancer";
    }
    const erreur = !fini && !arrete;
    if (!erreur) {
      let resume = resumeOcr(bilan, !fini);
      if (modifie) resume += " Ctrl+Z (bouton Annuler de la barre) annule toute l’opération.";
      statut.textContent = resume;
      console.info(`OCR : ${pluriel(bilan.faites.length, "page")} en ${Math.round(performance.now() - debut)} ms`);
    }
    voir.hidden = copier.hidden = exporter.hidden = !Object.keys(bilan.textes).length;
    statut.scrollIntoView({ block: "nearest" });
    if (modifie) await app.apresOcr(bilan);
  });

  setTimeout(() => lancer.focus(), 50);
  await f.fermee;
  if (ouvrirResultat && bilan) await resultatOcr(app, bilan);
}

/** Fenêtre « Texte reconnu » : le texte page par page, avec une recherche qui ignore majuscules et accents.
 * « Montrer dans le document » ferme la fenêtre et ouvre la recherche du document sur la même occurrence. */
export async function resultatOcr(app: Application, bilan: BilanOcr) {
  const f = fenetre("Texte reconnu", { classe: "large ocr-resultat" });
  const champ = el("input", { type: "search", class: "entree", placeholder: "Chercher un mot dans le texte reconnu", "aria-label": "Chercher un mot dans le texte reconnu", title: "Les majuscules et les accents ne comptent pas. Entrée : occurrence suivante ; Maj+Entrée : précédente." });
  const compte = el("span", { class: "compte", "aria-live": "polite" });
  const zone = el("div", { class: "texte-ocr", tabindex: "0", "aria-label": "Texte reconnu" });
  const pages = Object.keys(bilan.textes).map(Number).sort((a, b) => a - b);
  const blocs = new Map<number, HTMLElement>();
  for (const page of pages) {
    const bloc = el("div", { class: "page-ocr" });
    blocs.set(page, bloc);
    zone.append(el("h3", { text: `Page ${page + 1}` }), bloc);
  }
  let occurrences = chercherTexteOcr(bilan.textes, "");
  let courante = -1;
  const afficher = () => {
    for (const page of pages) {
      const texte = bilan.textes[page];
      const bloc = blocs.get(page)!;
      bloc.replaceChildren();
      let k = 0;
      occurrences.forEach((o, n) => {
        if (o.page !== page) return;
        bloc.append(texte.slice(k, o.debut), el("mark", { class: n === courante ? "courante" : "", text: texte.slice(o.debut, o.fin) }));
        k = o.fin;
      });
      bloc.append(texte.slice(k));
    }
    if (!champ.value.trim()) compte.textContent = "";
    else if (!occurrences.length) compte.textContent = "Aucun résultat";
    else compte.textContent = `${courante + 1} sur ${occurrences.length} · page ${occurrences[courante].page + 1}`;
    montrer.disabled = !occurrences.length;
    zone.querySelector("mark.courante")?.scrollIntoView({ block: "center" });
  };
  const avancer = (sens: number) => {
    if (!occurrences.length) return;
    courante = (courante + sens + occurrences.length) % occurrences.length;
    afficher();
  };
  champ.addEventListener("input", () => {
    occurrences = chercherTexteOcr(bilan.textes, champ.value);
    courante = occurrences.length ? 0 : -1;
    afficher();
  });
  champ.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    avancer(e.shiftKey ? -1 : 1);
  });
  const precedente = el("button", { type: "button", class: "bouton cadre", title: "Occurrence précédente (Maj+Entrée)", "aria-label": "Occurrence précédente", html: icone("haut"), onclick: () => avancer(-1) });
  const suivante = el("button", { type: "button", class: "bouton cadre", title: "Occurrence suivante (Entrée)", "aria-label": "Occurrence suivante", html: icone("bas"), onclick: () => avancer(1) });
  const montrer = el("button", { type: "button", class: "bouton principal", text: "Montrer dans le document", title: "Fermer cette fenêtre et surligner cette occurrence sur la page" });
  const copier = el("button", { type: "button", class: "bouton cadre", html: `${icone("liste")}<span>Copier le texte</span>` });
  copier.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(texteExporte(bilan));
      compte.textContent = "Texte copié.";
    } catch {
      compte.textContent = "Copie refusée par le navigateur.";
    }
  });
  let cible: { mot: string; page: number; rang: number } | null = null;
  montrer.addEventListener("click", () => {
    const o = occurrences[courante];
    if (!o) return;
    cible = { mot: bilan.textes[o.page].slice(o.debut, o.fin), page: o.page, rang: o.rang };
    f.fermer();
  });
  f.corps.append(el("div", { class: "recherche-ocr" }, champ, precedente, suivante, compte), zone);
  f.pied.append(copier, el("span", { style: { flex: "1" } }), el("button", { type: "button", class: "bouton cadre", text: "Fermer", onclick: () => f.fermer() }), montrer);
  afficher();
  setTimeout(() => champ.focus(), 50);
  await f.fermee;
  // (TypeScript ne voit pas l'affectation faite dans l'écouteur : type rappelé.)
  const choisie = cible as { mot: string; page: number; rang: number } | null;
  if (choisie) await app.montrerMotOcr(choisie.mot, choisie.page, choisie.rang);
}
