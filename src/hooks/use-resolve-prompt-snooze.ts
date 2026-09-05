import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * „Încă nu" / X la caseta „Și-a găsit anunțul rezolvarea?" (4 sept 2026): amânare
 * per anunț, ținută local (AsyncStorage) per utilizator — e o preferință de afișare,
 * nu date partajate (același raționament ca la „văzut" pe feedul mecanicului).
 * Consecință acceptată: pe alt dispozitiv caseta poate reapărea mai devreme.
 */

const KEY_PREFIX = '@trucksos/resolve_prompt_snooze:';
export const RESOLVE_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** id anunț → până când e amânat (ms epoch). */
type SnoozeMap = Record<string, number>;

function keyFor(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

async function loadSnoozes(userId: string): Promise<SnoozeMap> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    const parsed = raw ? (JSON.parse(raw) as SnoozeMap) : {};
    const now = Date.now();
    // Intrările expirate se curăță la fiecare citire — lista nu crește la infinit.
    return Object.fromEntries(
      Object.entries(parsed).filter(([, until]) => typeof until === 'number' && until > now)
    );
  } catch {
    return {};
  }
}

export function useResolvePromptSnooze(userId: string | undefined) {
  const [snoozed, setSnoozed] = useState<SnoozeMap>({});

  /** Se reapelează la focus pe listă (ca `refresh` al anunțurilor). */
  const refresh = useCallback(async () => {
    if (!userId) {
      setSnoozed({});
      return;
    }
    setSnoozed(await loadSnoozes(userId));
  }, [userId]);

  const snooze = useCallback(
    async (announcementId: string) => {
      if (!userId) return;
      const until = Date.now() + RESOLVE_PROMPT_SNOOZE_MS;
      // Starea întâi (caseta dispare instant), persistarea după.
      setSnoozed((prev) => ({ ...prev, [announcementId]: until }));
      try {
        const next = { ...(await loadSnoozes(userId)), [announcementId]: until };
        await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
      } catch {
        // Amânarea rămâne activă în memorie pentru sesiunea curentă.
      }
    },
    [userId]
  );

  const isSnoozed = useCallback(
    (announcementId: string) => (snoozed[announcementId] ?? 0) > Date.now(),
    [snoozed]
  );

  return { isSnoozed, snooze, refresh };
}
