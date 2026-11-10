/**
 * Comparer deux PDF (CompareDialog sur PC) : les deux versions côte à côte, ou superposées (rouge : seulement dans A,
 * vert : seulement dans B), pages appariées, différences surlignées (ajouts en vert, suppressions en rouge,
 * modifications en orange, changements visuels encadrés en violet), liste des différences regroupées par page, et
 * rapport PDF.
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { choisirFichiers, el, estPdf, fenetre, lire, pluriel, telecharger } from "./dom";
import { icone } from "./icones";
import {
  decompte, description, MODES, REGLAGES, resume, titrePaire, TYPES, TYPES_TEXTE, type Difference, type Mode, type Reglage, type Resultat,
} from "../moteur/comparaisonTextes";

interface Version {
  nom: string;
  pages: { largeur: number; hauteur: number }[];
}

export async function vueComparaison(app: Application) {
  const f = fenetre("Comparer deux PDF", { classe: "plein" });
  f.corps.style.padding = "0";
  f.corps.style.overflow = "hidden";
  f.corps.style.flex = "1";
  f.pied.remove();
  const versions: { a: Version | null; b: Version | null } = { a: null, b: null };
  let resultat: Resultat | null = null;
  let courant = -1;

  const mode = el("select", { class: "entree", "aria-label": "Type de comparaison" });
  for (const [v, t] of Object.entries(MODES)) mode.append(el("option", { value: v, text: t }));
  const casse = el("input", { type: "checkbox" });
  const ponctuation = el("input", { type: "checkbox" });
  const tolerance = el("input", { type: "range", min: "0", max: "50", value: "10", "aria-label": "Tolérance de la comparaison visuelle" });
  const valeurTolerance = el("output", { text: "10 %" });
  tolerance.addEventListener("input", () => (valeurTolerance.textContent = `${tolerance.value} %`));
  // Réglage : « Plan technique » regarde plus finement (circuits imprimés, dessins) ; la tolérance suit le réglage.
  const reglage = el("select", { class: "entree", "aria-label": "Réglage de la comparaison" });
  for (const [v, [t]] of Object.entries(REGLAGES)) reglage.append(el("option", { value: v, text: t }));
  reglage.addEventListener("change", () => {
    tolerance.value = String(REGLAGES[reglage.value as Reglage][1]);
    valeurTolerance.textContent = `${tolerance.value} %`;
  });
  // Affichage : côte à côte, ou superposées (sur téléphone, d'office : deux pages côte à côte y seraient minuscules).
  const affichage = el("select", { class: "entree", "aria-label": "Affichage des deux versions" },
    el("option", { value: "cote", text: "Côte à côte" }), el("option", { value: "superposees", text: "Superposées" }));
  if (window.matchMedia("(max-width: 700px)").matches) affichage.value = "superposees";
  const superposees = () => affichage.value === "superposees";
  const lancer = el("button", { type: "button", class: "bouton principal", html: `${icone("comparer")}<span>Comparer</span>`, disabled: true });
  const rapport = el("button", { type: "button", class: "bouton cadre", html: `${icone("rapport")}<span>Rapport PDF</span>`, disabled: true });
  const progression = el("div", { class: "barre-progression", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, el("div"));
  const etat = el("span", { class: "aide", "aria-live": "polite" });

  const zoneVersion = (cote: "a" | "b") => {
    const nom = el("span", { class: "nom", text: "Aucun fichier" });
    const choisir = el("button", { type: "button", class: "bouton cadre", text: "Choisir un PDF…" });
    // Comme sur PC : les différences se lisent de l'ancienne version vers la nouvelle (un mot présent seulement dans
    // la nouvelle est un ajout). Les libellés le disent, et « Inverser » échange les deux.
    const titre = cote === "a" ? "Version A (ancienne)" : "Version B (nouvelle)";
    const zone = el("div", { class: "version" }, el("strong", { text: titre }), nom, choisir);
    const afficherNom = () => {
      const v = versions[cote];
      nom.textContent = v ? `${v.nom} — ${pluriel(v.pages.length, "page")}` : "Aucun fichier";
    };
    const charger = async (fichier: File | null) => {
      try {
        let r: { pages: Version["pages"] } | null;
        let n: string;
        if (fichier) {
          const octets = await lire(fichier);
          n = fichier.name;
          r = await app.avecMotDePasse(fichier.name, (motDePasse) => appel("chargerComparaison", { cote, octets: octets.slice(), nom: n, motDePasse }));
        } else {
          n = app.fichier?.nom ?? app.etat!.nom;
          r = await appel("chargerComparaison", { cote, nom: n });
          n += " (document ouvert)";
        }
        if (!r) return;
        versions[cote] = { nom: n, pages: r.pages };
        afficherNom();
        lancer.disabled = !(versions.a && versions.b);
        resultat = null;
        rapport.disabled = true;
      } catch (e) {
        etat.textContent = `Impossible d’ouvrir ce fichier : ${(e as Error).message}`;
      }
    };
    choisir.addEventListener("click", async () => {
      const [fi] = await choisirFichiers("application/pdf,.pdf");
      if (fi) await charger(fi);
    });
    zone.addEventListener("dragover", (e) => e.preventDefault());
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fi = [...(e.dataTransfer?.files ?? [])].find(estPdf);
      if (fi) charger(fi);
    });
    return { zone, charger, afficherNom };
  };
  const za = zoneVersion("a"), zb = zoneVersion("b");
  const inverser = el("button", { type: "button", class: "bouton cadre", text: "⇄ Inverser", title: "Échanger l’ancienne et la nouvelle version" });
  inverser.addEventListener("click", async () => {
    await appel("inverserComparaison");
    [versions.a, versions.b] = [versions.b, versions.a];
    za.afficherNom();
    zb.afficherNom();
    resultat = null;
    courant = -1;
    rapport.disabled = true;
    liste.replaceChildren();
    cote.replaceChildren();
    etat.textContent = "Versions inversées : relancez la comparaison.";
  });

  const liste = el("nav", { class: "differences", "aria-label": "Liste des différences" });
  const cote = el("div", { class: "cote-a-cote", tabindex: "-1" });
  const legende = el("div", { class: "legende" });
  const majLegende = () => legende.replaceChildren(...(superposees()
    ? ([["#ff0000", "seulement dans A"], ["#00c000", "seulement dans B"], ["#000000", "identique"]] as const)
    : (["ajout", "suppression", "modification", "visuel"] as const).map((t) => [TYPES[t][0], TYPES[t][1]] as const))
    .map(([couleur, texte]) => el("span", {}, el("i", { style: { background: couleur } }), texte)));
  majLegende();
  affichage.addEventListener("change", () => {
    majLegende();
    if (!resultat) return;
    // L'endroit regardé est gardé (même couple de pages, même hauteur dans la page, même point en largeur), au lieu de
    // revenir à la différence en cours : on change d'affichage pour regarder le même endroit autrement.
    const position = positionVisible();
    afficher();
    if (courant >= 0) marquerCourante();
    if (position) restaurerPosition(position);
  });

  /** Le couple de pages en haut de la vue, la hauteur et le point du milieu en largeur, en fraction de sa première page. */
  const positionVisible = () => {
    const vue = cote.getBoundingClientRect();
    const sections = [...cote.querySelectorAll<HTMLElement>("section.paire")];
    const section = sections.find((s) => s.getBoundingClientRect().bottom > vue.top + 1) ?? sections[0];
    if (!section) return null;
    const page = (section.querySelector(".page-comparee") as HTMLElement | null)?.getBoundingClientRect() ?? section.getBoundingClientRect();
    return { paire: section.dataset.paire!, haut: (vue.top - page.top) / page.height, milieu: (vue.left + vue.width / 2 - page.left) / page.width };
  };
  const restaurerPosition = (p: { paire: string; haut: number; milieu: number }) => {
    const section = cote.querySelector<HTMLElement>(`section.paire[data-paire="${p.paire}"]`);
    if (!section) return;
    const vue = cote.getBoundingClientRect();
    const page = (section.querySelector(".page-comparee") as HTMLElement | null)?.getBoundingClientRect() ?? section.getBoundingClientRect();
    cote.scrollTop += page.top + p.haut * page.height - vue.top;
    cote.scrollLeft += page.left + p.milieu * page.width - (vue.left + vue.width / 2);
  };
  /* --- Zoom (Ctrl+molette, pincement) ----------------------------------------------------------------------------------
   * Chaque page est dans une fenêtre de la largeur de sa colonne ; le zoom agrandit la page dans sa fenêtre. Toutes les
   * pages partagent le même zoom et le même décalage horizontal : en côte à côte, A et B montrent toujours la même zone,
   * et le défilement vertical, commun aux deux colonnes, les garde alignées. */
  let zoom = 1;
  /** Décalage horizontal, en fraction de la largeur de la page (0 : bord gauche visible). */
  let decalage = 0;
  let largeurBase = 0;
  const ZOOM_MAX = 8;
  const fenetres: { fenetre: HTMLElement; page: HTMLElement; hauteur: number }[] = [];
  const borner = () => {
    decalage = Math.min(Math.max(0, decalage), Math.max(0, 1 - 1 / zoom));
  };
  /** Applique zoom et décalage aux pages déjà affichées (les images sont étirées, puis recalculées plus nettes). */
  const appliquerZoom = () => {
    borner();
    const l = largeurBase * zoom;
    for (const { fenetre, page, hauteur } of fenetres) {
      fenetre.style.height = `${hauteur * zoom}px`;
      page.style.width = `${l}px`;
      page.style.height = `${hauteur * zoom}px`;
      page.style.transform = `translateX(${-decalage * l}px)`;
    }
    valeurZoom.textContent = `${Math.round(zoom * 100)} %`;
    cote.classList.toggle("zoomee", zoom > 1);
    clearTimeout(minuterieNettete);
    minuterieNettete = window.setTimeout(() => {
      // Recalcul à la nouvelle définition des pages visibles (les autres le seront en entrant dans la vue).
      for (const r of rendus) {
        if (r.largeur === l) continue;
        r.largeur = l;
        r.fait = false;
        observateur.unobserve(r.canvas.parentElement!);
        observateur.observe(r.canvas.parentElement!);
      }
    }, 200);
  };
  let minuterieNettete = 0;
  /** Change le zoom en gardant immobile le point (clientX, clientY) de l'écran. */
  const zoomer = (nouveau: number, clientX?: number, clientY?: number) => {
    nouveau = Math.min(ZOOM_MAX, Math.max(1, nouveau));
    if (nouveau === zoom || !fenetres.length) return;
    const vue = cote.getBoundingClientRect();
    const x = clientX ?? vue.left + vue.width / 2;
    const y = clientY ?? vue.top + vue.height / 2;
    // Page sous le point (ou la plus proche verticalement), et position du point en fraction de cette page.
    const sous = fenetres.find(({ fenetre }) => {
      const b = fenetre.getBoundingClientRect();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    }) ?? fenetres.reduce((m, f) => {
      const b = f.fenetre.getBoundingClientRect();
      const d = Math.abs((b.top + b.bottom) / 2 - y);
      return !m || d < m.d ? { f, d } : m;
    }, null as { f: (typeof fenetres)[number]; d: number } | null)?.f;
    if (!sous) return;
    const avantF = sous.fenetre.getBoundingClientRect();
    const avantP = sous.page.getBoundingClientRect();
    const fx = (x - avantP.left) / avantP.width;
    const fy = (y - avantP.top) / avantP.height;
    zoom = nouveau;
    // Horizontal : le même point de la page reste sous le pointeur.
    decalage = fx - (x - avantF.left) / (largeurBase * zoom);
    appliquerZoom();
    // Vertical : on fait défiler pour ramener ce point à la même hauteur.
    const apres = sous.page.getBoundingClientRect();
    cote.scrollTop += apres.top + fy * apres.height - y;
  };
  cote.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+molette (et pincement sur un pavé tactile, qui arrive ainsi) : zoom autour du pointeur.
      e.preventDefault();
      const pas = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomer(zoom * Math.exp(-pas * 0.0025), e.clientX, e.clientY);
    } else if (zoom > 1 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      // Défilement horizontal (Maj+molette, pavé tactile) : les pages se décalent ensemble.
      e.preventDefault();
      const d = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      decalage += d / (largeurBase * zoom);
      appliquerZoom();
    }
  }, { passive: false });
  // Glisser dans une page zoomée : déplace la vue (horizontalement le décalage commun, verticalement le défilement).
  let glisse: { x: number; y: number; decalage: number; haut: number } | null = null;
  cote.addEventListener("pointerdown", (e) => {
    if (zoom <= 1 || e.button !== 0 || !(e.target as HTMLElement).closest(".fenetre-page")) return;
    glisse = { x: e.clientX, y: e.clientY, decalage, haut: cote.scrollTop };
    cote.setPointerCapture(e.pointerId);
    cote.classList.add("glisse");
  });
  cote.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    decalage = glisse.decalage - (e.clientX - glisse.x) / (largeurBase * zoom);
    cote.scrollTop = glisse.haut - (e.clientY - glisse.y);
    appliquerZoom();
  });
  const finGlisse = () => {
    glisse = null;
    cote.classList.remove("glisse");
  };
  cote.addEventListener("pointerup", finGlisse);
  cote.addEventListener("pointercancel", finGlisse);
  cote.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "0") zoomer(1);
    else if (e.key === "+" || e.key === "=") zoomer(zoom * 1.25);
    else if (e.key === "-") zoomer(zoom / 1.25);
    else return;
    e.preventDefault();
  });
  const valeurZoom = el("span", { class: "valeur-zoom", text: "100 %" });
  const commandesZoom = el("span", { class: "zoom-comparaison", title: "Ctrl+molette sur les pages : zoom autour du pointeur ; glisser pour se déplacer" },
    el("button", { type: "button", class: "bouton cadre", text: "−", "aria-label": "Zoom arrière", onclick: () => zoomer(zoom / 1.25) }),
    valeurZoom,
    el("button", { type: "button", class: "bouton cadre", text: "+", "aria-label": "Zoom avant", onclick: () => zoomer(zoom * 1.25) }),
    el("button", { type: "button", class: "bouton cadre", text: "100 %", "aria-label": "Revenir à la page entière", onclick: () => zoomer(1) }));

  // Sur téléphone, les options et les fichiers se replient après la comparaison pour laisser la place aux pages ; ce
  // bouton (caché sur ordinateur) les rouvre.
  const plier = el("button", { type: "button", class: "bouton cadre plier", text: "Options et fichiers", "aria-expanded": "true" });
  const comparaison = el("div", { class: "comparaison" },
    el("div", { class: "reglages" },
      el("label", { class: "option" }, "Comparer :", mode), el("label", { class: "option" }, "Réglage :", reglage),
      el("label", { class: "option" }, casse, "Ignorer les majuscules"), el("label", { class: "option" }, ponctuation, "Ignorer la ponctuation"),
      el("label", { class: "curseur option" }, "Tolérance visuelle", tolerance, valeurTolerance),
      el("label", {}, "Affichage :", affichage), commandesZoom,
      lancer, rapport, plier, el("span", { style: { flex: "1", minWidth: "120px" } }, progression, etat), legende),
    el("div", { class: "versions" }, za.zone, inverser, zb.zone),
    el("div", { class: "resultats" }, liste, cote));
  const replier = (replie: boolean) => {
    comparaison.classList.toggle("replie", replie);
    plier.setAttribute("aria-expanded", String(!replie));
  };
  plier.addEventListener("click", () => replier(!comparaison.classList.contains("replie")));
  f.corps.append(comparaison);

  if (app.etat) await za.charger(null);

  /* --- Affichage du résultat --------------------------------------------------------------------------------------- */

  // Côte à côte : deux colonnes ; superposées : une seule, aussi large que possible (sans dépasser 1100 px).
  const largeurColonne = () => (superposees() ? Math.max(200, Math.min(1100, cote.clientWidth - 32)) : Math.max(200, (cote.clientWidth - 64) / 2));
  const rendus: { canvas: HTMLCanvasElement; cote: "a" | "b"; page: number; largeur: number; fait: boolean; avec?: number }[] = [];
  const observateur = new IntersectionObserver((entrees) => {
    for (const e of entrees) {
      if (!e.isIntersecting) continue;
      const r = rendus.find((x) => x.canvas.parentElement === e.target);
      if (!r || r.fait) continue;
      r.fait = true;
      const echelle = (r.largeur / versions[r.cote]!.pages[r.page].largeur) * Math.min(2, window.devicePixelRatio || 1);
      // Superposées : la page de A et sa page appariée de B, calculées ensemble dans le moteur.
      const rendu = r.avec !== undefined
        ? appel("superposer", { pageA: r.page, pageB: r.avec, echelle }, { discret: true })
        : appel("rendre", { cote: r.cote, page: r.page, echelle }, { discret: true });
      rendu.then((p) => {
        r.canvas.width = p.largeur;
        r.canvas.height = p.hauteur;
        r.canvas.getContext("2d")!.putImageData(new ImageData(p.pixels as Uint8ClampedArray<ArrayBuffer>, p.largeur, p.hauteur), 0, 0);
      });
    }
  }, { root: cote, rootMargin: "600px 0px" });
  const marques: { element: HTMLElement; index: number }[] = [];


  /** La marque d'une différence sur une page de l × h points (rectangle en points de la page), placée en proportion de
   * la page pour suivre le zoom. */
  const marque = (d: Difference, i: number, r: [number, number, number, number], l: number, h: number) => {
    const texte = TYPES_TEXTE.includes(d.type);
    const pc = (v: number, t: number) => `${(v / t) * 100}%`;
    const m = el("div", {
      class: `marque-diff ${texte ? "texte" : "cadre"}`, title: `${TYPES[d.type][1]} : ${description(d)}`,
      style: { left: pc(r[0], l), top: pc(r[1], h), width: pc(r[2] - r[0], l), height: pc(r[3] - r[1], h), ...(texte ? { background: TYPES[d.type][0] } : { borderColor: TYPES[d.type][0] }) },
    });
    marques.push({ element: m, index: i });
    return m;
  };

  const afficher = () => {
    if (!resultat) return;
    const res = resultat;
    liste.replaceChildren();
    cote.replaceChildren();
    rendus.length = 0;
    marques.length = 0;
    const items = res.differences;
    liste.append(el("p", { style: { margin: "4px" } }, el("strong", { text: items.length ? `${pluriel(items.length, "différence")}` : "Aucune différence" }),
      el("br"), el("span", { class: "aide", text: items.length ? resume(items) : "Les deux versions sont identiques selon les options choisies." })));
    for (const n of res.notes) liste.append(el("p", { class: "alerte", text: n }));
    largeurBase = largeurColonne();
    const largeur = largeurBase * zoom;
    fenetres.length = 0;
    /** Une page dans sa fenêtre (largeur de la colonne, hauteur suivant le zoom). */
    const fenetre = (page: HTMLElement, hauteurBase: number) => {
      page.style.transform = `translateX(${-decalage * largeur}px)`;
      const f = el("div", { class: "fenetre-page", style: { width: `${largeurBase}px`, height: `${hauteurBase * zoom}px` } }, page);
      fenetres.push({ fenetre: f, page, hauteur: hauteurBase });
      return f;
    };
    res.paires.forEach((paire, k) => {
      const diffs = items.map((d, i) => ({ d, i })).filter(({ d }) => d.paire === k);
      if (diffs.length) {
        const c = new Map(decompte(diffs.map((x) => x.d)));
        liste.append(el("h3", { text: `${titrePaire(paire, res.noms)} — ${[...c].map(([t, n]) => `${n} ${n > 1 ? TYPES[t][2] : TYPES[t][1].toLowerCase()}`).join(", ")}` }));
        for (const { d, i } of diffs) {
          const b = el("button", { type: "button", class: "difference" },
            el("span", { class: "marque-type", style: { background: TYPES[d.type][0] } }),
            el("span", {}, el("strong", { text: TYPES[d.type][1] }), el("small", { text: description(d) })));
          b.dataset.index = String(i);
          b.addEventListener("click", () => aller(i));
          liste.append(b);
        }
      }
      // La paire de pages, côte à côte, ou superposées en une seule page.
      const titre = titrePaire(paire, res.noms);
      const ligne = el("section", { class: `paire${superposees() ? " superposee" : ""}`, "aria-label": titre },
        el("div", { class: "titre-paire", text: `${titre}${diffs.length ? ` — ${pluriel(diffs.length, "différence")}` : " — identiques"}` }));
      ligne.dataset.paire = String(k);
      if (superposees()) {
        // Une seule page : celle de A, sur laquelle est superposée sa page appariée de B (ou la page seule si elle
        // n'a pas d'équivalent). Les marques des deux versions y sont dessinées, celles de B seulement si la
        // différence n'est pas déjà marquée sur A (page_marks sur PC).
        const c = paire[0] !== null ? "a" : "b";
        const index = (c === "a" ? paire[0] : paire[1])!;
        const ref = versions[c]!.pages[index];
        const canvas = el("canvas", { "aria-label": paire[0] !== null && paire[1] !== null ? `Page ${paire[0] + 1} de A superposée à la page ${paire[1] + 1} de B` : `Version ${c.toUpperCase()}, page ${index + 1}` });
        const page = el("div", { class: "page-comparee", style: { width: `${largeur}px`, height: `${(largeur * ref.hauteur) / ref.largeur}px` } }, canvas);
        const marquees = new Set<number>();
        for (const cotePage of ["a", "b"] as const) {
          const p = cotePage === "a" ? paire[0] : paire[1];
          if (p === null) continue;
          for (const { d, i } of diffs) {
            if (cotePage === "b" && marquees.has(i)) continue;
            for (const [q, r] of cotePage === "a" ? d.marquesA : d.marquesB) {
              if (q !== p) continue;
              marquees.add(i);
              page.append(marque(d, i, r, ref.largeur, ref.hauteur));
            }
          }
        }
        ligne.append(fenetre(page, (largeurBase * ref.hauteur) / ref.largeur));
        rendus.push({ canvas, cote: c, page: index, largeur, fait: false, avec: paire[0] !== null && paire[1] !== null ? paire[1] : undefined });
        observateur.observe(page);
        cote.append(ligne);
        return;
      }
      for (const [c, index] of [["a", paire[0]], ["b", paire[1]]] as const) {
        const autre = c === "a" ? paire[1] : paire[0];
        const ref = index !== null ? versions[c]!.pages[index] : versions[c === "a" ? "b" : "a"]!.pages[autre!];
        const hauteurBase = (largeurBase * ref.hauteur) / ref.largeur;
        if (index === null) {
          ligne.append(fenetre(el("div", { class: "page-comparee absente", style: { width: `${largeur}px`, height: `${hauteurBase * zoom}px` }, text: "Pas de page correspondante" }), hauteurBase));
          continue;
        }
        const canvas = el("canvas", { "aria-label": `Version ${c.toUpperCase()}, page ${index + 1}` });
        const page = el("div", { class: "page-comparee", style: { width: `${largeur}px`, height: `${hauteurBase * zoom}px` } }, canvas);
        const dims = versions[c]!.pages[index];
        for (const { d, i } of diffs) {
          for (const [p, r] of c === "a" ? d.marquesA : d.marquesB) {
            if (p === index) page.append(marque(d, i, r, dims.largeur, dims.hauteur));
          }
        }
        ligne.append(fenetre(page, hauteurBase));
        rendus.push({ canvas, cote: c, page: index, largeur, fait: false });
        observateur.observe(page);
      }
      cote.append(ligne);
    });
  };

  /** Met en avant la différence en cours dans la liste et sur les pages, sans faire défiler. */
  const marquerCourante = () => {
    liste.querySelectorAll(".difference").forEach((b) => b.setAttribute("aria-current", String(Number((b as HTMLElement).dataset.index) === courant)));
    marques.forEach((m) => m.element.classList.toggle("actif", m.index === courant));
  };

  const aller = (i: number) => {
    if (!resultat || !resultat.differences.length) return;
    courant = (i + resultat.differences.length) % resultat.differences.length;
    const d: Difference = resultat.differences[courant];
    marquerCourante();
    const cible = marques.find((m) => m.index === courant)?.element ?? cote.querySelector(`[data-paire="${d.paire}"]`);
    if (zoom > 1 && cible?.classList.contains("marque-diff")) {
      const centre = (parseFloat(cible.style.left) + parseFloat(cible.style.width) / 2) / 100;
      decalage = centre - 1 / (2 * zoom);
      appliquerZoom();
    }
    cible?.scrollIntoView({ block: "center", behavior: "smooth" });
    (liste.querySelector(`.difference[data-index="${courant}"]`) as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    etat.textContent = `Différence ${courant + 1} sur ${resultat.differences.length} : ${TYPES[d.type][1]} — ${description(d)}`;
  };
  f.dialog.addEventListener("keydown", (e) => {
    if (e.key === "F3") {
      e.preventDefault();
      aller(courant + (e.shiftKey ? -1 : 1));
    }
  });

  lancer.addEventListener("click", async () => {
    lancer.disabled = true;
    progression.hidden = false;
    const barre = progression.firstElementChild as HTMLElement;
    try {
      resultat = await appel("comparer", {
        options: {
          mode: mode.value as Mode, ignorerCasse: casse.checked, ignorerPonctuation: ponctuation.checked, tolerance: Number(tolerance.value) / 100,
          reglage: reglage.value as Reglage,
        },
      }, {
        progression: (fr, message) => {
          barre.style.width = `${Math.round(fr * 100)}%`;
          progression.setAttribute("aria-valuenow", String(Math.round(fr * 100)));
          etat.textContent = message;
        },
      });
      courant = -1;
      if (window.matchMedia("(max-width: 700px)").matches) replier(true);
      afficher();
      rapport.disabled = false;
      etat.textContent = resultat.differences.length ? `${resume(resultat.differences)}. F3 et Maj+F3 : différence suivante ou précédente.` : "Aucune différence.";
      if (resultat.differences.length) aller(0);
    } catch (e) {
      etat.textContent = `Comparaison impossible : ${(e as Error).message}`;
    } finally {
      progression.hidden = true;
      lancer.disabled = false;
      // Le bouton désactivé pendant le calcul a perdu le focus : il revient dans la fenêtre, pour que F3 y fonctionne.
      if (!f.dialog.contains(document.activeElement)) cote.focus({ preventScroll: true });
    }
  });

  rapport.addEventListener("click", async () => {
    try {
      const octets = await appel("rapport", { date: Date.now() });
      const base = (versions.b?.nom ?? "comparaison").replace(/ \(document ouvert\)$/, "").replace(/\.pdf$/i, "");
      telecharger(octets, `Comparaison - ${base}.pdf`);
      etat.textContent = "Rapport enregistré (téléchargement).";
    } catch (e) {
      etat.textContent = `Rapport impossible : ${(e as Error).message}`;
    }
  });

  await f.fermee;
  observateur.disconnect();
  await appel("fermerComparaison");
}
