/**
 * Planche de copies : une page du document (une affiche, un flyer…) répétée sur une feuille, puis imprimée : par
 * exemple quatre fois en A6 sur un A4. Une seule copie sur un A3 ou un A4 relève de l'impression ordinaire (Ctrl+P).
 * Sans rapport avec les photos d'identité.
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { el, fenetre, pluriel } from "./dom";
import { icone } from "./icones";
import { imprimer } from "./outils";
import { dispositionCopies, formatProche, MARGE_COPIES, NOMBRES_COPIES, PAPIERS_COPIES, type DispositionCopies } from "../moteur/copiesCalcul";

const MM_PAR_POINT = 25.4 / 72;
const cm = (mm: number) => String(Math.round(mm) / 10).replace(".", ",");

export async function dialogueCopies(app: Application) {
  const etat = app.etat;
  if (!etat) return;
  const f = fenetre("Planche de copies");
  const nbPages = etat.pages.length;

  const page = el("input", { type: "number", class: "entree", min: "1", max: String(nbPages), step: "1", value: String(app.pageCourante + 1), "aria-label": "Page à copier" });
  const papier = el("select", { class: "entree", "aria-label": "Papier" });
  PAPIERS_COPIES.forEach(([nom], i) => papier.append(el("option", { value: nom, text: nom, selected: i === 1 })));
  // Le nombre de copies : 2, 4 ou 8, chaque choix affichant la taille obtenue.
  const nombres = el("div", { class: "choix-copies", role: "radiogroup", "aria-label": "Copies par feuille" });
  const radios = NOMBRES_COPIES.map((n) => {
    const radio = el("input", { type: "radio", name: "nombre-copies", value: String(n), checked: n === 4 });
    const texte = el("span");
    nombres.append(el("label", { class: "choix" }, radio, texte));
    return { n, radio, texte };
  });
  const nombreChoisi = () => radios.find((r) => r.radio.checked)?.n ?? 4;
  const marge = el("input", { type: "number", class: "entree", min: "0", max: "50", step: "0.5", value: String(MARGE_COPIES), "aria-label": "Marge en mm" });
  const traits = el("input", { type: "checkbox", checked: true });
  const apercu = el("canvas");
  const resume = el("p", { class: "aide", "aria-live": "polite" });

  f.corps.append(
    el("p", { class: "aide", style: { marginTop: "0" }, text: "Répète une page sur une feuille pour l’imprimer en plus petit : chaque copie est agrandie ou réduite sans déformation, collée à ses voisines, et tournée si elle tient mieux ainsi. Le document ouvert est remplacé par la planche (Ctrl+Z pour revenir)." }),
    el("div", { class: "photo-grille" },
      el("div", {},
        el("fieldset", {}, el("legend", { text: "Planche" }),
          nbPages > 1 ? el("label", { class: "champ-formulaire" }, `Page à copier (1 à ${nbPages})`, page) : "",
          el("label", { class: "champ-formulaire" }, "Papier", papier),
          el("div", { class: "champ-formulaire" }, "Copies par feuille", nombres),
          el("label", { class: "champ-formulaire" }, "Marge au bord de la feuille (mm)", marge),
          el("label", { class: "choix" }, traits, el("span", {}, "Traits de coupe", el("span", { class: "indication", text: "Un trait gris fin autour de chaque copie, pour les découper." })))),
        resume),
      el("div", { class: "apercu-planche" }, apercu)));
  const creer = el("button", { type: "button", class: "bouton cadre", text: "Afficher la planche" });
  const creerEnregistrer = el("button", { type: "button", class: "bouton cadre", html: `${icone("enregistrer")}<span>Enregistrer en PDF…</span>` });
  const creerImprimer = el("button", { type: "button", class: "bouton principal", html: `${icone("imprimer")}<span>Imprimer</span>` });
  f.pied.append(el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }), creer, creerEnregistrer, creerImprimer);

  /* Valeurs courantes */
  const indexPage = () => Math.min(nbPages, Math.max(1, Math.floor(Number(page.value) || 1))) - 1;
  const sourceMm = (): [number, number] => {
    const p = etat.pages[indexPage()];
    return [p.largeur * MM_PAR_POINT, p.hauteur * MM_PAR_POINT];
  };
  const papierMm = (): [number, number] => {
    const p = PAPIERS_COPIES.find((x) => x[0] === papier.value) ?? PAPIERS_COPIES[1];
    return [p[1], p[2]];
  };
  const margeMm = () => Math.min(50, Math.max(0, Number(marge.value) || 0));
  // Les copies sont jointives, sans espace entre elles : une seule coupe sépare deux copies voisines.
  const calculer = (n: number) => dispositionCopies(papierMm(), sourceMm(), n, margeMm(), 0);
  const description = (d: DispositionCopies) => {
    const nom = formatProche(d.copie);
    // Taille de la copie dans son sens de lecture (une copie tournée sur la feuille garde « largeur × hauteur »).
    const [l, h] = d.tourner ? [d.copie[1], d.copie[0]] : d.copie;
    return `${cm(l)} × ${cm(h)} cm${nom ? ` (≈ ${nom})` : ""}`;
  };

  /** Chaque choix du nombre de copies donne la taille obtenue, qui dépend du papier et de la marge. */
  const majNombres = () => {
    for (const r of radios) {
      const d = calculer(r.n);
      r.radio.disabled = !d.positions.length;
      r.texte.textContent = d.positions.length ? `${r.n} copies — ${description(d)}` : `${r.n} copies — ne tiennent pas sur la feuille`;
    }
  };

  /* Aperçu : l'image de la page, rendue une fois par page choisie */
  let vignette: { page: number; image: HTMLCanvasElement } | null = null;
  const vignettePage = async (i: number) => {
    if (vignette?.page === i) return vignette.image;
    const p = etat.pages[i];
    const r = await appel("rendre", { page: i, echelle: Math.min(2, 600 / Math.max(p.largeur, p.hauteur)) }, { discret: true });
    const c = el("canvas", { width: r.largeur, height: r.hauteur });
    c.getContext("2d")!.putImageData(new ImageData(r.pixels as Uint8ClampedArray<ArrayBuffer>, r.largeur, r.hauteur), 0, 0);
    vignette = { page: i, image: c };
    return c;
  };

  let disposition = calculer(nombreChoisi());
  const majApercu = async () => {
    disposition = calculer(nombreChoisi());
    const d = disposition;
    const nomPapier = papier.value.split(" (")[0];
    resume.textContent = d.positions.length
      ? `${pluriel(d.positions.length, "copie")} de ${description(d)} sur une feuille ${nomPapier} en ${d.largeur > d.hauteur ? "paysage" : "portrait"}${d.tourner ? ", copies tournées d’un quart de tour" : ""}.`
      : "Rien ne tient sur cette feuille : réduisez la marge.";
    creer.disabled = creerEnregistrer.disabled = creerImprimer.disabled = d.positions.length === 0;
    const k = Math.min(320 / d.largeur, 320 / d.hauteur);
    apercu.width = Math.round(d.largeur * k);
    apercu.height = Math.round(d.hauteur * k);
    const ctx = apercu.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, apercu.width, apercu.height);
    const image = await vignettePage(indexPage());
    if (d !== disposition) return; // un réglage a changé pendant le rendu
    for (const [x, y] of d.positions) {
      const [l, h] = [d.copie[0] * k, d.copie[1] * k];
      ctx.save();
      ctx.translate(x * k + l / 2, y * k + h / 2);
      if (d.tourner) ctx.rotate(Math.PI / 2);
      const [il, ih] = d.tourner ? [h, l] : [l, h];
      ctx.drawImage(image, -il / 2, -ih / 2, il, ih);
      ctx.restore();
      if (traits.checked && d.positions.length > 1) {
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * k, y * k, l, h);
      }
    }
    // Les marges, en pointillés : la zone que la plupart des imprimantes n'atteignent pas.
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(margeMm() * k, margeMm() * k, (d.largeur - 2 * margeMm()) * k, (d.hauteur - 2 * margeMm()) * k);
  };
  const tout = () => {
    majNombres();
    void majApercu().catch((e) => app.erreur(e));
  };

  for (const x of [page, papier, marge]) x.addEventListener("input", tout);
  for (const x of [...radios.map((r) => r.radio), traits]) x.addEventListener("input", () => void majApercu().catch((e) => app.erreur(e)));
  tout();

  creer.addEventListener("click", () => f.fermer("creer"));
  creerEnregistrer.addEventListener("click", () => f.fermer("enregistrer"));
  creerImprimer.addEventListener("click", () => f.fermer("imprimer"));
  const choix = await f.fermee;
  if (choix !== "creer" && choix !== "enregistrer" && choix !== "imprimer") return;

  try {
    const d = disposition;
    const octets = await appel("plancheCopies", { page: indexPage(), disposition: d, traits: traits.checked });
    const base = (app.fichier?.nom ?? "document").replace(/\.pdf$/i, "");
    await app.ouvrirResultat(octets, `${base} - planche.pdf`, "planche de copies");
    app.message(`Planche créée : ${pluriel(d.positions.length, "copie")} de ${description(d)}. Ctrl+S pour l’enregistrer, Ctrl+P pour l’imprimer en taille réelle (100 %).`, "succes", 15000);
    if (choix === "enregistrer") await app.enregistrer(true);
    if (choix === "imprimer") await imprimer(app);
  } catch (e) {
    app.erreur(e, "Planche impossible");
  }
}
