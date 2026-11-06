/**
 * L'application : barre d'outils, miniatures des pages, document au centre (comme PdfEditor sur PC).
 */
import { appel, ErreurMoteur, surOccupation } from "./moteur";
import { bouton, choisirFichiers, confirmer, demander, el, estPdf, fenetre, informer, lire, menuFlottant, pluriel, tailleLisible, telecharger } from "./dom";
import { icone, LOGO } from "./icones";
import type { EtatDocument } from "../worker";
import type { Segment } from "../moteur/segments";
import type { Champ, Occurrence } from "../moteur/pages";
import { APPLICATION } from "../version";
import * as outils from "./outils";

const PX_PAR_POINT = 96 / 72;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export type Mode = "lecture" | "texte" | "ajout" | "surligner" | "note" | "dessin";

interface VuePage {
  index: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  calque: HTMLDivElement;
  echelleRendue: number;
  enCours: boolean;
  segments: Segment[] | null;
  champs: Champ[] | null;
  visible: boolean;
}

interface FichierOuvert {
  nom: string;
  poignee: FileSystemFileHandle | null;
}

type Couleur = [number, number, number];
const COULEURS: { nom: string; rgb: Couleur }[] = [
  { nom: "Jaune", rgb: [1, 0.87, 0.1] }, { nom: "Vert", rgb: [0.4, 0.85, 0.35] }, { nom: "Bleu", rgb: [0.15, 0.39, 0.92] },
  { nom: "Rouge", rgb: [0.86, 0.15, 0.15] }, { nom: "Noir", rgb: [0, 0, 0] },
];
const hexDe = (c: Couleur) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

export class Application {
  etat: EtatDocument | null = null;
  fichier: FichierOuvert | null = null;
  modifie = false;
  zoom = 1;
  mode: Mode = "lecture";
  vues: VuePage[] = [];
  pageCourante = 0;
  selection = new Set<number>();
  occurrences: Occurrence[] = [];
  occurrenceCourante = -1;
  polices: Awaited<ReturnType<typeof outils.policesDuDocument>> | null = null;
  compressionRetenue: outils.ChoixCompression | null = null;
  dernierChoixCompression: outils.ChoixCompression = "aucune";
  reglages = {
    couleurAnnotation: COULEURS[0].rgb, typeAnnotation: "Highlight" as "Highlight" | "Underline" | "StrikeOut",
    couleurDessin: COULEURS[2].rgb, epaisseur: 2, outilDessin: "main" as "main" | "Square" | "Circle",
    taille: 12, couleurTexte: "#000000", police: "Helvetica", gras: false, italique: false,
  };

  racine: HTMLElement;
  barre!: HTMLElement;
  sousBarre!: HTMLElement;
  barreRecherche!: HTMLElement;
  barreMobile!: HTMLElement;
  corps!: HTMLElement;
  miniatures!: HTMLElement;
  listeMiniatures!: HTMLElement;
  visionneuse!: HTMLElement;
  conteneurPages!: HTMLElement;
  accueil!: HTMLElement;
  barreEtat!: HTMLElement;
  messageEtat!: HTMLElement;
  boutons: Record<string, HTMLButtonElement> = {};
  champPage!: HTMLInputElement;
  totalPages!: HTMLElement;
  valeurZoom!: HTMLButtonElement;
  observateur!: IntersectionObserver;
  observateurMiniatures!: IntersectionObserver;
  minuterieMessage = 0;
  editeurOuvert: (() => void) | null = null;
  placement: HTMLElement | null = null;

  constructor(racine: HTMLElement) {
    this.racine = racine;
    this.construire();
    this.miseAJour();
    surOccupation((occupe) => {
      this.barreEtat.querySelector(".attente")!.toggleAttribute("hidden", !occupe);
      document.body.style.cursor = occupe ? "progress" : "";
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.modifie) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    this.installerGlisserDeposer();
    this.installerClavier();
  }

  /* --- Construction de l'interface ----------------------------------------------------------------------------- */

  construire() {
    const b = (cle: string, ic: string, libelle: string, action: (ev: MouseEvent) => void, opts: Parameters<typeof bouton>[3] = {}) => {
      this.boutons[cle] = bouton(ic, libelle, action, opts);
      return this.boutons[cle];
    };
    this.champPage = el("input", { type: "text", inputmode: "numeric", "aria-label": "Numéro de la page", value: "1" });
    this.champPage.addEventListener("change", () => this.allerA(Number(this.champPage.value) - 1));
    this.totalPages = el("span", { text: "/ 0" });
    this.valeurZoom = el("button", { type: "button", class: "bouton zoom-valeur", title: "Zoom : cliquer pour 100 %", text: "100 %" });
    this.valeurZoom.addEventListener("click", () => this.definirZoom(1));

    const marque = el("div", { class: "marque", html: `${LOGO}<span>${APPLICATION}</span>` });
    // Sur téléphone, ces éléments quittent la barre du haut : la barre du bas et ses menus les remplacent.
    const bureau = <T extends HTMLElement>(e: T) => {
      e.classList.add("bureau");
      return e;
    };
    this.barre = el("nav", { class: "barre", "aria-label": "Barre d'outils" },
      marque,
      b("ouvrir", "ouvrir", "Ouvrir", () => this.ouvrirDialogue(), { raccourci: "Ctrl+O" }),
      b("enregistrer", "enregistrer", "Enregistrer", () => this.enregistrer(false), { raccourci: "Ctrl+S" }),
      bureau(b("enregistrerSous", "telecharger", "Enregistrer sous", () => this.enregistrer(true), { raccourci: "Ctrl+Maj+S", texte: false })),
      bureau(b("imprimer", "imprimer", "Imprimer", () => outils.imprimer(this), { raccourci: "Ctrl+P", texte: false })),
      el("span", { class: "separateur bureau" }),
      b("annuler", "annuler", "Annuler", () => this.annuler(), { raccourci: "Ctrl+Z", texte: false }),
      b("retablir", "retablir", "Rétablir", () => this.retablir(), { raccourci: "Ctrl+Y", texte: false }),
      el("span", { class: "separateur bureau" }),
      bureau(b("miniatures", "miniatures", "Miniatures des pages", () => this.basculerMiniatures(), { texte: false, bascule: true })),
      bureau(b("zoomMoins", "moins", "Zoom arrière", () => this.pasZoom(-1), { raccourci: "Ctrl+-", texte: false })),
      bureau(this.valeurZoom),
      bureau(b("zoomPlus", "plus", "Zoom avant", () => this.pasZoom(1), { raccourci: "Ctrl++", texte: false })),
      bureau(b("ajuster", "ajuster", "Ajuster à la largeur", () => this.ajusterLargeur(), { texte: false })),
      el("span", { class: "page-nav" },
        bureau(b("precedente", "gauche", "Page précédente", () => this.allerA(this.pageCourante - 1), { texte: false })),
        this.champPage, this.totalPages,
        bureau(b("suivante", "droite", "Page suivante", () => this.allerA(this.pageCourante + 1), { texte: false }))),
      el("span", { class: "separateur bureau" }),
      bureau(b("modeLecture", "selection", "Lire et remplir", () => this.definirMode("lecture"), { texte: false, bascule: true })),
      bureau(b("modeTexte", "texte", "Modifier le texte", () => this.definirMode("texte"), { bascule: true, raccourci: "T" })),
      bureau(b("modeAjout", "ajoutTexte", "Ajouter du texte", () => this.definirMode("ajout"), { texte: false, bascule: true })),
      bureau(b("modeSurligner", "surligner", "Surligner", () => this.definirMode("surligner"), { texte: false, bascule: true })),
      bureau(b("modeNote", "note", "Note", () => this.definirMode("note"), { texte: false, bascule: true })),
      bureau(b("modeDessin", "dessin", "Dessiner", () => this.definirMode("dessin"), { texte: false, bascule: true })),
      bureau(b("signature", "signature", "Signature", () => outils.signature(this), { texte: false })),
      bureau(b("image", "image", "Insérer une image", () => outils.image(this), { texte: false })),
      el("span", { class: "separateur bureau" }),
      bureau(b("rechercher", "chercher", "Rechercher et remplacer", () => this.afficherRecherche(), { raccourci: "Ctrl+F", texte: false })),
      el("span", { class: "espace" }),
      b("outils", "menu", "Outils", (ev) => outils.menu(this, ev.currentTarget as HTMLElement), {}),
    );
    this.boutons.outils.setAttribute("aria-haspopup", "menu");

    // Barre du bas, sous le pouce, sur téléphone seulement (voir le CSS) : les actions de la barre du haut regroupées.
    const mobile = (cle: string, ic: string, libelle: string, action: (ev: MouseEvent) => void) => {
      const bt = el("button", { type: "button", class: "bouton", html: `${icone(ic)}<span>${libelle}</span>` });
      bt.addEventListener("click", action);
      this.boutons[cle] = bt;
      return bt;
    };
    this.barreMobile = el("nav", { class: "barre-mobile", "aria-label": "Actions du document" },
      mobile("mPages", "miniatures", "Pages", () => this.basculerMiniatures()),
      mobile("mTexte", "texte", "Modifier", () => this.definirMode(this.mode === "texte" ? "lecture" : "texte")),
      mobile("mAnnoter", "dessin", "Annoter", (ev) => this.menuAnnoter(ev.currentTarget as HTMLElement)),
      mobile("mChercher", "chercher", "Chercher", () => (this.barreRecherche.hidden ? this.afficherRecherche() : this.fermerRecherche())),
      mobile("mPlus", "menu", "Plus", (ev) => this.menuPlus(ev.currentTarget as HTMLElement)),
    );
    this.boutons.mAnnoter.setAttribute("aria-haspopup", "menu");
    this.boutons.mPlus.setAttribute("aria-haspopup", "menu");

    this.sousBarre = el("div", { class: "sous-barre", hidden: true, role: "toolbar", "aria-label": "Options de l'outil" });
    this.barreRecherche = el("div", { class: "sous-barre", hidden: true, role: "search" });

    this.listeMiniatures = el("div", { class: "liste", role: "listbox", "aria-label": "Pages", "aria-multiselectable": "true" });
    const actionsPages = el("div", { class: "actions", role: "toolbar", "aria-label": "Pages sélectionnées" },
      b("pivoterG", "pivoterGauche", "Pivoter à gauche", () => this.pivoterSelection(-90), { texte: false }),
      b("pivoterD", "pivoterDroite", "Pivoter à droite", () => this.pivoterSelection(90), { texte: false }),
      b("monter", "haut", "Déplacer vers le haut", () => this.deplacerSelection(-1), { texte: false }),
      b("descendre", "bas", "Déplacer vers le bas", () => this.deplacerSelection(1), { texte: false }),
      b("supprimerPages", "supprimer", "Supprimer les pages sélectionnées", () => this.supprimerSelection(), { texte: false, classe: "danger" }),
      b("extraire", "extraire", "Extraire les pages sélectionnées dans un nouveau PDF", () => this.extraireSelection(), { texte: false }),
      b("pageBlanche", "pageBlanche", "Insérer une page blanche après la sélection", () => this.insererPageBlanche(), { texte: false }),
      b("insererPdf", "insererPdf", "Insérer les pages d'un PDF après la sélection", () => this.insererPdf(), { texte: false }),
      b("grille", "pages", "Organiser les pages en grille", () => this.basculerGrille(), { texte: false, bascule: true }),
    );
    this.miniatures = el("aside", { class: "miniatures", "aria-label": "Miniatures des pages" }, actionsPages, this.listeMiniatures);

    this.conteneurPages = el("div", { class: "pages" });
    this.visionneuse = el("main", { class: "visionneuse", id: "visionneuse", tabindex: "-1", "aria-label": "Document" }, this.conteneurPages);
    this.visionneuse.addEventListener("scroll", () => this.suivreDefilement(), { passive: true });
    this.visionneuse.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.pasZoom(e.deltaY < 0 ? 1 : -1, e);
    }, { passive: false });

    this.accueil = outils.accueil(this);
    this.corps = el("div", { class: "corps" }, this.miniatures, this.visionneuse);

    this.messageEtat = el("span", { class: "message", role: "status", "aria-live": "polite" });
    this.barreEtat = el("footer", { class: "etat" }, el("span", { class: "attente", hidden: true, "aria-hidden": "true" }), this.messageEtat,
      el("span", { class: "aide", text: "Vos fichiers restent sur cet appareil." }));

    this.racine.append(this.barre, this.sousBarre, this.barreRecherche, this.accueil, this.barreEtat, this.barreMobile);
    this.installerPincement();

    this.observateur = new IntersectionObserver((entrees) => {
      for (const e of entrees) {
        const vue = this.vues.find((v) => v.el === e.target);
        if (!vue) continue;
        vue.visible = e.isIntersecting;
        if (vue.visible) this.rendrePage(vue);
      }
    }, { root: this.visionneuse, rootMargin: "800px 0px" });
    this.observateurMiniatures = new IntersectionObserver((entrees) => {
      for (const e of entrees) if (e.isIntersecting) this.rendreMiniature(e.target as HTMLElement);
    }, { root: this.miniatures, rootMargin: "400px 0px" });
  }

  /** Affiche l'accueil ou le document, et met à jour l'état des boutons. */
  miseAJour() {
    const ouvert = this.etat !== null;
    if (ouvert && this.accueil.isConnected) this.accueil.replaceWith(this.corps);
    if (!ouvert && this.corps.isConnected) this.corps.replaceWith(this.accueil);
    const actifs = ["enregistrer", "enregistrerSous", "imprimer", "miniatures", "zoomMoins", "zoomPlus", "ajuster", "precedente", "suivante",
      "modeLecture", "modeTexte", "modeAjout", "modeSurligner", "modeNote", "modeDessin", "signature", "image", "rechercher"];
    for (const k of actifs) this.boutons[k].disabled = !ouvert;
    this.boutons.annuler.disabled = !this.etat?.annuler;
    this.boutons.retablir.disabled = !this.etat?.retablir;
    this.boutons.annuler.title = this.etat?.annuler ? `Annuler : ${this.etat.annuler} (Ctrl+Z)` : "Annuler (Ctrl+Z)";
    this.boutons.retablir.title = this.etat?.retablir ? `Rétablir : ${this.etat.retablir} (Ctrl+Y)` : "Rétablir (Ctrl+Y)";
    this.valeurZoom.textContent = `${Math.round(this.zoom * 100)} %`;
    this.totalPages.textContent = `/ ${this.etat?.pages.length ?? 0}`;
    this.champPage.disabled = !ouvert;
    const titre = ouvert ? `${this.modifie ? "• " : ""}${this.fichier?.nom ?? this.etat!.nom} — ${APPLICATION}` : APPLICATION;
    document.title = titre;
    for (const [m, cle] of [["lecture", "modeLecture"], ["texte", "modeTexte"], ["ajout", "modeAjout"], ["surligner", "modeSurligner"], ["note", "modeNote"], ["dessin", "modeDessin"]] as const) {
      this.boutons[cle].setAttribute("aria-pressed", String(ouvert && this.mode === m));
    }
    this.boutons.miniatures.setAttribute("aria-pressed", String(!this.corps.classList.contains("sans-miniatures")));
    this.boutons.grille.setAttribute("aria-pressed", String(this.corps.classList.contains("grille")));
    this.barreMobile.hidden = !ouvert;
    this.boutons.mPages.setAttribute("aria-pressed", String(this.corps.classList.contains("miniatures-ouvertes")));
    this.boutons.mTexte.setAttribute("aria-pressed", String(ouvert && this.mode === "texte"));
    this.boutons.mAnnoter.classList.toggle("actif", ouvert && this.mode !== "texte" && this.mode !== "lecture");
    this.boutons.mChercher.setAttribute("aria-pressed", String(!this.barreRecherche.hidden));
    const sel = this.selection.size > 0;
    for (const k of ["pivoterG", "pivoterD", "monter", "descendre", "supprimerPages", "extraire"]) this.boutons[k].disabled = !ouvert || !sel;
  }

  message(texte: string, type: "info" | "erreur" | "succes" = "info", duree = 8000) {
    this.messageEtat.textContent = texte;
    this.messageEtat.className = `message ${type === "info" ? "" : type}`;
    clearTimeout(this.minuterieMessage);
    if (duree) this.minuterieMessage = window.setTimeout(() => (this.messageEtat.textContent = ""), duree);
  }

  erreur(e: unknown, contexte = "") {
    const m = e instanceof Error ? e.message : String(e);
    this.message(contexte ? `${contexte} : ${m}` : m, "erreur", 15000);
    console.error(e);
  }

  /* --- Fichiers ------------------------------------------------------------------------------------------------- */

  async ouvrirDialogue() {
    if (!(await this.peutQuitter())) return;
    const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]> };
    if (w.showOpenFilePicker) {
      try {
        const [poignee] = await w.showOpenFilePicker({ types: [{ description: "Documents PDF", accept: { "application/pdf": [".pdf"] } }], excludeAcceptAllOption: false });
        await this.ouvrirFichier(await poignee.getFile(), poignee);
      } catch (e) {
        if ((e as DOMException).name !== "AbortError") this.erreur(e, "Ouverture impossible");
      }
      return;
    }
    const [f] = await choisirFichiers("application/pdf,.pdf");
    if (f) await this.ouvrirFichier(f, null);
  }

  /** Demande le mot de passe d'un PDF protégé, autant de fois que nécessaire. null : l'utilisateur renonce. */
  async avecMotDePasse<T>(nom: string, essai: (motDePasse?: string) => Promise<T>): Promise<T | null> {
    let motDePasse: string | undefined;
    let erreurMdp = "";
    for (;;) {
      try {
        return await essai(motDePasse);
      } catch (e) {
        if (!(e instanceof ErreurMoteur) || e.type !== "mot-de-passe") throw e;
        if (motDePasse !== undefined) erreurMdp = "Mot de passe incorrect. Réessayez.";
        const r = await demander("Document protégé", `« ${nom} » est protégé par un mot de passe :`, { type: "password", valider: "Ouvrir", erreur: erreurMdp });
        if (r === null) return null;
        motDePasse = r;
      }
    }
  }

  async ouvrirFichier(fichier: File, poignee: FileSystemFileHandle | null) {
    if (!estPdf(fichier) && !(await confirmer("Ouvrir ce fichier ?", `« ${fichier.name} » ne semble pas être un PDF. Essayer quand même ?`, "Essayer"))) return;
    const octets = await lire(fichier);
    this.message(`Ouverture de « ${fichier.name} »…`, "info", 0);
    try {
      const r = await this.avecMotDePasse(fichier.name, (motDePasse) => appel("ouvrir", { octets: octets.slice(), nom: fichier.name, motDePasse }));
      if (!r) {
        this.message("");
        return;
      }
      this.fichier = { nom: fichier.name, poignee };
      this.modifie = false;
      this.chargerEtat(r.etat, true);
      if (Application.etroit()) this.ajusterLargeur();
      let msg = `« ${fichier.name} » ouvert : ${pluriel(r.etat.pages.length, "page")}.`;
      if (r.etat.motDePasse) msg += " Il restera protégé par son mot de passe à l’enregistrement.";
      if (r.restrictions) msg += " Ce PDF limitait certains droits (impression, copie…) : ces limites seront retirées à l’enregistrement.";
      if (r.etat.planche) msg += " C’est une planche de photos d’identité : Outils → Modifier la planche.";
      this.message(msg, "succes");
    } catch (e) {
      this.erreur(e, `Impossible d’ouvrir « ${fichier.name} »`);
    }
  }

  /** Ouvre un PDF produit par l'application (fusion, planche) à la place du document. */
  async ouvrirResultat(octets: Uint8Array, nom: string, libelle: string) {
    const etat = await appel("remplacer", { octets, nom, libelle }, { transferer: [octets.buffer as ArrayBuffer] });
    const avaitDocument = this.etat !== null;
    this.fichier = { nom, poignee: null };
    this.modifie = true;
    this.chargerEtat(etat, true);
    if (Application.etroit()) this.ajusterLargeur();
    if (avaitDocument) this.message(`${libelle[0].toUpperCase() + libelle.slice(1)} : nouveau document « ${nom} » (Ctrl+Z pour revenir au précédent).`, "succes");
  }

  /** S'il y a des modifications non enregistrées, propose de les enregistrer. false : l'utilisateur annule. */
  async peutQuitter(): Promise<boolean> {
    if (!this.etat || !this.modifie) return true;
    const r = await confirmer("Modifications non enregistrées", `Enregistrer les modifications de « ${this.fichier?.nom ?? "document"} » ?`, "Enregistrer", { autre: "Ne pas enregistrer" });
    if (r === "autre") return true;
    if (r === true) return this.enregistrer(false);
    return false;
  }

  async fermerDocument() {
    if (!(await this.peutQuitter())) return;
    await appel("fermer");
    this.etat = null;
    this.fichier = null;
    this.modifie = false;
    this.vues = [];
    this.conteneurPages.replaceChildren();
    this.listeMiniatures.replaceChildren();
    this.fermerRecherche();
    this.definirMode("lecture");
    this.miseAJour();
  }

  nomEnregistrement(): string {
    const nom = this.fichier?.nom ?? this.etat?.nom ?? "document.pdf";
    return /\.pdf$/i.test(nom) ? nom : nom + ".pdf";
  }

  /** Enregistre : sur le fichier d'origine si le navigateur le permet, sinon par un téléchargement. */
  async enregistrer(sous: boolean): Promise<boolean> {
    if (!this.etat) return false;
    const choix = this.compressionRetenue && !sous ? this.compressionRetenue : await outils.choisirCompression(this);
    if (!choix) return false;
    try {
      const r = await appel("enregistrer", { compression: choix });
      const nom = this.nomEnregistrement();
      const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
      let poignee = sous ? null : this.fichier?.poignee ?? null;
      let ecrit = false;
      if (!poignee && w.showSaveFilePicker) {
        try {
          poignee = await w.showSaveFilePicker({ suggestedName: nom, types: [{ description: "Document PDF", accept: { "application/pdf": [".pdf"] } }] });
        } catch (e) {
          if ((e as DOMException).name === "AbortError") return false;
          poignee = null;
        }
      }
      if (poignee) {
        try {
          const flux = await poignee.createWritable();
          await flux.write(r.octets as BlobPart);
          await flux.close();
          this.fichier = { nom: poignee.name, poignee };
          ecrit = true;
        } catch (e) {
          if ((e as DOMException).name === "AbortError" || (e as DOMException).name === "NotAllowedError") {
            this.message("Enregistrement annulé : le navigateur n’a pas reçu l’autorisation d’écrire sur le fichier.", "erreur");
            return false;
          }
          throw e;
        }
      }
      if (!ecrit) telecharger(r.octets, nom);
      this.modifie = false;
      this.miseAJour();
      const ou = ecrit ? `dans « ${this.fichier!.nom} »` : `: téléchargement de « ${nom} »`;
      if (r.avant !== null) {
        const gain = Math.round((100 * (r.avant - r.octets.length)) / r.avant);
        this.message(`Document enregistré ${ou}, compressé : ${tailleLisible(r.avant)} → ${tailleLisible(r.octets.length)} (${gain >= 1 ? `−${gain} %` : "fichier déjà optimisé, aucun gain possible"})${r.images ? `, ${pluriel(r.images, "image")} réduite${r.images > 1 ? "s" : ""}` : ""}.`, "succes");
      } else {
        this.message(`Document enregistré ${ou}.`, "succes");
      }
      return true;
    } catch (e) {
      this.erreur(e, "Impossible d’enregistrer");
      return false;
    }
  }

  /* --- Document et pages --------------------------------------------------------------------------------------- */

  /** Applique un nouvel état du document. reconstruire : le nombre ou la taille des pages a pu changer. */
  chargerEtat(etat: EtatDocument, reconstruire = false) {
    const ancien = this.etat;
    this.etat = etat;
    this.polices = null;
    const memesPages = ancien && ancien.pages.length === etat.pages.length &&
      ancien.pages.every((p, i) => p.largeur === etat.pages[i].largeur && p.hauteur === etat.pages[i].hauteur && p.rotation === etat.pages[i].rotation);
    if (reconstruire || !memesPages) this.construirePages();
    else this.invaliderPages();
    this.selection = new Set([...this.selection].filter((i) => i < etat.pages.length));
    if (this.occurrences.length) this.lancerRecherche();
    this.miseAJour();
  }

  construirePages() {
    const etat = this.etat!;
    this.vues.forEach((v) => this.observateur.unobserve(v.el));
    this.conteneurPages.replaceChildren();
    this.vues = etat.pages.map((p, index) => {
      const canvas = el("canvas", { class: "rendu", "aria-hidden": "true" });
      const calque = el("div", { class: "calque" });
      const div = el("div", { class: "page", role: "img", "aria-label": `Page ${index + 1} sur ${etat.pages.length}` }, canvas, calque);
      div.dataset.index = String(index);
      const vue: VuePage = { index, el: div, canvas, calque, echelleRendue: 0, enCours: false, segments: null, champs: null, visible: false };
      this.dimensionnerPage(vue, p);
      this.installerCalque(vue);
      this.conteneurPages.append(div);
      this.observateur.observe(div);
      return vue;
    });
    this.pageCourante = Math.min(this.pageCourante, etat.pages.length - 1);
    this.construireMiniatures();
  }

  dimensionnerPage(vue: VuePage, p = this.etat!.pages[vue.index]) {
    vue.el.style.width = `${p.largeur * this.zoom * PX_PAR_POINT}px`;
    vue.el.style.height = `${p.hauteur * this.zoom * PX_PAR_POINT}px`;
  }

  /** Les pages devront être redessinées (après une modification). */
  invaliderPages(indices?: number[]) {
    for (const v of this.vues) {
      if (indices && !indices.includes(v.index)) continue;
      v.echelleRendue = 0;
      v.segments = null;
      v.champs = null;
      if (v.visible) this.rendrePage(v);
    }
    for (const m of this.listeMiniatures.children) {
      if (!indices || indices.includes(Number((m as HTMLElement).dataset.index))) {
        (m as HTMLElement).dataset.rendue = "";
        this.observateurMiniatures.unobserve(m);
        this.observateurMiniatures.observe(m);
      }
    }
  }

  echelleCible(): number {
    return this.zoom * PX_PAR_POINT * Math.min(window.devicePixelRatio || 1, 3);
  }

  async rendrePage(vue: VuePage) {
    const echelle = this.echelleCible();
    if (vue.enCours || Math.abs(vue.echelleRendue - echelle) < 1e-6 || !this.etat) return;
    vue.enCours = true;
    try {
      const r = await appel("rendre", { page: vue.index, echelle }, { discret: true });
      if (!this.vues.includes(vue)) return;
      vue.canvas.width = r.largeur;
      vue.canvas.height = r.hauteur;
      vue.canvas.getContext("2d")!.putImageData(new ImageData(r.pixels as Uint8ClampedArray<ArrayBuffer>, r.largeur, r.hauteur), 0, 0);
      vue.echelleRendue = echelle;
      await this.preparerCalque(vue);
    } catch (e) {
      this.erreur(e, `Page ${vue.index + 1}`);
    } finally {
      vue.enCours = false;
      // Le zoom a pu changer pendant le rendu.
      if (vue.visible && Math.abs(vue.echelleRendue - this.echelleCible()) > 1e-6) this.rendrePage(vue);
    }
  }

  /** Le calque d'une page : morceaux de texte (mode texte), champs de formulaire, résultats de recherche. */
  async preparerCalque(vue: VuePage) {
    const s = this.zoom * PX_PAR_POINT;
    vue.calque.querySelectorAll(".morceau, .champ, .occurrence").forEach((e) => e.remove());
    if (this.mode === "texte") {
      vue.segments ??= await appel("segments", { page: vue.index }, { discret: true });
      for (const seg of vue.segments) {
        const m = el("div", {
          class: "morceau", role: "button", tabindex: "0", title: seg.texte, "aria-label": `Modifier le texte : ${seg.texte}`,
          style: { left: `${(seg.x0 - 1) * s}px`, top: `${(seg.y0 - 1) * s}px`, width: `${(seg.x1 - seg.x0 + 2) * s}px`, height: `${(seg.y1 - seg.y0 + 2) * s}px` },
        });
        m.addEventListener("click", (e) => {
          e.stopPropagation();
          this.ouvrirEditeur(vue, seg);
        });
        m.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.ouvrirEditeur(vue, seg);
          }
        });
        vue.calque.append(m);
      }
    }
    if (this.mode === "lecture") {
      vue.champs ??= await appel("champs", { page: vue.index }, { discret: true });
      for (const c of vue.champs) vue.calque.append(this.champFormulaire(vue, c, s));
    }
    this.dessinerOccurrences(vue);
  }

  champFormulaire(vue: VuePage, c: Champ, s: number): HTMLElement {
    const style = { left: `${c.rect[0] * s}px`, top: `${c.rect[1] * s}px`, width: `${(c.rect[2] - c.rect[0]) * s}px`, height: `${(c.rect[3] - c.rect[1]) * s}px`, fontSize: `${(c.taille || Math.min(12, (c.rect[3] - c.rect[1]) * 0.7)) * s}px` };
    const valider = async (valeur: string) => {
      try {
        await appel("remplir", { page: vue.index, index: c.index, valeur });
        this.apresModification([vue.index]);
      } catch (e) {
        this.erreur(e, "Impossible de remplir ce champ");
      }
    };
    let champ: HTMLElement;
    if (c.type === "checkbox" || c.type === "radiobutton") {
      const i = el("input", { type: "checkbox", class: "champ", "aria-label": c.nom || "Case à cocher", style });
      i.checked = c.coche;
      i.addEventListener("change", () => valider(i.checked ? "on" : "off"));
      champ = i;
    } else if (c.type === "combobox" || c.type === "listbox") {
      const sel = el("select", { class: "champ", "aria-label": c.nom || "Liste de choix", style });
      for (const o of c.options) sel.append(el("option", { value: o, text: o, selected: o === c.valeur }));
      if (!c.options.includes(c.valeur)) sel.prepend(el("option", { value: "", text: "", selected: true }));
      sel.addEventListener("change", () => valider(sel.value));
      champ = sel;
    } else {
      const t = c.multiligne ? el("textarea", { class: "champ", "aria-label": c.nom || "Champ de texte", style }) : el("input", { type: "text", class: "champ", "aria-label": c.nom || "Champ de texte", style });
      t.value = c.valeur;
      t.addEventListener("change", () => valider(t.value));
      champ = t;
    }
    champ.title = c.nom;
    return champ;
  }

  /** Après une opération sur le document : nouvel état, pages redessinées, document marqué modifié. */
  async apresModification(pages?: number[], etat?: EtatDocument | null) {
    this.modifie = true;
    const nouvel = etat ?? (await appel("etat"));
    if (!nouvel) return;
    const ancien = this.etat;
    this.etat = nouvel;
    const memes = ancien && ancien.pages.length === nouvel.pages.length &&
      ancien.pages.every((p, i) => p.largeur === nouvel.pages[i].largeur && p.hauteur === nouvel.pages[i].hauteur && p.rotation === nouvel.pages[i].rotation);
    if (!memes) this.construirePages();
    else this.invaliderPages(pages);
    this.polices = null;
    if (this.occurrences.length && !this.barreRecherche.hidden) await this.lancerRecherche(false);
    this.miseAJour();
  }

  async annuler() {
    if (!this.etat?.annuler) return;
    const e = await appel("annuler");
    if (!e) return;
    await this.apresModification(undefined, e);
    this.message(`Annulé : ${"fait" in e ? e.fait : ""}.`);
  }

  async retablir() {
    if (!this.etat?.retablir) return;
    const e = await appel("retablir");
    if (!e) return;
    await this.apresModification(undefined, e);
    this.message(`Rétabli : ${"fait" in e ? e.fait : ""}.`);
  }

  /* --- Zoom et navigation -------------------------------------------------------------------------------------- */

  definirZoom(z: number, ancre?: { clientX: number; clientY: number }) {
    z = Math.max(0.1, Math.min(6, z));
    const v = this.visionneuse;
    const r = v.getBoundingClientRect();
    const ax = ancre ? ancre.clientX - r.left : v.clientWidth / 2;
    const ay = ancre ? ancre.clientY - r.top : v.clientHeight / 2;
    const fx = (v.scrollLeft + ax) / Math.max(1, v.scrollWidth), fy = (v.scrollTop + ay) / Math.max(1, v.scrollHeight);
    this.zoom = z;
    for (const vue of this.vues) {
      this.dimensionnerPage(vue);
      vue.calque.querySelectorAll(".morceau, .champ, .occurrence, .editeur, .bulle-police").forEach((e) => e.remove());
      if (vue.visible) this.rendrePage(vue);
    }
    this.editeurOuvert = null;
    // Le point sous la souris (ou le centre) reste en place.
    v.scrollLeft = fx * v.scrollWidth - ax;
    v.scrollTop = fy * v.scrollHeight - ay;
    this.miseAJour();
  }

  pasZoom(sens: number, ancre?: { clientX: number; clientY: number }) {
    const i = sens > 0 ? ZOOMS.findIndex((z) => z > this.zoom + 1e-6) : ZOOMS.findLastIndex((z) => z < this.zoom - 1e-6);
    if (i >= 0) this.definirZoom(ZOOMS[i], ancre);
  }

  ajusterLargeur() {
    if (!this.etat) return;
    const largeur = Math.max(...this.etat.pages.map((p) => p.largeur));
    this.definirZoom((this.visionneuse.clientWidth - (Application.etroit() ? 16 : 48)) / (largeur * PX_PAR_POINT));
  }

  allerA(index: number, options: { y?: number } = {}) {
    if (!this.etat) return;
    index = Math.max(0, Math.min(this.etat.pages.length - 1, Number.isFinite(index) ? index : 0));
    const vue = this.vues[index];
    const haut = vue.el.offsetTop - 12 + (options.y !== undefined ? options.y * this.zoom * PX_PAR_POINT - this.visionneuse.clientHeight / 3 : 0);
    this.visionneuse.scrollTo({ top: Math.max(0, haut), behavior: "auto" });
    this.pageCourante = index;
    this.champPage.value = String(index + 1);
    this.marquerMiniatureCourante();
  }

  suivreDefilement() {
    const milieu = this.visionneuse.scrollTop + this.visionneuse.clientHeight / 3;
    let courante = 0;
    for (const v of this.vues) {
      if (v.el.offsetTop <= milieu) courante = v.index;
      else break;
    }
    if (courante !== this.pageCourante) {
      this.pageCourante = courante;
      this.champPage.value = String(courante + 1);
      this.marquerMiniatureCourante();
    }
  }

  basculerMiniatures() {
    if (Application.etroit()) this.corps.classList.toggle("miniatures-ouvertes");
    else this.corps.classList.toggle("sans-miniatures");
    this.corps.classList.remove("grille");
    this.miseAJour();
  }

  /** Écran de téléphone : la mise en page à barre du bas (même seuil que le CSS). */
  static etroit(): boolean {
    return window.matchMedia("(max-width: 700px)").matches;
  }

  menuAnnoter(ancre: HTMLElement) {
    const mode = (m: Mode, ic: string, texte: string) => ({ icone: ic, texte, coche: this.mode === m, action: () => this.definirMode(this.mode === m ? "lecture" : m) });
    menuFlottant(ancre, "Annoter", [
      mode("lecture", "selection", "Lire et remplir les formulaires"),
      mode("ajout", "ajoutTexte", "Ajouter du texte"),
      mode("surligner", "surligner", "Surligner"),
      mode("note", "note", "Note"),
      mode("dessin", "dessin", "Dessiner"),
      null,
      { icone: "signature", texte: "Signature…", action: () => outils.signature(this) },
      { icone: "image", texte: "Insérer une image…", action: () => outils.image(this) },
    ]);
  }

  menuPlus(ancre: HTMLElement) {
    menuFlottant(ancre, "Plus", [
      { icone: "ajuster", texte: "Ajuster à la largeur", action: () => this.ajusterLargeur() },
      { icone: "plus", texte: "Zoom avant", action: () => this.pasZoom(1) },
      { icone: "moins", texte: "Zoom arrière", action: () => this.pasZoom(-1) },
      null,
      { icone: "telecharger", texte: "Enregistrer sous…", action: () => this.enregistrer(true) },
      { icone: "imprimer", texte: "Imprimer…", action: () => outils.imprimer(this) },
    ]);
  }

  /**
   * Zoom à deux doigts dans le document. Pendant le geste, les pages sont seulement agrandies à l'écran (transformation
   * CSS, fluide) ; au lever des doigts, elles sont redessinées nettes au nouveau zoom, autour du point pincé.
   */
  installerPincement() {
    const v = this.visionneuse;
    let depart: { distance: number; zoom: number; x: number; y: number } | null = null;
    let facteur = 1;
    const mesure = (t: TouchList) => {
      const [a, b] = [t[0], t[1]];
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    v.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2 || !this.etat) return;
      const m = mesure(e.touches);
      depart = { distance: Math.max(1, m.distance), zoom: this.zoom, x: m.x, y: m.y };
      facteur = 1;
      const r = this.conteneurPages.getBoundingClientRect();
      this.conteneurPages.style.transformOrigin = `${m.x - r.left}px ${m.y - r.top}px`;
    }, { passive: true });
    v.addEventListener("touchmove", (e) => {
      if (!depart || e.touches.length !== 2) return;
      e.preventDefault(); // ni défilement ni zoom de toute la page pendant le geste
      const m = mesure(e.touches);
      facteur = Math.max(0.1 / depart.zoom, Math.min(6 / depart.zoom, m.distance / depart.distance));
      this.conteneurPages.style.transform = `scale(${facteur})`;
    }, { passive: false });
    const fin = () => {
      if (!depart) return;
      const d = depart;
      depart = null;
      this.conteneurPages.style.transform = "";
      if (Math.abs(facteur - 1) > 0.02) this.definirZoom(d.zoom * facteur, { clientX: d.x, clientY: d.y });
    };
    v.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) fin();
    });
    v.addEventListener("touchcancel", fin);
  }

  basculerGrille() {
    this.corps.classList.toggle("grille");
    this.corps.classList.remove("sans-miniatures");
    this.miseAJour();
  }

  /* --- Miniatures ---------------------------------------------------------------------------------------------- */

  construireMiniatures() {
    const etat = this.etat!;
    [...this.listeMiniatures.children].forEach((m) => this.observateurMiniatures.unobserve(m));
    this.listeMiniatures.replaceChildren();
    etat.pages.forEach((p, i) => {
      const largeur = 120, hauteur = Math.round((120 * p.hauteur) / p.largeur);
      const canvas = el("canvas", { width: largeur, height: hauteur, style: { width: `${largeur}px`, height: `${hauteur}px` } });
      const m = el("div", { class: "miniature", role: "option", tabindex: i === 0 ? "0" : "-1", draggable: "true", "aria-selected": "false", "aria-label": `Page ${i + 1}` },
        canvas, el("span", { class: "numero", text: String(i + 1) }));
      m.dataset.index = String(i);
      m.addEventListener("click", (e) => this.cliquerMiniature(i, e));
      m.addEventListener("keydown", (e) => this.clavierMiniature(i, e));
      m.addEventListener("dragstart", (e) => {
        if (!this.selection.has(i)) this.selectionner(new Set([i]));
        e.dataTransfer!.setData("application/x-pages", JSON.stringify([...this.selection]));
        e.dataTransfer!.effectAllowed = "move";
      });
      m.addEventListener("dragover", (e) => {
        if (!e.dataTransfer?.types.includes("application/x-pages")) return;
        e.preventDefault();
        const r = m.getBoundingClientRect();
        const grille = this.corps.classList.contains("grille");
        const apres = grille ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        m.classList.toggle("depot-apres", apres);
        m.classList.toggle("depot-avant", !apres);
      });
      m.addEventListener("dragleave", () => m.classList.remove("depot-avant", "depot-apres"));
      m.addEventListener("drop", async (e) => {
        const donnees = e.dataTransfer?.getData("application/x-pages");
        if (!donnees) return;
        e.preventDefault();
        e.stopPropagation();
        const apres = m.classList.contains("depot-apres");
        m.classList.remove("depot-avant", "depot-apres");
        const pages = JSON.parse(donnees) as number[];
        await this.deplacerPages(pages, i + (apres ? 1 : 0));
      });
      this.listeMiniatures.append(m);
      this.observateurMiniatures.observe(m);
    });
    this.marquerMiniatureCourante();
  }

  async rendreMiniature(m: HTMLElement) {
    if (m.dataset.rendue === "1" || !this.etat) return;
    m.dataset.rendue = "1";
    const i = Number(m.dataset.index);
    const p = this.etat.pages[i];
    if (!p) return;
    try {
      const r = await appel("rendre", { page: i, echelle: (120 / p.largeur) * Math.min(window.devicePixelRatio || 1, 2) }, { discret: true });
      const c = m.querySelector("canvas")!;
      c.width = r.largeur;
      c.height = r.hauteur;
      c.getContext("2d")!.putImageData(new ImageData(r.pixels as Uint8ClampedArray<ArrayBuffer>, r.largeur, r.hauteur), 0, 0);
    } catch {
      m.dataset.rendue = "";
    }
  }

  marquerMiniatureCourante() {
    [...this.listeMiniatures.children].forEach((m, i) => {
      m.classList.toggle("courante", i === this.pageCourante);
      m.setAttribute("aria-selected", String(this.selection.has(i)));
    });
  }

  selectionner(s: Set<number>) {
    this.selection = s;
    this.marquerMiniatureCourante();
    this.miseAJour();
  }

  cliquerMiniature(i: number, e: MouseEvent | KeyboardEvent) {
    const s = new Set(this.selection);
    if (e.ctrlKey || e.metaKey) {
      if (s.has(i)) s.delete(i);
      else s.add(i);
    } else if (e.shiftKey && this.selection.size) {
      const debut = Math.min(...this.selection);
      for (let k = Math.min(debut, i); k <= Math.max(debut, i); k++) s.add(k);
    } else {
      s.clear();
      s.add(i);
      this.allerA(i);
    }
    this.selectionner(s);
  }

  clavierMiniature(i: number, e: KeyboardEvent) {
    const n = this.etat?.pages.length ?? 0;
    const focaliser = (k: number) => {
      const m = this.listeMiniatures.children[k] as HTMLElement | undefined;
      if (!m) return;
      [...this.listeMiniatures.children].forEach((x) => x.setAttribute("tabindex", "-1"));
      m.setAttribute("tabindex", "0");
      m.focus();
    };
    if ((e.key === "ArrowDown" || e.key === "ArrowRight") && !e.ctrlKey) {
      e.preventDefault();
      focaliser(Math.min(n - 1, i + 1));
      if (e.shiftKey) this.cliquerMiniature(Math.min(n - 1, i + 1), e);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && !e.ctrlKey) {
      e.preventDefault();
      focaliser(Math.max(0, i - 1));
      if (e.shiftKey) this.cliquerMiniature(Math.max(0, i - 1), e);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.ctrlKey) {
      e.preventDefault();
      this.deplacerSelection(e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.cliquerMiniature(i, e);
    } else if (e.key === "Delete") {
      e.preventDefault();
      this.supprimerSelection();
    }
  }

  pagesChoisies(): number[] {
    return this.selection.size ? [...this.selection].sort((a, b) => a - b) : [this.pageCourante];
  }

  async pivoterSelection(angle: number) {
    const pages = this.pagesChoisies();
    try {
      const e = await appel("pivoter", { pages, angle });
      await this.apresModification(pages, e);
    } catch (e) {
      this.erreur(e);
    }
  }

  async supprimerSelection() {
    const pages = this.pagesChoisies();
    if (!this.etat) return;
    if (pages.length >= this.etat.pages.length) {
      this.message("Un document doit garder au moins une page.", "erreur");
      return;
    }
    try {
      const e = await appel("supprimer", { pages });
      this.selection.clear();
      await this.apresModification(undefined, e);
      this.message(`${pluriel(pages.length, "page supprimée", "pages supprimées")} (Ctrl+Z pour annuler).`);
    } catch (e) {
      this.erreur(e);
    }
  }

  async deplacerPages(pages: number[], avant: number) {
    try {
      const e = await appel("deplacer", { pages, avant });
      const premiere = avant - pages.filter((p) => p < avant).length;
      this.selection = new Set(pages.map((_, k) => premiere + k));
      await this.apresModification(undefined, e);
      this.marquerMiniatureCourante();
    } catch (e) {
      this.erreur(e);
    }
  }

  async deplacerSelection(sens: number) {
    const pages = this.pagesChoisies();
    const n = this.etat?.pages.length ?? 0;
    if (sens < 0 && pages[0] === 0) return;
    if (sens > 0 && pages.at(-1) === n - 1) return;
    await this.deplacerPages(pages, sens < 0 ? pages[0] - 1 : pages.at(-1)! + 2);
    (this.listeMiniatures.children[[...this.selection][0]] as HTMLElement)?.focus();
  }

  async extraireSelection() {
    const pages = this.pagesChoisies();
    try {
      const octets = await appel("extraire", { pages });
      const base = this.nomEnregistrement().replace(/\.pdf$/i, "");
      telecharger(octets, `${base} (pages ${outils.plages(pages)}).pdf`);
      this.message(`${pluriel(pages.length, "page extraite", "pages extraites")} dans un nouveau PDF.`, "succes");
    } catch (e) {
      this.erreur(e);
    }
  }

  async insererPageBlanche() {
    const apres = this.pagesChoisies().at(-1)!;
    const p = this.etat!.pages[apres];
    try {
      const e = await appel("insererPageBlanche", { position: apres + 1, largeur: p.rotation % 180 ? p.hauteur : p.largeur, hauteur: p.rotation % 180 ? p.largeur : p.hauteur });
      await this.apresModification(undefined, e);
      this.allerA(apres + 1);
    } catch (e) {
      this.erreur(e);
    }
  }

  async insererPdf(fichiers?: File[], position?: number) {
    if (!this.etat) return;
    fichiers ??= await choisirFichiers("application/pdf,.pdf", true);
    if (!fichiers.length) return;
    const pos = position ?? this.pagesChoisies().at(-1)! + 1;
    try {
      const sources: { octets: Uint8Array; motDePasse?: string }[] = [];
      for (const f of fichiers) {
        const octets = await lire(f);
        const ok = await this.avecMotDePasse(f.name, async (motDePasse) => {
          await appel("examiner", { octets: octets.slice(), motDePasse });
          return motDePasse ?? "";
        });
        if (ok === null) return;
        sources.push({ octets, motDePasse: ok || undefined });
      }
      const avant = this.etat.pages.length;
      const e = await appel("insererPdf", { fichiers: sources, position: pos });
      await this.apresModification(undefined, e);
      this.message(`${pluriel(e!.pages.length - avant, "page ajoutée", "pages ajoutées")} (Ctrl+Z pour annuler).`, "succes");
      this.allerA(pos);
    } catch (e) {
      this.erreur(e, "Insertion impossible");
    }
  }

  /* --- Modes : texte, ajout, annotations ------------------------------------------------------------------------ */

  definirMode(mode: Mode) {
    this.fermerEditeur();
    this.mode = mode;
    this.visionneuse.classList.toggle("mode-texte", mode === "texte");
    for (const v of this.vues) {
      v.calque.style.cursor = mode === "ajout" || mode === "note" ? "crosshair" : mode === "surligner" ? "text" : "";
      if (v.echelleRendue) this.preparerCalque(v);
    }
    outils.sousBarre(this);
    this.miseAJour();
    const tactile = window.matchMedia("(pointer: coarse)").matches;
    const geste = tactile ? "Touchez" : "Cliquez";
    const aides: Record<Mode, string> = {
      lecture: "",
      texte: tactile ? "Touchez un texte pour le modifier." : "Cliquez sur un texte pour le modifier. Entrée valide, Échap annule.",
      ajout: `${geste} à l’endroit où ajouter du texte.`,
      surligner: "Glissez sur le texte à surligner, souligner ou barrer.",
      note: `${geste} à l’endroit où poser la note.`,
      dessin: "Dessinez sur la page ; chaque trait devient une annotation.",
    };
    if (aides[mode]) this.message(aides[mode], "info", 6000);
  }

  /** Coordonnées en points de la page à partir d'un événement de pointeur. */
  pointDePage(vue: VuePage, e: { clientX: number; clientY: number }): [number, number] {
    const r = vue.el.getBoundingClientRect();
    const s = this.zoom * PX_PAR_POINT;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  }

  installerCalque(vue: VuePage) {
    let depart: [number, number] | null = null;
    let zone: HTMLElement | null = null;
    let trait: [number, number][] = [];
    let trace: HTMLCanvasElement | null = null;
    vue.calque.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest(".editeur, .champ, .placement, .bulle-police")) return;
      const p = this.pointDePage(vue, e);
      if (this.mode === "ajout") {
        e.preventDefault();
        this.editeurAjout(vue, p);
      } else if (this.mode === "note") {
        e.preventDefault();
        this.ajouterNote(vue, p);
      } else if (this.mode === "surligner" || (this.mode === "dessin" && this.reglages.outilDessin !== "main")) {
        e.preventDefault();
        depart = p;
        zone = el("div", { class: "selection-zone" });
        vue.calque.append(zone);
        vue.calque.setPointerCapture(e.pointerId);
      } else if (this.mode === "dessin") {
        e.preventDefault();
        trait = [p];
        trace = el("canvas", { class: "trace" });
        const r = vue.el.getBoundingClientRect();
        trace.width = r.width;
        trace.height = r.height;
        vue.calque.append(trace);
        vue.calque.setPointerCapture(e.pointerId);
      }
    });
    vue.calque.addEventListener("pointermove", (e) => {
      const p = this.pointDePage(vue, e);
      const s = this.zoom * PX_PAR_POINT;
      if (depart && zone) {
        Object.assign(zone.style, {
          left: `${Math.min(depart[0], p[0]) * s}px`, top: `${Math.min(depart[1], p[1]) * s}px`,
          width: `${Math.abs(p[0] - depart[0]) * s}px`, height: `${Math.abs(p[1] - depart[1]) * s}px`,
        });
      } else if (trace && trait.length) {
        const ctx = trace.getContext("2d")!;
        const prec = trait[trait.length - 1];
        ctx.strokeStyle = hexDe(this.reglages.couleurDessin);
        ctx.lineWidth = this.reglages.epaisseur * s;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prec[0] * s, prec[1] * s);
        ctx.lineTo(p[0] * s, p[1] * s);
        ctx.stroke();
        trait.push(p);
      }
    });
    const fin = async (e: PointerEvent) => {
      const p = this.pointDePage(vue, e);
      if (depart && zone) {
        const a = depart;
        depart = null;
        zone.remove();
        zone = null;
        if (Math.hypot(p[0] - a[0], p[1] - a[1]) < 2) return;
        try {
          if (this.mode === "surligner") {
            const ok = await appel("annoterTexte", { page: vue.index, type: this.reglages.typeAnnotation, a, b: p, couleur: this.reglages.couleurAnnotation });
            if (!ok) this.message("Aucun texte à cet endroit : glissez sur des lettres.", "erreur");
            else await this.apresModification([vue.index]);
          } else {
            await appel("ajouterForme", {
              page: vue.index, type: this.reglages.outilDessin as "Square" | "Circle",
              rect: [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[0], p[0]), Math.max(a[1], p[1])],
              couleur: this.reglages.couleurDessin, epaisseur: this.reglages.epaisseur,
            });
            await this.apresModification([vue.index]);
          }
        } catch (err) {
          this.erreur(err);
        }
      } else if (trace) {
        const t = trait;
        trait = [];
        const c = trace;
        trace = null;
        if (t.length > 1) {
          try {
            await appel("ajouterDessin", { page: vue.index, traits: [t], couleur: this.reglages.couleurDessin, epaisseur: this.reglages.epaisseur });
            await this.apresModification([vue.index]);
          } catch (err) {
            this.erreur(err);
          }
        }
        c.remove();
      }
    };
    vue.calque.addEventListener("pointerup", fin);
    vue.calque.addEventListener("pointercancel", () => {
      depart = null;
      zone?.remove();
      trace?.remove();
      trace = null;
    });
  }

  fermerEditeur() {
    this.editeurOuvert?.();
    this.editeurOuvert = null;
  }

  /** Police CSS proche de celle du PDF, pour que la saisie ressemble au résultat. */
  styleDePolice(nom: string, gras: boolean, italique: boolean): Partial<CSSStyleDeclaration> {
    const n = nom.toLowerCase();
    const famille = /mono|courier|consol/.test(n) ? "\"Courier New\", Courier, monospace"
      : !/sans/.test(n) && /times|georgia|garamond|cambria|serif|roman|palatino|book/.test(n) ? "\"Times New Roman\", Times, serif"
      : "Arial, Helvetica, sans-serif";
    return { fontFamily: famille, fontWeight: gras || /bold|black|heavy|semibold/.test(n) ? "700" : "400", fontStyle: italique || /italic|oblique/.test(n) ? "italic" : "normal" };
  }

  async ouvrirEditeur(vue: VuePage, seg: Segment) {
    this.fermerEditeur();
    const s = this.zoom * PX_PAR_POINT;
    const champ = el("input", { type: "text", class: "editeur", "aria-label": "Nouveau texte", spellcheck: "true", lang: "fr" });
    champ.value = seg.texte;
    Object.assign(champ.style, {
      left: `${(seg.x0 - 3) * s}px`, top: `${(seg.y0 - 3) * s}px`, minWidth: `${(seg.x1 - seg.x0 + 6) * s}px`, height: `${(seg.y1 - seg.y0 + 6) * s}px`,
      width: `${Math.max(seg.x1 - seg.x0 + 6, seg.texte.length * seg.taille * 0.6) * s}px`,
      fontSize: `${seg.taille * s}px`, color: `#${seg.couleur.toString(16).padStart(6, "0")}`,
      ...this.styleDePolice(seg.police, seg.gras, seg.italique),
    });
    const nomPolice = seg.police.replace(/^[A-Z]{6}\+/, "");
    const bulle = el("div", { class: "bulle-police", style: { left: `${seg.x0 * s}px`, top: `${(seg.y1 + 4) * s + 4}px` } },
      el("span", { text: `Police : ${nomPolice}, ${Math.round(seg.taille * 10) / 10} pt` }));
    const infos = el("button", { type: "button", text: "Infos sur la police" });
    infos.addEventListener("mousedown", (e) => e.preventDefault());
    infos.addEventListener("click", () => outils.infosPolices(this, seg.police));
    bulle.append(infos);
    vue.calque.append(champ, bulle);
    // La bulle reste dans la page, même sur un écran étroit (elle passe alors sur deux lignes).
    const largeurPage = vue.calque.clientWidth;
    bulle.style.maxWidth = `${Math.max(120, largeurPage - 8)}px`;
    const depasse = seg.x0 * s + bulle.offsetWidth - (largeurPage - 4);
    if (depasse > 0) bulle.style.left = `${Math.max(4, seg.x0 * s - depasse)}px`;
    let fini = false;
    const fermer = () => {
      fini = true;
      champ.remove();
      bulle.remove();
      if (this.editeurOuvert === fermer) this.editeurOuvert = null;
    };
    this.editeurOuvert = fermer;
    champ.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer();
        (vue.calque.querySelector(".morceau") as HTMLElement | null)?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const texte = champ.value;
        fermer();
        if (texte === seg.texte) return;
        await this.modifierMorceau(vue, seg, texte);
      }
    });
    // Comme sur PC, un clic ailleurs dans la page annule la saisie (mais pas un passage dans une autre fenêtre).
    champ.addEventListener("blur", () => setTimeout(() => {
      if (!fini && document.hasFocus() && !document.querySelector("dialog[open]")) fermer();
    }, 150));
    champ.focus();
    champ.select();
    // Avertissement si la police d'origine n'est pas intégrée au PDF.
    try {
      this.polices ??= await outils.policesDuDocument();
      const info = this.polices.find((p) => p.nomPdf === nomPolice || p.nomPdf.replace(/[^a-z0-9]/gi, "").toLowerCase() === nomPolice.replace(/[^a-z0-9]/gi, "").toLowerCase());
      if (info && !fini) {
        bulle.firstElementChild!.textContent = `Police : ${nomPolice}, ${Math.round(seg.taille * 10) / 10} pt — ${info.integree ? (info.sousEnsemble ? "intégrée (lettres utilisées seulement)" : "intégrée") : "non intégrée au PDF"}`;
      }
    } catch {
      /* simple information */
    }
  }

  async modifierMorceau(vue: VuePage, seg: Segment, texte: string) {
    try {
      const [bilan] = await appel("modifierTexte", { page: vue.index, editions: [{ cible: { texte: seg.texte, origineX: seg.origineX, origineY: seg.origineY }, texte }] });
      await this.apresModification([vue.index]);
      this.message(bilan.message, bilan.conservee ? "succes" : "info", bilan.conservee ? 8000 : 15000);
    } catch (e) {
      this.erreur(e, "Modification refusée");
    }
  }

  editeurAjout(vue: VuePage, p: [number, number]) {
    this.fermerEditeur();
    const s = this.zoom * PX_PAR_POINT;
    const r = this.reglages;
    const champ = el("textarea", { class: "editeur", rows: 1, "aria-label": "Texte à ajouter (Entrée pour valider, Maj+Entrée pour aller à la ligne)", lang: "fr" });
    Object.assign(champ.style, {
      left: `${p[0] * s}px`, top: `${p[1] * s}px`, fontSize: `${r.taille * s}px`, color: r.couleurTexte, minWidth: `${120 * s}px`,
      ...this.styleDePolice(r.police, r.gras, r.italique),
    });
    const ajuster = () => {
      champ.style.height = "auto";
      champ.style.height = `${champ.scrollHeight + 4}px`;
      champ.style.width = "auto";
      champ.style.width = `${Math.max(120 * s, champ.scrollWidth + 8)}px`;
    };
    champ.addEventListener("input", ajuster);
    vue.calque.append(champ);
    let fini = false;
    const fermer = () => {
      fini = true;
      champ.remove();
      if (this.editeurOuvert === fermer) this.editeurOuvert = null;
    };
    this.editeurOuvert = fermer;
    champ.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fermer();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const texte = champ.value;
        fermer();
        if (!texte.trim()) return;
        try {
          const couleur = parseInt(r.couleurTexte.slice(1), 16);
          // Le clic marque le haut du texte : la ligne de base est un peu plus bas.
          const e2 = await appel("ajouterTexte", { page: vue.index, x: p[0] + 2, y: p[1] + r.taille * 0.95, texte, taille: r.taille, couleur, police: r.police, gras: r.gras, italique: r.italique });
          await this.apresModification([vue.index], e2);
          this.message("Texte ajouté (Ctrl+Z pour annuler).", "succes");
        } catch (err) {
          this.erreur(err, "Ajout impossible");
        }
      }
    });
    champ.addEventListener("blur", () => setTimeout(() => {
      if (!fini && document.hasFocus() && !champ.value.trim()) fermer();
    }, 150));
    setTimeout(() => champ.focus(), 0);
  }

  async ajouterNote(vue: VuePage, p: [number, number]) {
    const texte = await demander("Nouvelle note", "Texte de la note :", { multiligne: true, valider: "Ajouter" });
    if (!texte?.trim()) return;
    try {
      await appel("ajouterNote", { page: vue.index, point: p, texte, couleur: this.reglages.couleurAnnotation });
      await this.apresModification([vue.index]);
      this.message("Note ajoutée (Ctrl+Z pour annuler).", "succes");
    } catch (e) {
      this.erreur(e);
    }
  }

  /* --- Recherche ------------------------------------------------------------------------------------------------- */

  champRecherche: HTMLInputElement | null = null;
  champRemplacement: HTMLInputElement | null = null;
  caseCasse: HTMLInputElement | null = null;
  caseAccents: HTMLInputElement | null = null;
  compteRecherche: HTMLElement | null = null;
  minuterieRecherche = 0;

  afficherRecherche(remplacer = false) {
    if (!this.etat) return;
    if (this.barreRecherche.hidden) {
      this.champRecherche = el("input", { type: "search", "aria-label": "Rechercher", placeholder: "Rechercher…" });
      this.champRemplacement = el("input", { type: "text", "aria-label": "Remplacer par", placeholder: "Remplacer par…" });
      this.caseCasse = el("input", { type: "checkbox" });
      this.caseAccents = el("input", { type: "checkbox" });
      this.compteRecherche = el("span", { class: "compte", "aria-live": "polite" });
      const relancer = () => {
        clearTimeout(this.minuterieRecherche);
        this.minuterieRecherche = window.setTimeout(() => this.lancerRecherche(true), 250);
      };
      this.champRecherche.addEventListener("input", relancer);
      this.caseCasse.addEventListener("change", relancer);
      this.caseAccents.addEventListener("change", relancer);
      this.champRecherche.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.occurrenceSuivante(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") this.fermerRecherche();
      });
      this.champRemplacement.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.fermerRecherche();
      });
      this.barreRecherche.replaceChildren(
        this.champRecherche,
        bouton("haut", "Occurrence précédente", () => this.occurrenceSuivante(-1), { texte: false, raccourci: "Maj+F3" }),
        bouton("bas", "Occurrence suivante", () => this.occurrenceSuivante(1), { texte: false, raccourci: "F3" }),
        this.compteRecherche,
        el("label", {}, this.caseCasse, "Respecter les majuscules"),
        el("label", {}, this.caseAccents, "Respecter les accents"),
        this.champRemplacement,
        el("button", { type: "button", class: "bouton cadre", text: "Remplacer", onclick: () => this.remplacer(false) }),
        el("button", { type: "button", class: "bouton cadre", text: "Tout remplacer", onclick: () => this.remplacer(true) }),
        bouton("fermer", "Fermer la recherche", () => this.fermerRecherche(), { texte: false }),
      );
      this.barreRecherche.hidden = false;
      this.miseAJour();
    }
    (remplacer ? this.champRemplacement : this.champRecherche)!.focus();
    this.champRecherche!.select();
  }

  fermerRecherche() {
    this.barreRecherche.hidden = true;
    this.occurrences = [];
    this.occurrenceCourante = -1;
    this.vues.forEach((v) => this.dessinerOccurrences(v));
    this.miseAJour();
  }

  async lancerRecherche(reinitialiser = false) {
    const aiguille = this.champRecherche?.value ?? "";
    if (!aiguille.trim() || !this.etat) {
      this.occurrences = [];
      this.occurrenceCourante = -1;
    } else {
      this.occurrences = await appel("chercher", { aiguille, casse: !!this.caseCasse?.checked, accents: !!this.caseAccents?.checked });
      if (reinitialiser || this.occurrenceCourante < 0) {
        const k = this.occurrences.findIndex((o) => o.page >= this.pageCourante);
        this.occurrenceCourante = this.occurrences.length ? Math.max(0, k) : -1;
      } else this.occurrenceCourante = Math.min(this.occurrenceCourante, this.occurrences.length - 1);
    }
    this.vues.forEach((v) => this.dessinerOccurrences(v));
    this.majCompte();
    if (reinitialiser && this.occurrenceCourante >= 0) this.montrerOccurrence();
  }

  majCompte() {
    if (!this.compteRecherche) return;
    const n = this.occurrences.length;
    this.compteRecherche.textContent = !this.champRecherche?.value ? "" : n ? `${this.occurrenceCourante + 1} sur ${n}` : "Aucun résultat";
  }

  dessinerOccurrences(vue: VuePage) {
    vue.calque.querySelectorAll(".occurrence").forEach((e) => e.remove());
    const s = this.zoom * PX_PAR_POINT;
    this.occurrences.forEach((o, k) => {
      if (o.page !== vue.index) return;
      const [x0, y0, x1, y1] = o.rect;
      vue.calque.append(el("div", {
        class: `occurrence${k === this.occurrenceCourante ? " courante" : ""}`,
        style: { left: `${x0 * s}px`, top: `${y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px` },
      }));
    });
  }

  montrerOccurrence() {
    const o = this.occurrences[this.occurrenceCourante];
    if (!o) return;
    this.allerA(o.page, { y: o.rect[1] });
    this.vues.forEach((v) => this.dessinerOccurrences(v));
    this.majCompte();
  }

  occurrenceSuivante(sens: number) {
    if (this.barreRecherche.hidden) {
      this.afficherRecherche();
      return;
    }
    if (!this.occurrences.length) return;
    this.occurrenceCourante = (this.occurrenceCourante + sens + this.occurrences.length) % this.occurrences.length;
    this.montrerOccurrence();
  }

  async remplacer(tout: boolean) {
    if (!this.occurrences.length) return;
    const remplacement = this.champRemplacement!.value;
    const liste = tout ? this.occurrences : [this.occurrences[this.occurrenceCourante]];
    try {
      const bilans = await appel("remplacer_occurrences", { occurrences: liste, remplacement });
      const pages = [...new Set(liste.map((o) => o.page))];
      await this.apresModification(pages);
      await this.lancerRecherche(false);
      let msg = tout ? `${pluriel(liste.length, "occurrence remplacée", "occurrences remplacées")} (Ctrl+Z pour annuler).` : bilans[0]?.message ?? "Remplacé.";
      if (tout && bilans.some((b) => !b.conservee)) msg += " Certaines lettres absentes de la police d’origine ont été prises dans une police proche.";
      this.message(msg, "succes", 12000);
      if (!tout) this.montrerOccurrence();
    } catch (e) {
      this.erreur(e, "Remplacement refusé");
    }
  }

  /* --- Glisser-déposer et clavier ------------------------------------------------------------------------------ */

  installerGlisserDeposer() {
    let profondeur = 0;
    const fichiersGlisses = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    window.addEventListener("dragenter", (e) => {
      if (!fichiersGlisses(e)) return;
      profondeur++;
      document.body.classList.add("glisse");
    });
    window.addEventListener("dragleave", (e) => {
      if (!fichiersGlisses(e)) return;
      if (--profondeur <= 0) document.body.classList.remove("glisse");
    });
    window.addEventListener("dragover", (e) => {
      if (fichiersGlisses(e)) e.preventDefault();
    });
    window.addEventListener("drop", async (e) => {
      if (!fichiersGlisses(e)) return;
      e.preventDefault();
      profondeur = 0;
      document.body.classList.remove("glisse");
      const fichiers = [...(e.dataTransfer?.files ?? [])];
      const pdfs = fichiers.filter(estPdf);
      if (!pdfs.length) {
        if (fichiers.some((f) => f.type.startsWith("image/"))) {
          if (this.etat) outils.image(this, fichiers.find((f) => f.type.startsWith("image/")));
          else outils.photoIdentite(this, fichiers.find((f) => f.type.startsWith("image/")));
        } else this.message("Seuls les fichiers PDF et les images peuvent être déposés ici.", "erreur");
        return;
      }
      if (!this.etat) {
        if (pdfs.length > 1) outils.fusion(this, pdfs);
        else await this.ouvrirFichier(pdfs[0], null);
        return;
      }
      // Comme sur PC, un PDF glissé sur le document ouvert est ajouté à la fin.
      const r = await confirmer("PDF déposé", `${pdfs.length > 1 ? `Ajouter ces ${pdfs.length} PDF` : `Ajouter « ${pdfs[0].name} »`} à la fin du document ouvert ?`, "Ajouter à la fin", { autre: pdfs.length === 1 ? "Ouvrir à la place" : undefined });
      if (r === true) await this.insererPdf(pdfs, this.etat.pages.length);
      else if (r === "autre" && (await this.peutQuitter())) await this.ouvrirFichier(pdfs[0], null);
    });
  }

  installerClavier() {
    window.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]")) return;
      const cible = e.target as HTMLElement;
      const saisie = cible.closest("input, textarea, select, [contenteditable]") !== null;
      const ctrl = e.ctrlKey || e.metaKey;
      const touche = e.key.toLowerCase();
      if (ctrl && touche === "o") {
        e.preventDefault();
        this.ouvrirDialogue();
      } else if (ctrl && touche === "s") {
        e.preventDefault();
        this.enregistrer(e.shiftKey);
      } else if (!this.etat) {
        return;
      } else if (ctrl && touche === "p") {
        e.preventDefault();
        outils.imprimer(this);
      } else if (ctrl && touche === "f") {
        e.preventDefault();
        this.afficherRecherche();
      } else if (ctrl && touche === "h") {
        e.preventDefault();
        this.afficherRecherche(true);
      } else if (ctrl && touche === "g") {
        e.preventDefault();
        this.champPage.focus();
        this.champPage.select();
      } else if (e.key === "F3") {
        e.preventDefault();
        this.occurrenceSuivante(e.shiftKey ? -1 : 1);
      } else if (saisie) {
        return;
      } else if (ctrl && touche === "z") {
        e.preventDefault();
        if (e.shiftKey) this.retablir();
        else this.annuler();
      } else if (ctrl && touche === "y") {
        e.preventDefault();
        this.retablir();
      } else if (ctrl && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        this.pasZoom(1);
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        this.pasZoom(-1);
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        this.definirZoom(1);
      } else if (e.key === "Escape") {
        if (this.placement) return;
        if (this.mode !== "lecture") this.definirMode("lecture");
      } else if (!ctrl && !e.altKey && touche === "t") {
        this.definirMode(this.mode === "texte" ? "lecture" : "texte");
      } else if (e.key === "PageDown" && cible.closest(".visionneuse") === null) {
        this.allerA(this.pageCourante + 1);
      } else if (e.key === "PageUp" && cible.closest(".visionneuse") === null) {
        this.allerA(this.pageCourante - 1);
      }
    });
  }

  /** La vue de la page affichée (pour poser une image ou une signature). */
  vueCourante(): VuePage | null {
    return this.vues[this.pageCourante] ?? null;
  }

  /** Taille d'un point de PDF à l'écran. */
  get echelleEcran() {
    return this.zoom * PX_PAR_POINT;
  }

  async demanderTexte(titre: string, libelle: string) {
    return demander(titre, libelle);
  }

  fenetre = fenetre;
  informer = informer;
  icone = icone;
}
