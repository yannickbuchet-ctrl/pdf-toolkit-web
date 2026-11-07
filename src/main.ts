import "./style.css";
import { Application } from "./ui/app";
import { moteurPret } from "./ui/moteur";

const racine = document.getElementById("application")!;
const app = new Application(racine);
app.message("Chargement du moteur PDF…", "info", 0);
moteurPret.then(() => app.message("Prêt. Ouvrez ou déposez un PDF.", "info", 5000));

// Application installée (Chrome, Edge) : un PDF ouvert avec « Ouvrir avec → PDF Toolkit » arrive ici (file_handlers du
// manifeste). Le fichier est ouvert dès que le moteur est prêt ; sa poignée permet d'enregistrer dessus directement.
interface FileLaunchQueue {
  setConsumer(consommateur: (parametres: { files: FileSystemFileHandle[] }) => void): void;
}
const fileDeLancement = (window as unknown as { launchQueue?: FileLaunchQueue }).launchQueue;
fileDeLancement?.setConsumer(async ({ files }) => {
  const [poignee] = files ?? [];
  if (!poignee) return;
  await moteurPret;
  app.ouvrirFichier(await poignee.getFile(), poignee);
});

// Hors ligne : une fois le site chargé, ses fichiers sont gardés par le navigateur (service worker). Rien d'autre
// n'est enregistré : les documents ouverts ne passent jamais par le service worker.
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* le site fonctionne aussi sans */
  });
}
