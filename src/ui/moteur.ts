/**
 * Le client du moteur : appelle les méthodes du Web Worker et renvoie des promesses.
 */
import type { Methodes } from "../worker";
import TravailleurMoteur from "../worker?worker";

export class ErreurMoteur extends Error {
  constructor(message: string, readonly type: "mot-de-passe" | "pdf" | "erreur", readonly incorrect = false) {
    super(message);
  }
}

type Args<M extends keyof Methodes> = Parameters<Methodes[M]>[0];
type Resultat<M extends keyof Methodes> = ReturnType<Methodes[M]>;

interface Attente {
  resoudre: (v: unknown) => void;
  rejeter: (e: unknown) => void;
  progression?: (fraction: number, message: string) => void;
}

const travailleur = new TravailleurMoteur();
const attentes = new Map<number, Attente>();
let suivant = 1;
let resoudrePret: () => void;
export const moteurPret = new Promise<void>((r) => (resoudrePret = r));
let occupation = 0;
const ecouteursOccupation = new Set<(occupe: boolean) => void>();

export function surOccupation(f: (occupe: boolean) => void) {
  ecouteursOccupation.add(f);
}

function changerOccupation(delta: number) {
  const avant = occupation > 0;
  occupation += delta;
  if (avant !== occupation > 0) ecouteursOccupation.forEach((f) => f(occupation > 0));
}

travailleur.addEventListener("message", (ev: MessageEvent) => {
  const d = ev.data;
  if (d.pret) {
    resoudrePret();
    return;
  }
  const a = attentes.get(d.id);
  if (!a) return;
  if ("progression" in d) {
    a.progression?.(d.progression, d.message);
    return;
  }
  attentes.delete(d.id);
  changerOccupation(-1);
  if (d.ok) a.resoudre(d.resultat);
  else a.rejeter(new ErreurMoteur(d.erreur.message, d.erreur.type, d.erreur.incorrect));
});

travailleur.addEventListener("error", (ev) => {
  console.error(ev);
  for (const [id, a] of attentes) {
    a.rejeter(new ErreurMoteur("Le moteur PDF s’est arrêté. Rechargez la page.", "erreur"));
    attentes.delete(id);
  }
});

/**
 * Appelle une méthode du moteur. transferer : octets à confier au worker sans copie (le tableau devient inutilisable
 * ici) ; progression : appelée pendant les longs calculs.
 */
export function appel<M extends keyof Methodes>(methode: M, args?: Args<M>, options: { transferer?: Transferable[]; progression?: (f: number, m: string) => void; discret?: boolean } = {}): Promise<Resultat<M>> {
  const id = suivant++;
  if (!options.discret) changerOccupation(1);
  return new Promise((resoudre, rejeter) => {
    attentes.set(id, {
      resoudre: resoudre as (v: unknown) => void,
      rejeter,
      progression: options.progression,
    });
    if (options.discret) {
      // Un appel discret (rendu d'une vignette) n'affiche pas le curseur d'attente.
      const a = attentes.get(id)!;
      const r = a.resoudre, j = a.rejeter;
      a.resoudre = (v) => { changerOccupation(1); r(v); };
      a.rejeter = (e) => { changerOccupation(1); j(e); };
    }
    travailleur.postMessage({ id, methode, args }, options.transferer ?? []);
  });
}
