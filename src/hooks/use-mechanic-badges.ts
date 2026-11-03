import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';
import { useRadiusFilter } from '@/hooks/use-radius-filter';

/**
 * Bulinele de noutăți ale mecanicului (Faza 14.10), simetrice între Feed și Candidaturi:
 * fiecare ține un timestamp „ultima vizită pe tab" în AsyncStorage (preferință de afișare
 * per device, ca `viewed` — nu justifică tabel + RLS). FĂRĂ Realtime pe feed (decizia din
 * plan §6.2): recalcul la montare, la revenirea în aplicație (AppState) și prin `refresh`
 * apelat din navigarea între tab-uri. `markSeen` scrie timestamp-ul și stinge bulina.
 *
 * IMPORTANT: `feed_last_seen` e SEPARAT de `use-viewed-announcements` — acela alimentează
 * „Nou" pe carduri și culoarea pinurilor (Faza 11) și rămâne neatins.
 */

const FEED_KEY = (userId: string) => `feed_last_seen:${userId}`;
const APPS_KEY = (userId: string) => `applications_last_seen:${userId}`;

/** Bulina de Feed: anunțuri `open` mai noi decât ultima vizită, VIZIBILE cu raza activă. */
export function useFeedBadge(userId: string | undefined) {
  const [hasNew, setHasNew] = useState(false);
  const { radiusKm, coords } = useRadiusFilter();

  const compute = useCallback(async () => {
    if (!userId) {
      setHasNew(false);
      return;
    }
    const lastSeen = await AsyncStorage.getItem(FEED_KEY(userId));
    // Prima rulare: nu aprindem bulina retroactiv — inițializăm cursorul la „acum".
    if (!lastSeen) {
      await AsyncStorage.setItem(FEED_KEY(userId), new Date().toISOString());
      setHasNew(false);
      return;
    }
    // 1.1 (faza 4.3): numărătoarea se face pe server, în raza activă (aceeași regulă ca
    // feed-ul: anunțurile fără coordonate contează, propriile anunțuri nu) — nu mai
    // descărcăm 500 de rânduri doar ca să aflăm dacă există unul nou.
    const radiusArgs =
      radiusKm != null && coords != null
        ? { p_lat: coords.latitude, p_lng: coords.longitude, p_radius_km: radiusKm }
        : {};
    const { data, error } = await supabase.rpc('open_announcements_near_count', {
      ...radiusArgs,
      p_since: lastSeen,
    } as never);
    // Eroare (rețea slabă, server fără migrare): bulina rămâne stinsă, nu aprinsă fals.
    setHasNew(!error && typeof data === 'number' && data > 0);
  }, [userId, radiusKm, coords]);

  const markSeen = useCallback(async () => {
    if (userId) await AsyncStorage.setItem(FEED_KEY(userId), new Date().toISOString());
    setHasNew(false);
  }, [userId]);

  useEffect(() => {
    compute();
  }, [compute]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') compute();
    });
    return () => sub.remove();
  }, [compute]);

  return { hasNew, refresh: compute, markSeen };
}

type AppBadgeRow = {
  status: string;
  updated_at: string;
  announcement: { status: string; updated_at: string } | null;
};

/** Bulina de Candidaturi: candidatură acceptată/respinsă SAU anunț anulat, de la ultima vizită. */
export function useApplicationsBadge(userId: string | undefined) {
  const [hasNew, setHasNew] = useState(false);

  const compute = useCallback(async () => {
    if (!userId) {
      setHasNew(false);
      return;
    }
    const lastSeen = await AsyncStorage.getItem(APPS_KEY(userId));
    if (!lastSeen) {
      await AsyncStorage.setItem(APPS_KEY(userId), new Date().toISOString());
      setHasNew(false);
      return;
    }
    const { data } = await supabase
      .from('applications')
      .select('status, updated_at, announcement:announcements!announcement_id(status, updated_at)')
      .eq('mechanic_id', userId)
      .order('updated_at', { ascending: false })
      .limit(500);
    const rows = (data ?? []) as unknown as AppBadgeRow[];
    const cutoff = new Date(lastSeen).getTime();
    setHasNew(
      rows.some((a) => {
        // Status schimbat (acceptată/respinsă) de la ultima vizită…
        const statusChanged =
          a.status !== 'pending' && new Date(a.updated_at).getTime() > cutoff;
        // …sau anunțul asociat a fost anulat (bump pe announcements.updated_at).
        const announcementCancelled =
          a.announcement?.status === 'cancelled' &&
          new Date(a.announcement.updated_at).getTime() > cutoff;
        return statusChanged || announcementCancelled;
      })
    );
  }, [userId]);

  const markSeen = useCallback(async () => {
    if (userId) await AsyncStorage.setItem(APPS_KEY(userId), new Date().toISOString());
    setHasNew(false);
  }, [userId]);

  useEffect(() => {
    compute();
  }, [compute]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') compute();
    });
    return () => sub.remove();
  }, [compute]);

  return { hasNew, refresh: compute, markSeen };
}
