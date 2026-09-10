import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { MentionUser } from '@/lib/mention-search';
import type { Profile, Role } from '@/types/database';

export type MechanicSearchResult = Pick<
  Profile,
  | 'id'
  | 'full_name'
  | 'specialization'
  | 'activity_zone'
  | 'rating_avg'
  | 'rating_count'
  | 'avatar_path'
>;

/** Faza 19.6: rezultat din directorul TUTUROR utilizatorilor (RPC search_users). */
export type UserSearchResult = MechanicSearchResult & { role: Role };

export const SEARCH_MIN_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function useMechanicSearch(query: string) {
  const [results, setResults] = useState<MechanicSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_mechanics', {
        p_query: trimmed,
      } as never);
      if (active) {
        setResults((data as unknown as MechanicSearchResult[]) ?? []);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}

/**
 * 5 aug: directorul complet al mecanicilor, alfabetic — umple spațiul de sub
 * „Căutări recente" pe pagina de căutare. Sortarea finală e client-side cu
 * localeCompare (ordinea DB pune diacriticele după 'z').
 */
export function useAllMechanics() {
  const [mechanics, setMechanics] = useState<MechanicSearchResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id,full_name,specialization,activity_zone,rating_avg,rating_count,avatar_path')
        .eq('role', 'mechanic')
        .is('deleted_at', null)
        .order('full_name', { ascending: true });
      if (!active) return;
      const list = ((data as unknown as MechanicSearchResult[]) ?? []).slice();
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ro', { sensitivity: 'base' }));
      setMechanics(list);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { mechanics, loading };
}

/** Faza 19.6: căutare în TOȚI utilizatorii (ambele roluri) — pickerul „conversație
 * nouă" și share-ul de anunțuri. Identic cu useMechanicSearch, dar pe search_users. */
export function useUserSearch(query: string) {
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users', {
        p_query: trimmed,
      } as never);
      if (active) {
        setResults((data as unknown as UserSearchResult[]) ?? []);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
}

/**
 * Menționări „@" (10 sept): candidații din TOATĂ aplicația, pentru numele care nu
 * sunt printre expeditorii deja încărcați în chat. Același RPC ca pickerul de
 * utilizatori (fără sine, admini, ștersși sau perechi blocate); ordonarea fină o
 * face clientul (rankMentionCandidates), amestecând rezultatele cu cele locale.
 */
export async function searchMentionUsers(query: string): Promise<MentionUser[]> {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_MIN_LENGTH) return [];
  const { data } = await supabase.rpc('search_users', { p_query: trimmed } as never);
  return (((data ?? []) as unknown) as UserSearchResult[]).map((u) => ({
    id: u.id,
    full_name: u.full_name,
    avatar_path: u.avatar_path,
    role: u.role,
  }));
}

/**
 * Faza 19.6: istoricul recomandărilor — ultimii utilizatori pe care userul i-a atașat
 * unor mesaje (privat + canal), dedupe în ordinea recenței, FILTRAT pe rolul cerut
 * (pickerul de mecanici arată doar mecanici, cel de transportatori doar șoferi).
 */
export async function fetchRecentRecommendedMechanics(
  userId: string,
  targetRole: 'mechanic' | 'driver' = 'mechanic',
  limit = 8
): Promise<MechanicSearchResult[]> {
  const [priv, chan] = await Promise.all([
    supabase
      .from('messages')
      .select('recommended_mechanic_id, created_at')
      .eq('sender_id', userId)
      .not('recommended_mechanic_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('channel_messages')
      .select('recommended_mechanic_id, created_at')
      .eq('sender_id', userId)
      .not('recommended_mechanic_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  type Row = { recommended_mechanic_id: string; created_at: string };
  const rows = [
    ...(((priv.data ?? []) as unknown) as Row[]),
    ...(((chan.data ?? []) as unknown) as Row[]),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const ids: string[] = [];
  for (const row of rows) {
    if (!ids.includes(row.recommended_mechanic_id)) ids.push(row.recommended_mechanic_id);
    if (ids.length >= limit) break;
  }
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id,full_name,specialization,activity_zone,rating_avg,rating_count,avatar_path,deleted_at,role')
    .in('id', ids)
    .eq('role', targetRole);
  const byId = new Map(
    (((profiles ?? []) as unknown) as (MechanicSearchResult & { deleted_at: string | null })[]).map(
      (p) => [p.id, p]
    )
  );
  // Ordinea istoricului, fără conturi șterse; rolul e deja filtrat server-side.
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is MechanicSearchResult & { deleted_at: string | null } => !!p && !p.deleted_at);
}
