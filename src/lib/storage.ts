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

export type PhotoFolder = 'announcements' | 'chat' | 'channel' | 'avatars' | 'market';

/** Avatarele se afișează la 40–96px — 512px e amplu, la ~30–60 KB per poză. */
const AVATAR_MAX_EDGE = 512;
const AVATAR_QUALITY = 0.8;

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
  compression?: { maxEdge: number; quality: number },
): Promise<{ path: string | null; error: string | null }> {
  try {
    const compressed = await compressImage(
      source.uri,
      source.width,
      source.height,
      compression?.maxEdge,
      compression?.quality,
    );
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

/** Fișier ales din document picker (Faza 19.5) — se urcă NEmodificat. */
export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType?: string;
}

/** Limita de mărime pentru fișierele din chat (decizie F19.5): 10 MB. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = 10;
/** Executabile blocate — restul extensiilor sunt permise (B2B: PDF-uri, devize, arhive). */
export const BLOCKED_FILE_EXTENSIONS = ['apk', 'exe', 'bat', 'cmd', 'sh', 'msi'];

/** Extensia (lowercase, fără punct) sau '' — pentru blocklist și path-ul din Storage. */
export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Urcă un fișier de chat în `photos/{chat|channel}/{parentId}/{uuid}.{ext}` —
 * ACELEAȘI foldere și politici RLS ca pozele (politicile nu discriminează extensia,
 * deci participanții pot scrie/citit, restul nu). Numele original NU intră în path
 * (path-ul e uuid, ca la poze); el trăiește în messages.file_name.
 */
export async function uploadFile(
  folder: 'chat' | 'channel',
  parentId: string,
  file: PickedFile,
): Promise<{ path: string | null; error: string | null }> {
  try {
    const ext = fileExtension(file.name) || 'bin';
    const path = `${folder}/${parentId}/${Crypto.randomUUID()}.${ext}`;
    const bytes = await new File(file.uri).arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: file.mimeType ?? 'application/octet-stream',
        upsert: false,
      });
    if (error) {
      console.warn('[storage] upload fișier refuzat pt. path:', path, '→', error.message);
      return { path: null, error: error.message };
    }
    return { path, error: null };
  } catch (e) {
    return { path: null, error: e instanceof Error ? e.message : 'upload_failed' };
  }
}

/**
 * Avatarul propriu → `avatars/{user_id}/{uuid}.jpg`. UUID nou la fiecare schimbare,
 * ca URL-ul semnat vechi și cache-ul `expo-image` să nu mai servească poza veche.
 * Callerul salvează path-ul în `profiles.avatar_path` și șterge apoi obiectul vechi.
 */
export async function uploadAvatar(
  userId: string,
  source: UploadSource,
): Promise<{ path: string | null; error: string | null }> {
  return uploadPhoto('avatars', userId, source, {
    maxEdge: AVATAR_MAX_EDGE,
    quality: AVATAR_QUALITY,
  });
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
