import "./style.css";
import { Application } from "./ui/app";
import { moteurPret } from "./ui/moteur";

const racine = document.getElementById("application")!;
const app = new Application(racine);
app.message("Chargement du moteur PDF…", "info", 0);
moteurPret.then(() => app.message("Prêt. Ouvrez ou déposez un PDF.", "info", 5000));

// Hors ligne : une fois le site chargé, ses fichiers sont gardés par le navigateur (service worker). Rien d'autre
// n'est enregistré : les documents ouverts ne passent jamais par le service worker.
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* le site fonctionne aussi sans */
  });
}
