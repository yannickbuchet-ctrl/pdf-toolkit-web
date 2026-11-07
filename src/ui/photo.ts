/**
 * Photos d'identité (IdPhotoDialog et PhotoCropView sur PC) : recadrage de la photo, format, papier, et planche PDF
 * aux dimensions exactes. Les positions du cadre sont en pixels de l'image, avec pour origine son centre : une
 * inclinaison tourne l'image autour de ce point sans déplacer le cadre (comme sur PC, dont les réglages sont repris).
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { choisirFichiers, el, fenetre, lire, pluriel } from "./dom";
import { chargerImage } from "./outils";
import { TYPES_IMAGES } from "./images";
import { icone } from "./icones";
import {
  ANGLE_MAX, disposition, FORMATS, MARGE_MIN, PAPIERS, PPP_FAIBLE, PPP_MAX, PPP_MIN, REGLAGES_DEFAUT, reglagesVersTexte,
  type Orientation, type Reglages,
} from "../moteur/photoCalcul";

type Rect = { x: number; y: number; l: number; h: number };
const mmTexte = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");

/** Image tournée d'un quart de tour (90 : sens des aiguilles d'une montre). */
function quartDeTour(source: HTMLCanvasElement, angle: number): HTMLCanvasElement {
  const c = el("canvas", { width: source.height, height: source.width });
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return c;
}

/** Le contenu du cadre en image de largeur × hauteur pixels, sur fond blanc (render sur PC). */
function rendreCadre(image: HTMLCanvasElement, angle: number, sel: Rect, largeur: number, hauteur: number, luminosite = 0, contraste = 0): HTMLCanvasElement {
  const c = el("canvas", { width: largeur, height: hauteur });
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.imageSmoothingQuality = "high";
  const echelle = largeur / sel.l;
  ctx.scale(echelle, hauteur / sel.h);
  ctx.translate(-sel.x, -sel.y);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  if (luminosite || contraste) {
    // Luminosité et contraste (-50 à 50), par une table de correspondance (adjust_image sur PC).
    const f = 1 + contraste / 100;
    const table = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) table[v] = Math.round((v - 128) * f + 128 + luminosite);
    const d = ctx.getImageData(0, 0, largeur, hauteur);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = table[d.data[i]];
      d.data[i + 1] = table[d.data[i + 1]];
      d.data[i + 2] = table[d.data[i + 2]];
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

async function jpeg(c: HTMLCanvasElement, qualite: number): Promise<Uint8Array> {
  const b = await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), "image/jpeg", qualite));
  return lire(b);
}

/** La fenêtre des photos d'identité ; planche : une planche existante à modifier. */
export async function dialoguePhoto(app: Application, fichier: File | null, planche: { jpeg: Uint8Array; reglages: Reglages; complet: boolean } | null) {
  let original: HTMLCanvasElement;
  try {
    if (planche) original = await chargerImage(new Blob([planche.jpeg as BlobPart], { type: "image/jpeg" }));
    else {
      fichier ??= (await choisirFichiers(TYPES_IMAGES))[0] ?? null;
      if (!fichier) return;
      original = await chargerImage(fichier, (m) => app.message(m, "info", 0));
      app.message("");
    }
  } catch (e) {
    app.erreur(e, "Photo illisible");
    return;
  }
  const r: Reglages = structuredClone(planche?.reglages ?? REGLAGES_DEFAUT);
  let image = original;
  // Les opérations enregistrées (quarts de tour, découpes) sont rejouées sur la photo entière.
  const operations: Reglages["operations"] = [];
  for (const op of r.operations) {
    if (op[0] === "rotate") image = quartDeTour(image, op[1]);
    else {
      const [, angle, x, y, l, h] = op;
      image = rendreCadre(image, angle, { x, y, l, h }, Math.max(1, Math.round(l)), Math.max(1, Math.round(h)));
    }
    operations.push(op);
  }
  let angle = r.angle;
  let sel: Rect = r.selection ? { x: r.selection[0], y: r.selection[1], l: r.selection[2], h: r.selection[3] } : { x: 0, y: 0, l: 0, h: 0 };

  const f = fenetre(planche ? "Modifier la planche de photos d’identité" : "Photos d’identité", { classe: "plein" });
  const vue = el("canvas", { tabindex: "0", "aria-label": "Photo et cadre : glissez pour déplacer le cadre, coins pour le redimensionner ; flèches pour déplacer, Maj+flèches pour la taille" });
  const zoneVue = el("div", { class: "recadrage" }, vue);
  const apercu = el("canvas");
  const alertes = el("div", { "aria-live": "polite" });
  const capacite = el("span", { class: "aide" });

  const select = (options: string[], valeur: string, libelle: string) => {
    const s = el("select", { class: "entree", "aria-label": libelle });
    options.forEach((o) => s.append(el("option", { value: o, text: o, selected: o === valeur })));
    return s;
  };
  const nombre = (valeur: number, min: number, max: number, pas: number, libelle: string) => el("input", { type: "number", class: "entree", value: String(Math.round(valeur * 100) / 100), min: String(min), max: String(max), step: String(pas), "aria-label": libelle });
  const curseur = (valeur: number, min: number, max: number, pas: number, libelle: string) => {
    const i = el("input", { type: "range", min: String(min), max: String(max), step: String(pas), value: String(valeur), "aria-label": libelle });
    const o = el("output", { text: String(valeur) });
    i.addEventListener("input", () => (o.textContent = i.value));
    return { i, o, ligne: el("label", { class: "curseur" }, el("span", { style: { minWidth: "7.5em" }, text: libelle }), i, o) };
  };

  const formatNoms = FORMATS.map((x) => x[0]);
  const formatChoisi = FORMATS.find((x) => x[0] === r.format && x[1] !== null && Math.abs(x[1] - r.photo[0]) < 0.06 && Math.abs(x[2]! - r.photo[1]) < 0.06)
    ?? FORMATS.find((x) => x[1] !== null && Math.abs(x[1] - r.photo[0]) < 0.06 && Math.abs(x[2]! - r.photo[1]) < 0.06) ?? FORMATS[FORMATS.length - 1];
  const format = select(formatNoms, formatChoisi[0], "Format de la photo");
  const photoL = nombre(r.photo[0], 10, 200, 0.5, "Largeur de la photo en mm"), photoH = nombre(r.photo[1], 10, 200, 0.5, "Hauteur de la photo en mm");
  const papierChoisi = PAPIERS.find((x) => x[0] === r.papierNom && x[1] !== null && Math.abs(x[1] - r.papier[0]) < 0.06)
    ?? PAPIERS.find((x) => x[1] !== null && Math.abs(x[1] - r.papier[0]) < 0.06 && Math.abs(x[2]! - r.papier[1]) < 0.06) ?? PAPIERS[PAPIERS.length - 1];
  const papier = select(PAPIERS.map((x) => x[0]), papierChoisi[0], "Papier");
  const papierL = nombre(r.papier[0], 50, 1000, 1, "Largeur du papier en mm"), papierH = nombre(r.papier[1], 50, 1000, 1, "Hauteur du papier en mm");
  const orientation = el("select", { class: "entree", "aria-label": "Orientation" });
  for (const [v, t] of [["auto", "Automatique (le plus de photos)"], ["portrait", "Portrait"], ["landscape", "Paysage"]]) orientation.append(el("option", { value: v, text: t, selected: v === r.orientation }));
  const marge = nombre(r.marge, MARGE_MIN, 50, 0.5, "Marge en mm"), ecart = nombre(r.ecart, 0, 30, 0.5, "Espacement en mm");
  const combien = nombre(r.nombre, 0, 500, 1, "Nombre de photos (0 : remplir la feuille)");
  const traits = el("input", { type: "checkbox", checked: r.traits });
  const guide = el("input", { type: "checkbox", checked: r.guide });
  const garder = el("input", { type: "checkbox", checked: true });
  const redresser = curseur(angle, -ANGLE_MAX, ANGLE_MAX, 0.5, "Redresser (°)");
  const luminosite = curseur(r.luminosite, -50, 50, 1, "Luminosité");
  const contraste = curseur(r.contraste, -50, 50, 1, "Contraste");
  const taille = curseur(100, 10, 100, 1, "Taille du cadre");
  const tailleImageMax = () => Math.max(image.width, image.height);

  const ligneMesure = (libelle: string, a: HTMLInputElement, b: HTMLInputElement) => el("div", { class: "ligne" },
    el("label", { class: "champ-formulaire" }, `${libelle} largeur (mm)`, a), el("label", { class: "champ-formulaire" }, "hauteur (mm)", b));
  const persoPhoto = ligneMesure("Photo :", photoL, photoH);
  const persoPapier = ligneMesure("Papier :", papierL, papierH);

  const panneau = el("div", { style: { overflow: "auto", paddingRight: "4px" } },
    el("fieldset", {}, el("legend", { text: "Photo" }),
      el("label", { class: "champ-formulaire" }, "Format", format), persoPhoto,
      el("div", { class: "ligne", style: { marginBottom: "8px" } },
        el("button", { type: "button", class: "bouton cadre", html: `${icone("pivoterGauche")}<span>¼ de tour</span>`, onclick: () => tourner(270) }),
        el("button", { type: "button", class: "bouton cadre", html: `${icone("pivoterDroite")}<span>¼ de tour</span>`, onclick: () => tourner(90) })),
      redresser.ligne, taille.ligne, luminosite.ligne, contraste.ligne,
      el("label", { class: "choix" }, guide, "Afficher le guide du visage")),
    el("fieldset", {}, el("legend", { text: "Feuille" }),
      el("label", { class: "champ-formulaire" }, "Papier", papier), persoPapier,
      el("label", { class: "champ-formulaire" }, "Orientation", orientation),
      el("div", { class: "ligne" }, el("label", { class: "champ-formulaire" }, "Marge (mm)", marge), el("label", { class: "champ-formulaire" }, "Espacement (mm)", ecart)),
      el("label", { class: "champ-formulaire" }, "Nombre de photos (0 : remplir la feuille)", combien), capacite,
      el("label", { class: "choix" }, traits, "Traits de coupe"),
      el("label", { class: "choix" }, garder, el("span", {}, "Joindre la photo entière et les réglages", el("span", { class: "indication", text: "Pour modifier la planche plus tard. Décochez avant de transmettre le fichier à quelqu’un." })))),
    el("div", { class: "apercu-planche" }, apercu), alertes);
  f.corps.append(el("div", { class: "photo-grille" }, el("div", {}, zoneVue, el("p", { class: "aide", text: "Placez le cadre sur le visage : la tête doit tenir entre les deux ovales du guide. Molette ou « Taille du cadre » pour l’agrandir." })), panneau));
  f.corps.style.overflow = "auto";
  const creer = el("button", { type: "button", class: "bouton principal", html: `${icone("photo")}<span>Créer la planche</span>` });
  const changer = el("button", { type: "button", class: "bouton cadre", text: "Changer de photo…" });
  f.pied.append(changer, el("span", { class: "espace" }), el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }), creer);

  /* Valeurs courantes */
  const photoMm = (): [number, number] => {
    const x = FORMATS.find((v) => v[0] === format.value)!;
    return x[1] !== null ? [x[1], x[2]!] : [Math.max(10, Number(photoL.value) || 35), Math.max(10, Number(photoH.value) || 45)];
  };
  const papierMm = (): [number, number] => {
    const x = PAPIERS.find((v) => v[0] === papier.value)!;
    return x[1] !== null ? [x[1], x[2]!] : [Math.max(50, Number(papierL.value) || 210), Math.max(50, Number(papierH.value) || 297)];
  };
  const ratio = () => photoMm()[0] / photoMm()[1];

  /** Le plus grand cadre aux bonnes proportions, centré, dans l'image. */
  const cadreInitial = (): Rect => {
    const rt = ratio();
    let h = image.height * 0.9, l = h * rt;
    if (l > image.width * 0.9) {
      l = image.width * 0.9;
      h = l / rt;
    }
    return { x: -l / 2, y: -h / 2, l, h };
  };
  if (!sel.l) sel = cadreInitial();
  const tailleMax = () => cadreInitial().h / 0.9;
  taille.i.value = String(Math.round(Math.min(100, (sel.h / tailleMax()) * 100)));
  taille.o.textContent = taille.i.value;

  /* Vue : l'image entière tient dans la zone, centrée */
  let echelle = 1, cx = 0, cy = 0;
  const dessiner = () => {
    const rect = zoneVue.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    vue.width = Math.max(1, Math.round(rect.width * dpr));
    vue.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = vue.getContext("2d")!;
    const diag = Math.hypot(image.width, image.height);
    echelle = (Math.min(vue.width, vue.height) / diag) * 0.98;
    echelle = Math.max(echelle, Math.min(vue.width / image.width, vue.height / image.height) * 0.92);
    cx = vue.width / 2;
    cy = vue.height / 2;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, vue.width, vue.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(echelle, echelle);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.filter = `brightness(${1 + Number(luminosite.i.value) / 255 * 2}) contrast(${1 + Number(contraste.i.value) / 100})`;
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
    // Le cadre, et l'ombre autour.
    const X = cx + sel.x * echelle, Y = cy + sel.y * echelle, L = sel.l * echelle, H = sel.h * echelle;
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, vue.width, vue.height);
    ctx.rect(X, Y, L, H);
    ctx.fill("evenodd");
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(X, Y, L, H);
    ctx.fillStyle = "#2563eb";
    for (const [px, py] of [[X, Y], [X + L, Y], [X, Y + H], [X + L, Y + H]]) ctx.fillRect(px - 6 * dpr, py - 6 * dpr, 12 * dpr, 12 * dpr);
    const fmt = FORMATS.find((v) => v[0] === format.value)!;
    if (guide.checked && fmt[3] !== null) {
      // Ovales du visage : hauteur de tête minimale et maximale du format, rapportée à la photo.
      const [, , ph] = [0, ...photoMm()];
      ctx.setLineDash([6 * dpr, 5 * dpr]);
      ctx.strokeStyle = "#facc15";
      for (const hTete of [fmt[3]!, fmt[4]!]) {
        const hh = (hTete / ph) * H;
        ctx.beginPath();
        ctx.ellipse(X + L / 2, Y + H * 0.08 + hh / 2, hh * 0.37, hh / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  };

  const pppSortie = () => sel.l / (photoMm()[0] / 25.4);
  const majApercu = () => {
    const pm = photoMm(), pa = papierMm();
    const d = disposition(pa, pm, Math.max(MARGE_MIN, Number(marge.value) || MARGE_MIN), Math.max(0, Number(ecart.value) || 0), orientation.value as Orientation, Math.max(0, Math.floor(Number(combien.value) || 0)));
    capacite.textContent = d.capacite ? `La feuille peut porter ${pluriel(d.capacite, "photo")} ; ${pluriel(d.positions.length, "photo")} sur la planche.` : "Aucune photo ne tient sur cette feuille : réduisez la marge ou changez de papier.";
    const k = Math.min(300 / d.largeur, 300 / d.hauteur);
    apercu.width = Math.round(d.largeur * k);
    apercu.height = Math.round(d.hauteur * k);
    const ctx = apercu.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, apercu.width, apercu.height);
    const vignette = rendreCadre(image, angle, sel, Math.max(1, Math.round(pm[0] * k)), Math.max(1, Math.round(pm[1] * k)), Number(luminosite.i.value), Number(contraste.i.value));
    for (const [x, y] of d.positions) {
      ctx.drawImage(vignette, x * k, y * k, pm[0] * k, pm[1] * k);
      if (traits.checked) {
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x * k, y * k, pm[0] * k, pm[1] * k);
      }
    }
    alertes.replaceChildren();
    const ppp = pppSortie();
    if (ppp < PPP_FAIBLE) alertes.append(el("p", { class: "alerte", text: `La zone sélectionnée est petite (${Math.round(ppp)} ppp une fois imprimée) : la photo paraîtra floue. Utilisez une photo de meilleure résolution ou un cadre plus grand.` }));
    creer.disabled = d.positions.length === 0;
    return d;
  };
  let minuterie = 0;
  const tout = () => {
    dessiner();
    clearTimeout(minuterie);
    minuterie = window.setTimeout(majApercu, 80);
  };

  /* Interactions */
  const tourner = (q: number) => {
    image = quartDeTour(image, q);
    operations.push(["rotate", q]);
    angle = 0;
    redresser.i.value = "0";
    redresser.o.textContent = "0";
    sel = cadreInitial();
    taille.i.value = "100";
    taille.o.textContent = "100";
    tout();
  };
  const contraindre = () => {
    const m = tailleImageMax();
    sel.l = Math.max(20, Math.min(sel.l, m * 2));
    sel.h = sel.l / ratio();
    sel.x = Math.max(-m, Math.min(m - sel.l, sel.x));
    sel.y = Math.max(-m, Math.min(m - sel.h, sel.y));
  };
  const redimensionner = (nouvelleHauteur: number) => {
    const centreX = sel.x + sel.l / 2, centreY = sel.y + sel.h / 2;
    sel.h = Math.max(20 / ratio(), nouvelleHauteur);
    sel.l = sel.h * ratio();
    sel.x = centreX - sel.l / 2;
    sel.y = centreY - sel.h / 2;
    contraindre();
  };
  let glisse: { mode: "deplacer" | "coin"; px: number; py: number; sel: Rect; coin: [number, number] } | null = null;
  const versImage = (e: PointerEvent | WheelEvent) => {
    const r = vue.getBoundingClientRect();
    const dpr = vue.width / r.width;
    return [((e.clientX - r.left) * dpr - cx) / echelle, ((e.clientY - r.top) * dpr - cy) / echelle];
  };
  vue.addEventListener("pointerdown", (e) => {
    vue.setPointerCapture(e.pointerId);
    const [x, y] = versImage(e);
    const marge = 14 / echelle;
    const coins: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const coin = coins.find(([a, b]) => Math.abs(x - (sel.x + a * sel.l)) < marge && Math.abs(y - (sel.y + b * sel.h)) < marge);
    glisse = { mode: coin ? "coin" : "deplacer", px: x, py: y, sel: { ...sel }, coin: coin ?? [0, 0] };
  });
  vue.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    const [x, y] = versImage(e);
    const dx = x - glisse.px, dy = y - glisse.py;
    if (glisse.mode === "deplacer") {
      sel.x = glisse.sel.x + dx;
      sel.y = glisse.sel.y + dy;
      contraindre();
    } else {
      // Le coin opposé reste en place ; les proportions sont celles de la photo d'identité.
      const [a, b] = glisse.coin;
      const fixeX = glisse.sel.x + (1 - a) * glisse.sel.l, fixeY = glisse.sel.y + (1 - b) * glisse.sel.h;
      const h = Math.max(Math.abs(y - fixeY), Math.abs(x - fixeX) / ratio(), 20);
      sel.h = h;
      sel.l = h * ratio();
      sel.x = a ? fixeX : fixeX - sel.l;
      sel.y = b ? fixeY : fixeY - sel.h;
    }
    taille.i.value = String(Math.round(Math.min(100, (sel.h / tailleMax()) * 100)));
    taille.o.textContent = taille.i.value;
    dessiner();
  });
  vue.addEventListener("pointerup", () => {
    glisse = null;
    majApercu();
  });
  vue.addEventListener("wheel", (e) => {
    e.preventDefault();
    redimensionner(sel.h * (e.deltaY > 0 ? 1.05 : 1 / 1.05));
    tout();
  }, { passive: false });
  vue.addEventListener("keydown", (e) => {
    const pas = (e.altKey ? 1 : 10) / Math.max(echelle, 0.05);
    const d: Record<string, [number, number]> = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
    if (!d[e.key]) return;
    e.preventDefault();
    if (e.shiftKey) redimensionner(sel.h + (e.key === "ArrowUp" || e.key === "ArrowRight" ? pas : -pas));
    else {
      sel.x += d[e.key][0];
      sel.y += d[e.key][1];
      contraindre();
    }
    tout();
  });
  taille.i.addEventListener("input", () => {
    redimensionner((Number(taille.i.value) / 100) * tailleMax());
    tout();
  });
  redresser.i.addEventListener("input", () => {
    angle = Number(redresser.i.value);
    tout();
  });
  for (const x of [luminosite.i, contraste.i]) x.addEventListener("input", tout);
  const majPerso = () => {
    persoPhoto.hidden = FORMATS.find((v) => v[0] === format.value)![1] !== null;
    persoPapier.hidden = PAPIERS.find((v) => v[0] === papier.value)![1] !== null;
  };
  format.addEventListener("change", () => {
    majPerso();
    redimensionner(sel.h);
    tout();
  });
  for (const x of [photoL, photoH]) x.addEventListener("input", () => {
    redimensionner(sel.h);
    tout();
  });
  for (const x of [papier, orientation, marge, ecart, combien, papierL, papierH, traits]) x.addEventListener("input", () => {
    majPerso();
    majApercu();
  });
  guide.addEventListener("change", dessiner);
  majPerso();
  new ResizeObserver(() => dessiner()).observe(zoneVue);
  changer.addEventListener("click", async () => {
    const [fi] = await choisirFichiers(TYPES_IMAGES);
    if (!fi) return;
    try {
      original = image = await chargerImage(fi, (m) => app.message(m, "info", 0));
      app.message("");
      operations.length = 0;
      angle = 0;
      redresser.i.value = "0";
      sel = cadreInitial();
      tout();
    } catch (e) {
      app.erreur(e, "Photo illisible");
    }
  });
  setTimeout(() => {
    tout();
    vue.focus();
  }, 50);

  creer.addEventListener("click", () => f.fermer("ok"));
  if ((await f.fermee) !== "ok") return;

  try {
    const pm = photoMm();
    const d = majApercu();
    // Résolution de la photo dans le PDF : celle que permet la zone sélectionnée, entre 300 et 600 ppp.
    const ppp = Math.max(PPP_MIN, Math.min(pppSortie(), PPP_MAX));
    const largeur = Math.max(1, Math.round((pm[0] / 25.4) * ppp)), hauteur = Math.max(1, Math.round((pm[1] / 25.4) * ppp));
    const photo = await jpeg(rendreCadre(image, angle, sel, largeur, hauteur, Number(luminosite.i.value), Number(contraste.i.value)), 0.95);
    const reglages: Reglages = {
      format: format.value, photo: pm, papierNom: papier.value, papier: papierMm(), orientation: orientation.value as Orientation,
      marge: Math.max(MARGE_MIN, Number(marge.value) || MARGE_MIN), ecart: Math.max(0, Number(ecart.value) || 0),
      nombre: Math.max(0, Math.floor(Number(combien.value) || 0)), traits: traits.checked, guide: guide.checked,
      operations, angle, selection: [sel.x, sel.y, sel.l, sel.h], luminosite: Number(luminosite.i.value), contraste: Number(contraste.i.value),
    };
    const source = garder.checked ? { jpeg: await jpeg(original, 0.92), reglages: reglagesVersTexte(reglages) } : null;
    const octets = await appel("planche", { jpeg: photo, page: [d.largeur, d.hauteur], photo: pm, positions: d.positions, traits: traits.checked, source });
    await app.ouvrirResultat(octets, "Photos d’identité.pdf", "planche de photos d’identité");
    app.message(`Planche créée : ${pluriel(d.positions.length, "photo")} de ${mmTexte(pm[0])} × ${mmTexte(pm[1])} mm sur ${mmTexte(d.largeur)} × ${mmTexte(d.hauteur)} mm. Imprimez-la en taille réelle (100 %).`, "succes", 20000);
  } catch (e) {
    app.erreur(e, "Planche impossible");
  }
}
