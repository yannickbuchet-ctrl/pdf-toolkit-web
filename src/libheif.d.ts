/** Types du module ES de libheif-js (libheif compilé en WebAssembly), utilisé par le décodeur HEIC. */
declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  export interface ImageHeif {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    has_alpha_channel(): boolean;
    /** Écrit les pixels RVBA de l'image, rotation et symétrie enregistrées dans le fichier appliquées. */
    display(cible: { data: Uint8ClampedArray; width: number; height: number }, fin: (resultat: unknown) => void): void;
  }
  export interface LibHeif {
    HeifDecoder: new () => { decode(octets: Uint8Array): ImageHeif[] };
  }
  const creer: (options?: Record<string, unknown>) => LibHeif;
  export default creer;
}
