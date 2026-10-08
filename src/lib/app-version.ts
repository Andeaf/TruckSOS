import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/share-app';

/** Platformele cu magazin (pe web nu există „update", bundle-ul e mereu cel curent). */
export type StorePlatform = 'android' | 'ios';

/**
 * Versiunea instalată = „version" din app.json, înglobat în build de expo-constants
 * (aceeași sursă ca rândul „Versiunea X" din Setări și ca `p_app_build` din push.ts).
 * `null` dacă lipsește (nu ar trebui) → verificarea de update nu se face deloc.
 */
export function currentAppVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

export function storePlatform(): StorePlatform | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

/** Linkurile din share-app.ts — de rezervă, dacă rândul din DB n-are store_url valid. */
export const DEFAULT_STORE_URL: Record<StorePlatform, string> = {
  android: PLAY_STORE_URL,
  ios: APP_STORE_URL,
};

/**
 * Comparare numerică pe segmente („1.0.10" > „1.0.9", „1.1" == „1.1.0"), NU
 * lexicografică. Segmentele care nu sunt numere se citesc ca 0.
 * Întoarce -1 / 0 / 1 (a < b / egale / a > b).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.trim().split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.trim().split('.').map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
