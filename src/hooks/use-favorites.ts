import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';
import type { MechanicSearchResult } from '@/hooks/use-mechanic-search';

/**
 * Mecanicii favoriți ai șoferului (PLAN_FAZA13.md §3.5). RLS lasă șoferul să-și
 * vadă doar propriile rânduri, deci nu filtrăm pe driver_id la SELECT.
 * Toggle OPTIMIST: steaua se schimbă instant; la eroare, resincronizăm din DB.
 */

type FavoriteRow = { mechanic_id: string; mechanic: MechanicSearchResult | null };

export function useFavorites() {
  const { session } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<MechanicSearchResult[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from('favorite_mechanics')
      .select(
        'mechanic_id, mechanic:profiles!mechanic_id(id, full_name, specialization, activity_zone, rating_avg, rating_count, avatar_path)'
      )
      .order('created_at', { ascending: false });
    const rows = (data as unknown as FavoriteRow[]) ?? [];
    setFavoriteIds(new Set(rows.map((r) => r.mechanic_id)));
    setFavorites(rows.map((r) => r.mechanic).filter((m): m is MechanicSearchResult => m != null));
    setLoading(false);
  }, [session]);

  const toggleFavorite = useCallback(
    async (mechanicId: string) => {
      if (!session) return;
      const wasFavorite = favoriteIds.has(mechanicId);

      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.delete(mechanicId);
        else next.add(mechanicId);
        return next;
      });
      if (wasFavorite) setFavorites((prev) => prev.filter((m) => m.id !== mechanicId));

      const { error } = wasFavorite
        ? await supabase
            .from('favorite_mechanics')
            .delete()
            .eq('driver_id', session.user.id)
            .eq('mechanic_id', mechanicId)
        : await supabase
            .from('favorite_mechanics')
            .insert({ driver_id: session.user.id, mechanic_id: mechanicId } as never);

      // La eroare: revert prin resincronizare. La adăugare: tot resincronizăm —
      // lista de carduri are nevoie de datele profilului, pe care nu le avem aici.
      if (error || !wasFavorite) await refresh();
    },
    [session, favoriteIds, refresh]
  );

  return { favoriteIds, favorites, loading, toggleFavorite, refresh };
}
