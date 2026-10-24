import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { PickedImage } from '@/lib/media';

/**
 * Draftul anunțului nepublicat (1.1, Faza B): oaspetele completează formularul, apasă
 * „Publică", primește foaia „Fă-ți cont" — iar ce a scris rămâne aici până se publică
 * după cont (banner pe lista de anunțuri, vezi `useAuth().pendingDraft`).
 *
 * Câmpurile = state-ul din `announcement-form-screen.tsx` (string-urile brute, exact cum
 * le-a tastat omul; validarea se face la publicare). Pozele (review B-4): URI-urile din
 * expo-image-picker stau în cache și sistemul le poate șterge oricând, deci le COPIEM în
 * `<documentDirectory>/drafts/` cu API-ul nou din expo-file-system 19 (`File.copy`).
 * Pe web nu există sistem de fișiere persistent (URI-urile `blob:` mor la reîncărcare),
 * deci acolo draftul păstrează doar textul. După 7 zile draftul și pozele se șterg
 * (`purgeStaleDrafts`, la pornire).
 */
export interface AnnouncementDraft {
  description: string;
  location: string;
  truckMake: string;
  truckModel: string;
  truckYearStr: string;
  plateNumber: string;
  chassisNumber: string;
  latitudeStr: string;
  longitudeStr: string;
  /** Copiate în `drafts/` (nativ); `width`/`height` trebuie la compresia de la upload. */
  photos: PickedImage[];
  /** `Date.now()` la ultima salvare. */
  savedAt: number;
}

const KEY = 'announcement-draft';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const listeners = new Set<(hasDraft: boolean) => void>();

/** Anunță schimbările (salvare / ștergere) — `use-auth` ține `pendingDraft` la zi. */
export function subscribeAnnouncementDraft(listener: (hasDraft: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(hasDraft: boolean) {
  listeners.forEach((l) => l(hasDraft));
}

function draftsDir(): Directory | null {
  if (Platform.OS === 'web') return null;
  try {
    return new Directory(Paths.document, 'drafts');
  } catch {
    return null;
  }
}

function extensionOf(uri: string): string {
  const match = /\.([A-Za-z0-9]{2,5})(?:[?#].*)?$/.exec(uri);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

/** Copiază pozele care nu sunt deja în `drafts/`; o copiere eșuată păstrează URI-ul inițial. */
function persistPhotos(photos: PickedImage[], dir: Directory | null): PickedImage[] {
  if (!dir) return [];
  try {
    dir.create({ idempotent: true, intermediates: true });
  } catch {
    return photos;
  }
  const stamp = Date.now();
  return photos.map((photo, i) => {
    if (photo.uri.includes('/drafts/')) return photo;
    try {
      const dest = new File(dir, `${stamp}-${i}${extensionOf(photo.uri)}`);
      new File(photo.uri).copy(dest);
      return { ...photo, uri: dest.uri };
    } catch {
      return photo;
    }
  });
}

/** Șterge din `drafts/` fișierele pe care draftul nu le mai folosește. */
function removeUnusedFiles(dir: Directory | null, keep: PickedImage[]) {
  if (!dir) return;
  try {
    if (!dir.exists) return;
    // Comparăm după numele fișierului: forma URI-ului (file:/ vs file:///) poate diferi
    // între ce am salvat și ce întoarce list().
    const used = new Set(keep.map((p) => p.uri.split('/').pop()));
    for (const entry of dir.list()) {
      if (entry instanceof File && !used.has(entry.name)) entry.delete();
    }
  } catch {
    // best-effort
  }
}

export async function saveAnnouncementDraft(
  draft: Omit<AnnouncementDraft, 'savedAt'> & { savedAt?: number }
): Promise<void> {
  const dir = draftsDir();
  const photos = persistPhotos(draft.photos, dir);
  removeUnusedFiles(dir, photos);
  const value: AnnouncementDraft = { ...draft, photos, savedAt: Date.now() };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(value));
    notify(true);
  } catch {
    // best-effort: fără draft salvat, formularul rămâne cum e pe ecran
  }
}

export async function loadAnnouncementDraft(): Promise<AnnouncementDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as AnnouncementDraft | null;
    if (!draft || typeof draft.savedAt !== 'number') return null;
    if (Date.now() - draft.savedAt > MAX_AGE_MS) return null;
    // O poză dispărută (copiere eșuată + cache golit) nu trebuie să blocheze publicarea.
    const photos = Platform.OS === 'web'
      ? []
      : (draft.photos ?? []).filter((p) => {
          try {
            return new File(p.uri).exists;
          } catch {
            return false;
          }
        });
    return { ...draft, photos };
  } catch {
    return null;
  }
}

/** Șterge draftul și pozele copiate (după publicare sau la renunțare). */
export async function clearAnnouncementDraft(): Promise<void> {
  const dir = draftsDir();
  try {
    if (dir?.exists) dir.delete();
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
  notify(false);
}

/** Pornirea aplicației: un draft mai vechi de 7 zile (sau stricat) dispare cu tot cu poze. */
export async function purgeStaleDrafts(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const draft = JSON.parse(raw) as Partial<AnnouncementDraft> | null;
      const fresh = !!draft && typeof draft.savedAt === 'number' && Date.now() - draft.savedAt <= MAX_AGE_MS;
      if (fresh) return;
    }
  } catch {
    // JSON stricat → îl ștergem mai jos
  }
  // Fără draft valid: nici pozele orfane din `drafts/` nu mai au ce căuta.
  await clearAnnouncementDraft();
}
