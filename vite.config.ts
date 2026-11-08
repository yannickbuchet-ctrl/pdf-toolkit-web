import { defineConfig, type Plugin } from "vitest/config";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Politique de sécurité du site construit : aucune ressource ne vient d'un autre site (ni police, ni script, ni
 * statistiques) et rien ne peut être envoyé ailleurs (connect-src 'self'). Elle n'est pas mise en développement,
 * où Vite a besoin de sa connexion de rechargement.
 */
const SECURITE = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function politiqueDeSecurite(): Plugin {
  return {
    name: "politique-de-securite",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${SECURITE}" />`),
  };
}

/**
 * Les fichiers de la reconnaissance de texte (OCR), servis par le site lui-même, jamais par un CDN : le Web Worker de
 * Tesseract.js, son moteur WebAssembly (trois versions, selon ce que sait le processeur : SIMD relâché, SIMD, ni l'un
 * ni l'autre ; le navigateur n'en télécharge qu'une) et les données de langue française et anglaise (modèles
 * « best_int »). Ils ne sont téléchargés qu'à la première reconnaissance de texte. Tesseract.js les cherche sous des
 * noms fixes, dans un même dossier : c'est le nom du dossier qui porte l'empreinte de leur contenu, pour qu'une
 * nouvelle version ne soit jamais confondue avec l'ancienne dans le cache du navigateur.
 */
const SOURCES_OCR: Record<string, string> = {
  "worker.min.js": "tesseract.js/dist/worker.min.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "fra.traineddata.gz": "@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz",
  "eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
/** Gardés pour le hors-ligne dès la première reconnaissance : le worker et les deux langues (le moteur WebAssembly,
 * lui, est gardé quand il est demandé, dans la seule version qui sert à cet appareil). */
const OCR_HORS_LIGNE = ["worker.min.js", "fra.traineddata.gz", "eng.traineddata.gz"];

/** Le contenu d'un fichier de l'OCR. Le lien vers la carte des sources du worker, absente du site, est retiré. */
function contenuOcr(nom: string): Buffer {
  const octets = fs.readFileSync(path.resolve(import.meta.dirname, "node_modules", SOURCES_OCR[nom]));
  return nom.endsWith(".js") ? Buffer.from(octets.toString("utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n")) : octets;
}

const empreinteOcr = createHash("sha256");
for (const nom of Object.keys(SOURCES_OCR)) empreinteOcr.update(nom).update(contenuOcr(nom));
const DOSSIER_OCR = `ocr-${empreinteOcr.digest("hex").slice(0, 10)}`;

function fichiersOcr(): Plugin {
  let sortie = "dist";
  return {
    name: "fichiers-ocr",
    configResolved: (config) => {
      sortie = path.resolve(config.root, config.build.outDir);
    },
    configureServer(serveur) {
      serveur.middlewares.use(`/${DOSSIER_OCR}`, (requete, reponse, suite) => {
        const nom = decodeURIComponent((requete.url ?? "").split("?")[0].replace(/^\//, ""));
        if (!(nom in SOURCES_OCR)) return suite();
        reponse.setHeader("Content-Type", nom.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        reponse.end(contenuOcr(nom));
      });
    },
    closeBundle() {
      if (!fs.existsSync(sortie)) return;
      fs.mkdirSync(path.join(sortie, DOSSIER_OCR), { recursive: true });
      for (const nom of Object.keys(SOURCES_OCR)) fs.writeFileSync(path.join(sortie, DOSSIER_OCR, nom), contenuOcr(nom));
    },
  };
}

/**
 * Hors ligne dès la première visite : la liste des fichiers du site construit (hors-ligne.json), que le service worker
 * garde à son installation. Sans elle, il ne garderait que les fichiers demandés après sa mise en route, et le site ne
 * démarrerait hors ligne qu'après une deuxième visite. Le lecteur de photos HEIC (2 Mo) n'y est pas : il n'est
 * téléchargé, puis gardé, qu'à la première photo HEIC. Les fichiers de l'OCR sont listés à part (« ocr ») : le service
 * worker les garde à la première reconnaissance de texte. Le nom du cache change avec la liste, pour qu'une nouvelle
 * version du site remplace l'ancienne.
 */
function listeHorsLigne(): Plugin {
  let sortie = "dist";
  return {
    name: "liste-hors-ligne",
    apply: "build",
    configResolved: (config) => {
      sortie = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const fichiers = fs.readdirSync(path.join(sortie, "assets")).filter((f) => !f.startsWith("heic.worker")).sort().map((f) => `assets/${f}`);
      const ocr = OCR_HORS_LIGNE.map((f) => `${DOSSIER_OCR}/${f}`);
      fs.writeFileSync(path.join(sortie, "hors-ligne.json"), JSON.stringify({ site: fichiers, ocr }));
      const version = createHash("sha256").update([...fichiers, DOSSIER_OCR].join("\n")).digest("hex").slice(0, 12);
      const sw = path.join(sortie, "sw.js");
      fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace('"pdf-toolkit-web-v1"', `"pdf-toolkit-web-${version}"`));
    },
  };
}

// Le site est statique : tous les chemins sont relatifs, et « base » peut être fixée à la construction
// (BASE=/pdf-toolkit-web/ npm run build) pour un hébergement dans un sous-dossier, comme GitHub Pages.
export default defineConfig(({ command }) => ({
  base: process.env.BASE ?? "./",
  plugins: [politiqueDeSecurite(), fichiersOcr(), listeHorsLigne()],
  // Le dossier des fichiers de l'OCR, que src/ui/ocr.ts donne à Tesseract.js.
  define: { __DOSSIER_OCR__: JSON.stringify(DOSSIER_OCR) },
  // MuPDF.js n'importe « node:fs » et « module » que sous Node (tests) : dans le site, un module vide les remplace.
  resolve: command === "build" ? { alias: { "node:fs": "/src/vide.ts", module: "/src/vide.ts" } } : {},
  build: {
    target: "es2022",
    // Le moteur MuPDF compilé en WebAssembly pèse à lui seul une dizaine de Mo : ce n'est pas une erreur.
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mupdf"] },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    pool: "forks",
  },
}));
