import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

export type MechanicSearchResult = Pick<
  Profile,
  'id' | 'full_name' | 'specialization' | 'activity_zone'
>;

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
