/**
 * Rapport PDF d'une comparaison (comparison_report sur PC) : synthèse et liste numérotée des différences, puis, pour
 * chaque couple de pages qui diffère, la version A à gauche et la version B à droite, surlignées par des annotations
 * numérotées comme la liste, et enfin un gros plan de chaque différence (report_details).
 */
import * as mupdf from "mupdf";
import {
  decompte, description, millimetres, MODES, nomPaire, superposition, titrePaire, TYPES, TYPES_PAGE, TYPES_TEXTE, type Difference, type Rect,
  type Resultat,
} from "./comparaison";
import { winAnsi } from "./tableUnicode";
import { OPTIONS_SIMPLES } from "./document";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
type Couleur = [number, number, number];
const ARDOISE: Couleur = [0.28, 0.33, 0.41];
const ENCRE: Couleur = [0.12, 0.16, 0.23];
const GROS_PLANS = 150; // différences au plus montrées en gros plan à la fin du rapport

const nb = (v: number) => {
  const t = v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
};
const rgb = (hex: string): Couleur => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

/** Le texte en codes WinAnsi (police standard Helvetica) ; les flèches deviennent -> et <->. */
function codes(texte: string): number[] {
  const t = texte.replace(/↔/g, "<->").replace(/→/g, "->");
  return [...t].map((c) => winAnsi(c.codePointAt(0)!) ?? 0x3f);
}

/** Écriture des pages du rapport, en coordonnées de page affichée (y vers le bas). */
class Ecrivain {
  static L = 595;
  static H = 842;
  static MARGE = 48;
  polices: Record<"r" | "g", mupdf.Font>;
  objets: Record<"r" | "g", mupdf.PDFObject>;
  page!: { objet: mupdf.PDFObject; contenu: string[]; hauteur: number };
  pages: { objet: mupdf.PDFObject; contenu: string[]; hauteur: number }[] = [];
  y = 0;

  constructor(readonly doc: mupdf.PDFDocument) {
    this.polices = { r: new mupdf.Font("Helvetica"), g: new mupdf.Font("Helvetica-Bold") };
    this.objets = { r: doc.addSimpleFont(this.polices.r, "Latin"), g: doc.addSimpleFont(this.polices.g, "Latin") };
    this.nouvellePage();
  }

  nouvellePage(largeur = Ecrivain.L, hauteur = Ecrivain.H, ressources: Record<string, unknown> = {}) {
    const objet = this.doc.addPage([0, 0, largeur, hauteur], 0, { Font: { R: this.objets.r, G: this.objets.g }, ...ressources }, "");
    this.doc.insertPage(-1, objet);
    this.page = { objet: this.doc.findPage(this.doc.countPages() - 1), contenu: [], hauteur };
    this.pages.push(this.page);
    this.y = Ecrivain.MARGE;
    return this.page;
  }

  largeur(texte: string, taille: number, gras: boolean): number {
    const f = this.polices[gras ? "g" : "r"];
    let l = 0;
    for (const c of texte.replace(/↔/g, "<->").replace(/→/g, "->")) {
      const g = f.encodeCharacter(c.codePointAt(0)!);
      l += f.advanceGlyph(g > 0 ? g : f.encodeCharacter(0x3f)) * taille;
    }
    return l;
  }

  ajuster(texte: string, largeur: number, taille = 10, gras = false): string {
    if (this.largeur(texte, taille, gras) <= largeur) return texte;
    while (texte && this.largeur(texte + "…", taille, gras) > largeur) texte = texte.slice(0, -1);
    return texte.trimEnd() + "…";
  }

  texte(x: number, y: number, texte: string, taille = 10, gras = false, couleur: Couleur = ENCRE) {
    const hex = codes(texte).map((c) => c.toString(16).padStart(2, "0")).join("");
    this.page.contenu.push(`BT ${couleur.map(nb).join(" ")} rg /${gras ? "G" : "R"} ${nb(taille)} Tf 1 0 0 -1 ${nb(x)} ${nb(y)} Tm <${hex}> Tj ET`);
  }

  rectangle(r: Rect, remplissage: Couleur | null, trait: Couleur | null = null, epaisseur = 0.6, tirets = false) {
    let op = `q ${tirets ? "[4] 0 d " : ""}${nb(epaisseur)} w `;
    if (remplissage) op += `${remplissage.map(nb).join(" ")} rg `;
    if (trait) op += `${trait.map(nb).join(" ")} RG `;
    op += `${nb(r[0])} ${nb(r[1])} ${nb(r[2] - r[0])} ${nb(r[3] - r[1])} re ${remplissage && trait ? "B" : remplissage ? "f" : "S"} Q`;
    this.page.contenu.push(op);
  }

  ligne(texte = "", options: { taille?: number; gras?: boolean; couleur?: Couleur; retrait?: number; ecart?: number; pastille?: Couleur } = {}) {
    const { taille = 10, gras = false, couleur = ENCRE, retrait = 0, ecart = 4, pastille } = options;
    if (this.y + taille + ecart > Ecrivain.H - Ecrivain.MARGE) this.nouvellePage();
    this.y += taille;
    let x = Ecrivain.MARGE + retrait;
    if (pastille) {
      this.rectangle([x, this.y - taille * 0.8, x + taille * 0.8, this.y], pastille);
      x += taille * 1.3;
    }
    if (texte) this.texte(x, this.y, this.ajuster(texte, Ecrivain.L - Ecrivain.MARGE - x, taille, gras), taille, gras, couleur);
    this.y += ecart;
  }

  colonnes(valeurs: (string | number)[], positions: number[], options: { gras?: boolean; couleur?: Couleur; pastille?: Couleur } = {}) {
    const taille = 9;
    if (this.y + taille + 4 > Ecrivain.H - Ecrivain.MARGE) this.nouvellePage();
    this.y += taille;
    const limites = [...positions.slice(1), Ecrivain.L - 2 * Ecrivain.MARGE];
    valeurs.forEach((v, k) => {
      let x = positions[k];
      if (options.pastille && k === 2) {
        this.rectangle([Ecrivain.MARGE + x, this.y - taille * 0.8, Ecrivain.MARGE + x + taille * 0.8, this.y], options.pastille);
        x += taille * 1.2;
      }
      this.texte(Ecrivain.MARGE + x, this.y, this.ajuster(String(v), limites[k] - x - 6, taille, options.gras), taille, options.gras, options.couleur);
    });
    this.y += 4;
  }

  /** Ajoute un XObject (page, image) aux ressources de la page en cours. */
  ressource(nom: string, objet: mupdf.PDFObject) {
    const ressources = this.page.objet.get("Resources");
    if (!ressources.get("XObject").isDictionary()) ressources.put("XObject", this.doc.newDictionary());
    ressources.get("XObject").put(nom, objet);
  }

  trait() {
    this.y += 2;
    this.page.contenu.push(`q 0.89 0.91 0.94 RG 0.8 w ${Ecrivain.MARGE} ${nb(this.y)} m ${Ecrivain.L - Ecrivain.MARGE} ${nb(this.y)} l S Q`);
    this.y += 6;
  }

  /** Écrit le contenu de chaque page (en retournant l'axe y : le PDF compte depuis le bas). */
  terminer() {
    for (const p of this.pages) {
      const flux = `1 0 0 -1 0 ${nb(p.hauteur)} cm\n` + p.contenu.join("\n") + "\n";
      p.objet.put("Contents", this.doc.addStream(flux, {}));
    }
  }
}

/** La page d'un autre document, sous forme de formulaire XObject à dessiner dans le rapport. */
export function formeDePage(cible: mupdf.PDFDocument, source: mupdf.PDFDocument, index: number): { forme: mupdf.PDFObject; transformation: mupdf.Matrix; bornes: Rect } {
  const page = source.loadPage(index);
  const objet = page.getObject();
  const contenus = objet.get("Contents");
  const morceaux: Uint8Array[] = [];
  const lire = (o: mupdf.PDFObject) => {
    if (o.isStream()) morceaux.push(o.readStream().asUint8Array().slice());
  };
  if (contenus.isArray()) for (let k = 0; k < contenus.length; k++) lire(contenus.get(k));
  else lire(contenus);
  const total = morceaux.reduce((s, m) => s + m.length + 1, 0);
  const flux = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) {
    flux.set(m, pos);
    flux[pos + m.length] = 10;
    pos += m.length + 1;
  }
  const boite = objet.getInheritable("MediaBox");
  const bbox = boite.isArray() ? [0, 1, 2, 3].map((k) => boite.get(k).asNumber()) : [0, 0, 612, 792];
  const ressources = objet.getInheritable("Resources");
  const forme = cible.addStream(flux, {
    Type: "Form", Subtype: "Form", BBox: bbox,
    Resources: ressources.isDictionary() ? cible.graftObject(ressources) : {},
  });
  // Les noms de la forme doivent être des noms PDF, et non des chaînes.
  forme.put("Type", cible.newName("XObject"));
  forme.put("Subtype", cible.newName("Form"));
  return { forme, transformation: page.getTransform(), bornes: page.getBounds() as Rect };
}

/**
 * Cadre carré d'un gros plan autour d'une zone (detail_clip sur PC) : la zone et ses abords, au moins 34 points (12 mm)
 * de côté, ramené dans la page sans être réduit tant qu'il y tient.
 */
export function cadreGrosPlan(zone: Rect, page: Rect): Rect {
  let cote = Math.max(zone[2] - zone[0], zone[3] - zone[1]) * 1.5 + 18;
  cote = Math.min(Math.max(cote, 34), Math.max(page[2] - page[0], page[3] - page[1]));
  const cx = (zone[0] + zone[2]) / 2, cy = (zone[1] + zone[3]) / 2;
  const c: Rect = [cx - cote / 2, cy - cote / 2, cx + cote / 2, cy + cote / 2];
  const dx = Math.max(page[0] - c[0], 0) - Math.max(c[2] - page[2], 0);
  const dy = Math.max(page[1] - c[1], 0) - Math.max(c[3] - page[3], 0);
  return [Math.max(page[0], c[0] + dx), Math.max(page[1], c[1] + dy), Math.min(page[2], c[2] + dx), Math.min(page[3], c[3] + dy)];
}

export function rapportComparaison(resultat: Resultat, docA: mupdf.PDFDocument, docB: mupdf.PDFDocument, nomA: string, nomB: string, application: string, date = new Date()): Uint8Array {
  const rapport = new mupdf.PDFDocument();
  const e = new Ecrivain(rapport);
  const { differences: items, paires, options } = resultat;
  const noms = resultat.noms;
  // Pages des deux versions, et leur forme XObject dans le rapport (une seule par page, partagée par les feuillets et
  // les gros plans).
  const pages = new Map<string, mupdf.PDFPage>();
  const page = (cote: "a" | "b", index: number) => {
    const cle = cote + index;
    if (!pages.has(cle)) pages.set(cle, (cote === "a" ? docA : docB).loadPage(index));
    return pages.get(cle)!;
  };
  const formes = new Map<string, ReturnType<typeof formeDePage>>();
  const forme = (cote: "a" | "b", index: number) => {
    const cle = cote + index;
    if (!formes.has(cle)) formes.set(cle, formeDePage(rapport, cote === "a" ? docA : docB, index));
    return formes.get(cle)!;
  };

  e.ligne("Comparaison de deux PDF", { taille: 20, gras: true, ecart: 8 });
  e.ligne(`Rapport établi le ${date.getDate()} ${MOIS[date.getMonth()]} ${date.getFullYear()} à ${date.getHours()} h ${String(date.getMinutes()).padStart(2, "0")} par ${application}`,
    { taille: 9, couleur: ARDOISE, ecart: 12 });
  const pl = (n: number) => (n > 1 ? "s" : "");
  e.ligne(`Version A : ${nomA} (${resultat.pagesA} page${pl(resultat.pagesA)})`, { gras: true });
  e.ligne(`Version B : ${nomB} (${resultat.pagesB} page${pl(resultat.pagesB)})`, { gras: true });
  const details = [`comparaison : ${MODES[options.mode].toLowerCase()}`];
  if (options.ignorerCasse) details.push("casse ignorée");
  if (options.ignorerPonctuation) details.push("ponctuation et espaces ignorés");
  if (resultat.visuel) {
    details.push(`tolérance visuelle ${Math.round(options.tolerance * 100)} %`);
    if (options.reglage === "plan") details.push("réglage plan technique (zones fines)");
  }
  e.ligne("Options : " + details.join(", "), { taille: 9, couleur: ARDOISE, ecart: 6 });
  for (const note of resultat.notes) e.ligne(note, { taille: 9, couleur: rgb("#b45309") });
  e.trait();

  e.ligne("Résumé", { taille: 13, gras: true, ecart: 6 });
  if (!items.length) {
    e.ligne("Aucune différence trouvée : les deux versions sont identiques selon les options choisies.");
  } else {
    e.ligne(`${items.length} différence${pl(items.length)} au total`, { gras: true, ecart: 6 });
    for (const [type, n] of decompte(items)) {
      const [couleur, libelle, pluriel] = TYPES[type];
      e.ligne(`${n === 1 ? libelle : pluriel[0].toUpperCase() + pluriel.slice(1)} : ${n}`, { retrait: 8, pastille: rgb(couleur) });
    }
    e.y += 6;
    e.ligne("Différences par page", { taille: 13, gras: true, ecart: 6 });
    let positions = [0, 210, 262, 314, 366, 418];
    e.colonnes(["Pages", "Ajouts", "Suppr.", "Modif.", "Visuel", "Autres"], positions, { gras: true, couleur: ARDOISE });
    const parPaire = new Map<number, typeof items>();
    for (const it of items) parPaire.set(it.paire, [...(parPaire.get(it.paire) ?? []), it]);
    for (const k of [...parPaire.keys()].sort((a, b) => a - b)) {
      const c = new Map(decompte(parPaire.get(k)!));
      const autres = TYPES_PAGE.reduce((s, t) => s + (c.get(t) ?? 0), 0);
      e.colonnes([titrePaire(paires[k], noms), ...(["ajout", "suppression", "modification", "visuel"] as const).map((t) => c.get(t) ?? ""), autres || ""], positions);
    }
    e.y += 6;
    e.ligne("Liste des différences", { taille: 13, gras: true, ecart: 4 });
    e.ligne("Les numéros renvoient aux annotations des pages suivantes (A à gauche, B à droite), puis aux gros plans de la fin.", { taille: 9, couleur: ARDOISE, ecart: 6 });
    positions = [0, 26, 96, 200];
    e.colonnes(["N°", "Pages", "Type", "Détail"], positions, { gras: true, couleur: ARDOISE });
    items.forEach((it, i) => {
      const pages = ([["A", it.pageA], ["B", it.pageB]] as const).filter(([, p]) => p !== null).map(([c, p]) => `${c} ${p! + 1}`).join(" · ");
      const [couleur, libelle] = TYPES[it.type];
      e.colonnes([i + 1, pages, libelle, description(it)], positions, { pastille: rgb(couleur) });
    });
  }

  // Pages annotées : un feuillet par couple de pages qui diffère.
  const marques = new Map<string, [number, (typeof items)[number], Rect][]>();
  items.forEach((it, i) => {
    for (const [cote, liste] of [["a", it.marquesA], ["b", it.marquesB]] as const) {
      for (const [page, rect] of liste) marques.set(`${cote}${page}`, [...(marques.get(`${cote}${page}`) ?? []), [i + 1, it, rect]]);
    }
  });
  const annotations: { feuille: number; numero: number; item: (typeof items)[number]; rect: Rect }[] = [];
  const marge = 24, entete = 46, ecart = 24;
  paires.forEach(([a, b]) => {
    if ((a === null || !marques.has(`a${a}`)) && (b === null || !marques.has(`b${b}`))) return;
    const bornesA = (a !== null ? page("a", a) : page("b", b!)).getBounds();
    const bornesB = (b !== null ? page("b", b) : page("a", a!)).getBounds();
    const la = bornesA[2] - bornesA[0], ha = bornesA[3] - bornesA[1], lb = bornesB[2] - bornesB[0], hb = bornesB[3] - bornesB[1];
    const objets: Record<string, mupdf.PDFObject> = {};
    const cotes = [["a", a, docA, marge, la, ha, nomA], ["b", b, docB, marge + la + ecart, lb, hb, nomB]] as const;
    const dessins: string[] = [];
    for (const [cote, index, , origine, l, h] of cotes) {
      if (index === null) continue;
      const { forme: f, transformation, bornes } = forme(cote, index);
      objets["P" + cote] = f;
      const t = transformation.map(nb).join(" ");
      dessins.push(`q ${nb(origine)} ${entete} ${nb(l)} ${nb(h)} re W n 1 0 0 1 ${nb(origine - bornes[0])} ${nb(entete - bornes[1])} cm ${t} cm /P${cote} Do Q`);
    }
    const feuille = e.nouvellePage(marge * 2 + ecart + la + lb, entete + marge + Math.max(ha, hb), { XObject: objets });
    feuille.contenu.push(...dessins);
    const compte = new Set(cotes.flatMap(([cote, index]) => (index === null ? [] : (marques.get(`${cote}${index}`) ?? []).map((m) => m[1])))).size;
    e.texte(marge, 22, `${titrePaire([a, b], noms)} — ${compte} différence${pl(compte)}`, 12, true);
    for (const [cote, index, , origine, l, h, nom] of cotes) {
      const place: Rect = [origine, entete, origine + l, entete + h];
      e.texte(origine, entete - 8, e.ajuster(`Version ${cote.toUpperCase()} — ${nom}`, l, 9), 9, false, ARDOISE);
      if (index === null) {
        e.rectangle(place, [0.97, 0.98, 0.99], [0.8, 0.83, 0.87], 1, true);
        e.texte(place[0] + 16, place[1] + 30, "Pas de page correspondante", 11, false, ARDOISE);
        continue;
      }
      e.rectangle(place, null, [0.8, 0.83, 0.87], 0.6);
      const numerotes = new Set<number>();
      const bornes = (cote === "a" ? bornesA : bornesB);
      for (const [numero, item, rect] of marques.get(`${cote}${index}`) ?? []) {
        const cible: Rect = [rect[0] - bornes[0] + place[0], rect[1] - bornes[1] + place[1], rect[2] - bornes[0] + place[0], rect[3] - bornes[1] + place[1]];
        annotations.push({ feuille: rapport.countPages() - 1, numero, item, rect: cible });
        if (!numerotes.has(numero)) {
          numerotes.add(numero);
          e.texte(cible[0], Math.max(entete + 7, cible[1] - 1.5), String(numero), 7, true, rgb(TYPES[item.type][0]));
        }
      }
    }
  });
  grosPlans(e, resultat, page, forme);
  e.terminer();

  for (const { feuille, numero, item, rect } of annotations) {
    const page = rapport.loadPage(feuille);
    const [couleur, libelle] = TYPES[item.type];
    const texte = TYPES_TEXTE.includes(item.type);
    const annot = page.createAnnotation(texte ? "Highlight" : "Square");
    if (texte) annot.setQuadPoints([[rect[0], rect[1], rect[2], rect[1], rect[0], rect[3], rect[2], rect[3]]]);
    else {
      annot.setRect(rect);
      annot.setBorderWidth(item.niveauPage ? 2.5 : 1.5);
    }
    annot.setColor(rgb(couleur));
    annot.setOpacity(texte ? 0.45 : 1);
    annot.setAuthor(application);
    annot.setSubject(libelle);
    annot.setContents(`${numero}. ${libelle} : ${description(item)}`);
    annot.update();
  }
  rapport.setMetaData("info:Title", "Comparaison de deux PDF");
  rapport.setMetaData("info:Creator", application);
  return rapport.saveToBuffer(OPTIONS_SIMPLES).asUint8Array().slice();
}

/**
 * Gros plans à la fin du rapport (report_details sur PC) : pour chaque différence localisée, la zone et ses abords
 * dans A et dans B (la page elle-même, en vectoriel) et superposés (image : rouge = seulement dans A, vert = seulement
 * dans B), avec un cadre pointillé de la couleur de la différence et sa position en millimètres.
 */
function grosPlans(e: Ecrivain, resultat: Resultat, page: (cote: "a" | "b", index: number) => mupdf.PDFPage,
  forme: (cote: "a" | "b", index: number) => ReturnType<typeof formeDePage>) {
  const { differences: items, paires, noms } = resultat;
  const montrees = items.map((it, i) => [i + 1, it] as [number, Difference]).filter(([, it]) => !it.niveauPage);
  if (!montrees.length) return;
  const L = Ecrivain.L, H = Ecrivain.H, marge = 36, ecart = 10, legende = 30;
  const panneau = (L - 2 * marge - 2 * ecart) / 3;
  const rangee = legende + panneau + 18;
  const parPage = Math.floor((H - 2 * marge - 30) / rangee);
  let y = 0, images = 0;
  for (let k = 0; k < montrees.length; k++) {
    if (k === GROS_PLANS) {
      e.texte(marge, Math.min(y + 12, H - marge), `Les ${montrees.length - k} différences suivantes ne sont pas montrées en gros plan.`, 9, false, ARDOISE);
      break;
    }
    if (k % parPage === 0) {
      e.nouvellePage();
      e.texte(marge, marge, "Gros plans des différences", 14, true);
      e.texte(marge, marge + 14, "A : ancienne version · B : nouvelle version · superposition : rouge = seulement dans A, vert = seulement dans B, noir = identique", 8, false, ARDOISE);
      y = marge + 30;
    }
    const [numero, it] = montrees[k];
    const paire = paires[it.paire];
    const pageA = it.pageA ?? paire[0], pageB = it.pageB ?? paire[1];
    const marques = it.marquesB.length ? it.marquesB : it.marquesA;
    const zone = marques.slice(1).reduce<Rect>((z, [, r]) => [Math.min(z[0], r[0]), Math.min(z[1], r[1]), Math.max(z[2], r[2]), Math.max(z[3], r[3])], [...marques[0][1]] as Rect);
    const reference = (pageB !== null ? page("b", pageB) : page("a", pageA!)).getBounds() as Rect;
    const cadre = cadreGrosPlan(zone, reference);
    const [couleur, libelle] = TYPES[it.type];
    const nom = nomPaire(paire, noms);
    const titre = `${numero}. ${libelle}${nom ? ` · ${nom}` : ""} : ${description(it)}`;
    e.texte(marge, y + 10, e.ajuster(titre, L - 2 * marge, 9.5, true), 9.5, true, rgb(couleur));
    const [ox, oy] = reference;
    e.texte(marge, y + 22, e.ajuster(`Zone : x ${millimetres(zone[0] - ox)} à ${millimetres(zone[2] - ox)} mm, y ${millimetres(zone[1] - oy)} à ${millimetres(zone[3] - oy)} mm, ` +
      `depuis le coin haut gauche de la page (A page ${pageA === null ? "—" : pageA + 1}, B page ${pageB === null ? "—" : pageB + 1})`, L - 2 * marge, 8), 8, false, ARDOISE);
    const haut = y + legende;
    const lc = cadre[2] - cadre[0], hc = cadre[3] - cadre[1];
    const echelle = Math.min(panneau / lc, panneau / hc);
    for (const [j, intitule, cote, index] of [[0, "A", "a", pageA], [1, "B", "b", pageB], [2, "Superposition", null, null]] as const) {
      const place: Rect = [marge + j * (panneau + ecart), haut, marge + j * (panneau + ecart) + panneau, haut + panneau];
      e.texte(place[0], place[3] + 11, intitule, 8, true, ARDOISE);
      const montre: Rect = [place[0] + (panneau - lc * echelle) / 2, place[1] + (panneau - hc * echelle) / 2, 0, 0];
      montre[2] = montre[0] + lc * echelle;
      montre[3] = montre[1] + hc * echelle;
      const contour = `${nb(montre[0])} ${nb(montre[1])} ${nb(montre[2] - montre[0])} ${nb(montre[3] - montre[1])} re`;
      if (cote === null) {
        if (pageA === null || pageB === null) {
          e.texte(place[0] + 8, place[1] + 20, "Une seule version", 9, false, ARDOISE);
          continue;
        }
        const zoom = Math.min(8, (2 * panneau) / lc);
        const { largeur, hauteur, rvb } = superposition(page("a", pageA), page("b", pageB), zoom, cadre);
        const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, largeur, hauteur], false);
        const cible = pix.getPixels(), pas = pix.getStride();
        for (let ligne = 0; ligne < hauteur; ligne++) cible.set(rvb.subarray(ligne * largeur * 3, (ligne + 1) * largeur * 3), ligne * pas);
        const image = new mupdf.Image(pix);
        const nomImage = `S${images++}`;
        e.ressource(nomImage, e.doc.addImage(image));
        image.destroy();
        pix.destroy();
        // L'image est posée tête en haut dans le repère du rapport (y vers le bas).
        e.page.contenu.push(`q ${contour} W n ${nb(montre[2] - montre[0])} 0 0 ${nb(-(montre[3] - montre[1]))} ${nb(montre[0])} ${nb(montre[3])} cm /${nomImage} Do Q`);
      } else if (index === null) {
        e.texte(place[0] + 8, place[1] + 20, "Pas de page correspondante", 9, false, ARDOISE);
        continue;
      } else {
        // La page elle-même, en vectoriel, réduite au cadre du gros plan.
        const { forme: f, transformation } = forme(cote, index);
        const nomForme = `P${cote}${index}`;
        e.ressource(nomForme, f);
        e.page.contenu.push(`q ${contour} W n 0 g 0 G ${nb(echelle)} 0 0 ${nb(echelle)} ${nb(montre[0] - echelle * cadre[0])} ${nb(montre[1] - echelle * cadre[1])} cm ` +
          `${transformation.map(nb).join(" ")} cm /${nomForme} Do Q`);
      }
      const r: Rect = [montre[0] + (zone[0] - cadre[0]) * echelle - 2, montre[1] + (zone[1] - cadre[1]) * echelle - 2,
        montre[0] + (zone[2] - cadre[0]) * echelle + 2, montre[1] + (zone[3] - cadre[1]) * echelle + 2];
      e.page.contenu.push(`q [3] 0 d 1.2 w ${rgb(couleur).map(nb).join(" ")} RG ${nb(r[0])} ${nb(r[1])} ${nb(r[2] - r[0])} ${nb(r[3] - r[1])} re S Q`);
    }
    // Cadres des trois vues, dessinés en dernier : l'image ou la page ne les recouvre pas.
    for (let j = 0; j < 3; j++) e.rectangle([marge + j * (panneau + ecart), haut, marge + j * (panneau + ecart) + panneau, haut + panneau], null, [0.8, 0.83, 0.87], 0.6);
    y += rangee;
  }
}
