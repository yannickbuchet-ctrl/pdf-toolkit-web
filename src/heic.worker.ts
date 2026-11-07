/**
 * Décodeur des photos HEIC et HEIF (iPhone, certains téléphones Android) pour les navigateurs qui ne savent pas les
 * lire (Chrome, Edge, Firefox) : libheif compilé en WebAssembly. Ce Web Worker est créé à la demande, puis arrêté
 * aussitôt : l'interface ne gèle pas pendant le décodage, et la mémoire est rendue ensuite. La rotation enregistrée
 * dans la photo (photo prise en hauteur) est appliquée par libheif.
 *
 * Reçoit { octets, pixelsMax } ; répond { ok: true, image, alpha } (image : ImageBitmap réduite à pixelsMax au plus)
 * ou { ok: false, message }.
 */
import creerLibheif from "libheif-js/libheif-wasm/libheif-bundle.mjs";

const portee = self as unknown as Worker;

portee.addEventListener("message", async (ev: MessageEvent<{ octets: Uint8Array; pixelsMax: number }>) => {
  try {
    const { octets, pixelsMax } = ev.data;
    const images = new (creerLibheif().HeifDecoder)().decode(octets);
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new Error("ce fichier ne contient aucune image lisible");
    const largeur = image.get_width(), hauteur = image.get_height();
    const pixels = new ImageData(largeur, hauteur);
    await new Promise<void>((ok, ko) => image.display(pixels, (r) => (r ? ok() : ko(new Error("le décodage a échoué")))));
    const k = Math.min(1, Math.sqrt(pixelsMax / (largeur * hauteur)));
    const reduction: ImageBitmapOptions = k < 1
      ? { resizeWidth: Math.max(1, Math.floor(largeur * k)), resizeHeight: Math.max(1, Math.floor(hauteur * k)), resizeQuality: "high" }
      : {};
    const bitmap = await createImageBitmap(pixels, reduction);
    portee.postMessage({ ok: true, image: bitmap, alpha: image.has_alpha_channel() }, [bitmap]);
  } catch (e) {
    portee.postMessage({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});
