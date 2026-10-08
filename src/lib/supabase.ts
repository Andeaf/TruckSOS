import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

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
    // Login-ul social e OPRIT în 1.0.7 (vezi social-auth.ts, `extra.socialLogin.enabled`).
    // Când se pornește (1.0.8), conectarea cu Google pe WEB merge prin redirect OAuth și
    // cere aici `detectSessionInUrl: Platform.OS === 'web'` + `flowType: 'pkce'` (clientul
    // schimbă singur `?code=` pe sesiune la pornire). Pe telefon rămâne oprit oricum:
    // conectarea e nativă (ID token), iar fluxurile OTP sunt pe cod, nu pe link.
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});
