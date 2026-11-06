// Service worker de PDF Toolkit Web : garde les fichiers du site (pages, scripts, moteur WebAssembly) pour qu'il
// fonctionne hors ligne. Il ne voit passer que les fichiers du site lui-même : les PDF ouverts sont lus directement
// sur l'appareil et ne sont jamais mis en cache ni envoyés.
const CACHE = "pdf-toolkit-web-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icone.svg"])).then(() => self.skipWaiting()));
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
    }).catch(() => caches.match("./index.html")));
    return;
  }
  // Les autres fichiers ont un nom qui change à chaque version : la copie gardée suffit.
  e.respondWith(caches.match(requete).then((gardee) => gardee || fetch(requete).then((r) => {
    if (r.ok) {
      const copie = r.clone();
      caches.open(CACHE).then((c) => c.put(requete, copie));
    }
    return r;
  })));
});
