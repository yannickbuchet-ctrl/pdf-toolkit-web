/**
 * Les fenêtres et outils de l'application : accueil, menu, enregistrement et compression, impression, signature et
 * images, mots de passe, fusion, infos sur les polices, annotations, à propos.
 */
import type { Application } from "./app";
import { appel } from "./moteur";
import { bouton, choisirFichiers, confirmer, demander, el, estPdf, fenetre, lire, menuFlottant, pluriel, tailleLisible } from "./dom";
import { icone, LOGO } from "./icones";
import { encoderPourPdf, lireImage, reduire, TYPES_IMAGES } from "./images";
import { APPLICATION, AUTEUR, CODE_SOURCE, DATE, DIRECTEUR, MODELE, MUPDF_VERSION, TESSERACT_VERSION, VERSION } from "../version";
import type { InfoPoliceDocument } from "../moteur/infoPolices";

export type ChoixCompression = "aucune" | "sans-perte" | "forte";

/** « 1-3, 5, 7-8 » */
export function plages(pages: number[]): string {
  const r: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    r.push(i === j ? `${pages[i] + 1}` : `${pages[i] + 1}-${pages[j] + 1}`);
    i = j + 1;
  }
  return r.join(", ");
}

/* --- Accueil ------------------------------------------------------------------------------------------------------ */

export function accueil(app: Application): HTMLElement {
  const ouvrir = el("button", { type: "button", class: "bouton principal", html: `${icone("ouvrir")}<span>Ouvrir un PDF</span>` });
  ouvrir.addEventListener("click", () => app.ouvrirDialogue());
  const depot = el("div", { class: "depot" },
    el("div", { html: icone("depot") }),
    el("p", { style: { margin: "0", fontSize: "1.1rem" } }, el("strong", { text: "Glissez un PDF ici" }), " ou"),
    ouvrir,
    el("p", { class: "aide", style: { margin: "0" }, text: "Plusieurs PDF déposés ensemble sont proposés à la fusion ; une photo, aux photos d’identité." }));
  const fonction = (ic: string, titre: string, texte: string, action: () => void) =>
    el("button", { type: "button", class: "fonction", onclick: action }, el("span", { html: icone(ic) }), el("div", {}, el("strong", { text: titre }), el("span", { text: texte })));
  const fonctions = el("div", { class: "fonctions" },
    fonction("texte", "Modifier le texte", "Cliquez sur un texte pour le réécrire, dans sa police d’origine quand c’est possible.", () => app.ouvrirDialogue()),
    fonction("fusion", "Fusionner des PDF", "Assemblez plusieurs fichiers dans l’ordre de votre choix.", () => fusion(app)),
    fonction("pages", "Organiser les pages", "Pivoter, déplacer, supprimer, extraire ou insérer des pages.", () => app.ouvrirDialogue()),
    fonction("comparer", "Comparer deux PDF", "Différences de texte mot à mot et différences visuelles, côte à côte, avec rapport.", () => comparer(app)),
    fonction("ocr", "Rendre un scan cherchable", "Reconnaissance de texte (OCR) : le texte d’un scan se cherche et se copie.", () => app.ouvrirDialogue()),
    fonction("photo", "Photos d’identité", "Une planche aux dimensions exactes, à imprimer sans mise à l’échelle.", () => photoIdentite(app)),
    fonction("signature", "Signer et annoter", "Signature, image, surlignage, notes, dessin et formulaires.", () => app.ouvrirDialogue()),
    fonction("compresser", "Compresser", "Réduisez la taille d’un PDF pour l’envoyer par e-mail.", () => app.ouvrirDialogue()),
    fonction("cadenas", "Mots de passe", "Ouvrez un PDF protégé, ajoutez ou retirez une protection AES 256 bits.", () => app.ouvrirDialogue()),
  );
  return el("div", { class: "accueil" },
    el("div", { class: "contenu" },
      el("h1", { text: "Un éditeur de PDF, dans votre navigateur" }),
      el("p", { class: "sous-titre", text: "Modifier le texte, organiser les pages, fusionner, signer, protéger, compresser, comparer vos PDF et rendre vos scans cherchables." }),
      depot,
      el("div", { class: "confidentialite" }, el("span", { html: icone("bouclier") }),
        el("div", {}, el("strong", { text: "Vos documents ne quittent jamais votre appareil. " }),
          "Tout le traitement se fait dans ce navigateur, grâce au moteur MuPDF compilé en WebAssembly : aucun envoi, aucun serveur, aucune statistique. Le site fonctionne aussi hors ligne une fois chargé.")),
      fonctions,
      el("p", { class: "aide", style: { marginTop: "26px" } }, `${APPLICATION} ${VERSION} — `, el("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); aPropos(); }, text: "À propos, licence et code source" }))));
}

/* --- Menu « Outils » ------------------------------------------------------------------------------------------------ */

export function menu(app: Application, ancre: HTMLElement) {
  const ouvert = app.etat !== null;
  menuFlottant(ancre, "Outils", [
    { icone: "fusion", texte: "Fusionner des PDF…", action: () => fusion(app) },
    { icone: "insererPdf", texte: "Insérer les pages d’un PDF…", action: () => app.insererPdf(), actif: ouvert },
    { icone: "pages", texte: "Organiser les pages", action: () => app.basculerGrille(), actif: ouvert },
    { icone: "compresser", texte: "Compresser et enregistrer…", action: () => compresserEtEnregistrer(app), actif: ouvert },
    { icone: "cadenas", texte: "Mot de passe…", action: () => motDePasse(app), actif: ouvert },
    { icone: "police", texte: "Infos sur les polices…", action: () => infosPolices(app), actif: ouvert },
    { icone: "liste", texte: "Annotations de la page…", action: () => listeAnnotations(app), actif: ouvert },
    { icone: "ocr", texte: "Reconnaissance de texte (OCR)…", action: () => ocr(app), actif: ouvert },
    null,
    { icone: "photo", texte: "Photos d’identité…", action: () => photoIdentite(app) },
    { icone: "photo", texte: "Modifier la planche de photos…", action: () => modifierPlanche(app), actif: ouvert && !!app.etat?.planche },
    { icone: "comparer", texte: "Comparer deux PDF…", action: () => comparer(app) },
    null,
    { icone: "info", texte: "Propriétés du document…", action: () => proprietes(app), actif: ouvert },
    { icone: "fermer", texte: "Fermer le document", action: () => app.fermerDocument(), actif: ouvert },
    { icone: "info", texte: "À propos…", action: () => aPropos() },
  ]);
}

/* --- Barre d'options des outils ------------------------------------------------------------------------------------ */

export function sousBarre(app: Application) {
  const b = app.sousBarre;
  const r = app.reglages;
  b.replaceChildren();
  b.hidden = !["ajout", "surligner", "dessin", "note"].includes(app.mode);
  const pastilles = (choisie: () => [number, number, number], choisir: (c: [number, number, number]) => void) => {
    const g = el("span", { class: "pastilles", role: "radiogroup", "aria-label": "Couleur" });
    const couleurs: [string, [number, number, number]][] = [["Jaune", [1, 0.87, 0.1]], ["Vert", [0.4, 0.85, 0.35]], ["Bleu", [0.15, 0.39, 0.92]], ["Rouge", [0.86, 0.15, 0.15]], ["Noir", [0, 0, 0]]];
    for (const [nom, c] of couleurs) {
      const p = el("button", { type: "button", class: "pastille", title: nom, "aria-label": nom, role: "radio", "aria-checked": String(choisie().join() === c.join()), style: { background: `rgb(${c.map((v) => v * 255).join(",")})` } });
      p.setAttribute("aria-pressed", String(choisie().join() === c.join()));
      p.addEventListener("click", () => {
        choisir(c);
        g.querySelectorAll(".pastille").forEach((x) => {
          x.setAttribute("aria-pressed", "false");
          x.setAttribute("aria-checked", "false");
        });
        p.setAttribute("aria-pressed", "true");
        p.setAttribute("aria-checked", "true");
      });
      g.append(p);
    }
    return g;
  };
  const choixListe = (libelle: string, options: [string, string][], valeur: string, changer: (v: string) => void) => {
    const s = el("select", { class: "entree", "aria-label": libelle });
    for (const [v, t] of options) s.append(el("option", { value: v, text: t, selected: v === valeur }));
    s.addEventListener("change", () => changer(s.value));
    return el("label", {}, `${libelle} :`, s);
  };
  if (app.mode === "surligner") {
    b.append(
      choixListe("Effet", [["Highlight", "Surligner"], ["Underline", "Souligner"], ["StrikeOut", "Barrer"]], r.typeAnnotation, (v) => (r.typeAnnotation = v as typeof r.typeAnnotation)),
      pastilles(() => r.couleurAnnotation, (c) => (r.couleurAnnotation = c)),
      el("span", { class: "aide", text: "Glissez sur le texte." }));
  } else if (app.mode === "note") {
    b.append(el("span", { text: "Couleur de la note :" }), pastilles(() => r.couleurAnnotation, (c) => (r.couleurAnnotation = c)), el("span", { class: "aide", text: "Cliquez à l’endroit de la note." }));
  } else if (app.mode === "dessin") {
    const epaisseur = el("input", { type: "range", min: "0.5", max: "12", step: "0.5", value: String(r.epaisseur), "aria-label": "Épaisseur du trait" });
    epaisseur.addEventListener("input", () => (r.epaisseur = Number(epaisseur.value)));
    b.append(
      choixListe("Outil", [["main", "Main levée"], ["Square", "Rectangle"], ["Circle", "Ellipse"]], r.outilDessin, (v) => (r.outilDessin = v as typeof r.outilDessin)),
      pastilles(() => r.couleurDessin, (c) => (r.couleurDessin = c)),
      el("label", {}, "Épaisseur :", epaisseur));
  } else if (app.mode === "ajout") {
    const taille = el("input", { type: "number", min: "4", max: "200", step: "0.5", value: String(r.taille), class: "entree", style: { width: "5em" }, "aria-label": "Taille en points" });
    taille.addEventListener("change", () => (r.taille = Math.max(4, Math.min(200, Number(taille.value) || 12))));
    const couleur = el("input", { type: "color", value: r.couleurTexte, "aria-label": "Couleur du texte" });
    couleur.addEventListener("input", () => (r.couleurTexte = couleur.value));
    const gras = el("input", { type: "checkbox", checked: r.gras });
    gras.addEventListener("change", () => (r.gras = gras.checked));
    const italique = el("input", { type: "checkbox", checked: r.italique });
    italique.addEventListener("change", () => (r.italique = italique.checked));
    b.append(
      choixListe("Police", [["Helvetica", "Sans empattements (Helvetica, Arial)"], ["Times-Roman", "Avec empattements (Times)"], ["Courier", "Machine à écrire (Courier)"]], r.police, (v) => (r.police = v)),
      el("label", {}, "Taille :", taille, "pt"), el("label", {}, "Couleur :", couleur), el("label", {}, gras, "Gras"), el("label", {}, italique, "Italique"),
      el("span", { class: "aide", text: "Maj+Entrée : nouvelle ligne." }));
  }
}

/* --- Enregistrement et compression ------------------------------------------------------------------------------ */

const CHOIX: [ChoixCompression, string, string][] = [
  ["aucune", "Ne pas compresser", "Enregistrement normal, le plus rapide."],
  ["sans-perte", "Compression sans perte", "Réduit la taille sans aucune perte de qualité (nettoyage et compression des données)."],
  ["forte", "Compression forte (images réduites)", "Images recompressées en JPEG (qualité 75) et, si elles sont très détaillées, ramenées à environ 150 ppp : idéal pour un envoi par e-mail. Le texte reste net et modifiable."],
];

/** La fenêtre « Voulez-vous compresser le PDF ? » (CompressDialog sur PC). */
export async function choisirCompression(app: Application, titre = "Enregistrer"): Promise<ChoixCompression | null> {
  const f = fenetre(titre);
  const formulaire = el("form", { method: "dialog" });
  formulaire.append(el("p", { style: { marginTop: "0", fontWeight: "600" }, text: "Voulez-vous compresser le PDF ?" }));
  for (const [cle, texte, indication] of CHOIX) {
    formulaire.append(el("label", { class: "choix" },
      el("input", { type: "radio", name: "compression", value: cle, checked: cle === app.dernierChoixCompression }),
      el("span", {}, texte, el("span", { class: "indication", text: indication }))));
  }
  const retenir = el("input", { type: "checkbox", checked: app.compressionRetenue !== null });
  formulaire.append(el("label", { class: "choix" }, retenir, el("span", { text: "Ne plus demander pour « Enregistrer » (jusqu’à la fermeture de la page)" })));
  if (app.etat?.motDePasse) formulaire.append(el("p", { class: "aide", html: `${icone("cadenas")} Le fichier sera protégé par son mot de passe (AES 256 bits).` }));
  f.corps.append(formulaire);
  const valider = () => {
    const choix = (formulaire.querySelector("input[name=compression]:checked") as HTMLInputElement).value as ChoixCompression;
    app.dernierChoixCompression = choix;
    app.compressionRetenue = retenir.checked ? choix : null;
    f.fermer(choix);
  };
  formulaire.addEventListener("submit", (e) => {
    e.preventDefault();
    valider();
  });
  f.pied.append(
    el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }),
    el("button", { type: "button", class: "bouton principal", html: `${icone("enregistrer")}<span>Enregistrer</span>`, onclick: valider }));
  const r = await f.fermee;
  return (r as ChoixCompression) ?? null;
}

async function compresserEtEnregistrer(app: Application) {
  const memo = app.compressionRetenue;
  app.compressionRetenue = null;
  app.dernierChoixCompression = app.dernierChoixCompression === "aucune" ? "forte" : app.dernierChoixCompression;
  await app.enregistrer(true);
  app.compressionRetenue = memo;
}

/* --- Mots de passe ------------------------------------------------------------------------------------------------- */

async function motDePasse(app: Application) {
  const protege = !!app.etat?.motDePasse;
  const f = fenetre(protege ? "Mot de passe du document" : "Protéger par mot de passe");
  const mdp1 = el("input", { type: "password", id: "mdp1", class: "entree", autocomplete: "new-password" });
  const mdp2 = el("input", { type: "password", id: "mdp2", class: "entree", autocomplete: "new-password" });
  const erreur = el("p", { class: "erreur-texte", role: "alert" });
  const voir = el("input", { type: "checkbox" });
  voir.addEventListener("change", () => (mdp1.type = mdp2.type = voir.checked ? "text" : "password"));
  f.corps.append(
    el("p", { text: protege
      ? "Ce document est protégé : il le restera à l’enregistrement. Vous pouvez changer son mot de passe ou retirer la protection."
      : "Le PDF ne pourra plus être ouvert sans ce mot de passe (chiffrement AES 256 bits). Notez-le bien : il ne peut pas être retrouvé." }),
    el("div", { class: "champ-formulaire" }, el("label", { for: "mdp1", text: protege ? "Nouveau mot de passe :" : "Mot de passe :" }), mdp1),
    el("div", { class: "champ-formulaire" }, el("label", { for: "mdp2", text: "Confirmez le mot de passe :" }), mdp2),
    el("label", { class: "choix" }, voir, "Afficher le mot de passe"),
    erreur);
  if (protege) f.pied.append(el("button", { type: "button", class: "bouton cadre danger", text: "Retirer la protection", onclick: () => f.fermer({ retirer: true }) }));
  f.pied.append(
    el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }),
    el("button", {
      type: "button", class: "bouton principal", text: "Protéger", onclick: () => {
        if (!mdp1.value) erreur.textContent = "Saisissez un mot de passe.";
        else if (mdp1.value !== mdp2.value) erreur.textContent = "Les deux mots de passe sont différents.";
        else if (mdp1.value.includes(",")) erreur.textContent = "Le mot de passe ne peut pas contenir de virgule.";
        else f.fermer({ motDePasse: mdp1.value });
      },
    }));
  setTimeout(() => mdp1.focus(), 50);
  const r = (await f.fermee) as { motDePasse?: string; retirer?: boolean } | null;
  if (!r) return;
  try {
    const e = await appel("definirMotDePasse", { motDePasse: r.retirer ? null : r.motDePasse! });
    await app.apresModification([], e);
    app.message(r.retirer ? "Protection retirée : enregistrez le document pour l’appliquer." : "Protection ajoutée : enregistrez le document pour l’appliquer.", "succes");
  } catch (e) {
    app.erreur(e);
  }
}

/* --- Impression ------------------------------------------------------------------------------------------------------ */

/**
 * Imprime par la fenêtre d'impression du navigateur. Les pages sont dessinées en images ; une planche de photos
 * d'identité (/PrintScaling /None) l'est à 300 ppp et à sa taille exacte, comme sur PC (prints_actual_size), les
 * autres documents sont ajustés à la feuille.
 */
export async function imprimer(app: Application) {
  const etat = app.etat;
  if (!etat) return;
  const reelle = etat.tailleReelle;
  const premiere = etat.pages[0];
  const mm = (pt: number) => (pt * 25.4) / 72;
  if (reelle) {
    const ok = await confirmer("Imprimer en taille réelle",
      `Ce document doit être imprimé à sa taille exacte (${mm(premiere.largeur).toFixed(1).replace(".", ",")} × ${mm(premiere.hauteur).toFixed(1).replace(".", ",")} mm). ` +
      "Dans la fenêtre d’impression, choisissez ce format de papier, des marges « Aucune » et l’échelle « 100 % » (ou « Taille réelle »), sans « Ajuster à la page ».", "Imprimer");
    if (!ok) return;
  }
  const ppp = reelle ? 300 : 150;
  app.message(`Préparation de l’impression : ${pluriel(etat.pages.length, "page")}…`, "info", 0);
  const conteneur = document.getElementById("impression") ?? document.body.appendChild(el("div", { id: "impression" }));
  conteneur.replaceChildren();
  const urls: string[] = [];
  try {
    for (let i = 0; i < etat.pages.length; i++) {
      const p = etat.pages[i];
      const r = await appel("rendre", { page: i, echelle: ppp / 72 });
      const c = el("canvas", { width: r.largeur, height: r.hauteur });
      c.getContext("2d")!.putImageData(new ImageData(r.pixels as Uint8ClampedArray<ArrayBuffer>, r.largeur, r.hauteur), 0, 0);
      const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/png"));
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = el("img", { src: url, alt: `Page ${i + 1}` });
      if (reelle) Object.assign(img.style, { width: `${mm(p.largeur)}mm`, height: `${mm(p.hauteur)}mm` });
      else Object.assign(img.style, { maxWidth: "100%", maxHeight: "100vh", margin: "0 auto", objectFit: "contain" });
      conteneur.append(img);
      await new Promise<void>((ok) => (img.complete ? ok() : (img.onload = () => ok())));
    }
    const style = el("style", {
      id: "style-impression",
      text: reelle ? `@page { size: ${mm(premiere.largeur).toFixed(2)}mm ${mm(premiere.hauteur).toFixed(2)}mm; margin: 0; }` : `@page { margin: 8mm; }`,
    });
    document.head.append(style);
    app.message("");
    window.print();
    style.remove();
  } catch (e) {
    app.erreur(e, "Impression impossible");
  } finally {
    setTimeout(() => {
      conteneur.replaceChildren();
      urls.forEach((u) => URL.revokeObjectURL(u));
    }, 1000);
  }
}

/* --- Images et signatures ---------------------------------------------------------------------------------------- */

/** Fond blanc d'une signature scannée rendu transparent : gris -> opacité (WHITE_TO_ALPHA sur PC). */
function blancTransparent(donnees: ImageData) {
  const p = donnees.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const a = g <= 170 ? 255 : g >= 235 ? 0 : Math.round((255 * (235 - g)) / 65);
    p[i + 3] = Math.min(p[i + 3], a);
  }
}

async function versPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
  return lire(blob);
}

/** Lit une image (formats et réductions : voir images.ts) et la renvoie en canvas, redressée. */
export async function chargerImage(fichier: Blob, annoncer?: (message: string) => void): Promise<HTMLCanvasElement> {
  return (await lireImage(fichier, annoncer)).canvas;
}

export async function image(app: Application, fichier?: File) {
  if (!app.etat) return;
  fichier ??= (await choisirFichiers(TYPES_IMAGES))[0];
  if (!fichier) return;
  try {
    const lue = await lireImage(fichier, (m) => app.message(m, "info", 0));
    // Un JPEG sans rotation EXIF est inséré tel quel. Les autres images sont réencodées : en JPEG pour une photo
    // (un PNG serait cinq à dix fois plus lourd), en PNG si elles ont des transparences.
    const octets = lue.format === "jpeg" && (await jpegSansRotation(fichier)) ? await lire(fichier) : await encoderPourPdf(lue);
    await placer(app, octets, lue.canvas, false);
  } catch (e) {
    app.erreur(e, "Image illisible");
  }
}

/** Un JPEG dont l'orientation EXIF est normale (1) peut être inséré sans être réencodé. */
async function jpegSansRotation(fichier: Blob): Promise<boolean> {
  const d = new Uint8Array(await fichier.slice(0, 128 * 1024).arrayBuffer());
  for (let i = 2; i + 10 < d.length && d[i] === 0xff;) {
    const longueur = (d[i + 2] << 8) | d[i + 3];
    if (d[i + 1] === 0xe1 && String.fromCharCode(...d.subarray(i + 4, i + 8)) === "Exif") {
      const t = i + 10;
      const le = d[t] === 0x49;
      const u16 = (o: number) => (le ? d[t + o] | (d[t + o + 1] << 8) : (d[t + o] << 8) | d[t + o + 1]);
      const u32 = (o: number) => (le ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = u32(4);
      for (let k = 0; k < u16(ifd); k++) {
        const e = ifd + 2 + 12 * k;
        if (u16(e) === 0x0112) return u16(e + 8) === 1;
      }
      return true;
    }
    if (d[i + 1] === 0xda) break;
    i += 2 + longueur;
  }
  return true;
}

export async function signature(app: Application) {
  if (!app.etat) return;
  const f = fenetre("Signature", { classe: "" });
  const pad = el("canvas", { class: "signature-pad", "aria-label": "Zone de signature : dessinez avec la souris, le doigt ou un stylet" });
  const ongletDessin = el("button", { type: "button", role: "tab", "aria-selected": "true", text: "Dessiner" });
  const ongletImage = el("button", { type: "button", role: "tab", "aria-selected": "false", text: "Importer une image" });
  const panneauDessin = el("div", { role: "tabpanel" }, pad,
    el("div", { class: "ligne", style: { marginTop: "8px" } },
      el("button", { type: "button", class: "bouton cadre", text: "Effacer", style: { flex: "0" }, onclick: () => effacer() }),
      el("span", { class: "aide", text: "Signez dans le cadre ; vous placerez ensuite la signature sur la page." })));
  const transparent = el("input", { type: "checkbox", checked: true });
  const fichier = el("input", { type: "file", accept: TYPES_IMAGES, class: "entree" });
  const panneauImage = el("div", { role: "tabpanel", hidden: true },
    el("div", { class: "champ-formulaire" }, el("label", { text: "Image de la signature (photo ou scan) :" }), fichier),
    el("label", { class: "choix" }, transparent, el("span", {}, "Rendre le fond blanc transparent", el("span", { class: "indication", text: "Le papier blanc ou gris clair disparaît, l’encre reste." }))));
  f.corps.append(el("div", { class: "onglets", role: "tablist" }, ongletDessin, ongletImage), panneauDessin, panneauImage);
  const choisirOnglet = (dessin: boolean) => {
    ongletDessin.setAttribute("aria-selected", String(dessin));
    ongletImage.setAttribute("aria-selected", String(!dessin));
    panneauDessin.hidden = !dessin;
    panneauImage.hidden = dessin;
  };
  ongletDessin.addEventListener("click", () => choisirOnglet(true));
  ongletImage.addEventListener("click", () => choisirOnglet(false));

  let traits = 0;
  const ctx = pad.getContext("2d")!;
  const preparer = () => {
    const r = pad.getBoundingClientRect();
    pad.width = Math.max(1, Math.round(r.width * 2));
    pad.height = Math.max(1, Math.round(r.height * 2));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#0b1d51";
  };
  const effacer = () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    traits = 0;
  };
  setTimeout(preparer, 60);
  let dernier: [number, number] | null = null;
  const point = (e: PointerEvent): [number, number] => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height];
  };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    dernier = point(e);
    traits++;
  });
  pad.addEventListener("pointermove", (e) => {
    if (!dernier) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(...dernier);
    ctx.lineTo(...p);
    ctx.stroke();
    dernier = p;
  });
  pad.addEventListener("pointerup", () => (dernier = null));

  f.pied.append(
    el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }),
    el("button", { type: "button", class: "bouton principal", text: "Placer sur la page", onclick: () => f.fermer("ok") }));
  if ((await f.fermee) !== "ok") return;
  try {
    let source: HTMLCanvasElement;
    if (!panneauImage.hidden) {
      const fi = fichier.files?.[0];
      if (!fi) return;
      // Une signature n'occupe qu'une partie de la page : 2 000 pixels suffisent, même pour une photo de 12 Mpx.
      source = reduire(await chargerImage(fi, (m) => app.message(m, "info", 0)), 2000);
      if (transparent.checked) {
        const c = source.getContext("2d")!;
        const d = c.getImageData(0, 0, source.width, source.height);
        blancTransparent(d);
        c.putImageData(d, 0, 0);
      }
    } else {
      if (!traits) return;
      source = rogner(pad);
    }
    await placer(app, await versPng(source), source, true);
  } catch (e) {
    app.erreur(e, "Signature impossible");
  }
}

/** Le dessin sans les marges vides autour. */
function rogner(c: HTMLCanvasElement): HTMLCanvasElement {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 10) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < x0) return c;
  const m = 8;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width - 1, x1 + m); y1 = Math.min(c.height - 1, y1 + m);
  const r = el("canvas", { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  r.getContext("2d")!.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, x1 - x0 + 1, y1 - y0 + 1);
  return r;
}

/** Pose l'image sur la page affichée : on la déplace et la redimensionne, puis on valide. */
async function placer(app: Application, octets: Uint8Array, apercu: HTMLCanvasElement, signature: boolean) {
  const vue = app.vueCourante();
  if (!vue) return;
  app.placement?.remove();
  const p = app.etat!.pages[vue.index];
  const s = app.echelleEcran;
  const ratio = apercu.width / apercu.height;
  let l = Math.min(p.largeur * (signature ? 0.3 : 0.5), 220);
  let h = l / ratio;
  if (h > p.hauteur * 0.5) {
    h = p.hauteur * 0.5;
    l = h * ratio;
  }
  let x = (p.largeur - l) / 2, y = (p.hauteur - h) / 2;
  // L'aperçu affiché pendant le placement : une copie réduite (une photo entière en PNG prendrait des secondes).
  const img = el("img", { src: reduire(apercu, 1200).toDataURL(), alt: "" });
  const poignee = el("div", { class: "poignee", "aria-hidden": "true" });
  const valider = el("button", { type: "button", class: "bouton principal", text: "Valider" });
  const annuler = el("button", { type: "button", class: "bouton cadre", text: "Annuler" });
  const boite = el("div", { class: "placement", tabindex: "0", role: "application", "aria-label": `${signature ? "Signature" : "Image"} à placer : flèches pour déplacer, Maj+flèches pour redimensionner, Entrée pour valider` },
    img, poignee, el("div", { class: "actions-placement" }, valider, annuler));
  const appliquer = () => Object.assign(boite.style, { left: `${x * s}px`, top: `${y * s}px`, width: `${l * s}px`, height: `${h * s}px` });
  appliquer();
  vue.calque.append(boite);
  app.placement = boite;
  boite.focus();
  let glisse: { mode: "deplacer" | "taille"; x: number; y: number; ox: number; oy: number; ol: number } | null = null;
  boite.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    boite.setPointerCapture(e.pointerId);
    glisse = { mode: e.target === poignee ? "taille" : "deplacer", x: e.clientX, y: e.clientY, ox: x, oy: y, ol: l };
  });
  boite.addEventListener("pointermove", (e) => {
    if (!glisse) return;
    const dx = (e.clientX - glisse.x) / s, dy = (e.clientY - glisse.y) / s;
    if (glisse.mode === "deplacer") {
      x = glisse.ox + dx;
      y = glisse.oy + dy;
    } else {
      l = Math.max(10, glisse.ol + Math.max(dx, dy * ratio));
      h = l / ratio;
    }
    appliquer();
  });
  boite.addEventListener("pointerup", () => (glisse = null));
  const fin = () => {
    boite.remove();
    app.placement = null;
  };
  boite.addEventListener("keydown", (e) => {
    const pas = e.altKey ? 1 : 5;
    if (e.key === "Enter") valider.click();
    else if (e.key === "Escape") annuler.click();
    else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const [dx, dy] = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key as "ArrowLeft"]!;
      if (e.shiftKey) {
        l = Math.max(10, l + dx + dy);
        h = l / ratio;
      } else {
        x += dx;
        y += dy;
      }
      appliquer();
    }
  });
  annuler.addEventListener("click", fin);
  valider.addEventListener("click", async () => {
    fin();
    try {
      await appel("insererImage", { page: vue.index, octets, rect: [x, y, x + l, y + h], signature }, { transferer: [octets.buffer as ArrayBuffer] });
      await app.apresModification([vue.index]);
      app.message(`${signature ? "Signature ajoutée" : "Image ajoutée"} (Ctrl+Z pour annuler).`, "succes");
    } catch (e) {
      app.erreur(e, "Insertion impossible");
    }
  });
  app.message("Déplacez et redimensionnez (poignée en bas à droite), puis cliquez sur « Valider ».", "info", 10000);
}

/* --- Infos sur les polices ------------------------------------------------------------------------------------------- */

export async function policesDuDocument(): Promise<InfoPoliceDocument[]> {
  return appel("polices");
}

const NOMS_TABLE: [number, string][] = [[4, "Nom complet"], [6, "Nom PostScript"], [5, "Version"], [8, "Éditeur"], [9, "Créateur"], [11, "Site de l’éditeur"], [12, "Site du créateur"], [0, "Copyright"], [13, "Licence"], [14, "Lien de la licence"]];

/** La fenêtre « Infos sur les polices » (FontInfoDialog sur PC), centrée sur une police si elle est donnée. */
export async function infosPolices(app: Application, policeVisee?: string) {
  let liste: InfoPoliceDocument[];
  try {
    liste = await policesDuDocument();
  } catch (e) {
    app.erreur(e);
    return;
  }
  const f = fenetre("Infos sur les polices", { classe: "large" });
  const nomVise = policeVisee?.replace(/^[A-Z]{6}\+/, "");
  f.corps.append(el("p", { class: "aide", text: "Ce que le PDF dit de chaque police. Une police « intégrée » est enregistrée dans le fichier : le texte modifié garde son apparence. Une police réduite ne contient que les lettres utilisées : les autres sont prises dans la police la plus proche." }));
  for (const p of liste) {
    const details = el("details", { open: nomVise ? p.nomPdf === nomVise : liste.length === 1 });
    const etat = p.integree ? (p.sousEnsemble ? "intégrée, réduite aux lettres utilisées" : "intégrée en entier") : "non intégrée (la visionneuse en choisit une semblable)";
    details.append(el("summary", { style: { cursor: "pointer", padding: "6px 0" } }, el("strong", { text: `${p.famille} ${p.style}` }), ` — ${etat}`));
    const t = el("table", { class: "tableau" });
    const ligne = (k: string, v: string | Node) => t.append(el("tr", {}, el("th", { text: k, scope: "row" }), el("td", {}, v)));
    ligne("Nom dans le PDF", p.nomPdf);
    ligne("Type", `${p.type}, codage ${p.encodage}`);
    ligne("Pages", plages(p.pages.map((x) => x - 1)));
    for (const [id, libelle] of NOMS_TABLE) if (p.noms[id]) ligne(libelle, p.noms[id]);
    ligne("Lettres présentes dans le PDF", el("div", { class: "lettres", text: p.lettres || "(aucune lue)" }));
    const requete = encodeURIComponent(`${p.famille} ${p.style} font`);
    const liens = el("div", { class: "ligne", style: { marginTop: "8px" } },
      el("a", { class: "bouton cadre", href: `https://www.google.com/search?q=${requete}`, target: "_blank", rel: "noopener noreferrer", text: "Rechercher sur Internet" }),
      el("a", { class: "bouton cadre", href: `https://fonts.google.com/?query=${encodeURIComponent(p.famille)}`, target: "_blank", rel: "noopener noreferrer", text: "Chercher sur Google Fonts" }));
    details.append(t, liens);
    f.corps.append(details);
  }
  // Polices de l'ordinateur : Chrome et Edge peuvent les lire, avec l'autorisation de l'utilisateur.
  const w = window as unknown as { queryLocalFonts?: () => Promise<{ postscriptName: string; fullName: string; family: string; style: string; blob: () => Promise<Blob> }[]> };
  const zoneLocale = el("fieldset", {}, el("legend", { text: "Polices installées sur cet ordinateur" }));
  if (w.queryLocalFonts) {
    const b = el("button", { type: "button", class: "bouton cadre", text: "Utiliser les polices de cet ordinateur" });
    const resultat = el("p", { class: "aide", "aria-live": "polite" });
    b.addEventListener("click", async () => {
      try {
        const locales = await w.queryLocalFonts!();
        const norm = (n: string) => n.replace(/^[A-Z]{6}\+/, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/regular/g, "").replace(/mt$/, "").replace(/ps(bold|italic|bolditalic)?$/, "$1");
        let trouvees = 0;
        for (const p of liste.filter((x) => !x.integree || x.sousEnsemble)) {
          const cible = norm(p.nomPdf);
          const loc = locales.find((l) => norm(l.postscriptName) === cible || norm(l.fullName) === cible || norm(l.family + l.style) === cible);
          if (!loc) continue;
          const octets = await lire(await loc.blob());
          if (await appel("ajouterPoliceLocale", { noms: [p.nomPdf, loc.postscriptName, loc.fullName], octets })) trouvees++;
        }
        resultat.textContent = trouvees
          ? `${pluriel(trouvees, "police trouvée", "polices trouvées")} sur cet ordinateur : le texte modifié sera écrit avec elle${trouvees > 1 ? "s" : ""} (et intégré au PDF).`
          : "Aucune des polices de ce document n’est installée sur cet ordinateur.";
      } catch (e) {
        resultat.textContent = `Accès refusé ou impossible : ${(e as Error).message}`;
      }
    });
    zoneLocale.append(el("p", { class: "aide", text: "Comme la version bureau, l’application peut écrire avec la police d’origine si elle est installée sur l’ordinateur. Le navigateur vous demandera l’autorisation ; les polices sont lues sur place, rien n’est envoyé." }), b, resultat);
  } else {
    zoneLocale.append(el("p", { class: "aide", text: "Ce navigateur ne permet pas aux sites de lire les polices installées (seuls Chrome et Edge le proposent). Les lettres absentes d’une police réduite sont prises dans la police standard la plus proche (Helvetica, Times ou Courier, aux mêmes dimensions qu’Arial, Times New Roman et Courier New)." }));
  }
  f.corps.append(zoneLocale);
  f.pied.append(el("button", { type: "button", class: "bouton principal", text: "Fermer", onclick: () => f.fermer() }));
  await f.fermee;
}

/* --- Annotations de la page --------------------------------------------------------------------------------------------- */

async function listeAnnotations(app: Application) {
  const page = app.pageCourante;
  const f = fenetre(`Annotations de la page ${page + 1}`);
  const remplir = async () => {
    const liste = await appel("annotations", { page });
    f.corps.replaceChildren();
    if (!liste.length) {
      f.corps.append(el("p", { text: "Aucune annotation sur cette page." }));
      return;
    }
    const ul = el("ul", { class: "liste-fichiers" });
    for (const a of liste) {
      const sup = bouton("supprimer", "Supprimer cette annotation", async () => {
        try {
          await appel("supprimerAnnotation", { page, index: a.index });
          await app.apresModification([page]);
          await remplir();
        } catch (e) {
          app.erreur(e);
        }
      }, { texte: false, classe: "danger" });
      ul.append(el("li", {}, el("span", { class: "nom" }, el("strong", { text: a.type }), a.contenu ? ` — ${a.contenu}` : ""), el("span", { class: "infos", text: a.auteur }), sup));
    }
    f.corps.append(ul);
  };
  await remplir();
  f.pied.append(el("button", { type: "button", class: "bouton principal", text: "Fermer", onclick: () => f.fermer() }));
  await f.fermee;
}

/* --- Propriétés et à propos ------------------------------------------------------------------------------------------- */

async function proprietes(app: Application) {
  const e = app.etat!;
  const t = el("table", { class: "tableau" });
  const ligne = (k: string, v: string) => t.append(el("tr", {}, el("th", { scope: "row", text: k }), el("td", { text: v })));
  ligne("Fichier", app.fichier?.nom ?? e.nom);
  ligne("Pages", String(e.pages.length));
  const p = e.pages[0];
  ligne("Format de la première page", `${((p.largeur * 25.4) / 72).toFixed(1).replace(".", ",")} × ${((p.hauteur * 25.4) / 72).toFixed(1).replace(".", ",")} mm`);
  const noms: Record<string, string> = { titre: "Titre", auteur: "Auteur", sujet: "Sujet", createur: "Créé avec", producteur: "Producteur", format: "Format" };
  for (const [k, v] of Object.entries(e.metadonnees)) ligne(noms[k] ?? k, v);
  ligne("Protection", e.motDePasse ? "mot de passe (AES 256 bits à l’enregistrement)" : "aucune");
  ligne("Impression", e.tailleReelle ? "taille réelle demandée (sans mise à l’échelle)" : "ajustée à la feuille");
  const f = fenetre("Propriétés du document");
  f.corps.append(t);
  f.pied.append(el("button", { type: "button", class: "bouton principal", text: "Fermer", onclick: () => f.fermer() }));
  await f.fermee;
}

export async function aPropos() {
  const f = fenetre("À propos");
  const source = CODE_SOURCE
    ? el("a", { href: CODE_SOURCE, target: "_blank", rel: "noopener noreferrer", text: CODE_SOURCE })
    : el("span", { class: "repere", text: "[À COMPLÉTER : adresse du dépôt du code source]" });
  f.corps.append(
    el("div", { style: { display: "flex", gap: "14px", alignItems: "center" } },
      el("div", { html: LOGO, style: { width: "56px", height: "56px", flex: "none" } }),
      el("div", {}, el("strong", { style: { fontSize: "1.15rem" }, text: `${APPLICATION} ${VERSION}` }), el("div", { class: "aide", text: `Version du ${DATE}` }))),
    el("dl", { class: "apropos" },
      el("dt", { text: "Auteur" }), el("dd", { text: `Application écrite par ${AUTEUR} (${MODELE}) sous la direction de ${DIRECTEUR}.` }),
      el("dt", { text: "Confidentialité" }), el("dd", { text: "Tout le traitement se fait dans votre navigateur. Aucun fichier n’est envoyé, aucun serveur ne reçoit vos documents, aucune statistique n’est collectée." }),
      el("dt", { text: "Licence" }), el("dd", {}, "GNU Affero General Public License, version 3 (AGPL v3). Ce choix est imposé par MuPDF : toute personne qui met ce logiciel à disposition, modifié ou non, doit aussi en publier le code source."),
      el("dt", { text: "Code source" }), el("dd", {}, source),
      el("dt", { text: "Composants tiers" }),
      el("dd", {}, el("ul", { style: { margin: "4px 0", paddingLeft: "18px" } },
        el("li", {}, `MuPDF ${MUPDF_VERSION} et MuPDF.js (Artifex Software) — AGPL v3 — lecture, rendu et écriture des PDF.`),
        el("li", {}, `Tesseract.js ${TESSERACT_VERSION} et Tesseract (Apache 2.0), avec leurs données de langue française et anglaise (Apache 2.0) — reconnaissance de texte, téléchargés seulement à sa première utilisation.`),
        el("li", {}, "Polices standard du PDF intégrées à MuPDF (URW Nimbus Sans, Nimbus Roman, Nimbus Mono…) — licences libres de leurs auteurs, détaillées dans LICENCES-TIERCES.md."),
        el("li", {}, "Vite et TypeScript servent seulement à construire le site ; ils ne sont pas inclus dans le site publié."))),
    ));
  f.pied.append(el("button", { type: "button", class: "bouton principal", text: "Fermer", onclick: () => f.fermer() }));
  await f.fermee;
}

/* --- Fusion ------------------------------------------------------------------------------------------------------------- */

interface Entree {
  nom: string;
  octets?: Uint8Array;
  motDePasse?: string;
  pages: number;
  principal?: boolean;
}

/** Concaténer des PDF dans l'ordre choisi (MergeDialog sur PC). */
export async function fusion(app: Application, fichiersInitiaux: File[] = []) {
  const entrees: Entree[] = [];
  if (app.etat) entrees.push({ nom: `${app.fichier?.nom ?? app.etat.nom} (document ouvert)`, pages: app.etat.pages.length, principal: true });
  const f = fenetre("Fusionner des PDF", { classe: "large" });
  const liste = el("ul", { class: "liste-fichiers", "aria-label": "Fichiers à fusionner, dans l'ordre" });
  const total = el("p", { class: "aide", "aria-live": "polite" });
  const ajouterBouton = el("button", { type: "button", class: "bouton cadre", html: `${icone("plus")}<span>Ajouter des PDF…</span>` });
  f.corps.append(el("p", { text: "Les fichiers sont assemblés de haut en bas. Changez l’ordre avec les flèches." }), liste, el("div", { class: "ligne", style: { marginTop: "10px" } }, ajouterBouton, total));
  const fusionner = el("button", { type: "button", class: "bouton principal", text: "Fusionner" });
  const dessiner = () => {
    liste.replaceChildren();
    entrees.forEach((e, i) => {
      const li = el("li", {},
        el("span", { class: "nom", text: `${i + 1}. ${e.nom}` }),
        el("span", { class: "infos", text: `${pluriel(e.pages, "page")}${e.octets ? ` · ${tailleLisible(e.octets.length)}` : ""}` }),
        bouton("haut", `Monter « ${e.nom} »`, () => {
          if (i > 0) [entrees[i - 1], entrees[i]] = [entrees[i], entrees[i - 1]];
          dessiner();
        }, { texte: false }),
        bouton("bas", `Descendre « ${e.nom} »`, () => {
          if (i < entrees.length - 1) [entrees[i + 1], entrees[i]] = [entrees[i], entrees[i + 1]];
          dessiner();
        }, { texte: false }),
        bouton("supprimer", `Retirer « ${e.nom} »`, () => {
          entrees.splice(i, 1);
          dessiner();
        }, { texte: false, classe: "danger" }));
      liste.append(li);
    });
    const pages = entrees.reduce((s, e) => s + e.pages, 0);
    total.textContent = entrees.length ? `${pluriel(entrees.length, "fichier")}, ${pluriel(pages, "page")} au total.` : "Aucun fichier.";
    fusionner.disabled = entrees.length < 2;
  };
  const ajouter = async (fichiers: File[]) => {
    for (const fi of fichiers.filter(estPdf)) {
      const octets = await lire(fi);
      try {
        const r = await app.avecMotDePasse(fi.name, async (motDePasse) => ({ ...(await appel("examiner", { octets: octets.slice(), motDePasse })), motDePasse }));
        if (r) entrees.push({ nom: fi.name, octets, motDePasse: r.motDePasse, pages: r.pages });
      } catch (e) {
        app.erreur(e, `« ${fi.name} » ignoré`);
      }
    }
    dessiner();
  };
  ajouterBouton.addEventListener("click", async () => ajouter(await choisirFichiers("application/pdf,.pdf", true)));
  f.dialog.addEventListener("dragover", (e) => e.preventDefault());
  f.dialog.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ajouter([...(e.dataTransfer?.files ?? [])]);
  });
  f.pied.append(el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }), fusionner);
  fusionner.addEventListener("click", () => f.fermer("ok"));
  await ajouter(fichiersInitiaux);
  dessiner();
  if ((await f.fermee) !== "ok") return;
  try {
    const octets = await appel("fusionner", { fichiers: entrees.map((e) => (e.principal ? "principal" as const : { octets: e.octets!, motDePasse: e.motDePasse })) });
    const premier = entrees[0].nom.replace(/ \(document ouvert\)$/, "").replace(/\.pdf$/i, "");
    await app.ouvrirResultat(octets, `${premier} (fusion).pdf`, "fusion");
    app.message(`${pluriel(entrees.length, "fichier fusionné", "fichiers fusionnés")} : ${pluriel(app.etat!.pages.length, "page")}. Pensez à enregistrer.`, "succes");
  } catch (e) {
    app.erreur(e, "Fusion impossible");
  }
}

/* --- Photos d'identité et comparaison (chargées à la demande) ----------------------------------------------------- */

export async function photoIdentite(app: Application, fichier?: File) {
  const m = await import("./photo");
  await m.dialoguePhoto(app, fichier ?? null, null);
}

async function modifierPlanche(app: Application) {
  try {
    const planche = await appel("lirePlanche");
    const m = await import("./photo");
    if (!planche.complet) app.message("Cette planche ne contient que la photo déjà recadrée : ce qui était hors du cadre n’est plus disponible.", "info", 12000);
    await m.dialoguePhoto(app, null, planche);
  } catch (e) {
    app.erreur(e, "Planche illisible");
  }
}

/** Reconnaissance de texte (OCR) : le module (et Tesseract.js) n'est chargé qu'à la première utilisation. */
export async function ocr(app: Application) {
  if (!app.etat) return;
  const m = await import("./ocr");
  await m.reconnaissanceTexte(app);
}

export async function comparer(app: Application) {
  const m = await import("./comparaison");
  await m.vueComparaison(app);
}

export { demander };
