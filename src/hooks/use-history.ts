import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Announcement } from '@/types/database';

/**
 * Istoricul problemelor șoferului (PLAN_FAZA9.md §6, Bloc 9.3).
 * Jurnal complet: TOATE statusurile (inclusiv `resolved`), mai puțin cele ascunse.
 * Tab-ul principal de anunțuri rămâne neschimbat (decizie: `resolved` apare în ambele).
 */

export type HistoryAnnouncement = Announcement & {
  mechanic: { id: string; full_name: string } | null;
};

export function useHistory(driverId: string | undefined) {
  const [items, setItems] = useState<HistoryAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*, mechanic:profiles!mechanic_id(id, full_name)')
      .eq('driver_id', driverId)
      .eq('hidden_from_history', false)
      .order('created_at', { ascending: false });
    setItems((data as unknown as HistoryAnnouncement[]) ?? []);
    setLoading(false);
  }, [driverId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, loading, refresh };
}

/**
 * Ascunde din istoric (soft-delete) prin RPC `SECURITY DEFINER` — R6: nu slăbim
 * politicile de UPDATE pe `announcements`, care permit doar tranziții de status.
 * `ids` gol/absent → ascunde TOT istoricul șoferului. Întoarce mesajul de eroare.
 */
export async function hideFromHistory(ids?: string[]): Promise<string | null> {
  const { error } = await supabase.rpc('set_announcements_hidden', {
    p_ids: ids && ids.length > 0 ? ids : null,
  } as never);
  return error?.message ?? null;
}
