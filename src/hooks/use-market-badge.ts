import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

/**
 * Bulina de noutăți a Marketului (8 sept 2026), simetrică cu bulinele mecanicului
 * din `use-mechanic-badges.ts`: un timestamp „ultima vizită pe tab" în AsyncStorage
 * (preferință de afișare per device — decizia documentată în `use-viewed-announcements`:
 * nu justifică tabel + RLS; consecința asumată e că pe alt telefon bulina se reaprinde).
 * Recalcul la montare, la revenirea în aplicație (AppState) și prin `refresh` apelat
 * din navigarea între tab-uri; `markSeen` scrie timestamp-ul și stinge bulina.
 *
 * Spre deosebire de `useFeedBadge`, comparația se face PE SERVER (`.gt('created_at')`
 * + `limit(1)`): Marketul n-are filtru de rază de aplicat client-side, iar indexul
 * `idx_market_listings_status_created` acoperă exact interogarea asta.
 *
 * Anunțurile vândute nu aprind bulina, nici cele proprii. Vânzătorii blocați sunt
 * excluși deja de politica RESTRICTIVE `market_select_not_blocked` (Faza 18).
 */

const MARKET_KEY = (userId: string) => `market_last_seen:${userId}`;

export function useMarketBadge(userId: string | undefined) {
  const [hasNew, setHasNew] = useState(false);

  const compute = useCallback(async () => {
    if (!userId) {
      setHasNew(false);
      return;
    }
    const lastSeen = await AsyncStorage.getItem(MARKET_KEY(userId));
    // Prima rulare: nu aprindem bulina retroactiv — inițializăm cursorul la „acum".
    if (!lastSeen) {
      await AsyncStorage.setItem(MARKET_KEY(userId), new Date().toISOString());
      setHasNew(false);
      return;
    }
    const { data } = await supabase
      .from('market_listings')
      .select('id')
      .eq('status', 'active')
      // Propriul anunț nu aprinde bulina.
      .neq('seller_id', userId)
      .gt('created_at', lastSeen)
      .limit(1);
    setHasNew((data?.length ?? 0) > 0);
  }, [userId]);

  const markSeen = useCallback(async () => {
    if (userId) await AsyncStorage.setItem(MARKET_KEY(userId), new Date().toISOString());
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
