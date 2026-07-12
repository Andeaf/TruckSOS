import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Anunțurile pe care ACEST mecanic le-a deschis măcar o dată.
 * Ținute local (AsyncStorage), per utilizator — starea „am văzut deja anunțul" e
 * o preferință de afișare, nu date partajate: nu justifică un tabel + RLS.
 * Consecință acceptată: pe alt telefon, anunțurile apar din nou ca „Nou".
 */

const KEY_PREFIX = 'mechanic_viewed_announcements:';
/** Limită de siguranță: păstrăm doar cele mai recente id-uri, ca lista să nu crească la infinit. */
const MAX_IDS = 300;

function keyFor(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

export async function markAnnouncementViewed(userId: string, announcementId: string): Promise<void> {
  const key = keyFor(userId);
  const raw = await AsyncStorage.getItem(key);
  const ids: string[] = raw ? JSON.parse(raw) : [];
  if (ids.includes(announcementId)) return;
  const next = [announcementId, ...ids].slice(0, MAX_IDS);
  await AsyncStorage.setItem(key, JSON.stringify(next));
}

/** Set-ul de id-uri deja văzute; `refresh` se reapelează la focus pe feed. */
export function useViewedAnnouncements(userId: string | undefined) {
  const [viewed, setViewed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!userId) { setViewed(new Set()); return; }
    const raw = await AsyncStorage.getItem(keyFor(userId));
    setViewed(new Set(raw ? (JSON.parse(raw) as string[]) : []));
  }, [userId]);

  return { viewed, refresh };
}
