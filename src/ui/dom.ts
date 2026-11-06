/** Petites aides pour construire l'interface, les fenêtres et les fichiers. */
import { icone } from "./icones";

type Enfant = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...enfants: Enfant[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "html") e.innerHTML = String(v);
    else if (k === "text") e.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v as EventListener);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (v === true) e.setAttribute(k, "");
    else if (k in e && typeof v !== "string") (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const c of enfants) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Une entrée de menu : icône, texte, action ; actif à false la grise ; coche l'affiche comme choisie. null : séparateur. */
export type EntreeMenu = { icone: string; texte: string; action: () => void; actif?: boolean; coche?: boolean } | null;

/**
 * Un menu flottant attaché à un bouton. Il s'ouvre sous le bouton, ou au-dessus quand le bouton est dans la moitié
 * basse de l'écran (barre du bas sur téléphone). Échap, Tab ou un clic ailleurs le ferment ; flèches pour s'y déplacer.
 */
export function menuFlottant(ancre: HTMLElement, nom: string, entrees: EntreeMenu[]) {
  document.querySelector(".menu-flottant")?.remove();
  const m = el("div", { class: "menu-flottant", role: "menu", "aria-label": nom });
  for (const entree of entrees) {
    if (!entree) {
      m.append(el("hr"));
      continue;
    }
    const b = el("button", {
      type: "button", role: entree.coche === undefined ? "menuitem" : "menuitemcheckbox", class: "bouton", disabled: entree.actif === false,
      "aria-checked": entree.coche === undefined ? null : String(entree.coche), html: `${icone(entree.icone)}<span>${echapper(entree.texte)}</span>`,
    });
    b.addEventListener("click", () => {
      fermer();
      entree.action();
    });
    m.append(b);
  }
  const r = ancre.getBoundingClientRect();
  if (r.top > window.innerHeight / 2) m.style.bottom = `${window.innerHeight - r.top + 6}px`;
  else m.style.top = `${r.bottom + 4}px`;
  // Centré sur le bouton, puis ramené dans l'écran avec 8 px de marge.
  document.body.append(m);
  const largeur = m.getBoundingClientRect().width;
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - largeur - 8, r.left + r.width / 2 - largeur / 2))}px`;
  ancre.setAttribute("aria-expanded", "true");
  const items = [...m.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  items[0]?.focus();
  function fermer() {
    m.remove();
    ancre.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", dehors, true);
  }
  const dehors = (e: Event) => {
    if (!m.contains(e.target as Node) && e.target !== ancre && !ancre.contains(e.target as Node)) fermer();
  };
  document.addEventListener("pointerdown", dehors, true);
  m.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      fermer();
      ancre.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === "Tab") fermer();
  });
}

/** Un bouton avec icône ; le libellé sert aussi d'info-bulle et de nom accessible. */
export function bouton(nomIcone: string, libelle: string, action: (ev: MouseEvent) => void, options: { classe?: string; texte?: boolean; raccourci?: string; bascule?: boolean } = {}): HTMLButtonElement {
  const b = el("button", {
    type: "button", class: `bouton ${options.classe ?? ""}`.trim(),
    title: options.raccourci ? `${libelle} (${options.raccourci})` : libelle,
    "aria-label": options.texte === false ? libelle : null,
    "aria-pressed": options.bascule ? "false" : null,
    "aria-keyshortcuts": options.raccourci ?? null,
  });
  b.innerHTML = icone(nomIcone) + (options.texte === false ? "" : `<span class="libelle">${echapper(libelle)}</span>`);
  if (options.texte === false) b.classList.add("icone");
  b.addEventListener("click", action);
  return b;
}

export function echapper(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface Fenetre {
  dialog: HTMLDialogElement;
  corps: HTMLElement;
  pied: HTMLElement;
  fermer: (valeur?: unknown) => void;
  fermee: Promise<unknown>;
}

/** Une fenêtre modale : Échap ou « Annuler » la ferment ; le focus revient ensuite où il était. */
export function fenetre(titre: string, options: { classe?: string; fermable?: boolean } = {}): Fenetre {
  const avant = document.activeElement as HTMLElement | null;
  const idTitre = `titre-${Math.random().toString(36).slice(2)}`;
  const corps = el("div", { class: "corps-dialogue" });
  const pied = el("footer");
  const entete = el("header", {}, el("h2", { id: idTitre, text: titre }));
  if (options.fermable !== false) entete.append(bouton("fermer", "Fermer", () => fermer(undefined), { texte: false }));
  const dialog = el("dialog", { class: options.classe ?? "", "aria-labelledby": idTitre }, el("div", { class: "cadre-dialogue" }, entete, corps, pied));
  let resoudre: (v: unknown) => void;
  const fermee = new Promise<unknown>((r) => (resoudre = r));
  let valeur: unknown;
  const fermer = (v?: unknown) => {
    valeur = v;
    dialog.close();
  };
  dialog.addEventListener("close", () => {
    dialog.remove();
    avant?.focus?.();
    resoudre(valeur);
  });
  if (options.fermable === false) dialog.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(dialog);
  queueMicrotask(() => dialog.showModal());
  return { dialog, corps, pied, fermer, fermee };
}

/** Demande une confirmation ; renvoie true si l'utilisateur accepte. */
export async function confirmer(titre: string, message: string, accepter = "Continuer", options: { danger?: boolean; autre?: string } = {}): Promise<boolean | "autre"> {
  const f = fenetre(titre);
  f.corps.append(el("p", { text: message }));
  if (options.autre) f.pied.append(el("button", { type: "button", class: "bouton cadre", text: options.autre, onclick: () => f.fermer("autre") }));
  f.pied.append(
    el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(false) }),
    el("button", { type: "button", class: `bouton ${options.danger ? "cadre danger" : "principal"}`, text: accepter, onclick: () => f.fermer(true), autofocus: true }),
  );
  const r = await f.fermee;
  return r === "autre" ? "autre" : r === true;
}

export async function informer(titre: string, message: string | Node) {
  const f = fenetre(titre);
  f.corps.append(typeof message === "string" ? el("p", { text: message }) : message);
  f.pied.append(el("button", { type: "button", class: "bouton principal", text: "OK", onclick: () => f.fermer(), autofocus: true }));
  await f.fermee;
}

/** Demande un texte (ou un mot de passe) ; null si l'utilisateur annule. */
export async function demander(titre: string, libelle: string, options: { valeur?: string; type?: string; multiligne?: boolean; aide?: string; valider?: string; erreur?: string } = {}): Promise<string | null> {
  const f = fenetre(titre);
  const id = `champ-${Math.random().toString(36).slice(2)}`;
  const champ = options.multiligne
    ? el("textarea", { id, rows: 5, class: "entree" })
    : el("input", { id, type: options.type ?? "text", class: "entree", autocomplete: options.type === "password" ? "off" : null });
  champ.value = options.valeur ?? "";
  const formulaire = el("form", { method: "dialog" }, el("div", { class: "champ-formulaire" }, el("label", { for: id, text: libelle }), champ));
  if (options.aide) formulaire.append(el("p", { class: "aide", text: options.aide }));
  if (options.erreur) formulaire.append(el("p", { class: "erreur-texte", role: "alert", text: options.erreur }));
  f.corps.append(formulaire);
  formulaire.addEventListener("submit", (e) => {
    e.preventDefault();
    f.fermer(champ.value);
  });
  f.pied.append(
    el("button", { type: "button", class: "bouton cadre", text: "Annuler", onclick: () => f.fermer(null) }),
    el("button", { type: "button", class: "bouton principal", text: options.valider ?? "OK", onclick: () => f.fermer(champ.value) }),
  );
  setTimeout(() => champ.focus(), 50);
  const r = await f.fermee;
  return typeof r === "string" ? r : null;
}

/* --- Fichiers ------------------------------------------------------------------------------------------------- */

export async function lire(fichier: Blob): Promise<Uint8Array> {
  return new Uint8Array(await fichier.arrayBuffer());
}

/** Choisit des fichiers par la fenêtre du système (champ « file » caché). */
export function choisirFichiers(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resoudre) => {
    const champ = el("input", { type: "file", accept, multiple, style: { display: "none" } });
    champ.addEventListener("change", () => {
      resoudre([...(champ.files ?? [])]);
      champ.remove();
    });
    champ.addEventListener("cancel", () => {
      resoudre([]);
      champ.remove();
    });
    document.body.append(champ);
    champ.click();
  });
}

/** Enregistre des octets par un téléchargement (le navigateur choisit le dossier, ou le demande). */
export function telecharger(octets: Uint8Array, nom: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([octets as BlobPart], { type }));
  const a = el("a", { href: url, download: nom, style: { display: "none" } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 30000);
}

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} Ko`;
  return `${(octets / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

export const estPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** « 1 page », « 3 pages ». */
export const pluriel = (n: number, mot: string, motPluriel = mot + "s") => `${n.toLocaleString("fr-FR")} ${n > 1 ? motPluriel : mot}`;
