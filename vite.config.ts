import { defineConfig } from "vitest/config";

// Le site est statique : tous les chemins sont relatifs, et « base » peut être fixée à la construction
// (BASE=/pdf-toolkit-web/ npm run build) pour un hébergement dans un sous-dossier, comme GitHub Pages.
export default defineConfig({
  base: process.env.BASE ?? "./",
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
});
