// Service worker de PDF Toolkit Web : garde les fichiers du site (pages, scripts, moteur WebAssembly) pour qu'il
// fonctionne hors ligne. Il ne voit passer que les fichiers du site lui-même : les PDF ouverts sont lus directement
// sur l'appareil et ne sont jamais mis en cache ni envoyés.
// Le nom du cache est remplacé à chaque construction (vite.config.ts) : une nouvelle version efface l'ancienne.
const CACHE = "pdf-toolkit-web-v1";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["./", "./index.html", "./manifest.webmanifest", "./icone.svg"]);
    // Tous les fichiers du site, d'après la liste écrite à la construction : hors ligne dès la première visite.
    try {
      const liste = await (await fetch("./hors-ligne.json", { cache: "no-cache" })).json();
      await cache.addAll(liste);
    } catch {
      // Liste absente ou connexion coupée : les fichiers seront gardés au fil de leur utilisation.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const requete = e.request;
  const url = new URL(requete.url);
  if (requete.method !== "GET" || url.origin !== self.location.origin) return;
  if (requete.mode === "navigate") {
    // La page : le réseau d'abord (pour recevoir les mises à jour), la copie gardée hors ligne.
    e.respondWith(fetch(requete).then((r) => {
      const copie = r.clone();
      caches.open(CACHE).then((c) => c.put("./index.html", copie));
      return r;
    }).catch(() => caches.match("./index.html", { ignoreVary: true })));
    return;
  }
  // Les autres fichiers ont un nom qui change à chaque version : la copie gardée suffit. ignoreVary : un fichier
  // gardé à l'installation (requête sans en-tête Origin) doit servir aussi aux scripts de la page (avec Origin), même
  // si le serveur répond « Vary: Origin ».
  e.respondWith(caches.match(requete, { ignoreVary: true }).then((gardee) => gardee || fetch(requete).then((r) => {
    if (r.ok) {
      const copie = r.clone();
      caches.open(CACHE).then((c) => c.put(requete, copie));
    }
    return r;
  })));
});
