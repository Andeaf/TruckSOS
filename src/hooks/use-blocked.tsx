import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';

/**
 * Blocările PROPRII ale utilizatorului (Faza 18). Sursa de adevăr e tabelul
 * `blocked_users`, al cărui RLS întoarce DOAR rândurile unde ești blocker —
 * lista nu poate conține și nu poate divulga cine TE-A blocat pe tine.
 *
 * Context unic la nivel de aplicație: același set e consumat de chatul global
 * (filtrare la afișare), chatul privat (banner + compozitor înghețat), profiluri
 * (Blochează/Deblochează), favoriți și ecranul „Utilizatori blocați" din Setări.
 */

export interface BlockedRow {
  blocked_id: string;
  created_at: string;
}

interface BlockedContextValue {
  rows: BlockedRow[];
  blockedIds: Set<string>;
  loading: boolean;
  refresh: () => Promise<void>;
  /** RPC `block_user` — are efect secundar server-side (auto-reject candidaturi pending). */
  block: (userId: string) => Promise<string | null>;
  /** DELETE direct (politica blocked_delete_own) — fără efecte secundare, fără restaurări. */
  unblock: (userId: string) => Promise<string | null>;
}

const BlockedContext = createContext<BlockedContextValue | null>(null);

export function BlockedProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('blocked_users')
      .select('blocked_id, created_at')
      .order('created_at', { ascending: false });
    setRows((data as unknown as BlockedRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const block = useCallback(async (targetId: string): Promise<string | null> => {
    const { error } = await supabase.rpc('block_user', { p_target: targetId } as never);
    if (error) return error.message;
    // Optimist, idempotent (serverul face ON CONFLICT DO NOTHING).
    setRows((prev) =>
      prev.some((r) => r.blocked_id === targetId)
        ? prev
        : [{ blocked_id: targetId, created_at: new Date().toISOString() }, ...prev]
    );
    return null;
  }, []);

  const unblock = useCallback(
    async (targetId: string): Promise<string | null> => {
      if (!userId) return 'not_authenticated';
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', userId)
        .eq('blocked_id', targetId);
      if (error) return error.message;
      setRows((prev) => prev.filter((r) => r.blocked_id !== targetId));
      return null;
    },
    [userId]
  );

  const value = useMemo<BlockedContextValue>(
    () => ({
      rows,
      blockedIds: new Set(rows.map((r) => r.blocked_id)),
      loading,
      refresh,
      block,
      unblock,
    }),
    [rows, loading, refresh, block, unblock]
  );

  return <BlockedContext.Provider value={value}>{children}</BlockedContext.Provider>;
}

export function useBlocked(): BlockedContextValue {
  const ctx = useContext(BlockedContext);
  if (!ctx) throw new Error('useBlocked trebuie folosit sub BlockedProvider');
  return ctx;
}
