import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import { supabase } from '@/lib/supabase';
import { compressImage } from '@/lib/images';

/**
 * Acces la Supabase Storage — bucket privat `photos` (PLAN_FAZA9.md §1).
 * Stocăm în DB PATH-ul obiectului, nu URL-ul; URL-ul semnat se cere la afișare
 * (`signedUrls`), iar RLS-ul de SELECT decide dacă semnarea reușește.
 */

const BUCKET = 'photos';
/** Valabilitate URL semnat: 1h. Cache-uit apoi de `expo-image` per ecran. */
const SIGNED_URL_TTL = 3600;

export type PhotoFolder = 'announcements' | 'chat' | 'channel';

export interface UploadSource {
  uri: string;
  width: number;
  height: number;
}

/**
 * Comprimă o poză locală și o urcă în `photos/{folder}/{parentId}/{uuid}.jpg`.
 * Upload prin `File.arrayBuffer()` (API nativ expo-file-system v19) — evită
 * `fetch(uri).arrayBuffer()`, nesigur în RN (decizia R1). Fără base64 intermediar.
 * Întoarce PATH-ul de stocat în DB.
 */
export async function uploadPhoto(
  folder: PhotoFolder,
  parentId: string,
  source: UploadSource,
): Promise<{ path: string | null; error: string | null }> {
  try {
    const compressed = await compressImage(source.uri, source.width, source.height);
    const path = `${folder}/${parentId}/${Crypto.randomUUID()}.jpg`;
    const bytes = await new File(compressed.uri).arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.warn('[storage] upload refuzat pt. path:', path, '→', error.message);
      return { path: null, error: error.message };
    }
    return { path, error: null };
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : 'upload_failed' };
  }
}

/**
 * URL-uri semnate pentru afișare, în batch (un singur apel/ecran).
 * Întoarce o mapare path → signedUrl; path-urile inaccesibile (RLS) lipsesc.
 */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
  const map: Record<string, string> = {};
  (data ?? []).forEach((item) => {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  });
  return map;
}

/** Un singur URL semnat (comoditate peste `signedUrls`). */
export async function signedUrl(path: string): Promise<string | null> {
  const map = await signedUrls([path]);
  return map[path] ?? null;
}

/** Șterge obiecte din Storage (curățare client-side la ștergere anunț/poză — R2). */
export async function deletePhotos(paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  return error?.message ?? null;
}
