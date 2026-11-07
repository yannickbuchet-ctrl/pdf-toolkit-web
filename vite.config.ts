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
 * Hors ligne dès la première visite : la liste des fichiers du site construit (hors-ligne.json), que le service worker
 * garde à son installation. Sans elle, il ne garderait que les fichiers demandés après sa mise en route, et le site ne
 * démarrerait hors ligne qu'après une deuxième visite. Le lecteur de photos HEIC (2 Mo) n'y est pas : il n'est
 * téléchargé, puis gardé, qu'à la première photo HEIC. Le nom du cache change avec la liste, pour qu'une nouvelle
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
      fs.writeFileSync(path.join(sortie, "hors-ligne.json"), JSON.stringify(fichiers));
      const version = createHash("sha256").update(fichiers.join("\n")).digest("hex").slice(0, 12);
      const sw = path.join(sortie, "sw.js");
      fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace('"pdf-toolkit-web-v1"', `"pdf-toolkit-web-${version}"`));
    },
  };
}

// Le site est statique : tous les chemins sont relatifs, et « base » peut être fixée à la construction
// (BASE=/pdf-toolkit-web/ npm run build) pour un hébergement dans un sous-dossier, comme GitHub Pages.
export default defineConfig(({ command }) => ({
  base: process.env.BASE ?? "./",
  plugins: [politiqueDeSecurite(), listeHorsLigne()],
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
