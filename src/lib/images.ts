import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * Compresie de poze înainte de upload (PLAN_FAZA9.md §1.3).
 * Pozele de la camera telefonului au 5–10 MB; nivelul gratuit Supabase e 1 GB.
 * Reducem latura lungă la max 1600px și re-encodăm JPEG la calitate 0.7
 * → tipic ~150–400 KB per poză.
 */

/** Latura lungă maximă (px). Peste atât, redimensionăm păstrând aspect ratio. */
const MAX_EDGE = 1600;
/** Calitate JPEG: 1 = fără compresie, 0 = maximă. 0.7 = compromis bun. */
const QUALITY = 0.7;

export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Comprimă o poză locală și o normalizează la JPEG.
 * `width`/`height` vin din asset-ul de la image-picker (mereu prezente), ca să
 * decidem redimensionarea FĂRĂ upscale — mărim niciodată o poză deja mică.
 * Chiar și fără redimensionare, re-encodăm JPEG (uniformizează HEIC/PNG → JPEG
 * și scade dimensiunea prin `compress`).
 *
 * API-ul modern, contextual (cel vechi `manipulateAsync` e deprecated):
 * `manipulate(uri)` → `resize()` (opțional) → `renderAsync()` → `saveAsync()`.
 */
export async function compressImage(
  uri: string,
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
  quality: number = QUALITY,
): Promise<CompressedImage> {
  const context = ImageManipulator.manipulate(uri);

  const longest = Math.max(width, height);
  if (longest > maxEdge) {
    // Specificăm o singură latură; librăria calculează cealaltă păstrând raportul.
    context.resize(width >= height ? { width: maxEdge } : { height: maxEdge });
  }

  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  return { uri: result.uri, width: result.width, height: result.height };
}
