/**
 * Descărcare de fișiere în BROWSER (varianta web, 7 aug): fetch → blob → <a download>.
 * `download` pe un URL cross-origin e ignorat de browsere — de aceea trecem prin blob
 * (URL-urile semnate Supabase permit CORS), ca fișierul să-și păstreze numele original.
 * Apelat DOAR pe web (callerii verifică Platform.OS) — pe nativ nu există `document`.
 */
export async function webDownload(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed_${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revocare întârziată: imediat, unele browsere anulează descărcarea abia pornită.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
