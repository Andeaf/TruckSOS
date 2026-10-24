import AsyncStorage from '@react-native-async-storage/async-storage';

import { isNetworkError } from '@/lib/network-diagnosis';
import { supabase } from '@/lib/supabase';

/**
 * Mecanicii favoriți ai oaspetelui (1.1, decizia D5): doar pe telefon, în AsyncStorage —
 * zero server, zero RLS nou. La prima sesiune de după modul oaspete, `use-auth` îi mută
 * în `favorite_mechanics` (`migrateGuestFavorites`), ca omul să nu piardă nimic.
 */
const KEY = 'guest-favorites';
const MAX_FAVORITES = 200;

async function write(ids: string[]): Promise<void> {
  try {
    if (ids.length === 0) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX_FAVORITES)));
  } catch {
    // best-effort
  }
}

export async function getGuestFavorites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Adaugă / scoate un mecanic; întoarce lista nouă (cel mai recent primul). */
export async function toggleGuestFavorite(mechanicId: string): Promise<string[]> {
  const current = await getGuestFavorites();
  const next = current.includes(mechanicId)
    ? current.filter((id) => id !== mechanicId)
    : [mechanicId, ...current].slice(0, MAX_FAVORITES);
  await write(next);
  return next;
}

export async function clearGuestFavorites(): Promise<void> {
  await write([]);
}

// O singură migrare odată (profilul poate apărea de mai multe ori în câteva milisecunde).
let migrating: Promise<void> | null = null;

/**
 * Mută favoritele locale în `favorite_mechanics` pentru contul tocmai intrat. Cere
 * profilul creat (FK `driver_id → profiles`). Câte un INSERT per mecanic, ca un rând
 * respins (mecanic șters, nu mai e mecanic — politica de INSERT) să nu le strice pe
 * celelalte; duplicatele (23505) contează ca reușite. Ce pică pe REȚEA rămâne local și
 * se reîncearcă la următoarea ocazie; restul se șterge.
 */
export function migrateGuestFavorites(userId: string): Promise<void> {
  if (migrating) return migrating;
  migrating = (async () => {
    try {
      const ids = await getGuestFavorites();
      if (ids.length === 0) return;
      const keep: string[] = [];
      for (const mechanicId of ids) {
        try {
          const { error } = await supabase
            .from('favorite_mechanics')
            .insert({ driver_id: userId, mechanic_id: mechanicId } as never);
          if (error && error.code !== '23505' && isNetworkError(error)) keep.push(mechanicId);
        } catch (e) {
          if (isNetworkError(e)) keep.push(mechanicId);
        }
      }
      await write(keep);
    } finally {
      migrating = null;
    }
  })();
  return migrating;
}
