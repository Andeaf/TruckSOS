import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { uploadPhoto, deletePhotos, signedUrls } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type { AnnouncementPhoto } from '@/types/database';

/** Câte poze urcă în paralel (1.1, 7.2): destul ca publicarea să nu mai aștepte poză cu poză,
 * puțin cât să nu sufoce o rețea slabă de pe drum. */
// 2, nu 3 (review 9 nov): banda se împarte între upload-uri; pe rețea slabă la marginea drumului 3 în paralel
// ar fi picat toate la timeout. Upload-urile Storage au 30 s în fetchWithTimeout (lib/supabase.ts).
const UPLOAD_CONCURRENCY = 2;

/** O poză: `uploadPhoto` în Storage → rândul în announcement_photos. Nu aruncă. */
async function uploadOneAnnouncementPhoto(
  announcementId: string,
  photo: PickedImage,
): Promise<boolean> {
  const { path, error } = await uploadPhoto('announcements', announcementId, photo);
  if (error || !path) {
    console.warn('[photos] upload eșuat:', error);
    return false;
  }
  const { error: insertError } = await supabase
    .from('announcement_photos')
    .insert({ announcement_id: announcementId, storage_path: path });
  if (insertError) {
    console.warn('[photos] insert rând eșuat:', insertError.message);
    await deletePhotos([path]); // best-effort, evită orfani
    return false;
  }
  return true;
}

/**
 * Upload poze pentru un anunț DEJA creat (PLAN_FAZA9.md Etapa 9.1.3; din 1.1 — 7.2 — anunțul e
 * încă ciornă, se publică după poze): pt. fiecare poză → `uploadPhoto` în Storage → inserează
 * rândul în announcement_photos. Loturi de câte 3 în paralel (`Promise.allSettled`; înainte:
 * secvențial). Best-effort: pozele care eșuează se sar, anunțul rămâne creat. Dacă upload-ul
 * reușește dar inserarea rândului eșuează, ștergem obiectul urcat (evită orfani în Storage — R2).
 */
export async function uploadAnnouncementPhotos(
  announcementId: string,
  photos: PickedImage[],
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  for (let i = 0; i < photos.length; i += UPLOAD_CONCURRENCY) {
    const batch = photos.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((photo) => uploadOneAnnouncementPhoto(announcementId, photo)),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        uploaded++;
      } else {
        failed++;
        if (result.status === 'rejected') console.warn('[photos] upload eșuat:', result.reason);
      }
    }
  }

  return { uploaded, failed };
}

/** O poză de anunț gata de afișat: rândul din DB + URL-ul semnat (valabil 1h). */
export interface AnnouncementPhotoWithUrl {
  id: string;
  storage_path: string;
  url: string;
}

/**
 * Pozele unui anunț, cu URL-uri semnate cerute în BATCH (un singur apel — R3).
 * RLS decide ce se vede: rândurile inaccesibile nici nu vin, iar semnarea
 * eșuează pt. ce nu poate fi citit → pozele fără URL se omit din listă.
 */
export async function fetchAnnouncementPhotos(
  announcementId: string,
): Promise<AnnouncementPhotoWithUrl[]> {
  // Callerii care încă încarcă anunțul pot pasa '' (regulile hook-urilor nu permit
  // apel condiționat) — nu interogăm degeaba.
  if (!announcementId) return [];

  const { data, error } = await supabase
    .from('announcement_photos')
    .select('id, storage_path')
    .eq('announcement_id', announcementId)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error || !data) return [];

  const rows = data as Pick<AnnouncementPhoto, 'id' | 'storage_path'>[];
  const urls = await signedUrls(rows.map((r) => r.storage_path));

  return rows
    .filter((r) => urls[r.storage_path])
    .map((r) => ({ id: r.id, storage_path: r.storage_path, url: urls[r.storage_path] }));
}

/** Wrapper de ecran peste `fetchAnnouncementPhotos` (detaliu anunț: șofer/mecanic). */
export function useAnnouncementPhotos(announcementId: string) {
  const [photos, setPhotos] = useState<AnnouncementPhotoWithUrl[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setPhotos(await fetchAnnouncementPhotos(announcementId));
    setLoading(false);
  }, [announcementId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { photos, loading, refresh };
}
