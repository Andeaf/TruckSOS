import 'react-native-url-polyfill/auto';
import { createClient, type Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { secureSessionStorage, sessionStorageAdapter } from '@/lib/secure-session-storage';
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
    // 26 oct 2026 (AUDIT #15): SecureStore (Keychain/Keystore) pe telefon, cu migrare automată din
    // AsyncStorage la prima pornire; pe web rămâne localStorage. Vezi lib/secure-session-storage.ts.
    storage: sessionStorageAdapter,
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
 * Cheia sub care auth-js ține sesiunea în storage — implicitul bibliotecii,
 * `sb-<ref>-auth-token`; calculată din URL ca să rămână aceeași de la o versiune la alta.
 */
const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

/**
 * Sesiunea salvată pe telefon, citită direct din storage (14 oct 2026; din 26 oct prin adaptorul
 * SecureStore, care face și migrarea din AsyncStorage).
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
    // Web: auth-js ține sesiunea în localStorage sub aceeași cheie (ca înainte prin AsyncStorage,
    // care pe web e tot localStorage); telefon: SecureStore, cu migrarea din AsyncStorage.
    const raw =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(AUTH_STORAGE_KEY) ?? null
        : await secureSessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (!parsed?.access_token || !parsed.refresh_token || !parsed.user?.id) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}
