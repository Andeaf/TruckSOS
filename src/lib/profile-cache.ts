import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Profile } from '@/types/database';

/**
 * Ultimul profil citit de pe server, ținut pe telefon (14 oct 2026).
 *
 * Folosit DOAR ca plasă: când profilul nu se poate citi (rețea picată, token expirat
 * fără reîmprospătare), omul rămâne în aplicație cu datele știute, în loc să fie trimis
 * la login sau la alegerea rolului. Sursa adevărului rămâne serverul: fiecare citire
 * reușită suprascrie cache-ul, iar delogarea îl șterge.
 */
const KEY = 'profile-cache';

export async function readProfileCache(userId: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile | null;
    return parsed && parsed.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeProfileCache(profile: Profile | null): Promise<void> {
  try {
    if (profile) await AsyncStorage.setItem(KEY, JSON.stringify(profile));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort: fără cache, următoarea pornire offline arată ecranul de încărcare
  }
}

export async function clearProfileCache(): Promise<void> {
  await writeProfileCache(null);
}
