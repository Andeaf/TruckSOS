import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';
import type { MechanicSearchResult } from '@/hooks/use-mechanic-search';

/**
 * Istoricul de căutări al șoferului (PLAN_FAZA13.md §3.5). Dedup prin PK compus:
 * upsert-ul actualizează searched_at → mecanicul redeschis urcă pe primul loc
 * fără dublură. RLS lasă șoferul să-și vadă doar propriile rânduri.
 */

/** Afișăm maximum 10 intrări; rândurile mai vechi rămân în tabel dar nu se cer. */
const HISTORY_LIMIT = 10;

type HistoryRow = { mechanic_id: string; mechanic: MechanicSearchResult | null };

export function useSearchHistory() {
  const { session } = useAuth();
  const [history, setHistory] = useState<MechanicSearchResult[]>([]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from('search_history')
      .select(
        'mechanic_id, mechanic:profiles!mechanic_id(id, full_name, specialization, activity_zone, rating_avg, rating_count, avatar_path)'
      )
      .order('searched_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const rows = (data as unknown as HistoryRow[]) ?? [];
    setHistory(rows.map((r) => r.mechanic).filter((m): m is MechanicSearchResult => m != null));
  }, [session]);

  /** Fire-and-forget din onPress-ul rezultatelor: navigarea nu așteaptă scrierea. */
  const recordSearch = useCallback(
    (mechanicId: string) => {
      if (!session) return;
      supabase
        .from('search_history')
        .upsert(
          {
            driver_id: session.user.id,
            mechanic_id: mechanicId,
            searched_at: new Date().toISOString(),
          } as never,
          { onConflict: 'driver_id,mechanic_id' }
        )
        .then(({ error }) => {
          if (error) console.warn('[istoric] upsert eșuat:', error.message);
        });
    },
    [session]
  );

  /** X-ul de pe card: eliminare optimistă, fără confirmare; la eroare resincronizăm. */
  const removeEntry = useCallback(
    async (mechanicId: string) => {
      if (!session) return;
      setHistory((prev) => prev.filter((m) => m.id !== mechanicId));
      const { error } = await supabase
        .from('search_history')
        .delete()
        .eq('driver_id', session.user.id)
        .eq('mechanic_id', mechanicId);
      if (error) await refresh();
    },
    [session, refresh]
  );

  return { history, recordSearch, removeEntry, refresh };
}
