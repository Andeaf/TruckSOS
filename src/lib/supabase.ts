import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from '@/types/supabase';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

function fetchWithTimeout(url: RequestInfo | URL, options?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  return fetch(url as string, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Conectarea cu Google pe WEB (1.0.8) merge prin redirect OAuth: clientul schimbă singur
    // `?code=` din URL pe sesiune la pornire (PKCE). Pe telefon rămâne oprit: conectarea e
    // nativă (ID token), iar fluxurile OTP sunt pe cod, nu pe link.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
  global: { fetch: fetchWithTimeout },
});

/**
 * Cheia sub care auth-js ține sesiunea în AsyncStorage — implicitul bibliotecii,
 * `sb-<ref>-auth-token`; calculată din URL ca să rămână aceeași de la o versiune la alta.
 */
const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

/**
 * Sesiunea salvată pe telefon, citită direct din AsyncStorage (14 oct 2026).
 *
 * Când tokenul de acces e expirat și reîmprospătarea pică pe REȚEA (nu pe server),
 * auth-js păstrează sesiunea în storage, dar `getSession()` întoarce `session: null`
 * — iar aplicația îl trimitea pe om la login deși contul lui era valid (reclamația
 * „m-a deconectat fără motiv"). Folosită DOAR ca plasă pentru erorile de rețea de la
 * pornire; dacă tokenul chiar e invalid, auth-js șterge singur sesiunea și emite
 * SIGNED_OUT, iar garda îl duce la login pe bune.
 */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (!parsed?.access_token || !parsed.refresh_token || !parsed.user?.id) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}
