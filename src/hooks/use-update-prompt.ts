import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  compareVersions,
  currentAppVersion,
  DEFAULT_STORE_URL,
  storePlatform,
} from '@/lib/app-version';
import { supabase } from '@/lib/supabase';

/**
 * „Versiune nouă disponibilă" (17 sept 2026, cerere user): la deschiderea aplicației
 * (și la revenirea din fundal) citim din `app_versions` versiunea LIVE a platformei
 * și, dacă cea instalată e mai veche, arătăm mesajul cu „Mai târziu" / „Actualizează".
 *
 * O SINGURĂ dată la 24h per dispozitiv: momentul ultimei afișări stă în AsyncStorage
 * (nu per cont — e o preferință a telefonului, ca tema). Pauza se verifică ÎNAINTE
 * de rețea, deci în majoritatea deschiderilor nu costă nimic. Orice eroare (offline,
 * tabelă lipsă pe un server nemigrat) = fără mesaj; reîncercăm la următoarea deschidere.
 * Pe web nu se face nimic (nu există magazin; vezi storePlatform()).
 */

const LAST_SHOWN_KEY = '@trucksos/update_prompt_last_shown';
export const UPDATE_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AvailableUpdate {
  /** Versiunea live din magazin (ex. „1.0.6") — apare în textul mesajului. */
  version: string;
  storeUrl: string;
}

async function shownRecently(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SHOWN_KEY);
    const lastShown = raw ? Number(raw) : 0;
    return Number.isFinite(lastShown) && Date.now() - lastShown < UPDATE_PROMPT_INTERVAL_MS;
  } catch {
    return false;
  }
}

async function markShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    // Fără persistare, cel mult mai apare o dată la următoarea deschidere.
  }
}

/** `enabled` = utilizator logat, cu profil (mesajul nu are ce căuta peste ecranele de auth). */
export function useUpdatePrompt(enabled: boolean) {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  // O singură verificare o dată: pornirea + AppState `active` pot veni aproape simultan.
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const platform = storePlatform();
      const current = currentAppVersion();
      if (!platform || !current) return;
      if (await shownRecently()) return;

      const { data, error } = await supabase
        .from('app_versions')
        .select('latest_version, store_url')
        .eq('platform', platform)
        .maybeSingle();
      // Cast ca în celelalte hook-uri: tipurile scrise de mână din types/database.ts
      // nu au tot scheletul cerut de supabase-js, iar rândul iese `never`.
      const row = data as { latest_version: string; store_url: string | null } | null;
      if (error || !row) return;
      if (compareVersions(current, row.latest_version) >= 0) return;

      // Marcăm la AFIȘARE (nu la închidere): dacă aplicația e omorâtă cu mesajul
      // deschis, tot contează ca „azi l-a văzut".
      await markShown();
      setUpdate({
        version: row.latest_version,
        storeUrl: row.store_url || DEFAULT_STORE_URL[platform],
      });
    } catch {
      // Offline / timeout: fără mesaj.
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Delogare cu mesajul deschis: nu rămâne peste ecranul de login.
      setUpdate(null);
      return;
    }
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [enabled, check]);

  const dismiss = useCallback(() => setUpdate(null), []);

  /** „Actualizează": fișa aplicației (https → Android/iOS o deschid direct în Play / App Store). */
  const openStore = useCallback(async () => {
    const url = update?.storeUrl;
    setUpdate(null);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      const platform = storePlatform();
      if (!platform) return;
      try {
        await Linking.openURL(DEFAULT_STORE_URL[platform]);
      } catch {
        // Niciun handler pentru link: nimic de făcut, mesajul revine peste 24h.
      }
    }
  }, [update]);

  return { update, dismiss, openStore };
}
