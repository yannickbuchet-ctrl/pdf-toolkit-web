/**
 * Comparer deux PDF (CompareDialog sur PC) : les deux versions côte à côte, pages appariées, différences surlignées
 * (ajouts en vert, suppressions en rouge, modifications en orange, changements visuels encadrés en violet), liste
 * des différences regroupées par page, et rapport PDF.
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { choisirFichiers, el, estPdf, fenetre, lire, pluriel, telecharger } from "./dom";
import { icone } from "./icones";
import { decompte, description, MODES, resume, titrePaire, TYPES, TYPES_TEXTE, type Difference, type Mode, type Resultat } from "../moteur/comparaisonTextes";

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
  const legende = el("div", { class: "legende" },
    ...(["ajout", "suppression", "modification", "visuel"] as const).map((t) => el("span", {}, el("i", { style: { background: TYPES[t][0] } }), TYPES[t][1])));
  f.corps.append(el("div", { class: "comparaison" },
    el("div", { class: "reglages" },
      el("label", {}, "Comparer :", mode), el("label", {}, casse, "Ignorer les majuscules"), el("label", {}, ponctuation, "Ignorer la ponctuation"),
      el("label", { class: "curseur" }, "Tolérance visuelle", tolerance, valeurTolerance),
      lancer, rapport, el("span", { style: { flex: "1", minWidth: "120px" } }, progression, etat), legende),
    el("div", { class: "versions" }, za.zone, inverser, zb.zone),
    el("div", { class: "resultats" }, liste, cote)));

  if (app.etat) await za.charger(null);

  /* --- Affichage du résultat --------------------------------------------------------------------------------------- */

  const largeurColonne = () => Math.max(200, (cote.clientWidth - 64) / 2);
  const rendus: { canvas: HTMLCanvasElement; cote: "a" | "b"; page: number; largeur: number; fait: boolean }[] = [];
  const observateur = new IntersectionObserver((entrees) => {
    for (const e of entrees) {
      if (!e.isIntersecting) continue;
      const r = rendus.find((x) => x.canvas.parentElement === e.target);
      if (!r || r.fait) continue;
      r.fait = true;
      appel("rendre", { cote: r.cote, page: r.page, echelle: (r.largeur / versions[r.cote]!.pages[r.page].largeur) * Math.min(2, window.devicePixelRatio || 1) }, { discret: true }).then((p) => {
        r.canvas.width = p.largeur;
        r.canvas.height = p.hauteur;
        r.canvas.getContext("2d")!.putImageData(new ImageData(p.pixels as Uint8ClampedArray<ArrayBuffer>, p.largeur, p.hauteur), 0, 0);
      });
    }
  }, { root: cote, rootMargin: "600px 0px" });
  const marques: { element: HTMLElement; index: number }[] = [];

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
    const largeur = largeurColonne();
    res.paires.forEach((paire, k) => {
      const diffs = items.map((d, i) => ({ d, i })).filter(({ d }) => d.paire === k);
      if (diffs.length) {
        const c = new Map(decompte(diffs.map((x) => x.d)));
        liste.append(el("h3", { text: `${titrePaire(paire)} — ${[...c].map(([t, n]) => `${n} ${n > 1 ? TYPES[t][2] : TYPES[t][1].toLowerCase()}`).join(", ")}` }));
        for (const { d, i } of diffs) {
          const b = el("button", { type: "button", class: "difference" },
            el("span", { class: "marque-type", style: { background: TYPES[d.type][0] } }),
            el("span", {}, el("strong", { text: TYPES[d.type][1] }), el("small", { text: description(d) })));
          b.dataset.index = String(i);
          b.addEventListener("click", () => aller(i));
          liste.append(b);
        }
      }
      // La paire de pages, côte à côte.
      const ligne = el("section", { class: "paire", "aria-label": titrePaire(paire) }, el("div", { class: "titre-paire", text: `${titrePaire(paire)}${diffs.length ? ` — ${pluriel(diffs.length, "différence")}` : " — identiques"}` }));
      ligne.dataset.paire = String(k);
      for (const [c, index] of [["a", paire[0]], ["b", paire[1]]] as const) {
        const autre = c === "a" ? paire[1] : paire[0];
        const ref = index !== null ? versions[c]!.pages[index] : versions[c === "a" ? "b" : "a"]!.pages[autre!];
        const hauteur = (largeur * ref.hauteur) / ref.largeur;
        if (index === null) {
          ligne.append(el("div", { class: "page-comparee absente", style: { width: `${largeur}px`, height: `${hauteur}px` }, text: "Pas de page correspondante" }));
          continue;
        }
        const canvas = el("canvas", { "aria-label": `Version ${c.toUpperCase()}, page ${index + 1}` });
        const page = el("div", { class: "page-comparee", style: { width: `${largeur}px`, height: `${hauteur}px` } }, canvas);
        const s = largeur / ref.largeur;
        for (const { d, i } of diffs) {
          for (const [p, r] of c === "a" ? d.marquesA : d.marquesB) {
            if (p !== index) continue;
            const texte = TYPES_TEXTE.includes(d.type);
            const m = el("div", {
              class: `marque-diff ${texte ? "texte" : "cadre"}`, title: `${TYPES[d.type][1]} : ${description(d)}`,
              style: { left: `${r[0] * s}px`, top: `${r[1] * s}px`, width: `${(r[2] - r[0]) * s}px`, height: `${(r[3] - r[1]) * s}px`, ...(texte ? { background: TYPES[d.type][0] } : { borderColor: TYPES[d.type][0] }) },
            });
            page.append(m);
            marques.push({ element: m, index: i });
          }
        }
        ligne.append(page);
        rendus.push({ canvas, cote: c, page: index, largeur, fait: false });
        observateur.observe(page);
      }
      cote.append(ligne);
    });
  };

  const aller = (i: number) => {
    if (!resultat || !resultat.differences.length) return;
    courant = (i + resultat.differences.length) % resultat.differences.length;
    const d: Difference = resultat.differences[courant];
    liste.querySelectorAll(".difference").forEach((b) => b.setAttribute("aria-current", String(Number((b as HTMLElement).dataset.index) === courant)));
    marques.forEach((m) => m.element.classList.toggle("actif", m.index === courant));
    const cible = marques.find((m) => m.index === courant)?.element ?? cote.querySelector(`[data-paire="${d.paire}"]`);
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
        options: { mode: mode.value as Mode, ignorerCasse: casse.checked, ignorerPonctuation: ponctuation.checked, tolerance: Number(tolerance.value) / 100 },
      }, {
        progression: (fr, message) => {
          barre.style.width = `${Math.round(fr * 100)}%`;
          progression.setAttribute("aria-valuenow", String(Math.round(fr * 100)));
          etat.textContent = message;
        },
      });
      courant = -1;
      afficher();
      rapport.disabled = false;
      etat.textContent = resultat.differences.length ? `${resume(resultat.differences)}. F3 et Maj+F3 : différence suivante ou précédente.` : "Aucune différence.";
      if (resultat.differences.length) aller(0);
    } catch (e) {
      etat.textContent = `Comparaison impossible : ${(e as Error).message}`;
    } finally {
      progression.hidden = true;
      lancer.disabled = false;
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
